import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { IsEmail, IsString, MinLength } from 'class-validator';

class SignUpDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

class SignInDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @HttpCode(HttpStatus.OK)
  async signUp(@Body() dto: SignUpDto) {
    await this.authService.signUp(dto.email, dto.password);
    return {
      message:
        'If a user with this email exists, you will receive an email shortly',
    };
  }

  @Post('sign-in')
  async signIn(@Body() dto: SignInDto) {
    const token = await this.authService.signIn(dto.email, dto.password);
    return { token };
  }
}
