# Integración y API REST

Prefijo `/api/v1`. Swagger: `/api/docs`. Autenticación `Authorization: Bearer <JWT>`. Errores: `{ code, message, details?, correlationId }` en español; se acepta `x-correlation-id`. Se omiten el prefijo y los parámetros de paginación en la tabla.

| Recurso | Método y ruta | Permiso |
|---|---|---|
| Autenticación | `POST /auth/login`, `/auth/refresh`, `/auth/logout`; `GET /auth/me` | pública / autenticado |
| Estado | `GET /health` | pública |
| Panel | `GET /dashboard` | `dashboard:read` |
| Catálogos | `GET /countries`, `/issuers`, `/terminals`, `/terminals/:id` | `geo:read`, `certificates:read` |
| Inventario | `POST /terminals/:id/inventory` | `inventory:run` |
| Certificados | `GET /certificates`, `/certificates/export`, `/certificates/:id` | `certificates:read` / `:export` |
| Evidencia de inventario | `GET /inventory/scans/:id/evidence?format=json\|csv\|md` | `evidence:export` |
| Alertas | `GET /alerts`; `POST /alerts/:id/acknowledge`, `/resolve` | `alerts:read` / `:manage` |
| Seguridad | `GET /security/findings`; `POST /security/findings/:id/resolve`, `/dismiss`, `/security/evaluate` | `security:read` / `:manage` |
| Responsables | `GET /owners`; `POST /owners`, `/owners/assign` | `owners:read` / `:manage` |
| Renovaciones | `GET /renewals`, `/renewals/:id`; `POST /renewals`, `/:id/request-issuance`, `/:id/issue`, `/:id/request-approval`, `/:id/cancel`; `PUT /:id/targets` | `renewals:read`, `:create`, `:issue` |
| Aprobaciones | `GET /approvals`; `POST /approvals/:id/decision` | `approvals:read` / `:decide` |
| Instalaciones | `GET/POST /maintenance-windows`; `GET/POST /deployments`; `POST /deployments/:id/execute`, `/:id/rollback`, `/deployments/reconcile` | `deployments:*`, `maintenance:manage` |
| Monitoreo | `POST /monitoring/sweep` | `alerts:manage` |
| Agentes | `POST /agent/v1/inventory` (firmado); `GET/POST /agents`; `POST /agents/:id/deactivate` | firma Ed25519 / `agents:manage` |
| Indicadores | `GET /metrics/definitions`, `/targets`, `/current`, `/snapshots`, `/comparison`, `/comparison/export`; `POST /metrics/snapshots`; `PUT /metrics/targets/:code` | `metrics:read` / `:manage` |
| Investigación | `GET/POST /incidents`, `/research/samples`, `/research/runs`; `GET /research/runs/:id/export`, `/research/trl`, `/traceability`; `PUT /traceability/:code`; `GET /sus/questions`, `/sus/results`; `POST /sus` | `metrics:*`, `research:*` |
| Simulador | `GET /simulator/scenarios`; `POST /simulator/scenarios/run`, `/run-all` | `simulator:manage` |
| Administración | `GET /admin/users`, `/admin/roles`, `/admin/policies`; `PUT /admin/config/:key` | `admin:read`, `users:manage` |
| Auditoría | `GET /audit`, `/audit/verify` | `audit:read`, `audit:verify` |

## Gateway de agentes
Cabeceras `x-agent-id`, `x-timestamp` (ISO-8601 UTC, ±5 min), `x-nonce` (único por agente) y `x-signature` (Ed25519 en base64 sobre `timestamp.nonce.sha256(cuerpo)`). Respuestas de rechazo: `AGENT_IDENTITY_INVALID` (401), `AGENT_TIMESTAMP_INVALID` (401), `AGENT_SIGNATURE_INVALID` (401), `AGENT_REPLAY_DETECTED` (409), `AGENT_TERMINAL_MISMATCH` (403).

## Adaptadores (puertos en `packages/domain`)
| Puerto | Implementación | Estado |
|---|---|---|
| `TerminalInventoryPort` | `SimulatedPosAdapter` | Activo |
| `TerminalInventoryPort` | `WindowsCertificateStoreAdapter` | **Deshabilitado** |
| `CertificateIssuerAdapter` | `SimulatedCertificateIssuer` | Activo (simulado) |
| `DeploymentExecutionAdapter` | `SimulatedDeploymentExecutor` | Activo (simulado) |
| `CertificateValidationAdapter` | `BasicCertificateValidator` | Activo |
| `NotificationProviderAdapter` | `InAppNotificationProvider` | Activo (solo interno) |
| `MshIntegrationAdapter` | `SimulatedMshAdapter` | Simulado. **Contrato propuesto**: no se han confirmado endpoints, autenticación ni modelos de MSH |
