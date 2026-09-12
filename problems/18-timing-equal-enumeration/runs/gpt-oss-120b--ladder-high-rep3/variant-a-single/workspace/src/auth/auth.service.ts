import {
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthRepository } from './auth.repository.js';
import { sendEmail } from '../email/email.service.js';
import { InvalidCredentialsException } from './invalid-credentials.exception.js';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash!: string;

  constructor(private readonly authRepository: AuthRepository) {}

  async onModuleInit() {
    // Pre‑compute a dummy hash once so that the unknown‑email branch has the
    // same cryptographic workload as the known‑email branch.
    this.dummyHash = await argon2.hash('dummy_password', {
      type: argon2.argon2id,
    });
  }

  async signUp(email: string, password: string): Promise<void> {
    // Always hash the supplied password – this equalises the time spent
    // regardless of whether the address already exists.
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
    });

    const existingUser = await this.authRepository.findByEmail(email);
    if (existingUser) {
      // Existing address – notify the owner without revealing anything.
      void sendEmail(email, 'signup-attempt', {});
    } else {
      // New address – create the account and send verification.
      await this.authRepository.createUser(email, passwordHash);
      void sendEmail(email, 'verify-email', {});
    }
    // The controller returns a generic success message.
  }

  async signIn(email: string, password: string): Promise<{ token: string }> {
    const user = await this.authRepository.findByEmail(email);
    let passwordMatches = false;

    if (user) {
      // Verify the supplied password against the stored hash.
      passwordMatches = await argon2.verify(user.passwordHash, password);
    } else {
      // Verify against the pre‑computed dummy hash to keep timing identical.
      passwordMatches = await argon2.verify(this.dummyHash, password);
    }

    if (!passwordMatches) {
      // Generic error – does not reveal whether the address exists.
      throw new InvalidCredentialsException();
    }

    // Authentication succeeded. In a real system a JWT would be issued.
    return { token: 'dummy-token' };
  }
}
