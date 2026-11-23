# Base de datos simulada (`MOCK_DATABASE=1`)

Permite ejecutar todo el sistema sin Docker ni SQL Server. Se activa con la variable `MOCK_DATABASE` del archivo `.env`:

| Valor | Persistencia |
|---|---|
| `1` | Archivos JSON en la carpeta `mock-database/` (datos de ejemplo sintéticos) |
| `0` | SQL Server mediante Prisma (requiere `DATABASE_URL`, normalmente Docker Compose) |

## Diseño
`packages/mock-db` implementa el subconjunto de la API de Prisma Client que usa el proyecto (`findMany`, `findUnique`, `create`, `update`, `upsert`, `count`, filtros relacionales, `include`/`select`, `orderBy`, `$transaction`, etc.). El motor se guía por los metadatos del esquema (`prisma/schema.prisma`): nombres de modelos, relaciones, valores por defecto (`uuid`, `now`, `autoincrement`) y restricciones únicas. Por eso los servicios no distinguen el origen de los datos.

- **Un archivo por entidad:** `mock-database/<entidad>.json` (47 archivos, incluso los vacíos).
- **Transacciones:** se serializan y se revierten por completo ante errores, lo que equivale a un bloqueo global.
- **Fechas:** se guardan en UTC (ISO-8601) y se reconstruyen como `Date`.
- **Sin claves privadas:** `simulatedCertificateSlot.json` solo contiene certificados públicos en PEM.

## Contenido de los datos de ejemplo
6 países, 18 tiendas, 54 terminales NCR y HP Engage One, certificados X.509 reales con escenarios (vigente, 60/30/7 días, vencido, algoritmo débil, sin certificado, inventario parcial, terminal desconectada), 8 usuarios de laboratorio por rol, emisores y responsables, política de certificados, indicadores y metas preliminares, matriz de trazabilidad e incidentes sintéticos de línea base. Todo está marcado como sintético.

## Regenerar
```powershell
npm run mock:reset
```
Vacía las tablas y vuelve a ejecutar el seed (semilla `SEED_RANDOM_SEED`). Los vencimientos se calculan respecto a la fecha de generación, por lo que conviene regenerar los datos cuando pase tiempo. Las claves, y por tanto las huellas, cambian en cada generación; la estructura de escenarios es reproducible.

Las operaciones de la aplicación **modifican** estos archivos. Para volver al estado inicial use el comando anterior. Las pruebas automatizadas trabajan sobre una copia temporal y no alteran la carpeta.

## Limitaciones
No hay concurrencia real, índices ni SQL; el rendimiento es adecuado solo para el volumen de laboratorio. No reemplaza la verificación contra SQL Server.
