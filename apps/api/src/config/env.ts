import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const flag = z
  .enum(['0', '1'])
  .default('0')
  .transform((v) => v === '1');

const envSchema = z
  .object({
    /** 1 = base de datos simulada con archivos JSON (carpeta mock-database); 0 = SQL Server. */
    MOCK_DATABASE: flag,
    MOCK_DATABASE_DIR: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    API_PORT: z.coerce.number().int().default(3000),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET debe tener al menos 32 caracteres'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    COOKIE_SECURE: booleanString,
    DEFAULT_LOCALE: z.string().default('es'),
    DEFAULT_TIMEZONE: z.string().default('America/Bogota'),
    EXECUTION_MODE: z.enum(['SIMULATION', 'LAB_AUTHORIZED']).default('SIMULATION'),
    LAB_MODE_ENABLED: booleanString,
    /** Reloj controlado (ISO-8601) para escenarios reproducibles; vacío usa la hora real. */
    FIXED_NOW: z.string().datetime().optional().or(z.literal('').transform(() => undefined)),
    /** Intervalo del planificador de vencimientos en segundos; 0 lo desactiva. */
    SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(0),
    /** Límites de tasa por minuto; los valores por defecto son los de producción. */
    RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(300),
    LOGIN_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  })
  .superRefine((env, ctx) => {
    if (!env.MOCK_DATABASE && !env.DATABASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'Es obligatoria cuando MOCK_DATABASE=0' });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | undefined;

/** Valida las variables de entorno al arranque; falla rápido si falta un secreto. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (!cached || source !== process.env) {
    const result = envSchema.safeParse(source);
    if (!result.success) {
      const detail = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Configuración de entorno inválida: ${detail}`);
    }
    if (source === process.env) cached = result.data;
    return result.data;
  }
  return cached;
}
