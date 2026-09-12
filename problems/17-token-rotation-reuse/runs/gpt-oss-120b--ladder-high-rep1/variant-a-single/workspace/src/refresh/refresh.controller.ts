import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RefreshService } from './refresh.service.js';
import { Request, Response } from 'express';
import { InvalidRefreshTokenException } from './invalid-refresh-token.exception.js';

@Controller()
export class RefreshController {
  constructor(private readonly refreshService: RefreshService) {}

  /**
   * POST /auth/refresh
   * Accepts a refresh token either in the JSON body (`refreshToken`) or in the
   * `refresh_token` cookie. **If both are present, the body token takes precedence.**
   */
  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    const tokenFromBody: string | undefined = body?.refreshToken;
    const tokenFromCookie: string | undefined = req.cookies?.refresh_token;
    const refreshToken = tokenFromBody ?? tokenFromCookie;

    if (!refreshToken) {
      // malformed request – treat as generic rejection
      throw new InvalidRefreshTokenException();
    }

    const result = await this.refreshService.refresh(refreshToken);

    // Return the new refresh token as an HttpOnly cookie (optional but common)
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });

    // Also include it in the JSON body for API consumers that prefer it
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }
}
