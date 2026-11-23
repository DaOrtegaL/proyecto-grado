# ADR-001 — Monorepositorio, idioma y convenciones

**Estado:** aceptada.

**Contexto.** El proyecto combina API, interfaz, librerías de dominio, integraciones y scripts, y debe ser defendible académicamente en español.

**Decisión.** Monorepositorio con npm workspaces; librerías CommonJS compiladas a `dist` (`@msh/domain`, `@msh/validation`, `@msh/simulated-pos`, `@msh/windows-pos`). Identificadores técnicos en inglés; comentarios, mensajes y documentación en español; textos de interfaz solo mediante claves i18n (`es` predeterminado, `pt-BR` registrado).

**Consecuencias.** Es necesario ejecutar `npm run build:libs` antes de compilar o probar la API. Las reglas de negocio puras se prueban sin infraestructura.
