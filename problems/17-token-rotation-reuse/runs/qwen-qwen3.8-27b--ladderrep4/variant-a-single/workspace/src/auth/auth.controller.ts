import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { AuthService, type RefreshResult } from './auth.service.js';

/**
 * POST /auth/refresh
 *
 * Token source and precedence: the refresh token may arrive as the JSON body
 * field `refreshToken` or as the `refresh_token` cookie. When both are
 * present, **the body wins** — the cookie is consulted only when the body
 * carries no usable value (key absent, not a string, or empty). A request
 * that presents both gets exactly one presentation: the body token.
 *
 * The success response updates the `refresh_token` cookie so that
 * cookie-based clients do not keep presenting the just-retired token.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: { refreshToken?: unknown } | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResult> {
    const result = await this.authService.refresh(extractRefreshToken(body, req));
    res.cookie('refresh_token', result.refreshToken, { httpOnly: true, sameSite: 'strict', path: '/' });
    return result;
  }
}

/** Body token wins over the `refresh_token` cookie (see controller JSDoc). */
function extractRefreshToken(
  body: { refreshToken?: unknown } | undefined,
  req: Request,
): string | undefined {
  const fromBody = body && typeof body.refreshToken === 'string' ? body.refreshToken : undefined;
  if (fromBody && fromBody.length > 0) {
    return fromBody;
  }
  return cookieValue(req, 'refresh_token');
}

function cookieValue(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (typeof header !== 'string') {
    return undefined;
  }
  for (const part of header.split(';')) {
    const equals = part.indexOf('=');
    if (equals === -1) {
      continue;
    }
    const key = part.slice(0, equals).trim();
    if (key !== name) {
      continue;
    }
    const raw = part.slice(equals + 1).trim();
    try {
      const value = decodeURIComponent(raw);
      return value.length > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
