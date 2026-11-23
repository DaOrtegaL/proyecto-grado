# Validación experimental

## Registro experimental
Cada ejecución se guarda como `ExperimentalRun` con identificador, objetivo, requisito, escenario, fecha (UTC), entorno, operador, muestra, parámetros, resultado esperado y obtenido, métricas, estado y limitaciones, con evidencias adjuntas (`TestEvidence`). Se exporta en JSON, CSV y Markdown. Los registros del simulador se marcan como **sintéticos**.

## Escenarios del simulador (reproducibles)
| Código | Escenario | Requisito |
|---|---|---|
| S01 | Certificado próximo a vencer en 60 días | RF05 |
| S02 | Certificado próximo a vencer en 7 días | RF05 |
| S03 | Certificado vencido | RF04 |
| S04 | Error durante el inventario | RF01 |
| S05 | Certificado sin responsable | RF03 |
| S06 | Renovación aprobada | RF07 |
| S07 | Renovación rechazada | RF07 |
| S08 | Instalación exitosa | RF08 |
| S09 | Instalación fallida | RF08 |
| S10 | Error en verificación | RF08 |
| S11 | Reversión exitosa | RF09 |
| S12 | Reversión fallida | RF09 |
| S13 | Usuario sin permisos | RNF02 |
| S14 | Aprobación invalidada | RF07 |
| S15 | Ejecución duplicada | RNF06 |
| S16 | Identidad de agente incorrecta | RNF03 |

La reproducibilidad se logra con la semilla de generación (`SEED_RANDOM_SEED`), el reloj controlado (`FIXED_NOW`) y la selección determinista de terminales (orden alfabético). Las claves criptográficas, y por tanto las huellas, varían entre ejecuciones.

## Resultados actuales
Los 16 escenarios resultan aprobados en la prueba automatizada `flow.full.spec.ts` sobre la base simulada. Esto demuestra que el prototipo se comporta como se diseñó **en simulación**; no constituye evidencia de comportamiento en tiendas reales.

## Qué falta para una validación en laboratorio autorizado
Autorización escrita, terminales permitidas, mecanismo de ejecución remota aprobado, scripts firmados con un certificado autorizado, procedimiento de recuperación verificable y recolección de la línea base real.
