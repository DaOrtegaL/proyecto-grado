/**
 * Prueba de cableado de la API (inyección de dependencias, guardias globales, validación, RBAC y auditoría)
 * con un doble de Prisma en memoria. No sustituye la verificación contra SQL Server.
 */
import 'reflect-metadata';
process.env.DATABASE_URL = 'sqlserver://fake';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { ROLE_PERMISSIONS } from '@msh/domain';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { correlationMiddleware } from './common/correlation.middleware';

const PASSWORD = 'Password#12345';

function buildFakePrisma() {
  const audit: Record<string, any>[] = [];
  let seq = 0;
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'viewer@msh.lab',
    displayName: 'Consulta',
    passwordHash: bcrypt.hashSync(PASSWORD, 4),
    isActive: true,
    locale: 'es',
    timezone: 'America/Bogota',
    roles: [
      {
        role: {
          code: 'VIEWER',
          permissions: ROLE_PERMISSIONS.VIEWER.map((code) => ({ permission: { code } })),
        },
      },
    ],
  };
  const tx: any = {
    $executeRaw: async () => 0,
    auditEvent: {
      findFirst: async () => (audit.length ? { hash: audit[audit.length - 1].hash } : null),
      create: async ({ data }: any) => {
        const row = { sequence: ++seq, ...data };
        audit.push(row);
        return { ...row };
      },
      update: async ({ where, data }: any) => Object.assign(audit.find((r) => r.sequence === where.sequence)!, data),
    },
  };
  const prisma: any = {
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    $queryRaw: async () => [{ '': 1 }],
    $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    user: { findUnique: async ({ where }: any) => (where.email === user.email ? user : null) },
    refreshToken: { create: async () => ({}) },
    country: { count: async () => 6 },
    store: { count: async () => 18 },
    terminal: { count: async () => 54 },
    certificate: { findMany: async () => [] },
    certificateInstallation: { findMany: async () => [] },
    alert: { findMany: async () => [] },
    certificateIssuer: { findMany: async () => [] },
    certificatePolicy: { findMany: async () => [] },
    inventoryScan: { findMany: async () => [] },
  };
  return { prisma, audit };
}

describe('API — cableado, autenticación y RBAC', () => {
  let app: INestApplication;
  let audit: Record<string, any>[];

  beforeAll(async () => {
    const fake = buildFakePrisma();
    audit = fake.audit;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fake.prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(helmet());
    app.use(cookieParser());
    app.use(correlationMiddleware as never);
    await app.init();
  });

  afterAll(async () => app.close());

  const login = (password = PASSWORD) =>
    request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'viewer@msh.lab', password });

  it('GET /health es público y responde el modo de ejecución seguro', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', executionMode: 'SIMULATION', labModeEnabled: false });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rechaza con 401 las rutas protegidas sin token y devuelve correlación', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/dashboard').expect(401);
    expect(res.body).toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(res.headers['x-correlation-id']).toBeTruthy();
  });

  it('valida el cuerpo del inicio de sesión (400 en español)', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'no-es-correo' }).expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toMatch(/no son válidos/);
  });

  it('rechaza credenciales incorrectas y lo audita', async () => {
    const res = await login('incorrecta').expect(401);
    expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(audit.some((e) => e.action === 'auth.login' && e.result === 'FAILURE')).toBe(true);
  });

  let token = '';
  it('inicia sesión: JWT en el cuerpo, refresco solo en cookie httpOnly', async () => {
    const res = await login().expect(200);
    token = res.body.accessToken;
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.body.user.permissions).toContain('dashboard:read');
    const cookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookie).toMatch(/msh_rt=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('permite al rol Consulta leer el panel de control', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/dashboard').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.totals).toMatchObject({ countries: 6, stores: 18, terminals: 54 });
  });

  it('bloquea con 403 al rol Consulta al ejecutar inventario y registra el intento (E2E04)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/terminals/22222222-2222-4222-8222-222222222222/inventory')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(audit.some((e) => e.action === 'access.denied' && e.result === 'DENIED' && e.actorId)).toBe(true);
  });

  it('bloquea con 403 el acceso a la auditoría sin permiso', async () => {
    await request(app.getHttpServer()).get('/api/v1/audit').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('rechaza un JWT manipulado', async () => {
    const tampered = token.slice(0, -4) + 'AAAA';
    const res = await request(app.getHttpServer()).get('/api/v1/dashboard').set('Authorization', `Bearer ${tampered}`).expect(401);
    expect(res.body.code).toBe('AUTH_TOKEN_INVALID');
  });
});
