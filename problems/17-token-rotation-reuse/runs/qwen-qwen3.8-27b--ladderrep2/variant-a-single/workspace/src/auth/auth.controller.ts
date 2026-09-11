import { Body, Controller, Headers, Inject, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import type { RefreshResult, TokenSource } from './auth.service.js';

const REFRESH_COOKIE = 'refresh_token';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly service: AuthService) {}

  /**
   * POST /auth/refresh — rotates the presented refresh token: retires it and
   * returns a new access token plus a new refresh token.
   *
   * Precedence: the token may arrive in the JSON body as `refreshToken` or in
   * the `refresh_token` cookie. **When both are present, the body wins**: the
   * body value is an explicit client choice, while the cookie may be a stale
   * leftover, and letting a cookie override the body would let a captured
   * old cookie win over the token the client meant to use.
   *
   * The response mirrors the channel used: cookie channel → the new token is
   * set on the cookie (HttpOnly, Secure, SameSite=Strict); body channel → a
   * stale `refresh_token` cookie, if present, is cleared so it cannot
   * outlive the body channel.
   *
   * Every rejection (malformed, unknown, expired, reused) returns the same
   * 401 envelope — see SECURITY.md for the check order and the audit side.
   */
  @Post('refresh')
  async refresh(
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const fromBody = isObjectWithKey(body, 'refreshToken') ? body.refreshToken : undefined;
    const fromCookie = this.parseCookie(cookieHeader, REFRESH_COOKIE);
    const presented = fromBody !== undefined ? fromBody : fromCookie;
    const source: TokenSource = fromBody !== undefined ? 'body' : fromCookie !== undefined ? 'cookie' : 'none';

    const result: RefreshResult = await this.service.refresh(presented, source);

    if (source === 'cookie') {
      res.cookie(REFRESH_COOKIE, result.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/auth',
        maxAge: Math.max(0, result.sessionExpiresAt.getTime() - Date.now()),
      });
    } else if (source === 'body' && fromCookie !== undefined) {
      res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
    }

    return { accessToken: result.accessToken, refreshToken: result.refreshToken };
  }

  private parseCookie(header: string | undefined, name: string): string | undefined {
    if (header === undefined || header === '') return undefined;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return undefined;
  }
}

function isObjectWithKey(value: unknown, key: string): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && key in value;
}
