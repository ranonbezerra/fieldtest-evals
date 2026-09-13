import { Controller, Post, Req, Res, UseFilters } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthFailedFilter } from './auth.failed.filter.js';

@Controller('auth')
@UseFilters(AuthFailedFilter)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/refresh
   *
   * Token precedence (when both present): the JSON body field `refreshToken`
   * takes priority over the `refresh_token` cookie.
   *
   * Sets the new refresh token as an httpOnly, secure, sameSite=strict cookie
   * named `refresh_token` on success only.
   */
  @Post('refresh')
  async refresh(@Req() req: any, @Res() res: any) {
    // Body wins over cookie when both present
    const token = req.body?.refreshToken ?? req.cookies?.refresh_token;

    const result = await this.authService.refresh({
      token,
      ip: req.ip ?? 'unknown',
      userAgent: req.get('User-Agent') ?? 'unknown',
    });

    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });

    return res.status(200).json({ accessToken: result.accessToken });
  }
}
