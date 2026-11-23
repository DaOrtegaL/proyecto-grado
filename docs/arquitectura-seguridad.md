# Arquitectura de seguridad

| Control | Implementación | Requisito | Verificación |
|---|---|---|---|
| Sin claves privadas en el backend | Esquema sin columnas de clave; el script solo lee `HasPrivateKey`; `AgentIdentity` guarda solo claves públicas; respuestas sin PEM ni hashes | RNF01 | `tests/security/private-key-controls.spec.ts`, `resilience.spec.ts` |
| RBAC granular en servidor | `AuthGuard` global + `@RequirePermissions` con 33 permisos y 8 roles | RNF02 | `app.wiring.spec.ts`, `flow.full.spec.ts`, E2E04 |
| Denegaciones auditadas | Evento `access.denied` con usuario, recurso y motivo | RNF02, RF10 | `flow.mock.spec.ts`, E2E04 |
| Autenticación | JWT HS256 (15 min); refresco opaco, guardado como hash SHA-256, rotatorio, con detección de reutilización | RNF03 | `app.wiring.spec.ts` |
| Contraseñas | bcrypt (costo 12) y comparación con hash ficticio para igualar tiempos | RNF03 | — |
| Cookie de refresco | `httpOnly`, `SameSite=Strict`, ruta `/api/v1/auth`, `Secure` configurable | RNF03 | `app.wiring.spec.ts` |
| Validación de entradas | Zod en cada endpoint; reporte de inventario validado al ingresar | RNF03 | `flow.full.spec.ts`, `resilience.spec.ts` |
| Inyección | Consultas parametrizadas (Prisma) y datos tratados como texto; CSV con neutralización de fórmulas | RNF03 | `resilience.spec.ts` |
| Límite de tasa | `ThrottlerModule` (300/min) y 10/min en inicio de sesión (configurables) | RNF03 | E2E (relajado solo en la prueba) |
| Cabeceras y CORS | `helmet`; CORS restringido a `CORS_ORIGIN` | RNF03 | `app.wiring.spec.ts` |
| Errores | Filtro global en español sin trazas; los errores 500 incluyen identificador de correlación | RNF03 | `resilience.spec.ts` |
| Identidad de agentes | Ed25519 por terminal; marca de tiempo ±5 min; nonce único por agente; hostname = terminal asociada | Sección 11.3 | `flow.full.spec.ts`, escenario S16 |
| Scripts firmados | `powershell/Test-ScriptTrust.ps1` rechaza scripts sin firma, alterados o de firmantes no autorizados | RNF04 | `tests/security/script-signature.spec.ts` |
| Separación de funciones | Solicitante ≠ aprobador por política; permisos distintos para aprobar y ejecutar | RF07 | `flow.full.spec.ts` |
| Aprobación vinculada a parámetros | Huella SHA-256 de certificado, destinos, operación, ventana y responsable | RF07 | `domain2.spec.ts`, `flow.full.spec.ts` |
| Auditoría íntegra | Hash encadenado SHA-256; verificación completa | RNF06 | `domain.spec.ts`, `resilience.spec.ts` |
| Modo laboratorio | Deshabilitado; el adaptador Windows lanza `AdapterDisabledError` | RF08 | `flow.full.spec.ts` |

## Pendiente
Política de contraseñas y bloqueo de cuentas, control de acceso por tienda o país, exigir la firma del script en el adaptador real (aún inexistente), TLS en el despliegue, rotación y almacenamiento seguro de secretos JWT y revisión de dependencias (`npm audit` reporta vulnerabilidades que no se han evaluado).
