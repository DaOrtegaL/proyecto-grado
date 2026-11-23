import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AdapterDisabledError,
  InventoryReport,
  TerminalInventoryPort,
} from '@msh/domain';
import { inventoryReportSchema } from '@msh/validation';
import { SimulatedPosAdapter, SimulatedStateReader, SimulatedTerminalState, FailureMode } from '@msh/simulated-pos';
import { WindowsCertificateStoreAdapter } from '@msh/windows-pos';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AlertsService, CreatedAlert, Tx } from '../alerts/alerts.service';
import { AnomalyService } from '../security/anomaly.service';
import { Clock } from '../common/clock';
import type { AuthUser } from '../common/request-context';

export interface InventoryRunResult {
  scanId: string;
  terminalId: string;
  hostname: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  certificatesFound: number;
  newCertificates: number;
  changedCertificates: number;
  missingCertificates: number;
  alertsCreated: number;
  errors: { store: string; message: string }[];
}

class PrismaSimulatedState implements SimulatedStateReader {
  constructor(private readonly prisma: PrismaService) {}

  async read(terminalId: string): Promise<SimulatedTerminalState> {
    const state = await this.prisma.simulatedTerminalState.findUnique({
      where: { terminalId },
      include: { slots: true },
    });
    return {
      failureMode: (state?.failureMode ?? 'NONE') as FailureMode,
      slots: (state?.slots ?? []).map((s) => ({
        pem: s.pem,
        storeLocation: s.storeLocation,
        storeName: s.storeName,
        hasPrivateKey: s.hasPrivateKey,
      })),
    };
  }
}

