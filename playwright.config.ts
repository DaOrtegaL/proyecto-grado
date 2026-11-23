import { cpSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const root = resolve(__dirname);
const workDb = join(root, 'tests', 'e2e', '.work-db');
// Solo el proceso principal restaura la base simulada; los trabajadores reutilizan la copia.
if (!process.env.TEST_WORKER_INDEX && !process.env.PW_DB_READY) {
  rmSync(workDb, { recursive: true, force: true });
  cpSync(join(root, 'mock-database'), workDb, { recursive: true });
  process.env.PW_DB_READY = '1';
}
if (!existsSync(workDb)) cpSync(join(root, 'mock-database'), workDb, { recursive: true });

const API_PORT = 3100;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${WEB_PORT}`, locale: 'es-CO', timezoneId: 'America/Bogota', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        MOCK_DATABASE: '1',
        MOCK_DATABASE_DIR: workDb,
        API_PORT: String(API_PORT),
        JWT_ACCESS_SECRET: 'e2e-access-secret-e2e-access-secret-0123456789',
        JWT_REFRESH_SECRET: 'e2e-refresh-secret-e2e-refresh-secret-0123456789',
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
        // Las pruebas E2E inician sesión muchas veces desde la misma IP.
        LOGIN_RATE_LIMIT_PER_MIN: '1000',
        RATE_LIMIT_PER_MIN: '5000',
      },
    },
    {
      command: `npm run dev -w @msh/web -- --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
