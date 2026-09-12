import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AppError } from '../common/app.error';
import { AuthService, type SignInResult, type SignUpResult } from './auth.service';

const EMAIL_MAX_LENGTH = 254;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

/**
 * Edge validation. Every rejection is `400 invalid_input` and carries no
 * information about whether an account exists. Deliberately no DNS/MX
 * checking: a mail-lookup round trip would be an existence oracle.
 */
function readCredentials(body: unknown): { email: string; password: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError(400, 'invalid_input', 'Request body must be a JSON object.', {});
  }
  const { email, password } = body as { email?: unknown; password?: unknown };
  if (
    typeof email !== 'string' ||
    email.trim().length === 0 ||
    email.length > EMAIL_MAX_LENGTH ||
    !email.includes('@')
  ) {
    throw new AppError(400, 'invalid_input', 'A well-formed email address is required.', {
      email: `must be a non-empty string of at most ${EMAIL_MAX_LENGTH} characters containing "@"`,
    });
  }
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new AppError(400, 'invalid_input', 'Password length is out of range.', {
      password: `length must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH}`,
    });
  }
  // Canonical form: surrounding whitespace and letter case do not create
  // different addresses.
  return { email: email.trim().toLowerCase(), password };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @HttpCode(201)
  signUp(@Body() body: unknown): Promise<SignUpResult> {
    const { email, password } = readCredentials(body);
    return this.authService.signUp(email, password);
  }

  @Post('sign-in')
  @HttpCode(200)
  signIn(@Body() body: unknown): Promise<SignInResult> {
    const { email, password } = readCredentials(body);
    return this.authService.signIn(email, password);
  }
}
