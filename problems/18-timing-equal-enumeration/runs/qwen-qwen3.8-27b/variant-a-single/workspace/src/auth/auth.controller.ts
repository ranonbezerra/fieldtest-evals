import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Input validation only. Both endpoints share it, so rejection responses are
 * identical regardless of which endpoint was called.
 */
function readCredentials(body: unknown): { email: string; password: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException({
      code: 'invalid_request',
      message: 'Request body must be a JSON object with "email" and "password".',
    });
  }
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || email.length < 3 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new BadRequestException({
      code: 'invalid_request',
      message: '"email" must be a valid address of 3 to 254 characters.',
    });
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new BadRequestException({
      code: 'invalid_request',
      message: '"password" must be a string of 8 to 128 characters.',
    });
  }
  return { email, password };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @HttpCode(HttpStatus.ACCEPTED)
  signUp(@Body() body: unknown): Promise<{ message: string }> {
    const { email, password } = readCredentials(body);
    return this.authService.signUp(email, password);
  }

  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  signIn(@Body() body: unknown): Promise<{ message: string }> {
    const { email, password } = readCredentials(body);
    return this.authService.signIn(email, password);
  }
}
