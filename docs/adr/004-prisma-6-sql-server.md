# ADR-004 — Prisma 6 y SQL Server sin enumeraciones

**Estado:** aceptada.

**Contexto.** Prisma 7 cambia la configuración (archivo `prisma.config.ts` y adaptadores), y SQL Server no admite enumeraciones ni JSON en Prisma.

**Decisión.** Fijar Prisma 6.x, usar cadenas para estados y texto para documentos JSON, y declarar `onDelete/onUpdate: NoAction` en todas las relaciones para evitar rutas de cascada múltiples. La migración inicial se generó con `prisma migrate diff` y **no se ha aplicado todavía a una base real**.

**Consecuencias.** La validez de los valores depende del dominio y de pruebas; la migración a Prisma 7 se evaluará tras la validación del MVP.
