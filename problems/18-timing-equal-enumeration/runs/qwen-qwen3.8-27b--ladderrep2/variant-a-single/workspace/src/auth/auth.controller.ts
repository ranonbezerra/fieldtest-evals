import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { AppException } from '../common/app.exception.js';
import { AuthService } from './auth.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

/**
 * Input validation lives in the controller: shape, format, bounds.
 * The same rules apply to sign-up and sign-in.
 */
function requireCredentials(body: unknown): { email: string; password: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppException(400, 'invalid_input', 'Request body must be a JSON object.', { fields: ['body'] });
  }
  const { email, password } = body as Record<string, unknown>;
  const fields: string[] = [];
  if (typeof email !== 'string' || email.length === 0 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    fields.push('email');
  }
  if (
    typeof password !== 'string' ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    fields.push('password');
  }
  if (fields.length > 0) {
    throw new AppException(400, 'invalid_input', 'email and password must be provided in the expected format.', {
      fields,
    });
  }
  return { email: email as string, password: password as string };
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('sign-up')
  @HttpCode(200)
  signUp(@Body() body: unknown): Promise<{ status: 'ok' }> {
    const { email, password } = requireCredentials(body);
    return this.auth.signUp(email, password);
  }

  @Post('sign-in')
  @HttpCode(200)
  signIn(@Body() body: unknown): Promise<{ token: string }> {
    const { email, password } = requireCredentials(body);
    return this.auth.signIn(email, password);
  }
}
