import { createHash } from 'node:crypto';

/** Hash génesis de la cadena de auditoría. */
export const AUDIT_GENESIS_HASH = '0'.repeat(64);

export type AuditResult = 'SUCCESS' | 'FAILURE' | 'DENIED';

/** Campos obligatorios del evento (RF10); forman parte del hash encadenado. */
export interface AuditEventPayload {
  sequence: number;
  occurredAt: Date;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  previousState: unknown;
  newState: unknown;
  result: AuditResult;
  reason: string | null;
  correlationId: string;
  approvalId: string | null;
}

export interface ChainedAuditEvent extends AuditEventPayload {
  previousHash: string;
  hash: string;
}

/** Serialización canónica: claves ordenadas y fechas en ISO-8601 UTC, para hashes deterministas. */
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (Object.prototype.toString.call(value) === '[object Date]') return JSON.stringify((value as Date).toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeAuditHash(previousHash: string, payload: AuditEventPayload): string {
  return createHash('sha256').update(`${previousHash}|${canonicalJson(payload)}`).digest('hex');
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  /** Secuencia del primer evento inconsistente, si existe. */
  brokenAtSequence?: number;
  reason?: string;
}

/**
 * Verifica una cadena ordenada por secuencia.
 * Limitación: detecta alteraciones internas, pero no el truncamiento de los eventos más recientes
 * ni la reescritura completa de la cadena por quien controle la base de datos.
 */
export function verifyAuditChain(events: ChainedAuditEvent[]): ChainVerification {
  let previous = AUDIT_GENESIS_HASH;
  for (const event of events) {
    if (event.previousHash !== previous) {
      return {
        valid: false,
        checked: events.indexOf(event),
        brokenAtSequence: event.sequence,
        reason: 'PREVIOUS_HASH_MISMATCH',
      };
    }
    const { previousHash: _p, hash: _h, ...payload } = event;
    if (computeAuditHash(previous, payload) !== event.hash) {
      return {
        valid: false,
        checked: events.indexOf(event),
        brokenAtSequence: event.sequence,
        reason: 'HASH_MISMATCH',
      };
    }
    previous = event.hash;
  }
  return { valid: true, checked: events.length };
}
