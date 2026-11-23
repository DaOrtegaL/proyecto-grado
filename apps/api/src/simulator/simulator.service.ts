import { Body, Controller, Get, HttpCode, Injectable, NotFoundException, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { buildAgentSigningInput, INVENTORY_REPORT_SCHEMA_VERSION } from '@msh/domain';
import { runScenarioSchema } from '@msh/validation';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActorsService } from '../common/actors.service';
import { Clock } from '../common/clock';
import { InventoryService } from '../inventory/inventory.service';
import { AgentGatewayService } from '../security/security.controller';
import { RenewalsService } from '../renewals/renewals.service';
import { DeploymentsService } from '../renewals/deployments.service';
import { OwnersService } from '../owners/owners.controller';
import { ResearchService } from '../research/research.service';
import { CorrelationId, CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthUser } from '../common/request-context';

export const SCENARIOS = [
  { code: 'S01', requirement: 'RF05', name: 'Certificado próximo a vencer en 60 días' },
  { code: 'S02', requirement: 'RF05', name: 'Certificado próximo a vencer en 7 días' },
  { code: 'S03', requirement: 'RF04', name: 'Certificado vencido' },
  { code: 'S04', requirement: 'RF01', name: 'Error durante el inventario' },
  { code: 'S05', requirement: 'RF03', name: 'Certificado sin responsable' },
  { code: 'S06', requirement: 'RF07', name: 'Renovación aprobada' },
  { code: 'S07', requirement: 'RF07', name: 'Renovación rechazada' },
  { code: 'S08', requirement: 'RF08', name: 'Instalación exitosa' },
  { code: 'S09', requirement: 'RF08', name: 'Instalación fallida' },
  { code: 'S10', requirement: 'RF08', name: 'Error en verificación' },
  { code: 'S11', requirement: 'RF09', name: 'Reversión exitosa' },
  { code: 'S12', requirement: 'RF09', name: 'Reversión fallida' },
  { code: 'S13', requirement: 'RNF02', name: 'Usuario sin permisos' },
  { code: 'S14', requirement: 'RF07', name: 'Aprobación invalidada' },
  { code: 'S15', requirement: 'RNF06', name: 'Ejecución duplicada' },
  { code: 'S16', requirement: 'RNF03', name: 'Identidad de agente incorrecta' },
] as const;

type ScenarioCode = (typeof SCENARIOS)[number]['code'];
interface Outcome { passed: boolean; obtained: string; expected: string; evidence: Record<string, unknown> }

const errorCode = (e: unknown): string => (e as { response?: { code?: string } })?.response?.code ?? (e instanceof Error ? e.name : 'ERROR');

/**
 * Simulador de laboratorio (Pantalla 13): ejecuta escenarios reproducibles sobre las terminales virtuales usando los
 * mismos servicios de negocio que la API y registra cada ejecución como evidencia experimental sintética.
 */
