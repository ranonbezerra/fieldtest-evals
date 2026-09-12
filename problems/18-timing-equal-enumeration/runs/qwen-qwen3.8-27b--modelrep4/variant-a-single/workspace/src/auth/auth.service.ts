import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { AppError } from '../common/app.error';
import { MAILER, type MailerPort } from '../mail/mail.port';
import { AuthRepository } from './auth.repository';

// OWASP minimum for argon2id at this scale: 19 MiB memory, 2 iterations,
// 1 lane. Overridable via environment; the cost is real work on purpose.
const DEFAULT_MEMORY_COST_KIB = 19456;
const DEFAULT_TIME_COST = 2;
const DEFAULT_PARALLELISM = 1;

// Fixed, non-secret input for the throwaway hash that makes the
// unknown-address branch of sign-in cost exactly one argon2 pass.
const DUMMY_HASH_SEED = 'fieldtest-equal-timing-v1';

/**
 * The one body both sign-up branches return. A constant on purpose: it must
 * be byte-identical whether or not the address already exists.
 */
const SIGN_UP_RESPONSE = {
  status: 'processed',
  message: 'If this address is new, a verification email is on its way.',
} as const;

export type SignUpResult = typeof SIGN_UP_RESPONSE;

export interface SignInResult {
  token: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private dummyHash = '';

  constructor(
    private readonly repository: AuthRepository,
    @Inject(MAILER) private readonly mail: MailerPort,
    private readonly jwt: JwtService,
  ) {}

  private hashOptions() {
    return {
      type: argon2.argon2id,
      memoryCost: Number(process.env.ARGON2_MEMORY_COST) || DEFAULT_MEMORY_COST_KIB,
      timeCost: Number(process.env.ARGON2_TIME_COST) || DEFAULT_TIME_COST,
      parallelism: Number(process.env.ARGON2_PARALLELISM) || DEFAULT_PARALLELISM,
    };
  }

  async onModuleInit(): Promise<void> {
    // Pre-compute the throwaway hash with the *current* parameters, so a
    // dummy verify costs the same as a verify against a fresh stored hash.
    // If the cost factors are raised later, re-hash stored passwords on
    // login or the two sign-in branches drift apart in time.
    this.dummyHash = await argon2.hash(DUMMY_HASH_SEED, this.hashOptions());
  }

  async signUp(email: string, password: string): Promise<SignUpResult> {
    // Both branches — new address and taken address — run this exact
    // sequence:
    //   argon2 hash → SELECT → INSERT attempt → exactly one email.
    // Dropping any step in one branch re-opens the timing channel; do not
    // "optimize" this method.
    const passwordHash = await argon2.hash(password, this.hashOptions());
    const existing = await this.repository.findByEmail(email);
    await this.repository.createOrKeep(email, passwordHash);

    if (existing) {
      // Security event, logged server-side only — never in the response.
      this.logger.warn('sign-up attempted on an existing address');
      await this.mail.sendEmail(email, 'sign-up-taken', { at: new Date().toISOString() });
    } else {
      await this.mail.sendEmail(email, 'sign-up-verify', { at: new Date().toISOString() });
    }
    return SIGN_UP_RESPONSE;
  }

  async signIn(email: string, password: string): Promise<SignInResult> {
    const user = await this.repository.findByEmail(email);
    // Unknown address: verify against the dummy hash, so "wrong password"
    // and "no such account" each burn exactly one argon2 pass.
    const passwordMatches = await argon2.verify(user?.passwordHash ?? this.dummyHash, password);
    if (!user || !passwordMatches) {
      // Same status, code, message and details for both failures on purpose.
      throw new AppError(401, 'invalid_credentials', 'Invalid email or password.', {});
    }
    const token = await this.jwt.signAsync({ sub: user.id, email: user.email });
    return { token };
  }
}
