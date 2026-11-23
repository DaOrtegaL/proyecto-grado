# Guía de instalación

## Requisitos
Node.js ≥ 20, npm ≥ 10. Docker con Compose solo si usará SQL Server. Windows PowerShell 5.1 para las pruebas del script.

## Opción A — Base simulada (sin Docker) — recomendada para laboratorio
```powershell
Copy-Item .env.example .env       # MOCK_DATABASE=1; cambie JWT_ACCESS_SECRET y JWT_REFRESH_SECRET (≥ 32 caracteres)
npm install
npx prisma generate
npm run build:libs
npm run build -w @msh/api
npm run start -w @msh/api         # http://localhost:3000/api/v1/health → "database":"MOCK_JSON"
npm run dev:web                   # http://localhost:5173
```
Datos en `mock-database/`; ver [base-datos-simulada.md](base-datos-simulada.md). `npm run mock:reset` los regenera.

## Opción B — SQL Server con Docker Compose (**no verificada**)
```powershell
Copy-Item .env.example .env
# En .env: MOCK_DATABASE=0, MSSQL_SA_PASSWORD, SEED_LAB_PASSWORD, JWT_ACCESS_SECRET y JWT_REFRESH_SECRET
docker compose up --build
```
Servicios: `sqlserver` (1433), `redis` (6379, aún sin uso), `migrate` (migración y seed), `api` (3000) y `web` (8080).

> No use `#` en contraseñas sin comillas dentro de `.env`: se interpreta como comentario.

Desarrollo local contra SQL Server: `docker compose up sqlserver redis -d`, `npm run db:migrate`, `npm run db:seed` y arrancar la API con `MOCK_DATABASE=0`.

## Verificación rápida
`GET /api/v1/health` responde `{"status":"ok","database":"MOCK_JSON"|"SQLSERVER","executionMode":"SIMULATION","labModeEnabled":false}`.
