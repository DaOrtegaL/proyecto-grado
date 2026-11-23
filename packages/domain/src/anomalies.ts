import { classifyValidity } from './certificate-status';

export type FindingType =
  | 'EXPIRED'
  | 'WEAK_ALGORITHM'
  | 'UNKNOWN_ISSUER'
  | 'NO_OWNER'
  | 'UNEXPECTED_CERTIFICATE'
  | 'MISSING_CLIENT_CERTIFICATE'
  | 'DUPLICATE_SUBJECT'
  | 'STALE_INVENTORY'
  | 'INCOMPATIBLE_USAGE'
  | 'UNAUTHORIZED_CHANGE';

export type FindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AnomalyPolicy {
  minKeySizeBits: number;
  weakSignatures: string[];
  requiredEku: string;
  /** Almacenes esperados en una terminal POS. */
  expectedStores: string[];
  staleInventoryDays: number;
}

export const DEFAULT_ANOMALY_POLICY: AnomalyPolicy = {
  minKeySizeBits: 2048,
  weakSignatures: ['RSASSA-PKCS1-v1_5-SHA1', 'ECDSA-SHA1'],
  requiredEku: 'clientAuth',
  expectedStores: ['My', 'Root'],
  staleInventoryDays: 7,
};

export interface InstallationView {
  certificateId: string;
  thumbprintSha256: string;
  subject: string;
  notAfter: Date;
  publicKeyAlgorithm: string;
  keySizeBits: number | null;
  signatureAlgorithm: string;
  extendedKeyUsage: string[];
  issuerKnown: boolean;
  hasOwner: boolean;
  storeName: string;
  hasPrivateKey: boolean;
}

export interface AnomalyFinding {
  type: FindingType;
  severity: FindingSeverity;
  certificateId: string | null;
  detail: string;
  recommendation: string;
}

/** Clave de deduplicación de un hallazgo por tipo, certificado y terminal. */
export const findingKey = (type: FindingType, certificateId: string | null, terminalId: string) =>
  `${type}:${certificateId ?? '-'}:${terminalId}`;

/**
 * Evalúa las reglas configurables (RF12) sobre las instalaciones PRESENTES de una terminal.
 * Los hallazgos son indicios para revisión humana; no se clasifican como maliciosos.
 */
export function evaluateTerminalAnomalies(
  installations: InstallationView[],
  lastInventoryAt: Date | null,
  now: Date,
  policy: AnomalyPolicy = DEFAULT_ANOMALY_POLICY,
): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  const clientCerts = installations.filter((i) => i.storeName === 'My' && i.hasPrivateKey);

  for (const i of installations) {
    const validity = classifyValidity(i.notAfter, now);
    const isClientCert = i.storeName === 'My' && i.hasPrivateKey;

    if (validity.status === 'EXPIRED') {
      findings.push({
        type: 'EXPIRED',
        severity: isClientCert ? 'CRITICAL' : 'MEDIUM',
        certificateId: i.certificateId,
        detail: `El certificado ${i.subject} está vencido.`,
        recommendation: 'Iniciar una renovación y programar la instalación en una ventana de mantenimiento.',
      });
    }

    const weakKey = i.publicKeyAlgorithm === 'RSA' && (i.keySizeBits ?? 0) < policy.minKeySizeBits;
    const weakSig = policy.weakSignatures.includes(i.signatureAlgorithm);
    if (weakKey || weakSig) {
      findings.push({
        type: 'WEAK_ALGORITHM',
        severity: 'HIGH',
        certificateId: i.certificateId,
        detail: `Algoritmo débil: clave ${i.publicKeyAlgorithm} de ${i.keySizeBits ?? '?'} bits, firma ${i.signatureAlgorithm}.`,
        recommendation: `Reemplazar por un certificado con clave de al menos ${policy.minKeySizeBits} bits (RSA) o ECDSA y firma SHA-256 o superior.`,
      });
    }

    if (!i.issuerKnown && isClientCert) {
      findings.push({
        type: 'UNKNOWN_ISSUER',
        severity: 'MEDIUM',
        certificateId: i.certificateId,
        detail: `El emisor de ${i.subject} no está registrado como autoridad conocida.`,
        recommendation: 'Confirmar con el equipo PKI si el emisor es legítimo y registrarlo, o reemplazar el certificado.',
      });
    }

    if (!i.hasOwner && isClientCert) {
      findings.push({
        type: 'NO_OWNER',
        severity: 'MEDIUM',
        certificateId: i.certificateId,
        detail: `El certificado ${i.subject} no tiene responsable efectivo.`,
        recommendation: 'Asignar un responsable por certificado, política o emisor.',
      });
    }

    if (!policy.expectedStores.includes(i.storeName)) {
      findings.push({
        type: 'UNEXPECTED_CERTIFICATE',
        severity: 'LOW',
        certificateId: i.certificateId,
        detail: `Certificado en el almacén ${i.storeName}, que no está entre los esperados (${policy.expectedStores.join(', ')}).`,
        recommendation: 'Verificar el origen del certificado; no implica por sí mismo un incidente de seguridad.',
      });
    }

    if (isClientCert && !i.extendedKeyUsage.includes(policy.requiredEku)) {
      findings.push({
        type: 'INCOMPATIBLE_USAGE',
        severity: 'MEDIUM',
        certificateId: i.certificateId,
        detail: `El certificado no declara el uso extendido requerido (${policy.requiredEku}).`,
        recommendation: 'Solicitar un certificado con el uso extendido de clave adecuado para mTLS.',
      });
    }
  }

  // Duplicados: mismo subject con huellas distintas en el mismo almacén.
  const bySubject = new Map<string, InstallationView[]>();
  for (const i of installations.filter((x) => x.storeName === 'My')) {
    bySubject.set(i.subject, [...(bySubject.get(i.subject) ?? []), i]);
  }
  for (const [subject, list] of bySubject) {
    const thumbs = new Set(list.map((l) => l.thumbprintSha256));
    if (thumbs.size < 2) continue;
    const overlap = list.some((l) => classifyValidity(l.notAfter, now).status === 'EXPIRED');
    // Si uno de los certificados ya venció, es coherente con una renovación en transición.
    findings.push({
      type: 'DUPLICATE_SUBJECT',
      severity: overlap ? 'LOW' : 'MEDIUM',
      certificateId: list[0].certificateId,
      detail: `Hay ${thumbs.size} certificados con el mismo sujeto (${subject}) en el almacén My.`,
      recommendation: overlap
        ? 'Probable renovación en transición; retirar el certificado vencido tras verificar la instalación.'
        : 'Confirmar cuál es el certificado vigente y retirar el redundante.',
    });
  }

  if (clientCerts.length === 0) {
    findings.push({
      type: 'MISSING_CLIENT_CERTIFICATE',
      severity: 'HIGH',
      certificateId: null,
      detail: 'La terminal no tiene certificado de cliente con clave privada en el almacén My.',
      recommendation: 'Solicitar la emisión e instalación del certificado de cliente para mTLS.',
    });
  }

  const staleMs = policy.staleInventoryDays * 86_400_000;
  if (!lastInventoryAt || now.getTime() - lastInventoryAt.getTime() > staleMs) {
    findings.push({
      type: 'STALE_INVENTORY',
      severity: 'LOW',
      certificateId: null,
      detail: `El último inventario tiene más de ${policy.staleInventoryDays} días o no existe.`,
      recommendation: 'Ejecutar un nuevo inventario de la terminal.',
    });
  }
  return findings;
}
