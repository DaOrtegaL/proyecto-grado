import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { CorrelationId, CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthUser } from '../common/request-context';

const configSchema = z.object({ value: z.string().min(1).max(500), reason: z.string().min(5).max(500) });
const WRITABLE_KEYS = new Set(['approval.separationOfDuties', 'approval.validityHours']);

@ApiTags('Administración')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  @Get('users')
  @RequirePermissions('admin:read')
  async users() {
    const users = await this.prisma.user.findMany({ orderBy: { email: 'asc' }, include: { roles: { include: { role: true } } } });
    // Nunca se devuelve el hash de contraseña.
    return users.map((u) => ({ id: u.id, email: u.email, displayName: u.displayName, isActive: u.isActive, isSynthetic: u.isSynthetic, roles: u.roles.map((r) => r.role.code) }));
  }

  @Get('roles')
  @RequirePermissions('admin:read')
  async roles() {
    const roles = await this.prisma.role.findMany({ orderBy: { code: 'asc' }, include: { permissions: { include: { permission: true } } } });
    return roles.map((r) => ({ code: r.code, description: r.description, permissions: r.permissions.map((p) => p.permission.code).sort() }));
  }

  @Get('policies')
  @RequirePermissions('admin:read')
  async policies() {
    const [certificatePolicies, config] = await Promise.all([
      this.prisma.certificatePolicy.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.configurationPolicy.findMany({ orderBy: { key: 'asc' } }),
    ]);
    return { certificatePolicies, config };
  }

  @Put('config/:key')
  @RequirePermissions('users:manage')
  async setConfig(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(configSchema)) body: z.infer<typeof configSchema>,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    if (!WRITABLE_KEYS.has(key)) throw new BadRequestException({ code: 'CONFIG_KEY_INVALID', message: 'La clave de configuración no es modificable.' });
    const current = await this.prisma.configurationPolicy.findUnique({ where: { key } });
    if (!current) throw new NotFoundException({ code: 'CONFIG_NOT_FOUND', message: 'La política de configuración no existe.' });
    await this.prisma.$transaction(async (tx) => {
      await tx.configurationPolicy.update({ where: { key }, data: { value: body.value, updatedAt: this.clock.now() } });
      await this.audit.recordWithin(tx, {
        actorId: user.id, action: 'config.update', resourceType: 'ConfigurationPolicy', resourceId: key,
        previousState: { value: current.value }, newState: { value: body.value }, result: 'SUCCESS', reason: body.reason, correlationId,
      });
    });
    return { key, value: body.value };
  }
}
