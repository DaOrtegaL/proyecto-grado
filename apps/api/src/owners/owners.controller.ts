import { Body, ConflictException, Controller, Get, HttpCode, Injectable, NotFoundException, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { assignOwnerSchema, createOwnerSchema } from '@msh/validation';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CorrelationId, CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthUser } from '../common/request-context';

type AssignDto = ReturnType<typeof assignOwnerSchema.parse>;
type CreateOwnerDto = ReturnType<typeof createOwnerSchema.parse>;

/**
 * Asignación de responsables (RF03).
 * Precedencia al resolver el responsable efectivo: certificado > política > emisor (la regla más específica prevalece).
 */
@Injectable()
export class OwnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async overview() {
    const [owners, issuers, policies] = await Promise.all([
      this.prisma.certificateOwner.findMany({ orderBy: { name: 'asc' }, include: { country: { select: { code: true } } } }),
      this.prisma.certificateIssuer.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, kind: true, ownerId: true } }),
      this.prisma.certificatePolicy.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, ownerId: true } }),
    ]);
    return {
      precedence: ['CERTIFICATE', 'POLICY', 'ISSUER'],
      owners: owners.map((o) => ({ id: o.id, name: o.name, email: o.email, countryCode: o.country?.code ?? null })),
      issuers,
      policies,
    };
  }

  async create(dto: CreateOwnerDto, actor: AuthUser, correlationId: string) {
    if (await this.prisma.certificateOwner.findUnique({ where: { email: dto.email } })) {
      throw new ConflictException({ code: 'OWNER_EMAIL_EXISTS', message: 'Ya existe un responsable con ese correo.' });
    }
    const country = dto.countryCode ? await this.prisma.country.findUnique({ where: { code: dto.countryCode } }) : null;
    return this.prisma.$transaction(async (tx) => {
      const owner = await tx.certificateOwner.create({ data: { name: dto.name, email: dto.email, countryId: country?.id ?? null } });
      await this.audit.recordWithin(tx, {
        actorId: actor.id, action: 'owner.create', resourceType: 'CertificateOwner', resourceId: owner.id,
        newState: { name: dto.name, email: dto.email }, result: 'SUCCESS', correlationId,
      });
      return { id: owner.id, name: owner.name, email: owner.email };
    });
  }

  async assign(dto: AssignDto, actor: AuthUser, correlationId: string) {
    if (dto.ownerId && !(await this.prisma.certificateOwner.findUnique({ where: { id: dto.ownerId } }))) {
      throw new NotFoundException({ code: 'OWNER_NOT_FOUND', message: 'El responsable no existe.' });
    }
    return this.prisma.$transaction(async (tx) => {
      let previousOwnerId: string | null;
      let resourceType: string;
      if (dto.scope === 'CERTIFICATE') {
        const row = await tx.certificate.findUnique({ where: { id: dto.targetId } });
        if (!row) throw new NotFoundException({ code: 'CERTIFICATE_NOT_FOUND', message: 'El certificado no existe.' });
        previousOwnerId = row.ownerId;
        await tx.certificate.update({ where: { id: dto.targetId }, data: { ownerId: dto.ownerId } });
        resourceType = 'Certificate';
      } else if (dto.scope === 'POLICY') {
        const row = await tx.certificatePolicy.findUnique({ where: { id: dto.targetId } });
        if (!row) throw new NotFoundException({ code: 'POLICY_NOT_FOUND', message: 'La política no existe.' });
        previousOwnerId = row.ownerId;
        await tx.certificatePolicy.update({ where: { id: dto.targetId }, data: { ownerId: dto.ownerId } });
        resourceType = 'CertificatePolicy';
      } else {
        const row = await tx.certificateIssuer.findUnique({ where: { id: dto.targetId } });
        if (!row) throw new NotFoundException({ code: 'ISSUER_NOT_FOUND', message: 'El emisor no existe.' });
        previousOwnerId = row.ownerId;
        await tx.certificateIssuer.update({ where: { id: dto.targetId }, data: { ownerId: dto.ownerId } });
        resourceType = 'CertificateIssuer';
      }
      await this.audit.recordWithin(tx, {
        actorId: actor.id, action: 'owner.assign', resourceType, resourceId: dto.targetId,
        previousState: { ownerId: previousOwnerId }, newState: { ownerId: dto.ownerId, scope: dto.scope },
        result: 'SUCCESS', reason: dto.reason ?? null, correlationId,
      });
      return { scope: dto.scope, targetId: dto.targetId, ownerId: dto.ownerId };
    });
  }
}

@ApiTags('Responsables')
@ApiBearerAuth()
@Controller('owners')
export class OwnersController {
  constructor(private readonly owners: OwnersService) {}

  @Get()
  @RequirePermissions('owners:read')
  overview() {
    return this.owners.overview();
  }

  @Post()
  @RequirePermissions('owners:manage')
  create(@Body(new ZodValidationPipe(createOwnerSchema)) body: CreateOwnerDto, @CurrentUser() user: AuthUser, @CorrelationId() cid: string) {
    return this.owners.create(body, user, cid);
  }

  @Post('assign')
  @HttpCode(200)
  @RequirePermissions('owners:manage')
  assign(@Body(new ZodValidationPipe(assignOwnerSchema)) body: AssignDto, @CurrentUser() user: AuthUser, @CorrelationId() cid: string) {
    return this.owners.assign(body, user, cid);
  }
}
