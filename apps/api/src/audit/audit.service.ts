import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AUDIT_GENESIS_HASH,
  AuditEventPayload,
  AuditResult,
  ChainedAuditEvent,
  computeAuditHash,
  verifyAuditChain,
} from '@msh/domain';
import { PrismaService } from '../prisma/prisma.service';
import { Clock } from '../common/clock';

export interface AuditInput {
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  previousState?: unknown;
  newState?: unknown;
  result: AuditResult;
  reason?: string | null;
  correlationId: string;
  approvalId?: string | null;
}

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** Registra un evento dentro de una transacción propia. */
  async record(input: AuditInput): Promise<void> {
    await this.prisma.$transaction((tx) => this.recordWithin(tx, input), { timeout: 15000 });
  }

  /**
   * Registra un evento dentro de una transacción existente.
   * Un bloqueo de aplicación serializa la escritura de la cadena para garantizar un único predecesor.
   */
  async recordWithin(tx: Tx, input: AuditInput): Promise<void> {
    await tx.$executeRaw`DECLARE @r INT; EXEC @r = sp_getapplock @Resource = N'msh_audit_chain', @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 15000; IF @r < 0 THROW 50001, 'No se pudo obtener el bloqueo de auditoría', 1;`;

    const last = await tx.auditEvent.findFirst({
      orderBy: { sequence: 'desc' },
      select: { hash: true },
    });
    const previousHash = last?.hash ?? AUDIT_GENESIS_HASH;
    const occurredAt = this.clock.now();
    // Se normaliza a JSON puro para que el hash calculado coincida con el que se recalcula al verificar.
    const previousState = input.previousState === undefined ? null : JSON.parse(JSON.stringify(input.previousState));
    const newState = input.newState === undefined ? null : JSON.parse(JSON.stringify(input.newState));

    // La secuencia es una columna de identidad: se inserta con un hash provisional y se completa luego.
    const created = await tx.auditEvent.create({
      data: {
        occurredAt,
        actorId: input.actorId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        previousState: previousState === null ? null : JSON.stringify(previousState),
        newState: newState === null ? null : JSON.stringify(newState),
        result: input.result,
        reason: input.reason ?? null,
        correlationId: input.correlationId,
        approvalId: input.approvalId ?? null,
        previousHash,
        hash: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
      },
    });

    const payload: AuditEventPayload = {
      sequence: created.sequence,
      occurredAt: created.occurredAt,
      actorId: created.actorId,
      action: created.action,
      resourceType: created.resourceType,
      resourceId: created.resourceId,
      previousState,
      newState,
      result: input.result,
      reason: created.reason,
      correlationId: created.correlationId,
      approvalId: created.approvalId,
    };
    await tx.auditEvent.update({
      where: { sequence: created.sequence },
      data: { hash: computeAuditHash(previousHash, payload) },
    });
  }

  /** Registro tolerante a fallos para flujos de denegación: nunca debe ocultar el error original. */
  async recordSafely(input: AuditInput): Promise<void> {
    try {
      await this.record(input);
    } catch (error) {
      this.logger.error(
        `No se pudo registrar el evento de auditoría ${input.action}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async verify() {
    const rows = await this.prisma.auditEvent.findMany({ orderBy: { sequence: 'asc' } });
    const chain: ChainedAuditEvent[] = rows.map((r) => ({
      sequence: r.sequence,
      occurredAt: r.occurredAt,
      actorId: r.actorId,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      previousState: r.previousState ? JSON.parse(r.previousState) : null,
      newState: r.newState ? JSON.parse(r.newState) : null,
      result: r.result as AuditResult,
      reason: r.reason,
      correlationId: r.correlationId,
      approvalId: r.approvalId,
      previousHash: r.previousHash,
      hash: r.hash,
    }));
    return verifyAuditChain(chain);
  }

  async list(params: { page: number; pageSize: number; action?: string; resourceType?: string }) {
    const where = {
      ...(params.action ? { action: params.action } : {}),
      ...(params.resourceType ? { resourceType: params.resourceType } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { sequence: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
    return { total, page: params.page, pageSize: params.pageSize, items };
  }
}
