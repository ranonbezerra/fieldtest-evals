import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service.js';

export class SignUpDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class SignInDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('sign-up')
  @HttpCode(202)
  signUp(@Body() body: SignUpDto): Promise<{ status: string }> {
    return this.authService.signUp(body.email, body.password);
  }

  @Post('sign-in')
  @HttpCode(200)
  signIn(@Body() body: SignInDto): Promise<{ status: string }> {
    return this.authService.signIn(body.email, body.password);
  }
}
