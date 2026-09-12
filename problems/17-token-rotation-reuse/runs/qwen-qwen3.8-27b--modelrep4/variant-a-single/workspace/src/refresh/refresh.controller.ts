import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { RefreshService } from './refresh.service.js';

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

export const INVALID_REFRESH_TOKEN_RESPONSE = {
  error: {
    code: 'invalid_refresh_token',
    message: 'The refresh token is invalid.',
    details: {},
  },
} as const;

export class InvalidRefreshTokenException extends UnauthorizedException {
  constructor() {
    super(INVALID_REFRESH_TOKEN_RESPONSE);
  }

  getResponse(): typeof INVALID_REFRESH_TOKEN_RESPONSE {
    return INVALID_REFRESH_TOKEN_RESPONSE;
  }
}

@Controller('auth')
export class RefreshController {
  constructor(private readonly refreshService: RefreshService) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() body: { refreshToken?: unknown },
    @Headers('cookie') cookieHeader?: string,
  ): Promise<RefreshResponse> {
    const result = await this.refreshService.refresh({
      bodyRefreshToken: body?.refreshToken,
      cookieRefreshToken: this.readCookie(cookieHeader, 'refresh_token'),
    });

    if (result.outcome === 'rejected') {
      throw new InvalidRefreshTokenException();
    }

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }

  private readCookie(header: string | undefined, name: string): string | undefined {
    if (!header) {
      return undefined;
    }

    for (const part of header.split(';')) {
      const separator = part.indexOf('=');
      if (separator === -1) {
        continue;
      }

      const key = part.slice(0, separator).trim();
      if (key === name) {
        return part.slice(separator + 1).trim();
      }
    }

    return undefined;
  }
}
