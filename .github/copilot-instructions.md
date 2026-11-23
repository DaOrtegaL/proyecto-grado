# MSH Certificate Lifecycle Management (MSH-CLM) — Instrucciones del proyecto

Proyecto de grado de Ingeniería de Sistemas (UNAD). **El español es el idioma principal y es obligatorio en todos los módulos presentes y futuros.**

## Comunicación de Copilot
- Responder, explicar decisiones, presentar planes, informar errores y resultados de pruebas, y documentar cambios siempre en español.
- Mantener en su idioma original los términos técnicos y nombres oficiales (X.509, PKI, mTLS, PowerShell, SQL Server, JWT, REST, Scrum, etc.).

## Interfaz de usuario (100 % en español)
Menús, títulos, botones, formularios, etiquetas, filtros, tablas, indicadores, gráficos, alertas, notificaciones, mensajes de error, confirmaciones, estados, reportes y exportaciones.

Terminología de referencia:
| Inglés | Español |
|---|---|
| Dashboard | Panel de control |
| Certificate Inventory | Inventario de certificados |
| Renewal Management | Gestión de renovaciones |
| Pending Approvals | Aprobaciones pendientes |
| Expiring Soon | Próximos a vencer |
| Deployment | Instalación |
| Rollback | Reversión |
| Audit Logs | Registros de auditoría |
| Security Findings | Hallazgos de seguridad |

## Documentación (en español, estilo técnico y académico)
README, arquitectura, diagramas técnicos, modelo de datos, manual de instalación, manual de usuario, documentación de API, matriz de riesgos, casos de prueba, evidencias experimentales, matriz de trazabilidad y reportes de validación.

## Código fuente
- **Inglés**: variables, funciones, clases, interfaces, tipos, endpoints, tablas, columnas y archivos de configuración.
- **Español**: comentarios explicativos, documentación de funciones, mensajes al usuario, descripciones de reglas de negocio y explicaciones de decisiones arquitectónicas.

## Localización (i18n)
- Sistema de internacionalización preparado para nuevos idiomas; `es` es el idioma predeterminado.
- Ningún texto visible al usuario se escribe directamente en el código: usar siempre claves de traducción (por ejemplo `locales/es/*.json`).
- Formatos regionales de Latinoamérica (fechas, números, moneda).
- Fechas almacenadas en UTC y presentadas en la zona horaria configurada para el usuario o país.
