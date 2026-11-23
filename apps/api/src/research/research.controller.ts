import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  comparisonQuerySchema, createIncidentSchema, createRunSchema, createSampleSchema, createSnapshotSchema, metricsRangeSchema,
  runExportQuerySchema, susSubmitSchema, traceabilityUpdateSchema, updateTargetSchema,
} from '@msh/validation';
import { SUS_QUESTIONS } from '@msh/domain';
import { ResearchService } from './research.service';
import { Clock } from '../common/clock';
import { CorrelationId, CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthUser } from '../common/request-context';

@ApiTags('Indicadores e investigación')
@ApiBearerAuth()
@Controller()
export class ResearchController {
  constructor(
    private readonly research: ResearchService,
    private readonly clock: Clock,
  ) {}

  // Indicadores
  @Get('metrics/definitions') @RequirePermissions('metrics:read')
  definitions() { return this.research.definitions(); }

  @Get('metrics/targets') @RequirePermissions('metrics:read')
  targets() { return this.research.targets(); }

  @Put('metrics/targets/:code') @RequirePermissions('metrics:manage')
  updateTarget(@Param('code') code: string, @Body(new ZodValidationPipe(updateTargetSchema)) b: ReturnType<typeof updateTargetSchema.parse>, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.research.updateTarget(code, b, u, c);
  }

  @Get('metrics/current') @RequirePermissions('metrics:read')
  current(@Query(new ZodValidationPipe(metricsRangeSchema)) q: ReturnType<typeof metricsRangeSchema.parse>) {
    const to = q.to ? new Date(q.to) : this.clock.now();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
    return this.research.compute(from, to).then((r) => ({ from, to, ...r }));
  }

  @Get('metrics/snapshots') @RequirePermissions('metrics:read')
  snapshots() { return this.research.listSnapshots(); }

  @Post('metrics/snapshots') @RequirePermissions('metrics:manage')
  createSnapshot(@Body(new ZodValidationPipe(createSnapshotSchema)) b: ReturnType<typeof createSnapshotSchema.parse>, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.research.createSnapshot(b, u, c);
  }

  @Get('metrics/comparison') @RequirePermissions('metrics:read')
  comparison(@Query(new ZodValidationPipe(comparisonQuerySchema)) q: ReturnType<typeof comparisonQuerySchema.parse>) {
    return this.research.comparison(q.baselineId, q.pilotId);
  }

  @Get('metrics/comparison/export') @RequirePermissions('metrics:read')
  async comparisonExport(@Query(new ZodValidationPipe(comparisonQuerySchema)) q: ReturnType<typeof comparisonQuerySchema.parse>, @Res({ passthrough: true }) res: Response) {
    const csv = await this.research.comparisonCsv(q.baselineId, q.pilotId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="observaciones-pareadas.csv"');
    return new StreamableFile(Buffer.from(csv, 'utf8'));
  }

  // Incidentes, SUS y muestra
  @Get('incidents') @RequirePermissions('metrics:read')
  incidents() { return this.research.listIncidents(); }

  @Post('incidents') @RequirePermissions('metrics:manage')
  createIncident(@Body(new ZodValidationPipe(createIncidentSchema)) b: ReturnType<typeof createIncidentSchema.parse>, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.research.createIncident(b, u, c);
  }

  @Get('sus/questions') @RequirePermissions('dashboard:read')
  questions() { return { questions: SUS_QUESTIONS }; }

  @Post('sus') @RequirePermissions('dashboard:read')
  submitSurvey(@Body(new ZodValidationPipe(susSubmitSchema)) b: ReturnType<typeof susSubmitSchema.parse>, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.research.submitSurvey(b, u, c);
  }

  @Get('sus/results') @RequirePermissions('metrics:read')
  surveyResults() { return this.research.surveyResults(); }

  @Get('research/samples') @RequirePermissions('research:read')
  samples() { return this.research.listSamples(); }

  @Post('research/samples') @RequirePermissions('research:manage')
  createSample(@Body(new ZodValidationPipe(createSampleSchema)) b: ReturnType<typeof createSampleSchema.parse>, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.research.createSample(b, u, c);
  }

  // Registro experimental, TRL y trazabilidad
  @Get('research/runs') @RequirePermissions('research:read')
  runs() { return this.research.listRuns(); }

  @Post('research/runs') @RequirePermissions('research:manage')
  createRun(@Body(new ZodValidationPipe(createRunSchema)) b: ReturnType<typeof createRunSchema.parse>, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.research.createRun(b, u, c);
  }

  @Get('research/runs/:id/export') @RequirePermissions('research:read')
  async exportRun(@Param('id', new ParseUUIDPipe()) id: string, @Query(new ZodValidationPipe(runExportQuerySchema)) q: ReturnType<typeof runExportQuerySchema.parse>, @Res({ passthrough: true }) res: Response) {
    const out = await this.research.exportRun(id, q.format);
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="experimento-${id}.${out.ext}"`);
    return new StreamableFile(Buffer.from(out.body, 'utf8'));
  }

  @Get('research/trl') @RequirePermissions('research:read')
  trl() { return this.research.trl(); }

  @Get('traceability') @RequirePermissions('research:read')
  traceability() { return this.research.listTraceability(); }

  @Put('traceability/:code') @RequirePermissions('research:manage')
  updateTraceability(@Param('code') code: string, @Body(new ZodValidationPipe(traceabilityUpdateSchema)) b: ReturnType<typeof traceabilityUpdateSchema.parse>, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.research.updateTraceability(code, b, u, c);
  }
}
