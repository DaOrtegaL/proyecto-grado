import { createHash } from 'node:crypto';

/** Ciclo de vida de una solicitud de renovación (RF06). */
export const RENEWAL_STATUSES = [
  'REQUESTED',
  'PENDING_ISSUANCE',
  'ISSUED',
  'PENDING_APPROVAL',
  'APPROVED',
  'SCHEDULED',
  'INSTALLING',
  'INSTALLED',
  'VERIFIED',
  'COMPLETED',
  'REJECTED',
  'FAILED',
  'CANCELLED',
  'ROLLED_BACK',
] as const;

export type RenewalStatus = (typeof RENEWAL_STATUSES)[number];

const TRANSITIONS: Record<RenewalStatus, RenewalStatus[]> = {
  REQUESTED: ['PENDING_ISSUANCE', 'CANCELLED'],
  PENDING_ISSUANCE: ['ISSUED', 'FAILED', 'CANCELLED'],
  ISSUED: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'ISSUED', 'CANCELLED'],
  APPROVED: ['SCHEDULED', 'ISSUED', 'CANCELLED'],
  SCHEDULED: ['INSTALLING', 'ISSUED', 'CANCELLED'],
  INSTALLING: ['INSTALLED', 'FAILED', 'ROLLED_BACK'],
  INSTALLED: ['VERIFIED', 'FAILED', 'ROLLED_BACK'],
  VERIFIED: ['COMPLETED'],
  COMPLETED: [],
  REJECTED: [],
  FAILED: ['ROLLED_BACK', 'ISSUED'],
  CANCELLED: [],
  ROLLED_BACK: ['ISSUED'],
};

export function canTransition(from: RenewalStatus, to: RenewalStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedTransitions(from: RenewalStatus): RenewalStatus[] {
  return [...(TRANSITIONS[from] ?? [])];
}

export const TERMINAL_RENEWAL_STATUSES: RenewalStatus[] = ['COMPLETED', 'REJECTED', 'CANCELLED'];

export interface ApprovalParameters {
  certificateId: string;
  newCertificateThumbprint: string;
  terminalIds: string[];
  operation: 'INSTALL_CERTIFICATE';
  maintenanceWindowId: string | null;
  ownerId: string | null;
}

/**
 * Huella de los parámetros sujetos a aprobación (RF07): certificado, terminales, operación,
 * ventana de mantenimiento y responsable. Cualquier cambio produce otra huella e invalida la aprobación.
 */
export function computeApprovalHash(p: ApprovalParameters): string {
  const canonical = JSON.stringify({
    certificateId: p.certificateId,
    newCertificateThumbprint: p.newCertificateThumbprint,
    terminalIds: [...p.terminalIds].sort(),
    operation: p.operation,
    maintenanceWindowId: p.maintenanceWindowId,
    ownerId: p.ownerId,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
