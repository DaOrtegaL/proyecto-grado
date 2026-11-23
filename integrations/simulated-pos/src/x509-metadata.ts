import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import type { CertificateMetadata } from '@msh/domain';

const KEY_USAGE_NAMES: [number, string][] = [
  [x509.KeyUsageFlags.digitalSignature, 'digitalSignature'],
  [x509.KeyUsageFlags.nonRepudiation, 'nonRepudiation'],
  [x509.KeyUsageFlags.keyEncipherment, 'keyEncipherment'],
  [x509.KeyUsageFlags.dataEncipherment, 'dataEncipherment'],
  [x509.KeyUsageFlags.keyAgreement, 'keyAgreement'],
  [x509.KeyUsageFlags.keyCertSign, 'keyCertSign'],
  [x509.KeyUsageFlags.cRLSign, 'cRLSign'],
];

const EKU_NAMES: Record<string, string> = {
  '1.3.6.1.5.5.7.3.1': 'serverAuth',
  '1.3.6.1.5.5.7.3.2': 'clientAuth',
  '1.3.6.1.5.5.7.3.3': 'codeSigning',
  '1.3.6.1.5.5.7.3.4': 'emailProtection',
};

function toHex(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString('hex').toUpperCase();
}

/** Extrae únicamente metadatos públicos de un certificado X.509 en formato PEM. */
export async function describeCertificate(
  pem: string,
  location: { storeLocation: string; storeName: string; hasPrivateKey: boolean },
): Promise<CertificateMetadata> {
  const cert = new x509.X509Certificate(pem);
  const keyAlg = cert.publicKey.algorithm as unknown as {
    name: string;
    modulusLength?: number;
    namedCurve?: string;
  };
  const isRsa = keyAlg.name.toUpperCase().startsWith('RSA');
  const keySizeBits = isRsa
    ? (keyAlg.modulusLength ?? null)
    : keyAlg.namedCurve
      ? Number(keyAlg.namedCurve.replace(/\D/g, '')) || null
      : null;
  const sigAlg = cert.signatureAlgorithm as unknown as { name: string; hash?: { name: string } };
  const keyUsageExt = cert.getExtension(x509.KeyUsagesExtension);
  const ekuExt = cert.getExtension(x509.ExtendedKeyUsageExtension);

  return {
    thumbprintSha256: toHex(await cert.getThumbprint('SHA-256')),
    subject: cert.subject,
    issuer: cert.issuer,
    serialNumber: cert.serialNumber.toUpperCase(),
    notBefore: cert.notBefore.toISOString(),
    notAfter: cert.notAfter.toISOString(),
    publicKeyAlgorithm: isRsa ? 'RSA' : keyAlg.name,
    keySizeBits,
    signatureAlgorithm: `${sigAlg.name}-${(sigAlg.hash?.name ?? '').replace('-', '')}`,
    keyUsage: keyUsageExt
      ? KEY_USAGE_NAMES.filter(([flag]) => (keyUsageExt.usages & flag) !== 0).map(([, n]) => n)
      : [],
    extendedKeyUsage: ekuExt ? ekuExt.usages.map((oid) => EKU_NAMES[oid as string] ?? String(oid)) : [],
    storeLocation: location.storeLocation,
    storeName: location.storeName,
    hasPrivateKey: location.hasPrivateKey,
  };
}
