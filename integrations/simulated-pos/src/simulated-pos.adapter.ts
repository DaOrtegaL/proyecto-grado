import {
  INVENTORY_REPORT_SCHEMA_VERSION,
  InventoryReport,
  TerminalInventoryPort,
  TerminalRef,
  TerminalUnreachableError,
  CertificateMetadata,
} from '@msh/domain';
import { describeCertificate } from './x509-metadata';

export type FailureMode = 'NONE' | 'UNREACHABLE' | 'PARTIAL';

export interface SimulatedSlot {
  pem: string;
  storeLocation: string;
  storeName: string;
  hasPrivateKey: boolean;
}

export interface SimulatedTerminalState {
  failureMode: FailureMode;
  slots: SimulatedSlot[];
}

/** Origen del estado persistente de las terminales virtuales (implementado por la API sobre SQL Server). */
export interface SimulatedStateReader {
  read(terminalId: string): Promise<SimulatedTerminalState>;
}

/**
 * Adaptador de terminal POS simulada (RF08, modo simulación).
 * Produce un reporte con el mismo contrato que el agente PowerShell real.
 */
export class SimulatedPosAdapter implements TerminalInventoryPort {
  readonly name = 'SimulatedPosAdapter';

  constructor(
    private readonly state: SimulatedStateReader,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async collect(terminal: TerminalRef): Promise<InventoryReport> {
    const { failureMode, slots } = await this.state.read(terminal.id);
    if (failureMode === 'UNREACHABLE') throw new TerminalUnreachableError(terminal.hostname);

    const errors: InventoryReport['errors'] = [];
    const certificates: CertificateMetadata[] = [];
    for (const slot of slots) {
      if (failureMode === 'PARTIAL' && slot.storeName !== 'My') {
        const message = 'Acceso denegado al almacén de certificados';
        if (!errors.some((e) => e.store === slot.storeName)) {
          errors.push({ store: slot.storeName, message });
        }
        continue;
      }
      try {
        certificates.push(await describeCertificate(slot.pem, slot));
      } catch {
        errors.push({ store: slot.storeName, message: 'Certificado ilegible en el almacén' });
      }
    }

    return {
      schemaVersion: INVENTORY_REPORT_SCHEMA_VERSION,
      source: 'SIMULATED',
      hostname: terminal.hostname,
      collectedAt: this.clock().toISOString(),
      certificates,
      errors,
    };
  }
}
