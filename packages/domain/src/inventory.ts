/** Contrato del reporte de inventario producido por cualquier fuente (simulador, agente PowerShell, MSH). */
export const INVENTORY_REPORT_SCHEMA_VERSION = '1.0';

export interface CertificateMetadata {
  thumbprintSha256: string;
  subject: string;
  issuer: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  publicKeyAlgorithm: string;
  keySizeBits: number | null;
  signatureAlgorithm: string;
  keyUsage: string[];
  extendedKeyUsage: string[];
  storeLocation: string;
  storeName: string;
  /** Solo indica existencia; la clave privada nunca se lee ni se transmite. */
  hasPrivateKey: boolean;
}

export interface InventoryReport {
  schemaVersion: string;
  source: 'SIMULATED' | 'POWERSHELL_AGENT' | 'MSH';
  hostname: string;
  collectedAt: string;
  certificates: CertificateMetadata[];
  /** Errores parciales (por ejemplo, un almacén inaccesible). Un reporte puede ser parcial. */
  errors: { store: string; message: string }[];
}

export interface TerminalRef {
  id: string;
  hostname: string;
}

/** Puerto de lectura de inventario (RF01). Los adaptadores reales permanecen deshabilitados hasta autorización. */
export interface TerminalInventoryPort {
  readonly name: string;
  collect(terminal: TerminalRef): Promise<InventoryReport>;
}

export class AdapterDisabledError extends Error {
  constructor(adapter: string) {
    super(`El adaptador ${adapter} está deshabilitado hasta validar configuración y permisos.`);
    this.name = 'AdapterDisabledError';
  }
}

export class TerminalUnreachableError extends Error {
  constructor(hostname: string) {
    super(`La terminal ${hostname} no está disponible.`);
    this.name = 'TerminalUnreachableError';
  }
}
