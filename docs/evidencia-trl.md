# Evidencia de madurez tecnológica (TRL)

> El nivel de madurez **no se declara** por haber implementado código. Esta página enumera la evidencia disponible; la declaración corresponde al evaluador del proyecto.

## TRL 2 — Concepto tecnológico
Evidencia disponible: objetivos y requisitos ([metodologia-investigacion.md](metodologia-investigacion.md), [matriz-trazabilidad.md](matriz-trazabilidad.md)), arquitectura ([arquitectura.md](arquitectura.md)), modelo de datos ([modelo-datos.md](modelo-datos.md)) y diseño preliminar.

## TRL 3 — Prueba de concepto
Evidencia disponible: prototipo funcional con persistencia (JSON o SQL Server), 16 escenarios reproducibles aprobados, 5 flujos E2E en navegador, 67 pruebas de API, 42 de dominio y 11 de integración y seguridad. **Limitación:** toda la ejecución es en simulación con datos sintéticos.

## TRL 4 — Validación en entorno relevante y controlado
Evidencia disponible: parcial. Existen pruebas de seguridad y resiliencia en simulación. **No existe** validación en un entorno relevante: falta un laboratorio autorizado con terminales Windows 10 IoT, la verificación con SQL Server y la evaluación de seguridad independiente. Por tanto **no** se afirma TRL 4.

La aplicación muestra esta información en **Evidencia y trazabilidad → Madurez tecnológica (TRL)** (`GET /research/trl`), que cuenta las ejecuciones aprobadas por nivel y advierte cuando toda la evidencia es sintética.
