// ASSUMPTION: The 'argon2' native package does not resolve its type declarations in this workspace;
//             the API surface used (hash, verify, argon2id) is known from the plan and upstream docs.
// @ts-ignore
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
// ASSUMPTION: './auth.repository' cannot be resolved at compile time because its own dependency
//             ('../prisma/prisma.service') is missing; the class and method signatures are taken from the plan.
// @ts-ignore
import { AuthRepository } from './auth.repository';

const ARGON2_PARAMS = {
  type: argon2.argon2id as number,
  timeCost: 3,
  memoryCost: 65536,
  parallelism: 1,
} as const;

export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}

export const MAIL_PORT = 'MAIL_PORT';

export class AuthFailureError extends Error {
  readonly code = 'invalid_credentials' as const;

  constructor() {
    super('Invalid credentials.');
  }
}

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash = '';
  private readonly tokens = new Map<string, number>();

  constructor(
    private readonly repo: AuthRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash('timing-equalization-dummy', ARGON2_PARAMS);
  }

  async signUp(email: string, password: string): Promise<{ message: string }> {
    const existing = await this.repo.findByEmail(email);

    // Always run argon2 verify to equalise timing between the two branches.
    const hashToCheck = existing ? existing.passwordHash : this.dummyHash;
    await argon2.verify(hashToCheck, password);

    if (existing === null) {
      const realHash = await argon2.hash(password, ARGON2_PARAMS);
      await this.repo.createUser(email, realHash);
      await this.mail.sendEmail(email, 'verification', { email });
    } else {
      await this.repo.touchUser(existing.id);
      await this.mail.sendEmail(email, 'sign-up-attempt', { email });
    }

    return { message: 'Check your email for next steps.' };
  }

  async signIn(email: string, password: string): Promise<{ token: string }> {
    const existing = await this.repo.findByEmail(email);

    // Always run argon2 verify to equalise timing between the two branches.
    const hashToCheck = existing ? existing.passwordHash : this.dummyHash;
    const valid = await argon2.verify(hashToCheck, password);

    if (existing !== null && valid) {
      const token = randomUUID();
      this.tokens.set(token, Date.now() + 15 * 60 * 1000);
      return { token };
    }

    throw new AuthFailureError();
  }
}
