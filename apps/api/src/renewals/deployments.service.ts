import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalParameters, DeploymentExecutionAdapter, SlotSnapshot, TerminalRef, computeApprovalHash } from '@msh/domain';
import { describeCertificate } from '@msh/simulated-pos';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { loadEnv } from '../config/env';
import { InventoryService } from '../inventory/inventory.service';
import { RenewalsService } from '../renewals/renewals.service';
import type { AuthUser } from '../common/request-context';

/** Ejecutor simulado: modifica únicamente las terminales virtuales (certificados públicos en PEM). */
class SimulatedDeploymentExecutor implements DeploymentExecutionAdapter {
  readonly name = 'SimulatedDeploymentExecutor';
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(terminal: TerminalRef): Promise<SlotSnapshot[]> {
    const slots = await this.prisma.simulatedCertificateSlot.findMany({ where: { terminalId: terminal.id } });
    return slots.map((s) => ({ pem: s.pem, storeLocation: s.storeLocation, storeName: s.storeName, hasPrivateKey: s.hasPrivateKey }));
  }

  async install(terminal: TerminalRef, newCertificatePem: string, replaceThumbprintSha256: string): Promise<void> {
    const slots = await this.prisma.simulatedCertificateSlot.findMany({ where: { terminalId: terminal.id, storeName: 'My' } });
    for (const slot of slots) {
      const meta = await describeCertificate(slot.pem, slot);
      if (meta.thumbprintSha256 === replaceThumbprintSha256) {
        await this.prisma.simulatedCertificateSlot.deleteMany({ where: { id: slot.id } });
      }
    }
    await this.prisma.simulatedCertificateSlot.create({
      // La clave privada se aprovisiona por un canal externo; aquí solo se registra su existencia.
      data: { terminalId: terminal.id, pem: newCertificatePem, storeLocation: 'LocalMachine', storeName: 'My', hasPrivateKey: true },
    });
  }

  async restore(terminal: TerminalRef, snapshot: SlotSnapshot[]): Promise<void> {
    await this.prisma.simulatedCertificateSlot.deleteMany({ where: { terminalId: terminal.id } });
    for (const s of snapshot) await this.prisma.simulatedCertificateSlot.create({ data: { ...s, terminalId: terminal.id } });
  }
}

const STALE_RUNNING_MINUTES = 15;

