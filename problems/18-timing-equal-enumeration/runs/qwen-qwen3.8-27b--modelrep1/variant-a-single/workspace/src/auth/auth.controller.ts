import { BadRequestException, Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^@\s]+$/;
const MAX_EMAIL_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 128;

interface AuthRequest {
  email: string;
  password: string;
}

function invalidInputException(field: 'email' | 'password'): BadRequestException {
  // The standard error envelope; the same shape and code for every
  // validation failure on every endpoint.
  return new BadRequestException({
    error: {
      code: 'invalid_input',
      message: `The '${field}' field is missing or malformed.`,
      details: { field },
    },
  });
}

// Input validation only; no business logic lives in the controller. It
// depends on no server state, so it cannot leak which branch a request
// would take.
function validateAuthBody(body: unknown): AuthRequest {
  const candidate = (typeof body === 'object' && body !== null ? body : {}) as {
    email?: unknown;
    password?: unknown;
  };

  const email = candidate.email;
  if (typeof email !== 'string' || email.length === 0 || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw invalidInputException('email');
  }

  const password = candidate.password;
  if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    throw invalidInputException('password');
  }

  return { email, password };
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('sign-up')
  @HttpCode(201)
  async signUp(@Body() body: unknown): Promise<{ message: string }> {
    const { email, password } = validateAuthBody(body);
    return this.auth.signUp(email, password);
  }

  @Post('sign-in')
  @HttpCode(200)
  async signIn(@Body() body: unknown): Promise<{ authenticated: boolean }> {
    const { email, password } = validateAuthBody(body);
    return this.auth.signIn(email, password);
  }
}
