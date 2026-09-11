import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { hash, verify, types } from '@node-rs/argon2';
import { ApiException } from '../common/api-error.js';
import { AuthRepository } from './auth.repository.js';
import { MAIL_PORT, type MailPort } from './mail.port.js';

/**
 * Canonical KDF parameters. Every argon2 call in this service — stored hashes
 * and the decoy — uses exactly these, so no code path can perform a different
 * amount of KDF work than any other.
 */
const KDF_PARAMS = {
  type: types.Argon2.Argon2id,
  memoryCost: 65_536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
  outputLength: 32,
} as const;

// The decoy's plaintext is public and irrelevant: its value is that verifying
// against it costs a full argon2id run, not that it is secret.
const DUMMY_SEED = 'timing-equalization-decoy';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash!: string;

  constructor(
    @Inject(AuthRepository) private readonly users: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash(DUMMY_SEED, KDF_PARAMS);
  }

  async signUp(email: string, password: string): Promise<{ status: string }> {
    const normalized = this.normalizeEmail(email);

    // Timing equalisation: both outcomes perform exactly one argon2id run with
    // KDF_PARAMS. A new address needs the hash to store it; an existing
    // address pays the identical cost because the insert below fails on the
    // unique constraint and the hash is discarded. The branch with nothing to
    // check does not skip the work — it throws the result away.
    const passwordHash = await hash(password, KDF_PARAMS);
    const { created } = await this.users.createIfAbsent(normalized, passwordHash);

    // The real outcome reaches the owner out of band: the send is fired, its
    // errors are swallowed, and nothing on the response path awaits it, so a
    // mail failure changes nothing the caller observes.
    this.notifyOwner(normalized, created ? 'account-verification' : 'sign-up-attempt');

    return { status: 'ok' };
  }

  async signIn(email: string, password: string): Promise<{ status: string }> {
    const normalized = this.normalizeEmail(email);
    const user = await this.users.findByEmail(normalized);

    // Timing equalisation: an unknown address has no stored hash to check, so
    // it verifies against a decoy hash built at startup with identical
    // parameters. Both branches execute exactly one argon2id run.
    const target: string = user ? user.passwordHash : this.dummyHash;
    let verified = false;
    try {
      verified = await verify(target, password);
    } catch {
      verified = false; // malformed hash or argon2 failure: treat as mismatch
    }

    if (!verified) {
      throw new ApiException(401, 'invalid_credentials', 'Email or password is incorrect.');
    }
    return { status: 'ok' };
  }

  private notifyOwner(to: string, template: string): void {
    this.mail.sendEmail(to, template, { email: to }).catch((error: unknown) => {
      // Deliberate: delivery failures are invisible to the caller by design.
      // (A production port would also log or metric the failure internally.)
      void error;
    });
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
