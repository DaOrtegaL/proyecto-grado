# ADR-003 — Separación entre certificado e instalación

**Estado:** aceptada.

**Decisión.** `Certificate` representa la identidad (huella SHA-256 única) y `CertificateInstallation` su presencia en una terminal y almacén. Los certificados compartidos, como una CA raíz, existen una sola vez y tienen múltiples instalaciones. Las alertas se deduplican por certificado, terminal y umbral. La ausencia de un certificado en un inventario completo marca la instalación como `MISSING`; en un inventario parcial no se marcan como ausentes los almacenes con error de lectura.
