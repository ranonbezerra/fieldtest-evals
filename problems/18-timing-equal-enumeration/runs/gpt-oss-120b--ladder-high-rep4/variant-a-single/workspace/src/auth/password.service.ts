import { Injectable, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash!: string;

  async onModuleInit() {
    // Pre‑compute a dummy hash for unknown accounts.
    this.dummyHash = await argon2.hash('dummy', {
      type: argon2.argon2id,
    });
  }

  async hashPassword(password: string): Promise<string> {
    return await argon2.hash(password, { type: argon2.argon2id });
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password, {
        type: argon2.argon2id,
      });
    } catch {
      return false;
    }
  }

  getDummyHash(): string {
    if (!this.dummyHash) {
      // Should never happen because onModuleInit runs first.
      throw new Error('Dummy hash not initialized');
    }
    return this.dummyHash;
  }
}
