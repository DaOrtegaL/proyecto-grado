import { createHash, createPublicKey, verify } from 'node:crypto';

/** Ventana de validez de la marca de tiempo de un agente (protección contra reenvío). */
export const AGENT_MAX_SKEW_MS = 5 * 60 * 1000;

export interface AgentSignedRequest {
  agentId: string;
  timestamp: string;
  nonce: string;
  signatureBase64: string;
  body: string;
}

/** Cadena firmada por el agente: `${timestamp}.${nonce}.${sha256(cuerpo)}`. */
export function buildAgentSigningInput(timestamp: string, nonce: string, body: string): Buffer {
  const digest = createHash('sha256').update(body).digest('hex');
  return Buffer.from(`${timestamp}.${nonce}.${digest}`, 'utf8');
}

/** Verifica una firma Ed25519 con la clave PÚBLICA registrada; la privada nunca sale de la terminal. */
export function verifyAgentSignature(publicKeyPem: string, req: AgentSignedRequest): boolean {
  try {
    return verify(
      null,
      buildAgentSigningInput(req.timestamp, req.nonce, req.body),
      createPublicKey(publicKeyPem),
      Buffer.from(req.signatureBase64, 'base64'),
    );
  } catch {
    return false;
  }
}

export function isTimestampFresh(timestamp: string, now: Date): boolean {
  const t = Date.parse(timestamp);
  return Number.isFinite(t) && Math.abs(now.getTime() - t) <= AGENT_MAX_SKEW_MS;
}
