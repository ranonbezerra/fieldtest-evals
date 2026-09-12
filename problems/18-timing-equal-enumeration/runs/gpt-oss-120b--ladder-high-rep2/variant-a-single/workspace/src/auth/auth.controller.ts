import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service.js';

class SignUpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

class SignInDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @HttpCode(HttpStatus.OK) // Always return 200, regardless of account existence.
  async signUp(@Body() signUpDto: SignUpDto): Promise<{ message: string }> {
    await this.authService.signUp(signUpDto.email, signUpDto.password);
    return {
      message: 'If you have not yet verified your email, please check your inbox.',
    };
  }

  @Post('sign-in')
  async signIn(@Body() signInDto: SignInDto) {
    // Returns an access token on success, or throws an HttpException on failure.
    return await this.authService.signIn(signInDto.email, signInDto.password);
  }
}
