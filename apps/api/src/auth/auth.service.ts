import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import type { Permission } from '@msh/domain';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from './token.service';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { loadEnv } from '../config/env';
import type { AuthUser } from '../common/request-context';

/** Hash ficticio para igualar el tiempo de respuesta cuando el usuario no existe. */
const DUMMY_HASH = bcrypt.hashSync('contraseña-inexistente', 12);

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser & { locale: string; timezone: string };
}

const invalidCredentials = () =>
  new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS', message: 'Correo o contraseña incorrectos.' });
const invalidSession = () =>
  new UnauthorizedException({ code: 'AUTH_SESSION_INVALID', message: 'La sesión expiró. Inicie sesión nuevamente.' });

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async login(email: string, password: string, correlationId: string): Promise<SessionTokens> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });
    const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !user.isActive || !passwordOk) {
      await this.audit.recordSafely({
        actorId: user?.id ?? null,
        action: 'auth.login',
        resourceType: 'User',
        resourceId: user?.id ?? null,
        result: 'FAILURE',
        reason: 'Credenciales inválidas o usuario inactivo',
        newState: { email: email.toLowerCase() },
        correlationId,
      });
      throw invalidCredentials();
    }

    const authUser = this.toAuthUser(user);
    const session = await this.issueSession(authUser, user.locale, user.timezone, randomUUID());
    await this.audit.recordSafely({
      actorId: user.id,
      action: 'auth.login',
      resourceType: 'User',
      resourceId: user.id,
      result: 'SUCCESS',
      correlationId,
    });
    return session;
  }

  /** Rota el token de refresco; si se reutiliza uno ya revocado se revoca toda la familia (posible robo). */
  async refresh(refreshToken: string | undefined, correlationId: string): Promise<SessionTokens> {
    if (!refreshToken) throw invalidSession();
    const hash = this.tokens.hashRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!stored) throw invalidSession();

    const now = this.clock.now();
    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit.recordSafely({
        actorId: stored.userId,
        action: 'auth.refresh_reuse_detected',
        resourceType: 'User',
        resourceId: stored.userId,
        result: 'DENIED',
        reason: 'Reutilización de un token de refresco revocado',
        correlationId,
      });
      throw invalidSession();
    }
    if (stored.expiresAt <= now) throw invalidSession();

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });
    if (!user || !user.isActive) throw invalidSession();

    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: now } });
    return this.issueSession(this.toAuthUser(user), user.locale, user.timezone, stored.familyId);
  }

  async logout(refreshToken: string | undefined, actor: AuthUser | undefined, correlationId: string): Promise<void> {
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: this.tokens.hashRefreshToken(refreshToken), revokedAt: null },
        data: { revokedAt: this.clock.now() },
      });
    }
    await this.audit.recordSafely({
      actorId: actor?.id ?? null,
      action: 'auth.logout',
      resourceType: 'User',
      resourceId: actor?.id ?? null,
      result: 'SUCCESS',
      correlationId,
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { locale: user.locale, timezone: user.timezone };
  }

  private toAuthUser(user: {
    id: string;
    email: string;
    displayName: string;
    roles: { role: { code: string; permissions: { permission: { code: string } }[] } }[];
  }): AuthUser {
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

  private async issueSession(
    user: AuthUser,
    locale: string,
    timezone: string,
    familyId: string,
  ): Promise<SessionTokens> {
    const env = loadEnv();
    const { token, hash } = this.tokens.generateRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        familyId,
        expiresAt: new Date(this.clock.now().getTime() + env.JWT_REFRESH_TTL_SECONDS * 1000),
      },
    });
    return {
      accessToken: await this.tokens.signAccess(user),
      refreshToken: token,
      expiresIn: env.JWT_ACCESS_TTL_SECONDS,
      user: { ...user, locale, timezone },
    };
  }
}
