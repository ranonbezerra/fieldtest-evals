import { Inject, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { AuthRepository, EmailAlreadyExistsError } from './auth.repository.js';
import { PasswordHasher } from './password-hash.js';

/** The mail port the feature needs. */
export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}

/** Injection token for the mail port. */
export const MAIL_PORT = 'MAIL_PORT';

export interface SignUpResult {
  status: 'accepted';
  message: string;
}

export interface SignInResult {
  status: 'authenticated';
  email: string;
}

const DUMMY_PASSWORD = 'dummy-password-for-timing-equalisation';

const SIGN_UP_MESSAGE = 'Your request was accepted. If this address is new, a verification email is on its way.';

const SIGN_IN_FAILURE = {
  error: {
    code: 'authentication_failed',
    message: 'The email or password is incorrect.',
    details: {},
  },
};

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private dummyHash = '';

  constructor(
    @Inject(AuthRepository) private readonly repository: AuthRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  /**
   * Build the dummy hash at boot with the identical parameters that real
   * account hashes carry. The unknown-address branch of sign-in verifies
   * against it, so every sign-in spends one full argon2id operation.
   */
  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hasher.hash(DUMMY_PASSWORD);
  }

  async signUp(email: string, password: string): Promise<SignUpResult> {
    const existing = await this.repository.findByEmail(email);

    if (existing) {
      // No account is created here, but the hash cost is still paid: the
      // supplied password is verified against the stored one. Only the work
      // matters; the result is discarded.
      await this.hasher.verify(existing.passwordHash, password);
      this.deliver(email, 'sign-up-attempt-alert');
    } else {
      const passwordHash = await this.hasher.hash(password);
      try {
        await this.repository.create(email, passwordHash);
        this.deliver(email, 'sign-up-verification');
      } catch (err) {
        if (err instanceof EmailAlreadyExistsError) {
          // A concurrent request created the account first. Same single hash
          // op, same response, same branch of behaviour.
          this.deliver(email, 'sign-up-attempt-alert');
        } else {
          throw err;
        }
      }
    }

    return { status: 'accepted', message: SIGN_UP_MESSAGE };
  }

  async signIn(email: string, password: string): Promise<SignInResult> {
    const user = await this.repository.findByEmail(email);

    if (user) {
      const authenticated = await this.hasher.verify(user.passwordHash, password);
      if (!authenticated) {
        throw new UnauthorizedException(SIGN_IN_FAILURE);
      }
      return { status: 'authenticated', email };
    }

    // Unknown address: verify against the dummy hash so this branch takes
    // exactly as long as a real check. The result is always discarded; an
    // unknown address never authenticates, even if the password happened to
    // match the dummy.
    await this.hasher.verify(this.dummyHash, password);
    throw new UnauthorizedException(SIGN_IN_FAILURE);
  }

  /**
   * Out-of-band delivery. The response path never awaits this promise, so a
   * slow or failing mailer cannot change the status, body, or time of the
   * response the caller observes.
   */
  private deliver(to: string, template: string): void {
    void this.mail.sendEmail(to, template, { email: to }).catch((err: unknown) => {
      this.logger.error(
        `Mail delivery failed (to=${to}, template=${template}): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
}
