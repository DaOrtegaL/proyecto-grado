# Metodología de investigación

## Enfoque
Mixto. Diagnóstico descriptivo, investigación aplicada, construcción de artefactos mediante Design Science Research, evaluación preexperimental antes-después y desarrollo tecnológico con Scrum. La comparación evaluativa forma parte de la evaluación del artefacto; no es un alcance investigativo independiente.

## Objetivo general
Diseñar, desarrollar y validar un módulo integrado conceptualmente con My Store Health que permita inventariar, monitorear, alertar y gestionar centralizadamente la renovación e instalación controlada de certificados X.509 usados en la autenticación mutua de terminales POS con Windows 10 IoT de tiendas retail en Latinoamérica.

## Objetivos específicos y su soporte en el artefacto
| Objetivo | Soporte en el prototipo | Estado |
|---|---|---|
| OE01 Diagnóstico | Inventario, responsables, incidentes y línea base (`Incident`, `BaselineSnapshot`) | Herramientas listas; sin datos reales |
| OE02 Arquitectura y requisitos | `docs/`, ADR, modelo de datos, matriz de trazabilidad | Documentado |
| OE03 Desarrollo | Inventario PowerShell, alertas, responsables, instalaciones controladas | Implementado en simulación |
| OE04 Validación | Pruebas funcionales, de seguridad y resiliencia en entornos simulados | Ejecutadas en simulación; laboratorio autorizado pendiente |
| OE05 Evaluación | Indicadores, comparación línea base y piloto, SUS | Cálculo implementado; sin medición real |

## Población y muestra
Población técnica de referencia: aproximadamente 280 tiendas en Argentina, Brasil, Chile, Colombia, México y Perú, además de responsables de PKI, Retail IT, Payment Integration, soporte y la documentación de incidentes. Esa cifra **no** corresponde a datos descubiertos. La muestra efectiva se registra en la aplicación (`ResearchSample`: países, tiendas, terminales, certificados observados, informantes, tickets, periodo y criterios) y **no se asume definida** hasta capturar datos reales.

## Instrumentos
Inventario automatizado, observación del proceso manual, tickets e incidentes, listas de verificación funcional y de seguridad ([plan-pruebas.md](plan-pruebas.md)), cuestionario SUS y resultados experimentales. No se inventan entrevistas, consentimientos ni evidencias de participación.

## Datos sintéticos
Los datos del laboratorio están marcados como sintéticos en la interfaz y en cada exportación. No se emplean para sustentar conclusiones sobre tiendas reales.
