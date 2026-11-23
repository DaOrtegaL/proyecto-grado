import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@msh/domain';
import type { AppRequest } from './request-context';

export const PERMISSIONS_KEY = 'required_permissions';
export const IS_PUBLIC_KEY = 'is_public';

/** Exige todos los permisos indicados (RNF02). La validación ocurre siempre en el servidor. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AppRequest>().user;
});

export const CorrelationId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AppRequest>().correlationId;
});
