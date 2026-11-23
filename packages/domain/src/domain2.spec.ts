import { generateKeyPairSync, sign } from 'node:crypto';
import { allowedTransitions, canTransition, computeApprovalHash } from './renewal';
import { evaluateTerminalAnomalies, InstallationView } from './anomalies';
import { compareValues, mean, percentage, susScore } from './metrics';
import { buildAgentSigningInput, isTimestampFresh, verifyAgentSignature } from './agent';
import { ROLE_PERMISSIONS } from './rbac';

const NOW = new Date('2026-06-01T00:00:00Z');
const days = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

describe('máquina de estados de renovación (RF06)', () => {
  it('permite el flujo principal', () => {
    const flow = ['REQUESTED', 'PENDING_ISSUANCE', 'ISSUED', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'INSTALLING', 'INSTALLED', 'VERIFIED', 'COMPLETED'] as const;
    for (let i = 0; i < flow.length - 1; i++) expect(canTransition(flow[i], flow[i + 1])).toBe(true);
  });
  it.each([
    ['REQUESTED', 'ISSUED'],
    ['REQUESTED', 'APPROVED'],
    ['PENDING_ISSUANCE', 'APPROVED'],
    ['ISSUED', 'INSTALLED'],
    ['COMPLETED', 'REQUESTED'],
    ['REJECTED', 'APPROVED'],
  ] as const)('impide la transición inválida %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
  it('los estados finales no tienen salida', () => {
    expect(allowedTransitions('COMPLETED')).toEqual([]);
    expect(allowedTransitions('REJECTED')).toEqual([]);
  });
});

describe('huella de aprobación (RF07)', () => {
  const base = { certificateId: 'c', newCertificateThumbprint: 'T', terminalIds: ['b', 'a'], operation: 'INSTALL_CERTIFICATE' as const, maintenanceWindowId: 'w', ownerId: 'o' };
  it('no depende del orden de las terminales', () => {
    expect(computeApprovalHash(base)).toBe(computeApprovalHash({ ...base, terminalIds: ['a', 'b'] }));
  });
  it.each([
    ['terminales', { terminalIds: ['a'] }],
    ['ventana', { maintenanceWindowId: 'otra' }],
    ['responsable', { ownerId: 'x' }],
    ['certificado nuevo', { newCertificateThumbprint: 'U' }],
  ])('cambia al modificar %s', (_n, change) => {
    expect(computeApprovalHash({ ...base, ...change })).not.toBe(computeApprovalHash(base));
  });
});

describe('anomalías (RF12)', () => {
  const inst = (over: Partial<InstallationView> = {}): InstallationView => ({
    certificateId: 'c1', thumbprintSha256: 'A', subject: 'CN=pos', notAfter: days(200), publicKeyAlgorithm: 'ECDSA',
    keySizeBits: 256, signatureAlgorithm: 'ECDSA-SHA256', extendedKeyUsage: ['clientAuth'], issuerKnown: true, hasOwner: true,
    storeName: 'My', hasPrivateKey: true, ...over,
  });
  const types = (list: InstallationView[], last: Date | null = NOW) => evaluateTerminalAnomalies(list, last, NOW).map((f) => f.type);

  it('una terminal sana no produce hallazgos', () => expect(types([inst()])).toEqual([]));
  it('detecta vencido, algoritmo débil, emisor desconocido y sin responsable', () => {
    const t = types([inst({ notAfter: days(-2), publicKeyAlgorithm: 'RSA', keySizeBits: 1024, signatureAlgorithm: 'RSASSA-PKCS1-v1_5-SHA1', issuerKnown: false, hasOwner: false })]);
    expect(t).toEqual(expect.arrayContaining(['EXPIRED', 'WEAK_ALGORITHM', 'UNKNOWN_ISSUER', 'NO_OWNER']));
  });
  it('detecta certificado faltante, inventario desactualizado y almacén inesperado', () => {
    expect(types([])).toEqual(expect.arrayContaining(['MISSING_CLIENT_CERTIFICATE']));
    expect(types([inst()], days(-30))).toContain('STALE_INVENTORY');
    expect(types([inst(), inst({ certificateId: 'c2', thumbprintSha256: 'B', storeName: 'TrustedPeople', hasPrivateKey: false })])).toContain('UNEXPECTED_CERTIFICATE');
  });
  it('detecta uso incompatible', () => expect(types([inst({ extendedKeyUsage: ['serverAuth'] })])).toContain('INCOMPATIBLE_USAGE'));
  it('un duplicado con uno vencido se trata como renovación en transición (severidad baja)', () => {
    const f = evaluateTerminalAnomalies([inst(), inst({ certificateId: 'c2', thumbprintSha256: 'B', notAfter: days(-1) })], NOW, NOW).find((x) => x.type === 'DUPLICATE_SUBJECT');
    expect(f?.severity).toBe('LOW');
  });
  it('un duplicado entre vigentes tiene severidad media', () => {
    const f = evaluateTerminalAnomalies([inst(), inst({ certificateId: 'c2', thumbprintSha256: 'B' })], NOW, NOW).find((x) => x.type === 'DUPLICATE_SUBJECT');
    expect(f?.severity).toBe('MEDIUM');
  });
});

describe('indicadores (sección 15)', () => {
  it('calcula porcentajes y promedios', () => {
    expect(percentage(19, 20)).toBe(95);
    expect(percentage(1, 0)).toBeNull();
    expect(mean([10, 20])).toBe(15);
    expect(mean([])).toBeNull();
  });
  it('puntúa el SUS según el procedimiento oficial', () => {
    expect(susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
    expect(susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5])).toBe(0);
    expect(susScore([3, 3, 3, 3, 3, 3, 3, 3, 3, 3])).toBe(50);
    expect(() => susScore([1, 2])).toThrow();
    expect(() => susScore([6, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toThrow();
  });
  it('compara línea base y piloto con variación absoluta y relativa', () => {
    const c = compareValues('X', { value: 50, sampleSize: 10 }, { value: 75, sampleSize: 12 });
    expect(c).toMatchObject({ absoluteChange: 25, relativeChange: 50, baselineSample: 10, pilotSample: 12 });
    expect(compareValues('X', { value: null, sampleSize: 0 }, { value: 1, sampleSize: 1 }).absoluteChange).toBeNull();
  });
});

describe('identidad de agente (Ed25519)', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const body = '{"a":1}';
  const signature = sign(null, buildAgentSigningInput('2026-06-01T00:00:00.000Z', 'n1', body), privateKey).toString('base64');
  const req = { agentId: 'a', timestamp: '2026-06-01T00:00:00.000Z', nonce: 'n1', signatureBase64: signature, body };

  it('acepta una firma válida y rechaza cuerpo, nonce o clave alterados', () => {
    expect(verifyAgentSignature(pem, req)).toBe(true);
    expect(verifyAgentSignature(pem, { ...req, body: '{"a":2}' })).toBe(false);
    expect(verifyAgentSignature(pem, { ...req, nonce: 'n2' })).toBe(false);
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(verifyAgentSignature(other, req)).toBe(false);
  });
  it('rechaza marcas de tiempo fuera de la ventana', () => {
    expect(isTimestampFresh('2026-06-01T00:00:00.000Z', new Date('2026-06-01T00:04:00Z'))).toBe(true);
    expect(isTimestampFresh('2026-06-01T00:00:00.000Z', new Date('2026-06-01T00:10:00Z'))).toBe(false);
    expect(isTimestampFresh('no-es-fecha', NOW)).toBe(false);
  });
});

describe('separación de funciones en los roles (RNF02)', () => {
  it('quien ejecuta no aprueba y quien solo consulta no opera', () => {
    expect(ROLE_PERMISSIONS.STORE_SUPPORT).not.toContain('approvals:decide');
    expect(ROLE_PERMISSIONS.RETAIL_IT).not.toContain('approvals:decide');
    expect(ROLE_PERMISSIONS.ISSUER_OWNER).not.toContain('deployments:execute');
    expect(ROLE_PERMISSIONS.VIEWER).not.toContain('renewals:create');
    expect(ROLE_PERMISSIONS.AUDITOR).not.toContain('deployments:execute');
  });
});
