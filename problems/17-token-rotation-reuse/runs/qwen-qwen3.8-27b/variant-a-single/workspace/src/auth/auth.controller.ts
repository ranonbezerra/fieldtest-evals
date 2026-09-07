import { Body, Controller, Headers, HttpCode, HttpException, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import type { RefreshSource } from './auth.service';

const REFRESH_COOKIE = 'refresh_token';

// Every rejection - malformed, unknown, expired, retired/reused - returns
// this one body, so the caller cannot tell which check failed.
const REJECTION_BODY = {
  error: {
    code: 'invalid_refresh_token',
    message: 'The presented refresh token could not be used to refresh the session.',
    details: {},
  },
} as const;

function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    if (part.slice(0, eq).trim() !== name) {
      continue;
    }
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Rotates the presented refresh token.
   *
   * The token may arrive as `refreshToken` in the JSON body or as the
   * `refresh_token` cookie. When both are present, the JSON body wins: it
   * is the explicit, caller-controlled channel, and letting the ambient
   * cookie override it would let a stale cookie silently rotate a token
   * the caller did not present.
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: { refreshToken?: unknown } | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const fromBody = typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
    const fromCookie = readCookie(cookieHeader, REFRESH_COOKIE);
    const source: RefreshSource = fromBody !== undefined ? 'body' : 'cookie';
    const presented = (fromBody ?? fromCookie) ?? null;

    const outcome = await this.authService.refresh(presented, source);
    if (outcome.status === 'rejected') {
      throw new HttpException({ error: REJECTION_BODY.error }, 401);
    }

    const remainingMs = Math.max(0, outcome.expiresAt.getTime() - Date.now());
    response.cookie(REFRESH_COOKIE, outcome.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: Math.ceil(remainingMs / 1000) * 1000,
    });

    return { accessToken: outcome.accessToken, refreshToken: outcome.refreshToken };
  }
}
