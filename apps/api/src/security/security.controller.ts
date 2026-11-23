import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, HttpCode, Injectable,
  NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createPublicKey } from 'node:crypto';
import type { RawBodyRequest } from '@nestjs/common';
import { isTimestampFresh, verifyAgentSignature } from '@msh/domain';
import { findingActionSchema, inventoryReportSchema, listFindingsQuerySchema, registerAgentSchema } from '@msh/validation';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { ActorsService } from '../common/actors.service';
import { InventoryService } from '../inventory/inventory.service';
import { AnomalyService } from './anomaly.service';
import { CorrelationId, CurrentUser, Public, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AppRequest, AuthUser } from '../common/request-context';

interface GatewayInput {
  agentId?: string;
  timestamp?: string;
  nonce?: string;
  signature?: string;
  body: string;
}

/** Gateway de agentes: identidad por terminal (Ed25519), marca de tiempo, nonce único e idempotencia (sección 11.3). */
@Injectable()
export class AgentGatewayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly actors: ActorsService,
    private readonly inventory: InventoryService,
  ) {}

  private async deny(code: string, message: string, status: 401 | 403 | 409, agentId: string | null, reason: string, correlationId: string) {
    const system = await this.actors.system();
    await this.audit.recordSafely({
      actorId: system.id, action: 'agent.inventory', resourceType: 'AgentIdentity', resourceId: agentId,
      result: 'DENIED', reason, correlationId,
    });
    const payload = { code, message };
    if (status === 401) throw new UnauthorizedException(payload);
    if (status === 403) throw new ForbiddenException(payload);
    throw new ConflictException(payload);
  }

  async handle(input: GatewayInput, correlationId: string) {
    const { agentId, timestamp, nonce, signature, body } = input;
    if (!agentId || !timestamp || !nonce || !signature || !/^[0-9a-f-]{36}$/i.test(agentId) || nonce.length > 100) {
      throw new BadRequestException({ code: 'AGENT_HEADERS_INVALID', message: 'Faltan o son inválidas las cabeceras de identidad del agente.' });
    }
    const agent = await this.prisma.agentIdentity.findUnique({ where: { id: agentId }, include: { terminal: true } });
    if (!agent || !agent.isActive) {
      return this.deny('AGENT_IDENTITY_INVALID', 'La identidad del agente no es válida.', 401, null, 'Agente desconocido o inactivo', correlationId);
    }
    const now = this.clock.now();
    if (!isTimestampFresh(timestamp, now)) {
      return this.deny('AGENT_TIMESTAMP_INVALID', 'La marca de tiempo está fuera de la ventana permitida.', 401, agent.id, 'Marca de tiempo fuera de ventana', correlationId);
    }
    if (!verifyAgentSignature(agent.publicKeyPem, { agentId, timestamp, nonce, signatureBase64: signature, body })) {
      return this.deny('AGENT_SIGNATURE_INVALID', 'La firma del agente no es válida.', 401, agent.id, 'Firma inválida', correlationId);
    }

    // El nonce único por agente impide el reenvío; un segundo intento no vuelve a ingerir el reporte.
    let nonceId: string;
    try {
      nonceId = (await this.prisma.agentNonce.create({ data: { agentId: agent.id, nonce, receivedAt: now } })).id;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        return this.deny('AGENT_REPLAY_DETECTED', 'La solicitud ya fue procesada (nonce repetido).', 409, agent.id, 'Reenvío detectado', correlationId);
      }
      throw error;
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'El cuerpo no es un JSON válido.' });
    }
    const report = inventoryReportSchema.safeParse(parsedBody);
    if (!report.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'El reporte de inventario no cumple el contrato.' });
    }
    if (report.data.hostname.toLowerCase() !== agent.terminal.hostname.toLowerCase()) {
      return this.deny('AGENT_TERMINAL_MISMATCH', 'El agente no está autorizado para reportar esta terminal.', 403, agent.id, 'El hostname no corresponde a la terminal asociada', correlationId);
    }

    const system = await this.actors.system();
    const result = await this.inventory.ingestReport(agent.terminalId, report.data as never, system, correlationId);
    await this.prisma.agentNonce.update({ where: { id: nonceId }, data: { scanId: result.scanId } });
    return result;
  }
}

