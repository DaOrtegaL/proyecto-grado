# ADR-005 — Base de datos simulada en archivos JSON

**Estado:** aceptada.

**Contexto.** El equipo de desarrollo no puede instalar Docker (ni, por tanto, SQL Server en contenedor), lo que impedía ejecutar y probar el sistema.

**Decisión.** Variable `MOCK_DATABASE`: con `1` el proyecto usa `packages/mock-db`, un motor que implementa el subconjunto de Prisma Client empleado y lee el esquema desde los metadatos de Prisma (DMMF), con un archivo JSON por entidad en `mock-database/`; con `0` usa SQL Server. El servicio de acceso a datos se elige en `PrismaModule`; el resto del código no cambia.

**Alternativas descartadas.** Reescribir los servicios con repositorios por interfaz (mayor cambio y duplicación); SQLite (no reproduce SQL Server y exige otro proveedor Prisma); datos fijos en el código (viola "no usar datos hardcodeados").

**Consecuencias.** Se puede probar el flujo completo, incluidos E2E en navegador, sin infraestructura. La verificación con SQL Server sigue pendiente. El motor serializa transacciones y no sustituye pruebas de concurrencia reales.
