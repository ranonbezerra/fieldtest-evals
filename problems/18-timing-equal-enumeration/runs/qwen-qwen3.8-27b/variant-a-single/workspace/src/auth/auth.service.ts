import { Inject, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { AuthRepository } from './auth.repository.js';
import { MAIL_PORT, type MailPort } from '../mail/mail.module.js';

// argon2id with OWASP-recommended interactive parameters (19 MiB, 2 passes,
// parallelism 1). One run costs tens to hundreds of milliseconds, which is
// what makes the branches of each endpoint take the same amount of time.
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

// Every response is held until at least this much time has elapsed, so the
// small residual difference between branches (one of them also inserts a row)
// cannot be observed in response time. It backs up the equal-work rule above;
// it is not a substitute for it.
const MIN_RESPONSE_MS = 250;

export const VERIFICATION_TEMPLATE = 'account-verification';
export const DUPLICATE_SIGN_UP_TEMPLATE = 'duplicate-sign-up-attempt';

const SIGN_UP_ACK = 'If an account can be created for this address, a confirmation email is on its way.';

// ASSUMPTION: the task specifies no token/session mechanism, so a successful
// sign-in answers with a fixed 200 acknowledgement and no credentials.
const SIGN_IN_ACK = 'Signed in.';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private ghostHash = '';

  constructor(
    private readonly repository: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  async onModuleInit(): Promise<void> {
    // argon2id hash of a random secret with exactly the same parameters as
    // real password hashes. Verifying against it costs the same as verifying
    // against a real stored hash, so an unknown address can be checked
    // without revealing its absence.
    this.ghostHash = await argon2.hash(randomBytes(32).toString('base64'), HASH_OPTIONS);
  }

  async signUp(email: string, password: string): Promise<{ message: string }> {
    const startedAt = process.hrtime.bigint();
    const normalized = normalizeEmail(email);
    const existing = await this.repository.findByEmail(normalized);

    if (existing) {
      // Timing-equalizing branch: run the very same argon2id hash that the
      // new-address branch stores, and throw the result away. The response
      // must not depend on it in any way.
      await argon2.hash(password, HASH_OPTIONS);
      this.queueMail(normalized, DUPLICATE_SIGN_UP_TEMPLATE);
    } else {
      const passwordHash = await argon2.hash(password, HASH_OPTIONS);
      let created = true;
      try {
        await this.repository.create({ email: normalized, passwordHash });
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) {
          throw error;
        }
        // Lost a race for the same address: the account now exists, so the
        // owner gets the duplicate-sign-up mail instead of a second
        // verification mail.
        created = false;
      }
      this.queueMail(normalized, created ? VERIFICATION_TEMPLATE : DUPLICATE_SIGN_UP_TEMPLATE);
    }

    await this.padToMinimum(startedAt);
    return { message: SIGN_UP_ACK };
  }

  async signIn(email: string, password: string): Promise<{ message: string }> {
    const startedAt = process.hrtime.bigint();
    const normalized = normalizeEmail(email);
    const user = await this.repository.findByEmail(normalized);

    // Exactly one argon2id run per sign-in: the stored hash when the address
    // exists, the ghost hash when it does not.
    const candidate = user?.passwordHash ?? this.ghostHash;
    const matches = await this.matches(candidate, password);

    await this.padToMinimum(startedAt);

    if (user !== null && matches) {
      return { message: SIGN_IN_ACK };
    }
    throw new UnauthorizedException({
      code: 'invalid_credentials',
      message: 'Email or password is incorrect.',
    });
  }

  private async matches(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  private async padToMinimum(startedAt: bigint): Promise<void> {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const remainingMs = MIN_RESPONSE_MS - elapsedMs;
    if (remainingMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
    }
  }

  // Deliberately fire-and-forget: the caller's response timing must never
  // depend on the mail transport, and a mail failure must never change what
  // the caller observes.
  private queueMail(to: string, template: string): void {
    void this.mail.sendEmail(to, template, { email: to }).catch((error: unknown) => {
      this.logger.error(
        `mail delivery failed (template=${template})`,
        error instanceof Error ? error.stack : String(error),
      );
    });
  }
}
