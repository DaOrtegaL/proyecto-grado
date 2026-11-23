# Agente PowerShell de inventario (RF01, RNF04)

## Script de inventario
[powershell/inventory/Get-CertificateInventory.ps1](../powershell/inventory/Get-CertificateInventory.ps1). Compatible con Windows PowerShell 5.1.

- Solo lectura: abre los almacenes con `OpenFlags.ReadOnly`.
- Solo almacenes autorizados (`My`, `Root`, `CA`, `TrustedPeople`) y ubicaciones `LocalMachine` / `CurrentUser` (`ValidateSet`).
- Nunca lee ni exporta claves privadas; consulta únicamente `HasPrivateKey`. Una prueba estática lo comprueba.
- Un almacén inaccesible produce un resultado **parcial** (`errors[]`); código de salida 2 solo si ningún almacén pudo leerse.

```powershell
.\powershell\inventory\Get-CertificateInventory.ps1 -StoreLocations LocalMachine -StoreNames My,Root -OutputPath .\inventario.json
```

## Contrato de salida (`InventoryReport` v1.0)
```json
{
  "schemaVersion": "1.0", "source": "POWERSHELL_AGENT", "hostname": "POS-CO-001-01", "collectedAt": "2026-06-01T12:00:00.000Z",
  "certificates": [{
    "thumbprintSha256": "…64 hex en mayúsculas…", "subject": "CN=…", "issuer": "CN=…", "serialNumber": "…",
    "notBefore": "…Z", "notAfter": "…Z", "publicKeyAlgorithm": "RSA", "keySizeBits": 2048,
    "signatureAlgorithm": "RSASSA-PKCS1-v1_5-SHA256", "keyUsage": ["digitalSignature"], "extendedKeyUsage": ["clientAuth"],
    "storeLocation": "LocalMachine", "storeName": "My", "hasPrivateKey": true
  }],
  "errors": []
}
```
Esquema Zod: `inventoryReportSchema` (`packages/validation`).

## Envío al gateway
El agente firma cada solicitud con su clave privada Ed25519 (que **nunca** sale de la terminal) y la API verifica con la clave pública registrada. Detalles y códigos de error en [integracion-api.md](integracion-api.md). El script de inventario no incluye aún el cliente HTTP firmado: la firma se ejercita en las pruebas y en el simulador.

## Verificación de firma (RNF04)
[powershell/Test-ScriptTrust.ps1](../powershell/Test-ScriptTrust.ps1) rechaza (código 3) scripts sin firma, modificados después de firmarse o firmados por un certificado que no figura en la lista de huellas autorizadas. Los certificados de laboratorio autofirmados dan el estado `UnknownError` y solo se aceptan si su huella está autorizada.

## Estado
La ejecución remota, la firma del propio script de inventario con un certificado autorizado y el cliente del gateway **no están implementados**. `WindowsCertificateStoreAdapter` permanece deshabilitado hasta contar con un mecanismo aprobado.
