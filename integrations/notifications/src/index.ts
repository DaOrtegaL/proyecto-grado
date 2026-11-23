import { randomUUID } from 'node:crypto';
import type { NotificationProviderAdapter, OutboundNotification } from '@msh/domain';

/** Canal interno: la notificación queda registrada en la plataforma; no hay envío externo (correo, mensajería). */
export class InAppNotificationProvider implements NotificationProviderAdapter {
  readonly name = 'InAppNotificationProvider';

  async send(_notification: OutboundNotification): Promise<{ delivered: boolean; reference: string }> {
    return { delivered: true, reference: randomUUID() };
  }
}