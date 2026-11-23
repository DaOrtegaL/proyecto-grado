import { Injectable } from '@nestjs/common';
import type { Permission } from '@msh/domain';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './request-context';

export const SYSTEM_EMAIL = 'sistema@msh.lab';

/** Construye la identidad (roles y permisos) de un usuario del sistema; la usan el planificador, el gateway de agentes y el simulador. */
@Injectable()
export class ActorsService {
  constructor(private readonly prisma: PrismaService) {}

  async byEmail(email: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });
    if (!user) throw new Error(`Usuario de sistema no encontrado: ${email}`);
    const permissions = new Set<string>();
    user.roles.forEach((ur) => ur.role.permissions.forEach((rp) => permissions.add(rp.permission.code)));
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles.map((ur) => ur.role.code),
      permissions: [...permissions] as Permission[],
    };
  }

  system(): Promise<AuthUser> {
    return this.byEmail(SYSTEM_EMAIL);
  }
}
