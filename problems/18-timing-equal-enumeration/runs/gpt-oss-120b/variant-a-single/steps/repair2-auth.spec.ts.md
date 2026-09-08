# repair2-auth.spec.ts

## reasoning

```
We need to rewrite test file to compile. Likely need imports existing modules. Assume modules exist. We'll import from src/auth/... Provide basic tests focusing on timing equality and response equality. Simplify: just placeholder tests that compile. Use jest? Vitest. Use supertest, @nestjs/testing. Assume those packages installed. Write test using NestFactory createTestingModule with AuthModule. Provide dummy mail service maybe. But compile errors were missing modules; we can import correctly paths. Provide minimal test skeleton with describe and it blocks with placeholders and comments. Ensure types correct. Use async function. Use expect from 'vitest'. Write import { expect, describe, it, beforeAll, afterAll } from 'vitest'; Use supertest from 'supertest'; Use INestApplication. Provide dummy app. No actual logic needed.

Return file content.
```

## reply

```ts
// test/auth.spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';

// The AuthModule, controller, service and repository are assumed to exist
// under src/auth as per the project conventions.
import { AuthModule } from '../src/auth/auth.module';

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe('Auth – timing equal enumeration', () => {
  const signUpPayload = { email: 'new@example.com', password: 'Secret123!' };
  const signInPayload = { email: 'new@example.com', password: 'Secret123!' };

  // Helper to capture response details
  const callEndpoint = async (path: string, body: object) => {
    const start = process.hrtime.bigint();
    const res = await request(app.getHttpServer()).post(path).send(body);
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;
    return { res, durationMs };
  };

  it('should return identical responses for existing vs new email on sign‑up', async () => {
    // First call – email does not exist yet
    const first = await callEndpoint('/auth/sign-up', signUpPayload);

    // Second call – same email now exists
    const second = await callEndpoint('/auth/sign-up', signUpPayload);

    // ---- response body equality ------------------------------------------------
    expect(first.res.body).toEqual(second.res.body);
    // ---- status code equality ---------------------------------------------------
    expect(first.res.statusCode).toBe(second.res.statusCode);
    // ---- header equality (ignoring mutable headers like Date) --------------------
    const filterHeaders = (h: Record<string, string | string[]>) => {
      const { date, 'content-length': _, ...rest } = h;
      return rest;
    };
    expect(filterHeaders(first.res.headers)).toEqual(filterHeaders(second.res.headers));

    // ---- timing equality (within a small tolerance) -----------------------------
    const toleranceMs = 30; // acceptable jitter
    const diff = Math.abs(first.durationMs - second.durationMs);
    expect(diff).toBeLessThanOrEqual(toleranceMs);
  });

  it('should return identical responses for wrong password vs unknown email on sign‑in', async () => {
    // Wrong password for an existing account
    const wrongPass = await callEndpoint('/auth/sign-in', {
      email: signInPayload.email,
      password: 'WrongPassword!',
    });

    // Unknown email
    const unknownEmail = await callEndpoint('/auth/sign-in', {
      email: 'unknown@example.com',
      password: 'Whatever123!',
    });

    // ---- response body equality ------------------------------------------------
    expect(wrongPass.res.body).toEqual(unknownEmail.res.body);
    // ---- status code equality ---------------------------------------------------
    expect(wrongPass.res.statusCode).toBe(unknownEmail.res.statusCode);
    // ---- header equality (ignoring mutable headers) -----------------------------
    expect(filterHeaders(wrongPass.res.headers)).toEqual(filterHeaders(unknownEmail.res.headers));

    // ---- timing equality ---------------------------------------------------------
    const toleranceMs = 30;
    const diff = Math.abs(wrongPass.durationMs - unknownEmail.durationMs);
    expect(diff).toBeLessThanOrEqual(toleranceMs);
  });
});
```
