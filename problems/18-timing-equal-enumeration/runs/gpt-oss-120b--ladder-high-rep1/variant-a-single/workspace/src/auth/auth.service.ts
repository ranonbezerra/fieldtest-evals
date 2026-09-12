import { Injectable, HttpException, HttpStatus, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthRepository } from './auth.repository.js';
import { MailService } from '../mail/mail.service.js';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash: string;

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly mailService: MailService,
  ) {}

  async onModuleInit() {
    // Pre‑compute a dummy hash for timing equalisation in sign‑in.
    this.dummyHash = await argon2.hash('dummyPassword', { type: argon2.argon2id });
  }

  /**
   * Sign‑up endpoint.
   * Returns a generic success message regardless of whether the e‑mail already exists.
   */
  async signUp(email: string, password: string): Promise<{ message: string }> {
    const existingUser = await this.authRepository.findByEmail(email);

    // Compute a password hash regardless of existence to equalise timing.
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    if (existingUser) {
      // Existing address – send a notification e‑mail (fire‑and‑forget).
      this.mailService
        .sendEmail(email, 'sign-up-existing', { email })
        .catch(() => {
          // Swallow mail errors – they must not affect the response.
        });
    } else {
      // New address – persist the new user.
      await this.authRepository.createUser(email, passwordHash);
      this.mailService
        .sendEmail(email, 'sign-up-new', { email })
        .catch(() => {
          // Swallow mail errors – they must not affect the response.
        });
    }

    // Generic response that is identical for both branches.
    return {
      message:
        'If an account with that email exists, you will receive an email shortly.',
    };
  }

  /**
   * Sign‑in endpoint.
   * Returns a token on success.
   * Wrong password and unknown address produce an identical error response.
   */
  async signIn(email: string, password: string): Promise<{ accessToken: string }> {
    const user = await this.authRepository.findByEmail(email);

    if (user) {
      // Verify the real password hash.
      const valid = await argon2.verify(user.password, password);
      if (valid) {
        // In a real system we would issue a JWT or session token.
        // For this exercise we return a static placeholder.
        return { accessToken: 'dummy-access-token' };
      }
    } else {
      // Verify against a dummy hash to consume the same amount of time.
      await argon2.verify(this.dummyHash, password);
    }

    // Failure – identical response for both wrong password and unknown e‑mail.
    throw new HttpException(
      {
        error: {
          code: 'invalid_credentials',
          message: 'Invalid email or password.',
          details: {},
        },
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
