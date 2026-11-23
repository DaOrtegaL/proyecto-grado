import { randomUUID } from 'node:crypto';
import { NextFunction, Response } from 'express';
import type { AppRequest } from './request-context';

const VALID_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Asigna un identificador de correlación por solicitud (se acepta el del cliente solo si es seguro). */
export function correlationMiddleware(req: AppRequest, res: Response, next: NextFunction): void {
  const incoming = req.header('x-correlation-id');
  req.correlationId = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
}
