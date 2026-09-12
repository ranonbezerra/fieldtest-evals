import { Body, Controller, Headers, HttpCode, Inject, Post, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';

import { RefreshRejectedError, RefreshService } from './refresh.service.js';

const REFRESH_COOKIE = 'refresh_token';

function cookieOptions(): { httpOnly: boolean; sameSite: 'lax'; secure: boolean; path: string } {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
  };
}

function parseCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) {
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

/**
 * Token source and documented precedence.
 *
 * The refresh token may arrive as the JSON body field `refreshToken`, or as
 * the `refresh_token` cookie. When both are present, the **body value wins**:
 * the explicit request parameter is the client's deliberate choice for this
 * call, the cookie is the fallback for clients that store the token there. A
 * non-null body value is authoritative even when malformed, in which case the
 * call is rejected (only the audit log records why).
 */
function extractRefreshToken(body: { refreshToken?: unknown } | undefined, cookieHeader: string | undefined): unknown {
  if (body !== undefined && body.refreshToken !== undefined && body.refreshToken !== null) {
    return body.refreshToken;
  }
  return parseCookieValue(cookieHeader, REFRESH_COOKIE);
}

@Controller('auth')
export class RefreshController {
  constructor(@Inject(RefreshService) private readonly refreshService: RefreshService) {}

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: { refreshToken?: unknown },
    @Headers('cookie') cookieHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const presented = extractRefreshToken(body, cookieHeader);
    try {
      const { accessToken, refreshToken } = await this.refreshService.refresh(presented);
      res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
      return { accessToken, refreshToken };
    } catch (error) {
      if (error instanceof RefreshRejectedError) {
        // Uniform on every rejection, so the rejection is indistinguishable.
        res.cookie(REFRESH_COOKIE, '', { ...cookieOptions(), maxAge: 0 });
        throw new UnauthorizedException({
          error: {
            code: 'refresh_token_rejected',
            message: 'The presented refresh token could not be validated.',
            details: {},
          },
        });
      }
      throw error;
    }
  }
}
