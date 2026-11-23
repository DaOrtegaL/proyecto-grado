# Manual de usuario

La interfaz está en español. Los datos de laboratorio se identifican con la etiqueta **Sintético** y un aviso en el panel de control. Las opciones visibles dependen del rol; el servidor valida los permisos en cada solicitud.

## Usuarios de laboratorio
`admin`, `pki`, `emisor`, `retailit`, `soporte`, `pagos`, `auditor` y `consulta` (`@msh.lab`) con la contraseña definida en `SEED_LAB_PASSWORD`.

## Pantallas
| Pantalla | Para qué sirve |
|---|---|
| **Panel de control** | Totales, vigentes, próximos a vencer, vencidos, alertas activas, distribución de vencimientos, certificados por país y emisor, últimos inventarios y descarga de evidencia |
| **Inventario de certificados** | Búsqueda, filtros por estado y país, ordenamiento, paginación, exportación CSV y detalle (metadatos X.509, instalaciones, historial, alertas, responsable efectivo) |
| **Tiendas y terminales** | Jerarquía País → Tienda → Terminal; botón **Ejecutar inventario** con resultado y evidencia (JSON, CSV, MD) |
| **Gestión de renovaciones** | Solicitudes y su estado; acciones permitidas: solicitar emisión, emitir (simulado), solicitar aprobación, cancelar; línea de tiempo de auditoría |
| **Centro de aprobaciones** | Bandeja para aprobar o rechazar con justificación. El solicitante no puede aprobar su propia solicitud |
| **Instalaciones** | Ventanas de mantenimiento, programación, ejecución, verificación, reversión y conciliación |
| **Alertas y monitoreo** | Alertas activas, reconocer y resolver |
| **Seguridad y anomalías** | Hallazgos con acción recomendada; resolver o descartar con motivo; reevaluar terminales |
| **Indicadores y análisis** | Indicadores actuales frente a metas preliminares, registro de línea base y piloto, comparación, exportación de observaciones pareadas, cuestionario SUS e incidentes |
| **Registros de auditoría** | Historial y **Verificar integridad** de la cadena |
| **Evidencia y trazabilidad** | Matriz de requisitos, madurez tecnológica (sin declarar nivel) y registro experimental exportable |
| **Simulador de laboratorio** | Ejecuta los 16 escenarios y registra evidencia |
| **Administración** | Usuarios, roles y permisos, responsables (precedencia certificado → política → emisor) y políticas |

## Flujo típico de renovación
1. *Retail IT* inventaría la terminal y, en el detalle del certificado, **solicita la renovación** eligiendo terminales.
2. En **Gestión de renovaciones**, *Retail IT* pulsa **Solicitar emisión**; *Administrador PKI* pulsa **Emitir**.
3. *Administrador PKI* crea una ventana en **Instalaciones**; *Retail IT* **solicita la aprobación** indicando ventana y justificación.
4. *Responsable del emisor* aprueba en el **Centro de aprobaciones**.
5. *Retail IT* **programa** la instalación; *Soporte de tiendas* la **ejecuta**. Si la verificación falla, **Revertir**.
6. *Auditor* consulta los registros y verifica la integridad.
