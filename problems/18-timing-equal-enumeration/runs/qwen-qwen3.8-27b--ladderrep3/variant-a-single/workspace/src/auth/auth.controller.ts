import { BadRequestException, Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { AuthService, SignInResult, SignUpResult } from './auth.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  /**
   * Blind sign-up. The status and body are identical whether or not the
   * address was new; the actual outcome reaches the address by mail.
   */
  @Post('sign-up')
  @HttpCode(202)
  async signUp(@Body() body: unknown): Promise<SignUpResult> {
    const { email, password } = this.parseCredentials(body);
    return this.authService.signUp(email, password);
  }

  @Post('sign-in')
  async signIn(@Body() body: unknown): Promise<SignInResult> {
    const { email, password } = this.parseCredentials(body);
    return this.authService.signIn(email, password);
  }

  /**
   * Input validation only; the result is handed to the service. Validation
   * runs identically before any branch is taken, so it leaks nothing.
   */
  private parseCredentials(body: unknown): { email: string; password: string } {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      this.reject('The request body must be a JSON object with "email" and "password".');
    }
    const { email, password } = body as Record<string, unknown>;

    const emailValue = typeof email === 'string' ? email.trim() : '';
    if (emailValue.length === 0 || emailValue.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(emailValue)) {
      this.reject('"email" must be a syntactically valid address.');
    }
    if (
      typeof password !== 'string' ||
      password.length < MIN_PASSWORD_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      this.reject(`"password" must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`);
    }

    return { email: emailValue.toLowerCase(), password };
  }

  private reject(message: string): never {
    throw new BadRequestException({
      error: { code: 'invalid_input', message, details: {} },
    });
  }
}
