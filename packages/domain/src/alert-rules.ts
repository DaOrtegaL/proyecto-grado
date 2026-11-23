import { classifyValidity } from './certificate-status';

/** Umbrales preliminares de alerta en días (RF05); configurables mediante política. */
export const DEFAULT_ALERT_THRESHOLDS_DAYS = [60, 30, 15, 7] as const;

export type AlertPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AlertDecision {
  /** Umbral en días que se cruzó; 0 representa un certificado ya vencido. */
  thresholdDays: number;
  priority: AlertPriority;
}

/**
 * Determina el umbral más cercano al vencimiento que ya fue cruzado.
 * Retorna `null` si el certificado no requiere alerta o si se desconoce su vigencia.
 */
export function decideAlert(
  notAfter: Date | null | undefined,
  now: Date,
  thresholdsDays: readonly number[] = DEFAULT_ALERT_THRESHOLDS_DAYS,
): AlertDecision | null {
  const { status, daysRemaining } = classifyValidity(notAfter, now, Math.max(...thresholdsDays));
  if (status === 'UNKNOWN' || daysRemaining === null) return null;
  if (status === 'EXPIRED') return { thresholdDays: 0, priority: 'CRITICAL' };
  const crossed = [...thresholdsDays].sort((a, b) => a - b).find((t) => daysRemaining <= t);
  if (crossed === undefined) return null;
  return { thresholdDays: crossed, priority: priorityForThreshold(crossed) };
}

export function priorityForThreshold(thresholdDays: number): AlertPriority {
  if (thresholdDays <= 7) return 'CRITICAL';
  if (thresholdDays <= 15) return 'HIGH';
  if (thresholdDays <= 30) return 'MEDIUM';
  return 'LOW';
}

/** Clave de deduplicación: una alerta por certificado, terminal y umbral (RF05). */
export function buildAlertDedupKey(
  certificateId: string,
  terminalId: string,
  thresholdDays: number,
): string {
  return `${certificateId}:${terminalId}:${thresholdDays}`;
}
