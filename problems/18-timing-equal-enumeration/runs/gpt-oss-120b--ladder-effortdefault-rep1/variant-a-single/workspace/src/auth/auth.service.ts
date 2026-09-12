import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthRepository } from './auth.repository.js';

// ASSUMPTION: a mailer utility exists at the given path
import { sendEmail } from '../mailer.js';

@Injectable()
export class AuthService {
  private readonly dummyHashPromise: Promise<string>;

  constructor(private readonly repo: AuthRepository) {
    // Dummy hash used for timing equalisation in sign‑in when the user does not exist
    this.dummyHashPromise = argon2.hash('dummy_password', {
      type: argon2.argon2id,
    });
  }

  /**
   * Sign‑up endpoint – creates a new account when the e‑mail is unknown.
   * Regardless of existence the same amount of work (password hashing) is performed
   * and the same HTTP response is sent.
   */
  async signUp(email: string, password: string): Promise<void> {
    // The hash is always computed – this is the equal‑work primitive.
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
    });

    const existing = await this.repo.findByEmail(email);
    if (!existing) {
      await this.repo.createUser(email, passwordHash);
      // Out‑of‑band email – errors must not affect the HTTP response.
      void sendEmail(email, 'verification', {});
    } else {
      // Existing address – still performed the same hash above.
      void sendEmail(email, 'signup-attempt', {});
    }
  }

  /**
   * Sign‑in endpoint – returns a token on success.
   * Wrong password and unknown e‑mail both take the same amount of time.
   */
  async signIn(email: string, password: string): Promise<string> {
    const user = await this.repo.findByEmail(email);
    if (!user) {
      const dummyHash = await this.dummyHashPromise;
      // Verify against dummy hash to spend the same time as a real verification.
      await argon2.verify(dummyHash, password);
      throw new Error('Invalid credentials');
    }

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      throw new Error('Invalid credentials');
    }

    // In a real system a JWT or session token would be generated.
    // Here we return a deterministic placeholder.
    return 'placeholder-token';
  }
}
