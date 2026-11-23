import { BadRequestException, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import { toCsv } from './common/csv';
import { ZodValidationPipe } from './common/zod-validation.pipe';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from './common/decorators';
import { AuthGuard } from './auth/auth.guard';
import { AlertsService } from './alerts/alerts.service';
import { AuditService } from './audit/audit.service';
import { loadEnv } from './config/env';

describe('CSV seguro (RF02, RNF)', () => {
  it('neutraliza inyección de fórmulas y escapa comillas', () => {
    const csv = toCsv(['a', 'b'], [['=cmd|calc', 'dice "hola", ok'], ['+1', '@x']]);
    expect(csv).toContain("'=cmd|calc");
    expect(csv).toContain('"dice ""hola"", ok"');
    expect(csv).toContain("'+1");
    expect(csv).toContain("'@x");
  });
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.object({ n: z.coerce.number().int().min(1) }));
  it('acepta y transforma entradas válidas', () => {
    expect(pipe.transform({ n: '3' })).toEqual({ n: 3 });
  });
  it('rechaza entradas inválidas con código y mensaje en español', () => {
    try {
      pipe.transform({ n: 'x' });
      fail('debía lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getResponse()).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });
});

describe('loadEnv', () => {
  it('falla si un secreto JWT es demasiado corto', () => {
    expect(() =>
      loadEnv({ DATABASE_URL: 'x', JWT_ACCESS_SECRET: 'corto', JWT_REFRESH_SECRET: 'corto' } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/Configuración de entorno inválida/);
  });
  it('aplica valores por defecto seguros: modo simulación y laboratorio deshabilitado', () => {
    const env = loadEnv({
      DATABASE_URL: 'x',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
    } as unknown as NodeJS.ProcessEnv);
    expect(env.EXECUTION_MODE).toBe('SIMULATION');
    expect(env.LAB_MODE_ENABLED).toBe(false);
  });
});

describe('AuthGuard (RNF02, RNF03)', () => {
  const user = { id: 'u1', email: 'a@b.c', displayName: 'A', roles: ['VIEWER'], permissions: ['dashboard:read'] };
  const audit = { recordSafely: jest.fn() };
  const build = (verify: () => Promise<unknown>, meta: Record<string, unknown>) => {
    const reflector = { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector;
    const guard = new AuthGuard(reflector, { verifyAccess: verify } as never, audit as never);
    const req: Record<string, unknown> = { headers: {}, method: 'GET', path: '/x', correlationId: 'corr-1' };
    const ctx = {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { guard, req, ctx };
  };
  beforeEach(() => audit.recordSafely.mockClear());

  it('permite rutas públicas sin token', async () => {
    const { guard, ctx } = build(async () => user, { [IS_PUBLIC_KEY]: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
  it('rechaza solicitudes sin token', async () => {
    const { guard, ctx } = build(async () => user, {});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rechaza tokens inválidos o expirados', async () => {
    const { guard, req, ctx } = build(async () => { throw new Error('expired'); }, {});
    (req.headers as Record<string, string>).authorization = 'Bearer abc';
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('bloquea con 403 y registra auditoría DENIED cuando faltan permisos', async () => {
    const { guard, req, ctx } = build(async () => user, { [PERMISSIONS_KEY]: ['inventory:run'] });
    (req.headers as Record<string, string>).authorization = 'Bearer abc';
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'access.denied', result: 'DENIED', actorId: 'u1', correlationId: 'corr-1' }),
    );
  });
  it('permite cuando el usuario posee todos los permisos requeridos', async () => {
    const { guard, req, ctx } = build(async () => user, { [PERMISSIONS_KEY]: ['dashboard:read'] });
    (req.headers as Record<string, string>).authorization = 'Bearer abc';
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(audit.recordSafely).not.toHaveBeenCalled();
  });
});

describe('AlertsService.evaluateWithin (RF03, RF05)', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);
  const cert = (days: number, extra: Partial<Parameters<AlertsService['evaluateWithin']>[1]['certificate']> = {}) => ({
    id: 'c1',
    notAfter: inDays(days),
    ownerId: null,
    policy: null,
    issuer: { ownerId: 'o-issuer' },
    ...extra,
  });
  const makeTx = (existingDedup: string[] = []) => {
    const created: unknown[] = [];
    const tx = {
      alert: {
        findUnique: jest.fn(async ({ where }: { where: { dedupKey: string } }) =>
          existingDedup.includes(where.dedupKey) ? { id: 'x' } : null,
        ),
        updateMany: jest.fn(async () => ({ count: 1 })),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: 'a1', ...data };
        }),
      },
      certificateOwner: { findUnique: jest.fn(async () => ({ id: 'o-issuer', email: 'pki@msh.lab' })) },
      notification: { create: jest.fn(async () => ({})) },
    };
    return { tx, created };
  };
  const service = new AlertsService({} as never, {} as never, {} as never);

  it('crea la alerta del umbral cruzado y notifica al responsable', async () => {
    const { tx } = makeTx();
    const alert = await service.evaluateWithin(tx as never, { certificate: cert(25), terminalId: 't1', now });
    expect(alert).toMatchObject({ thresholdDays: 30, priority: 'MEDIUM', ownerId: 'o-issuer' });
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
  });
  it('no duplica una alerta ya existente (deduplicación)', async () => {
    const { tx } = makeTx(['c1:t1:30']);
    expect(await service.evaluateWithin(tx as never, { certificate: cert(25), terminalId: 't1', now })).toBeNull();
    expect(tx.alert.create).not.toHaveBeenCalled();
  });
  it('escala reemplazando alertas abiertas de umbrales mayores', async () => {
    const { tx } = makeTx();
    await service.evaluateWithin(tx as never, { certificate: cert(5), terminalId: 't1', now });
    expect(tx.alert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'SUPERSEDED' }, where: expect.objectContaining({ thresholdDays: { gt: 7 } }) }),
    );
  });
  it('no genera alertas para certificados con vencimiento lejano', async () => {
    const { tx } = makeTx();
    expect(await service.evaluateWithin(tx as never, { certificate: cert(200), terminalId: 't1', now })).toBeNull();
  });
  it('crea la alerta sin responsable y sin notificación cuando no hay asignación', async () => {
    const { tx } = makeTx();
    const alert = await service.evaluateWithin(tx as never, {
      certificate: cert(3, { issuer: null }),
      terminalId: 't1',
      now,
    });
    expect(alert?.ownerId).toBeNull();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });
  it('aplica la precedencia de responsables: certificado > política > emisor', () => {
    expect(AlertsService.resolveOwnerId(cert(10, { ownerId: 'o-cert', policy: { ownerId: 'o-pol', alertThresholds: '[]' } }))).toBe('o-cert');
    expect(AlertsService.resolveOwnerId(cert(10, { policy: { ownerId: 'o-pol', alertThresholds: '[]' } }))).toBe('o-pol');
    expect(AlertsService.resolveOwnerId(cert(10))).toBe('o-issuer');
  });
});

describe('AuditService — cadena hash (RF10)', () => {
  function fakePrisma() {
    const rows: Record<string, any>[] = [];
    let seq = 0;
    const tx: any = {
      $executeRaw: jest.fn(async () => 0),
      auditEvent: {
        findFirst: jest.fn(async () => (rows.length ? { hash: rows[rows.length - 1].hash } : null)),
        create: jest.fn(async ({ data }: any) => {
          const row = { sequence: ++seq, ...data };
          rows.push(row);
          return { ...row };
        }),
        update: jest.fn(async ({ where, data }: any) => {
          Object.assign(rows.find((r) => r.sequence === where.sequence)!, data);
        }),
      },
    };
    const prisma: any = {
      $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
      auditEvent: { findMany: jest.fn(async () => rows.map((r) => ({ ...r }))) },
    };
    return { prisma, rows };
  }
  const clock = { now: () => new Date('2026-06-01T12:00:00.123Z') } as never;

  it('registra eventos encadenados y la verificación es íntegra', async () => {
    const { prisma } = fakePrisma();
    const audit = new AuditService(prisma, clock);
    for (let i = 0; i < 4; i++) {
      await audit.record({
        actorId: 'u1',
        action: 'inventory.run',
        resourceType: 'Terminal',
        resourceId: `t${i}`,
        newState: { i, nested: { b: 2, a: 1 } },
        result: 'SUCCESS',
        correlationId: `c${i}`,
      });
    }
    expect(await audit.verify()).toEqual({ valid: true, checked: 4 });
  });

  it('detecta la alteración posterior de un evento', async () => {
    const { prisma, rows } = fakePrisma();
    const audit = new AuditService(prisma, clock);
    for (let i = 0; i < 3; i++) {
      await audit.record({ actorId: null, action: 'a', resourceType: 'R', result: 'SUCCESS', correlationId: `c${i}` });
    }
    rows[1].result = 'FAILURE';
    const result = await audit.verify();
    expect(result.valid).toBe(false);
    expect(result.brokenAtSequence).toBe(2);
  });
});
