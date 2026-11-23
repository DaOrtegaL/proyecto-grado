import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { loginSchema } from '@msh/validation';
import { AuthService, SessionTokens } from './auth.service';
import { CorrelationId, CurrentUser, Public } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AppRequest, AuthUser } from '../common/request-context';
import { loadEnv } from '../config/env';

const COOKIE_NAME = 'msh_rt';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: () => loadEnv().LOGIN_RATE_LIMIT_PER_MIN, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: ReturnType<typeof loginSchema.parse>,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.login(body.email, body.password, correlationId);
    return this.respond(session, res);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: AppRequest,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.refresh(req.cookies?.[COOKIE_NAME], correlationId);
    return this.respond(session, res);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: AppRequest,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(req.cookies?.[COOKIE_NAME], user, correlationId);
    res.clearCookie(COOKIE_NAME, this.cookieOptions());
  }

  @ApiBearerAuth()
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { ...user, ...(await this.auth.me(user.id)) };
  }

  private respond(session: SessionTokens, res: Response) {
    res.cookie(COOKIE_NAME, session.refreshToken, {
      ...this.cookieOptions(),
      maxAge: loadEnv().JWT_REFRESH_TTL_SECONDS * 1000,
    });
    return { accessToken: session.accessToken, expiresIn: session.expiresIn, user: session.user };
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: loadEnv().COOKIE_SECURE,
      sameSite: 'strict' as const,
      path: '/api/v1/auth',
    };
  }
}
