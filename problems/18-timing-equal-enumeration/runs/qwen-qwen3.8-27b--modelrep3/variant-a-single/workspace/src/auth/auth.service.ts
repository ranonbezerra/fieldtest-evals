import {
  Inject,
  Injectable,
  UnauthorizedException,
  type OnModuleInit,
} from '@nestjs/common';
import argon2 from 'argon2';
import { MAIL_PORT, type MailPort } from '../mail/mail.port.js';
import { AuthRepository } from './auth.repository.js';

// Real cost factor (OWASP-recommended scale): 64 MiB, 3 passes, 4 lanes.
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

const DUMMY_PASSWORD = 'timing-equalization-dummy-password';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash = '';

  constructor(
    @Inject(AuthRepository) private readonly repository: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  async onModuleInit(): Promise<void> {
    // Built with the same cost parameters as every real hash, so verifying
    // against it takes the same time as verifying against a stored hash.
    this.dummyHash = await argon2.hash(DUMMY_PASSWORD, HASH_OPTIONS);
  }

  async signUp(rawEmail: string, password: string): Promise<{ status: string }> {
    const email = this.normalizeEmail(rawEmail);

    // Every sign-up pays the same argon2id cost whether or not the address
    // already exists. The hash is only stored when the address is new.
    const passwordHash = await argon2.hash(password, HASH_OPTIONS);

    const existing = await this.repository.findByEmail(email);
    if (existing) {
      // One write in this branch too (an insert in the other), so the two
      // branches cannot be told apart by their database cost either.
      await this.repository.touch(existing.id);
      await this.mail.sendEmail(existing.email, 'sign_up_attempt', { email });
      return { status: 'accepted' };
    }

    // false means a concurrent sign-up won the insert; the response is the
    // same either way, so the race cannot be observed.
    const created = await this.repository.createAccount(email, passwordHash);
    await this.mail.sendEmail(email, created ? 'verify_email' : 'sign_up_attempt', { email });

    return { status: 'accepted' };
  }

  async signIn(rawEmail: string, password: string): Promise<{ status: string }> {
    const email = this.normalizeEmail(rawEmail);
    const account = await this.repository.findByEmail(email);

    // argon2.verify derives its cost from the hash itself, so verifying
    // against the dummy hash takes the same time as verifying against a
    // stored one.
    const passwordMatches = await this.verifyPassword(
      password,
      account ? account.passwordHash : this.dummyHash,
    );

    if (!account || !passwordMatches) {
      throw new UnauthorizedException({
        error: {
          code: 'invalid_credentials',
          message: 'Invalid email or password.',
          details: {},
        },
      });
    }

    return { status: 'authenticated' };
  }

  private normalizeEmail(rawEmail: string): string {
    return rawEmail.trim().toLowerCase();
  }

  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // A malformed hash is treated as a mismatch: same branch, same response.
      return false;
    }
  }
}
