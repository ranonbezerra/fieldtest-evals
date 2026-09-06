# 08-auth.service.ts

## reasoning

```
Let me analyze the plan carefully to write `src/auth/auth.service.ts`.

From the plan:

**Types and signatures section:**
```ts
export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly mail: MailPort,
  ) {}

  signUp(email: string, password: string): Promise<{ message: string }>;
  signIn(email: string, password: string): Promise<{ token: string }>
    // throws AuthFailureError on wrong-password OR unknown-email (indistinguishable)
}

export class AuthFailureError extends Error {
  readonly code = "invalid_credentials";
  constructor();
}
```

**Control flow for sign-up:**
1. SELECT `findByEmail(email)` → `existing`
2. Always execute `argon2.verify(dto.password, hashToCheck)`:
   - If `existing` non-null: `hashToCheck = existing.passwordHash`
   - Otherwise: `hashToCheck = DUMMY_HASH`
   - Verify result is **discarded** in both branches.
3. Branch:
   - If `existing` is null:
     a. Hash: `realHash = await argon2.hash(dto.password)` (same params)
     b. `repo.createUser(email, realHash)`
     c. `mail.sendEmail(email, "verification", { email })`
   - If `existing` is non-null:
     a. `repo.touchUser(existing.id)` (no-op write)
     b. `mail.sendEmail(email, "sign-up-attempt", { email })`
4. Return `200 { "message": "Check your email for next steps." }`

**Control flow for sign-in:**
1. SELECT `findByEmail(email)` → `existing`
2. Always execute `argon2.verify(dto.password, hashToCheck)`:
   - If `existing` non-null: `hashToCheck = existing.passwordHash`
   - Otherwise: `hashToCheck = DUMMY_HASH`
3. Branch:
   - If `existing` non-null AND verify returned `true`: create opaque token, store in in-memory map, return `{ token }`
   - Otherwise: throw `AuthFailureError`

**DUMMY_HASH:**
Generated at module initialisation: `const DUMMY_HASH = await argon2.hash("timing-equalization-dummy", ARGON2_PARAMS)`. Stored in a closure-scoped `let` assigned in a provider's `onModuleInit`. Not exposed publicly.

**Assumptions from plan:**
- argon2id, t=3, m=65536 KiB, p=1
- Token mechanism: Opaque random string (not JWT) stored in memory `Map` keyed by user id, 15 min TTL
- Response body for sign-up (both branches): `200 { "message": "Check your email for next steps." }`
- Response body for sign-in failure (both branches): `401 { "error": { "code": "invalid_credentials", "message": "Invalid credentials.", "details": {} } }`
- Response body for sign-in success: `200 { "token": "<opaque-string>" }`

Now, the plan says DUMMY_HASH is "Stored in a closure-scoped `let` assigned in a provider's `onModuleInit`. Not exposed publicly."

So in the service, I need:
- A module-level or class-level variable for DUMMY_HASH that's initialized in `onModuleInit`
- The ARGON2_PARAMS as a constant
- An in-memory Map for tokens

Let me think about the structure:

```ts
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

const ARGON2_PARAMS = {
  type: argon2.argon2id,
  timeCost: 3,
  memoryCost: 65536,
  parallelism: 1,
} as const;

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash: string;
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly repo: AuthRepository,
    private readonly mail: MailPort,
  ) {
    this.dummyHash = ""; // will be set in onModuleInit
  }

  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash("timing-equalization-dummy", ARGON2_PARAMS);
  }

  async signUp(email: string, password: string): Promise<{ message: string }> {
    const existing = await this.repo.findByEmail(email);

    // Always perform argon2.verify to equalise timing
    const hashToCheck = existing ? existing.passwordHash : this.dummyHash;
    await argon2.verify(hashToCheck, password); // result discarded

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

    // Always perform argon2.verify to equalise timing
    const hashToCheck = existing ? existing.passwordHash : this.dummyHash;
    const valid = await argon2.verify(hashToCheck, password);

    if (existing !== null && valid) {
      const token = randomBytes(32).toString("hex");
      this.tokens.set(existing.id, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
      return { token };
    }

    throw new AuthFailureError();
  }
}
```

Wait, let me reconsider the DUMMY_HASH approach. The plan says "Stored in a closure-scoped `let` assigned in a provider's `onModuleInit`. Not exposed publicly."

"closure-scoped" — this suggests it's a module-level variable, not a class property. But since we're in a single file and using a class-based approach with NestJS DI, a private class property initialized in `onModuleInit` is the most natural way. The "closure-scoped" language might just mean it's not exported/publicly accessible. A `private` class field achieves that.

Actually, re-reading: "Stored in a closure-scoped `let` assigned in a provider's `onModuleInit`." This is a bit contradictory with a class property. Let me think...

In NestJS, the "provider" is the `AuthService` class itself. So "a provider's `onModuleInit`" means `AuthService.onModuleInit()`. And "closure-scoped `let`" could mean a module-level variable in the file (which is effectively closure-scoped to the module). But that would be harder to test and less idiomatic.

Actually, I think the most defensible reading is a private class property. The "closure-scoped" language is describing the intent (not publicly accessible) rather than mandating a specific implementation. A `private` field on the class is "not exposed publicly" which matches the plan's requirement.

Let me also consider: the plan says `signIn` returns `Promise<{ token: string }>` and throws `AuthFailureError`. The controller will handle the 401 mapping.

Let me also check: do I need to import `PrismaService`? No — the repository handles that. The service only talks to the repository.

Let me also verify the token map: "Opaque random string (not JWT) stored in memory `Map` keyed by user id, 15 min TTL". So the map is keyed by user ID. Good.

One thing I notice: in sign-up, the plan says "No transaction wraps the write + mail; if mail fails the user is still created (at-least-once delivery)." This means we don't need to handle mail failure specially — just let it propagate. Actually wait, "if mail fails the user is still created" — this implies that if mail throws, the user is already in the DB. Since we do `createUser` before `sendEmail`, that's naturally the case. We don't need a try/catch around mail.

Actually, should I wrap the mail call in a try/catch to prevent it from failing the response? The plan says "if mail fails the user is still created (at-least-once delivery)" — this describes the behavior, not that we need to catch the error. If mail fails, the error will propagate and the caller gets a 500. But the plan says "at-least-once delivery" which implies retries. I think for this implementation, we just let it propagate. The plan doesn't say to catch mail errors.

Let me finalize the file. I need to make sure:
1. ESM imports (no `require`)
2. TypeScript strict mode compatible
3. The file is complete and self-contained

Let me write the final version.
```

## reply

```ts
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
```
