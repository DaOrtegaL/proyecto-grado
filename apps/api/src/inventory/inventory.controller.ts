import { Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { evidenceQuerySchema, listCertificatesQuerySchema } from '@msh/validation';
import { InventoryService } from './inventory.service';
import { CertificatesService } from './certificates.service';
import { GeoService } from './geo.service';
import { EvidenceService } from './evidence.service';
import { CorrelationId, CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthUser } from '../common/request-context';

const terminalsQuerySchema = z.object({
  countryCode: z.string().length(2).optional(),
  storeId: z.string().uuid().optional(),
});

@ApiTags('Inventario')
@ApiBearerAuth()
@Controller()
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly certificates: CertificatesService,
    private readonly geo: GeoService,
    private readonly evidence: EvidenceService,
  ) {}

  @Get('countries')
  @RequirePermissions('geo:read')
  countries() {
    return this.geo.listCountries();
  }

  @Get('issuers')
  @RequirePermissions('certificates:read')
  issuers() {
    return this.geo.listIssuers();
  }

  @Get('terminals')
  @RequirePermissions('geo:read')
  terminals(@Query(new ZodValidationPipe(terminalsQuerySchema)) q: z.infer<typeof terminalsQuerySchema>) {
    return this.geo.listTerminals(q);
  }

  @Get('terminals/:id')
  @RequirePermissions('geo:read')
  terminal(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.geo.terminalDetail(id);
  }

  @Post('terminals/:id/inventory')
  @RequirePermissions('inventory:run')
  runInventory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.inventory.runInventory(id, user, correlationId);
  }

  @Get('certificates')
  @RequirePermissions('certificates:read')
  list(@Query(new ZodValidationPipe(listCertificatesQuerySchema)) q: ReturnType<typeof listCertificatesQuerySchema.parse>) {
    return this.certificates.list(q);
  }

  @Get('certificates/export')
  @RequirePermissions('certificates:export')
  async exportCertificates(
    @Query(new ZodValidationPipe(listCertificatesQuerySchema)) q: ReturnType<typeof listCertificatesQuerySchema.parse>,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.certificates.exportCsv(q, user, correlationId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="inventario-certificados.csv"');
    return new StreamableFile(Buffer.from(csv, 'utf8'));
  }

  @Get('certificates/:id')
  @RequirePermissions('certificates:read')
  detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.certificates.detail(id);
  }

  @Get('inventory/scans/:id/evidence')
  @RequirePermissions('evidence:export')
  async scanEvidence(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(evidenceQuerySchema)) q: ReturnType<typeof evidenceQuerySchema.parse>,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.evidence.exportScan(id, q.format, user, correlationId);
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="evidencia-inventario-${id}.${out.extension}"`);
    return new StreamableFile(Buffer.from(out.body, 'utf8'));
  }
}
