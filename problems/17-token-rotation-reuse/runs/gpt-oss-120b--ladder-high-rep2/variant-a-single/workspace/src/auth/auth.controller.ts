import { Controller, Post, Body, Req, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Request } from 'express';

/**
 * Handles authentication related endpoints.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Refreshes an access token using a refresh token.
   *
   * The refresh token may be supplied either:
   * - as a JSON body field `refreshToken`, or
   * - as a cookie named `refresh_token`.
   *
   * If both are present, the cookie token takes precedence.
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: any, @Req() req: Request) {
    const tokenFromCookie = req.cookies?.refresh_token;
    const tokenFromBody = body?.refreshToken;
    // Precedence: cookie wins over JSON body.
    const refreshToken = tokenFromCookie ?? tokenFromBody;
    return this.authService.refresh(refreshToken);
  }
}
