# Arquitectura del sistema

## 1. Principios
Monolito modular sin microservicios innecesarios; reglas de negocio puras en `packages/domain`; integraciones detrás de puertos (adaptadores); seguridad desde el diseño; persistencia intercambiable (SQL Server o archivos JSON) sin cambiar los servicios.

## 2. Capas
| Capa | Implementación |
|---|---|
| Terminal POS | Script `powershell/inventory/Get-CertificateInventory.ps1` (real, solo lectura) y terminales virtuales |
| Integración | `SimulatedPosAdapter`, `SimulatedCertificateIssuer`, `SimulatedDeploymentExecutor`, `BasicCertificateValidator`, `InAppNotificationProvider`, `SimulatedMshAdapter` (activos); `WindowsCertificateStoreAdapter` (**deshabilitado**) |
| Servicios de negocio | Módulos NestJS: autenticación, auditoría, inventario, alertas, seguridad/anomalías, responsables, renovaciones, instalaciones, monitoreo, investigación, simulador, administración |
| Persistencia | `PrismaService` (SQL Server) o `MockPrismaClient` (JSON), elegidos por `MOCK_DATABASE` |
| Presentación | React: 15 pantallas en español |

## 3. Flujo de información de extremo a extremo
```mermaid
sequenceDiagram
    actor U as Usuario
    participant W as Web (React)
    participant A as API (NestJS)
    participant P as Adaptador de terminal
    participant D as Persistencia
    U->>W: Ejecutar inventario
    W->>A: POST /terminals/{id}/inventory (JWT)
    A->>A: Autenticación y permiso
    A->>P: collect(terminal)
    P-->>A: InventoryReport (solo metadatos públicos)
    A->>A: Valida contrato (Zod)
    A->>D: Transacción: certificados, instalaciones, hallazgos, alertas, anomalías, auditoría
    A-->>W: Resultado de la ejecución
    W-->>U: Resumen y evidencia exportable (JSON/CSV/MD)
```

## 4. Flujo de inventario por agente
```mermaid
sequenceDiagram
    participant G as Agente PowerShell
    participant A as Gateway de agentes
    participant D as Persistencia
    G->>A: POST /agent/v1/inventory + firma Ed25519 + marca de tiempo + nonce
    A->>D: ¿Agente activo? ¿Firma válida? ¿Nonce nuevo? ¿Terminal correcta?
    alt Alguna validación falla
        A-->>G: 401 / 403 / 409 y evento de auditoría DENIED
    else Todo válido
        A->>D: Ingesta del reporte (misma ruta que el inventario manual)
        A-->>G: 201
    end
```

## 5. Decisiones arquitectónicas
- [ADR-001](adr/001-monorepo-y-lenguaje.md) Monorepositorio, idioma y convenciones.
- [ADR-002](adr/002-auditoria-encadenada.md) Auditoría encadenada.
- [ADR-003](adr/003-identidad-certificado-vs-instalacion.md) Certificado frente a instalación.
- [ADR-004](adr/004-prisma-6-sql-server.md) Prisma 6 y SQL Server.
- [ADR-005](adr/005-base-de-datos-simulada.md) Base de datos simulada en JSON.
- [ADR-006](adr/006-aprobacion-por-huella-de-parametros.md) Aprobación vinculada a la huella de parámetros.
