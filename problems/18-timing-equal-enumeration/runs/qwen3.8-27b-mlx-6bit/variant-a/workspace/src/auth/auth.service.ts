import { Injectable, OnModuleInit } from "@nestjs/common";
import * as argon2 from "argon2";
import { randomBytes } from "node:crypto";

import { AuthRepository } from "./auth.repository";

export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}

export class AuthFailureError extends Error {
  readonly code = "invalid_credentials";

  constructor() {
    super("Invalid credentials.");
  }
}

const ARGON2_PARAMS: argon2.Options = {
  type: argon2.argon2id,
  timeCost: 3,
  memoryCost: 65536,
  parallelism: 1,
};

const TOKEN_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash = "";
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly repo: AuthRepository,
    private readonly mail: MailPort,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash("timing-equalization-dummy", ARGON2_PARAMS);
  }

  async signUp(email: string, password: string): Promise<{ message: string }> {
    const existing = await this.repo.findByEmail(email);

    // Always verify against a real-cost hash to equalise timing across branches.
    const hashToCheck = existing !== null ? existing.passwordHash : this.dummyHash;
    await argon2.verify(hashToCheck, password); // result intentionally discarded

    if (existing === null) {
      const realHash = await argon2.hash(password, ARGON2_PARAMS);
      await this.repo.createUser(email, realHash);
      await this.mail.sendEmail(email, "verification", { email });
    } else {
      await this.repo.touchUser(existing.id);
      await this.mail.sendEmail(email, "sign-up-attempt", { email });
    }

    return { message: "Check your email for next steps." };
  }

  async signIn(email: string, password: string): Promise<{ token: string }> {
    const existing = await this.repo.findByEmail(email);

    // Always verify against a real-cost hash to equalise timing across branches.
    const hashToCheck = existing !== null ? existing.passwordHash : this.dummyHash;
    const valid = await argon2.verify(hashToCheck, password);

    if (existing !== null && valid) {
      const token = randomBytes(32).toString("hex");
      this.tokens.set(existing.id, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
      return { token };
    }

    throw new AuthFailureError();
  }
}