@ApiTags('Agentes')
@Controller('agent/v1')
export class AgentGatewayController {
  constructor(private readonly gateway: AgentGatewayService) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('inventory')
  @HttpCode(201)
  inventory(
    @Req() req: RawBodyRequest<AppRequest>,
    @Headers('x-agent-id') agentId: string | undefined,
    @Headers('x-timestamp') timestamp: string | undefined,
    @Headers('x-nonce') nonce: string | undefined,
    @Headers('x-signature') signature: string | undefined,
    @CorrelationId() correlationId: string,
  ) {
    return this.gateway.handle({ agentId, timestamp, nonce, signature, body: req.rawBody?.toString('utf8') ?? '' }, correlationId);
  }
}

@ApiTags('Agentes')
@ApiBearerAuth()
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('agents:manage')
  list() {
    return this.prisma.agentIdentity.findMany({
      select: { id: true, terminalId: true, isActive: true, createdAt: true, terminal: { select: { hostname: true } } },
    });
  }

  @Post()
  @RequirePermissions('agents:manage')
  async register(
    @Body(new ZodValidationPipe(registerAgentSchema)) body: ReturnType<typeof registerAgentSchema.parse>,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    try {
      if (createPublicKey(body.publicKeyPem).asymmetricKeyType !== 'ed25519') throw new Error('tipo');
    } catch {
      throw new BadRequestException({ code: 'AGENT_KEY_INVALID', message: 'Se requiere una clave pública Ed25519 válida.' });
    }
    if (!(await this.prisma.terminal.findUnique({ where: { id: body.terminalId } }))) {
      throw new NotFoundException({ code: 'TERMINAL_NOT_FOUND', message: 'La terminal no existe.' });
    }
    if (await this.prisma.agentIdentity.findUnique({ where: { terminalId: body.terminalId } })) {
      throw new ConflictException({ code: 'AGENT_ALREADY_REGISTERED', message: 'La terminal ya tiene un agente registrado.' });
    }
    const agent = await this.prisma.$transaction(async (tx) => {
      const created = await tx.agentIdentity.create({ data: { terminalId: body.terminalId, publicKeyPem: body.publicKeyPem } });
      await this.audit.recordWithin(tx, {
        actorId: user.id, action: 'agent.register', resourceType: 'AgentIdentity', resourceId: created.id,
        newState: { terminalId: body.terminalId }, result: 'SUCCESS', correlationId,
      });
      return created;
    });
    return { id: agent.id, terminalId: agent.terminalId };
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions('agents:manage')
  async deactivate(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser, @CorrelationId() correlationId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.agentIdentity.update({ where: { id }, data: { isActive: false } });
      await this.audit.recordWithin(tx, {
        actorId: user.id, action: 'agent.deactivate', resourceType: 'AgentIdentity', resourceId: id,
        newState: { isActive: false }, result: 'SUCCESS', correlationId,
      });
    });
    return { id, isActive: false };
  }
}

@ApiTags('Seguridad y anomalías')
@ApiBearerAuth()
@Controller('security')
export class SecurityController {
  constructor(private readonly anomalies: AnomalyService) {}

  @Get('findings')
  @RequirePermissions('security:read')
  list(@Query(new ZodValidationPipe(listFindingsQuerySchema)) q: ReturnType<typeof listFindingsQuerySchema.parse>) {
    return this.anomalies.list(q);
  }

  @Post('findings/:id/resolve')
  @HttpCode(200)
  @RequirePermissions('security:manage')
  resolve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(findingActionSchema)) body: ReturnType<typeof findingActionSchema.parse>,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.anomalies.setStatus(id, 'RESOLVED', body.reason, user, correlationId);
  }

  @Post('findings/:id/dismiss')
  @HttpCode(200)
  @RequirePermissions('security:manage')
  dismiss(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(findingActionSchema)) body: ReturnType<typeof findingActionSchema.parse>,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.anomalies.setStatus(id, 'DISMISSED', body.reason, user, correlationId);
  }

  @Post('evaluate')
  @HttpCode(200)
  @RequirePermissions('security:manage')
  evaluate(@CurrentUser() user: AuthUser, @CorrelationId() correlationId: string) {
    return this.anomalies.evaluateAll(user, correlationId);
  }
}
