import { Controller, HttpCode, Injectable, Logger, OnModuleDestroy, OnModuleInit, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AlertsService } from '../alerts/alerts.service';
import { AnomalyService } from '../security/anomaly.service';
import { DeploymentsService } from '../renewals/deployments.service';
import { ActorsService } from '../common/actors.service';
import { Clock } from '../common/clock';
import { loadEnv } from '../config/env';
import { CorrelationId, CurrentUser, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/request-context';

/**
 * Motor de vencimientos: evalúa periódicamente los umbrales de alerta, los hallazgos y las instalaciones interrumpidas.
 * Se ejecuta en el proceso de la API con un temporizador; la variante con colas BullMQ/Redis queda pendiente.
 */
@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly alerts: AlertsService,
    private readonly anomalies: AnomalyService,
    private readonly deployments: DeploymentsService,
    private readonly actors: ActorsService,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    const seconds = loadEnv().SCHEDULER_INTERVAL_SECONDS;
    if (seconds <= 0) return;
    this.timer = setInterval(() => {
      void this.actors
        .system()
        .then((system) => this.sweep(system, randomUUID()))
        .catch((e) => this.logger.error(`Falló la evaluación programada: ${e instanceof Error ? e.message : e}`));
    }, seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(actor: AuthUser, correlationId: string) {
    if (this.running) return { skipped: true as const };
    this.running = true;
    try {
      const now = this.clock.now();
      const installs = await this.prisma.certificateInstallation.findMany({
        where: { status: 'PRESENT' }, select: { certificateId: true, terminalId: true },
      });
      let alertsCreated = 0;
      await this.prisma.$transaction(async (tx) => {
        for (const i of installs) {
          const certificate = await tx.certificate.findUniqueOrThrow({ where: { id: i.certificateId }, include: { policy: true, issuer: true } });
          const alert = await this.alerts.evaluateWithin(tx, { certificate, terminalId: i.terminalId, now });
          if (!alert) continue;
          alertsCreated++;
          await this.audit.recordWithin(tx, {
            actorId: actor.id, action: 'alert.create', resourceType: 'Alert', resourceId: alert.id,
            newState: { certificateId: alert.certificateId, terminalId: alert.terminalId, thresholdDays: alert.thresholdDays, priority: alert.priority },
            result: 'SUCCESS', reason: 'Evaluación programada de vencimientos', correlationId,
          });
        }
      });
      const findings = await this.anomalies.evaluateAll(actor, correlationId);
      const reconciled = await this.deployments.reconcile(actor, correlationId);
      return { skipped: false as const, alertsCreated, findingsCreated: findings.created, findingsResolved: findings.resolved, reconciledJobs: reconciled.reconciled };
    } finally {
      this.running = false;
    }
  }
}

@ApiTags('Monitoreo')
@ApiBearerAuth()
@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Post('sweep')
  @HttpCode(200)
  @RequirePermissions('alerts:manage')
  sweep(@CurrentUser() user: AuthUser, @CorrelationId() correlationId: string) {
    return this.monitoring.sweep(user, correlationId);
  }
}
