import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { buildAlertDedupKey, decideAlert, DEFAULT_ALERT_THRESHOLDS_DAYS } from '@msh/domain';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import type { AuthUser } from '../common/request-context';

export type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

export interface CreatedAlert {
  id: string;
  certificateId: string;
  terminalId: string;
  thresholdDays: number;
  priority: string;
  ownerId: string | null;
}

export interface EvaluationInput {
  certificate: {
    id: string;
    notAfter: Date;
    ownerId: string | null;
    policy: { ownerId: string | null; alertThresholds: string } | null;
    issuer: { ownerId: string | null } | null;
  };
  terminalId: string;
  now: Date;
}

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /**
   * Responsable efectivo (RF03). Precedencia: certificado > política > emisor.
   * La regla más específica prevalece sobre la más general.
   */
  static resolveOwnerId(cert: EvaluationInput['certificate']): string | null {
    return cert.ownerId ?? cert.policy?.ownerId ?? cert.issuer?.ownerId ?? null;
  }

  /** Genera la alerta del umbral cruzado, con deduplicación y escalamiento (RF05). */
  async evaluateWithin(tx: Tx, input: EvaluationInput): Promise<CreatedAlert | null> {
    const { certificate, terminalId, now } = input;
    const thresholds = this.parseThresholds(certificate.policy?.alertThresholds);
    const decision = decideAlert(certificate.notAfter, now, thresholds);
    if (!decision) return null;

    const dedupKey = buildAlertDedupKey(certificate.id, terminalId, decision.thresholdDays);
    if (await tx.alert.findUnique({ where: { dedupKey }, select: { id: true } })) return null;

    // Escalamiento: una alerta de umbral menor reemplaza a las abiertas de umbrales mayores.
    await tx.alert.updateMany({
      where: {
        certificateId: certificate.id,
        terminalId,
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        thresholdDays: { gt: decision.thresholdDays },
      },
      data: { status: 'SUPERSEDED' },
    });

    const ownerId = AlertsService.resolveOwnerId(certificate);
    const alert = await tx.alert.create({
      data: {
        certificateId: certificate.id,
        terminalId,
        thresholdDays: decision.thresholdDays,
        priority: decision.priority,
        ownerId,
        dedupKey,
        notAfter: certificate.notAfter,
        createdAt: now,
      },
    });

    if (ownerId) {
      const owner = await tx.certificateOwner.findUnique({ where: { id: ownerId } });
      if (owner) {
        // Canal interno: la notificación queda disponible en la plataforma; no hay envío externo en el MVP.
        await tx.notification.create({
          data: { alertId: alert.id, channel: 'IN_APP', recipient: owner.email, status: 'SENT', createdAt: now },
        });
      }
    }
    return {
      id: alert.id,
      certificateId: alert.certificateId,
      terminalId,
      thresholdDays: alert.thresholdDays,
      priority: alert.priority,
      ownerId,
    };
  }

  private parseThresholds(raw: string | undefined): number[] {
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.every((n) => Number.isInteger(n) && n > 0)) return parsed;
    } catch {
      /* se usa el valor por defecto */
    }
    return [...DEFAULT_ALERT_THRESHOLDS_DAYS];
  }

  async list(params: { status?: string; page: number; pageSize: number }) {
    const where = params.status ? { status: params.status } : { status: { in: ['OPEN', 'ACKNOWLEDGED'] } };
    const [total, rows] = await Promise.all([
      this.prisma.alert.count({ where }),
      this.prisma.alert.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        include: {
          certificate: { select: { id: true, subject: true, thumbprintSha256: true } },
          terminal: {
            select: {
              id: true,
              hostname: true,
              isSynthetic: true,
              store: { select: { code: true, name: true, country: { select: { code: true, name: true } } } },
            },
          },
          owner: { select: { id: true, name: true, email: true } },
          notifications: { select: { id: true, channel: true, recipient: true, status: true, createdAt: true } },
        },
      }),
    ]);
    const now = this.clock.now().getTime();
    return {
      total,
      page: params.page,
      pageSize: params.pageSize,
      items: rows.map((a) => ({
        ...a,
        daysRemaining: Math.floor((a.notAfter.getTime() - now) / 86_400_000),
      })),
    };
  }

  acknowledge(id: string, actor: AuthUser, reason: string | undefined, correlationId: string) {
    return this.transition(id, 'ACKNOWLEDGED', ['OPEN'], actor, reason, correlationId);
  }

  resolve(id: string, actor: AuthUser, reason: string | undefined, correlationId: string) {
    return this.transition(id, 'RESOLVED', ['OPEN', 'ACKNOWLEDGED'], actor, reason, correlationId);
  }

  private async transition(
    id: string,
    target: 'ACKNOWLEDGED' | 'RESOLVED',
    allowedFrom: string[],
    actor: AuthUser,
    reason: string | undefined,
    correlationId: string,
  ) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException({ code: 'ALERT_NOT_FOUND', message: 'La alerta no existe.' });
    if (!allowedFrom.includes(alert.status)) {
      throw new ConflictException({
        code: 'ALERT_INVALID_TRANSITION',
        message: `La alerta en estado ${alert.status} no puede pasar a ${target}.`,
      });
    }
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.alert.update({
        where: { id },
        data:
          target === 'ACKNOWLEDGED'
            ? { status: target, acknowledgedAt: now, acknowledgedById: actor.id }
            : { status: target, resolvedAt: now },
      });
      await this.audit.recordWithin(tx, {
        actorId: actor.id,
        action: target === 'ACKNOWLEDGED' ? 'alert.acknowledge' : 'alert.resolve',
        resourceType: 'Alert',
        resourceId: id,
        previousState: { status: alert.status },
        newState: { status: target },
        result: 'SUCCESS',
        reason: reason ?? null,
        correlationId,
      });
    });
    return { id, status: target };
  }
}
