import { Controller, Post, Body, Req, Res } from '@nestjs/common';
import { AuthService } from './auth.service';

// ASSUMPTION: AuthService exposes `rotate(refreshToken: string | undefined): Promise<{ accessToken: string; refreshToken: string }>` — inferred from the variant-a requirements since the service file's exports are not visible to this fix.

interface RefreshBody {
  refreshToken?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('refresh')
  async refresh(
    @Body() body: RefreshBody,
    @Req() req: { cookies?: Record<string, string> },
    @Res({ passthrough: true }) res: { cookie(name: string, value: string, options?: Record<string, unknown>): void },
  ) {
    // When both body and cookie are present, the body value wins.
    const refreshToken = body.refreshToken ?? req.cookies?.refresh_token;

    const result = await this.authService.rotate(refreshToken);

    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/auth/refresh',
    });

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }
}
