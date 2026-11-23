import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  cancelSchema, createRenewalSchema, createWindowSchema, decideApprovalSchema, listRenewalsQuerySchema,
  requestApprovalSchema, rollbackSchema, scheduleDeploymentSchema, updateRenewalTargetsSchema,
} from '@msh/validation';
import { RenewalsService } from './renewals.service';
import { DeploymentsService } from './deployments.service';
import { CorrelationId, CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthUser } from '../common/request-context';

const uuidPipe = new ParseUUIDPipe();
const approvalsQuery = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'INVALIDATED', 'EXPIRED']).optional() });

@ApiTags('Renovaciones')
@ApiBearerAuth()
@Controller('renewals')
export class RenewalsController {
  constructor(private readonly renewals: RenewalsService) {}

  @Get()
  @RequirePermissions('renewals:read')
  list(@Query(new ZodValidationPipe(listRenewalsQuerySchema)) q: ReturnType<typeof listRenewalsQuerySchema.parse>) {
    return this.renewals.list(q);
  }

  @Get(':id')
  @RequirePermissions('renewals:read')
  detail(@Param('id', uuidPipe) id: string) {
    return this.renewals.detail(id);
  }

  @Post()
  @RequirePermissions('renewals:create')
  create(@Body(new ZodValidationPipe(createRenewalSchema)) b: ReturnType<typeof createRenewalSchema.parse>, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.renewals.create(b, u, c);
  }

  @Post(':id/request-issuance')
  @HttpCode(200)
  @RequirePermissions('renewals:create')
  requestIssuance(@Param('id', uuidPipe) id: string, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.renewals.requestIssuance(id, u, c);
  }

  @Post(':id/issue')
  @HttpCode(200)
  @RequirePermissions('renewals:issue')
  issue(@Param('id', uuidPipe) id: string, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.renewals.issue(id, u, c);
  }

  @Post(':id/request-approval')
  @HttpCode(200)
  @RequirePermissions('renewals:create')
  requestApproval(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(requestApprovalSchema)) b: ReturnType<typeof requestApprovalSchema.parse>, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.renewals.requestApproval(id, b, u, c);
  }

  @Put(':id/targets')
  @RequirePermissions('renewals:create')
  updateTargets(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(updateRenewalTargetsSchema)) b: ReturnType<typeof updateRenewalTargetsSchema.parse>, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.renewals.updateTargets(id, b, u, c);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('renewals:create')
  cancel(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(cancelSchema)) b: ReturnType<typeof cancelSchema.parse>, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.renewals.cancel(id, b.reason, u, c);
  }
}

@ApiTags('Aprobaciones')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly renewals: RenewalsService) {}

  @Get()
  @RequirePermissions('approvals:read')
  list(@Query(new ZodValidationPipe(approvalsQuery)) q: z.infer<typeof approvalsQuery>) {
    return this.renewals.listApprovals(q.status);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @RequirePermissions('approvals:decide')
  decide(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(decideApprovalSchema)) b: ReturnType<typeof decideApprovalSchema.parse>, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.renewals.decide(id, b, u, c);
  }
}

@ApiTags('Instalaciones')
@ApiBearerAuth()
@Controller()
export class DeploymentsController {
  constructor(
    private readonly renewals: RenewalsService,
    private readonly deployments: DeploymentsService,
  ) {}

  @Get('maintenance-windows')
  @RequirePermissions('deployments:read')
  windows() {
    return this.renewals.listWindows();
  }

  @Post('maintenance-windows')
  @RequirePermissions('maintenance:manage')
  createWindow(@Body(new ZodValidationPipe(createWindowSchema)) b: ReturnType<typeof createWindowSchema.parse>, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.renewals.createWindow(b, u, c);
  }

  @Get('deployments')
  @RequirePermissions('deployments:read')
  list() {
    return this.deployments.list();
  }

  @Post('deployments')
  @RequirePermissions('deployments:schedule')
  schedule(@Body(new ZodValidationPipe(scheduleDeploymentSchema)) b: ReturnType<typeof scheduleDeploymentSchema.parse>, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.deployments.schedule(b, u, c);
  }

  @Post('deployments/reconcile')
  @HttpCode(200)
  @RequirePermissions('deployments:execute')
  reconcile(@CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.deployments.reconcile(u, c);
  }

  @Post('deployments/:id/execute')
  @HttpCode(200)
  @RequirePermissions('deployments:execute')
  execute(@Param('id', uuidPipe) id: string, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.deployments.execute(id, u, c);
  }

  @Post('deployments/:id/rollback')
  @HttpCode(200)
  @RequirePermissions('deployments:rollback')
  rollback(@Param('id', uuidPipe) id: string, @Body(new ZodValidationPipe(rollbackSchema)) b: ReturnType<typeof rollbackSchema.parse>, @CurrentUser() u: AuthUser, @CorrelationId() c: string) {
    return this.deployments.rollback(id, b, u, c);
  }
}
