import { Inject, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { AuthRepository } from './auth.repository.js';
import { MAIL_PORT, type MailPort } from './mail.port.js';

// The single body both sign-up branches return; one constant guarantees the
// responses are byte-identical.
const SIGN_UP_ACK = { message: 'If this is a new address, a verification email is on its way.' };

// E-mail templates: the real outcome is delivered to the owner this way,
// never through the HTTP response.
export const EMAIL_TEMPLATES = {
  verify: 'verify_email',
  signupAttempt: 'signup_attempt',
} as const;

// A throwaway secret; its hash is the stand-in every "unknown address"
// verifies against, so that branch burns the same KDF cost as a real one.
const TIMING_DECOY_PASSWORD = 'timing-decoy-password-never-used-for-a-real-account';

// Default argon2id cost: 192 MiB, 4 iterations, 1 lane. Configurable through
// the environment only.
const DEFAULT_MEMORY_KIB = 196608;
const DEFAULT_TIME_COST = 4;
const DEFAULT_PARALLELISM = 1;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly hashOptions: { type: 0 | 1 | 2; memoryCost: number; timeCost: number; parallelism: number };
  private decoyHash: string | null = null;

  constructor(
    @Inject(AuthRepository) private readonly users: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {
    this.hashOptions = {
      type: argon2.argon2id,
      memoryCost: envInt('AUTH_ARGON2_MEMORY_KIB', DEFAULT_MEMORY_KIB),
      timeCost: envInt('AUTH_ARGON2_TIME_COST', DEFAULT_TIME_COST),
      parallelism: envInt('AUTH_ARGON2_PARALLELISM', DEFAULT_PARALLELISM),
    };
  }

  async onModuleInit(): Promise<void> {
    this.decoyHash = await argon2.hash(TIMING_DECOY_PASSWORD, this.hashOptions);
  }

  async signUp(email: string, password: string): Promise<{ message: string }> {
    const existing = await this.users.findByEmail(email);
    if (existing !== null) {
      // Repeat sign-up: burn the same KDF work as the "new address" branch
      // (verify costs the same as hash) so response time cannot reveal the
      // branch. The outcome is deliberately ignored.
      await this.burnKdf(existing.passwordHash, password);
      this.dispatch(email, EMAIL_TEMPLATES.signupAttempt, {});
    } else {
      const passwordHash = await argon2.hash(password, this.hashOptions);
      const verificationToken = randomBytes(32).toString('base64url');
      try {
        await this.users.createUser(email, passwordHash, verificationToken);
        this.dispatch(email, EMAIL_TEMPLATES.verify, { token: verificationToken });
      } catch (error) {
        // Two concurrent first sign-ups can race on the unique email index;
        // the loser must produce the same 201, not a 500.
        if (!this.isUniqueViolation(error)) throw error;
        this.dispatch(email, EMAIL_TEMPLATES.signupAttempt, {});
      }
    }
    return SIGN_UP_ACK;
  }

  async signIn(email: string, password: string): Promise<{ authenticated: boolean }> {
    const user = await this.users.findByEmail(email);
    if (user === null) {
      // Unknown address: verify against the decoy (same KDF cost as a real
      // verify) before returning the identical 401.
      const decoy = this.decoyHash ?? await argon2.hash(TIMING_DECOY_PASSWORD, this.hashOptions);
      await this.burnKdf(decoy, password);
      throw this.invalidCredentials();
    }
    const passwordMatches = await argon2.verify(user.passwordHash, password);
    if (!passwordMatches) {
      throw this.invalidCredentials();
    }
    return { authenticated: true };
  }

  private async burnKdf(passwordHash: string, password: string): Promise<void> {
    try {
      await argon2.verify(passwordHash, password);
    } catch {
      // The KDF work already ran; a malformed hash must not become a
      // distinguishable response.
    }
  }

  private dispatch(to: string, template: string, vars: Record<string, string>): void {
    // Fire and forget: SMTP latency must never reach the response time, so
    // it cannot become an oracle for the branch that ran.
    void this.mail.sendEmail(to, template, vars).catch((error: unknown) => {
      console.error('[auth] email dispatch failed', error);
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
  }

  private invalidCredentials(): UnauthorizedException {
    // One shared body for both failure modes: unknown address and wrong
    // password are indistinguishable in status, code, message, and bytes.
    return new UnauthorizedException({
      error: {
        code: 'invalid_credentials',
        message: 'The email or password is incorrect.',
        details: {},
      },
    });
  }
}