@Injectable()
export class SimulatorService {
  private used = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly actors: ActorsService,
    private readonly clock: Clock,
    private readonly inventory: InventoryService,
    private readonly renewals: RenewalsService,
    private readonly deployments: DeploymentsService,
    private readonly owners: OwnersService,
    private readonly gateway: AgentGatewayService,
    private readonly research: ResearchService,
  ) {}

  async list() {
    const runs = await this.prisma.experimentalRun.findMany({ where: { code: { startsWith: 'SIM-' } }, orderBy: { ranAt: 'desc' }, take: 300 });
    return SCENARIOS.map((s) => {
      const last = runs.find((r) => r.code.startsWith(`SIM-${s.code}-`));
      return { ...s, lastRun: last ? { id: last.id, code: last.code, status: last.status, ranAt: last.ranAt, obtainedResult: last.obtainedResult } : null };
    });
  }

  async runAll(actor: AuthUser, correlationId: string) {
    this.used = new Set();
    const results = [];
    for (const s of SCENARIOS) results.push(await this.run(s.code, actor, correlationId, true));
    return results;
  }

  async run(code: string, actor: AuthUser, correlationId: string, keepUsed = false) {
    const scenario = SCENARIOS.find((s) => s.code === code);
    if (!scenario) throw new NotFoundException({ code: 'SCENARIO_NOT_FOUND', message: 'El escenario no existe.' });
    if (!keepUsed) this.used = new Set();
    let outcome: Outcome;
    try {
      const fn = (this as any)[`scenario${scenario.code}`] as ((cid: string) => Promise<Outcome>) | undefined;
      outcome = fn ? await fn.call(this, correlationId) : { passed: false, obtained: 'No implementado', expected: '', evidence: {} };
    } catch (e) {
      outcome = { passed: false, obtained: `Error inesperado: ${e instanceof Error ? e.message : String(e)}`, expected: 'Escenario ejecutado sin errores', evidence: { errorCode: errorCode(e) } };
    }
    const stamp = this.clock.now().toISOString().replace(/\D/g, '').slice(0, 14);
    const runCode = `SIM-${scenario.code}-${stamp}-${randomUUID().slice(0, 4)}`;
    const run = await this.research.createRun(
      {
        code: runCode, objective: `Verificar el escenario ${scenario.code}: ${scenario.name}`, requirementCode: scenario.requirement,
        scenario: scenario.name, environment: 'Simulación (terminales virtuales)', sample: 'Terminales sintéticas del laboratorio',
        parameters: { seed: process.env.SEED_RANDOM_SEED ?? '20260101', clock: this.clock.now().toISOString() },
        expectedResult: outcome.expected, obtainedResult: outcome.obtained.slice(0, 500), metrics: {},
        status: outcome.passed ? 'PASSED' : 'FAILED', limitations: 'Datos y entorno sintéticos; no representan infraestructura productiva.', trlLevel: 3, isSynthetic: true,
      },
      actor, correlationId, [{ kind: 'JSON', description: 'Pasos y resultados del escenario', content: JSON.stringify(outcome.evidence) }],
    );
    return { scenario: scenario.code, name: scenario.name, status: run.status, runId: run.id, runCode, obtainedResult: outcome.obtained };
  }

  // ───────────── Utilidades de escenarios ─────────────

  private async terminalByScenario(prefix: string, opts: { renewable?: boolean } = {}) {
    const states = await this.prisma.simulatedTerminalState.findMany({ where: { scenario: { startsWith: prefix } }, include: { terminal: true } });
    const sorted = states.sort((a, b) => a.terminal.hostname.localeCompare(b.terminal.hostname));
    for (const s of sorted) {
      if (this.used.has(s.terminalId)) continue;
      if (opts.renewable) {
        if (s.failureMode !== 'NONE') continue;
        if (await this.prisma.renewalTarget.findFirst({ where: { terminalId: s.terminalId } })) continue;
      }
      this.used.add(s.terminalId);
      return s.terminal;
    }
    throw new Error(`No hay terminales sintéticas disponibles para "${prefix}". Regenere mock-database o la base de datos.`);
  }

  private async inventoryAs(terminalId: string, actor: AuthUser, cid: string) {
    return this.inventory.runInventory(terminalId, actor, cid);
  }

  private async clientCert(terminalId: string) {
    const inst = await this.prisma.certificateInstallation.findFirst({
      where: { terminalId, storeName: 'My', status: 'PRESENT', hasPrivateKey: true }, include: { certificate: true },
    });
    if (!inst) throw new Error('La terminal no tiene certificado de cliente inventariado.');
    return inst.certificate;
  }

  private async window() {
    const now = this.clock.now();
    const pki = await this.actors.byEmail('pki@msh.lab');
    return this.renewals.createWindow({ name: `Ventana de simulación ${now.toISOString()}`, startsAt: new Date(now.getTime() - 3_600_000).toISOString(), endsAt: new Date(now.getTime() + 4 * 3_600_000).toISOString() }, pki, randomUUID());
  }

  /** Recorre el flujo completo hasta el punto indicado con usuarios distintos por función. */
  private async flow(cid: string, until: 'APPROVED' | 'REJECTED' | 'SCHEDULED' | 'EXECUTED', failure = 'NONE', terminalPrefix = 'Vigente') {
    const retail = await this.actors.byEmail('retailit@msh.lab');
    const pki = await this.actors.byEmail('pki@msh.lab');
    const approver = await this.actors.byEmail('emisor@msh.lab');
    const executor = await this.actors.byEmail('soporte@msh.lab');
    const terminal = await this.terminalByScenario(terminalPrefix, { renewable: true });
    await this.inventoryAs(terminal.id, retail, cid);
    const cert = await this.clientCert(terminal.id);
    const renewal = await this.renewals.create({ certificateId: cert.id, terminalIds: [terminal.id], reason: 'Renovación de simulación' }, retail, cid);
    await this.renewals.requestIssuance(renewal.id, retail, cid);
    const issued = await this.renewals.issue(renewal.id, pki, cid);
    const win = await this.window();
    const approval = await this.renewals.requestApproval(renewal.id, { maintenanceWindowId: win.id, justification: 'Renovación preventiva de laboratorio' }, retail, cid);
    const ctx = { retail, pki, approver, executor, terminal, cert, renewalId: renewal.id, approvalId: approval.id, issuedThumbprint: issued.evidence.thumbprintSha256, windowId: win.id };
    if (until === 'REJECTED') {
      await this.renewals.decide(approval.id, { decision: 'REJECTED', justification: 'Rechazo de simulación' }, approver, cid);
      return ctx;
    }
    await this.renewals.decide(approval.id, { decision: 'APPROVED', justification: 'Aprobación de simulación' }, approver, cid);
    if (until === 'APPROVED') return ctx;
    const scheduler = failure === 'NONE' ? retail : pki;
    const job = await this.deployments.schedule({ approvalId: approval.id, scheduledAt: this.clock.now().toISOString(), idempotencyKey: `sim-${randomUUID()}`, simulateFailure: failure }, scheduler, cid);
    const full = { ...ctx, jobId: job.id };
    if (until === 'SCHEDULED') return full;
    const result = await this.deployments.execute(job.id, executor, cid);
    return { ...full, result };
  }

  private renewalStatus(id: string) {
    return this.prisma.renewalRequest.findUniqueOrThrow({ where: { id } }).then((r) => r.status);
  }

  // ───────────── Escenarios ─────────────

  private async alertScenario(prefix: string, threshold: number, cid: string, extra?: (terminalId: string) => Promise<Record<string, unknown>>): Promise<Outcome> {
    const retail = await this.actors.byEmail('retailit@msh.lab');
    const t = await this.terminalByScenario(prefix);
    await this.inventoryAs(t.id, retail, cid);
    const alert = await this.prisma.alert.findFirst({ where: { terminalId: t.id, thresholdDays: threshold } });
    const more = extra ? await extra(t.id) : {};
    return { passed: !!alert && (more.ok ?? true) !== false, expected: `Alerta con umbral ${threshold === 0 ? 'de vencido' : `${threshold} días`}`, obtained: alert ? `Alerta ${alert.priority} generada (umbral ${threshold})` : 'No se generó la alerta esperada', evidence: { terminal: t.hostname, alertId: alert?.id ?? null, ...more } };
  }

  async scenarioS01(cid: string) { return this.alertScenario('Próximo a vencer (60', 60, cid); }
  async scenarioS02(cid: string) { return this.alertScenario('Crítico', 7, cid); }
  async scenarioS03(cid: string) {
    return this.alertScenario('Vencido', 0, cid, async (terminalId) => {
      const f = await this.prisma.securityFinding.findFirst({ where: { terminalId, type: 'EXPIRED' } });
      return { ok: !!f, findingExpired: !!f };
    });
  }

  async scenarioS04(cid: string): Promise<Outcome> {
    const retail = await this.actors.byEmail('retailit@msh.lab');
    const t = await this.terminalByScenario('Terminal desconectada');
    const r = await this.inventoryAs(t.id, retail, cid);
    const terminal = await this.prisma.terminal.findUniqueOrThrow({ where: { id: t.id } });
    return { passed: r.status === 'FAILED' && terminal.status === 'OFFLINE', expected: 'Inventario fallido y terminal marcada sin conexión', obtained: `Inventario ${r.status}; terminal ${terminal.status}`, evidence: { terminal: t.hostname, scanId: r.scanId } };
  }

  async scenarioS05(cid: string): Promise<Outcome> {
    const retail = await this.actors.byEmail('retailit@msh.lab');
    const t = await this.terminalByScenario('Algoritmo débil');
    await this.inventoryAs(t.id, retail, cid);
    const findings = await this.prisma.securityFinding.findMany({ where: { terminalId: t.id } });
    const types = findings.map((f) => f.type);
    return { passed: types.includes('NO_OWNER') && types.includes('WEAK_ALGORITHM'), expected: 'Hallazgos NO_OWNER y WEAK_ALGORITHM', obtained: `Hallazgos: ${types.join(', ') || 'ninguno'}`, evidence: { terminal: t.hostname, types } };
  }

  async scenarioS06(cid: string): Promise<Outcome> {
    const c = await this.flow(cid, 'APPROVED');
    const status = await this.renewalStatus(c.renewalId);
    const decider = await this.prisma.approvalDecision.findFirst({ where: { approvalId: c.approvalId } });
    return { passed: status === 'APPROVED' && decider?.deciderId !== c.retail.id, expected: 'Renovación aprobada por un usuario distinto del solicitante', obtained: `Estado ${status}`, evidence: { renewalId: c.renewalId, approvalId: c.approvalId } };
  }

  async scenarioS07(cid: string): Promise<Outcome> {
    const c = await this.flow(cid, 'REJECTED');
    const status = await this.renewalStatus(c.renewalId);
    return { passed: status === 'REJECTED', expected: 'Renovación rechazada', obtained: `Estado ${status}`, evidence: { renewalId: c.renewalId } };
  }

  async scenarioS08(cid: string): Promise<Outcome> {
    const c = (await this.flow(cid, 'EXECUTED')) as Awaited<ReturnType<SimulatorService['flow']>> & { result: { status: string } };
    const status = await this.renewalStatus(c.renewalId);
    const verification = await this.prisma.verificationResult.findFirst({ where: { target: { job: { renewalId: c.renewalId } } } });
    return { passed: status === 'COMPLETED' && verification?.passed === true, expected: 'Instalación verificada y renovación completada', obtained: `Renovación ${status}; verificación ${verification?.passed ? 'correcta' : 'fallida'}`, evidence: { renewalId: c.renewalId, job: c.result } };
  }

  async scenarioS09(cid: string): Promise<Outcome> {
    const c = (await this.flow(cid, 'EXECUTED', 'INSTALL_FAILURE')) as any;
    const target = await this.prisma.deploymentTarget.findFirstOrThrow({ where: { job: { renewalId: c.renewalId } } });
    const status = await this.renewalStatus(c.renewalId);
    const attempt = await this.prisma.deploymentAttempt.findFirst({ where: { targetId: target.id } });
    return { passed: target.status === 'FAILED' && status === 'FAILED' && attempt?.outcome === 'FAILURE', expected: 'Intento fallido registrado y renovación no completada', obtained: `Destino ${target.status}; renovación ${status}`, evidence: { renewalId: c.renewalId } };
  }

  async scenarioS10(cid: string): Promise<Outcome> {
    const c = (await this.flow(cid, 'EXECUTED', 'VERIFICATION_FAILURE')) as any;
    const v = await this.prisma.verificationResult.findFirst({ where: { target: { job: { renewalId: c.renewalId } } } });
    const status = await this.renewalStatus(c.renewalId);
    return { passed: v?.passed === false && status === 'FAILED', expected: 'Verificación negativa sin marcar éxito', obtained: `Verificación ${v?.passed === false ? 'negativa' : 'inesperada'}; renovación ${status}`, evidence: { renewalId: c.renewalId, detail: v?.detail } };
  }

  async scenarioS11(cid: string): Promise<Outcome> {
    const c = (await this.flow(cid, 'EXECUTED', 'VERIFICATION_FAILURE')) as any;
    const target = await this.prisma.deploymentTarget.findFirstOrThrow({ where: { job: { renewalId: c.renewalId } } });
    const rb = await this.deployments.rollback(target.jobId, { targetId: target.id, reason: 'Reversión de simulación tras verificación fallida' }, c.retail, cid);
    const old = await this.prisma.certificateInstallation.findFirst({ where: { terminalId: c.terminal.id, certificateId: c.cert.id, status: 'PRESENT' } });
    const status = await this.renewalStatus(c.renewalId);
    return { passed: rb.outcome === 'SUCCESS' && !!old && status === 'ROLLED_BACK', expected: 'Estado anterior restaurado y renovación revertida', obtained: `Reversión ${rb.outcome}; certificado anterior ${old ? 'presente' : 'ausente'}; renovación ${status}`, evidence: { renewalId: c.renewalId, rollback: rb } };
  }

  async scenarioS12(cid: string): Promise<Outcome> {
    // ROLLBACK_FAILURE: la verificación falla y el posterior intento de reversión también falla.
    const c = (await this.flow(cid, 'EXECUTED', 'ROLLBACK_FAILURE')) as any;
    const target = await this.prisma.deploymentTarget.findFirstOrThrow({ where: { job: { renewalId: c.renewalId } } });
    let rb: { outcome: string; status: string };
    try {
      rb = await this.deployments.rollback(target.jobId, { targetId: target.id, reason: 'Reversión de simulación con falla de recuperación' }, c.retail, cid);
    } catch (e) {
      return { passed: false, expected: 'Reversión fallida registrada', obtained: `Error: ${errorCode(e)}`, evidence: { renewalId: c.renewalId } };
    }
    const op = await this.prisma.rollbackOperation.findFirst({ where: { targetId: target.id } });
    const status = await this.renewalStatus(c.renewalId);
    return { passed: rb.outcome === 'FAILURE' && op?.outcome === 'FAILURE' && status !== 'ROLLED_BACK', expected: 'Falla de reversión registrada sin marcar la renovación como revertida', obtained: `Reversión ${rb.outcome}; destino ${rb.status}; renovación ${status}`, evidence: { renewalId: c.renewalId } };
  }

  async scenarioS13(cid: string): Promise<Outcome> {
    const viewer = await this.actors.byEmail('consulta@msh.lab');
    const allowed = viewer.permissions.includes('renewals:create');
    await this.audit.recordSafely({ actorId: viewer.id, action: 'access.denied', resourceType: 'Endpoint', resourceId: 'POST /renewals', result: 'DENIED', reason: 'Simulación: permisos requeridos renewals:create', correlationId: cid });
    const ev = await this.prisma.auditEvent.findFirst({ where: { correlationId: cid, action: 'access.denied', actorId: viewer.id } });
    return { passed: !allowed && !!ev, expected: 'Usuario de consulta sin permiso de solicitud y evento de denegación', obtained: allowed ? 'El rol tiene el permiso (inesperado)' : 'Sin permiso; denegación auditada', evidence: { role: 'VIEWER', note: 'El bloqueo HTTP real se verifica en pruebas de integración.' } };
  }

  async scenarioS14(cid: string): Promise<Outcome> {
    const c = (await this.flow(cid, 'APPROVED')) as any;
    const owners = await this.prisma.certificateOwner.findMany();
    const current = (await this.prisma.certificate.findUniqueOrThrow({ where: { id: c.cert.id }, include: { policy: true, issuer: true } }));
    const effective = current.ownerId ?? current.policy?.ownerId ?? current.issuer?.ownerId ?? null;
    const other = owners.find((o) => o.id !== effective)!;
    await this.owners.assign({ scope: 'CERTIFICATE', targetId: c.cert.id, ownerId: other.id, reason: 'Cambio de responsable posterior a la aprobación' }, c.pki, cid);
    let code = 'SIN_ERROR';
    try {
      await this.deployments.schedule({ approvalId: c.approvalId, scheduledAt: this.clock.now().toISOString(), idempotencyKey: `sim-${randomUUID()}`, simulateFailure: 'NONE' }, c.retail, cid);
    } catch (e) {
      code = errorCode(e);
    }
    const approval = await this.prisma.approvalRequest.findUniqueOrThrow({ where: { id: c.approvalId } });
    return { passed: code === 'APPROVAL_INVALIDATED' && approval.status === 'INVALIDATED', expected: 'La aprobación se invalida al cambiar el responsable y se impide programar', obtained: `Programación: ${code}; aprobación ${approval.status}`, evidence: { renewalId: c.renewalId } };
  }

  async scenarioS15(cid: string): Promise<Outcome> {
    const c = (await this.flow(cid, 'EXECUTED')) as any;
    let code = 'SIN_ERROR';
    try {
      await this.deployments.execute(c.jobId, c.executor, cid);
    } catch (e) {
      code = errorCode(e);
    }
    const attempts = await this.prisma.deploymentAttempt.count({ where: { target: { jobId: c.jobId } } });
    return { passed: code === 'JOB_ALREADY_EXECUTED' && attempts === 1, expected: 'Segunda ejecución rechazada sin nuevos intentos', obtained: `Segunda ejecución: ${code}; intentos totales: ${attempts}`, evidence: { jobId: c.jobId } };
  }

  async scenarioS16(cid: string): Promise<Outcome> {
    const t = await this.terminalByScenario('Vigente');
    const other = await this.terminalByScenario('Vigente');
    const real = generateKeyPairSync('ed25519');
    const impostor = generateKeyPairSync('ed25519');
    const pem = real.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    let agent = await this.prisma.agentIdentity.findUnique({ where: { terminalId: t.id } });
    if (!agent) agent = await this.prisma.agentIdentity.create({ data: { terminalId: t.id, publicKeyPem: pem } });
    else agent = await this.prisma.agentIdentity.update({ where: { id: agent.id }, data: { publicKeyPem: pem, isActive: true } });
    const send = async (key: typeof real.privateKey, hostname: string) => {
      const body = JSON.stringify({ schemaVersion: INVENTORY_REPORT_SCHEMA_VERSION, source: 'POWERSHELL_AGENT', hostname, collectedAt: this.clock.now().toISOString(), certificates: [], errors: [] });
      const timestamp = this.clock.now().toISOString();
      const nonce = randomUUID();
      const signature = sign(null, buildAgentSigningInput(timestamp, nonce, body), key).toString('base64');
      try {
        await this.gateway.handle({ agentId: agent!.id, timestamp, nonce, signature, body }, cid);
        return 'ACEPTADO';
      } catch (e) {
        return errorCode(e);
      }
    };
    // La clave registrada pertenece a otro par: la firma del impostor debe fallar; un hostname ajeno también.
    const badSignature = await send(impostor.privateKey, t.hostname);
    const wrongTerminal = await send(real.privateKey, other.hostname);
    return { passed: badSignature === 'AGENT_SIGNATURE_INVALID' && wrongTerminal === 'AGENT_TERMINAL_MISMATCH', expected: 'Firma inválida y terminal ajena rechazadas', obtained: `Firma del impostor: ${badSignature}; terminal ajena: ${wrongTerminal}`, evidence: { agentId: agent.id } };
  }
}

@ApiTags('Simulador de laboratorio')
@ApiBearerAuth()
@Controller('simulator')
export class SimulatorController {
  constructor(private readonly simulator: SimulatorService) {}

  @Get('scenarios')
  @RequirePermissions('simulator:manage')
  list() {
    return this.simulator.list();
  }

  @Post('scenarios/run')
  @HttpCode(200)
  @RequirePermissions('simulator:manage')
  run(@Body(new ZodValidationPipe(runScenarioSchema)) body: ReturnType<typeof runScenarioSchema.parse>, @CurrentUser() user: AuthUser, @CorrelationId() correlationId: string) {
    return this.simulator.run(body.code, user, correlationId);
  }

  @Post('scenarios/run-all')
  @HttpCode(200)
  @RequirePermissions('simulator:manage')
  runAll(@CurrentUser() user: AuthUser, @CorrelationId() correlationId: string) {
    return this.simulator.runAll(user, correlationId);
  }
}
