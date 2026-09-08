import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { AuthRepository } from './auth.repository';
import * as argon2 from 'argon2';
import { sendEmail } from '../mail/mail.service';

// Pre‑computed dummy hash (argon2id, cost factor similar to production)
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

@Injectable()
export class AuthService {
  constructor(private readonly repository: AuthRepository) {}

  /**
   * Sign‑up flow that does not reveal whether the e‑mail already exists.
   * The observable response is identical for both branches and the timing
   * is equalised by always performing the same expensive operations.
   */
  async signUp(email: string, password: string): Promise<void> {
    // Always hash the incoming password – same cost for both branches
    const passwordHashPromise = argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 2,
      parallelism: 1,
    });

    // Look up the user (may be null)
    const existingUser = await this.repository.findByEmail(email);

    // If the user exists, we still verify the password against a dummy hash
    // to keep the timing the same.
    const dummyVerification = argon2.verify(DUMMY_PASSWORD_HASH, password).catch(
      () => false,
    );

    // Await both the hash and the dummy verification to equalise timing.
    const [passwordHash] = await Promise.all([passwordHashPromise, dummyVerification]);

    if (!existingUser) {
      // Create the new user
      await this.repository.createUser(email, passwordHash);
      // Send verification email
      await sendEmail(email, 'verify-email', { email });
    } else {
      // Send "someone tried to sign up" email
      await sendEmail(email, 'signup-attempt', { email });
    }
    // No return value – controller builds the generic response.
  }

  /**
   * Sign‑in flow with constant‑time behaviour.
   */
  async signIn(email: string, password: string): Promise<boolean> {
    // Look up user; may be null
    const user = await this.repository.findByEmail(email);

    // Always perform a verification against a hash.
    // If user exists, verify against the real hash; otherwise, verify against dummy.
    const hashToVerify = user ? user.password_hash : DUMMY_PASSWORD_HASH;

    const passwordMatches = await argon2
      .verify(hashToVerify, password)
      .catch(() => false);

    // If the user exists and password matches, authentication succeeds.
    // Otherwise, we still return false after the same amount of work.
    return user ? passwordMatches : false;
  }
}
