# repair1-auth.controller.ts

## reasoning

```
We need to rewrite controller fixing imports. Likely need to use @nestjs/common, not express. Provide endpoint handling refresh token from body or cookie. Use AuthService. Define DTO. We'll assume DTO exists. We'll import Request, Response from 'express' (need types). Actually error: cannot find module 'express' – need to add import from '@nestjs/common' for @Req, @Res which provide Express types. Ensure package has @types/express but compile error due to missing? We can import from 'express' type only; assume types exist. Provide proper imports.

Also need to import AuthService, RefreshDto. Use NestJS decorators.

Implement method: @Post('refresh') async refresh(@Body() body, @Req() req, @Res() res) { const token = body.refreshToken ?? req.cookies.refresh_token; // body wins? define: body takes precedence. // Document via comment. const result = await this.authService.refresh(token); return res.json(result); }

Assume service returns { accessToken, refreshToken }. Use appropriate return type.

Write file.
```

## reply

```ts
// src/auth/auth.controller.ts

import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RefreshDto } from './dto/refresh.dto';

/**
 * Controller handling authentication related endpoints.
 *
 * - The `POST /auth/refresh` endpoint accepts a refresh token either in the
 *   request body (`refreshToken`) or in the `refresh_token` cookie.
 * - When both are present, the token from the body **wins**.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() body: RefreshDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Prefer token from body; fall back to cookie.
    const tokenFromBody = (body as any).refreshToken;
    const tokenFromCookie = req.cookies?.refresh_token;
    const refreshToken = tokenFromBody ?? tokenFromCookie;

    // Let the service handle validation, rotation, and error mapping.
    const result = await this.authService.refresh(refreshToken);

    // The service returns an object with `accessToken` and `refreshToken`.
    // Respond with JSON (Nest will handle serialization).
    return res.json(result);
  }
}
```
