/** Pruebas de resiliencia (sección 21) sobre la base simulada. */
import 'reflect-metadata';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findRepoRoot } from '@msh/mock-db';

const workDir = mkdtempSync(join(tmpdir(), 'msh-res-'));
cpSync(join(findRepoRoot(), 'mock-database'), workDir, { recursive: true });
process.env.MOCK_DATABASE = '1';
process.env.MOCK_DATABASE_DIR = workDir;
process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
delete process.env.FIXED_NOW;

import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { SimulatedPosAdapter } from '@msh/simulated-pos';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { AuditService } from './audit/audit.service';
import { correlationMiddleware } from './common/correlation.middleware';

const PASSWORD = process.env.SEED_LAB_PASSWORD ?? 'Laboratorio_2026_Lab';

describe('Resiliencia', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let audit: AuditService;
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.use(correlationMiddleware as never);
    await app.init();
    prisma = app.get(PrismaService);
    audit = app.get(AuditService);
    for (const who of ['admin', 'pki', 'emisor', 'retailit', 'soporte']) {
      tokens[who] = (await http().post('/api/v1/auth/login').send({ email: `${who}@msh.lab`, password: PASSWORD }).expect(200)).body.accessToken;
    }
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  const online = async (skip = 0) => {
    const states = await prisma.simulatedTerminalState.findMany({ where: { failureMode: 'NONE', scenario: { startsWith: 'Vigente' } }, include: { terminal: true } });
    return states.sort((a, b) => a.terminal.hostname.localeCompare(b.terminal.hostname))[skip].terminal;
  };

  it('la base de datos no disponible produce un error 500 sin filtrar detalles internos', async () => {
    jest.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection refused 10.0.0.5:1433'));
    const res = await http().get('/api/v1/health').expect(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/10\.0\.0\.5|connection refused/);
    expect(res.body.correlationId).toBeTruthy();
  });

  it('un timeout del adaptador deja un inventario fallido y la terminal sin conexión (no exitoso)', async () => {
    const t = await online();
    jest.spyOn(SimulatedPosAdapter.prototype, 'collect').mockRejectedValueOnce(new Error('Tiempo de espera agotado'));
    const res = await http().post(`/api/v1/terminals/${t.id}/inventory`).set(as('retailit')).expect(201);
    expect(res.body.status).toBe('FAILED');
    expect((await prisma.terminal.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('OFFLINE');
  });

  it('un fallo parcial dentro de la transacción revierte todos los cambios (atomicidad)', async () => {
    const t = await online(1);
    const before = { scans: await prisma.inventoryScan.count(), certs: await prisma.certificate.count(), audit: await prisma.auditEvent.count() };
    jest.spyOn(audit, 'recordWithin').mockRejectedValueOnce(new Error('Falla simulada de la cola de auditoría'));
    await http().post(`/api/v1/terminals/${t.id}/inventory`).set(as('retailit')).expect(500);
    expect(await prisma.inventoryScan.count()).toBe(before.scans);
    expect(await prisma.certificate.count()).toBe(before.certs);
    expect(await prisma.auditEvent.count()).toBe(before.audit);
    expect((await prisma.terminal.findUniqueOrThrow({ where: { id: t.id } })).lastInventoryAt).toBeNull();
    // Tras la falla, el sistema se recupera y el inventario posterior funciona.
    await http().post(`/api/v1/terminals/${t.id}/inventory`).set(as('retailit')).expect(201);
  });

  async function scheduledJob(skip: number) {
    const t = await online(skip);
    await http().post(`/api/v1/terminals/${t.id}/inventory`).set(as('retailit'));
    const inst = await prisma.certificateInstallation.findFirstOrThrow({ where: { terminalId: t.id, storeName: 'My', status: 'PRESENT' } });
    const r = await http().post('/api/v1/renewals').set(as('retailit')).send({ certificateId: inst.certificateId, terminalIds: [t.id] }).expect(201);
    await http().post(`/api/v1/renewals/${r.body.id}/request-issuance`).set(as('retailit')).expect(200);
    await http().post(`/api/v1/renewals/${r.body.id}/issue`).set(as('pki')).expect(200);
    const w = await http().post('/api/v1/maintenance-windows').set(as('pki')).send({ name: 'Ventana resiliencia', startsAt: iso(-3_600_000), endsAt: iso(3_600_000) }).expect(201);
    const a = await http().post(`/api/v1/renewals/${r.body.id}/request-approval`).set(as('retailit')).send({ maintenanceWindowId: w.body.id, justification: 'Prueba de resiliencia' }).expect(200);
    await http().post(`/api/v1/approvals/${a.body.id}/decision`).set(as('emisor')).send({ decision: 'APPROVED', justification: 'Aprobada' }).expect(200);
    const j = await http().post('/api/v1/deployments').set(as('retailit')).send({ approvalId: a.body.id, scheduledAt: iso(), idempotencyKey: `res-${randomUUID()}`, simulateFailure: 'NONE' }).expect(201);
    return { renewalId: r.body.id as string, jobId: j.body.id as string };
  }

  it('dos ejecuciones simultáneas del mismo trabajo: solo una procede', async () => {
    const { jobId } = await scheduledJob(2);
    const [a, b] = await Promise.all([
      http().post(`/api/v1/deployments/${jobId}/execute`).set(as('soporte')),
      http().post(`/api/v1/deployments/${jobId}/execute`).set(as('soporte')),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await prisma.deploymentAttempt.count({ where: { target: { jobId } } }))).toBe(1);
  });

  it('una operación interrumpida se concilia como fallida y nunca como exitosa', async () => {
    const { renewalId, jobId } = await scheduledJob(3);
    // Simula un proceso que murió tras iniciar la instalación.
    await prisma.deploymentJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date(Date.now() - 60 * 60_000) } });
    await prisma.renewalRequest.update({ where: { id: renewalId }, data: { status: 'INSTALLING' } });
    const res = await http().post('/api/v1/deployments/reconcile').set(as('soporte')).expect(200);
    expect(res.body.reconciled).toBeGreaterThanOrEqual(1);
    expect((await prisma.deploymentJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('FAILED');
    expect((await prisma.renewalRequest.findUniqueOrThrow({ where: { id: renewalId } })).status).toBe('FAILED');
    expect(await prisma.deploymentTarget.count({ where: { jobId, status: 'VERIFIED' } })).toBe(0);
  });

  it('la ejecución de un trabajo cuya aprobación venció se cancela y se audita', async () => {
    const { renewalId, jobId } = await scheduledJob(4);
    const job = await prisma.deploymentJob.findUniqueOrThrow({ where: { id: jobId } });
    await prisma.approvalRequest.update({ where: { id: job.approvalId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await http().post(`/api/v1/deployments/${jobId}/execute`).set(as('soporte')).expect(409);
    expect(res.body.code).toBe('APPROVAL_INVALID');
    expect((await prisma.deploymentJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('CANCELLED');
    expect((await prisma.renewalRequest.findUniqueOrThrow({ where: { id: renewalId } })).status).toBe('ISSUED');
  });

  it('los datos con intentos de inyección se tratan como texto', async () => {
    const res = await http().get(`/api/v1/certificates?search=${encodeURIComponent("'; DROP TABLE Certificate; --")}`).set(as('pki')).expect(200);
    expect(res.body.total).toBe(0);
    const csv = await http().get('/api/v1/certificates/export').set(as('pki')).expect(200);
    expect(csv.text).not.toMatch(/\n[=+@]cmd/);
    await http().post('/api/v1/auth/login').send({ email: "admin@msh.lab' OR '1'='1", password: 'x' }).expect(400);
  });

  it('las respuestas no exponen hashes de contraseña, PEM ni claves privadas', async () => {
    const t = await online(5);
    await http().post(`/api/v1/terminals/${t.id}/inventory`).set(as('retailit')).expect(201);
    const bodies = [
      (await http().get('/api/v1/admin/users').set(as('admin'))).text,
      (await http().get('/api/v1/admin/roles').set(as('admin'))).text,
      (await http().get(`/api/v1/terminals/${t.id}`).set(as('admin'))).text,
      (await http().get('/api/v1/certificates?pageSize=200').set(as('admin'))).text,
      (await http().get('/api/v1/renewals').set(as('admin'))).text,
      (await http().get('/api/v1/audit?pageSize=200').set(as('admin'))).text,
    ];
    for (const b of bodies) expect(b).not.toMatch(/passwordHash|\$2[aby]\$|PRIVATE KEY|BEGIN CERTIFICATE|tokenHash|refreshToken/);
  });

  it('la alteración de un evento de auditoría se detecta al verificar la cadena', async () => {
    const before = (await http().get('/api/v1/audit/verify').set(as('admin')).expect(200)).body;
    expect(JSON.stringify(before)).toContain('"valid":true');
    const events = await prisma.auditEvent.findMany({ orderBy: { sequence: 'asc' } });
    const target = events[Math.floor(events.length / 2)];
    await prisma.auditEvent.update({ where: { sequence: target.sequence }, data: { result: target.result === 'SUCCESS' ? 'FAILURE' : 'SUCCESS' } });
    const verify = await http().get('/api/v1/audit/verify').set(as('admin')).expect(200);
    expect(verify.body).toMatchObject({ valid: false, brokenAtSequence: target.sequence });
  });
});
