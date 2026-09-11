import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';

/**
 * The single rejection face of /auth/refresh. Expired, retired (reused),
 * unknown and malformed all produce exactly this 401 body; only the audit
 * record distinguishes the causes.
 */
export class InvalidRefreshTokenException extends HttpException {
  constructor() {
    super(
      {
        error: {
          code: 'refresh_token_invalid',
          message: 'The refresh token is not valid.',
          details: {},
        },
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * POST /auth/refresh
   *
   * The refresh token may arrive as `refreshToken` in the JSON body or as a
   * `refresh_token` cookie. When both are present the **body wins** (see
   * SECURITY.md). The successor token is returned in the body and also set as
   * an HttpOnly cookie so cookie-based clients keep working.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const bodyToken = (body as { refreshToken?: unknown } | null | undefined)?.refreshToken;
    const cookieToken = parseCookies(cookieHeader ?? '')['refresh_token'] ?? null;

    const outcome = await this.auth.refresh(bodyToken, cookieToken);
    if (!outcome.ok) {
      throw new InvalidRefreshTokenException();
    }

    res.cookie('refresh_token', outcome.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/auth/refresh',
    });

    return { accessToken: outcome.accessToken, refreshToken: outcome.refreshToken };
  }
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}
