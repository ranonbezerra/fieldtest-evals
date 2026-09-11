import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiException } from '../common/api-error.js';
import { AuthService } from './auth.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('sign-up')
  @HttpCode(201)
  signUp(@Body() body: unknown): Promise<{ status: string }> {
    const { email, password } = this.readCredentials(body);
    return this.auth.signUp(email, password);
  }

  @Post('sign-in')
  @HttpCode(200)
  signIn(@Body() body: unknown): Promise<{ status: string }> {
    const { email, password } = this.readCredentials(body);
    return this.auth.signIn(email, password);
  }

  private readCredentials(body: unknown): { email: string; password: string } {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new ApiException(400, 'invalid_input', 'Request body must be a JSON object.');
    }
    const { email, password } = body as Record<string, unknown>;
    if (typeof email !== 'string' || email.length === 0 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
      throw new ApiException(
        400,
        'invalid_input',
        'email must be a string of at most 254 characters in the form local@domain.tld.',
      );
    }
    if (
      typeof password !== 'string' ||
      password.length < MIN_PASSWORD_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      throw new ApiException(
        400,
        'invalid_input',
        `password must be a string between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
      );
    }
    return { email, password };
  }
}
