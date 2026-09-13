import { Controller, Post, Body, HttpStatus, HttpCode, UsePipes } from '@nestjs/common';
import { SignUpDto } from './dto/sign-up.dto.ts';
import { SignInDto } from './dto/sign-in.dto.ts';
import { AuthService, SignUpResult, SignInResult } from './auth.service.ts';
import { InvalidCredentialsException } from './errors/invalid-credentials.exception.ts';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @HttpCode(HttpStatus.CREATED)
  async signUp(@Body() dto: SignUpDto): Promise<SignUpResult> {
    return this.authService.signUp(dto.email, dto.password);
  }

  @Post('sign-in')
  async signIn(@Body() dto: SignInDto): Promise<SignInResult> {
    const result = await this.authService.signIn(dto.email, dto.password);
    if (!result.success) {
      throw new InvalidCredentialsException();
    }
    return { success: true, message: result.message };
  }
}
