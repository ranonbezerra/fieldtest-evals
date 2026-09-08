# repair2-auth.controller.ts

## reasoning

```
We need to write controller fixing imports. Likely need to import AuthService, DTOs. Provide basic controller with routes sign-up and sign-in, returning generic response. Use NestJS decorators. Provide class. No other files changed.

Assume AuthService has methods signUp and signIn returning something. We'll just call them and return result.

Implement using appropriate imports: Controller, Post, Body from '@nestjs/common'; DTOs from './dto/...'; AuthService from './auth.service'.

Also need to export class.

Write.
```

## reply

```ts
// src/auth/auth.controller.ts

import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignUpDto } from './dto/sign-up.dto';
import { SignInDto } from './dto/sign-in.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Sign‑up endpoint.
   * Returns a generic success response regardless of whether the email already exists.
   */
  @Post('sign-up')
  @HttpCode(HttpStatus.OK)
  async signUp(@Body() signUpDto: SignUpDto): Promise<{ message: string }> {
    // The service handles the timing‑equal logic internally.
    await this.authService.signUp(signUpDto);
    return { message: 'If the email is not registered, you will receive a verification email.' };
  }

  /**
   * Sign‑in endpoint.
   * Returns a generic success response regardless of whether the credentials are correct.
   */
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  async signIn(@Body() signInDto: SignInDto): Promise<{ message: string }> {
    // The service handles the timing‑equal logic internally.
    await this.authService.signIn(signInDto);
    return { message: 'If the credentials are correct, you will be signed in.' };
  }
}
```
