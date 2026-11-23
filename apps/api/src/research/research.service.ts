import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MetricComparison, METRIC_CODES, MetricCode, compareValues, mean, percentage, susScore } from '@msh/domain';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { toCsv } from '../common/csv';
import type { AuthUser } from '../common/request-context';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const OPERATIONAL = /^(inventory\.run|alert\.|renewal\.|approval\.|deployment\.|rollback\.|owner\.)/;
const HIGHER_IS_BETTER = new Set<string>(['INVENTORY_COVERAGE', 'ALERT_ANTICIPATION', 'INSTALL_SUCCESS_RATE', 'AUDIT_COMPLETENESS', 'SUS_SCORE']);

export interface MetricResult {
  code: MetricCode;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  sampleSize: number;
  detail?: Record<string, unknown>;
}

@Injectable()
export class ResearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  // ───────────── Cálculo de indicadores (sección 15) ─────────────

  async compute(from: Date, to: Date): Promise<{ metrics: MetricResult[]; byCountry: { code: string; country: string; value: number | null; sampleSize: number }[] }> {
    const range = { gte: from, lte: to };
    const [terminals, scans, alerts, renewals, targets, attempts, audits, incidents, surveys] = await Promise.all([
      this.prisma.terminal.findMany({ select: { id: true, store: { select: { country: { select: { code: true } } } } } }),
      this.prisma.inventoryScan.findMany({ where: { startedAt: range, status: 'SUCCESS' }, select: { terminalId: true } }),
      this.prisma.alert.findMany({ where: { createdAt: range }, select: { certificateId: true, terminalId: true, createdAt: true, notAfter: true, falsePositive: true, terminal: { select: { store: { select: { country: { select: { code: true } } } } } } } }),
      this.prisma.renewalRequest.findMany({ where: { status: 'COMPLETED', completedAt: range }, select: { createdAt: true, completedAt: true } }),
      this.prisma.deploymentTarget.findMany({ where: { job: { createdAt: range }, status: { in: ['VERIFIED', 'FAILED', 'ROLLED_BACK', 'ROLLBACK_FAILED'] } }, select: { status: true } }),
      this.prisma.deploymentAttempt.findMany({ where: { startedAt: range }, select: { outcome: true } }),
      this.prisma.auditEvent.findMany({ where: { occurredAt: range } }),
      this.prisma.incident.findMany({ where: { occurredAt: range, severity: { in: ['P1', 'P2'] } } }),
      this.prisma.usabilitySurvey.findMany({ where: { submittedAt: range }, select: { score: true } }),
    ]);

    const inventoried = new Set(scans.map((s) => s.terminalId));
    const coverage = percentage(terminals.filter((t) => inventoried.has(t.id)).length, terminals.length);

    const earliest = new Map<string, { createdAt: Date; notAfter: Date; country: string }>();
    for (const a of alerts) {
      if (a.createdAt >= a.notAfter) continue; // una alerta posterior al vencimiento no es anticipada
      const cur = earliest.get(a.certificateId);
      if (!cur || a.createdAt < cur.createdAt) earliest.set(a.certificateId, { createdAt: a.createdAt, notAfter: a.notAfter, country: a.terminal.store.country.code });
    }
    const anticipation = [...earliest.values()].map((e) => (e.notAfter.getTime() - e.createdAt.getTime()) / DAY);

    const renewalHours = renewals.filter((r) => r.completedAt).map((r) => (r.completedAt!.getTime() - r.createdAt.getTime()) / HOUR);
    const successTargets = targets.filter((t) => t.status === 'VERIFIED').length;
    const failedAttempts = attempts.filter((a) => a.outcome === 'FAILURE').length;
    const evaluated = alerts.filter((a) => a.falsePositive !== null);
    const falsePositives = evaluated.filter((a) => a.falsePositive === true).length;

    const operational = audits.filter((e) => OPERATIONAL.test(e.action));
    const complete = operational.filter((e) => e.actorId && e.resourceType && e.resourceId && e.result && e.correlationId && e.occurredAt && (e.result !== 'SUCCESS' || e.newState !== null));
    const rangeDays = Math.max(1, (to.getTime() - from.getTime()) / DAY);

    const metrics: MetricResult[] = [
      { code: 'INVENTORY_COVERAGE', value: coverage, numerator: terminals.filter((t) => inventoried.has(t.id)).length, denominator: terminals.length, sampleSize: terminals.length, detail: { knownTerminals: terminals.length, inventoriedTerminals: inventoried.size } },
      { code: 'ALERT_ANTICIPATION', value: mean(anticipation), numerator: null, denominator: null, sampleSize: anticipation.length, detail: { minDays: anticipation.length ? Math.min(...anticipation) : null } },
      { code: 'RENEWAL_TIME', value: mean(renewalHours), numerator: null, denominator: null, sampleSize: renewalHours.length, detail: { meanDays: mean(renewalHours) === null ? null : mean(renewalHours)! / 24 } },
      { code: 'INSTALL_SUCCESS_RATE', value: percentage(successTargets, targets.length), numerator: successTargets, denominator: targets.length, sampleSize: targets.length },
      { code: 'DEPLOYMENT_ERROR_RATE', value: percentage(failedAttempts, attempts.length), numerator: failedAttempts, denominator: attempts.length, sampleSize: attempts.length, detail: { errorsPer100Operations: percentage(failedAttempts, attempts.length) } },
      { code: 'FALSE_POSITIVE_RATE', value: percentage(falsePositives, evaluated.length), numerator: falsePositives, denominator: evaluated.length, sampleSize: evaluated.length },
      { code: 'AUDIT_COMPLETENESS', value: percentage(complete.length, operational.length), numerator: complete.length, denominator: operational.length, sampleSize: operational.length },
      { code: 'INCIDENTS_P1P2', value: incidents.length, numerator: incidents.length, denominator: null, sampleSize: incidents.length, detail: { per30Days: (incidents.length / rangeDays) * 30, periodDays: rangeDays } },
      { code: 'SUS_SCORE', value: mean(surveys.map((s) => s.score)), numerator: null, denominator: null, sampleSize: surveys.length },
    ];

    const countries = await this.prisma.country.findMany({ orderBy: { code: 'asc' } });
    const byCountry = countries.map((c) => {
      const inCountry = terminals.filter((t) => t.store.country.code === c.code);
      const done = inCountry.filter((t) => inventoried.has(t.id)).length;
      return { code: c.code, country: c.name, value: percentage(done, inCountry.length), sampleSize: inCountry.length };
    });
    return { metrics, byCountry };
  }

  definitions() {
    return this.prisma.metricDefinition.findMany({ orderBy: { code: 'asc' } });
  }

  async targets() {
    const rows = await this.prisma.metricTarget.findMany({ orderBy: { metricCode: 'asc' } });
    return rows.map((r) => ({ ...r, preliminary: true }));
  }

  async updateTarget(code: string, dto: { targetValue: number; justification: string; approvalStatus: 'PROPOSED' | 'APPROVED' }, actor: AuthUser, correlationId: string) {
    const target = await this.prisma.metricTarget.findUnique({ where: { metricCode: code } });
    if (!target) throw new NotFoundException({ code: 'TARGET_NOT_FOUND', message: 'La meta no existe.' });
    await this.prisma.$transaction(async (tx) => {
      await tx.metricTarget.update({ where: { metricCode: code }, data: { ...dto, setAt: this.clock.now(), responsible: actor.displayName } });
      await this.audit.recordWithin(tx, {
        actorId: actor.id, action: 'metric_target.update', resourceType: 'MetricTarget', resourceId: code,
        previousState: { targetValue: target.targetValue, approvalStatus: target.approvalStatus },
        newState: { targetValue: dto.targetValue, approvalStatus: dto.approvalStatus }, result: 'SUCCESS', reason: dto.justification, correlationId,
      });
    });
    return { metricCode: code, ...dto };
  }

  // ───────────── Línea base y piloto ─────────────

  async createSnapshot(dto: { kind: 'BASELINE' | 'PILOT'; label: string; periodStart: string; periodEnd: string; notes?: string }, actor: AuthUser, correlationId: string) {
    const from = new Date(dto.periodStart);
    const to = new Date(dto.periodEnd);
    if (to <= from) throw new BadRequestException({ code: 'PERIOD_INVALID', message: 'El periodo debe terminar después de iniciar.' });
    const { metrics, byCountry } = await this.compute(from, to);
    const synthetic = (await this.prisma.terminal.count({ where: { isSynthetic: false } })) === 0;
    return this.prisma.$transaction(async (tx) => {
      const snap = await tx.baselineSnapshot.create({
        data: { kind: dto.kind, label: dto.label, periodStart: from, periodEnd: to, notes: dto.notes ?? null, isSynthetic: synthetic, createdById: actor.id, createdAt: this.clock.now() },
      });
      await tx.metricObservation.createMany({
        data: [
          ...metrics.map((m) => ({ snapshotId: snap.id, metricCode: m.code, value: m.value, numerator: m.numerator, denominator: m.denominator, sampleSize: m.sampleSize })),
          ...byCountry.map((c) => ({ snapshotId: snap.id, metricCode: `INVENTORY_COVERAGE:${c.code}`, value: c.value, numerator: null, denominator: null, sampleSize: c.sampleSize })),
        ],
      });
      await this.audit.recordWithin(tx, {
        actorId: actor.id, action: 'metrics.snapshot', resourceType: 'BaselineSnapshot', resourceId: snap.id,
        newState: { kind: dto.kind, label: dto.label, isSynthetic: synthetic }, result: 'SUCCESS', correlationId,
      });
      return { id: snap.id, kind: snap.kind, label: snap.label, isSynthetic: synthetic };
    });
  }

  listSnapshots() {
    return this.prisma.baselineSnapshot.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  }

  /** Compara línea base y piloto sin atribuir causalidad ni afirmar significancia estadística. */
  async comparison(baselineId: string, pilotId: string) {
    const [baseline, pilot] = await Promise.all([
      this.prisma.baselineSnapshot.findUnique({ where: { id: baselineId }, include: { observations: true } }),
      this.prisma.baselineSnapshot.findUnique({ where: { id: pilotId }, include: { observations: true } }),
    ]);
    if (!baseline || !pilot) throw new NotFoundException({ code: 'SNAPSHOT_NOT_FOUND', message: 'No se encontró alguna de las instantáneas.' });
    if (baseline.kind !== 'BASELINE' || pilot.kind !== 'PILOT') {
      throw new ConflictException({ code: 'SNAPSHOT_KIND_INVALID', message: 'Debe compararse una línea base contra un piloto.' });
    }
    const find = (s: typeof baseline, code: string) => s.observations.find((o) => o.metricCode === code);
    const rows = METRIC_CODES.map((code) => {
      const b = find(baseline, code);
      const p = find(pilot, code);
      const cmp: MetricComparison = compareValues(code, { value: b?.value ?? null, sampleSize: b?.sampleSize ?? 0 }, { value: p?.value ?? null, sampleSize: p?.sampleSize ?? 0 });
      const better = HIGHER_IS_BETTER.has(code);
      let interpretation = 'Sin datos suficientes en alguna de las dos mediciones.';
      if (cmp.absoluteChange !== null) {
        interpretation = cmp.absoluteChange === 0 ? 'No se observa variación entre las mediciones.'
          : (cmp.absoluteChange > 0) === better ? 'Variación observada en sentido favorable.' : 'Variación observada en sentido desfavorable.';
      }
      const limitations: string[] = ['Diseño preexperimental antes-después: no se atribuye causalidad.'];
      if (Math.min(cmp.baselineSample, cmp.pilotSample) < 30) limitations.push('Muestra menor a 30 observaciones; no se afirma significancia estadística.');
      if (baseline.isSynthetic || pilot.isSynthetic) limitations.push('Incluye datos sintéticos de laboratorio.');
      return { ...cmp, direction: better ? 'HIGHER_IS_BETTER' : 'LOWER_IS_BETTER', periodBaseline: [baseline.periodStart, baseline.periodEnd], periodPilot: [pilot.periodStart, pilot.periodEnd], interpretation, limitations };
    });
    const pairs = baseline.observations
      .filter((o) => o.metricCode.startsWith('INVENTORY_COVERAGE:'))
      .map((o) => ({ unit: o.metricCode.split(':')[1], baseline: o.value, pilot: find(pilot, o.metricCode)?.value ?? null }));
    return {
      baseline: { id: baseline.id, label: baseline.label, isSynthetic: baseline.isSynthetic },
      pilot: { id: pilot.id, label: pilot.label, isSynthetic: pilot.isSynthetic },
      rows,
      pairedObservations: pairs,
      statisticalNote: 'La prueba de rangos con signo de Wilcoxon podría aplicarse a los pares por país si se cumplen sus supuestos y hay datos suficientes; este módulo no declara significancia estadística.',
    };
  }

  async comparisonCsv(baselineId: string, pilotId: string): Promise<string> {
    const c = await this.comparison(baselineId, pilotId);
    return toCsv(
      ['Unidad', 'Indicador', 'Línea base', 'Piloto', 'Origen de datos'],
      [
        ...c.rows.map((r) => ['Global', r.metricCode, r.baseline, r.pilot, c.baseline.isSynthetic || c.pilot.isSynthetic ? 'Sintético' : 'Autorizado']),
        ...c.pairedObservations.map((p) => [p.unit, 'INVENTORY_COVERAGE', p.baseline, p.pilot, c.baseline.isSynthetic || c.pilot.isSynthetic ? 'Sintético' : 'Autorizado']),
      ],
    );
  }

  // ───────────── Incidentes, SUS, muestra ─────────────

  listIncidents() {
    return this.prisma.incident.findMany({ orderBy: { occurredAt: 'desc' }, take: 200 });
  }

  async createIncident(dto: { severity: string; title: string; occurredAt: string; resolvedAt?: string; certificateId?: string; terminalId?: string; countryCode?: string; period: string }, actor: AuthUser, correlationId: string) {
    const synthetic = (await this.prisma.terminal.count({ where: { isSynthetic: false } })) === 0;
    return this.prisma.$transaction(async (tx) => {
      const inc = await tx.incident.create({
        data: {
          severity: dto.severity, title: dto.title, occurredAt: new Date(dto.occurredAt), resolvedAt: dto.resolvedAt ? new Date(dto.resolvedAt) : null,
          certificateId: dto.certificateId ?? null, terminalId: dto.terminalId ?? null, countryCode: dto.countryCode ?? null, period: dto.period,
          isSynthetic: synthetic, createdById: actor.id, createdAt: this.clock.now(),
        },
      });
      await this.audit.recordWithin(tx, { actorId: actor.id, action: 'incident.create', resourceType: 'Incident', resourceId: inc.id, newState: { severity: dto.severity, period: dto.period }, result: 'SUCCESS', correlationId });
      return inc;
    });
  }

  async submitSurvey(dto: { respondentRole: string; answers: number[] }, actor: AuthUser, correlationId: string) {
    const score = susScore(dto.answers);
    const synthetic = (await this.prisma.terminal.count({ where: { isSynthetic: false } })) === 0;
    await this.prisma.$transaction(async (tx) => {
      const s = await tx.usabilitySurvey.create({ data: { respondentRole: dto.respondentRole, answers: JSON.stringify(dto.answers), score, isSynthetic: synthetic, submittedAt: this.clock.now(), createdById: actor.id } });
      await this.audit.recordWithin(tx, { actorId: actor.id, action: 'sus.submit', resourceType: 'UsabilitySurvey', resourceId: s.id, newState: { score }, result: 'SUCCESS', correlationId });
    });
    return { score };
  }

  async surveyResults() {
    const rows = await this.prisma.usabilitySurvey.findMany({ orderBy: { submittedAt: 'desc' } });
    return {
      count: rows.length, mean: mean(rows.map((r) => r.score)),
      items: rows.map((r) => ({ id: r.id, respondentRole: r.respondentRole, score: r.score, answers: JSON.parse(r.answers), isSynthetic: r.isSynthetic, submittedAt: r.submittedAt })),
    };
  }

  listSamples() {
    return this.prisma.researchSample.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createSample(dto: { countries: string[]; storesCount: number; terminalsCount: number; certificatesObserved: number; informants: number; ticketsAnalyzed: number; periodStart: string; periodEnd: string; inclusionCriteria: string; exclusionCriteria: string }, actor: AuthUser, correlationId: string) {
    const synthetic = (await this.prisma.terminal.count({ where: { isSynthetic: false } })) === 0;
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.researchSample.create({
        data: { ...dto, countries: dto.countries.join(','), periodStart: new Date(dto.periodStart), periodEnd: new Date(dto.periodEnd), isSynthetic: synthetic, createdAt: this.clock.now() },
      });
      await this.audit.recordWithin(tx, { actorId: actor.id, action: 'research_sample.create', resourceType: 'ResearchSample', resourceId: s.id, newState: { terminalsCount: dto.terminalsCount }, result: 'SUCCESS', correlationId });
      return s;
    });
  }

  // ───────────── Registro experimental y TRL ─────────────

  listRuns() {
    return this.prisma.experimentalRun.findMany({ orderBy: { ranAt: 'desc' }, take: 200, include: { evidence: { select: { id: true, kind: true, description: true } } } });
  }

  async createRun(dto: { code: string; objective: string; requirementCode: string; scenario: string; environment: string; sample: string; parameters: Record<string, unknown>; expectedResult: string; obtainedResult: string; metrics: Record<string, unknown>; status: string; limitations: string; trlLevel?: number; isSynthetic: boolean }, actor: AuthUser, correlationId: string, evidence: { kind: string; description: string; content: string }[] = []) {
    if (await this.prisma.experimentalRun.findUnique({ where: { code: dto.code } })) {
      throw new ConflictException({ code: 'RUN_CODE_EXISTS', message: 'Ya existe una ejecución con ese código.' });
    }
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.experimentalRun.create({
        data: {
          code: dto.code, objective: dto.objective, requirementCode: dto.requirementCode, scenario: dto.scenario, ranAt: this.clock.now(),
          environment: dto.environment, operatorId: actor.id, sample: dto.sample, parameters: JSON.stringify(dto.parameters), expectedResult: dto.expectedResult,
          obtainedResult: dto.obtainedResult, metrics: JSON.stringify(dto.metrics), status: dto.status, limitations: dto.limitations,
          trlLevel: dto.trlLevel ?? null, isSynthetic: dto.isSynthetic, correlationId,
        },
      });
      for (const e of evidence) await tx.testEvidence.create({ data: { runId: run.id, kind: e.kind, description: e.description, content: e.content, createdAt: this.clock.now() } });
      await this.audit.recordWithin(tx, { actorId: actor.id, action: 'experiment.record', resourceType: 'ExperimentalRun', resourceId: run.id, newState: { code: dto.code, status: dto.status }, result: 'SUCCESS', correlationId });
      return run;
    });
  }

  async exportRun(id: string, format: 'json' | 'csv' | 'md') {
    const run = await this.prisma.experimentalRun.findUnique({ where: { id }, include: { evidence: true } });
    if (!run) throw new NotFoundException({ code: 'RUN_NOT_FOUND', message: 'La ejecución experimental no existe.' });
    const origin = run.isSynthetic ? 'SINTÉTICO' : 'AUTORIZADO';
    const base = { ...run, parameters: JSON.parse(run.parameters), metrics: JSON.parse(run.metrics), dataOrigin: origin };
    if (format === 'json') return { contentType: 'application/json; charset=utf-8', ext: 'json', body: JSON.stringify(base, null, 2) };
    if (format === 'csv') {
      return { contentType: 'text/csv; charset=utf-8', ext: 'csv', body: toCsv(['Código', 'Requisito', 'Escenario', 'Fecha (UTC)', 'Entorno', 'Origen de datos', 'Estado', 'Resultado esperado', 'Resultado obtenido', 'Limitaciones'], [[run.code, run.requirementCode, run.scenario, run.ranAt, run.environment, origin, run.status, run.expectedResult, run.obtainedResult, run.limitations]]) };
    }
    const md = [
      `# Registro experimental ${run.code}`, '', `> Origen de los datos: **${origin}**.`, '',
      `- Objetivo: ${run.objective}`, `- Requisito: ${run.requirementCode}`, `- Escenario: ${run.scenario}`, `- Fecha (UTC): ${run.ranAt.toISOString()}`,
      `- Entorno: ${run.environment}`, `- Muestra: ${run.sample}`, `- Estado: ${run.status}`, '',
      `## Resultado esperado\n${run.expectedResult}`, '', `## Resultado obtenido\n${run.obtainedResult}`, '',
      '## Parámetros', '```json', JSON.stringify(base.parameters, null, 2), '```', '', '## Métricas', '```json', JSON.stringify(base.metrics, null, 2), '```', '',
      '## Evidencias', ...(run.evidence.length ? run.evidence.map((e) => `- **${e.kind}**: ${e.description}`) : ['Sin evidencias adjuntas.']), '',
      `## Limitaciones\n${run.limitations}`, '',
    ].join('\n');
    return { contentType: 'text/markdown; charset=utf-8', ext: 'md', body: md };
  }

  /** El nivel TRL no se declara automáticamente: solo se informan las ejecuciones aprobadas por nivel. */
  async trl() {
    const runs = await this.prisma.experimentalRun.findMany({ where: { trlLevel: { not: null } }, select: { code: true, trlLevel: true, status: true, isSynthetic: true, requirementCode: true } });
    const criteria = [
      { level: 2, title: 'Concepto tecnológico, requisitos, arquitectura propuesta y modelo de datos', minPassedRuns: 0 },
      { level: 3, title: 'Prueba de concepto funcional con ejecución experimental reproducible', minPassedRuns: 3 },
      { level: 4, title: 'Validación del subsistema en entorno relevante y controlado, con evaluación de seguridad', minPassedRuns: 8 },
    ];
    return {
      statement: 'El nivel de madurez (TRL) no se declara por haber implementado código; requiere evidencia experimental aprobada y revisión del evaluador.',
      criteria: criteria.map((c) => {
        const levelRuns = runs.filter((r) => r.trlLevel === c.level);
        const passed = levelRuns.filter((r) => r.status === 'PASSED');
        return { ...c, runs: levelRuns.length, passedRuns: passed.length, passedWithoutSyntheticOnly: passed.filter((r) => !r.isSynthetic).length, evidenceSufficient: passed.length >= c.minPassedRuns && c.level > 2, note: passed.every((r) => r.isSynthetic) && passed.length ? 'Toda la evidencia es sintética (laboratorio).' : null };
      }),
    };
  }

  // ───────────── Trazabilidad ─────────────

  listTraceability() {
    return this.prisma.traceabilityItem.findMany({ orderBy: { requirementCode: 'asc' } });
  }

  async updateTraceability(code: string, dto: { status: string; testCase?: string; testResult?: string; evidenceRunId?: string }, actor: AuthUser, correlationId: string) {
    const item = await this.prisma.traceabilityItem.findUnique({ where: { requirementCode: code } });
    if (!item) throw new NotFoundException({ code: 'REQUIREMENT_NOT_FOUND', message: 'El requisito no existe.' });
    if (dto.status === 'VALIDATED') {
      const runId = dto.evidenceRunId ?? item.evidenceRunId;
      const run = runId ? await this.prisma.experimentalRun.findUnique({ where: { id: runId } }) : null;
      if (!run || run.status !== 'PASSED' || run.requirementCode !== code) {
        throw new ConflictException({ code: 'EVIDENCE_REQUIRED', message: 'Un requisito solo puede marcarse como validado con una ejecución experimental aprobada que lo respalde.' });
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.traceabilityItem.update({
        where: { requirementCode: code },
        data: { status: dto.status, testCase: dto.testCase ?? item.testCase, testResult: dto.testResult ?? item.testResult, evidenceRunId: dto.evidenceRunId ?? item.evidenceRunId, updatedAt: this.clock.now() },
      });
      await this.audit.recordWithin(tx, { actorId: actor.id, action: 'traceability.update', resourceType: 'TraceabilityItem', resourceId: code, previousState: { status: item.status }, newState: { status: dto.status }, result: 'SUCCESS', correlationId });
    });
    return { requirementCode: code, status: dto.status };
  }
}
