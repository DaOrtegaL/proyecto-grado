import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockPrismaClient } from './index';

describe('MockPrismaClient (base simulada en JSON)', () => {
  let dir: string;
  let db: any;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'msh-mockdb-'));
    db = new MockPrismaClient({ dir });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const seedGeo = async () => {
    const co = await db.country.create({ data: { code: 'CO', name: 'Colombia', timezone: 'America/Bogota', locale: 'es-CO' } });
    const store = await db.store.create({ data: { code: 'CO-001', name: 'Tienda', countryId: co.id } });
    const model = await db.terminalModel.create({ data: { vendor: 'NCR', name: 'NCR POS' } });
    const terminal = await db.terminal.create({ data: { hostname: 'POS-1', storeId: store.id, modelId: model.id, osVersion: 'Win10' } });
    return { co, store, terminal };
  };

  it('aplica valores por defecto del esquema (uuid, fechas y constantes)', async () => {
    const { terminal } = await seedGeo();
    expect(terminal.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(terminal.status).toBe('UNKNOWN');
    expect(terminal.isSynthetic).toBe(false);
  });

  it('numera con autoincremento la tabla de auditoría', async () => {
    const base = { occurredAt: new Date(), action: 'a', resourceType: 'R', result: 'SUCCESS', correlationId: 'c', previousHash: '0', hash: 'h' };
    const a = await db.auditEvent.create({ data: { ...base, hash: 'h1' } });
    const b = await db.auditEvent.create({ data: { ...base, hash: 'h2' } });
    expect([a.sequence, b.sequence]).toEqual([1, 2]);
  });

  it('respeta restricciones únicas simples y compuestas', async () => {
    await seedGeo();
    await expect(db.country.create({ data: { code: 'co', name: 'Dup', timezone: 'x', locale: 'es' } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(db.terminalModel.create({ data: { vendor: 'ncr', name: 'ncr pos' } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('exige campos requeridos y rechaza campos desconocidos', async () => {
    await expect(db.country.create({ data: { code: 'AR' } })).rejects.toMatchObject({ code: 'P2011' });
    await expect(db.country.create({ data: { code: 'AR', name: 'x', timezone: 'x', locale: 'x', inventado: 1 } })).rejects.toMatchObject({ code: 'P2009' });
  });

  it('filtra con operadores, relaciones y claves únicas compuestas', async () => {
    const { store } = await seedGeo();
    const day = 86_400_000;
    const model = await db.terminalModel.findFirst();
    for (let i = 2; i <= 4; i++) await db.terminal.create({ data: { hostname: `POS-${i}`, storeId: store.id, modelId: model.id, osVersion: 'Win10', status: i % 2 ? 'ONLINE' : 'OFFLINE' } });
    expect(await db.terminal.count({ where: { hostname: { contains: 'pos-' } } })).toBe(4);
    expect(await db.terminal.count({ where: { status: { in: ['ONLINE'] } } })).toBe(1);
    expect(await db.terminal.count({ where: { store: { country: { code: 'CO' } } } })).toBe(4);
    expect(await db.store.count({ where: { terminals: { some: { status: 'OFFLINE' } } } })).toBe(1);
    expect(await db.terminal.count({ where: { OR: [{ hostname: 'POS-1' }, { hostname: 'POS-2' }], NOT: { status: 'ONLINE' } } })).toBe(2);
    const now = new Date();
    await db.maintenanceWindow.create({ data: { name: 'w', startsAt: now, endsAt: new Date(now.getTime() + day) } });
    expect(await db.maintenanceWindow.count({ where: { endsAt: { gt: new Date(now.getTime() + day / 2) } } })).toBe(1);
    const u = await db.user.create({ data: { email: 'a@b.c', displayName: 'A', passwordHash: 'x' } });
    const r = await db.role.create({ data: { code: 'R', description: 'r' } });
    await db.userRole.create({ data: { userId: u.id, roleId: r.id } });
    expect(await db.userRole.findUnique({ where: { userId_roleId: { userId: u.id, roleId: r.id } } })).not.toBeNull();
  });

  it('incluye relaciones, ordena y pagina', async () => {
    const { store } = await seedGeo();
    const model = await db.terminalModel.findFirst();
    for (const h of ['B', 'A', 'C']) await db.terminal.create({ data: { hostname: h, storeId: store.id, modelId: model.id, osVersion: 'x' } });
    const list = await db.terminal.findMany({ orderBy: { hostname: 'asc' }, skip: 1, take: 2, include: { store: { include: { country: true } } } });
    expect(list.map((t: any) => t.hostname)).toEqual(['B', 'C']);
    expect(list[0].store.country.code).toBe('CO');
    const withSelect = await db.store.findFirst({ select: { code: true, terminals: { select: { hostname: true }, orderBy: { hostname: 'desc' }, take: 1 } } });
    expect(withSelect.code).toBe('CO-001');
    expect(withSelect.terminals).toEqual([{ hostname: 'POS-1' }]);
  });

  it('revierte por completo una transacción fallida y confirma una exitosa', async () => {
    await seedGeo();
    await expect(db.$transaction(async (tx: any) => {
      await tx.country.create({ data: { code: 'MX', name: 'México', timezone: 'x', locale: 'x' } });
      throw new Error('falla');
    })).rejects.toThrow('falla');
    expect(await db.country.count()).toBe(1);
    await db.$transaction(async (tx: any) => {
      await tx.country.create({ data: { code: 'PE', name: 'Perú', timezone: 'x', locale: 'x' } });
    });
    expect(await db.country.count()).toBe(2);
  });

  it('serializa las transacciones concurrentes', async () => {
    const order: string[] = [];
    await Promise.all([1, 2, 3].map((n) => db.$transaction(async () => {
      order.push(`inicio${n}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`fin${n}`);
    })));
    expect(order).toEqual(['inicio1', 'fin1', 'inicio2', 'fin2', 'inicio3', 'fin3']);
  });

  it('persiste en archivos JSON y recupera las fechas al recargar', async () => {
    await seedGeo();
    const file = join(dir, 'country.json');
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))[0].code).toBe('CO');
    const now = new Date('2026-01-01T00:00:00Z');
    await db.maintenanceWindow.create({ data: { name: 'w', startsAt: now, endsAt: now } });
    const reloaded: any = new MockPrismaClient({ dir });
    expect((await reloaded.country.findMany()).length).toBe(1);
    expect((await reloaded.maintenanceWindow.findFirst()).startsAt).toBeInstanceOf(Date);
  });

  it('el motor genera un archivo por cada modelo del esquema al guardar todo', () => {
    db.flush(true);
    const sample = ['user', 'certificate', 'renewalRequest', 'auditEvent', 'traceabilityItem'];
    for (const f of sample) expect(existsSync(join(dir, `${f}.json`))).toBe(true);
  });
});
