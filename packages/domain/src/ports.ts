import type { CertificateMetadata, TerminalRef } from './inventory';

/** Contratos de los adaptadores de integración. Las implementaciones reales permanecen deshabilitadas. */

export interface IssuanceRequest {
  subjectCommonName: string;
  issuerDn: string;
  validityDays: number;
  keyKind: 'EC_P256' | 'RSA_2048';
  now: Date;
}

export interface IssuanceResult {
  /** Solo la parte pública; la clave privada se aprovisiona por un mecanismo externo y autorizado. */
  certificatePem: string;
  evidence: {
    issuerAdapter: string;
    requestId: string;
    issuedAtUtc: string;
    serialNumber: string;
    thumbprintSha256: string;
    issuerDn: string;
    note: string;
  };
}

export interface CertificateIssuerAdapter {
  readonly name: string;
  issue(request: IssuanceRequest): Promise<IssuanceResult>;
}

export interface SlotSnapshot {
  pem: string;
  storeLocation: string;
  storeName: string;
  hasPrivateKey: boolean;
}

/** Ejecución controlada de instalaciones; nunca ejecuta comandos arbitrarios ni transmite claves privadas. */
export interface DeploymentExecutionAdapter {
  readonly name: string;
  snapshot(terminal: TerminalRef): Promise<SlotSnapshot[]>;
  install(terminal: TerminalRef, newCertificatePem: string, replaceThumbprintSha256: string): Promise<void>;
  restore(terminal: TerminalRef, snapshot: SlotSnapshot[]): Promise<void>;
}

export interface ValidationOutcome {
  valid: boolean;
  reasons: string[];
}

export interface CertificateValidationAdapter {
  readonly name: string;
  validate(metadata: CertificateMetadata, now: Date): ValidationOutcome;
}

export interface OutboundNotification {
  alertId: string;
  recipient: string;
  subject: string;
  body: string;
}

export interface NotificationProviderAdapter {
  readonly name: string;
  send(notification: OutboundNotification): Promise<{ delivered: boolean; reference: string }>;
}

/**
 * Contrato PROPUESTO con My Store Health. No se han confirmado endpoints, autenticación ni modelos de MSH;
 * esta interfaz solo delimita lo que MSH-CLM necesitaría y se implementa únicamente de forma simulada.
 */
export interface MshIntegrationAdapter {
  readonly name: string;
  listStores(): Promise<{ code: string; name: string; countryCode: string }[]>;
  publishCertificateSummary(summary: { storeCode: string; expiring: number; expired: number }): Promise<void>;
}
