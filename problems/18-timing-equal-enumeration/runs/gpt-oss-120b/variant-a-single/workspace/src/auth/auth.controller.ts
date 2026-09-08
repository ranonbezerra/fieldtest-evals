import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Header,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignUpDto } from './dto/sign-up.dto';
import { SignInDto } from './dto/sign-in.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @HttpCode(HttpStatus.CREATED)
  @Header('Content-Type', 'application/json')
  async signUp(@Body() dto: SignUpDto) {
    await this.authService.signUp(dto.email, dto.password);
    return { message: 'If an account with that email exists, you will receive an email shortly.' };
  }

  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'application/json')
  async signIn(@Body() dto: SignInDto) {
    const success = await this.authService.signIn(dto.email, dto.password);
    if (success) {
      return { message: 'Signed in successfully' };
    }
    // Generic error envelope
    return {
      error: {
        code: 'invalid_credentials',
        message: 'Invalid email or password',
        details: {},
      },
    };
  }
}
