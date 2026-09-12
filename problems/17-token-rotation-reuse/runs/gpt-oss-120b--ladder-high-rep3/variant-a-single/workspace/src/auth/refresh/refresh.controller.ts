import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { RefreshService } from './refresh.service.js';
import { RefreshError } from './refresh.error.js';
import type { Request, Response } from 'express';

@Controller('auth')
export class RefreshController {
  constructor(private readonly refreshService: RefreshService) {}

  /**
   * Refresh token rotation endpoint.
   *
   * Token precedence:
   * - If both JSON body `refreshToken` and `refresh_token` cookie are present,
   *   the body token wins.
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: { refreshToken?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const tokenFromBody = body?.refreshToken;
    const tokenFromCookie = req.cookies?.refresh_token;
    const presentedToken = tokenFromBody ?? tokenFromCookie;

    if (!presentedToken) {
      return this.respondWithError(res, 'malformed_token');
    }

    try {
      const result = await this.refreshService.rotate(presentedToken);
      // Set the new refresh token as an HttpOnly, Secure cookie
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
      });
      return res.json({ accessToken: result.accessToken });
    } catch (err: unknown) {
      if (err instanceof RefreshError) {
        return this.respondWithError(res, err.code);
      }
      // Unexpected error – treat as generic unknown token error
      return this.respondWithError(res, 'unknown_error');
    }
  }

  private respondWithError(res: Response, code: string) {
    res.status(401).json({
      error: {
        code,
        message: 'Invalid refresh token',
        details: {},
      },
    });
    return;
  }
}
