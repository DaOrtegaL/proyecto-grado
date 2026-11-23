# Modelo de amenazas (STRIDE)

| Categoría | Amenaza | Control | Riesgo residual | Prueba |
|---|---|---|---|---|
| **S**uplantación | Un agente falso reporta inventarios | Ed25519 por terminal; hostname debe coincidir; agente desactivable | Robo de la clave privada del agente en la terminal | `flow.full.spec.ts` (agentes), S16 |
| Suplantación | Robo o reutilización del refresco | Refresco rotatorio con revocación de la familia ante reutilización; cookie `httpOnly`/`SameSite` | XSS que use la sesión activa | `app.wiring.spec.ts` |
| **M**anipulación | Alterar eventos de auditoría | Hash encadenado y verificación | Quien controle la base puede reescribir toda la cadena o truncar los últimos eventos | `resilience.spec.ts` |
| Manipulación | Alterar una aprobación o sus parámetros | Huella de parámetros; invalidación; vigencia | — | `flow.full.spec.ts` |
| Manipulación | Script alterado | Verificación de firma (`Test-ScriptTrust.ps1`) | La verificación aún no está integrada en un ejecutor real | `script-signature.spec.ts` |
| Manipulación | Reenvío de solicitudes de agente | Marca de tiempo y nonce único | — | `flow.full.spec.ts` |
| **R**epudio | Negar una aprobación o instalación | Auditoría con usuario, estado previo/posterior, motivo y correlación | Cuentas compartidas | `flow.full.spec.ts` |
| **D**ivulgación | Exposición de claves privadas o hashes | No se almacenan ni exportan; respuestas filtradas | Configuración incorrecta del despliegue | `private-key-controls.spec.ts`, `resilience.spec.ts` |
| Divulgación | Filtración de errores internos | Filtro global con mensajes genéricos | — | `resilience.spec.ts` |
| **D**enegación de servicio | Exceso de solicitudes o de inicios de sesión | Límite de tasa; transacciones serializadas | Límites por IP en proxies; sin cuotas por usuario | — (relajado en E2E) |
| Denegación de servicio | Instalación interrumpida que bloquea una renovación | Conciliación que marca la operación como fallida | — | `resilience.spec.ts` |
| **E**levación de privilegios | Usar permisos que el rol no posee | RBAC en servidor y auditoría de denegaciones | Roles demasiado amplios en producción | E2E04, `flow.full.spec.ts` |
| Elevación de privilegios | Autoaprobación | Separación de funciones | Colusión entre dos usuarios | `flow.full.spec.ts` |
| Elevación de privilegios | Ejecución arbitraria remota | No existe; modo laboratorio deshabilitado | Futuros adaptadores reales | — |

Las amenazas sobre infraestructura productiva (red, hosts, secretos) no se evalúan porque el prototipo no se ha desplegado en producción.
