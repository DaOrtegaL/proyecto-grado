import { Injectable, NotFoundException } from '@nestjs/common';
import { classifyValidity, InventoryReport } from '@msh/domain';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { toCsv } from '../common/csv';
import type { AuthUser } from '../common/request-context';

export type EvidenceFormat = 'json' | 'csv' | 'md';

interface InventoryEvidence {
  schema: string;
  dataOrigin: string;
  generatedAtUtc: string;
  scan: {
    id: string;
    status: string;
    source: string;
    startedAtUtc: string;
    finishedAtUtc: string | null;
    correlationId: string;
    certificatesFound: number;
    newCertificates: number;
    missingCertificates: number;
    alertsCreated: number;
  };
  terminal: { hostname: string; model: string; store: string; country: string };
  findings: { kind: string; detail: string }[];
  certificates: (InventoryReport['certificates'][number] & { status: string; daysRemaining: number | null })[];
  alerts: { id: string; thresholdDays: number; priority: string; status: string; certificate: string; owner: string | null }[];
  auditEvents: { sequence: number; occurredAt: string; action: string; resourceType: string; resourceId: string | null; result: string }[];
  auditChainVerification: { valid: boolean; checked: number };
}

/** Genera la evidencia exportable de una ejecución de inventario (JSON, CSV o Markdown). */
@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async exportScan(scanId: string, format: EvidenceFormat, actor: AuthUser, correlationId: string) {
    const scan = await this.prisma.inventoryScan.findUnique({
      where: { id: scanId },
      include: {
        findings: { orderBy: { createdAt: 'asc' } },
        terminal: { include: { model: true, store: { include: { country: true } } } },
      },
    });
    if (!scan) throw new NotFoundException({ code: 'SCAN_NOT_FOUND', message: 'La ejecución de inventario no existe.' });

    const report: InventoryReport | null = scan.reportJson ? JSON.parse(scan.reportJson) : null;
    const generatedAt = this.clock.now();
    const alerts = await this.prisma.alert.findMany({
      where: { terminalId: scan.terminalId, createdAt: { gte: scan.startedAt } },
      include: { certificate: { select: { subject: true } }, owner: { select: { name: true, email: true } } },
    });
    const auditEvents = await this.prisma.auditEvent.findMany({
      where: { correlationId: scan.correlationId },
      orderBy: { sequence: 'asc' },
      select: { sequence: true, occurredAt: true, action: true, resourceType: true, resourceId: true, result: true, hash: true },
    });
    const chain = await this.audit.verify();

    const certificates = (report?.certificates ?? []).map((c) => ({
      ...c,
      ...classifyValidity(new Date(c.notAfter), scan.startedAt),
    }));
    const dataOrigin = scan.terminal.isSynthetic ? 'SINTÉTICO' : 'AUTORIZADO';

    const evidence: InventoryEvidence = {
      schema: 'msh-clm/evidencia-inventario/1.0',
      generatedAtUtc: generatedAt.toISOString(),
      dataOrigin,
      scan: {
        id: scan.id,
        status: scan.status,
        source: scan.source,
        startedAtUtc: scan.startedAt.toISOString(),
        finishedAtUtc: scan.finishedAt?.toISOString() ?? null,
        correlationId: scan.correlationId,
        certificatesFound: scan.certificatesFound,
        newCertificates: scan.newCertificates,
        missingCertificates: scan.missingCertificates,
        alertsCreated: scan.alertsCreated,
      },
      terminal: {
        hostname: scan.terminal.hostname,
        model: `${scan.terminal.model.vendor} ${scan.terminal.model.name}`,
        store: scan.terminal.store.code,
        country: scan.terminal.store.country.code,
      },
      findings: scan.findings.map((f) => ({ kind: f.kind, detail: f.detail })),
      certificates,
      alerts: alerts.map((a) => ({
        id: a.id,
        thresholdDays: a.thresholdDays,
        priority: a.priority,
        status: a.status,
        certificate: a.certificate.subject,
        owner: a.owner ? `${a.owner.name} <${a.owner.email}>` : null,
      })),
      auditEvents: auditEvents.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() })),
      auditChainVerification: chain,
    };

    await this.audit.recordSafely({
      actorId: actor.id,
      action: 'evidence.export',
      resourceType: 'InventoryScan',
      resourceId: scan.id,
      newState: { format },
      result: 'SUCCESS',
      correlationId,
    });

    if (format === 'json') return { contentType: 'application/json; charset=utf-8', extension: 'json', body: JSON.stringify(evidence, null, 2) };
    if (format === 'csv') return { contentType: 'text/csv; charset=utf-8', extension: 'csv', body: this.toCsv(evidence) };
    return { contentType: 'text/markdown; charset=utf-8', extension: 'md', body: this.toMarkdown(evidence) };
  }

  private toCsv(e: InventoryEvidence): string {
    return toCsv(
      ['Terminal', 'Origen de datos', 'Huella SHA-256', 'Sujeto', 'Emisor', 'Vence (UTC)', 'Estado', 'Días restantes', 'Almacén', 'Clave privada presente'],
      e.certificates.map((c) => [
        e.terminal.hostname, e.dataOrigin, c.thumbprintSha256, c.subject, c.issuer, c.notAfter,
        c.status, c.daysRemaining, `${c.storeLocation}\\${c.storeName}`, c.hasPrivateKey ? 'Sí' : 'No',
      ]),
    );
  }

  private toMarkdown(e: InventoryEvidence): string {
    const row = (cells: unknown[]) => `| ${cells.map((c) => String(c ?? '').replace(/\|/g, '\\|')).join(' | ')} |`;
    return [
      `# Evidencia de inventario — ${e.terminal.hostname}`,
      '',
      `> Origen de los datos: **${e.dataOrigin}**. ${e.dataOrigin === 'SINTÉTICO' ? 'Estos resultados provienen del simulador y no representan infraestructura productiva.' : ''}`,
      '',
      `- Generado (UTC): ${e.generatedAtUtc}`,
      `- Ejecución: ${e.scan.id} (estado: ${e.scan.status}, fuente: ${e.scan.source})`,
      `- Inicio (UTC): ${e.scan.startedAtUtc}`,
      `- Identificador de correlación: ${e.scan.correlationId}`,
      `- Terminal: ${e.terminal.hostname} — ${e.terminal.model} — tienda ${e.terminal.store} (${e.terminal.country})`,
      `- Certificados encontrados: ${e.scan.certificatesFound}; nuevos: ${e.scan.newCertificates}; ausentes: ${e.scan.missingCertificates}; alertas generadas: ${e.scan.alertsCreated}`,
      '',
      '## Certificados observados',
      '',
      row(['Sujeto', 'Emisor', 'Vence (UTC)', 'Estado', 'Días restantes', 'Almacén']),
      row(['---', '---', '---', '---', '---', '---']),
      ...e.certificates.map((c) => row([c.subject, c.issuer, c.notAfter, c.status, c.daysRemaining, `${c.storeLocation}\\${c.storeName}`])),
      '',
      '## Hallazgos',
      '',
      ...(e.findings.length ? e.findings.map((f) => `- **${f.kind}**: ${f.detail}`) : ['Sin hallazgos.']),
      '',
      '## Alertas generadas',
      '',
      ...(e.alerts.length
        ? e.alerts.map((a) => `- Umbral ${a.thresholdDays} días, prioridad ${a.priority}, estado ${a.status}, responsable: ${a.owner ?? 'sin asignar'} — ${a.certificate}`)
        : ['No se generaron alertas.']),
      '',
      '## Eventos de auditoría asociados',
      '',
      row(['Secuencia', 'Fecha (UTC)', 'Acción', 'Recurso', 'Resultado']),
      row(['---', '---', '---', '---', '---']),
      ...e.auditEvents.map((a) => row([a.sequence, a.occurredAt, a.action, `${a.resourceType}/${a.resourceId ?? ''}`, a.result])),
      '',
      `Verificación de la cadena de auditoría: ${e.auditChainVerification.valid ? 'íntegra' : 'INCONSISTENTE'} (${e.auditChainVerification.checked} eventos revisados).`,
      '',
      '_Limitación: la cadena detecta alteraciones internas, pero no reemplaza el almacenamiento inmutable externo._',
      '',
    ].join('\n');
  }
}
