import { classifyValidity } from './certificate-status';
import { buildAlertDedupKey, decideAlert } from './alert-rules';
import {
  AUDIT_GENESIS_HASH,
  ChainedAuditEvent,
  AuditEventPayload,
  computeAuditHash,
  verifyAuditChain,
} from './audit-chain';

const NOW = new Date('2026-06-01T00:00:00Z');
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

describe('classifyValidity (RF04)', () => {
  it('clasifica como vigente cuando faltan más de 60 días', () => {
    expect(classifyValidity(inDays(120), NOW)).toEqual({ status: 'VALID', daysRemaining: 120 });
  });
  it('clasifica como próximo a vencer dentro del umbral', () => {
    expect(classifyValidity(inDays(45), NOW).status).toBe('EXPIRING_SOON');
  });
  it('clasifica como vencido y reporta días negativos', () => {
    const r = classifyValidity(inDays(-3), NOW);
    expect(r.status).toBe('EXPIRED');
    expect(r.daysRemaining).toBeLessThan(0);
  });
  it('clasifica como desconocido sin fecha', () => {
    expect(classifyValidity(null, NOW)).toEqual({ status: 'UNKNOWN', daysRemaining: null });
  });
  it('respeta un umbral configurable', () => {
    expect(classifyValidity(inDays(45), NOW, 30).status).toBe('VALID');
  });
});

describe('decideAlert (RF05)', () => {
  it.each([
    [70, null],
    [60, { thresholdDays: 60, priority: 'LOW' }],
    [45, { thresholdDays: 60, priority: 'LOW' }],
    [20, { thresholdDays: 30, priority: 'MEDIUM' }],
    [10, { thresholdDays: 15, priority: 'HIGH' }],
    [3, { thresholdDays: 7, priority: 'CRITICAL' }],
    [-1, { thresholdDays: 0, priority: 'CRITICAL' }],
  ])('con %i días restantes', (days, expected) => {
    expect(decideAlert(inDays(days), NOW)).toEqual(expected);
  });
  it('no genera alerta si se desconoce la vigencia', () => {
    expect(decideAlert(null, NOW)).toBeNull();
  });
  it('construye una clave de deduplicación estable', () => {
    expect(buildAlertDedupKey('c1', 't1', 30)).toBe('c1:t1:30');
  });
});

function buildChain(n: number): ChainedAuditEvent[] {
  const chain: ChainedAuditEvent[] = [];
  let prev = AUDIT_GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const payload: AuditEventPayload = {
      sequence: i,
      occurredAt: new Date(NOW.getTime() + i * 1000),
      actorId: 'u1',
      action: 'inventory.run',
      resourceType: 'Terminal',
      resourceId: `t${i}`,
      previousState: null,
      newState: { ok: true },
      result: 'SUCCESS',
      reason: null,
      correlationId: `c${i}`,
      approvalId: null,
    };
    const hash = computeAuditHash(prev, payload);
    chain.push({ ...payload, previousHash: prev, hash });
    prev = hash;
  }
  return chain;
}

describe('cadena de auditoría (RF10)', () => {
  it('valida una cadena íntegra', () => {
    expect(verifyAuditChain(buildChain(5))).toEqual({ valid: true, checked: 5 });
  });
  it('detecta la alteración de un evento intermedio', () => {
    const chain = buildChain(5);
    chain[2] = { ...chain[2], result: 'FAILURE' };
    const r = verifyAuditChain(chain);
    expect(r.valid).toBe(false);
    expect(r.brokenAtSequence).toBe(3);
  });
  it('detecta la eliminación de un evento intermedio', () => {
    const chain = buildChain(5);
    chain.splice(2, 1);
    expect(verifyAuditChain(chain).valid).toBe(false);
  });
});
