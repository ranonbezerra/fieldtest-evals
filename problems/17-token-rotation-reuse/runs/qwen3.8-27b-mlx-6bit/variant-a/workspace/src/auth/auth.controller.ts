import { Controller, Post, Body, Headers, HttpException } from '@nestjs/common';
import { AuthService, RefreshResult, InvalidRefreshTokenError } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  /**
   * POST /auth/refresh
   *
   * Accepts a refresh token either as the JSON body field `refreshToken` or
   * as the `refresh_token` cookie. When both are present, the body value wins;
   * the cookie is a fallback for browser clients that cannot set a header.
   */
  @Post('refresh')
  async refresh(
    @Body('refreshToken') bodyToken: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
  ): Promise<RefreshResult> {
    const rawToken = bodyToken ?? parseCookieValue(cookieHeader, 'refresh_token') ?? '';

    try {
      return await this.service.refresh({ rawToken });
    } catch (err) {
      if (err instanceof InvalidRefreshTokenError) {
        throw new HttpException(
          {
            error: {
              code: 'invalid_refresh_token',
              message: 'Refresh token is invalid.',
              details: {},
            },
          },
          401,
        );
      }
      throw err;
    }
  }
}

function parseCookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  const prefix = `${name}=`;
  for (const segment of header.split(';')) {
    const trimmed = segment.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }
  return undefined;
}
