import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthRepository } from './auth.repository.js';
import { sendEmail } from '../mail/mail.service.js';

@Injectable()
export class AuthService {
  // Dummy hash used to equalise timing when the fast branch would otherwise skip hashing.
  private readonly dummyHashPromise: Promise<string>;

  constructor(private readonly authRepository: AuthRepository) {
    // Generate a dummy Argon2id hash once at start‑up.
    this.dummyHashPromise = argon2.hash('dummy_password', { type: argon2.argon2id });
  }

  private async getDummyHash(): Promise<string> {
    return this.dummyHashPromise;
  }

  /**
   * Sign‑up flow.
   * - If the e‑mail already exists, we verify the supplied password against a dummy hash
   *   to consume the same amount of CPU time as the hashing path.
   * - In both cases a generic 200 response is returned and an e‑mail is sent out‑of‑band.
   */
  async signUp(email: string, password: string): Promise<void> {
    const existingUser = await this.authRepository.findByEmail(email);
    const dummyHash = await this.getDummyHash();

    if (existingUser) {
      // Equalise timing by performing a dummy verification.
      await argon2.verify(dummyHash, password);
      // Notify the owner – fire‑and‑forget.
      void sendEmail(email, 'sign-up-attempt', {});
    } else {
      // Hash the password for storage.
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      await this.authRepository.createUser(email, passwordHash);
      // Send verification e‑mail – fire‑and‑forget.
      void sendEmail(email, 'verification', {});
    }
    // The controller emits the generic response; nothing else is returned here.
  }

  /**
   * Sign‑in flow.
   * - On success a dummy access token is returned.
   * - On any failure (unknown e‑mail or wrong password) a dummy verification is performed
   *   when the e‑mail is unknown, ensuring identical timing to the wrong‑password case.
   * - A generic 401 error envelope is thrown; it does not reveal which check failed.
   */
  async signIn(email: string, password: string): Promise<{ accessToken: string }> {
    const user = await this.authRepository.findByEmail(email);
    const dummyHash = await this.getDummyHash();

    if (user) {
      const passwordValid = await argon2.verify(user.passwordHash, password);
      if (passwordValid) {
        // In a real system this would be a signed JWT; we return a placeholder.
        return { accessToken: 'dummy-token' };
      }
      // Wrong password – verification already performed, timing is as intended.
    } else {
      // Unknown e‑mail – perform dummy verification to match timing of the wrong‑password path.
      await argon2.verify(dummyHash, password);
    }

    // Generic error response – no indication whether the e‑mail existed.
    throw new HttpException(
      {
        error: {
          code: 'invalid_credentials',
          message: 'Invalid email or password',
          details: {},
        },
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
