import { Injectable } from '@nestjs/common';
import { AuthRepository } from './auth.repository.js';
import { PasswordService } from './password.service.js';
import { InvalidCredentialsException } from './invalid-credentials.exception.js';
import { sendEmail } from '../mail.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly passwordService: PasswordService,
  ) {}

  async signUp(email: string, password: string): Promise<void> {
    const normalizedEmail = email.toLowerCase();

    // Start hashing immediately – both branches must pay the cost.
    const hashPromise = this.passwordService.hashPassword(password);

    // Determine whether the address already exists.
    const existingUser = await this.authRepository.findByEmail(
      normalizedEmail,
    );

    // Await the hash to equalise timing.
    const passwordHash = await hashPromise;

    if (!existingUser) {
      // New address – create the account.
      await this.authRepository.createUser(normalizedEmail, passwordHash);
      // Verification email (out‑of‑band).
      sendEmail(normalizedEmail, 'verification', {}).catch(() => {});
    } else {
      // Existing address – inform the owner.
      sendEmail(normalizedEmail, 'signup-notification', {}).catch(() => {});
    }
    // The controller sends a generic response; nothing else is awaited.
  }

  async signIn(email: string, password: string): Promise<string> {
    const normalizedEmail = email.toLowerCase();

    const user = await this.authRepository.findByEmail(normalizedEmail);
    const hash = user
      ? user.passwordHash
      : this.passwordService.getDummyHash();

    // Verification is performed in all cases.
    const isValid = await this.passwordService.verifyPassword(
      password,
      hash,
    );

    if (user && isValid) {
      // Successful authentication – token generation is out of scope.
      return 'dummy-token';
    }

    // Wrong password or unknown address – identical error.
    throw new InvalidCredentialsException();
  }
}
