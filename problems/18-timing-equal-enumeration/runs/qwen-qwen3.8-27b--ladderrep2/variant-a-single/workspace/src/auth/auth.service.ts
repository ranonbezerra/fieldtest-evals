import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { AppException } from '../common/app.exception.js';
import { MAIL_PORT, MailPort } from '../mail/mail.port.js';
import { AuthRepository } from './auth.repository.js';

/**
 * One argon2id derivation at a real cost is the unit of work every request pays,
 * regardless of branch. Parameters follow the OWASP cheat sheet (19 MiB, 2 rounds,
 * parallelism 1), which lands in the tens-to-hundreds-of-milliseconds range.
 */
export const ARGON2_PARAMS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const DUMMY_PASSWORD = 'timing-equalization-dummy-password';

const ttlFromEnv = Number(process.env.SESSION_TTL_SECONDS ?? 900);
const SESSION_TTL_SECONDS = Number.isFinite(ttlFromEnv) && ttlFromEnv > 0 ? ttlFromEnv : 900;

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

@Injectable()
export class AuthService {
  private dummyHashPromise: Promise<string> | undefined;

  constructor(
    @Inject(AuthRepository) private readonly users: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  /**
   * Pre-compute the dummy hash at startup so the first request on either branch
   * pays exactly one derivation, not two.
   */
  onModuleInit(): void {
    void this.dummyHash().catch(() => undefined);
  }

  /**
   * A hash built with the same parameters as ARGON2_PARAMS. Verifying against it
   * costs exactly what verifying against a real stored hash costs.
   */
  private dummyHash(): Promise<string> {
    this.dummyHashPromise ??= argon2.hash(DUMMY_PASSWORD, ARGON2_PARAMS).catch((err: unknown) => {
      this.dummyHashPromise = undefined; // allow a retry on the next call
      throw err;
    });
    return this.dummyHashPromise;
  }

  /**
   * The response is identical for new and existing addresses on purpose: the
   * outcome is revealed only out of band, to the owner.
   */
  async signUp(email: string, password: string): Promise<{ status: 'ok' }> {
    const address = normalizeEmail(email);
    const existing = await this.users.findByEmail(address);
    if (existing !== null) {
      // Nothing to store on this branch, so pay the identical cost anyway: one
      // verify against the dummy hash at the same parameters as the store-side hash.
      await this.payHashCost(password);
      this.deliver(address, 'sign_up_attempt');
    } else {
      const passwordHash = await argon2.hash(password, ARGON2_PARAMS);
      const created = await this.users.create(address, passwordHash);
      // created === false means a concurrent sign-up won the unique constraint:
      // the address is effectively existing now.
      this.deliver(address, created ? 'verification_email' : 'sign_up_attempt');
    }
    return { status: 'ok' };
  }

  async signIn(email: string, password: string): Promise<{ token: string }> {
    const address = normalizeEmail(email);
    const user = await this.users.findByEmail(address);
    let authenticated = false;
    if (user !== null) {
      authenticated = await argon2
        .verify(password, user.passwordHash)
        .then((ok) => ok === true)
        .catch(() => false);
    } else {
      // Unknown address: run the same cost against the dummy hash instead of
      // returning early, then fail exactly like a wrong password does.
      await this.payHashCost(password);
    }
    if (!authenticated || user === null) {
      throw new AppException(401, 'invalid_credentials', 'Invalid email or password.', {});
    }
    const secret = process.env.JWT_SECRET;
    if (secret === undefined || secret === '') {
      throw new AppException(500, 'internal_error', 'JWT_SECRET is not configured.', {});
    }
    const token = jwt.sign({ sub: user.id }, secret, { expiresIn: SESSION_TTL_SECONDS });
    return { token };
  }

  /**
   * Pay exactly one derivation at the real cost without storing or comparing
   * anything. The result is deliberately discarded.
   */
  private payHashCost(password: string): Promise<void> {
    return this.dummyHash()
      .then((hash) => argon2.verify(password, hash))
      .then(() => undefined)
      .catch(() => undefined);
  }

  /**
   * Mail is out of band: nothing on the response path awaits the delivery, and a
   * failure must change nothing the caller observes.
   */
  private deliver(to: string, template: string): void {
    void this.mail.sendEmail(to, template, { email: to }).catch(() => undefined);
  }
}
