import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { AuthService } from './auth.service.js';

interface HttpReq {
  headers: Record<string, string | string[] | undefined>;
}

interface HttpRes {
  status(code: number): HttpRes;
  json(body: unknown): HttpRes;
  cookie(name: string, value: string, options?: Record<string, unknown>): HttpRes;
}

/**
 * POST /auth/refresh
 *
 * The presented refresh token may arrive as `refreshToken` in the JSON body
 * or in the `refresh_token` cookie. **When both are present, the body wins**;
 * the cookie is only consulted when the body carries no token. The body is
 * explicit client intent, while the cookie is the ambient, server-managed
 * channel, so explicit intent takes precedence.
 *
 * 200 — `{ accessToken, refreshToken }`; the presented token is retired by
 * the same call. When the request arrived via the cookie, the new token is
 * also echoed in an HttpOnly `refresh_token` cookie.
 *
 * 401 — a single envelope for malformed, unknown, expired and retired
 * tokens alike; the audit log, not the response, distinguishes them.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: unknown,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ): Promise<{ accessToken: string; refreshToken: string } | void> {
    const { token, viaCookie } = this.presentedToken(body, req);

    const outcome = await this.authService.refresh(token, viaCookie);
    if (!outcome.ok) {
      res.status(401).json(REFRESH_REJECTION);
      return;
    }

    if (outcome.viaCookie) {
      res.cookie('refresh_token', outcome.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: Math.max(1000, outcome.sessionExpiresAt.getTime() - Date.now()),
      });
    }

    return { accessToken: outcome.accessToken, refreshToken: outcome.refreshToken };
  }

  private presentedToken(
    body: unknown,
    req: HttpReq,
  ): { token: string; viaCookie: boolean } {
    const bodyField =
      body !== null && typeof body === 'object' && 'refreshToken' in body
        ? (body as Record<string, unknown>).refreshToken
        : undefined;

    if (bodyField !== undefined && bodyField !== null) {
      return {
        token: typeof bodyField === 'string' ? bodyField : String(bodyField),
        viaCookie: false,
      };
    }

    const cookieToken = this.cookieValue(req.headers.cookie, 'refresh_token');
    if (cookieToken !== undefined && cookieToken !== '') {
      return { token: cookieToken, viaCookie: true };
    }

    return { token: '', viaCookie: false };
  }

  private cookieValue(
    header: string | string[] | undefined,
    name: string,
  ): string | undefined {
    if (typeof header !== 'string') return undefined;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() !== name) continue;
      const raw = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
    return undefined;
  }
}

/** The single rejection body — identical for every rejection, on purpose. */
const REFRESH_REJECTION = {
  error: {
    code: 'invalid_refresh_token',
    message: 'The refresh token is invalid.',
    details: {},
  },
};
