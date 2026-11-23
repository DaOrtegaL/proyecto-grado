# ADR-006 — Aprobación vinculada a la huella de parámetros

**Estado:** aceptada.

**Contexto.** RF07 exige que cualquier cambio relevante en certificado, terminales, operación, ventana o responsable invalide la aprobación.

**Decisión.** Al solicitar la aprobación se guarda `parametersHash` = SHA-256 de un JSON canónico de esos parámetros (terminales ordenadas). Se recalcula al decidir, al programar y al ejecutar; si difiere, la aprobación pasa a `INVALIDATED`, las instalaciones programadas se cancelan y la renovación vuelve a `ISSUED`. La aprobación también vence (`approval.validityHours`).

**Consecuencias.** Es imposible instalar algo distinto de lo aprobado sin una nueva decisión. El responsable efectivo forma parte de la huella: reasignar responsables invalida aprobaciones pendientes, lo cual es deliberado y se documenta.
