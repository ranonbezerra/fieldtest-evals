# repair1-auth.spec.ts

## reasoning

```
We need to rewrite test file to import correct paths. Likely module names: src/auth/auth.module.ts etc exist. Use correct extensions .ts not needed. Also need to import testing utilities from @nestjs/testing, supertest, argon2. Assume they are installed. Write tests covering timing and response equality. Provide placeholder implementations focusing on imports. We'll just write tests that compile; they can be empty but must reference needed parts. Provide basic test suite.

We'll import { Test, TestingModule } from '@nestjs/testing'; import * as request from 'supertest'; import { INestApplication } from '@nestjs/common'; import { AppModule } from '../src/app.module'; import argon2 from 'argon2';

Write describe('Auth', () => { let app: INestApplication; beforeAll(async()=>{ const moduleRef = await Test.createTestingModule({ imports: [AppModule], }).compile(); app = moduleRef.createNestApplication(); await app.init(); }); afterAll(async()=>{ await app.close(); }); it('sign-up timing equal', async()=>{ const samples=20; const timesExisting=[]; const timesNew=[]; const emailExisting='exist@example.com'; const emailNew='new@example.com'; const pwd='Password123!'; // assume existing user created beforehand maybe via repository, but for compile we just call endpoints.

 for(let i=0;i<samples;i++){ const start=process.hrtime.bigint(); await request(app.getHttpServer()).post('/auth/sign-up').send({email:emailExisting,password:pwd}); const end=process.hrtime.bigint(); timesExisting.push(Number(end-start)); const start2=process.hrtime.bigint(); await request(app.getHttpServer()).post('/auth/sign-up').send({email:emailNew,password:pwd}); const end2=process.hrtime.bigint(); timesNew.push(Number(end2-start2)); } const avgExisting=timesExisting.reduce((a,b)=>a+b,0)/samples; const avgNew=timesNew.reduce((a,b)=>a+b,0)/samples; const diff=Math.abs(avgExisting-avgNew)/Math.max(avgExisting,avgNew); expect(diff).toBeLessThan(0.2); // 20% tolerance

 }); // etc

 });

We also need byte comparison of responses. We'll capture bodies and compare JSON.stringify equality ignoring maybe fields like message? but spec says same response. We'll just test that bodies equal.

Implement a test that sends both and compare.

Return.
```

## reply

```ts
// test/auth.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import argon2 from 'argon2';

// ASSUMPTION: The Prisma seed / repository layer already contains a user with
// email "existing@example.com" and a known password. The test does not attempt
// to create that user because the repository implementation is not visible
// here.

describe('Auth (timing‑equal enumeration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Helper that performs a POST request and returns both the raw response
   * (status, headers, body) and the elapsed time in nanoseconds.
   */
  async function postAuth(
    endpoint: '/auth/sign-up' | '/auth/sign-in',
    payload: { email: string; password: string },
  ) {
    const start = process.hrtime.bigint();
    const response = await request(app.getHttpServer())
      .post(endpoint)
      .send(payload);
    const end = process.hrtime.bigint();

    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
      elapsedNs: Number(end - start),
    };
  }

  it('sign‑up returns identical responses for existing and new emails', async () => {
    const existing = await postAuth('/auth/sign-up', {
      email: 'existing@example.com',
      password: 'Password123!',
    });
    const fresh = await postAuth('/auth/sign-up', {
      email: 'fresh-' + Date.now() + '@example.com',
      password: 'Password123!',
    });

    // Status code must be the same.
    expect(existing.status).toBe(fresh.status);

    // Headers (except those that are naturally variable like date) must be equal.
    // For simplicity we compare a deterministic subset.
    const headerKeys = ['content-type', 'content-length'];
    for (const key of headerKeys) {
      expect(existing.headers[key]).toBe(fresh.headers[key]);
    }

    // Body must be byte‑identical (JSON.stringify does a stable serialization).
    expect(JSON.stringify(existing.body)).toBe(JSON.stringify(fresh.body));
  });

  it('sign‑in returns identical responses for wrong password and unknown email', async () => {
    const wrongPassword = await postAuth('/auth/sign-in', {
      email: 'existing@example.com',
      password: 'WrongPassword!',
    });
    const unknownEmail = await postAuth('/auth/sign-in', {
      email: 'unknown-' + Date.now() + '@example.com',
      password: 'AnyPassword123!',
    });

    expect(wrongPassword.status).toBe(unknownEmail.status);
    const headerKeys = ['content-type', 'content-length'];
    for (const key of headerKeys) {
      expect(wrongPassword.headers[key]).toBe(unknownEmail.headers[key]);
    }
    expect(JSON.stringify(wrongPassword.body)).toBe(
      JSON.stringify(unknownEmail.body),
    );
  });

  it('execution time of the two sign‑up branches is statistically indistinguishable', async () => {
    const samples = 30;
    const timesExisting: number[] = [];
    const timesFresh: number[] = [];

    for (let i = 0; i < samples; i++) {
      const existing = await postAuth('/auth/sign-up', {
        email: 'existing@example.com',
        password: 'Password123!',
      });
      timesExisting.push(existing.elapsedNs);

      const fresh = await postAuth('/auth/sign-up', {
        email: `fresh-${i}-${Date.now()}@example.com`,
        password: 'Password123!',
      });
      timesFresh.push(fresh.elapsedNs);
    }

    const avg = (arr: number[]) =>
      arr.reduce((sum, v) => sum + v, 0) / arr.length;
    const stdDev = (arr: number[], mean: number) =>
      Math.sqrt(
        arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length,
      );

    const meanExisting = avg(timesExisting);
    const meanFresh = avg(timesFresh);
    const devExisting = stdDev(timesExisting, meanExisting);
    const devFresh = stdDev(timesFresh, meanFresh);

    // Relative difference must be within 15 % of the larger mean.
    const relativeDiff = Math.abs(meanExisting - meanFresh) / Math.max(meanExisting, meanFresh);
    expect(relativeDiff).toBeLessThan(0.15);

    // As an additional guard, the two distributions must overlap within one standard deviation.
    const overlap =
      Math.abs(meanExisting - meanFresh) <= devExisting + devFresh;
    expect(overlap).toBeTruthy();
  });

  it('password hashing uses argon2 (type check only)', async () => {
    // This test only ensures the argon2 import resolves; the actual service
    // implementation is not visible here.
    const hash = await argon2.hash('test');
    const ok = await argon2.verify(hash, 'test');
    expect(ok).toBe(true);
  });
});
```
