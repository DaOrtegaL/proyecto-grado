import 'reflect-metadata';
import { webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

/** Generador pseudoaleatorio determinista (mulberry32) para escenarios reproducibles. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type KeyKind = 'EC_P256' | 'RSA_2048' | 'RSA_1024_SHA1';

export interface SyntheticCa {
  name: string;
  subjectDn: string;
  pem: string;
  /** Clave privada de la CA sintética: solo vive en memoria durante la generación. */
  signingKey: CryptoKey;
}

export interface LeafSpec {
  commonName: string;
  organization?: string;
  now: Date;
  /** Días hasta el vencimiento (negativo para certificados ya vencidos). */
  daysUntilExpiry: number;
  validityDays: number;
  keyKind: KeyKind;
  ca: SyntheticCa;
  serialHex: string;
}

const DAY = 86_400_000;

function algorithmFor(kind: KeyKind): { gen: any; sign: any } {
  if (kind === 'EC_P256') {
    return {
      gen: { name: 'ECDSA', namedCurve: 'P-256' },
      sign: { name: 'ECDSA', hash: 'SHA-256' },
    };
  }
  const hash = kind === 'RSA_1024_SHA1' ? 'SHA-1' : 'SHA-256';
  return {
    gen: {
      name: 'RSASSA-PKCS1-v1_5',
      hash,
      publicExponent: new Uint8Array([1, 0, 1]),
      modulusLength: kind === 'RSA_1024_SHA1' ? 1024 : 2048,
    },
    sign: { name: 'RSASSA-PKCS1-v1_5', hash },
  };
}

export function randomSerialHex(rng: () => number): string {
  // El primer byte < 0x80 mantiene el entero positivo en la codificación DER.
  let hex = Math.floor(rng() * 0x7f)
    .toString(16)
    .padStart(2, '0');
  for (let i = 0; i < 15; i++) hex += Math.floor(rng() * 256).toString(16).padStart(2, '0');
  return hex;
}

export async function createSyntheticCa(
  name: string,
  organization: string,
  now: Date,
  rng: () => number,
): Promise<SyntheticCa> {
  const alg = algorithmFor('EC_P256');
  const keys = (await webcrypto.subtle.generateKey(alg.gen, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const subjectDn = `CN=${name}, O=${organization}`;
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomSerialHex(rng),
    name: subjectDn,
    notBefore: new Date(now.getTime() - 365 * DAY),
    notAfter: new Date(now.getTime() + 3650 * DAY),
    signingAlgorithm: alg.sign,
    keys: keys as any,
    extensions: [
      new x509.BasicConstraintsExtension(true, 1, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
    ],
  });
  return { name, subjectDn, pem: cert.toString('pem'), signingKey: keys.privateKey };
}

/**
 * Emite un certificado X.509 de cliente sintético y devuelve únicamente su PEM público.
 * La clave privada de la hoja se descarta al terminar la función (RNF01).
 */
export async function createSyntheticLeaf(spec: LeafSpec): Promise<string> {
  const alg = algorithmFor(spec.keyKind);
  const keys = (await webcrypto.subtle.generateKey(alg.gen, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const notAfter = new Date(spec.now.getTime() + spec.daysUntilExpiry * DAY);
  const notBefore = new Date(notAfter.getTime() - spec.validityDays * DAY);
  const subject = `CN=${spec.commonName}, O=${spec.organization ?? 'MSH Laboratorio'}`;
  const extensions = [
    new x509.BasicConstraintsExtension(false, undefined, true),
    new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
    new x509.ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.2'], false),
  ];

  // Escenario de algoritmo débil: autofirmado con RSA 1024 y SHA-1 (emisor inesperado).
  if (spec.keyKind === 'RSA_1024_SHA1') {
    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: spec.serialHex,
      name: subject,
      notBefore,
      notAfter,
      signingAlgorithm: alg.sign,
      keys: keys as any,
      extensions,
    });
    return cert.toString('pem');
  }

  const caAlg = algorithmFor('EC_P256');
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: spec.serialHex,
    subject,
    issuer: spec.ca.subjectDn,
    notBefore,
    notAfter,
    signingKey: spec.ca.signingKey,
    publicKey: keys.publicKey as any,
    signingAlgorithm: caAlg.sign,
    extensions,
  });
  return cert.toString('pem');
}
