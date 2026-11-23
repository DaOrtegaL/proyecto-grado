import type { MshIntegrationAdapter } from '@msh/domain';

export interface LocalStoreSource {
  listStores(): Promise<{ code: string; name: string; countryCode: string }[]>;
}

/**
 * Implementación simulada del contrato propuesto con MSH. No realiza llamadas de red: MSH no ha confirmado
 * endpoints ni autenticación, por lo que el adaptador real no existe y no debe inventarse.
 */
export class SimulatedMshAdapter implements MshIntegrationAdapter {
  readonly name = 'SimulatedMshAdapter';
  readonly published: { storeCode: string; expiring: number; expired: number }[] = [];

  constructor(private readonly source: LocalStoreSource) {}

  listStores() {
    return this.source.listStores();
  }

  async publishCertificateSummary(summary: { storeCode: string; expiring: number; expired: number }): Promise<void> {
    this.published.push(summary);
  }
}