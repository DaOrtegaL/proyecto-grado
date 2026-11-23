import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import {
  AnomalyPolicy,
  DEFAULT_ANOMALY_POLICY,
  InstallationView,
  evaluateTerminalAnomalies,
  findingKey,
} from '@msh/domain';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AlertsService, Tx } from '../alerts/alerts.service';
import { Clock } from '../common/clock';
import type { AuthUser } from '../common/request-context';

@Injectable()
export class AnomalyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private async loadPolicy(tx: Tx): Promise<AnomalyPolicy> {
    const policy = await tx.certificatePolicy.findFirst({ orderBy: { name: 'asc' } });
    if (!policy) return DEFAULT_ANOMALY_POLICY;
    let weak = DEFAULT_ANOMALY_POLICY.weakSignatures;
    try {
      const parsed = JSON.parse(policy.weakSignatures);
      if (Array.isArray(parsed)) weak = parsed;
    } catch {
      /* se conserva el valor por defecto */
    }
    return {
      ...DEFAULT_ANOMALY_POLICY,
      minKeySizeBits: policy.minKeySizeBits,
      weakSignatures: weak,
      requiredEku: policy.requiredEku,
    };
  }

  /**
   * Evalúa las reglas de anomalías de una terminal y concilia los hallazgos abiertos.
   * `inventoryComplete` evita declarar "certificado faltante" tras un inventario parcial o fallido.
   */
  async evaluateTerminalWithin(
    tx: Tx,
    terminalId: string,
    ctx: { actorId: string | null; correlationId: string; inventoryComplete: boolean },
  ): Promise<{ created: number; resolved: number }> {
    const now = this.clock.now();
    const terminal = await tx.terminal.findUniqueOrThrow({ where: { id: terminalId } });
    const installations = await tx.certificateInstallation.findMany({
      where: { terminalId, status: 'PRESENT' },
      include: { certificate: { include: { issuer: true, policy: true } } },
    });
    const views: InstallationView[] = installations.map((i) => ({
      certificateId: i.certificateId,
      thumbprintSha256: i.certificate.thumbprintSha256,
      subject: i.certificate.subject,
      notAfter: i.certificate.notAfter,
      publicKeyAlgorithm: i.certificate.publicKeyAlgorithm,
      keySizeBits: i.certificate.keySizeBits,
      signatureAlgorithm: i.certificate.signatureAlgorithm,
      extendedKeyUsage: JSON.parse(i.certificate.extendedKeyUsage) as string[],
      issuerKnown: i.certificate.issuerId !== null,
      hasOwner: AlertsService.resolveOwnerId(i.certificate) !== null,
      storeName: i.storeName,
      hasPrivateKey: i.hasPrivateKey,
    }));

    const policy = await this.loadPolicy(tx);
    let findings = evaluateTerminalAnomalies(views, terminal.lastInventoryAt, now, policy);
    if (!ctx.inventoryComplete) findings = findings.filter((f) => f.type !== 'MISSING_CLIENT_CERTIFICATE');

    const desired = new Map(findings.map((f) => [findingKey(f.type, f.certificateId, terminalId), f]));
    const open = await tx.securityFinding.findMany({ where: { terminalId, status: 'OPEN' } });
    let created = 0;
    let resolved = 0;

    for (const [key, f] of desired) {
      const existing = await tx.securityFinding.findUnique({ where: { dedupKey: key } });
      if (existing) {
        if (existing.status === 'RESOLVED') {
          await tx.securityFinding.update({ where: { id: existing.id }, data: { status: 'OPEN', resolvedAt: null, detectedAt: now } });
        }
        continue;
      }
      const row = await tx.securityFinding.create({
        data: {
          type: f.type, severity: f.severity, certificateId: f.certificateId, terminalId,
          dedupKey: key, detail: f.detail.slice(0, 500), recommendation: f.recommendation.slice(0, 500), detectedAt: now,
        },
      });
      created++;
      await this.audit.recordWithin(tx, {
        actorId: ctx.actorId, action: 'security.finding.create', resourceType: 'SecurityFinding', resourceId: row.id,
        newState: { type: f.type, severity: f.severity, terminalId }, result: 'SUCCESS', correlationId: ctx.correlationId,
      });
    }

    // Los hallazgos basados en eventos (cambio no autorizado) se cierran solo por decisión humana.
    for (const f of open) {
      if (f.type === 'UNAUTHORIZED_CHANGE' || desired.has(f.dedupKey)) continue;
      if (!ctx.inventoryComplete && f.type === 'MISSING_CLIENT_CERTIFICATE') continue;
      await tx.securityFinding.update({ where: { id: f.id }, data: { status: 'RESOLVED', resolvedAt: now } });
      resolved++;
    }
    return { created, resolved };
  }

  /** Registra un cambio de certificado sin un despliegue autorizado asociado (requiere revisión, no implica malicia). */
  async flagUnauthorizedChangeWithin(
    tx: Tx,
    p: { terminalId: string; certificateId: string; subject: string; actorId: string | null; correlationId: string },
  ): Promise<void> {
    const key = findingKey('UNAUTHORIZED_CHANGE', p.certificateId, p.terminalId);
    if (await tx.securityFinding.findUnique({ where: { dedupKey: key } })) return;
    const row = await tx.securityFinding.create({
      data: {
        type: 'UNAUTHORIZED_CHANGE', severity: 'MEDIUM', certificateId: p.certificateId, terminalId: p.terminalId, dedupKey: key,
        detail: `Se reemplazó el certificado ${p.subject} sin un despliegue aprobado asociado.`.slice(0, 500),
        recommendation: 'Confirmar con el equipo responsable si el cambio fue planificado; de ser así, registrar la renovación correspondiente.',
        detectedAt: this.clock.now(),
      },
    });
    await this.audit.recordWithin(tx, {
      actorId: p.actorId, action: 'security.finding.create', resourceType: 'SecurityFinding', resourceId: row.id,
      newState: { type: 'UNAUTHORIZED_CHANGE', terminalId: p.terminalId }, result: 'SUCCESS', correlationId: p.correlationId,
    });
  }

  async list(q: { status?: string; type?: string; page: number; pageSize: number }) {
    const where = { ...(q.status ? { status: q.status } : {}), ...(q.type ? { type: q.type } : {}) };
    const [total, items] = await Promise.all([
      this.prisma.securityFinding.count({ where }),
      this.prisma.securityFinding.findMany({
        where,
        orderBy: [{ detectedAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          certificate: { select: { id: true, subject: true } },
          terminal: { select: { id: true, hostname: true, store: { select: { code: true, country: { select: { code: true } } } } } },
        },
      }),
    ]);
    const open = await this.prisma.securityFinding.findMany({ where: { status: 'OPEN' }, select: { severity: true, type: true } });
    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};
    open.forEach((f) => {
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
      byType[f.type] = (byType[f.type] ?? 0) + 1;
    });
    return { total, page: q.page, pageSize: q.pageSize, items, summary: { open: open.length, bySeverity, byType } };
  }

  async setStatus(id: string, status: 'RESOLVED' | 'DISMISSED', reason: string, actor: AuthUser, correlationId: string) {
    const finding = await this.prisma.securityFinding.findUnique({ where: { id } });
    if (!finding) throw new NotFoundException({ code: 'FINDING_NOT_FOUND', message: 'El hallazgo no existe.' });
    if (finding.status !== 'OPEN') {
      throw new ConflictException({ code: 'FINDING_NOT_OPEN', message: 'El hallazgo ya fue cerrado.' });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.securityFinding.update({ where: { id }, data: { status, resolvedAt: this.clock.now() } });
      await this.audit.recordWithin(tx, {
        actorId: actor.id, action: status === 'RESOLVED' ? 'security.finding.resolve' : 'security.finding.dismiss',
        resourceType: 'SecurityFinding', resourceId: id, previousState: { status: 'OPEN' }, newState: { status },
        result: 'SUCCESS', reason, correlationId,
      });
    });
    return { id, status };
  }

  /** Reevalúa todas las terminales (inventarios desactualizados, cambios de política). */
  async evaluateAll(actor: AuthUser, correlationId: string): Promise<{ created: number; resolved: number }> {
    const terminals = await this.prisma.terminal.findMany({ select: { id: true } });
    const total = { created: 0, resolved: 0 };
    for (const t of terminals) {
      const r = await this.prisma.$transaction((tx) =>
        this.evaluateTerminalWithin(tx, t.id, { actorId: actor.id, correlationId, inventoryComplete: false }),
      );
      total.created += r.created;
      total.resolved += r.resolved;
    }
    return total;
  }
}
