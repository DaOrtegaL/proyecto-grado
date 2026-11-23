# My Store Health — Gestión Centralizada del Ciclo de Vida de Certificados (MSH-CLM)

Prototipo de trabajo de grado de Ingeniería de Sistemas (UNAD, Colombia). Centraliza el inventario, el monitoreo, las alertas, las renovaciones, las aprobaciones, las instalaciones controladas, la reversión y la auditoría de certificados digitales X.509 usados en la autenticación mutua (mTLS) de terminales POS en tiendas retail de Latinoamérica.

> **Estado real:** el prototipo funciona de extremo a extremo en **modo simulación** con datos **sintéticos**. La ruta con **SQL Server** (`MOCK_DATABASE=0`) está implementada pero **no se ha verificado** porque no hay Docker disponible. Ningún resultado de este repositorio proviene de infraestructura productiva ni constituye evidencia real de tiendas. Ver [ESTADO_DESARROLLO.md](ESTADO_DESARROLLO.md).

## 1. Descripción
Módulo independiente que se integrará con My Store Health (MSH) mediante adaptadores. Inventaría certificados con un script PowerShell de solo lectura o con terminales virtuales, los persiste, clasifica su vigencia, genera alertas anticipadas, detecta anomalías, gestiona renovaciones con separación de funciones, ejecuta instalaciones simuladas con verificación y reversión, y calcula los indicadores de la investigación.

## 2. Problema abordado
La renovación e instalación manual y reactiva de certificados, sin inventario centralizado ni trazabilidad, genera riesgo de vencimientos inesperados, interrupciones de autenticación e incidentes P1/P2 en servicios de venta.

## 3. Objetivos
Objetivo general y específicos OE01–OE05: [docs/metodologia-investigacion.md](docs/metodologia-investigacion.md). Trazabilidad: [docs/matriz-trazabilidad.md](docs/matriz-trazabilidad.md).

## 4. Tecnologías
React, TypeScript, Vite, Tailwind CSS, TanStack Query/Table, i18next, Recharts · NestJS, Prisma 6, SQL Server, JWT, Zod, Swagger · Windows PowerShell 5.1 · Docker Compose · Jest y Playwright · GitHub Actions. Redis está en Compose para BullMQ, **aún sin uso**: el motor de vencimientos corre en el proceso de la API.

## 5. Arquitectura
[docs/arquitectura.md](docs/arquitectura.md), [contexto](docs/contexto-c4.md), [contenedores](docs/contenedores-c4.md), [componentes](docs/componentes-c4.md).

```text
apps/api            API REST (NestJS)                  integrations/simulated-pos   Terminales virtuales y emisor simulado
apps/web            Interfaz web (React)               integrations/windows-pos     Adaptador Windows (deshabilitado)
packages/domain     Reglas de negocio puras            integrations/msh-adapter     Contrato propuesto con MSH (simulado)
packages/validation Esquemas Zod                       integrations/notifications   Canal interno simulado
packages/mock-db    Base simulada en JSON              powershell/                  Inventario (solo lectura) y verificación de firma
prisma/             Esquema, migración y seed          mock-database/               Datos de ejemplo en archivos JSON
tests/              Integración, seguridad y E2E       docs/                        Documentación en español
```

## 6. Requisitos
Node.js ≥ 20 y npm ≥ 10. Windows PowerShell 5.1 para las pruebas del script. Docker solo para `MOCK_DATABASE=0`.

## 7. Instalación
```powershell
Copy-Item .env.example .env        # ya incluye MOCK_DATABASE=1; cambie los secretos JWT
npm install
npx prisma generate
npm run build:libs
```

## 8. Variables de entorno
Ver [.env.example](.env.example). Las principales:

| Variable | Descripción |
|---|---|
| `MOCK_DATABASE` | `1` = base simulada con la carpeta `mock-database/` (sin Docker); `0` = SQL Server (requiere `DATABASE_URL`) |
| `MOCK_DATABASE_DIR` | Carpeta alternativa de la base simulada |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Mínimo 32 caracteres; el arranque falla si no se cumplen |
| `EXECUTION_MODE`, `LAB_MODE_ENABLED` | `SIMULATION` y `false` por defecto; el modo laboratorio permanece deshabilitado |
| `SCHEDULER_INTERVAL_SECONDS` | Intervalo del motor de vencimientos (`0` lo desactiva) |
| `FIXED_NOW` | Reloj controlado para escenarios reproducibles |
| `SEED_*` | Parámetros del generador de datos sintéticos |

> En archivos `.env` el carácter `#` inicia un comentario: no lo use en contraseñas sin comillas.

## 9. Ejecución
```powershell
npm run mock:reset      # (opcional) regenera mock-database con fechas relativas a hoy
npm run build -w @msh/api
npm run start -w @msh/api        # API en http://localhost:3000 (Swagger: /api/docs)
npm run dev:web                  # Web en http://localhost:5173
```
Usuarios de laboratorio (contraseña = `SEED_LAB_PASSWORD`): `admin@`, `pki@`, `emisor@`, `retailit@`, `soporte@`, `pagos@`, `auditor@`, `consulta@` `msh.lab`.

Con SQL Server: `MOCK_DATABASE=0` y `docker compose up --build` (web en <http://localhost:8080>). **Ruta no verificada.**

## 10. Pruebas
```powershell
npm run test:unit          # dominio, motor JSON, simulador y API (flujos completos sobre la base simulada)
npm run test:integration   # script PowerShell real, firma de scripts y controles contra claves privadas
npm run build -w @msh/api ; npx playwright install chromium ; npm run test:e2e   # E2E01–E2E05 en navegador
```
Resultados y alcance: [docs/plan-pruebas.md](docs/plan-pruebas.md).

## 11. Simulación
`mock-database/` contiene 47 archivos JSON (uno por entidad) con 6 países, 18 tiendas, 54 terminales NCR/HP y certificados X.509 reales (solo la parte pública). La pantalla **Simulador de laboratorio** ejecuta 16 escenarios reproducibles y registra la evidencia. Ver [docs/base-datos-simulada.md](docs/base-datos-simulada.md).

## 12. Seguridad
Sin claves privadas en el módulo central, RBAC granular en servidor, JWT de corta duración con refresco rotatorio en cookie `httpOnly`, agentes con identidad Ed25519 y protección contra reenvío, separación de funciones, auditoría con hash encadenado y adaptadores reales deshabilitados. [docs/arquitectura-seguridad.md](docs/arquitectura-seguridad.md) y [docs/modelo-amenazas.md](docs/modelo-amenazas.md).

## 13. Limitaciones
[docs/supuestos-limitaciones.md](docs/supuestos-limitaciones.md).

## 14. Próximos pasos
Verificar `MOCK_DATABASE=0` con SQL Server, cola BullMQ/Redis, adaptadores reales autorizados, piloto en laboratorio autorizado y recolección de evidencia real. Ver [ESTADO_DESARROLLO.md](ESTADO_DESARROLLO.md).
