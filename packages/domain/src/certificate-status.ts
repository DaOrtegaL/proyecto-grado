/** Estados de vigencia (RF04). La expiración es independiente de la revocación y del estado de instalación. */
export type ValidityStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNKNOWN';

export interface ValidityResult {
  status: ValidityStatus;
  /** Días enteros restantes (negativo cuando ya venció). `null` si se desconoce la fecha. */
  daysRemaining: number | null;
}

export const DEFAULT_EXPIRING_SOON_DAYS = 60;
const MS_PER_DAY = 86_400_000;

/**
 * Clasifica la vigencia de un certificado a partir de su fecha de vencimiento.
 * El reloj (`now`) se inyecta para que las pruebas y los escenarios sean reproducibles.
 */
export function classifyValidity(
  notAfter: Date | null | undefined,
  now: Date,
  expiringSoonDays: number = DEFAULT_EXPIRING_SOON_DAYS,
): ValidityResult {
  if (!notAfter || Number.isNaN(notAfter.getTime())) {
    return { status: 'UNKNOWN', daysRemaining: null };
  }
  const daysRemaining = Math.floor((notAfter.getTime() - now.getTime()) / MS_PER_DAY);
  if (notAfter.getTime() <= now.getTime()) return { status: 'EXPIRED', daysRemaining };
  if (daysRemaining <= expiringSoonDays) return { status: 'EXPIRING_SOON', daysRemaining };
  return { status: 'VALID', daysRemaining };
}
