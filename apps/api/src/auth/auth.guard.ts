import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../common/decorators';
import type { AppRequest } from '../common/request-context';
import { TokenService } from './token.service';
import { AuditService } from '../audit/audit.service';
import type { Permission } from '@msh/domain';

/** Guardia global: autentica con JWT y aplica permisos granulares en el servidor (RNF02, RNF03). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Debe iniciar sesión para continuar.' });
    }

    try {
      req.user = await this.tokens.verifyAccess(token);
    } catch {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_INVALID',
        message: 'La sesión no es válida o expiró.',
      });
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets) ?? [];
    if (!required.every((p) => req.user!.permissions.includes(p))) {
      await this.audit.recordSafely({
        actorId: req.user.id,
        action: 'access.denied',
        resourceType: 'Endpoint',
        resourceId: `${req.method} ${req.path}`.slice(0, 100),
        result: 'DENIED',
        reason: `Permisos requeridos: ${required.join(', ')}`,
        correlationId: req.correlationId,
      });
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'No tiene permisos para realizar esta operación.',
      });
    }
    return true;
  }
}
