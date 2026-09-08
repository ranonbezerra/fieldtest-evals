// src/auth/auth.controller.ts

import { Controller, Post, Body, Req, Res, HttpCode } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RefreshDto } from './dto/refresh.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Refreshes an access token and rotates the refresh token.
   *
   * The refresh token can be provided either:
   *   - in the JSON body as `refreshToken`
   *   - as an HTTP‑only cookie named `refresh_token`
   *
   * If both are present, the body value **wins**.
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Prefer token from body over cookie
    const tokenFromBody = (body as any)?.refreshToken;
    const tokenFromCookie = req.cookies?.refresh_token;
    const refreshToken = tokenFromBody ?? tokenFromCookie;

    // Delegate all business logic to the service layer
    const { accessToken, refreshToken: newRefreshToken } =
      await this.authService.refresh(refreshToken);

    // Issue the new refresh token as an http‑only cookie
    res.cookie('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });

    // Return only the new access token in the response body
    return { accessToken };
  }
}
