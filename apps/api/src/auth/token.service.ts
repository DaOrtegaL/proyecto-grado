import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { loadEnv } from '../config/env';
import type { AuthUser } from '../common/request-context';

interface AccessClaims {
  sub: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
}

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccess(user: AuthUser): Promise<string> {
    const env = loadEnv();
    const claims: AccessClaims = {
      sub: user.id,
      email: user.email,
      name: user.displayName,
      roles: user.roles,
      permissions: user.permissions,
    };
    return this.jwt.signAsync(claims, {
      secret: env.JWT_ACCESS_SECRET,
      expiresIn: env.JWT_ACCESS_TTL_SECONDS,
      algorithm: 'HS256',
    });
  }

  async verifyAccess(token: string): Promise<AuthUser> {
    const claims = await this.jwt.verifyAsync<AccessClaims>(token, {
      secret: loadEnv().JWT_ACCESS_SECRET,
      algorithms: ['HS256'],
    });
    return {
      id: claims.sub,
      email: claims.email,
      displayName: claims.name,
      roles: claims.roles,
      permissions: claims.permissions as AuthUser['permissions'],
    };
  }

  /** El token de refresco es opaco y aleatorio; en base de datos solo se guarda su hash. */
  generateRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(48).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
