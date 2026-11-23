/**
 * Base de datos simulada respaldada por archivos JSON (modo MOCK_DATABASE=1).
 *
 * Implementa el subconjunto de la API de Prisma Client que usa el proyecto y se guía por los
 * metadatos del esquema (DMMF), de modo que las tablas, relaciones, valores por defecto y
 * restricciones únicas coinciden con `prisma/schema.prisma`. Cada modelo se guarda en
 * `<carpeta>/<modelo>.json`. No reemplaza a SQL Server: no hay concurrencia real, índices ni SQL.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Prisma } from '@prisma/client';

type Row = Record<string, any>;
type Field = Prisma.DMMF.Field;
type Model = Prisma.DMMF.Model;

const MODELS: readonly Model[] = Prisma.dmmf.datamodel.models;
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** Detecta fechas aun si provienen de otro contexto de ejecución (por ejemplo, structuredClone en Jest). */
const isDate = (v: unknown): v is Date => Object.prototype.toString.call(v) === '[object Date]';
const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export class MockDbError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MockDbError';
  }
}

/** Busca la raíz del monorepositorio (package.json con `workspaces`) a partir de un directorio. */
export function findRepoRoot(start: string = __dirname): string {
  let dir = resolve(start);
  for (let i = 0; i < 12; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).workspaces) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('No se encontró la raíz del monorepositorio.');
}

export function defaultMockDir(): string {
  return process.env.MOCK_DATABASE_DIR
    ? resolve(process.env.MOCK_DATABASE_DIR)
    : join(findRepoRoot(), 'mock-database');
}

function norm(v: unknown): unknown {
  if (isDate(v)) return v.getTime();
  // SQL Server usa una intercalación sin distinción de mayúsculas por defecto.
  if (typeof v === 'string') return v.toLowerCase();
  return v;
}
const same = (a: unknown, b: unknown) => norm(a) === norm(b);

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  const x = norm(a) as any;
  const y = norm(b) as any;
  return x < y ? -1 : x > y ? 1 : 0;
}

function cloneValue<T>(v: T): T {
  return isDate(v) ? (new Date(v.getTime()) as unknown as T) : v;
}

export interface MockClientOptions {
  dir?: string;
}

export class MockPrismaClient {
  [key: string]: any;

