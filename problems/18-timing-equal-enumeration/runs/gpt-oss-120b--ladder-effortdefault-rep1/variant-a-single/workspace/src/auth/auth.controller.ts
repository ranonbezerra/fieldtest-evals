import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { SignUpDto } from './dto/sign-up.dto.js';
import { SignInDto } from './dto/sign-in.dto.js';
import { ValidationPipe } from '@nestjs/common';
import { UsePipes } from '@nestjs/common';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async signUp(@Body() dto: SignUpDto) {
    await this.authService.signUp(dto.email, dto.password);
    // Identical response for both existing and new addresses
    return { message: 'Request processed' };
  }

  @Post('sign-in')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async signIn(@Body() dto: SignInDto) {
    try {
      const token = await this.authService.signIn(dto.email, dto.password);
      return { token };
    } catch (err) {
      // Both unknown email and wrong password return the same envelope
      throw new HttpException(
        {
          error: {
            code: 'invalid_credentials',
            message: 'Invalid email or password',
            details: {},
          },
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}
