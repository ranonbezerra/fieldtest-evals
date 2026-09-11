import { Injectable } from '@nestjs/common';
import { argon2id, verify as argon2Verify } from '@node-rs/argon2';

/**
 * Port for password hashing. Equalisation depends on hash() and verify()
 * costing the same, so any implementation must keep that property.
 */
export abstract class PasswordHasher {
  abstract hash(plain: string): Promise<string>;
  abstract verify(stored: string, plain: string): Promise<boolean>;
}

export interface Argon2Params {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/**
 * Production parameters: the OWASP-recommended argon2id floor (19 MiB, 2
 * iterations, 1 lane). The cost is deliberate; it is the work that makes the
 * equalised branches slow enough to matter.
 */
export const PRODUCTION_ARGON2_PARAMS: Argon2Params = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class Argon2idHasher extends PasswordHasher {
  constructor(private readonly params: Argon2Params = PRODUCTION_ARGON2_PARAMS) {
    super();
  }

  async hash(plain: string): Promise<string> {
    return argon2id(plain, this.params);
  }

  async verify(stored: string, plain: string): Promise<boolean> {
    try {
      return await argon2Verify(stored, plain);
    } catch {
      // A malformed stored hash can never match; answer like a mismatch.
      return false;
    }
  }
}
