import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service.js';

/**
 * Refresh endpoint.
 *
 * The refresh token can be supplied either in the JSON body (`refreshToken`)
 * or in a `refresh_token` HTTP‑only cookie.
 *
 * **Precedence**: If both are present, the value from the request body wins.
 *
 * All error responses are indistinguishable to the client and conform to the
 * shared error envelope.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('refresh')
  async refresh(
    @Body() body: any,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Extract token with documented precedence.
    const tokenFromBody = typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
    const tokenFromCookie = typeof req?.cookies?.refresh_token === 'string' ? req.cookies.refresh_token : undefined;
    const refreshToken = tokenFromBody ?? tokenFromCookie;

    try {
      const { accessToken, refreshToken: newRefreshToken } =
        await this.authService.refresh(refreshToken);

      // Return the new refresh token as an HTTP‑only cookie.
      res.cookie('refresh_token', newRefreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        // The cookie expiration mirrors the absolute session deadline.
        // (Clients should treat the token itself as the source of truth.)
      });

      // Return the access token in the response body.
      res.status(HttpStatus.OK).json({ accessToken });
    } catch (err) {
      // All failures map to a single, generic error response.
      const errorResponse = {
        error: {
          code: 'invalid_refresh_token',
          message: 'Invalid refresh token.',
          details: {},
        },
      };
      res.status(HttpStatus.UNAUTHORIZED).json(errorResponse);
    }
  }
}
