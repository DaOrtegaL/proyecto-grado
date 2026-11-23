# Estado del desarrollo

Última actualización: 2026-11-22.

## Fase actual
Fases 1 a 5 implementadas en **modo simulación** y verificadas con pruebas automatizadas sobre la **base simulada (JSON)**. La Fase 6 (validación) está avanzada: faltan la verificación con SQL Server y la ejecución en un laboratorio autorizado.

## Funcionalidades implementadas y probadas
| Área | Estado | Evidencia |
|---|---|---|
| Monorepo, TypeScript estricto, CI | Implementado | `package.json`, `.github/workflows/ci.yml` |
| Base de datos simulada en JSON (`MOCK_DATABASE=1`) con 47 entidades y datos de ejemplo | Probado | `packages/mock-db`, `mock-database/` |
| Esquema SQL Server (47 tablas), migración y seed | Implementado; **no aplicado a SQL Server** | `prisma/` |
| Autenticación JWT con refresco rotatorio, RBAC (8 roles), límites de tasa | Probado | `app.wiring.spec.ts`, `flow.full.spec.ts` |
| Auditoría con hash encadenado y verificación | Probado (incluye detección de alteración) | `resilience.spec.ts` |
| Inventario (simulado y script PowerShell), certificados, alertas con deduplicación y escalamiento | Probado | `flow.mock.spec.ts`, `tests/integration` |
| Responsables con precedencia certificado > política > emisor (RF03) | Probado | `flow.full.spec.ts` |
| Anomalías configurables (RF12) y cambios sin despliegue asociado | Probado | `domain2.spec.ts`, `flow.full.spec.ts` |
| Renovaciones con máquina de estados, emisión con evidencia, aprobación con separación de funciones y vigencia (RF06–RF07) | Probado | `flow.full.spec.ts` |
| Instalación simulada, verificación, reversión independiente, idempotencia, ventanas y conciliación (RF08–RF09) | Probado | `flow.full.spec.ts`, `resilience.spec.ts` |
| Gateway de agentes (Ed25519, marca de tiempo, nonce, terminal asociada) | Probado | `flow.full.spec.ts` |
| Verificación de firma de scripts (RNF04) | Probado en Windows | `tests/security/script-signature.spec.ts` |
| Indicadores, línea base/piloto, comparación, SUS, incidentes, metas, registro experimental, trazabilidad y TRL | Probado | `flow.full.spec.ts` |
| Simulador de laboratorio: 16 escenarios | Probado | `flow.full.spec.ts` |
| Interfaz en español con 15 pantallas conectadas a la API | Probado con 5 flujos E2E | `tests/e2e` |

## Pendiente (no implementado)
- **SQL Server (`MOCK_DATABASE=0`):** migración y seed no aplicados; flujo no verificado por falta de Docker.
- **BullMQ/Redis:** el motor de vencimientos usa un temporizador en proceso y un barrido manual; las colas con reintentos persistentes no existen.
- **Modo laboratorio autorizado y adaptadores reales** (Windows remoto, MSH, emisor, notificaciones externas): deshabilitados o simulados; falta autorización y mecanismo de ejecución remota aprobado.
- **Autoservicio de recolección de evidencia real:** no hay datos reales de tiendas, tickets, entrevistas ni encuestas; los datos de investigación son sintéticos y están marcados como tales.
- ESLint, política de contraseñas y bloqueo de cuentas, administración de usuarios (altas/bajas), selección de idioma en la interfaz y traducción a `pt-BR`.
- Control de acceso por tienda o país (hoy el alcance es global por rol).
- Pruebas de accesibilidad y de carga (RNF05/RNF07).

## Errores conocidos
- Ninguno abierto. Corregidos durante esta etapa: salida vacía de `nest build` por compilación incremental obsoleta; comparación de fechas entre contextos de ejecución de Jest (afectaba el hash de auditoría y el motor JSON); `keyUsage: null` en el script PowerShell; `#` en contraseñas de `.env`.

## Pruebas ejecutadas (2026-11-22)
| Suite | Resultado |
|---|---|
| Dominio (`@msh/domain`) | 42/42 |
| Motor JSON (`@msh/mock-db`) | 10/10 |
| Simulador (`@msh/simulated-pos`) | 4/4 |
| API: cableado, flujo del primer escenario, aceptación final, resiliencia y seguridad | 67/67 |
| Integración y seguridad (`tests/`: PowerShell real, firma de scripts, claves privadas) | 11/11 |
| E2E Playwright (E2E01–E2E05, Chromium) | 5/5 |

## Riesgos
1. SQL Server sin verificar: pueden existir diferencias de SQL/Prisma respecto al motor JSON (bloqueos, tipos, rendimiento).
2. El motor JSON no ofrece concurrencia real ni índices; sirve para laboratorio, no para producción.
3. Toda la evidencia es sintética: no sustenta por sí sola conclusiones sobre el efecto en tiendas reales ni declara TRL.

## Próximas tareas
1. Verificar `MOCK_DATABASE=0` cuando exista Docker o una instancia SQL Server.
2. Gestionar la autorización para un laboratorio real y definir el mecanismo de ejecución remota aprobado.
3. Recolectar la línea base real (inventario, tickets, incidentes) y registrar la muestra efectiva.
