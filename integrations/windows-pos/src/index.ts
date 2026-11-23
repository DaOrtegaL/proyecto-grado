import {
  AdapterDisabledError,
  InventoryReport,
  TerminalInventoryPort,
  TerminalRef,
} from '@msh/domain';

export interface WindowsCertificateStoreConfig {
  /** Debe habilitarse de forma explícita tras validar autorización, terminales permitidas y scripts firmados. */
  enabled: boolean;
}

/**
 * Adaptador hacia terminales Windows reales. Permanece deshabilitado por defecto (RF08, modo laboratorio):
 * la ejecución remota requiere un mecanismo aprobado que aún no está configurado, por lo que no se
 * ejecuta código ni se accede a equipos reales desde esta clase.
 */
export class WindowsCertificateStoreAdapter implements TerminalInventoryPort {
  readonly name = 'WindowsCertificateStoreAdapter';

  constructor(private readonly config: WindowsCertificateStoreConfig = { enabled: false }) {}

  async collect(_terminal: TerminalRef): Promise<InventoryReport> {
    if (!this.config.enabled) throw new AdapterDisabledError(this.name);
    throw new AdapterDisabledError(`${this.name} (mecanismo de ejecución remota pendiente de autorización)`);
  }
}
