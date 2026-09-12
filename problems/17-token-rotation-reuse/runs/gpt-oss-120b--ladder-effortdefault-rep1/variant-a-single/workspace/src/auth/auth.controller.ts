import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { RefreshDto } from './dto/refresh.dto.js';
import type { CookieOptions } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/refresh
   *
   * The refresh token can be supplied either:
   *   • In the JSON body as `refreshToken`
   *   • In a `refresh_token` http‑only cookie
   *
   * If both are present, the body value **wins**.
   */
  @Post('refresh')
  async refresh(
    @Body() body: RefreshDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const tokenFromBody = body.refreshToken?.trim();
    const tokenFromCookie = (req.cookies?.refresh_token ?? '').trim();

    const presentedToken = tokenFromBody || tokenFromCookie;

    try {
      const { accessToken, newRefreshToken } = await this.authService.refresh(
        presentedToken,
      );

      // Set the new refresh token as an http‑only cookie
      const cookieOpts: CookieOptions = {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/auth/refresh',
        // Expires at the same time as the token's expiry – handled inside service
      };
      res.cookie('refresh_token', newRefreshToken, cookieOpts);

      return res.json({ accessToken, refreshToken: newRefreshToken });
    } catch (err) {
      // All rejections flow through a single envelope
      const envelope = {
        error: {
          code: 'invalid_refresh_token',
          message: 'Refresh token is invalid or has expired',
          details: {},
        },
      };
      throw new HttpException(envelope, HttpStatus.UNAUTHORIZED);
    }
  }
}
