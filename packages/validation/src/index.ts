import { z } from 'zod';

/** Esquema del reporte de inventario (contrato con el agente PowerShell y el simulador). */
export const certificateMetadataSchema = z.object({
  thumbprintSha256: z.string().regex(/^[A-F0-9]{64}$/, 'Huella SHA-256 inválida'),
  subject: z.string().min(1).max(512),
  issuer: z.string().min(1).max(512),
  serialNumber: z.string().min(1).max(128),
  notBefore: z.string().datetime(),
  notAfter: z.string().datetime(),
  publicKeyAlgorithm: z.string().min(1).max(64),
  keySizeBits: z.number().int().positive().nullable(),
  signatureAlgorithm: z.string().min(1).max(64),
  keyUsage: z.array(z.string().max(64)).max(16),
  extendedKeyUsage: z.array(z.string().max(128)).max(16),
  storeLocation: z.enum(['LocalMachine', 'CurrentUser']),
  storeName: z.string().min(1).max(64),
  hasPrivateKey: z.boolean(),
});

export const inventoryReportSchema = z.object({
  schemaVersion: z.literal('1.0'),
  source: z.enum(['SIMULATED', 'POWERSHELL_AGENT', 'MSH']),
  hostname: z.string().min(1).max(255),
  collectedAt: z.string().datetime(),
  certificates: z.array(certificateMetadataSchema).max(5000),
  errors: z.array(z.object({ store: z.string().max(64), message: z.string().max(1000) })).max(100),
});

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export const listCertificatesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().max(200).optional(),
  status: z.enum(['VALID', 'EXPIRING_SOON', 'EXPIRED', 'UNKNOWN']).optional(),
  countryCode: z.string().length(2).optional(),
  storeId: z.string().uuid().optional(),
  issuerId: z.string().uuid().optional(),
  sortBy: z.enum(['notAfter', 'subject', 'discoveredAt']).default('notAfter'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});
export type ListCertificatesQuery = z.infer<typeof listCertificatesQuerySchema>;

export const listAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().max(100).optional(),
  resourceType: z.string().max(100).optional(),
});

export const listAlertsQuerySchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPERSEDED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const alertActionSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const evidenceQuerySchema = z.object({
  format: z.enum(['json', 'csv', 'md']).default('json'),
});

const uuid = z.string().uuid();
const isoDate = z.string().datetime();

export const createOwnerSchema = z.object({
  name: z.string().min(3).max(200),
  email: z.string().email().max(254),
  countryCode: z.string().length(2).optional(),
});

export const assignOwnerSchema = z.object({
  scope: z.enum(['CERTIFICATE', 'POLICY', 'ISSUER']),
  targetId: uuid,
  ownerId: uuid.nullable(),
  reason: z.string().max(500).optional(),
});

export const createRenewalSchema = z.object({
  certificateId: uuid,
  terminalIds: z.array(uuid).min(1).max(100),
  reason: z.string().max(500).optional(),
});

export const updateRenewalTargetsSchema = z.object({
  terminalIds: z.array(uuid).min(1).max(100),
  reason: z.string().min(5).max(500),
});

export const requestApprovalSchema = z.object({
  maintenanceWindowId: uuid,
  justification: z.string().min(10).max(500),
});

export const decideApprovalSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  justification: z.string().min(5).max(500),
});

export const createWindowSchema = z
  .object({
    name: z.string().min(3).max(200),
    startsAt: isoDate,
    endsAt: isoDate,
    countryCode: z.string().length(2).optional(),
  })
  .refine((w) => Date.parse(w.endsAt) > Date.parse(w.startsAt), { message: 'La ventana debe terminar después de iniciar.' });

export const scheduleDeploymentSchema = z.object({
  approvalId: uuid,
  scheduledAt: isoDate,
  idempotencyKey: z.string().min(8).max(100),
  simulateFailure: z.enum(['NONE', 'INSTALL_FAILURE', 'VERIFICATION_FAILURE', 'ROLLBACK_FAILURE']).default('NONE'),
});

export const rollbackSchema = z.object({
  targetId: uuid,
  reason: z.string().min(5).max(500),
});

export const cancelSchema = z.object({ reason: z.string().min(5).max(500) });

export const listFindingsQuerySchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']).optional(),
  type: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const findingActionSchema = z.object({ reason: z.string().min(5).max(500) });

export const registerAgentSchema = z.object({
  terminalId: uuid,
  publicKeyPem: z.string().min(80).max(2000).regex(/BEGIN PUBLIC KEY/, 'Debe ser una clave pública PEM'),
});

export const metricsRangeSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const createSnapshotSchema = z.object({
  kind: z.enum(['BASELINE', 'PILOT']),
  label: z.string().min(3).max(200),
  periodStart: isoDate,
  periodEnd: isoDate,
  notes: z.string().max(500).optional(),
});

export const comparisonQuerySchema = z.object({ baselineId: uuid, pilotId: uuid });

export const createIncidentSchema = z.object({
  severity: z.enum(['P1', 'P2', 'P3']),
  title: z.string().min(5).max(300),
  occurredAt: isoDate,
  resolvedAt: isoDate.optional(),
  certificateId: uuid.optional(),
  terminalId: uuid.optional(),
  countryCode: z.string().length(2).optional(),
  period: z.enum(['BASELINE', 'PILOT']),
});

export const susSubmitSchema = z.object({
  respondentRole: z.string().min(2).max(64),
  answers: z.array(z.number().int().min(1).max(5)).length(10),
});

export const createSampleSchema = z.object({
  countries: z.array(z.string().length(2)).min(1).max(6),
  storesCount: z.number().int().min(0),
  terminalsCount: z.number().int().min(0),
  certificatesObserved: z.number().int().min(0),
  informants: z.number().int().min(0),
  ticketsAnalyzed: z.number().int().min(0),
  periodStart: isoDate,
  periodEnd: isoDate,
  inclusionCriteria: z.string().min(5).max(500),
  exclusionCriteria: z.string().min(5).max(500),
});

export const createRunSchema = z.object({
  code: z.string().min(3).max(40),
  objective: z.string().min(5).max(300),
  requirementCode: z.string().min(3).max(16),
  scenario: z.string().min(3).max(200),
  environment: z.string().min(3).max(100),
  sample: z.string().min(1).max(300),
  parameters: z.record(z.unknown()).default({}),
  expectedResult: z.string().min(3).max(500),
  obtainedResult: z.string().min(3).max(500),
  metrics: z.record(z.unknown()).default({}),
  status: z.enum(['PASSED', 'FAILED', 'PENDING']),
  limitations: z.string().min(3).max(500),
  trlLevel: z.number().int().min(2).max(4).optional(),
  isSynthetic: z.boolean().default(true),
});

export const runExportQuerySchema = z.object({ format: z.enum(['json', 'csv', 'md']).default('json') });

export const traceabilityUpdateSchema = z.object({
  status: z.enum(['NOT_STARTED', 'IN_DEVELOPMENT', 'IMPLEMENTED', 'TESTED', 'VALIDATED']),
  testCase: z.string().max(300).optional(),
  testResult: z.string().max(300).optional(),
  evidenceRunId: uuid.optional(),
});

export const updateTargetSchema = z.object({
  targetValue: z.number(),
  justification: z.string().min(5).max(500),
  approvalStatus: z.enum(['PROPOSED', 'APPROVED']),
});

export const runScenarioSchema = z.object({ code: z.string().min(2).max(10) });

export const listRenewalsQuerySchema = z.object({
  status: z.string().max(24).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});