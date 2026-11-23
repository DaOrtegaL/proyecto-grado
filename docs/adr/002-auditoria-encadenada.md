# ADR-002 — Auditoría encadenada con bloqueo de aplicación

**Estado:** aceptada (pendiente de verificación contra SQL Server).

**Contexto.** RF10 exige integridad verificable. La secuencia es una columna de identidad y cada evento necesita el hash del anterior.

**Decisión.** Cada evento almacena `previousHash` y `hash = SHA-256(previousHash | JSON canónico del evento)`. La escritura se serializa con `sp_getapplock` (propietario: transacción) y el evento se inserta con hash provisional que se actualiza al conocer la secuencia. La ingesta de inventario toma además un bloqueo propio para evitar la creación concurrente de certificados compartidos.

**Alternativas descartadas.** Excluir la secuencia del hash (pierde el orden verificable); aislamiento `SERIALIZABLE` (más reintentos y riesgo de bloqueos mutuos).

**Consecuencias.** Las escrituras de auditoría son secuenciales (adecuado para el volumen del prototipo). Limitaciones documentadas en `supuestos-limitaciones.md`.
