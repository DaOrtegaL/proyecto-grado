import { randomUUID } from 'node:crypto';
import type {
  CertificateIssuerAdapter,
  CertificateValidationAdapter,
  IssuanceRequest,
  IssuanceResult,
  ValidationOutcome,
  CertificateMetadata,
} from '@msh/domain';
import { createRng, createSyntheticCa, createSyntheticLeaf, randomSerialHex } from './x509-factory';
import { describeCertificate } from './x509-metadata';

/**
 * Emisor simulado: crea una CA efímera con el mismo DN del emisor solicitado y firma un certificado de
 * cliente sintético. No valida la cadena contra la CA real (que no se controla desde este módulo).
 */
export class SimulatedCertificateIssuer implements CertificateIssuerAdapter {
  readonly name = 'SimulatedCertificateIssuer';

  async issue(request: IssuanceRequest): Promise<IssuanceResult> {
    const requestId = randomUUID();
    const rng = createRng(Number.parseInt(requestId.slice(0, 8), 16));
    const cn = /CN=([^,]+)/.exec(request.issuerDn)?.[1]?.trim() ?? 'Emisor sintético';
    const org = /O=([^,]+)/.exec(request.issuerDn)?.[1]?.trim() ?? 'MSH Laboratorio';
    const ca = await createSyntheticCa(cn, org, request.now, rng);
    const pem = await createSyntheticLeaf({
      commonName: request.subjectCommonName,
      now: request.now,
      daysUntilExpiry: request.validityDays,
      validityDays: request.validityDays,
      keyKind: request.keyKind,
      ca,
      serialHex: randomSerialHex(rng),
    });
    const meta = await describeCertificate(pem, { storeLocation: 'LocalMachine', storeName: 'My', hasPrivateKey: true });
    return {
      certificatePem: pem,
      evidence: {
        issuerAdapter: this.name,
        requestId,
        issuedAtUtc: request.now.toISOString(),
        serialNumber: meta.serialNumber,
        thumbprintSha256: meta.thumbprintSha256,
        issuerDn: meta.issuer,
        note: 'Emisión simulada para laboratorio; no corresponde a una autoridad de certificación real.',
      },
    };
  }
}

/** Validación básica de política: vigencia, uso extendido y algoritmo. */
export class BasicCertificateValidator implements CertificateValidationAdapter {
  readonly name = 'BasicCertificateValidator';

  validate(metadata: CertificateMetadata, now: Date): ValidationOutcome {
    const reasons: string[] = [];
    if (new Date(metadata.notAfter) <= now) reasons.push('El certificado está vencido.');
    if (new Date(metadata.notBefore) > now) reasons.push('El certificado aún no es válido.');
    if (!metadata.extendedKeyUsage.includes('clientAuth')) reasons.push('No declara el uso extendido clientAuth.');
    if (metadata.publicKeyAlgorithm === 'RSA' && (metadata.keySizeBits ?? 0) < 2048) reasons.push('Clave RSA menor a 2048 bits.');
    if (/SHA1$/.test(metadata.signatureAlgorithm)) reasons.push('Firma con SHA-1.');
    return { valid: reasons.length === 0, reasons };
  }
}
