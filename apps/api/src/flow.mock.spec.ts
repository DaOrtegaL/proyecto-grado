/**
 * Flujo extremo a extremo de la API sobre la base simulada (MOCK_DATABASE=1) con datos JSON reales.
 * Cubre el primer escenario funcional: inventario, vencimientos, alertas, responsables, auditoría,
 * panel de control y exportación de evidencia.
 */
import 'reflect-metadata';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findRepoRoot } from '@msh/mock-db';

const workDir = mkdtempSync(join(tmpdir(), 'msh-mock-'));
cpSync(join(findRepoRoot(), 'mock-database'), workDir, { recursive: true });
process.env.MOCK_DATABASE = '1';
process.env.MOCK_DATABASE_DIR = workDir;
process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
delete process.env.FIXED_NOW;

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from './app.module';
import { correlationMiddleware } from './common/correlation.middleware';

const PASSWORD = process.env.SEED_LAB_PASSWORD ?? 'Laboratorio_2026_Lab';

describe('Flujo del primer escenario funcional (base simulada)', () => {
  let app: INestApplication;
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const auth = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.use(correlationMiddleware as never);
    await app.init();
    for (const who of ['pki', 'auditor', 'consulta']) {
      const res = await http().post('/api/v1/auth/login').send({ email: `${who}@msh.lab`, password: PASSWORD }).expect(200);
      tokens[who] = res.body.accessToken;
    }
  });

  afterAll(async () => {
    await app.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  let terminals: { id: string; hostname: string }[] = [];
  const results: any[] = [];

  it('lista las tiendas y terminales sintéticas por país', async () => {
    const res = await http().get('/api/v1/terminals').set(auth('pki')).expect(200);
    terminals = res.body;
    expect(terminals).toHaveLength(54);
    expect(new Set(res.body.map((t: any) => t.country.code)).size).toBe(6);
    expect(res.body.every((t: any) => t.isSynthetic)).toBe(true);
  });

  it('ejecuta el inventario de todas las terminales y persiste certificados X.509', async () => {
    for (const t of terminals) {
      const res = await http().post(`/api/v1/terminals/${t.id}/inventory`).set(auth('pki')).expect(201);
      results.push(res.body);
    }
    const statuses = results.map((r) => r.status);
    expect(statuses).toContain('SUCCESS');
    expect(statuses).toContain('PARTIAL');
    expect(statuses).toContain('FAILED');
    expect(results.reduce((n, r) => n + r.alertsCreated, 0)).toBeGreaterThan(0);
  });

  it('el panel refleja vigentes, próximos a vencer, vencidos y alertas activas', async () => {
    const res = await http().get('/api/v1/dashboard').set(auth('consulta')).expect(200);
    const t = res.body.totals;
    expect(res.body.dataOrigin).toBe('SYNTHETIC');
    expect(t.terminals).toBe(54);
    expect(t.certificates).toBeGreaterThan(20);
    expect(t.valid).toBeGreaterThan(0);
    expect(t.expiringSoon).toBeGreaterThan(0);
    expect(t.expired).toBeGreaterThan(0);
    expect(t.activeAlerts).toBeGreaterThan(0);
  });

  it('genera alertas con responsable asignado por emisor y prioridad crítica para vencidos', async () => {
    const res = await http().get('/api/v1/alerts?pageSize=200').set(auth('pki')).expect(200);
    const items = res.body.items;
    expect(items.some((a: any) => a.priority === 'CRITICAL')).toBe(true);
    expect(items.some((a: any) => a.owner?.email === 'equipo.pki@msh.lab')).toBe(true);
    // El certificado autofirmado débil no tiene emisor registrado, por lo tanto no tiene responsable.
    const dashboard = await http().get('/api/v1/dashboard').set(auth('pki')).expect(200);
    expect(dashboard.body.totals.withoutOwner).toBeGreaterThan(0);
  });

  it('no duplica alertas al repetir el inventario (deduplicación)', async () => {
    const before = (await http().get('/api/v1/alerts?pageSize=200').set(auth('pki'))).body.total;
    const online = results.find((r) => r.status === 'SUCCESS')!;
    const again = await http().post(`/api/v1/terminals/${online.terminalId}/inventory`).set(auth('pki')).expect(201);
    expect(again.body.alertsCreated).toBe(0);
    expect(again.body.newCertificates).toBe(0);
    const after = (await http().get('/api/v1/alerts?pageSize=200').set(auth('pki'))).body.total;
    expect(after).toBe(before);
  });

  it('filtra y exporta el inventario de certificados (CSV seguro)', async () => {
    const list = await http().get('/api/v1/certificates?status=EXPIRED&pageSize=50').set(auth('pki')).expect(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    expect(list.body.items.every((c: any) => c.status === 'EXPIRED')).toBe(true);
    const csv = await http().get('/api/v1/certificates/export?status=EXPIRING_SOON').set(auth('pki')).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toMatch(/Huella SHA-256/);
    const detail = await http().get(`/api/v1/certificates/${list.body.items[0].id}`).set(auth('pki')).expect(200);
    expect(detail.body.installations.length).toBeGreaterThan(0);
    expect(detail.body.history.length).toBeGreaterThan(0);
  });

  it('exporta la evidencia de una ejecución en JSON, CSV y Markdown', async () => {
    const scanId = results.find((r) => r.status === 'SUCCESS')!.scanId;
    const json = await http().get(`/api/v1/inventory/scans/${scanId}/evidence?format=json`).set(auth('auditor')).expect(200);
    const evidence = JSON.parse(json.text);
    expect(evidence.dataOrigin).toBe('SINTÉTICO');
    expect(evidence.auditEvents.length).toBeGreaterThan(0);
    expect(evidence.auditChainVerification.valid).toBe(true);
    const md = await http().get(`/api/v1/inventory/scans/${scanId}/evidence?format=md`).set(auth('auditor')).expect(200);
    expect(md.text).toMatch(/# Evidencia de inventario/);
    await http().get(`/api/v1/inventory/scans/${scanId}/evidence?format=csv`).set(auth('auditor')).expect(200);
  });

  it('la cadena de auditoría es íntegra y registra las operaciones', async () => {
    const verify = await http().get('/api/v1/audit/verify').set(auth('auditor')).expect(200);
    expect(verify.body.valid).toBe(true);
    expect(verify.body.checked).toBeGreaterThan(54);
    const list = await http().get('/api/v1/audit?pageSize=200').set(auth('auditor')).expect(200);
    const actions = new Set(list.body.items.map((e: any) => e.action));
    expect(actions.has('inventory.run')).toBe(true);
    expect(actions.has('alert.create')).toBe(true);
  });

  it('impide al rol Consulta ejecutar inventario y deja evidencia de la denegación', async () => {
    await http().post(`/api/v1/terminals/${terminals[0].id}/inventory`).set(auth('consulta')).expect(403);
    const list = await http().get('/api/v1/audit?action=access.denied').set(auth('auditor')).expect(200);
    expect(list.body.total).toBeGreaterThan(0);
  });
});
