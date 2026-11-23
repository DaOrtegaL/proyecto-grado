export type ValidityStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNKNOWN';
export type DataOrigin = 'SYNTHETIC' | 'MIXED' | 'AUTHORIZED';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  locale: string;
  timezone: string;
}

export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

export interface DashboardSummary {
  generatedAt: string;
  dataOrigin: DataOrigin;
  totals: {
    countries: number;
    stores: number;
    terminals: number;
    certificates: number;
    valid: number;
    expiringSoon: number;
    expired: number;
    unknown: number;
    withoutOwner: number;
    activeAlerts: number;
  };
  alertsByPriority: { priority: string; count: number }[];
  expiryBuckets: { bucket: string; count: number }[];
  certificatesByCountry: { code: string; name: string; count: number }[];
  certificatesByIssuer: { name: string; count: number }[];
  recentScans: {
    id: string;
    hostname: string;
    status: string;
    startedAt: string;
    certificatesFound: number;
    alertsCreated: number;
  }[];
}

export interface CertificateListItem {
  id: string;
  thumbprintSha256: string;
  subject: string;
  issuerDn: string;
  issuer: { id: string; name: string; kind: string } | null;
  owner: { id: string; name: string } | null;
  notAfter: string;
  status: ValidityStatus;
  daysRemaining: number | null;
  publicKeyAlgorithm: string;
  keySizeBits: number | null;
  isSynthetic: boolean;
  installations: { terminalId: string; hostname: string; storeCode: string; countryCode: string }[];
}

export interface Owner {
  id: string;
  name: string;
  email: string;
}

export interface CertificateDetail {
  id: string;
  thumbprintSha256: string;
  subject: string;
  issuerDn: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  publicKeyAlgorithm: string;
  keySizeBits: number | null;
  signatureAlgorithm: string;
  keyUsage: string[];
  extendedKeyUsage: string[];
  discoveredAt: string;
  lastVerifiedAt: string;
  isSynthetic: boolean;
  status: ValidityStatus;
  daysRemaining: number | null;
  issuer: { name: string; kind: string } | null;
  effectiveOwner: Owner | null;
  ownerSource: 'CERTIFICATE' | 'POLICY' | 'ISSUER' | null;
  installations: {
    id: string;
    storeLocation: string;
    storeName: string;
    status: string;
    hasPrivateKey: boolean;
    terminal: {
      id: string;
      hostname: string;
      store: { code: string; name: string; country: { code: string; name: string } };
    };
  }[];
  history: { id: string; change: string; createdAt: string; details: string | null }[];
  alerts: { id: string; thresholdDays: number; priority: string; status: string; createdAt: string }[];
}

export interface TerminalListItem {
  id: string;
  hostname: string;
  status: string;
  source: string;
  isSynthetic: boolean;
  osVersion: string;
  lastInventoryAt: string | null;
  model: { vendor: string; name: string };
  store: { id: string; code: string; name: string };
  country: { code: string; name: string; timezone: string };
  certificates: { total: number; expired: number; expiringSoon: number };
}

export interface InventoryRunResult {
  scanId: string;
  terminalId: string;
  hostname: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  certificatesFound: number;
  newCertificates: number;
  changedCertificates: number;
  missingCertificates: number;
  alertsCreated: number;
  errors: { store: string; message: string }[];
}

export interface AlertItem {
  id: string;
  thresholdDays: number;
  priority: string;
  status: string;
  createdAt: string;
  notAfter: string;
  daysRemaining: number;
  certificate: { id: string; subject: string };
  terminal: {
    id: string;
    hostname: string;
    isSynthetic: boolean;
    store: { code: string; name: string; country: { code: string; name: string } };
  };
  owner: Owner | null;
  notifications: { id: string; recipient: string; status: string }[];
}

export interface AuditItem {
  sequence: number;
  occurredAt: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: string;
  reason: string | null;
  correlationId: string;
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  brokenAtSequence?: number;
  reason?: string;
}
