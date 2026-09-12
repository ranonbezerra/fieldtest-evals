import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';

/**
 * Every rejection — malformed, unknown, expired, retired — produces this exact
 * 401 body. Nothing in the response may hint at which check failed; the
 * distinction is recorded in `auth_audit_events` by the service.
 */
const REJECTED_RESPONSE = {
  error: {
    code: 'refresh_rejected',
    message: 'The presented refresh token was not accepted; the session was not rotated.',
    details: {},
  },
} as const;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/refresh
   *
   * The refresh token is taken from the `refreshToken` field of the JSON body.
   * When that field is absent or not a string, the `refresh_token` cookie is
   * used instead.
   *
   * Precedence when both are present: **the body field wins**. It is the
   * explicit credential for this request; the cookie is a convenience for
   * clients that cannot send a JSON body and must never override an explicit
   * value. Every success re-issues the cookie so it never drifts from the
   * session's current token.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
    const rawToken = extractRefreshToken(body, req);
    const outcome = await this.authService.refresh(rawToken);

    if (!outcome.ok) {
      throw new HttpException(REJECTED_RESPONSE, HttpStatus.UNAUTHORIZED);
    }

    res.cookie('refresh_token', outcome.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: true,
      path: '/auth',
      maxAge: Math.max(0, outcome.expiresAt.getTime() - Date.now()),
    });

    return {
      accessToken: outcome.accessToken,
      refreshToken: outcome.refreshToken,
      expiresAt: outcome.expiresAt.toISOString(),
    };
  }
}

function extractRefreshToken(body: unknown, req: Request): string | undefined {
  // The body field wins over the cookie when both are present.
  if (isRecord(body) && typeof body.refreshToken === 'string') {
    return body.refreshToken;
  }
  return readCookie(req.headers.cookie, 'refresh_token');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCookie(header: string | string[] | undefined, name: string): string | undefined {
  if (typeof header !== 'string') {
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
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}
