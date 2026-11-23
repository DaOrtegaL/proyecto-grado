import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { alertActionSchema, listAlertsQuerySchema } from '@msh/validation';
import { AlertsService } from './alerts.service';
import { CorrelationId, CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthUser } from '../common/request-context';

@ApiTags('Alertas')
@ApiBearerAuth()
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  @RequirePermissions('alerts:read')
  list(@Query(new ZodValidationPipe(listAlertsQuerySchema)) query: ReturnType<typeof listAlertsQuerySchema.parse>) {
    return this.alerts.list(query);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  @RequirePermissions('alerts:manage')
  acknowledge(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(alertActionSchema)) body: ReturnType<typeof alertActionSchema.parse>,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.alerts.acknowledge(id, user, body.reason, correlationId);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermissions('alerts:manage')
  resolve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(alertActionSchema)) body: ReturnType<typeof alertActionSchema.parse>,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.alerts.resolve(id, user, body.reason, correlationId);
  }
}
