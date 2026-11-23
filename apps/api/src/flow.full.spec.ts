/**
 * Escenario final de aceptación (sección 29) sobre la base simulada: renovación exitosa, falla con reversión,
 * separación de funciones, agentes, indicadores, trazabilidad y los 16 escenarios del simulador.
 */
import 'reflect-metadata';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findRepoRoot } from '@msh/mock-db';

const workDir = mkdtempSync(join(tmpdir(), 'msh-full-'));
cpSync(join(findRepoRoot(), 'mock-database'), workDir, { recursive: true });
process.env.MOCK_DATABASE = '1';
process.env.MOCK_DATABASE_DIR = workDir;
process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
delete process.env.FIXED_NOW;

import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { buildAgentSigningInput } from '@msh/domain';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { correlationMiddleware } from './common/correlation.middleware';

const PASSWORD = process.env.SEED_LAB_PASSWORD ?? 'Laboratorio_2026_Lab';
const USERS = ['admin', 'pki', 'emisor', 'retailit', 'soporte', 'auditor', 'consulta'] as const;

describe('Escenario final de aceptación (base simulada)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: (typeof USERS)[number]) => ({ Authorization: `Bearer ${tokens[who]}` });
  const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.use(correlationMiddleware as never);
    await app.init();
    prisma = app.get(PrismaService);
    for (const who of USERS) {
      const res = await http().post('/api/v1/auth/login').send({ email: `${who}@msh.lab`, password: PASSWORD }).expect(200);
      tokens[who] = res.body.accessToken;
    }
  });

  afterAll(async () => {
    await app.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  /** Devuelve una terminal sintética vigente sin renovaciones, inventariada por el usuario indicado. */
  async function freshTerminal() {
    const states = await prisma.simulatedTerminalState.findMany({ where: { scenario: { startsWith: 'Vigente' } }, include: { terminal: true } });
    for (const s of states.sort((a, b) => a.terminal.hostname.localeCompare(b.terminal.hostname))) {
      if (s.failureMode !== 'NONE' || taken.has(s.terminalId)) continue;
      if (await prisma.renewalTarget.findFirst({ where: { terminalId: s.terminalId } })) continue;
      taken.add(s.terminalId);
      await http().post(`/api/v1/terminals/${s.terminalId}/inventory`).set(as('retailit')).expect(201);
      const cert = await prisma.certificateInstallation.findFirstOrThrow({ where: { terminalId: s.terminalId, storeName: 'My', status: 'PRESENT' }, include: { certificate: true } });
      return { terminal: s.terminal, cert: cert.certificate };
    }
    throw new Error('Sin terminales disponibles');
  }
  const taken = new Set<string>();

  async function windowId() {
    const res = await http().post('/api/v1/maintenance-windows').set(as('pki')).send({ name: 'Ventana de prueba', startsAt: iso(-3_600_000), endsAt: iso(4 * 3_600_000) }).expect(201);
    return res.body.id as string;
  }

  async function approvedRenewal(simulateFailure = 'NONE') {
    const { terminal, cert } = await freshTerminal();
    const created = await http().post('/api/v1/renewals').set(as('retailit')).send({ certificateId: cert.id, terminalIds: [terminal.id], reason: 'Renovación de prueba' }).expect(201);
    const id = created.body.id as string;
    await http().post(`/api/v1/renewals/${id}/request-issuance`).set(as('retailit')).expect(200);
    const issued = await http().post(`/api/v1/renewals/${id}/issue`).set(as('pki')).expect(200);
    const win = await windowId();
    const approval = await http().post(`/api/v1/renewals/${id}/request-approval`).set(as('retailit')).send({ maintenanceWindowId: win, justification: 'Renovación preventiva de prueba' }).expect(200);
    await http().post(`/api/v1/approvals/${approval.body.id}/decision`).set(as('emisor')).send({ decision: 'APPROVED', justification: 'Aprobada tras revisión' }).expect(200);
    const key = `test-${randomUUID()}`;
    const sched = await http().post('/api/v1/deployments').set(as(simulateFailure === 'NONE' ? 'retailit' : 'admin')).send({ approvalId: approval.body.id, scheduledAt: iso(), idempotencyKey: key, simulateFailure }).expect(201);
    return { id, terminal, cert, issued: issued.body, approvalId: approval.body.id as string, jobId: sched.body.id as string, windowId: win, key };
  }

  describe('Recorrido exitoso (pasos 1 a 16 de la sección 29)', () => {
    let ctx: Awaited<ReturnType<typeof approvedRenewal>>;
    let baselineId: string;

    it('crea una línea base de indicadores antes de operar', async () => {
      const res = await http().post('/api/v1/metrics/snapshots').set(as('admin')).send({ kind: 'BASELINE', label: 'Línea base de prueba', periodStart: iso(-365 * 86_400_000), periodEnd: iso(60_000) }).expect(201);
      baselineId = res.body.id;
      expect(res.body.isSynthetic).toBe(true);
    });

    it('inventaría, renueva con evidencia de emisión, aprueba otro usuario y programa', async () => {
      ctx = await approvedRenewal();
      expect(ctx.issued.evidence.thumbprintSha256).toMatch(/^[A-F0-9]{64}$/);
      expect(ctx.issued.evidence.note).toMatch(/simulada/);
      const detail = await http().get(`/api/v1/renewals/${ctx.id}`).set(as('retailit')).expect(200);
      expect(detail.body.status).toBe('SCHEDULED');
      expect(detail.body.approvals[0].decisions[0].deciderId).not.toBe(detail.body.requestedById);
    });

    it('ejecuta la instalación simulada, verifica y completa la renovación', async () => {
      const exec = await http().post(`/api/v1/deployments/${ctx.jobId}/execute`).set(as('soporte')).expect(200);
      expect(exec.body).toMatchObject({ status: 'COMPLETED', verified: 1, total: 1 });
      const detail = await http().get(`/api/v1/renewals/${ctx.id}`).set(as('retailit')).expect(200);
      expect(detail.body.status).toBe('COMPLETED');
      expect(detail.body.jobs[0].targets[0].verifications[0].passed).toBe(true);
      const installs = await prisma.certificateInstallation.findMany({ where: { terminalId: ctx.terminal.id, storeName: 'My' }, include: { certificate: true } });
      expect(installs.find((i) => i.status === 'PRESENT')?.certificate.thumbprintSha256).toBe(ctx.issued.evidence.thumbprintSha256);
      expect(installs.find((i) => i.certificateId === ctx.cert.id)?.status).toBe('MISSING');
    });

    it('registra la línea de tiempo completa en la auditoría y la cadena sigue íntegra', async () => {
      const detail = await http().get(`/api/v1/renewals/${ctx.id}`).set(as('auditor')).expect(200);
      const actions = detail.body.timeline.map((t: any) => t.action);
      expect(actions).toEqual(expect.arrayContaining(['renewal.create', 'renewal.issue', 'approval.decision', 'renewal.schedule', 'renewal.completed']));
      const verify = await http().get('/api/v1/audit/verify').set(as('auditor')).expect(200);
      expect(verify.body.valid).toBe(true);
    });

    it('calcula indicadores reales, crea el piloto y compara sin atribuir causalidad', async () => {
      const current = await http().get('/api/v1/metrics/current').set(as('auditor')).expect(200);
      const byCode = Object.fromEntries(current.body.metrics.map((m: any) => [m.code, m]));
      expect(byCode.INSTALL_SUCCESS_RATE.value).toBe(100);
      expect(byCode.DEPLOYMENT_ERROR_RATE.value).toBe(0);
      expect(byCode.INVENTORY_COVERAGE.value).toBeGreaterThan(0);
      expect(byCode.AUDIT_COMPLETENESS.value).toBe(100);
      expect(byCode.RENEWAL_TIME.sampleSize).toBe(1);

      const pilot = await http().post('/api/v1/metrics/snapshots').set(as('admin')).send({ kind: 'PILOT', label: 'Piloto de prueba', periodStart: iso(-365 * 86_400_000), periodEnd: iso(60_000) }).expect(201);
      const cmp = await http().get(`/api/v1/metrics/comparison?baselineId=${baselineId}&pilotId=${pilot.body.id}`).set(as('auditor')).expect(200);
      expect(cmp.body.rows).toHaveLength(9);
      expect(cmp.body.rows[0].limitations.join(' ')).toMatch(/no se atribuye causalidad/);
      expect(cmp.body.statisticalNote).toMatch(/no declara significancia/);
      const row = cmp.body.rows.find((r: any) => r.metricCode === 'INSTALL_SUCCESS_RATE');
      expect(row.pilot).toBe(100);
      expect(row.baseline).toBeNull();
      const csv = await http().get(`/api/v1/metrics/comparison/export?baselineId=${baselineId}&pilotId=${pilot.body.id}`).set(as('auditor')).expect(200);
      expect(csv.text).toMatch(/Línea base/);
    });
  });

  describe('Recorrido con falla y reversión', () => {
    it('solo quien tiene simulator:manage puede inyectar fallas', async () => {
      const { terminal, cert } = await freshTerminal();
      const created = await http().post('/api/v1/renewals').set(as('retailit')).send({ certificateId: cert.id, terminalIds: [terminal.id] }).expect(201);
      await http().post(`/api/v1/renewals/${created.body.id}/request-issuance`).set(as('retailit')).expect(200);
      await http().post(`/api/v1/renewals/${created.body.id}/issue`).set(as('pki')).expect(200);
      const win = await windowId();
      const approval = await http().post(`/api/v1/renewals/${created.body.id}/request-approval`).set(as('retailit')).send({ maintenanceWindowId: win, justification: 'Prueba de inyección de fallas' }).expect(200);
      await http().post(`/api/v1/approvals/${approval.body.id}/decision`).set(as('emisor')).send({ decision: 'APPROVED', justification: 'Aprobada' }).expect(200);
      await http().post('/api/v1/deployments').set(as('retailit')).send({ approvalId: approval.body.id, scheduledAt: iso(), idempotencyKey: `x-${randomUUID()}`, simulateFailure: 'VERIFICATION_FAILURE' }).expect(403);
    });

    it('falla la verificación, no marca éxito y la reversión restaura el estado anterior', async () => {
      const ctx = await approvedRenewal('VERIFICATION_FAILURE');
      const exec = await http().post(`/api/v1/deployments/${ctx.jobId}/execute`).set(as('soporte')).expect(200);
      expect(exec.body.status).toBe('FAILED');
      expect((await http().get(`/api/v1/renewals/${ctx.id}`).set(as('retailit'))).body.status).toBe('FAILED');

      const job = (await http().get('/api/v1/deployments').set(as('retailit'))).body.find((j: any) => j.id === ctx.jobId);
      const rb = await http().post(`/api/v1/deployments/${ctx.jobId}/rollback`).set(as('soporte')).send({ targetId: job.targets[0].id, reason: 'Verificación negativa' }).expect(200);
      expect(rb.body).toMatchObject({ outcome: 'SUCCESS', status: 'ROLLED_BACK' });
      const detail = await http().get(`/api/v1/renewals/${ctx.id}`).set(as('auditor')).expect(200);
      expect(detail.body.status).toBe('ROLLED_BACK');
      const old = await prisma.certificateInstallation.findFirst({ where: { terminalId: ctx.terminal.id, certificateId: ctx.cert.id, status: 'PRESENT' } });
      expect(old).not.toBeNull();
      expect(detail.body.timeline.map((t: any) => t.action)).toContain('rollback.execute');
    });

    it('una segunda ejecución del mismo trabajo se rechaza y se audita', async () => {
      const ctx = await approvedRenewal();
      await http().post(`/api/v1/deployments/${ctx.jobId}/execute`).set(as('soporte')).expect(200);
      const again = await http().post(`/api/v1/deployments/${ctx.jobId}/execute`).set(as('soporte')).expect(409);
      expect(again.body.code).toBe('JOB_ALREADY_EXECUTED');
    });

    it('la programación es idempotente por clave', async () => {
      const ctx = await approvedRenewal();
      const again = await http().post('/api/v1/deployments').set(as('retailit')).send({ approvalId: ctx.approvalId, scheduledAt: iso(), idempotencyKey: ctx.key, simulateFailure: 'NONE' }).expect(201);
      expect(again.body).toMatchObject({ id: ctx.jobId, idempotent: true });
      const other = await http().post('/api/v1/deployments').set(as('retailit')).send({ approvalId: ctx.approvalId, scheduledAt: iso(), idempotencyKey: `otra-${randomUUID()}`, simulateFailure: 'NONE' }).expect(409);
      expect(other.body.code).toBe('ALREADY_SCHEDULED');
    });
  });

  describe('Separación de funciones y aprobaciones', () => {
    it('impide la autoaprobación aunque el usuario tenga ambos permisos', async () => {
      const { terminal, cert } = await freshTerminal();
      const created = await http().post('/api/v1/renewals').set(as('pki')).send({ certificateId: cert.id, terminalIds: [terminal.id] }).expect(201);
      await http().post(`/api/v1/renewals/${created.body.id}/request-issuance`).set(as('pki')).expect(200);
      await http().post(`/api/v1/renewals/${created.body.id}/issue`).set(as('pki')).expect(200);
      const win = await windowId();
      const approval = await http().post(`/api/v1/renewals/${created.body.id}/request-approval`).set(as('pki')).send({ maintenanceWindowId: win, justification: 'Intento de autoaprobación' }).expect(200);
      const res = await http().post(`/api/v1/approvals/${approval.body.id}/decision`).set(as('pki')).send({ decision: 'APPROVED', justification: 'Me autoapruebo' }).expect(403);
      expect(res.body.code).toBe('SELF_APPROVAL_FORBIDDEN');
      const denied = await http().get('/api/v1/audit?action=approval.decide').set(as('auditor')).expect(200);
      expect(denied.body.items.some((e: any) => e.result === 'DENIED')).toBe(true);
    });

    it('una transición inválida se bloquea y no se emite sin evidencia', async () => {
      const { terminal, cert } = await freshTerminal();
      const created = await http().post('/api/v1/renewals').set(as('retailit')).send({ certificateId: cert.id, terminalIds: [terminal.id] }).expect(201);
      const res = await http().post(`/api/v1/renewals/${created.body.id}/issue`).set(as('pki')).expect(409);
      expect(res.body.code).toBe('INVALID_TRANSITION');
      const dup = await http().post('/api/v1/renewals').set(as('retailit')).send({ certificateId: cert.id, terminalIds: [terminal.id] }).expect(409);
      expect(dup.body.code).toBe('RENEWAL_ALREADY_ACTIVE');
    });

    it('cambiar los destinos o el responsable invalida la aprobación', async () => {
      const ctx = await approvedRenewal();
      const owners = (await http().get('/api/v1/owners').set(as('pki'))).body.owners;
      const current = (await http().get(`/api/v1/certificates/${ctx.cert.id}`).set(as('pki'))).body.effectiveOwner;
      const different = owners.find((o: any) => o.id !== current?.id);
      await http().post('/api/v1/owners/assign').set(as('pki')).send({ scope: 'CERTIFICATE', targetId: ctx.cert.id, ownerId: different.id }).expect(200);
      const detail = await http().get(`/api/v1/renewals/${ctx.id}`).set(as('retailit'));
      // El trabajo ya está programado: al ejecutar se detecta el cambio y se cancela.
      const res = await http().post(`/api/v1/deployments/${ctx.jobId}/execute`).set(as('soporte')).expect(409);
      expect(res.body.code).toBe('APPROVAL_INVALID');
      expect(detail.body.status).toBe('SCHEDULED');
      const after = await http().get(`/api/v1/renewals/${ctx.id}`).set(as('retailit'));
      expect(after.body.status).toBe('ISSUED');
    });

    it('rechaza la instalación fuera de la ventana de mantenimiento', async () => {
      const { terminal, cert } = await freshTerminal();
      const created = await http().post('/api/v1/renewals').set(as('retailit')).send({ certificateId: cert.id, terminalIds: [terminal.id] }).expect(201);
      await http().post(`/api/v1/renewals/${created.body.id}/request-issuance`).set(as('retailit')).expect(200);
      await http().post(`/api/v1/renewals/${created.body.id}/issue`).set(as('pki')).expect(200);
      const win = await windowId();
      const approval = await http().post(`/api/v1/renewals/${created.body.id}/request-approval`).set(as('retailit')).send({ maintenanceWindowId: win, justification: 'Prueba de ventana' }).expect(200);
      await http().post(`/api/v1/approvals/${approval.body.id}/decision`).set(as('emisor')).send({ decision: 'APPROVED', justification: 'Aprobada' }).expect(200);
      const res = await http().post('/api/v1/deployments').set(as('retailit')).send({ approvalId: approval.body.id, scheduledAt: iso(10 * 3_600_000), idempotencyKey: `w-${randomUUID()}`, simulateFailure: 'NONE' }).expect(400);
      expect(res.body.code).toBe('OUTSIDE_MAINTENANCE_WINDOW');
    });
  });

  describe('Anomalías y responsables', () => {
    it('detecta hallazgos configurables y permite resolverlos con motivo', async () => {
      const states = await prisma.simulatedTerminalState.findMany({ where: { scenario: { startsWith: 'Algoritmo débil' } } });
      await http().post(`/api/v1/terminals/${states[0].terminalId}/inventory`).set(as('retailit')).expect(201);
      const list = await http().get('/api/v1/security/findings?status=OPEN').set(as('consulta')).expect(200);
      const types = list.body.items.map((f: any) => f.type);
      expect(types).toEqual(expect.arrayContaining(['WEAK_ALGORITHM', 'NO_OWNER']));
      expect(list.body.items.every((f: any) => f.recommendation.length > 10)).toBe(true);
      await http().post(`/api/v1/security/findings/${list.body.items[0].id}/dismiss`).set(as('consulta')).send({ reason: 'No debería permitirse' }).expect(403);
      await http().post(`/api/v1/security/findings/${list.body.items[0].id}/dismiss`).set(as('pki')).send({ reason: 'Falso positivo confirmado en laboratorio' }).expect(200);
    });

    it('aplica la precedencia certificado > política > emisor y audita la asignación', async () => {
      const ov = await http().get('/api/v1/owners').set(as('pki')).expect(200);
      expect(ov.body.precedence).toEqual(['CERTIFICATE', 'POLICY', 'ISSUER']);
      const cert = await prisma.certificate.findFirstOrThrow({ where: { ownerId: null } });
      const issuerOwner = (await http().get(`/api/v1/certificates/${cert.id}`).set(as('pki'))).body;
      expect(['ISSUER', 'POLICY', null]).toContain(issuerOwner.ownerSource);
      const owner = ov.body.owners.find((o: any) => o.id !== issuerOwner.effectiveOwner?.id);
      await http().post('/api/v1/owners/assign').set(as('pki')).send({ scope: 'CERTIFICATE', targetId: cert.id, ownerId: owner.id, reason: 'Responsable específico' }).expect(200);
      const after = (await http().get(`/api/v1/certificates/${cert.id}`).set(as('pki'))).body;
      expect(after.ownerSource).toBe('CERTIFICATE');
      expect(after.effectiveOwner.id).toBe(owner.id);
      await http().post('/api/v1/owners/assign').set(as('consulta')).send({ scope: 'CERTIFICATE', targetId: cert.id, ownerId: null }).expect(403);
    });

    it('el barrido de monitoreo es idempotente', async () => {
      const first = await http().post('/api/v1/monitoring/sweep').set(as('pki')).expect(200);
      const second = await http().post('/api/v1/monitoring/sweep').set(as('pki')).expect(200);
      expect(first.body.skipped).toBe(false);
      expect(second.body.alertsCreated).toBe(0);
    });
  });

  describe('Seguridad de agentes (sección 11.3)', () => {
    it('acepta reportes firmados, rechaza reenvíos, firmas ajenas, marcas de tiempo y terminales distintas', async () => {
      const { terminal } = await freshTerminal();
      const other = await freshTerminal();
      const real = generateKeyPairSync('ed25519');
      const impostor = generateKeyPairSync('ed25519');
      const pem = real.publicKey.export({ type: 'spki', format: 'pem' }).toString();
      const reg = await http().post('/api/v1/agents').set(as('pki')).send({ terminalId: terminal.id, publicKeyPem: pem }).expect(201);
      await http().post('/api/v1/agents').set(as('pki')).send({ terminalId: terminal.id, publicKeyPem: pem }).expect(409);

      const report = (hostname: string) => JSON.stringify({ schemaVersion: '1.0', source: 'POWERSHELL_AGENT', hostname, collectedAt: iso(), certificates: [], errors: [] });
      const send = (body: string, key = real.privateKey, over: Partial<{ timestamp: string; nonce: string; agent: string }> = {}) => {
        const timestamp = over.timestamp ?? iso();
        const nonce = over.nonce ?? randomUUID();
        const signature = sign(null, buildAgentSigningInput(timestamp, nonce, body), key).toString('base64');
        return http().post('/api/v1/agent/v1/inventory').set('Content-Type', 'application/json').set({ 'x-agent-id': over.agent ?? reg.body.id, 'x-timestamp': timestamp, 'x-nonce': nonce, 'x-signature': signature }).send(body);
      };

      const nonce = randomUUID();
      const ok = await send(report(terminal.hostname), real.privateKey, { nonce }).expect(201);
      expect(ok.body.status).toMatch(/SUCCESS|PARTIAL/);
      const replay = await send(report(terminal.hostname), real.privateKey, { nonce }).expect(409);
      expect(replay.body.code).toBe('AGENT_REPLAY_DETECTED');
      expect((await send(report(terminal.hostname), impostor.privateKey).expect(401)).body.code).toBe('AGENT_SIGNATURE_INVALID');
      expect((await send(report(terminal.hostname), real.privateKey, { timestamp: iso(-3_600_000) }).expect(401)).body.code).toBe('AGENT_TIMESTAMP_INVALID');
      expect((await send(report(other.terminal.hostname)).expect(403)).body.code).toBe('AGENT_TERMINAL_MISMATCH');
      expect((await send(report(terminal.hostname), real.privateKey, { agent: randomUUID() }).expect(401)).body.code).toBe('AGENT_IDENTITY_INVALID');

      await http().post(`/api/v1/agents/${reg.body.id}/deactivate`).set(as('pki')).expect(200);
      expect((await send(report(terminal.hostname)).expect(401)).body.code).toBe('AGENT_IDENTITY_INVALID');
    });
  });

  describe('Investigación: SUS, trazabilidad y evidencia', () => {
    it('puntúa el SUS con el procedimiento oficial', async () => {
      const q = await http().get('/api/v1/sus/questions').set(as('consulta')).expect(200);
      expect(q.body.questions).toHaveLength(10);
      await http().post('/api/v1/sus').set(as('consulta')).send({ respondentRole: 'Consulta', answers: [5, 1, 5, 1, 5, 1, 5, 1, 5, 1] }).expect(201);
      await http().post('/api/v1/sus').set(as('consulta')).send({ respondentRole: 'Consulta', answers: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3] }).expect(201);
      await http().post('/api/v1/sus').set(as('consulta')).send({ respondentRole: 'Consulta', answers: [1, 2] }).expect(400);
      const results = await http().get('/api/v1/sus/results').set(as('auditor')).expect(200);
      expect(results.body.mean).toBe(75);
    });

    it('un requisito no puede validarse sin una ejecución experimental aprobada que lo respalde', async () => {
      const denied = await http().put('/api/v1/traceability/RF01').set(as('admin')).send({ status: 'VALIDATED' }).expect(409);
      expect(denied.body.code).toBe('EVIDENCE_REQUIRED');
      const run = await http().post('/api/v1/research/runs').set(as('admin')).send({
        code: `EXP-RF01-${Date.now()}`, objective: 'Verificar inventario automatizado', requirementCode: 'RF01', scenario: 'Inventario en terminal virtual',
        environment: 'Simulación', sample: '1 terminal sintética', parameters: { seed: 1 }, expectedResult: 'Reporte válido', obtainedResult: 'Reporte válido',
        metrics: { certificates: 2 }, status: 'PASSED', limitations: 'Datos sintéticos', trlLevel: 3, isSynthetic: true,
      }).expect(201);
      await http().put('/api/v1/traceability/RF01').set(as('admin')).send({ status: 'VALIDATED', evidenceRunId: run.body.id }).expect(200);
      await http().put('/api/v1/traceability/RF02').set(as('admin')).send({ status: 'VALIDATED', evidenceRunId: run.body.id }).expect(409);
      for (const f of ['json', 'csv', 'md']) await http().get(`/api/v1/research/runs/${run.body.id}/export?format=${f}`).set(as('auditor')).expect(200);
      const trl = await http().get('/api/v1/research/trl').set(as('auditor')).expect(200);
      expect(trl.body.statement).toMatch(/no se declara/);
    });
  });

  describe('Simulador de laboratorio (16 escenarios)', () => {
    it('ejecuta todos los escenarios y registra la evidencia experimental', async () => {
      const res = await http().post('/api/v1/simulator/scenarios/run-all').set(as('pki')).expect(200);
      const failed = res.body.filter((r: any) => r.status !== 'PASSED').map((r: any) => `${r.scenario}: ${r.obtainedResult}`);
      expect(failed).toEqual([]);
      expect(res.body).toHaveLength(16);
      const list = await http().get('/api/v1/simulator/scenarios').set(as('pki')).expect(200);
      expect(list.body.every((s: any) => s.lastRun?.status === 'PASSED')).toBe(true);
    });

    it('niega el simulador a roles sin permiso', async () => {
      await http().get('/api/v1/simulator/scenarios').set(as('consulta')).expect(403);
    });
  });

  it('la auditoría permanece íntegra al finalizar todo el recorrido', async () => {
    const verify = await http().get('/api/v1/audit/verify').set(as('auditor')).expect(200);
    expect(verify.body.valid).toBe(true);
    expect(verify.body.checked).toBeGreaterThan(200);
  });
});
