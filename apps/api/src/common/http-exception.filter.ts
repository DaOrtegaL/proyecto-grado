import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { AppRequest } from './request-context';

/** Mensajes en español por código HTTP cuando no se define un código de error propio. */
const DEFAULT_MESSAGES: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: 'La solicitud no es válida.' },
  401: { code: 'AUTH_REQUIRED', message: 'Debe iniciar sesión para continuar.' },
  403: { code: 'FORBIDDEN', message: 'No tiene permisos para realizar esta operación.' },
  404: { code: 'NOT_FOUND', message: 'El recurso solicitado no existe.' },
  409: { code: 'CONFLICT', message: 'La operación entra en conflicto con el estado actual.' },
  429: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Intente nuevamente más tarde.' },
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Excepciones');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<AppRequest>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const fallback = DEFAULT_MESSAGES[status] ?? { code: 'ERROR', message: 'Ocurrió un error.' };
      const custom = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
      res.status(status).json({
        code: typeof custom.code === 'string' ? custom.code : fallback.code,
        message: typeof custom.code === 'string' && typeof custom.message === 'string' ? custom.message : fallback.message,
        details: custom.details,
        correlationId: req.correlationId,
      });
      return;
    }

    // Los errores no controlados se registran con detalle, pero nunca se exponen al cliente.
    this.logger.error(
      JSON.stringify({
        correlationId: req.correlationId,
        error: exception instanceof Error ? exception.message : String(exception),
      }),
    );
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Ocurrió un error interno. Contacte al administrador indicando el identificador de correlación.',
      correlationId: req.correlationId,
    });
  }
}
