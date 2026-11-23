# Contexto (C4 nivel 1)

```mermaid
C4Context
    title MSH-CLM — Diagrama de contexto
    Person(op, "Operadores", "PKI, Retail IT, Payment Integration, Soporte, Auditoría")
    System(clm, "MSH-CLM", "Inventario, alertas y auditoría de certificados X.509")
    System_Ext(msh, "My Store Health (MSH)", "Plataforma de monitoreo. Integración futura mediante adaptador")
    System_Ext(pos, "Terminales POS Windows 10 IoT", "Almacenes de certificados (solo lectura)")
    System_Ext(ca, "Autoridades emisoras", "PKI interna y proveedores externos. No se reemplazan")
    Rel(op, clm, "Usa", "HTTPS")
    Rel(clm, pos, "Inventario de solo lectura", "Script PowerShell / simulador")
    Rel(clm, msh, "Integración futura", "Adaptador (simulado)")
    Rel(clm, ca, "Solicitud de emisión (futuro)", "Adaptador pendiente")
```

Estado: en esta versión solo el simulador y el script local están operativos; MSH y las autoridades emisoras son interfaces pendientes. No se asumen endpoints ni contratos de MSH.
