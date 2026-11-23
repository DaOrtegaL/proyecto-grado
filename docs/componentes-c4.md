# Componentes (C4 nivel 3) — API

```mermaid
flowchart TB
    guard[AuthGuard global<br/>JWT + permisos + auditoría de denegaciones] --> ctrl[Controladores REST]
    ctrl --> inv[InventoryService]
    ctrl --> cert[CertificatesService]
    ctrl --> alr[AlertsService]
    ctrl --> own[OwnersService]
    ctrl --> ren[RenewalsService]
    ctrl --> dep[DeploymentsService]
    ctrl --> res[ResearchService]
    ctrl --> sim[SimulatorService]
    gw[AgentGatewayService] --> inv
    mon[MonitoringService<br/>temporizador + barrido] --> alr
    mon --> ano[AnomalyService]
    mon --> dep
    inv --> alr
    inv --> ano
    dep --> inv
    dep --> ren
    sim --> inv & ren & dep & res & gw & own
    inv & ren & dep & res & alr & own & ano --> aud[AuditService<br/>hash encadenado]
    aud & inv & ren & dep & res --> db[(PrismaService / MockPrismaClient)]
    dom[packages/domain<br/>vigencia, umbrales, estados, huella de aprobación,<br/>anomalías, indicadores, firma de agente]
    inv & alr & ren & ano & res & gw --> dom
```

Módulos NestJS: `AuthModule`, `AuditModule`, `PrismaModule` (globales), `InventoryModule`, `AlertsModule`, `SecurityModule`, `RenewalsModule`, `ResearchModule` y `OperationsModule` (administración, responsables, monitoreo y simulador).