/** Programación, ejecución, verificación, reversión y conciliación de instalaciones (RF08, RF09). */
@Injectable()
export class DeploymentsService {
  private readonly executor: SimulatedDeploymentExecutor;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly renewals: RenewalsService,
    private readonly inventory: InventoryService,
  ) {
    this.executor = new SimulatedDeploymentExecutor(prisma);
  }

  private async deny(actor: AuthUser, action: string, resourceId: string, status: 403 | 409, code: string, message: string, reason: string, correlationId: string, approvalId?: string): Promise<never> {
    await this.audit.recordSafely({ actorId: actor.id, action, resourceType: 'DeploymentJob', resourceId, result: 'DENIED', reason, correlationId, approvalId: approvalId ?? null });
    const payload = { code, message };
    throw status === 403 ? new ForbiddenException(payload) : new ConflictException(payload);
  }

  // ───────────── Consultas ─────────────

  async list() {
    const jobs = await this.prisma.deploymentJob.findMany({
      orderBy: { createdAt: 'desc' }, take: 100,
      include: {
        renewal: { include: { certificate: { select: { subject: true } } } },
        maintenanceWindow: { select: { name: true, startsAt: true, endsAt: true } },
        targets: { include: { terminal: { select: { hostname: true } }, attempts: true, verifications: true, rollbacks: true } },
      },
    });
    return jobs.map((j) => ({
      id: j.id, status: j.status, mode: j.mode, scheduledAt: j.scheduledAt, startedAt: j.startedAt, finishedAt: j.finishedAt,
      simulateFailure: j.simulateFailure, renewalId: j.renewalId, renewalStatus: j.renewal.status, certificate: j.renewal.certificate.subject,
      maintenanceWindow: j.maintenanceWindow,
      targets: j.targets.map((t) => ({
        id: t.id, hostname: t.terminal.hostname, status: t.status,
        attempts: t.attempts.map((a) => ({ attemptNo: a.attemptNo, outcome: a.outcome, errorMessage: a.errorMessage })),
        verifications: t.verifications.map((v) => ({ passed: v.passed, detail: v.detail })),
        rollbacks: t.rollbacks.map((r) => ({ outcome: r.outcome, reason: r.reason, executedAt: r.executedAt })),
      })),
    }));
  }

  // ───────────── Programación ─────────────

  async schedule(dto: { approvalId: string; scheduledAt: string; idempotencyKey: string; simulateFailure: string }, actor: AuthUser, correlationId: string) {
    const existing = await this.prisma.deploymentJob.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (existing) return { id: existing.id, status: existing.status, idempotent: true };

    if (dto.simulateFailure !== 'NONE' && !actor.permissions.includes('simulator:manage')) {
      return this.deny(actor, 'deployment.schedule', dto.approvalId, 403, 'FORBIDDEN', 'No tiene permisos para inyectar fallas de simulación.', 'Intento de inyectar fallas sin permiso simulator:manage', correlationId);
    }
    const approval = await this.prisma.approvalRequest.findUnique({ where: { id: dto.approvalId }, include: { renewal: true, maintenanceWindow: true } });
    if (!approval) throw new NotFoundException({ code: 'APPROVAL_NOT_FOUND', message: 'La solicitud de aprobación no existe.' });
    if (approval.status !== 'APPROVED') {
      return this.deny(actor, 'deployment.schedule', approval.renewalId, 409, 'APPROVAL_NOT_APPROVED', 'La instalación requiere una aprobación vigente.', `Aprobación en estado ${approval.status}`, correlationId, approval.id);
    }
    const now = this.clock.now();
    if (approval.expiresAt <= now) {
      return this.deny(actor, 'deployment.schedule', approval.renewalId, 409, 'APPROVAL_EXPIRED', 'La aprobación venció.', 'Aprobación vencida', correlationId, approval.id);
    }
    const params: ApprovalParameters = await this.renewals.approvalParameters(this.prisma, approval.renewalId, approval.maintenanceWindowId);
    if (computeApprovalHash(params) !== approval.parametersHash) {
      await this.prisma.$transaction((tx) => this.renewals.invalidateApproval(tx, approval.id, approval.renewalId, 'Los parámetros cambiaron antes de programar', actor, correlationId));
      throw new ConflictException({ code: 'APPROVAL_INVALIDATED', message: 'Los parámetros cambiaron; la aprobación fue invalidada.' });
    }
    const window = approval.maintenanceWindow;
    const when = new Date(dto.scheduledAt);
    if (!window || !window.isActive || when < window.startsAt || when > window.endsAt) {
      throw new BadRequestException({ code: 'OUTSIDE_MAINTENANCE_WINDOW', message: 'La fecha programada está fuera de la ventana de mantenimiento aprobada.' });
    }
    if (approval.renewal.status !== 'APPROVED') {
      throw new ConflictException({ code: 'ALREADY_SCHEDULED', message: 'La renovación ya tiene una instalación programada.' });
    }

    return this.prisma.$transaction(async (tx) => {
      const job = await tx.deploymentJob.create({
        data: {
          renewalId: approval.renewalId, approvalId: approval.id, maintenanceWindowId: window.id, createdById: actor.id,
          mode: 'SIMULATION', scheduledAt: when, idempotencyKey: dto.idempotencyKey, simulateFailure: dto.simulateFailure, createdAt: now,
        },
      });
      await tx.deploymentTarget.createMany({ data: params.terminalIds.map((terminalId) => ({ jobId: job.id, terminalId })) });
      await this.renewals.transition(tx, approval.renewalId, 'SCHEDULED', actor, correlationId, 'renewal.schedule');
      await this.audit.recordWithin(tx, {
        actorId: actor.id, action: 'deployment.schedule', resourceType: 'DeploymentJob', resourceId: job.id,
        newState: { renewalId: approval.renewalId, terminalIds: params.terminalIds, scheduledAt: dto.scheduledAt, simulateFailure: dto.simulateFailure },
        result: 'SUCCESS', correlationId, approvalId: approval.id,
      });
      return { id: job.id, status: 'SCHEDULED', idempotent: false };
    });
  }

  // ───────────── Ejecución ─────────────

  async execute(jobId: string, actor: AuthUser, correlationId: string) {
    const job = await this.prisma.deploymentJob.findUnique({
      where: { id: jobId },
      include: { approval: true, maintenanceWindow: true, renewal: { include: { certificate: true, newCertificate: true } }, targets: true },
    });
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'La instalación no existe.' });
    if (job.mode !== 'SIMULATION' || loadEnv().EXECUTION_MODE !== 'SIMULATION') {
      return this.deny(actor, 'deployment.execute', jobId, 409, 'LAB_MODE_DISABLED', 'El modo de laboratorio autorizado está deshabilitado.', 'Modo laboratorio deshabilitado', correlationId, job.approvalId);
    }
    if (job.status !== 'SCHEDULED') {
      return this.deny(actor, 'deployment.execute', jobId, 409, 'JOB_ALREADY_EXECUTED', 'La instalación ya fue ejecutada o no está programada.', `Estado actual: ${job.status}`, correlationId, job.approvalId);
    }
    const now = this.clock.now();
    const params = await this.renewals.approvalParameters(this.prisma, job.renewalId, job.maintenanceWindowId);
    if (job.approval.status !== 'APPROVED' || job.approval.expiresAt <= now || computeApprovalHash(params) !== job.approval.parametersHash) {
      await this.prisma.$transaction(async (tx) => {
        await tx.deploymentJob.update({ where: { id: jobId }, data: { status: 'CANCELLED' } });
        if (job.approval.status === 'APPROVED') await this.renewals.invalidateApproval(tx, job.approvalId, job.renewalId, 'La aprobación dejó de ser válida al ejecutar', actor, correlationId);
      });
      return this.deny(actor, 'deployment.execute', jobId, 409, 'APPROVAL_INVALID', 'La aprobación ya no es válida; la instalación fue cancelada.', 'Aprobación inválida al ejecutar', correlationId, job.approvalId);
    }
    const w = job.maintenanceWindow;
    if (!w || now < w.startsAt || now > w.endsAt) {
      return this.deny(actor, 'deployment.execute', jobId, 409, 'OUTSIDE_MAINTENANCE_WINDOW', 'La ejecución está fuera de la ventana de mantenimiento.', 'Fuera de ventana', correlationId, job.approvalId);
    }

    // Reclamo atómico del trabajo: dos ejecuciones simultáneas no pueden iniciar la misma instalación.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.deploymentJob.findUniqueOrThrow({ where: { id: jobId } });
      if (fresh.status !== 'SCHEDULED') return false;
      await tx.deploymentJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: now, executorId: actor.id } });
      await this.renewals.transition(tx, job.renewalId, 'INSTALLING', actor, correlationId, 'renewal.install');
      await this.audit.recordWithin(tx, {
        actorId: actor.id, action: 'deployment.execute', resourceType: 'DeploymentJob', resourceId: jobId,
        newState: { status: 'RUNNING' }, result: 'SUCCESS', correlationId, approvalId: job.approvalId,
      });
      return true;
    });
    if (!claimed) return this.deny(actor, 'deployment.execute', jobId, 409, 'JOB_ALREADY_EXECUTED', 'La instalación ya fue ejecutada.', 'Ejecución duplicada', correlationId, job.approvalId);

    const oldThumbprint = job.renewal.certificate.thumbprintSha256;
    const newThumbprint = job.renewal.newCertificate!.thumbprintSha256;
    const newPem = job.renewal.newCertificatePem!;
    for (const target of job.targets) {
      await this.processTarget(job, target.id, target.terminalId, oldThumbprint, newThumbprint, newPem, actor, correlationId);
    }
    return this.finalize(jobId, actor, correlationId);
  }

  private async processTarget(
    job: { id: string; approvalId: string; simulateFailure: string },
    targetId: string, terminalId: string, oldThumbprint: string, newThumbprint: string, newPem: string,
    actor: AuthUser, correlationId: string,
  ): Promise<void> {
    const terminal = await this.prisma.terminal.findUniqueOrThrow({ where: { id: terminalId } });
    const ref = { id: terminal.id, hostname: terminal.hostname };
    const startedAt = this.clock.now();
    const attemptNo = (await this.prisma.deploymentAttempt.count({ where: { targetId } })) + 1;
    const record = async (outcome: 'SUCCESS' | 'FAILURE', errorMessage: string | null, targetStatus: string, verification?: { passed: boolean; detail: string }) => {
      await this.prisma.$transaction(async (tx) => {
        await tx.deploymentAttempt.create({ data: { targetId, attemptNo, startedAt, finishedAt: this.clock.now(), outcome, errorMessage, correlationId } });
        if (verification) await tx.verificationResult.create({ data: { targetId, passed: verification.passed, detail: verification.detail.slice(0, 500), verifiedAt: this.clock.now() } });
        await tx.deploymentTarget.update({ where: { id: targetId }, data: { status: targetStatus } });
        await this.audit.recordWithin(tx, {
          actorId: actor.id, action: 'deployment.attempt', resourceType: 'DeploymentJob', resourceId: job.id,
          newState: { targetId, hostname: terminal.hostname, status: targetStatus, verification: verification?.passed ?? null },
          result: outcome === 'SUCCESS' ? 'SUCCESS' : 'FAILURE', reason: errorMessage, correlationId, approvalId: job.approvalId,
        });
      });
    };

    try {
      const snapshot = await this.executor.snapshot(ref);
      await this.prisma.deploymentTarget.update({ where: { id: targetId }, data: { previousSlotsJson: JSON.stringify(snapshot) } });

      if (job.simulateFailure === 'INSTALL_FAILURE') {
        await record('FAILURE', 'Falla simulada durante la instalación', 'FAILED');
        return;
      }
      await this.executor.install(ref, newPem, oldThumbprint);

      if (job.simulateFailure === 'VERIFICATION_FAILURE' || job.simulateFailure === 'ROLLBACK_FAILURE') {
        await record('FAILURE', 'VERIFICATION_FAILED', 'FAILED', { passed: false, detail: 'La huella instalada no coincide con la esperada (falla simulada).' });
        return;
      }
      // Verificación real: se reinventaría la terminal y se comprueba el resultado.
      await this.inventory.runInventory(terminalId, actor, correlationId);
      const installs = await this.prisma.certificateInstallation.findMany({
        where: { terminalId, storeName: 'My' }, include: { certificate: { select: { thumbprintSha256: true } } },
      });
      const hasNew = installs.some((i) => i.status === 'PRESENT' && i.certificate.thumbprintSha256 === newThumbprint);
      const oldGone = !installs.some((i) => i.status === 'PRESENT' && i.certificate.thumbprintSha256 === oldThumbprint);
      const passed = hasNew && oldGone;
      await record(passed ? 'SUCCESS' : 'FAILURE', passed ? null : 'VERIFICATION_FAILED', passed ? 'VERIFIED' : 'FAILED', {
        passed, detail: passed ? 'El certificado nuevo está presente y el anterior fue retirado.' : 'No se encontró el certificado esperado tras la instalación.',
      });
    } catch (error) {
      await record('FAILURE', error instanceof Error ? error.message.slice(0, 500) : 'Error desconocido', 'FAILED');
    }
  }

  private async finalize(jobId: string, actor: AuthUser, correlationId: string) {
    const job = await this.prisma.deploymentJob.findUniqueOrThrow({ where: { id: jobId }, include: { targets: true, renewal: true } });
    const verified = job.targets.filter((t) => t.status === 'VERIFIED').length;
    const status = verified === job.targets.length ? 'COMPLETED' : verified === 0 ? 'FAILED' : 'PARTIAL';
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.deploymentJob.update({ where: { id: jobId }, data: { status, finishedAt: now } });
      if (status === 'COMPLETED') {
        for (const next of ['INSTALLED', 'VERIFIED', 'COMPLETED'] as const) {
          await this.renewals.transition(tx, job.renewalId, next, actor, correlationId, `renewal.${next.toLowerCase()}`);
        }
        const alerts = await tx.alert.findMany({
          where: { certificateId: job.renewal.certificateId, status: { in: ['OPEN', 'ACKNOWLEDGED'] }, terminalId: { in: job.targets.map((t) => t.terminalId) } },
        });
        for (const a of alerts) {
          await tx.alert.update({ where: { id: a.id }, data: { status: 'RESOLVED', resolvedAt: now } });
          await this.audit.recordWithin(tx, {
            actorId: actor.id, action: 'alert.resolve', resourceType: 'Alert', resourceId: a.id,
            previousState: { status: a.status }, newState: { status: 'RESOLVED' }, result: 'SUCCESS', reason: 'Renovación completada', correlationId,
          });
        }
      } else {
        await this.renewals.transition(tx, job.renewalId, 'FAILED', actor, correlationId, 'renewal.fail', {}, `Instalación ${status}`);
      }
      await this.audit.recordWithin(tx, {
        actorId: actor.id, action: 'deployment.finish', resourceType: 'DeploymentJob', resourceId: jobId,
        newState: { status, verified, total: job.targets.length }, result: status === 'COMPLETED' ? 'SUCCESS' : 'FAILURE', correlationId, approvalId: job.approvalId,
      });
    });
    return { id: jobId, status, verified, total: job.targets.length };
  }

  // ───────────── Reversión ─────────────

  /** La reversión es una operación independiente que restaura el estado previo guardado (RF09). */
  async rollback(jobId: string, dto: { targetId: string; reason: string }, actor: AuthUser, correlationId: string) {
    const target = await this.prisma.deploymentTarget.findUnique({
      where: { id: dto.targetId }, include: { job: { include: { renewal: true } }, terminal: true, rollbacks: true },
    });
    if (!target || target.jobId !== jobId) throw new NotFoundException({ code: 'TARGET_NOT_FOUND', message: 'El destino de instalación no existe.' });
    if (!['FAILED', 'INSTALLED', 'ROLLBACK_FAILED'].includes(target.status) || !target.previousSlotsJson) {
      return this.deny(actor, 'rollback.execute', jobId, 409, 'ROLLBACK_NOT_APPLICABLE', 'El destino no admite reversión en su estado actual.', `Estado del destino: ${target.status}`, correlationId, target.job.approvalId);
    }
    const ref = { id: target.terminal.id, hostname: target.terminal.hostname };
    const previous = JSON.parse(target.previousSlotsJson) as SlotSnapshot[];
    const currentState = JSON.stringify(await this.executor.snapshot(ref));
    const now = this.clock.now();
    const forcedFailure = target.job.simulateFailure === 'ROLLBACK_FAILURE' && target.rollbacks.length === 0;

    const writeOperation = async (outcome: 'SUCCESS' | 'FAILURE', evidence: Record<string, unknown>, status: string) => {
      await this.prisma.$transaction(async (tx) => {
        await tx.rollbackOperation.create({
          data: { targetId: target.id, reason: dto.reason, previousState: currentState, outcome, evidence: JSON.stringify(evidence), executedById: actor.id, executedAt: now },
        });
        await tx.deploymentTarget.update({ where: { id: target.id }, data: { status } });
        await this.audit.recordWithin(tx, {
          actorId: actor.id, action: 'rollback.execute', resourceType: 'DeploymentJob', resourceId: jobId,
          previousState: { targetStatus: target.status }, newState: { targetId: target.id, status, outcome }, result: outcome,
          reason: dto.reason, correlationId, approvalId: target.job.approvalId,
        });
      });
    };

    if (forcedFailure) {
      await writeOperation('FAILURE', { error: 'Falla simulada: el mecanismo de recuperación no respondió.' }, 'ROLLBACK_FAILED');
      return { targetId: target.id, outcome: 'FAILURE', status: 'ROLLBACK_FAILED' };
    }
    await this.executor.restore(ref, previous);
    const refresh = await this.inventory.runInventory(target.terminalId, actor, correlationId);
    const restored = await Promise.all(previous.map(async (s) => (await describeCertificate(s.pem, s)).thumbprintSha256));
    await writeOperation('SUCCESS', { restoredThumbprints: restored, postRollbackScanId: refresh.scanId }, 'ROLLED_BACK');

    // Si todos los destinos fueron revertidos, la instalación y la renovación quedan revertidas.
    const targets = await this.prisma.deploymentTarget.findMany({ where: { jobId } });
    if (targets.every((t) => t.status === 'ROLLED_BACK')) {
      await this.prisma.$transaction(async (tx) => {
        await tx.deploymentJob.update({ where: { id: jobId }, data: { status: 'ROLLED_BACK' } });
        if (['FAILED', 'INSTALLED', 'INSTALLING'].includes(target.job.renewal.status)) {
          await this.renewals.transition(tx, target.job.renewalId, 'ROLLED_BACK', actor, correlationId, 'renewal.rollback', {}, dto.reason);
        }
      });
    }
    return { targetId: target.id, outcome: 'SUCCESS', status: 'ROLLED_BACK' };
  }

  // ───────────── Conciliación ─────────────

  /** Marca como fallidas las instalaciones interrumpidas; nunca declara éxito sobre operaciones incompletas. */
  async reconcile(actor: AuthUser, correlationId: string): Promise<{ reconciled: number }> {
    const limit = new Date(this.clock.now().getTime() - STALE_RUNNING_MINUTES * 60_000);
    const stale = await this.prisma.deploymentJob.findMany({ where: { status: 'RUNNING', startedAt: { lt: limit } }, include: { targets: true } });
    for (const job of stale) {
      await this.prisma.$transaction(async (tx) => {
        for (const t of job.targets.filter((x) => ['PENDING', 'INSTALLED'].includes(x.status))) {
          await tx.deploymentTarget.update({ where: { id: t.id }, data: { status: 'FAILED' } });
        }
        const verified = job.targets.filter((t) => t.status === 'VERIFIED').length;
        await tx.deploymentJob.update({ where: { id: job.id }, data: { status: verified ? 'PARTIAL' : 'FAILED', finishedAt: this.clock.now() } });
        await this.renewals.transition(tx, job.renewalId, 'FAILED', actor, correlationId, 'renewal.fail', {}, 'Operación interrumpida conciliada');
        await this.audit.recordWithin(tx, {
          actorId: actor.id, action: 'deployment.reconcile', resourceType: 'DeploymentJob', resourceId: job.id,
          newState: { status: verified ? 'PARTIAL' : 'FAILED' }, result: 'FAILURE', reason: `Operación sin finalizar por más de ${STALE_RUNNING_MINUTES} minutos`, correlationId,
        });
      });
    }
    return { reconciled: stale.length };
  }
}
