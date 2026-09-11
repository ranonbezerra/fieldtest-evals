import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService, RefreshOutcome } from './auth.service.js';

/**
 * POST /auth/refresh
 *
 * The refresh token arrives either as the JSON body field `refreshToken` or as
 * the `refresh_token` cookie. When both are present, the JSON body wins: the
 * body is the explicit API channel, the cookie is a convenience for browser
 * clients. A present `refreshToken` key whose value is not a usable string
 * still wins and is rejected as malformed, rather than silently falling back
 * to the cookie.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('refresh')
  async refresh(
    @Body() body: { refreshToken?: unknown },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshOutcome> {
    const token = this.pickToken(body, req.headers.cookie);
    const outcome = await this.auth.refresh(token);

    const maxAge = Math.max(0, Math.floor((outcome.expiresAt.getTime() - Date.now()) / 1000));
    res.setHeader(
      'Set-Cookie',
      `refresh_token=${outcome.refreshToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`,
    );
    return outcome;
  }

  private pickToken(
    body: { refreshToken?: unknown } | undefined,
    cookieHeader: string | string[] | undefined,
  ): unknown {
    if (body && typeof body === 'object' && 'refreshToken' in body && body.refreshToken !== undefined) {
      return body.refreshToken;
    }
    return parseCookies(cookieHeader).refresh_token;
  }
}

function parseCookies(header: string | string[] | undefined): Record<string, string> {
  if (typeof header !== 'string' || header.length === 0) {
    return {};
  }
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) {
      continue;
    }
    const name = part.slice(0, idx).trim();
    if (name) {
      cookies[name] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return cookies;
}
