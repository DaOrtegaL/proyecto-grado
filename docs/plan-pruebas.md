# Plan de pruebas

Comandos: `npm run test:unit`, `npm run test:integration` y `npm run test:e2e` (requiere `npm run build -w @msh/api` y `npx playwright install chromium`). Resultados del 2026-11-22: **todas las pruebas aprobadas**.

| Nivel | Cantidad | Qué cubre | Ubicación |
|---|---|---|---|
| Dominio | 42 | Vigencia, alertas, cadena de auditoría, máquina de estados, huella de aprobación, anomalías, indicadores, SUS, firma de agente, roles | `packages/domain` |
| Motor JSON | 10 | Valores por defecto, unicidad, filtros, relaciones, transacciones, persistencia | `packages/mock-db` |
| Simulador | 4 | Metadatos X.509 reales, ausencia de claves privadas, fallas simuladas | `integrations/simulated-pos` |
| API: cableado | 9 | Autenticación, RBAC, cookie `httpOnly`, denegación auditada, JWT manipulado | `app.wiring.spec.ts` |
| API: primer escenario | 9 | Inventario de 54 terminales, alertas, deduplicación, responsables, exportación CSV y evidencia, auditoría | `flow.mock.spec.ts` |
| API: aceptación final | 22 | Renovación exitosa; falla y reversión; separación de funciones; invalidación y vencimiento de aprobaciones; ventanas; idempotencia; anomalías; responsables; agentes; SUS; trazabilidad; 16 escenarios | `flow.full.spec.ts` |
| API: resiliencia y seguridad | 9 | Base no disponible, timeout, atomicidad, ejecución simultánea, operación interrumpida, aprobación vencida, inyección, exposición de datos sensibles, alteración de auditoría | `resilience.spec.ts` |
| API: servicios | 18 | Guardia, alertas, auditoría, CSV, entorno | `api.spec.ts` |
| Integración PowerShell | 2 | Script real (RF01): esquema, metadatos y rechazo de almacenes no autorizados | `tests/integration` |
| Seguridad | 9 | Sin claves privadas (RNF01) y firma de scripts (RNF04) | `tests/security` |
| E2E (Playwright) | 5 | E2E01 renovación exitosa; E2E02 rechazo; E2E03 falla y reversión; E2E04 intento no autorizado; E2E05 evaluación experimental | `tests/e2e` |

## Cobertura frente a las listas de la especificación
- **Funcionales (sección 19):** todas cubiertas, incluida la exportación y el cálculo de indicadores.
- **Seguridad (sección 20):** acceso no autorizado, roles insuficientes, autoaprobación, identidad de agente inválida, terminal incorrecta, aprobación vencida, alteración de parámetros, reejecución, firma de script inválida, exposición de datos, integridad de auditoría e inyección. **No aplicable aún:** acceso a recursos de otra tienda (no existe control por tienda).
- **Resiliencia (sección 21):** terminal desconectada, timeout, base no disponible, error en la cola de auditoría, ejecución duplicada, fallo parcial, fallo de verificación, fallo de reversión y operación interrumpida. **Error de notificaciones:** no aplica (canal interno).

## Pendiente
Pruebas con SQL Server, de carga, de accesibilidad y en un laboratorio autorizado.
