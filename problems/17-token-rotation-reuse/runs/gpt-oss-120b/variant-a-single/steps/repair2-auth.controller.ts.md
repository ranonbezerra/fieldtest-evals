# repair2-auth.controller.ts

## reasoning

```
We need to rewrite controller to import correct things. Likely use @nestjs/common, @nestjs/platform-express for Request, Response. Use AuthService and RefreshDto. Provide endpoint. Use cookie. We'll assume existence of service methods. Provide proper imports.

Write file:

import { Controller, Post, Body, Req, Res, HttpCode } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RefreshDto } from './dto/refresh.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokenFromBody = body?.refreshToken;
    const tokenFromCookie = req.cookies?.refresh_token;
    // Preference: body token wins over cookie if both present
    const refreshToken = tokenFromBody ?? tokenFromCookie;
    const result = await this.authService.refresh(refreshToken);
    // set new refresh token cookie
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });
    return { accessToken: result.accessToken };
  }
}

Assume RefreshDto defines refreshToken optional. Also assume authService.refresh returns {accessToken, refreshToken}. This resolves missing imports.
```

## reply

```ts
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
```