const slotKey = (location: string, store: string) => `${location}\\${store}`;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly alerts: AlertsService,
    private readonly anomalies: AnomalyService,
    private readonly clock: Clock,
  ) {}

  private adapterFor(source: string): TerminalInventoryPort {
    if (source === 'SIMULATED') {
      return new SimulatedPosAdapter(new PrismaSimulatedState(this.prisma), () => this.clock.now());
    }
    // Los adaptadores reales permanecen deshabilitados hasta contar con autorización (RF08).
    return new WindowsCertificateStoreAdapter({ enabled: false });
  }

  /** Ejecuta el inventario de una terminal (RF01/RF02) y persiste resultados, alertas y auditoría. */
  async runInventory(terminalId: string, actor: AuthUser, correlationId: string): Promise<InventoryRunResult> {
    const terminal = await this.prisma.terminal.findUnique({ where: { id: terminalId } });
    if (!terminal) throw new NotFoundException({ code: 'TERMINAL_NOT_FOUND', message: 'La terminal no existe.' });

    const startedAt = this.clock.now();
    let report: InventoryReport;
    try {
      report = await this.adapterFor(terminal.source).collect({ id: terminal.id, hostname: terminal.hostname });
    } catch (error) {
      if (error instanceof AdapterDisabledError) {
        await this.audit.recordSafely({
          actorId: actor.id,
          action: 'inventory.run',
          resourceType: 'Terminal',
          resourceId: terminal.id,
          result: 'DENIED',
          reason: error.message,
          correlationId,
        });
        throw new ConflictException({
          code: 'ADAPTER_DISABLED',
          message: 'El modo de laboratorio autorizado está deshabilitado para esta terminal.',
        });
      }
      return this.recordFailure(terminal, actor, startedAt, correlationId, error);
    }

    const parsed = inventoryReportSchema.safeParse(report);
    if (!parsed.success) {
      return this.recordFailure(terminal, actor, startedAt, correlationId, new Error('El reporte de inventario no cumple el contrato.'));
    }
    return this.ingest(terminal, parsed.data as InventoryReport, actor, startedAt, correlationId);
  }

  /** Ingresa un reporte producido por una fuente externa (agente PowerShell) ya autenticada. */
  async ingestReport(terminalId: string, report: InventoryReport, actor: AuthUser, correlationId: string) {
    const terminal = await this.prisma.terminal.findUnique({ where: { id: terminalId } });
    if (!terminal) throw new NotFoundException({ code: 'TERMINAL_NOT_FOUND', message: 'La terminal no existe.' });
    const parsed = inventoryReportSchema.safeParse(report);
    if (!parsed.success) {
      return this.recordFailure(terminal, actor, this.clock.now(), correlationId, new Error('El reporte de inventario no cumple el contrato.'));
    }
    return this.ingest(terminal, parsed.data as InventoryReport, actor, this.clock.now(), correlationId);
  }

  private async recordFailure(
    terminal: { id: string; hostname: string; source: string },
    actor: AuthUser,
    startedAt: Date,
    correlationId: string,
    error: unknown,
  ): Promise<InventoryRunResult> {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    const finishedAt = this.clock.now();
    const scan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.inventoryScan.create({
        data: {
          terminalId: terminal.id,
          requestedById: actor.id,
          status: 'FAILED',
          source: terminal.source,
          startedAt,
          finishedAt,
          errorSummary: message,
          correlationId,
        },
      });
      await tx.inventoryFinding.create({
        data: { scanId: created.id, kind: 'ERROR', detail: message.slice(0, 500) },
      });
      await tx.terminal.update({ where: { id: terminal.id }, data: { status: 'OFFLINE' } });
      await this.audit.recordWithin(tx, {
        actorId: actor.id,
        action: 'inventory.run',
        resourceType: 'Terminal',
        resourceId: terminal.id,
        result: 'FAILURE',
        reason: message,
        newState: { scanId: created.id, status: 'FAILED' },
        correlationId,
      });
      return created;
    });
    return {
      scanId: scan.id,
      terminalId: terminal.id,
      hostname: terminal.hostname,
      status: 'FAILED',
      certificatesFound: 0,
      newCertificates: 0,
      changedCertificates: 0,
      missingCertificates: 0,
      alertsCreated: 0,
      errors: [{ store: '*', message }],
    };
  }

  private async ingest(
    terminal: { id: string; hostname: string; source: string; isSynthetic: boolean },
    report: InventoryReport,
    actor: AuthUser,
    startedAt: Date,
    correlationId: string,
  ): Promise<InventoryRunResult> {
    const now = this.clock.now();
    const status: 'SUCCESS' | 'PARTIAL' = report.errors.length > 0 ? 'PARTIAL' : 'SUCCESS';

    return this.prisma.$transaction(
      async (tx: Tx) => {
        // Serializa las ingestas: certificados compartidos entre terminales no deben crearse en paralelo.
        await tx.$executeRaw`DECLARE @r INT; EXEC @r = sp_getapplock @Resource = N'msh_inventory_ingest', @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 30000; IF @r < 0 THROW 50002, 'No se pudo obtener el bloqueo de inventario', 1;`;
        const scan = await tx.inventoryScan.create({
          data: {
            terminalId: terminal.id,
            requestedById: actor.id,
            status,
            source: report.source,
            startedAt,
            correlationId,
            reportJson: JSON.stringify(report),
            errorSummary: report.errors.length ? JSON.stringify(report.errors) : null,
          },
        });

        const [issuers, defaultPolicy, existing] = await Promise.all([
          tx.certificateIssuer.findMany(),
          tx.certificatePolicy.findFirst({ orderBy: { name: 'asc' } }),
          tx.certificateInstallation.findMany({
            where: { terminalId: terminal.id },
            include: { certificate: { select: { id: true, subject: true } } },
          }),
        ]);
        const issuerByDn = new Map(issuers.map((i) => [i.subjectDn, i.id]));
        const existingBySlot = new Map(
          existing.map((i) => [`${i.certificateId}|${slotKey(i.storeLocation, i.storeName)}`, i]),
        );

        const seen = new Set<string>();
        const counters = { found: 0, newOnes: 0, changed: 0, missing: 0 };
        const evaluations: { certId: string; installationId: string }[] = [];
        const findings: { certificateId: string | null; kind: string; detail: string }[] = [];
        const alertsCreated: CreatedAlert[] = [];
        const replacedCerts: { certId: string; subject: string }[] = [];

        for (const meta of report.certificates) {
          counters.found++;
          let cert = await tx.certificate.findUnique({ where: { thumbprintSha256: meta.thumbprintSha256 } });
          if (!cert) {
            cert = await tx.certificate.create({
              data: {
                thumbprintSha256: meta.thumbprintSha256,
                subject: meta.subject,
                issuerDn: meta.issuer,
                serialNumber: meta.serialNumber,
                notBefore: new Date(meta.notBefore),
                notAfter: new Date(meta.notAfter),
                publicKeyAlgorithm: meta.publicKeyAlgorithm,
                keySizeBits: meta.keySizeBits,
                signatureAlgorithm: meta.signatureAlgorithm,
                keyUsage: JSON.stringify(meta.keyUsage),
                extendedKeyUsage: JSON.stringify(meta.extendedKeyUsage),
                issuerId: issuerByDn.get(meta.issuer) ?? null,
                policyId: defaultPolicy?.id ?? null,
                isSynthetic: terminal.isSynthetic,
                discoveredAt: now,
                lastVerifiedAt: now,
              },
            });
            await tx.certificateHistory.create({
              data: {
                certificateId: cert.id,
                change: 'DISCOVERED',
                details: JSON.stringify({ terminal: terminal.hostname, source: report.source }),
                correlationId,
                createdAt: now,
              },
            });
          } else {
            await tx.certificate.update({ where: { id: cert.id }, data: { lastVerifiedAt: now } });
          }

          const key = `${cert.id}|${slotKey(meta.storeLocation, meta.storeName)}`;
          seen.add(key);
          const slotLabel = slotKey(meta.storeLocation, meta.storeName);
          const prior = existingBySlot.get(key);
          let installationId: string;

          if (!prior) {
            // Un reemplazo se detecta cuando otro certificado con el mismo subject ocupaba el almacén.
            const replaced = existing.find(
              (i) =>
                i.status === 'PRESENT' &&
                slotKey(i.storeLocation, i.storeName) === slotLabel &&
                i.certificate.subject === meta.subject &&
                i.certificateId !== cert!.id,
            );
            const created = await tx.certificateInstallation.create({
              data: {
                certificateId: cert.id,
                terminalId: terminal.id,
                storeLocation: meta.storeLocation,
                storeName: meta.storeName,
                hasPrivateKey: meta.hasPrivateKey,
                firstSeenAt: now,
                lastSeenAt: now,
              },
            });
            installationId = created.id;
            if (replaced) {
              counters.changed++;
              replacedCerts.push({ certId: cert.id, subject: meta.subject });
              findings.push({ certificateId: cert.id, kind: 'CHANGED', detail: `Certificado reemplazado en ${slotLabel}` });
            } else {
              counters.newOnes++;
              findings.push({ certificateId: cert.id, kind: 'NEW', detail: `Certificado nuevo en ${slotLabel}` });
            }
          } else {
            installationId = prior.id;
            await tx.certificateInstallation.update({
              where: { id: prior.id },
              data: { lastSeenAt: now, status: 'PRESENT', hasPrivateKey: meta.hasPrivateKey },
            });
            if (prior.status === 'MISSING') {
              counters.changed++;
              findings.push({ certificateId: cert.id, kind: 'CHANGED', detail: `Certificado reapareció en ${slotLabel}` });
            }
          }
          evaluations.push({ certId: cert.id, installationId });
        }

        // Almacenes con error de lectura no se interpretan como ausencia de certificados.
        const unreadable = new Set(report.errors.map((e) => e.store));
        for (const inst of existing) {
          const key = `${inst.certificateId}|${slotKey(inst.storeLocation, inst.storeName)}`;
          if (inst.status === 'PRESENT' && !seen.has(key) && !unreadable.has(inst.storeName)) {
            await tx.certificateInstallation.update({ where: { id: inst.id }, data: { status: 'MISSING' } });
            counters.missing++;
            findings.push({
              certificateId: inst.certificateId,
              kind: 'MISSING',
              detail: `Certificado ausente en ${slotKey(inst.storeLocation, inst.storeName)}`,
            });
          }
        }
        for (const e of report.errors) {
          findings.push({ certificateId: null, kind: 'ERROR', detail: `${e.store}: ${e.message}`.slice(0, 500) });
        }

        for (const ev of evaluations) {
          const cert = await tx.certificate.findUniqueOrThrow({
            where: { id: ev.certId },
            include: { policy: true, issuer: true },
          });
          const alert = await this.alerts.evaluateWithin(tx, { certificate: cert, terminalId: terminal.id, now });
          if (alert) alertsCreated.push(alert);
        }

        if (findings.length) {
          await tx.inventoryFinding.createMany({
            data: findings.map((f) => ({ ...f, scanId: scan.id, createdAt: now })),
          });
        }
        await tx.inventoryScan.update({
          where: { id: scan.id },
          data: {
            finishedAt: this.clock.now(),
            certificatesFound: counters.found,
            newCertificates: counters.newOnes,
            changedCertificates: counters.changed,
            missingCertificates: counters.missing,
            alertsCreated: alertsCreated.length,
          },
        });
        await tx.terminal.update({ where: { id: terminal.id }, data: { status: 'ONLINE', lastInventoryAt: now } });

        // Un reemplazo sin despliegue reciente asociado se marca para revisión (RF12).
        if (replacedCerts.length) {
          const since = new Date(now.getTime() - 24 * 3_600_000);
          const authorized = await tx.deploymentTarget.findFirst({
            where: { terminalId: terminal.id, job: { startedAt: { gte: since } } },
          });
          if (!authorized) {
            for (const r of replacedCerts) {
              await this.anomalies.flagUnauthorizedChangeWithin(tx, {
                terminalId: terminal.id, certificateId: r.certId, subject: r.subject, actorId: actor.id, correlationId,
              });
            }
          }
        }
        await this.anomalies.evaluateTerminalWithin(tx, terminal.id, {
          actorId: actor.id, correlationId, inventoryComplete: status === 'SUCCESS',
        });

        // Auditoría al final de la transacción para mantener breve el bloqueo de la cadena.
        await this.audit.recordWithin(tx, {
          actorId: actor.id,
          action: 'inventory.run',
          resourceType: 'Terminal',
          resourceId: terminal.id,
          result: 'SUCCESS',
          newState: {
            scanId: scan.id,
            status,
            certificatesFound: counters.found,
            newCertificates: counters.newOnes,
            missingCertificates: counters.missing,
            alertsCreated: alertsCreated.length,
          },
          correlationId,
        });
        for (const alert of alertsCreated) {
          await this.audit.recordWithin(tx, {
            actorId: actor.id,
            action: 'alert.create',
            resourceType: 'Alert',
            resourceId: alert.id,
            newState: {
              certificateId: alert.certificateId,
              terminalId: alert.terminalId,
              thresholdDays: alert.thresholdDays,
              priority: alert.priority,
              ownerId: alert.ownerId,
            },
            result: 'SUCCESS',
            correlationId,
          });
        }

        return {
          scanId: scan.id,
          terminalId: terminal.id,
          hostname: terminal.hostname,
          status,
          certificatesFound: counters.found,
          newCertificates: counters.newOnes,
          changedCertificates: counters.changed,
          missingCertificates: counters.missing,
          alertsCreated: alertsCreated.length,
          errors: report.errors,
        };
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
  }
}
