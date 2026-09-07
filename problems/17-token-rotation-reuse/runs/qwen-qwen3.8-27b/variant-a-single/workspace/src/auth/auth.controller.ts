// src/auth/auth.controller.ts
import { Body, Controller, Post, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body('refreshToken') bodyToken: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Precedence: JSON body wins over cookie.
    const cookieToken = req.cookies?.refresh_token as string | undefined;
    const refreshToken = bodyToken ?? cookieToken;

    if (!refreshToken) {
      res.status(HttpStatus.UNAUTHORIZED).json({
        error: {
          code: 'invalid_token',
          message: 'Invalid or expired refresh token',
          details: {},
        },
      });
      return;
    }

    try {
      const result = await this.authService.rotate(refreshToken);
      res.status(HttpStatus.OK).json(result);
    } catch {
      res.status(HttpStatus.UNAUTHORIZED).json({
        error: {
          code: 'invalid_token',
          message: 'Invalid or expired refresh token',
          details: {},
        },
      });
    }
  }
}
