import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import argon2 from 'argon2';
import { AuthRepository } from './auth.repository.ts';
import { MAILER_TOKEN, MailerPort } from '../mailer/mailer.token.ts';
import { ARGON2_CONFIG, DUMMY_PASSWORD } from './argon2.config.ts';

export interface SignUpResult {
  status: 'created' | 'exists';
  message: string;
}

export interface SignInResult {
  success: boolean;
  message: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHashPromise: Promise<string>;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly authRepository: AuthRepository,
    @Inject(MAILER_TOKEN) private readonly mailer: MailerPort,
  ) {
    this.dummyHashPromise = argon2.hash(DUMMY_PASSWORD, ARGON2_CONFIG);
  }

  async onModuleInit(): Promise<void> {
    await this.dummyHashPromise;
  }

  async signUp(email: string, password: string): Promise<SignUpResult> {
    const hashedPassword = await argon2.hash(password, ARGON2_CONFIG);

    const existing = await this.authRepository.findByEmail(email);

    if (existing) {
      this.fireAndForgetEmail(email, 'signup-attempt-notify', { email });
      return { status: 'exists', message: 'If this address is registered you will receive a notification.' };
    }

    await this.authRepository.create(email, hashedPassword);
    this.fireAndForgetEmail(email, 'verify-email', { email });
    return { status: 'created', message: 'If this address is registered you will receive a notification.' };
  }

  async signIn(email: string, password: string): Promise<SignInResult> {
    const user = await this.authRepository.findByEmail(email);

    if (user) {
      const valid = await argon2.verify(user.passwordHash, password);
      if (valid) {
        return { success: true, message: 'Signed in successfully.' };
      }
      return { success: false, message: 'Invalid credentials.' };
    }

    await argon2.verify(await this.dummyHashPromise, password);
    return { success: false, message: 'Invalid credentials.' };
  }

  private fireAndForgetEmail(to: string, template: string, vars: Record<string, unknown>): void {
    this.mailer.sendEmail(to, template, vars).catch((err: unknown) => {
      this.logger.warn(`Out-of-band email failed (non-blocking): ${(err as Error)?.message ?? err}`);
    });
  }
}
