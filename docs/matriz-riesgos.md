# Matriz de riesgos

Probabilidad (P) e impacto (I): 1 = bajo, 3 = alto. Exposición = P × I.

| # | Riesgo | P | I | Exposición | Mitigación | Estado |
|---|---|---|---|---|---|---|
| R1 | La ruta SQL Server presenta diferencias con el motor JSON | 2 | 3 | 6 | Verificar con Docker/SQL Server antes de cualquier piloto | **Abierto** |
| R2 | Los datos sintéticos se interpreten como resultados reales | 2 | 3 | 6 | Etiquetas de origen en interfaz, exportaciones e indicadores; límites documentados | Mitigado |
| R3 | Declarar un TRL o validación sin evidencia | 2 | 3 | 6 | Trazabilidad exige ejecución aprobada; TRL no se declara automáticamente | Mitigado |
| R4 | Exposición de claves privadas | 1 | 3 | 3 | No se almacenan; pruebas estáticas | Mitigado |
| R5 | Instalación no autorizada en terminales reales | 1 | 3 | 3 | Modo laboratorio deshabilitado; aprobación, ventana y firma de scripts | Mitigado |
| R6 | Falta de autorización para el laboratorio real | 2 | 2 | 4 | Gestión con los responsables antes del piloto | **Abierto** |
| R7 | Auditoría manipulada por quien controla la base | 1 | 3 | 3 | Hash encadenado; futura anclaje externo | Parcial |
| R8 | Vulnerabilidades en dependencias | 2 | 2 | 4 | `npm audit` pendiente de evaluación | **Abierto** |
| R9 | Alertas perdidas por ausencia de planificador persistente | 2 | 2 | 4 | Temporizador en proceso y barrido manual; BullMQ pendiente | Parcial |
| R10 | Muestra insuficiente para inferencia estadística | 3 | 2 | 6 | No se afirma significancia; se documentan limitaciones | Mitigado |
