import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const MAX_EMAIL_LENGTH = 254;

// The one and only sign-up acknowledgement. Both branches return it verbatim,
// so status, body bytes, and derived headers (content-length, etag) are
// identical by construction.
const SIGN_UP_ACKNOWLEDGEMENT = {
  message: 'If this address is new, a verification email is on its way.',
} as const;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  @HttpCode(202)
  async signUp(@Body() body: unknown): Promise<typeof SIGN_UP_ACKNOWLEDGEMENT> {
    const { email, password } = this.readCredentials(body);
    await this.authService.signUp(email, password);
    return SIGN_UP_ACKNOWLEDGEMENT;
  }

  @Post('sign-in')
  @HttpCode(200)
  async signIn(@Body() body: unknown): Promise<{ message: string }> {
    const { email, password } = this.readCredentials(body);
    const outcome = await this.authService.signIn(email, password);
    if (outcome.result === 'rejected') {
      // Deliberately the same error for an unknown address and a wrong
      // password; the service already spent equal time in both cases.
      throw new HttpException(
        {
          error: {
            code: 'invalid_credentials',
            message: 'Email or password is incorrect.',
            details: {},
          },
        },
        401,
      );
    }
    return { message: 'Signed in.' };
  }

  private readCredentials(body: unknown): { email: string; password: string } {
    const raw = (
      typeof body === 'object' && body !== null ? body : {}
    ) as { email?: unknown; password?: unknown };

    // Normalisation (trim + lowercase) is input validation, not business
    // logic: the store treats case variants as the same address.
    const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
    const password = typeof raw.password === 'string' ? raw.password : '';

    const invalidFields: string[] = [];
    if (!EMAIL_PATTERN.test(email) || email.length > MAX_EMAIL_LENGTH) {
      invalidFields.push('email');
    }
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      invalidFields.push('password');
    }
    if (invalidFields.length > 0) {
      throw new HttpException(
        {
          error: {
            code: 'validation_failed',
            message: `Invalid or missing fields: ${invalidFields.join(', ')}.`,
            details: { fields: invalidFields },
          },
        },
        400,
      );
    }
    return { email, password };
  }
}
