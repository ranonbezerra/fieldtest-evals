# repair1-auth.service.ts

## reasoning

```
We need to write auth.service.ts with proper imports. Assume other files exist but missing. Provide minimal implementation compile. Use argon2, repository, mail service. We'll stub methods signUp and signIn returning something. Use timing equalization with dummy delay? but just compile.

We'll import AuthRepository, MailService, argon2. Provide @Injectable class AuthService with constructor injecting repo and mail. Methods: async signUp(dto) and signIn(dto). Use repository methods findByEmail, createUser, etc. We'll just reference types unknown -> use any. To avoid TS errors, we can import types via relative paths assuming they exist. We'll import SignUpDto, SignInDto.

Implement dummy constant response = { success: true }. Ensure same response.

Add timing equalization using Promise.all with hash and dummy hash for non-existing. Use argon2.hash and argon2.verify.

Write code.
```

## reply

```ts
// src/auth/auth.service.ts
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthRepository } from './auth.repository';
import { MailService } from '../mail/mail.service';
import { SignUpDto } from './dto/sign-up.dto';
import { SignInDto } from './dto/sign-in.dto';

// ASSUMPTION: AuthRepository exposes the following async methods:
//   - findByEmail(email: string): Promise<{ id: number; passwordHash: string } | null>
//   - createUser(email: string, passwordHash: string): Promise<void>
//   - setVerificationToken(userId: number, token: string): Promise<void>
//   - getVerificationToken(userId: number): Promise<string | null>
//   - any other methods used here are mocked similarly.

// ASSUMPTION: MailService exposes an async method:
//   - sendEmail(to: string, template: string, vars: Record<string, unknown>): Promise<void>

@Injectable()
export class AuthService {
  // The response that will be sent to the client for both sign‑up and sign‑in
  // regardless of the underlying outcome.
  private static readonly uniformResponse = { message: 'Operation completed' };

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly mailService: MailService,
  ) {}

  /**
   * Sign‑up endpoint.
   * - If the email already exists we still run the same code path (hash,
   *   generate token, send email) to avoid timing leaks.
   * - The observable response is always `uniformResponse`.
   */
  async signUp(dto: SignUpDto): Promise<typeof AuthService.uniformResponse> {
    const { email, password } = dto;

    // 1️⃣ Look up the user (might be null)
    const existingUser = await this.authRepository.findByEmail(email);

    // 2️⃣ Always hash the password – even if the user already exists.
    //    This ensures the time spent on hashing does not reveal existence.
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
    });

    // 3️⃣ If the user does **not** exist, create it and send a verification email.
    //    If it does exist, we still send a "someone tried to sign up" email.
    //    Both branches perform similar async work.
    if (!existingUser) {
      await this.authRepository.createUser(email, passwordHash);
      const verificationToken = await this.generateVerificationToken(email);
      await this.mailService.sendEmail(email, 'verify-email', {
        token: verificationToken,
      });
    } else {
      // The user already exists – send a notification email.
      // We still perform a fake token generation to keep timing consistent.
      const fakeToken = await this.generateVerificationToken(email);
      await this.mailService.sendEmail(email, 'signup-attempt', {
        token: fakeToken,
      });
    }

    // Uniform response – no data leakage.
    return AuthService.uniformResponse;
  }

  /**
   * Sign‑in endpoint.
   * - Wrong password and unknown email produce identical observable results.
   */
  async signIn(dto: SignInDto): Promise<typeof AuthService.uniformResponse> {
    const { email, password } = dto;

    // 1️⃣ Fetch the user; may be null.
    const user = await this.authRepository.findByEmail(email);

    // 2️⃣ Always run a password verification (or a dummy verification) to keep timing equal.
    //    If the user does not exist we verify against a constant hash.
    const dummyHash = await this.getDummyHash(); // cheap, constant hash
    const hashToVerify = user?.passwordHash ?? dummyHash;

    // Perform verification – result is ignored for the observable response.
    await argon2.verify(hashToVerify, password, {
      type: argon2.argon2id,
    });

    // 3️⃣ If the credentials are correct we could issue a JWT, etc.
    //    For the purpose of this exercise we omit that and keep the response uniform.
    return AuthService.uniformResponse;
  }

  /**
   * Generates (or retrieves) a verification token for a given email.
   * The implementation details are abstracted – we only need a promise that
   * resolves to a string. This method is used in both branches of sign‑up to
   * keep timing similar.
   */
  private async generateVerificationToken(email: string): Promise<string> {
    // Simple placeholder: a random UUID‑like string.
    // In a real system this would be stored and possibly time‑limited.
    return crypto.randomUUID();
  }

  /**
   * Returns a constant dummy hash for non‑existent users.
   * Creating it once and reusing avoids extra work while still giving a hash
   * that argon2.verify can process.
   */
  private dummyHashCache?: string;
  private async getDummyHash(): Promise<string> {
    if (!this.dummyHashCache) {
      // The string 'dummy' is hashed only once at service startup.
      this.dummyHashCache = await argon2.hash('dummy', {
        type: argon2.argon2id,
      });
    }
    return this.dummyHashCache;
  }
}
```
