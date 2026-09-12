import { Inject, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import argon2 from 'argon2';
import { MAIL_PORT, MailPort } from '../mail/mail.port.js';
import { AuthRepository } from './auth.repository.js';

export interface Credentials {
  email: string;
  password: string;
}

export interface SignInResult {
  email: string;
}

// Fixed input for the equalizer hash; never a real password.
const DUMMY_PASSWORD = 'timing-equalizer-dummy-password-000';

const SIGN_UP_TAKEN_TEMPLATE = 'sign-up-taken';
const SIGN_UP_VERIFICATION_TEMPLATE = 'sign-up-verification';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly hashOptions: argon2.Options;
  private dummyHash: Promise<string> | null = null;

  constructor(
    @Inject(AuthRepository) private readonly repository: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {
    // Real cost factors, tunable via the environment, identical for every
    // hash and every verify in the system.
    this.hashOptions = {
      type: argon2.argon2id,
      memoryCost: readPositiveInt('PASSWORD_HASH_MEMORY_KB', 65536),
      timeCost: readPositiveInt('PASSWORD_HASH_TIME_COST', 3),
      parallelism: readPositiveInt('PASSWORD_HASH_PARALLELISM', 2),
    };
  }

  async onModuleInit(): Promise<void> {
    // Build the equalizer hash at boot so no request ever pays its one-off cost.
    await this.getDummyHash();
  }

  // The response is deliberately identical for a new address and a taken one;
  // the only branch-specific effect is which mail goes out, and that is never
  // awaited.
  async signUp(credentials: Credentials): Promise<void> {
    const { email, password } = credentials;
    const existing = await this.repository.findByEmail(email);
    if (existing) {
      // Spend the same argon2 work the create path spends (hash vs. verify at
      // identical parameters), so the two branches take the same time.
      await this.verifyAgainstDummy(password);
      this.dispatch(email, SIGN_UP_TAKEN_TEMPLATE, { email });
      return;
    }
    const passwordHash = await argon2.hash(password, this.hashOptions);
    const { created } = await this.repository.createOrReturnExisting(email, passwordHash);
    this.dispatch(email, created ? SIGN_UP_VERIFICATION_TEMPLATE : SIGN_UP_TAKEN_TEMPLATE, { email });
  }

  // An unknown address and a wrong password both cost exactly one argon2id
  // verify and both fail with the same 401, so neither the bytes nor the time
  // reveals which one happened.
  async signIn(credentials: Credentials): Promise<SignInResult> {
    const { email, password } = credentials;
    const user = await this.repository.findByEmail(email);
    if (!user) {
      await this.verifyAgainstDummy(password);
      throw new UnauthorizedException('Invalid email or password.');
    }
    const matches = await argon2.verify(password, user.passwordHash).catch(() => false);
    if (!matches) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    return { email: user.email };
  }

  // One argon2id verify at exactly the cost of a real verify/hash. The result
  // is discarded; only the time it takes matters.
  private verifyAgainstDummy(password: string): Promise<boolean> {
    return this.getDummyHash()
      .then((dummy) => argon2.verify(password, dummy))
      .catch(() => false);
  }

  private getDummyHash(): Promise<string> {
    if (this.dummyHash === null) {
      this.dummyHash = argon2.hash(DUMMY_PASSWORD, this.hashOptions).catch((error: unknown) => {
        this.dummyHash = null;
        throw error;
      });
    }
    return this.dummyHash!;
  }

  // Fire-and-forget: mail latency can never appear in the response time, and a
  // failing mailer can never change what the caller observes.
  private dispatch(to: string, template: string, vars: Record<string, string>): void {
    void this.mail.sendEmail(to, template, vars).catch((error: unknown) => {
      this.logger.error(`mail send failed (template=${template}): ${String(error)}`);
    });
  }
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
