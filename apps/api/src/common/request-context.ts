import { Request } from 'express';
import type { Permission } from '@msh/domain';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: Permission[];
}

export interface AppRequest extends Request {
  user?: AuthUser;
  correlationId: string;
}
