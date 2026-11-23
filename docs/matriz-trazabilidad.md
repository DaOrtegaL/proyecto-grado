# Matriz de trazabilidad

Los datos de la matriz también se consultan y mantienen en la aplicación (pantalla **Evidencia y trazabilidad**, `GET /traceability`). Un requisito solo puede pasar a **Validado** si se asocia una ejecución experimental **aprobada** del mismo requisito; ninguno lo está todavía.

Estados: No iniciado · En desarrollo · Implementado · **Probado** (hay pruebas automatizadas aprobadas) · Validado.

| Requisito | Objetivo | Módulo / componente | Caso de prueba | Estado |
|---|---|---|---|---|
| RF01 Inventario automatizado | OE03 | `powershell/inventory/Get-CertificateInventory.ps1` | `tests/integration/powershell-inventory.spec.ts` | Probado |
| RF02 Inventario regional | OE03 | Inventario; `TerminalsPage`, `CertificatesPage` | `flow.mock.spec.ts`, E2E01 | Probado |
| RF03 Responsables | OE03 | `OwnersService`, `resolveOwnerId` | `flow.full.spec.ts` | Probado |
| RF04 Vigencia | OE03 | `packages/domain/certificate-status` | `domain.spec.ts` | Probado |
| RF05 Alertas | OE03 | `AlertsService`, `MonitoringService` | `flow.mock.spec.ts`, `flow.full.spec.ts` | Probado |
| RF06 Renovaciones | OE03 | `RenewalsService`, máquina de estados | `domain2.spec.ts`, `flow.full.spec.ts` | Probado |
| RF07 Aprobación | OE03 | `decide`, `computeApprovalHash` | `flow.full.spec.ts`, E2E01–E2E02 | Probado |
| RF08 Instalación controlada | OE03 | `DeploymentsService` (simulación) | `flow.full.spec.ts`, E2E01, E2E03 | Probado (modo laboratorio: no iniciado) |
| RF09 Reversión | OE03 | `DeploymentsService.rollback` | `flow.full.spec.ts`, E2E03 | Probado |
| RF10 Auditoría | OE02 | `AuditService`, `audit-chain` | `domain.spec.ts`, `resilience.spec.ts` | Probado |
| RF11 Paneles y reportes | OE03 | `DashboardController`, exportaciones | `flow.mock.spec.ts` | Implementado |
| RF12 Anomalías | OE03 | `AnomalyService` | `domain2.spec.ts`, `flow.full.spec.ts` | Probado |
| RNF01 Claves privadas | OE02 | Esquema, script, respuestas | `tests/security`, `resilience.spec.ts` | Probado |
| RNF02 RBAC | OE02 | `AuthGuard`, `rbac.ts` | `app.wiring.spec.ts`, E2E04 | Probado |
| RNF03 Autenticación y comunicaciones | OE02 | Auth, gateway de agentes | `flow.full.spec.ts` | En desarrollo (TLS y política de contraseñas pendientes) |
| RNF04 Scripts firmados | OE02 | `Test-ScriptTrust.ps1` | `tests/security/script-signature.spec.ts` | En desarrollo (sin ejecutor real que lo exija) |
| RNF05 Bajo consumo | OE02 | Script de solo lectura | — | En desarrollo |
| RNF06 Trazabilidad e integridad | OE02 | Cadena de auditoría | `resilience.spec.ts` | Probado |
| RNF07 Escalabilidad regional | OE02 | Paginación y filtros en servidor | — | En desarrollo (sin pruebas de carga) |
| RNF08 Usabilidad (SUS) | OE05 | Cuestionario y puntuación | `domain2.spec.ts`, `flow.full.spec.ts` | Implementado (sin respuestas reales) |
| RNF09 Compatibilidad NCR/HP/Windows 10 IoT | OE04 | Modelos simulados; script probado en Windows con PowerShell 5.1 | `tests/integration` | En desarrollo (no probado en Windows 10 IoT) |
| RNF10 ISO/IEC 25010 | OE04 | TypeScript estricto, pruebas, CI | CI | En desarrollo |

Trazabilidad inversa: cada archivo de prueba aparece en la columna de casos de prueba; los escenarios del simulador (S01–S16) generan ejecuciones experimentales vinculadas al requisito que verifican.
