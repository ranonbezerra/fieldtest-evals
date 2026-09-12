import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service.js';

export class SignUpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class SignInDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  // 202 with a fixed body for a new address and a taken one alike: the only
  // difference between the branches is which mail goes out, and that is never
  // awaited, so it can change neither the bytes nor the time the caller sees.
  @Post('sign-up')
  @HttpCode(202)
  async signUp(@Body() credentials: SignUpDto): Promise<{ message: string }> {
    await this.authService.signUp(credentials);
    return { message: 'If this is your address, we just sent you an email.' };
  }

  // Success is 200; every failure is the same 401, whether the address is
  // unknown or the password is wrong.
  @Post('sign-in')
  @HttpCode(200)
  async signIn(@Body() credentials: SignInDto): Promise<{ message: string }> {
    await this.authService.signIn(credentials);
    return { message: 'ok' };
  }
}