  readonly dir: string;
  private tables = new Map<string, Row[]>();
  private counters = new Map<string, number>();
  private dirty = new Set<string>();
  private txContext = new AsyncLocalStorage<boolean>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: MockClientOptions = {}) {
    this.dir = options.dir ?? defaultMockDir();
    for (const model of MODELS) {
      this.tables.set(model.name, this.loadTable(model));
      this[lowerFirst(model.name)] = this.createDelegate(model);
    }
  }

  // ───────────── Persistencia ─────────────

  private file(model: Model): string {
    return join(this.dir, `${lowerFirst(model.name)}.json`);
  }

  private loadTable(model: Model): Row[] {
    const file = this.file(model);
    if (!existsSync(file)) return [];
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(raw)) throw new Error(`El archivo ${file} debe contener un arreglo JSON.`);
    const dateFields = model.fields.filter((f) => f.kind === 'scalar' && f.type === 'DateTime');
    for (const row of raw) {
      for (const f of dateFields) if (typeof row[f.name] === 'string') row[f.name] = new Date(row[f.name]);
    }
    const auto = model.fields.find((f) => (f.default as any)?.name === 'autoincrement');
    if (auto) this.counters.set(model.name, raw.reduce((m: number, r: Row) => Math.max(m, r[auto.name] ?? 0), 0));
    return raw;
  }

  /** Escribe en disco las tablas modificadas (o todas si `all`). */
  flush(all = false): void {
    mkdirSync(this.dir, { recursive: true });
    for (const model of MODELS) {
      if (!all && !this.dirty.has(model.name)) continue;
      writeFileSync(this.file(model), JSON.stringify(this.tables.get(model.name), null, 2) + '\n', 'utf8');
    }
    this.dirty.clear();
  }

  /** Vacía todas las tablas (usado al regenerar los datos de ejemplo). */
  clearAll(): void {
    for (const model of MODELS) this.tables.set(model.name, []);
    this.counters.clear();
  }

  private touch(model: Model): void {
    this.dirty.add(model.name);
    if (!this.txContext.getStore()) this.flush();
  }

  // ───────────── API estilo Prisma ─────────────

  async $connect(): Promise<void> {}
  async $disconnect(): Promise<void> {
    this.flush();
  }
  async onModuleInit(): Promise<void> {}
  async onModuleDestroy(): Promise<void> {
    this.flush();
  }
  async $executeRaw(..._args: unknown[]): Promise<number> {
    return 0;
  }
  async $queryRaw(..._args: unknown[]): Promise<unknown[]> {
    return [{ '': 1 }];
  }

  /** Transacciones serializadas con reversión completa ante errores (equivale a un bloqueo global). */
  async $transaction<T>(arg: ((tx: any) => Promise<T>) | Promise<unknown>[], _options?: unknown): Promise<T> {
    if (Array.isArray(arg)) return (await Promise.all(arg)) as unknown as T;
    if (this.txContext.getStore()) return arg(this);

    const run = async (): Promise<T> => {
      const snapshot = {
        tables: structuredClone([...this.tables.entries()]),
        counters: new Map(this.counters),
      };
      try {
        const result = await this.txContext.run(true, () => arg(this));
        this.flush();
        return result;
      } catch (error) {
        this.tables = new Map(snapshot.tables);
        this.counters = snapshot.counters;
        MODELS.forEach((m) => this.dirty.add(m.name));
        this.flush();
        throw error;
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private createDelegate(model: Model) {
    const rows = () => this.tables.get(model.name)!;
    const find = (where: any) => rows().filter((r) => this.matches(model, r, where));
    const orderAndSlice = (list: Row[], args: any) => {
      let out = args.orderBy ? this.sort(model, list, args.orderBy) : list;
      if (args.skip) out = out.slice(args.skip);
      if (args.take !== undefined) out = out.slice(0, args.take);
      return out;
    };
    const notFound = () => new MockDbError('P2025', `Registro de ${model.name} no encontrado.`);

    return {
      findUnique: async (args: any) => {
        const row = find(args.where)[0];
        return row ? this.project(model, row, args) : null;
      },
      findUniqueOrThrow: async (args: any) => {
        const row = find(args.where)[0];
        if (!row) throw notFound();
        return this.project(model, row, args);
      },
      findFirst: async (args: any = {}) => {
        const row = orderAndSlice(find(args.where), { ...args, take: undefined })[0];
        return row ? this.project(model, row, args) : null;
      },
      findFirstOrThrow: async (args: any = {}) => {
        const row = orderAndSlice(find(args.where), { ...args, take: undefined })[0];
        if (!row) throw notFound();
        return this.project(model, row, args);
      },
      findMany: async (args: any = {}) => orderAndSlice(find(args.where), args).map((r) => this.project(model, r, args)),
      count: async (args: any = {}) => find(args.where).length,
      create: async (args: any) => {
        const row = this.insert(model, args.data);
        this.touch(model);
        return this.project(model, row, args);
      },
      createMany: async (args: any) => {
        const data = asArray(args.data);
        data.forEach((d) => this.insert(model, d));
        this.touch(model);
        return { count: data.length };
      },
      update: async (args: any) => {
        const row = find(args.where)[0];
        if (!row) throw notFound();
        this.apply(model, row, args.data);
        this.touch(model);
        return this.project(model, row, args);
      },
      updateMany: async (args: any) => {
        const list = find(args.where);
        list.forEach((r) => this.apply(model, r, args.data));
        if (list.length) this.touch(model);
        return { count: list.length };
      },
      upsert: async (args: any) => {
        const row = find(args.where)[0];
        const result = row ? (this.apply(model, row, args.update), row) : this.insert(model, args.create);
        this.touch(model);
        return this.project(model, result, args);
      },
      delete: async (args: any) => {
        const row = find(args.where)[0];
        if (!row) throw notFound();
        this.tables.set(model.name, rows().filter((r) => r !== row));
        this.touch(model);
        return this.project(model, row, args);
      },
      deleteMany: async (args: any = {}) => {
        const doomed = new Set(find(args.where));
        this.tables.set(model.name, rows().filter((r) => !doomed.has(r)));
        if (doomed.size) this.touch(model);
        return { count: doomed.size };
      },
    };
  }

  // ───────────── Escritura ─────────────

  private defaultFor(model: Model, f: Field): unknown {
    const d = f.default as any;
    if (d === undefined || d === null) return undefined;
    if (typeof d === 'object' && !Array.isArray(d)) {
      if (d.name === 'uuid') return randomUUID();
      if (d.name === 'now') return new Date();
      if (d.name === 'autoincrement') {
        const next = (this.counters.get(model.name) ?? 0) + 1;
        this.counters.set(model.name, next);
        return next;
      }
      return undefined;
    }
    return d;
  }

  private insert(model: Model, data: Row): Row {
    const scalarNames = new Set(model.fields.filter((f) => f.kind === 'scalar').map((f) => f.name));
    for (const key of Object.keys(data)) {
      if (!scalarNames.has(key)) throw new MockDbError('P2009', `Campo no soportado al crear ${model.name}.${key}`);
    }
    const row: Row = {};
    for (const f of model.fields) {
      if (f.kind !== 'scalar') continue;
      let value = data[f.name];
      if (value === undefined) value = this.defaultFor(model, f);
      if (value === undefined || value === null) {
        if (f.isRequired) throw new MockDbError('P2011', `Falta el campo requerido ${model.name}.${f.name}`);
        value = null;
      }
      row[f.name] = cloneValue(value);
    }
    this.assertUnique(model, row, undefined);
    this.tables.get(model.name)!.push(row);
    return row;
  }

  private apply(model: Model, row: Row, data: Row): void {
    const updated: Row = { ...row };
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      const field = model.fields.find((f) => f.name === key && f.kind === 'scalar');
      if (!field) throw new MockDbError('P2009', `Campo no soportado al actualizar ${model.name}.${key}`);
      if (value && typeof value === 'object' && !(isDate(value))) {
        const op = value as any;
        if ('set' in op) updated[key] = op.set;
        else if ('increment' in op) updated[key] = (row[key] ?? 0) + op.increment;
        else throw new MockDbError('P2009', `Operación no soportada en ${model.name}.${key}`);
      } else {
        updated[key] = cloneValue(value);
      }
    }
    this.assertUnique(model, updated, row);
    Object.assign(row, updated);
  }

  private uniqueSets(model: Model): string[][] {
    const sets: string[][] = [];
    model.fields.filter((f) => f.kind === 'scalar' && (f.isId || f.isUnique)).forEach((f) => sets.push([f.name]));
    if (model.primaryKey?.fields) sets.push([...model.primaryKey.fields]);
    model.uniqueFields.forEach((u) => sets.push([...u]));
    return sets;
  }

  private assertUnique(model: Model, candidate: Row, current: Row | undefined): void {
    for (const set of this.uniqueSets(model)) {
      if (set.some((k) => candidate[k] == null)) continue;
      const clash = this.tables.get(model.name)!.some((r) => r !== current && set.every((k) => same(r[k], candidate[k])));
      if (clash) throw new MockDbError('P2002', `Restricción única violada en ${model.name} (${set.join(', ')}).`);
    }
  }

  // ───────────── Lectura ─────────────

  private model(name: string): Model {
    const m = MODELS.find((x) => x.name === name);
    if (!m) throw new Error(`Modelo desconocido: ${name}`);
    return m;
  }

  private related(model: Model, field: Field, row: Row): Row[] {
    const target = this.model(field.type);
    const targetRows = this.tables.get(target.name)!;
    if (field.relationFromFields?.length) {
      const from = field.relationFromFields;
      const to = field.relationToFields!;
      if (from.some((f) => row[f] == null)) return [];
      return targetRows.filter((t) => to.every((tf, i) => same(t[tf], row[from[i]])));
    }
    const opposite = target.fields.find(
      (f) => f.kind === 'object' && f.relationName === field.relationName && f.type === model.name,
    )!;
    const from = opposite.relationFromFields!;
    const to = opposite.relationToFields!;
    return targetRows.filter((t) => from.every((ff, i) => row[to[i]] != null && same(t[ff], row[to[i]])));
  }

  private matches(model: Model, row: Row, where: any): boolean {
    if (!where) return true;
    for (const [key, cond] of Object.entries<any>(where)) {
      if (cond === undefined) continue;
      if (key === 'AND') {
        if (!asArray(cond).every((c) => this.matches(model, row, c))) return false;
        continue;
      }
      if (key === 'OR') {
        const list = asArray(cond);
        if (list.length && !list.some((c) => this.matches(model, row, c))) return false;
        continue;
      }
      if (key === 'NOT') {
        if (asArray(cond).some((c) => this.matches(model, row, c))) return false;
        continue;
      }
      const field = model.fields.find((f) => f.name === key);
      if (!field) {
        // Clave única compuesta, por ejemplo `userId_roleId: { userId, roleId }`.
        if (cond && typeof cond === 'object' && this.matches(model, row, cond)) continue;
        return false;
      }
      if (field.kind === 'object') {
        if (!this.relationMatches(model, field, row, cond)) return false;
      } else if (!this.scalarMatches(row[key], cond)) {
        return false;
      }
    }
    return true;
  }

  private relationMatches(model: Model, field: Field, row: Row, cond: any): boolean {
    const target = this.model(field.type);
    const related = this.related(model, field, row);
    const ok = (r: Row, w: any) => this.matches(target, r, w);
    if (field.isList) {
      if (cond.some !== undefined && !related.some((r) => ok(r, cond.some))) return false;
      if (cond.every !== undefined && !related.every((r) => ok(r, cond.every))) return false;
      if (cond.none !== undefined && related.some((r) => ok(r, cond.none))) return false;
      return true;
    }
    if (cond === null) return related.length === 0;
    const hasIs = 'is' in cond;
    const hasIsNot = 'isNot' in cond;
    if (!hasIs && !hasIsNot) return related.length > 0 && ok(related[0], cond);
    if (hasIs && (cond.is === null ? related.length > 0 : !(related[0] && ok(related[0], cond.is)))) return false;
    if (hasIsNot && (cond.isNot === null ? related.length === 0 : related[0] && ok(related[0], cond.isNot))) return false;
    return true;
  }

  private scalarMatches(value: unknown, cond: any): boolean {
    if (cond === null) return value == null;
    if (typeof cond !== 'object' || isDate(cond)) return same(value, cond);
    for (const [op, arg] of Object.entries<any>(cond)) {
      if (arg === undefined || op === 'mode') continue;
      switch (op) {
        case 'equals': if (!(arg === null ? value == null : same(value, arg))) return false; break;
        case 'not': if (this.scalarMatches(value, arg)) return false; break;
        case 'in': if (!arg.some((a: unknown) => same(value, a))) return false; break;
        case 'notIn': if (arg.some((a: unknown) => same(value, a))) return false; break;
        case 'lt': if (value == null || !(compareValues(value, arg) < 0)) return false; break;
        case 'lte': if (value == null || !(compareValues(value, arg) <= 0)) return false; break;
        case 'gt': if (value == null || !(compareValues(value, arg) > 0)) return false; break;
        case 'gte': if (value == null || !(compareValues(value, arg) >= 0)) return false; break;
        case 'contains': if (typeof value !== 'string' || !value.toLowerCase().includes(String(arg).toLowerCase())) return false; break;
        case 'startsWith': if (typeof value !== 'string' || !value.toLowerCase().startsWith(String(arg).toLowerCase())) return false; break;
        case 'endsWith': if (typeof value !== 'string' || !value.toLowerCase().endsWith(String(arg).toLowerCase())) return false; break;
        default: throw new MockDbError('P2009', `Operador de filtro no soportado: ${op}`);
      }
    }
    return true;
  }

  private compare(model: Model, a: Row | undefined, b: Row | undefined, spec: any): number {
    for (const [key, dir] of Object.entries<any>(spec)) {
      const field = model.fields.find((f) => f.name === key);
      if (!field) throw new MockDbError('P2009', `Campo de orden desconocido: ${model.name}.${key}`);
      let c: number;
      if (field.kind === 'object') {
        const target = this.model(field.type);
        c = this.compare(target, a && this.related(model, field, a)[0], b && this.related(model, field, b)[0], dir);
      } else {
        c = compareValues(a?.[key], b?.[key]) * (dir === 'desc' ? -1 : 1);
      }
      if (c) return c;
    }
    return 0;
  }

  private sort(model: Model, list: Row[], orderBy: any): Row[] {
    const specs = asArray(orderBy);
    return [...list].sort((a, b) => {
      for (const spec of specs) {
        const c = this.compare(model, a, b, spec);
        if (c) return c;
      }
      return 0;
    });
  }

  private project(model: Model, row: Row, args: any = {}): Row {
    const out: Row = {};
    if (args.select) {
      for (const [key, value] of Object.entries<any>(args.select)) {
        if (!value) continue;
        const field = model.fields.find((f) => f.name === key);
        if (!field) throw new MockDbError('P2009', `Campo desconocido en select: ${model.name}.${key}`);
        out[key] = field.kind === 'object'
          ? this.relationValue(model, field, row, value === true ? {} : value)
          : cloneValue(row[key]);
      }
      return out;
    }
    for (const f of model.fields) if (f.kind === 'scalar') out[f.name] = cloneValue(row[f.name]);
    for (const [key, value] of Object.entries<any>(args.include ?? {})) {
      if (!value) continue;
      const field = model.fields.find((f) => f.name === key);
      if (!field || field.kind !== 'object') throw new MockDbError('P2009', `Relación desconocida: ${model.name}.${key}`);
      out[key] = this.relationValue(model, field, row, value === true ? {} : value);
    }
    return out;
  }

  private relationValue(model: Model, field: Field, row: Row, args: any): unknown {
    const target = this.model(field.type);
    let list = this.related(model, field, row).filter((r) => this.matches(target, r, args.where));
    if (args.orderBy) list = this.sort(target, list, args.orderBy);
    if (args.skip) list = list.slice(args.skip);
    if (args.take !== undefined) list = list.slice(0, args.take);
    const projected = list.map((r) => this.project(target, r, args));
    return field.isList ? projected : (projected[0] ?? null);
  }
}
