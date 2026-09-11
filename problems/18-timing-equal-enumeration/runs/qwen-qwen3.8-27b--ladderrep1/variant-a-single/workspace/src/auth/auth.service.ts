import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { MAIL_PORT, type MailPort } from '../mail/mail.port.js';
import { AuthRepository } from './auth.repository.js';

/**
 * argon2id at a real cost factor (32 MiB, 2 passes, parallelism 1; OWASP's
 * current floor is 19 MiB / 2 passes). The cost is deliberate: it is the
 * work both branches must perform, so no branch can be cheaper than the other.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 32_768,
  timeCost: 2,
  parallelism: 1,
};

// Public by design. Its only purpose is to burn one full hash's worth of time
// on the sign-in branch that has no stored hash to verify.
const DUMMY_PLAINTEXT = 'timing-equalisation-dummy';

export type SignUpOutcome = { result: 'accepted' };
export type SignInOutcome = { result: 'signed-in' } | { result: 'rejected' };

@Injectable()
export class AuthService {
  // Precomputed once per process with the same parameters as real hashes, so
  // verifying against it takes the same time as verifying a real one.
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly repository: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {
    this.dummyHash = argon2.hash(DUMMY_PLAINTEXT, ARGON2_OPTIONS);
  }

  async signUp(email: string, password: string): Promise<SignUpOutcome> {
    // Both branches pay one argon2 hash before the branch even exists: a new
    // address stores it, an existing address discards it. No branch can skip
    // the work, so no branch is faster.
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

    const existing = await this.repository.findByEmail(email);
    if (existing) {
      this.deliver(email, 'signup-attempted');
      return { result: 'accepted' };
    }

    const created = await this.repository.createIfAbsent(email, passwordHash);
    // The race loser (a concurrent sign-up between the lookup and the insert)
    // must observe and report the same outcome as a plain lookup miss.
    this.deliver(email, created ? 'verify-account' : 'signup-attempted');
    return { result: 'accepted' };
  }

  async signIn(email: string, password: string): Promise<SignInOutcome> {
    const user = await this.repository.findByEmail(email);
    // Unknown address: verify against the dummy hash — identical parameters,
    // identical cost, and the same (false) result as a wrong password.
    const storedHash = user ? user.passwordHash : await this.dummyHash;
    const verified = await argon2.verify(storedHash, password).catch(() => false);
    return user && verified ? { result: 'signed-in' } : { result: 'rejected' };
  }

  private deliver(to: string, template: string): void {
    // Out of band: the send is never awaited by the response path, so a slow
    // or failing mail transport changes nothing the caller observes.
    void this.mail.sendEmail(to, template, { email: to }).catch(() => undefined);
  }
}
