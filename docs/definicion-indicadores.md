# Definición de indicadores

Cálculos reales en `ResearchService.compute` (API `GET /metrics/current`). Cada indicador almacena fórmula, numerador, denominador, tamaño de muestra, periodo y fuente. Las definiciones también están en la tabla `MetricDefinition`.

| Código | Fórmula | Fuente | Notas |
|---|---|---|---|
| `INVENTORY_COVERAGE` | Terminales elegibles inventariadas correctamente / total de terminales elegibles × 100 | `InventoryScan`, `Terminal` | "Correctamente" = al menos un inventario `SUCCESS` en el periodo; distingue terminales conocidas de inventariadas; incluye desglose por país |
| `ALERT_ANTICIPATION` | Fecha de vencimiento − fecha de primera alerta válida (días) | `Alert` | Promedio por certificado; una alerta posterior al vencimiento no cuenta |
| `RENEWAL_TIME` | Fecha de instalación verificada − fecha de creación de la solicitud (horas y días) | `RenewalRequest` | Solo renovaciones `COMPLETED` |
| `INSTALL_SUCCESS_RATE` | Instalaciones verificadas exitosamente / total de intentos completados × 100 | `DeploymentTarget` | Destinos con resultado final |
| `DEPLOYMENT_ERROR_RATE` | Intentos fallidos / total de intentos × 100 (equivale a errores por cada 100 operaciones) | `DeploymentAttempt` | Incluye fallas de instalación y de verificación |
| `FALSE_POSITIVE_RATE` | Alertas confirmadas como falsos positivos / alertas evaluadas × 100 | `Alert.falsePositive` | Solo alertas evaluadas por una persona |
| `AUDIT_COMPLETENESS` | Operaciones con todos los campos obligatorios / operaciones evaluadas × 100 | `AuditEvent` | Obligatorios: usuario, acción, recurso, resultado, correlación, fecha y estado posterior cuando es exitosa |
| `INCIDENTS_P1P2` | Conteo de incidentes P1/P2 relacionados con certificados | `Incident` | Se normaliza por 30 días para comparar periodos |
| `SUS_SCORE` | Promedio de puntuaciones SUS (0–100) | `UsabilitySurvey` | Preguntas impares: respuesta − 1; pares: 5 − respuesta; suma × 2,5 |

## Metas preliminares
Cobertura ≥ 95 %, anticipación ≥ 30 días y completitud de auditoría = 100 %. Son metas de investigación **preliminares**, no estándares universales. Se guardan con justificación, fuente, responsable, fecha y estado de aprobación (`MetricTarget`, inicialmente `PROPOSED`) y pueden ajustarse tras el diagnóstico.

## Comparación línea base y piloto
La pantalla **Indicadores y análisis** y `GET /metrics/comparison` muestran por indicador: línea base, piloto, variación absoluta y relativa, tamaño de muestra, periodos, interpretación y limitaciones. Se exportan observaciones pareadas (por país para la cobertura) en CSV. La aplicación **no** afirma significancia estadística ni atribuye causalidad.
