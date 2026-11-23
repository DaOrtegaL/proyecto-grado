import { ConflictException, ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  RenewalStatus, TERMINAL_RENEWAL_STATUSES, allowedTransitions, canTransition, computeApprovalHash, ApprovalParameters,
} from '@msh/domain';
import { BasicCertificateValidator, SimulatedCertificateIssuer, describeCertificate } from '@msh/simulated-pos';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AlertsService, Tx } from '../alerts/alerts.service';
import { Clock } from '../common/clock';
import type { AuthUser } from '../common/request-context';

type Dto<T extends (...a: any) => any> = ReturnType<T>;

const EDITABLE: RenewalStatus[] = ['REQUESTED', 'PENDING_ISSUANCE', 'ISSUED', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED'];

/** Casos de uso de renovaciones, aprobaciones y ventanas de mantenimiento (RF06, RF07). */
@Injectable()
export class RenewalsService {
  private readonly issuer = new SimulatedCertificateIssuer();
  private readonly validator = new BasicCertificateValidator();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  // ───────────── Utilidades ─────────────

  async policyValue(key: string, fallback: string): Promise<string> {
    return (await this.prisma.configurationPolicy.findUnique({ where: { key } }))?.value ?? fallback;
  }

  /** Transición validada por la máquina de estados; impide saltos inválidos. */
  async transition(
    tx: Tx, renewalId: string, to: RenewalStatus, actor: AuthUser, correlationId: string,
    action: string, extra: Record<string, unknown> = {}, reason?: string,
  ): Promise<void> {
    const renewal = await tx.renewalRequest.findUniqueOrThrow({ where: { id: renewalId } });
    if (!canTransition(renewal.status as RenewalStatus, to)) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: `La transición de ${renewal.status} a ${to} no está permitida.`,
      });
    }
    const now = this.clock.now();
    await tx.renewalRequest.update({
      where: { id: renewalId },
      data: { status: to, updatedAt: now, ...(to === 'COMPLETED' ? { completedAt: now } : {}), ...extra },
    });
    await tx.certificate.update({ where: { id: renewal.certificateId }, data: { renewalStatus: to === 'CANCELLED' || to === 'REJECTED' ? 'NONE' : to } });
    await this.audit.recordWithin(tx, {
      actorId: actor.id, action, resourceType: 'RenewalRequest', resourceId: renewalId,
      previousState: { status: renewal.status }, newState: { status: to }, result: 'SUCCESS', reason: reason ?? null, correlationId,
    });
  }

  private async userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is string => !!i))];
    const users = unique.length ? await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, displayName: true } }) : [];
    return new Map(users.map((u) => [u.id, u.displayName]));
  }

  /** Parámetros sujetos a aprobación, calculados con el estado actual (RF07). */
  async approvalParameters(tx: Tx | PrismaService, renewalId: string, windowId: string | null): Promise<ApprovalParameters> {
    const r = await tx.renewalRequest.findUniqueOrThrow({
      where: { id: renewalId },
      include: { certificate: { include: { policy: true, issuer: true } }, newCertificate: true, targets: true },
    });
    return {
      certificateId: r.certificateId,
      newCertificateThumbprint: r.newCertificate?.thumbprintSha256 ?? '',
      terminalIds: r.targets.map((t) => t.terminalId),
      operation: 'INSTALL_CERTIFICATE',
      maintenanceWindowId: windowId,
      ownerId: AlertsService.resolveOwnerId(r.certificate),
    };
  }

  // ───────────── Consultas ─────────────

  async list(q: { status?: string; page: number; pageSize: number }) {
    const where = q.status ? { status: q.status } : {};
    const [total, rows] = await Promise.all([
      this.prisma.renewalRequest.count({ where }),
      this.prisma.renewalRequest.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        include: {
          certificate: { select: { id: true, subject: true, notAfter: true } },
          targets: { include: { terminal: { select: { id: true, hostname: true } } } },
          approvals: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
    ]);
    const names = await this.userNames(rows.map((r) => r.requestedById));
    return {
      total, page: q.page, pageSize: q.pageSize,
      items: rows.map((r) => ({
        id: r.id, status: r.status, reason: r.reason, createdAt: r.createdAt, updatedAt: r.updatedAt,
        certificate: r.certificate, requestedBy: names.get(r.requestedById) ?? null,
        targets: r.targets.map((t) => t.terminal), latestApproval: r.approvals[0] ?? null,
        allowedTransitions: allowedTransitions(r.status as RenewalStatus),
        hasIssuanceEvidence: !!r.issuanceEvidence,
      })),
    };
  }

  async detail(id: string) {
    const r = await this.prisma.renewalRequest.findUnique({
      where: { id },
      include: {
        certificate: true, newCertificate: { select: { id: true, thumbprintSha256: true, subject: true, notAfter: true } },
        targets: { include: { terminal: { select: { id: true, hostname: true } } } },
        approvals: { orderBy: { createdAt: 'asc' }, include: { decisions: true } },
        jobs: { include: { targets: { include: { attempts: true, verifications: true, rollbacks: true, terminal: { select: { hostname: true } } } } } },
      },
    });
    if (!r) throw new NotFoundException({ code: 'RENEWAL_NOT_FOUND', message: 'La solicitud de renovación no existe.' });
    const ids = [r.id, ...r.approvals.map((a) => a.id), ...r.jobs.map((j) => j.id)];
    const timeline = await this.prisma.auditEvent.findMany({
      where: { resourceId: { in: ids } }, orderBy: { sequence: 'asc' },
      select: { sequence: true, occurredAt: true, action: true, result: true, reason: true, actorId: true },
    });
    const names = await this.userNames([r.requestedById, ...timeline.map((t) => t.actorId), ...r.approvals.flatMap((a) => a.decisions.map((d) => d.deciderId))]);
    const { issuanceEvidence, newCertificatePem: _pem, ...rest } = r;
    return {
      ...rest,
      requestedBy: names.get(r.requestedById) ?? null,
      issuanceEvidence: issuanceEvidence ? JSON.parse(issuanceEvidence) : null,
      allowedTransitions: allowedTransitions(r.status as RenewalStatus),
      approvals: r.approvals.map((a) => ({ ...a, decisions: a.decisions.map((d) => ({ ...d, decider: names.get(d.deciderId) ?? null })) })),
      timeline: timeline.map((t) => ({ ...t, actor: t.actorId ? (names.get(t.actorId) ?? null) : null })),
    };
  }

  // ───────────── Renovaciones ─────────────

  private async assertTargets(certificateId: string, terminalIds: string[]): Promise<void> {
    const installs = await this.prisma.certificateInstallation.findMany({ where: { certificateId, status: 'PRESENT' }, select: { terminalId: true } });
    const present = new Set(installs.map((i) => i.terminalId));
    const invalid = terminalIds.filter((t) => !present.has(t));
    if (invalid.length) {
      throw new BadRequestException({ code: 'TERMINAL_NOT_ASSOCIATED', message: 'Alguna terminal seleccionada no tiene instalado el certificado.' });
    }
  }

  async create(dto: Dto<typeof import('@msh/validation').createRenewalSchema.parse>, actor: AuthUser, correlationId: string) {
    const cert = await this.prisma.certificate.findUnique({ where: { id: dto.certificateId } });
    if (!cert) throw new NotFoundException({ code: 'CERTIFICATE_NOT_FOUND', message: 'El certificado no existe.' });
    const terminalIds = [...new Set(dto.terminalIds)];
    await this.assertTargets(cert.id, terminalIds);
    const active = await this.prisma.renewalRequest.findFirst({
      where: { certificateId: cert.id, status: { notIn: [...TERMINAL_RENEWAL_STATUSES, 'ROLLED_BACK', 'FAILED'] } },
    });
    if (active) {
      throw new ConflictException({ code: 'RENEWAL_ALREADY_ACTIVE', message: 'Ya existe una renovación activa para este certificado.' });
    }
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.renewalRequest.create({
        data: { certificateId: cert.id, requestedById: actor.id, reason: dto.reason ?? null, createdAt: now, updatedAt: now },
      });
      await tx.renewalTarget.createMany({ data: terminalIds.map((terminalId) => ({ renewalId: r.id, terminalId })) });
      await tx.certificate.update({ where: { id: cert.id }, data: { renewalStatus: 'REQUESTED' } });
      await this.audit.recordWithin(tx, {
        actorId: actor.id, action: 'renewal.create', resourceType: 'RenewalRequest', resourceId: r.id,
        newState: { status: 'REQUESTED', certificateId: cert.id, terminalIds }, result: 'SUCCESS', reason: dto.reason ?? null, correlationId,
      });
      return { id: r.id, status: 'REQUESTED' };
    });
  }

  async requestIssuance(id: string, actor: AuthUser, correlationId: string) {
    await this.prisma.$transaction((tx) => this.transition(tx, id, 'PENDING_ISSUANCE', actor, correlationId, 'renewal.request_issuance'));
    return { id, status: 'PENDING_ISSUANCE' };
  }

  /** Emisión simulada: un certificado solo se registra como emitido si existe evidencia de emisión (RF06). */
  async issue(id: string, actor: AuthUser, correlationId: string) {
    const r = await this.prisma.renewalRequest.findUnique({ where: { id }, include: { certificate: true } });
    if (!r) throw new NotFoundException({ code: 'RENEWAL_NOT_FOUND', message: 'La solicitud de renovación no existe.' });
    if (r.status !== 'PENDING_ISSUANCE') {
      throw new ConflictException({ code: 'INVALID_TRANSITION', message: `La transición de ${r.status} a ISSUED no está permitida.` });
    }
    const now = this.clock.now();
    const cn = /CN=([^,]+)/.exec(r.certificate.subject)?.[1]?.trim() ?? 'pos.msh.lab';
    const result = await this.issuer.issue({ subjectCommonName: cn, issuerDn: r.certificate.issuerDn, validityDays: 730, keyKind: 'EC_P256', now });
    if (!result.certificatePem || !result.evidence?.thumbprintSha256) {
      throw new ConflictException({ code: 'ISSUANCE_EVIDENCE_MISSING', message: 'No se registró evidencia de emisión.' });
    }
    const meta = await describeCertificate(result.certificatePem, { storeLocation: 'LocalMachine', storeName: 'My', hasPrivateKey: true });
    const outcome = this.validator.validate(meta, now);
    if (!outcome.valid) {
      throw new ConflictException({ code: 'ISSUED_CERTIFICATE_INVALID', message: `El certificado emitido no cumple la política: ${outcome.reasons.join(' ')}` });
    }
    return this.prisma.$transaction(async (tx) => {
      const issuer = await tx.certificateIssuer.findUnique({ where: { subjectDn: meta.issuer } });
      const created = await tx.certificate.create({
        data: {
          thumbprintSha256: meta.thumbprintSha256, subject: meta.subject, issuerDn: meta.issuer, serialNumber: meta.serialNumber,
          notBefore: new Date(meta.notBefore), notAfter: new Date(meta.notAfter), publicKeyAlgorithm: meta.publicKeyAlgorithm,
          keySizeBits: meta.keySizeBits, signatureAlgorithm: meta.signatureAlgorithm, keyUsage: JSON.stringify(meta.keyUsage),
          extendedKeyUsage: JSON.stringify(meta.extendedKeyUsage), issuerId: issuer?.id ?? r.certificate.issuerId,
          ownerId: r.certificate.ownerId, policyId: r.certificate.policyId, isSynthetic: true, discoveredAt: now, lastVerifiedAt: now,
        },
      });
      await tx.certificateHistory.create({
        data: { certificateId: created.id, change: 'ISSUED_FOR_RENEWAL', details: JSON.stringify({ renewalId: id }), correlationId, createdAt: now },
      });
      await this.transition(tx, id, 'ISSUED', actor, correlationId, 'renewal.issue', {
        newCertificateId: created.id, newCertificatePem: result.certificatePem, issuanceEvidence: JSON.stringify(result.evidence),
      });
      return { id, status: 'ISSUED', newCertificateId: created.id, evidence: result.evidence };
    });
  }

  async cancel(id: string, reason: string, actor: AuthUser, correlationId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, id, 'CANCELLED', actor, correlationId, 'renewal.cancel', {}, reason);
      await tx.approvalRequest.updateMany({ where: { renewalId: id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'INVALIDATED', invalidatedReason: 'Renovación cancelada' } });
      await tx.deploymentJob.updateMany({ where: { renewalId: id, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });
    });
    return { id, status: 'CANCELLED' };
  }

  /** Cualquier cambio de destinos invalida la aprobación vigente (RF07). */
  async updateTargets(id: string, dto: { terminalIds: string[]; reason: string }, actor: AuthUser, correlationId: string) {
    const r = await this.prisma.renewalRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException({ code: 'RENEWAL_NOT_FOUND', message: 'La solicitud de renovación no existe.' });
    if (!EDITABLE.includes(r.status as RenewalStatus)) {
      throw new ConflictException({ code: 'RENEWAL_NOT_EDITABLE', message: 'La solicitud ya no admite cambios de destino.' });
    }
    const terminalIds = [...new Set(dto.terminalIds)];
    await this.assertTargets(r.certificateId, terminalIds);
    return this.prisma.$transaction(async (tx) => {
      await tx.renewalTarget.deleteMany({ where: { renewalId: id } });
      await tx.renewalTarget.createMany({ data: terminalIds.map((terminalId) => ({ renewalId: id, terminalId })) });
      await this.audit.recordWithin(tx, {
        actorId: actor.id, action: 'renewal.update_targets', resourceType: 'RenewalRequest', resourceId: id,
        newState: { terminalIds }, result: 'SUCCESS', reason: dto.reason, correlationId,
      });
      const approvals = await tx.approvalRequest.findMany({ where: { renewalId: id, status: { in: ['PENDING', 'APPROVED'] } } });
      let invalidated = 0;
      for (const a of approvals) {
        const hash = computeApprovalHash(await this.approvalParameters(tx, id, a.maintenanceWindowId));
        if (hash === a.parametersHash) continue;
        await this.invalidateApproval(tx, a.id, id, 'Cambiaron los destinos de la instalación', actor, correlationId);
        invalidated++;
      }
      return { id, terminalIds, approvalsInvalidated: invalidated };
    });
  }

  /** Invalida una aprobación, cancela instalaciones programadas y devuelve la renovación a ISSUED. */
  async invalidateApproval(tx: Tx, approvalId: string, renewalId: string, reason: string, actor: AuthUser, correlationId: string) {
    await tx.approvalRequest.update({ where: { id: approvalId }, data: { status: 'INVALIDATED', invalidatedReason: reason } });
    await tx.deploymentJob.updateMany({ where: { renewalId, approvalId, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });
    const renewal = await tx.renewalRequest.findUniqueOrThrow({ where: { id: renewalId } });
    await this.audit.recordWithin(tx, {
      actorId: actor.id, action: 'approval.invalidate', resourceType: 'ApprovalRequest', resourceId: approvalId,
      previousState: { status: 'APPROVED_OR_PENDING' }, newState: { status: 'INVALIDATED' }, result: 'SUCCESS', reason, correlationId,
    });
    if (['PENDING_APPROVAL', 'APPROVED', 'SCHEDULED'].includes(renewal.status)) {
      await this.transition(tx, renewalId, 'ISSUED', actor, correlationId, 'renewal.reset_after_invalidation', {}, reason);
    }
  }

  // ───────────── Aprobaciones ─────────────

  async requestApproval(id: string, dto: { maintenanceWindowId: string; justification: string }, actor: AuthUser, correlationId: string) {
    const window = await this.prisma.maintenanceWindow.findUnique({ where: { id: dto.maintenanceWindowId } });
    if (!window || !window.isActive || window.endsAt <= this.clock.now()) {
      throw new BadRequestException({ code: 'MAINTENANCE_WINDOW_INVALID', message: 'La ventana de mantenimiento no existe, está inactiva o ya terminó.' });
    }
    const validityHours = Number(await this.policyValue('approval.validityHours', '48'));
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const params = await this.approvalParameters(tx, id, window.id);
      const approval = await tx.approvalRequest.create({
        data: {
          renewalId: id, requestedById: actor.id, parametersHash: computeApprovalHash(params), maintenanceWindowId: window.id,
          justification: dto.justification, createdAt: now, expiresAt: new Date(now.getTime() + validityHours * 3_600_000),
        },
      });
      await this.transition(tx, id, 'PENDING_APPROVAL', actor, correlationId, 'approval.request', {}, dto.justification);
      await this.audit.recordWithin(tx, {
        actorId: actor.id, action: 'approval.create', resourceType: 'ApprovalRequest', resourceId: approval.id,
        newState: { renewalId: id, windowId: window.id, parametersHash: approval.parametersHash }, result: 'SUCCESS',
        reason: dto.justification, correlationId, approvalId: approval.id,
      });
      return { id: approval.id, status: 'PENDING', expiresAt: approval.expiresAt };
    });
  }

  async listApprovals(status?: string) {
    const rows = await this.prisma.approvalRequest.findMany({
      where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200,
      include: {
        renewal: { include: { certificate: { select: { subject: true } }, targets: { include: { terminal: { select: { hostname: true } } } } } },
        maintenanceWindow: { select: { id: true, name: true, startsAt: true, endsAt: true } },
        decisions: true,
      },
    });
    const names = await this.userNames(rows.flatMap((a) => [a.requestedById, ...a.decisions.map((d) => d.deciderId)]));
    return rows.map((a) => ({
      id: a.id, status: a.status, createdAt: a.createdAt, expiresAt: a.expiresAt, justification: a.justification,
      invalidatedReason: a.invalidatedReason, renewalId: a.renewalId, renewalStatus: a.renewal.status,
      certificate: a.renewal.certificate.subject, terminals: a.renewal.targets.map((t) => t.terminal.hostname),
      maintenanceWindow: a.maintenanceWindow, requestedById: a.requestedById, requestedBy: names.get(a.requestedById) ?? null,
      decisions: a.decisions.map((d) => ({ decision: d.decision, justification: d.justification, decidedAt: d.decidedAt, decider: names.get(d.deciderId) ?? null })),
    }));
  }

  async decide(id: string, dto: { decision: 'APPROVED' | 'REJECTED'; justification: string }, actor: AuthUser, correlationId: string) {
    const approval = await this.prisma.approvalRequest.findUnique({ where: { id }, include: { renewal: true } });
    if (!approval) throw new NotFoundException({ code: 'APPROVAL_NOT_FOUND', message: 'La solicitud de aprobación no existe.' });
    if (approval.status !== 'PENDING') {
      throw new ConflictException({ code: 'APPROVAL_NOT_PENDING', message: 'La solicitud de aprobación ya no está pendiente.' });
    }
    const sod = (await this.policyValue('approval.separationOfDuties', 'true')) === 'true';
    if (sod && (actor.id === approval.requestedById || actor.id === approval.renewal.requestedById)) {
      await this.audit.recordSafely({
        actorId: actor.id, action: 'approval.decide', resourceType: 'ApprovalRequest', resourceId: id, result: 'DENIED',
        reason: 'Separación de funciones: el solicitante no puede decidir su propia solicitud', correlationId, approvalId: id,
      });
      throw new ForbiddenException({ code: 'SELF_APPROVAL_FORBIDDEN', message: 'El solicitante no puede aprobar su propia solicitud.' });
    }
    const now = this.clock.now();

    const outcome = await this.prisma.$transaction(async (tx) => {
      if (approval.expiresAt <= now) {
        await tx.approvalRequest.update({ where: { id }, data: { status: 'EXPIRED', invalidatedReason: 'La aprobación venció antes de la decisión' } });
        await this.transition(tx, approval.renewalId, 'ISSUED', actor, correlationId, 'renewal.reset_after_expiry');
        return 'EXPIRED';
      }
      const hash = computeApprovalHash(await this.approvalParameters(tx, approval.renewalId, approval.maintenanceWindowId));
      if (hash !== approval.parametersHash) {
        await this.invalidateApproval(tx, id, approval.renewalId, 'Los parámetros cambiaron antes de la decisión', actor, correlationId);
        return 'INVALIDATED';
      }
      await tx.approvalDecision.create({
        data: { approvalId: id, deciderId: actor.id, decision: dto.decision, justification: dto.justification, decidedAt: now },
      });
      await tx.approvalRequest.update({ where: { id }, data: { status: dto.decision } });
      await this.transition(tx, approval.renewalId, dto.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED', actor, correlationId, 'approval.decide', {}, dto.justification);
      await this.audit.recordWithin(tx, {
        actorId: actor.id, action: 'approval.decision', resourceType: 'ApprovalRequest', resourceId: id,
        previousState: { status: 'PENDING' }, newState: { status: dto.decision }, result: 'SUCCESS', reason: dto.justification, correlationId, approvalId: id,
      });
      return dto.decision;
    });
    if (outcome === 'EXPIRED') throw new ConflictException({ code: 'APPROVAL_EXPIRED', message: 'La aprobación venció; debe solicitarse nuevamente.' });
    if (outcome === 'INVALIDATED') throw new ConflictException({ code: 'APPROVAL_INVALIDATED', message: 'Los parámetros cambiaron; la aprobación fue invalidada.' });
    return { id, status: outcome };
  }

  // ───────────── Ventanas de mantenimiento ─────────────

  listWindows() {
    return this.prisma.maintenanceWindow.findMany({ orderBy: { startsAt: 'desc' }, take: 100 });
  }

  async createWindow(dto: { name: string; startsAt: string; endsAt: string; countryCode?: string }, actor: AuthUser, correlationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const w = await tx.maintenanceWindow.create({
        data: { name: dto.name, startsAt: new Date(dto.startsAt), endsAt: new Date(dto.endsAt), countryCode: dto.countryCode ?? null },
      });
      await this.audit.recordWithin(tx, {
        actorId: actor.id, action: 'maintenance_window.create', resourceType: 'MaintenanceWindow', resourceId: w.id,
        newState: { startsAt: dto.startsAt, endsAt: dto.endsAt }, result: 'SUCCESS', correlationId,
      });
      return w;
    });
  }
}
