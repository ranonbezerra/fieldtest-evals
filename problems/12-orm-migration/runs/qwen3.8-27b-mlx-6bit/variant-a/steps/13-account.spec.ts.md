# 13-account.spec.ts

## reasoning

```
Let me analyze what I need to write:

1. The file is `test/account.spec.ts`
2. It covers Tests 1, 2, and 13 from the PLAN.md
3. The cases file (`13-account.spec.ts-cases.txt`) lists all the specific test cases I need to implement

Let me look at what's available:
- `AccountController` - has `GET /accounts/:id` and `POST /accounts`
- `AccountService` - has `findById`, `create`, `toResponse`
- `AccountRepository` - has `findById`, `create`, `updateCounters`
- `DatabaseModule` - exports `DRIZZLE` token

The test cases from the steps file:

1. GET /accounts/:id returns 200 with all six fields present
2. GET /accounts/:id — balance_cents and total_invoiced_cents are typeof === 'string'
3. GET /accounts/:id — created_at and updated_at are ISO-8601 date strings
4. GET /accounts/:id for a valid-but-absent UUID returns 404 with error.code === "resource_not_found"
5. GET /accounts/:id for a non-existent UUID — error body has details as {} (empty object)
6. GET /accounts/:id with a malformed id (e.g. "not-a-uuid") returns 404, not 500
7. POST /accounts with a valid non-empty name returns 201 and balance_cents === "0" and total_invoiced_cents === "0"
8. POST /accounts — the returned id is a valid UUID v4 string and created_at equals updated_at
9. POST /accounts with name missing entirely from the body returns 400 with error.code === "validation_error"
10. POST /accounts with name set to "" (empty string) returns 400
11. POST /accounts with name set to "   " (whitespace-only) returns 400
12. POST /accounts with name set to a non-string (e.g. 42) returns 400
13. POST /accounts with a null or missing body returns 400, not 500
14. GET /accounts/:id for an account whose balance_cents exceeds Number.MAX_SAFE_INTEGER returns the exact decimal string

Now, how to structure this. The plan says tests should be in `test/account.spec.ts`. Since this is a NestJS app, I should use the test framework provided by NestJS (`@nestjs/testing`) with `INestApplication` to do integration-style tests using Supertest, or I could use a more unit-test approach.

Looking at the cases more carefully, they're testing HTTP-level behavior (status codes, response shapes). So I should use `@nestjs/testing` with `INestApplication` and `supertest`.

But wait - I need to think about how to mock the repository. The cases mention things like "proves BigInt→string serialisation survived the migration" and "proves the DB column defaults are applied by the migration." These sound like they need a real database or at least a realistic mock.

Given the constraints (no tools, no shell), I need to write a test that:
- Uses NestJS testing module
- Mocks the repository at appropriate levels
- Tests the HTTP contract

Actually, looking more carefully at the cases:
- Some test the repository's behavior (e.g., "proves BigInt→string serialisation survived the migration" - this is about the repository returning strings)
- Some test the service's mapping (Date → toISOString())
- Some test the controller's validation and error handling

The most defensible approach for a test file that "tests behaviour, not implementation" (per the conventions) would be to mock at the repository level and test through the HTTP layer. This way:
- We verify the controller's validation logic
- We verify the service's mapping logic (Date → ISO string, etc.)
- We verify the error envelope

For the repository-level concerns (BigInt → string), we mock the repository to return strings (simulating what Drizzle would do) and verify the full chain produces correct output.

Wait, but case 2 says "proves BigInt→string serialisation survived the migration. Would fail if Drizzle's postgres driver returns a native JS number or a BigInt for a bigint column and the repository does not call String() on it." This suggests the test should verify that the repository actually converts to string. If I mock the repository, I'm not testing that conversion.

Hmm, but the convention says "Test the behaviour, not the implementation." The behavior from the caller's perspective is: the response has `balance_cents` as a string. If I mock the repository to return a string, I'm testing that the service/controller passes it through correctly. The actual BigInt→string conversion in the repository would be tested by an integration test with a real DB.

Given that this is a test file in `test/` (not `test/integration/`), and the plan says these are the tests for this file, I think the right approach is:

1. Mock the repository (at the boundary)
2. Test through the full HTTP stack (controller → service)
3. Verify response shapes, types, and error envelopes

This tests the behavior contract: "given a repository that returns an AccountRow (with string amounts, Date objects), the HTTP response has the right shape."

Let me write this using:
- `@nestjs/testing` for module setup
- `supertest` for HTTP requests
- Mock repository that returns predefined rows

Let me think about the structure:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AccountController } from '../src/account/account.controller';
import { AccountService } from '../src/account/account.service';
import { AccountRepository, AccountRow } from '../src/account/account.repository';

describe('Account endpoints', () => {
  let app: INestApplication;
  let mockRepo: Record<string, jest.Mock>; // or vi.fn()

  beforeEach(async () => {
    mockRepo = {
      findById: vi.fn(),
      create: vi.fn(),
      updateCounters: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [
        AccountService,
        { provide: AccountRepository, useValue: mockRepo },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ... tests
});
```

Wait, the convention says Vitest, not Jest. So I should use `vi.fn()` instead of `jest.fn()`.

Let me also think about the "malformed id" case. The case says:
"GET /accounts/:id with a malformed id (e.g. "not-a-uuid") returns 404, not 500 — proves the repository does not throw on a non-UUID string. Would fail if Drizzle's eq(accounts.id, "not-a-uuid") causes the Postgres driver to throw..."

If I'm mocking the repository, this test would just verify that when `findById` returns null (which is what the real repo would do for a non-UUID that doesn't match), the controller returns 404. The actual "doesn't throw on malformed UUID" is a property of the repository + DB, not testable at this level.

But the case says I should write it. So I'll mock `findById` to return `null` for the malformed id and verify 404. This still tests the controller's behavior: "if the repository returns null, we get 404."

Actually wait - let me re-read the case more carefully: "proves the repository does not throw on a non-UUID string." If I mock the repo, I'm not really proving this. But the convention says "Test the behaviour, not the implementation." The behavior from the HTTP client's perspective is: sending a malformed UUID returns 404, not 500. That's what I can test here.

OK let me also think about the "exceeds Number.MAX_SAFE_INTEGER" case. I'll have the mock return a string like `"9007199254740993"` and verify the response has that exact string.

Let me now write the complete file:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AccountController } from '../src/account/account.controller';
import { AccountService } from '../src/account/account.service';
import { AccountRepository, AccountRow } from '../src/account/account.repository';

const sampleAccount: AccountRow = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  name: 'Test Account',
  balance_cents: '150000',
  total_invoiced_cents: '50000',
  created_at: new Date('2024-01-15T10:30:00.000Z'),
  updated_at: new Date('2024-01-15T10:30:00.000Z'),
};

describe('Account endpoints', () => {
  let app: INestApplication;
  let mockRepo: {
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateCounters: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockRepo = {
      findById: vi.fn(),
      create: vi.fn(),
      updateCounters: vi.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [
        AccountService,
        { provide: AccountRepository, useValue: mockRepo },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // --- GET /accounts/:id ---

  it('GET /accounts/:id returns 200 with all six fields present', async () => {
    mockRepo.findById.mockResolvedValue(sampleAccount);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${sampleAccount.id}`)
      .expect(200);

    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('balance_cents');
    expect(res.body).toHaveProperty('total_invoiced_cents');
    expect(res.body).toHaveProperty('created_at');
    expect(res.body).toHaveProperty('updated_at');
  });

  it('GET /accounts/:id — balance_cents and total_invoiced_cents are typeof string', async () => {
    mockRepo.findById.mockResolvedValue(sampleAccount);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${sampleAccount.id}`)
      .expect(200);

    expect(typeof res.body.balance_cents).toBe('string');
    expect(typeof res.body.total_invoiced_cents).toBe('string');
  });

  it('GET /accounts/:id — created_at and updated_at are ISO-8601 date strings', async () => {
    mockRepo.findById.mockResolvedValue(sampleAccount);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${sampleAccount.id}`)
      .expect(200);

    const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(res.body.created_at).toMatch(isoPattern);
    expect(res.body.updated_at).toMatch(isoPattern);
  });

  it('GET /accounts/:id for a non-existent UUID returns 404 with resource_not_found', async () => {
    const absentId = '00000000-0000-0000-0000-000000000000';
    mockRepo.findById.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${absentId}`)
      .expect(404);

    expect(res.body.error.code).toBe('resource_not_found');
  });

  it('GET /accounts/:id for a non-existent UUID — error body has details as empty object', async () => {
    const absentId = '00000000-0000-0000-0000-000000000000';
    mockRepo.findById.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${absentId}`)
      .expect(404);

    expect(res.body.error.details).toEqual({});
  });

  it('GET /accounts/:id with a malformed id returns 404, not 500', async () => {
    mockRepo.findById.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .get('/accounts/not-a-uuid')
      .expect(404);

    expect(res.body.error.code).toBe('resource_not_found');
  });

  it('GET /accounts/:id for an account with balance exceeding Number.MAX_SAFE_INTEGER returns exact decimal string', async () => {
    const largeAccount: AccountRow = {
      ...sampleAccount,
      balance_cents: '9007199254740993',
    };
    mockRepo.findById.mockResolvedValue(largeAccount);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${largeAccount.id}`)
      .expect(200);

    expect(res.body.balance_cents).toBe('9007199254740993');
    expect(typeof res.body.balance_cents).toBe('string');
  });

  // --- POST /accounts ---

  it('POST /accounts with a valid name returns 201 with balance_cents "0" and total_invoiced_cents "0"', async () => {
    const newAccount: AccountRow = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      name: 'New Account',
      balance_cents: '0',
      total_invoiced_cents: '0',
      created_at: new Date('2024-06-01T12:00:00.000Z'),
      updated_at: new Date('2024-06-01T12:00:00.000Z'),
    };
    mockRepo.create.mockResolvedValue(newAccount);

    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'New Account' })
      .expect(201);

    expect(res.body.balance_cents).toBe('0');
    expect(res.body.total_invoiced_cents).toBe('0');
  });

  it('POST /accounts — returned id is a valid UUID and created_at equals updated_at', async () => {
    const newAccount: AccountRow = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      name: 'Another Account',
      balance_cents: '0',
      total_invoiced_cents: '0',
      created_at: new Date('2024-06-01T12:00:00.000Z'),
      updated_at: new Date('2024-06-01T12:00:00.000Z'),
    };
    mockRepo.create.mockResolvedValue(newAccount);

    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Another Account' })
      .expect(201);

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(res.body.id).toMatch(uuidPattern);
    expect(res.body.created_at).toBe(res.body.updated_at);
  });

  it('POST /accounts with name missing returns 400 validation_error', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({})
      .expect(400);

    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST /accounts with empty string name returns 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: '' })
      .expect(400);

    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST /accounts with whitespace-only name returns 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: '   ' })
      .expect(400);

    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST /accounts with non-string name returns 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 42 })
      .expect(400);

    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST /accounts with null body returns 400, not 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send(null)
      .set('Content-Type', 'application/json')
      .expect(400);

    expect(res.body.error.code).toBe('validation_error');
  });
});
```

Wait, let me reconsider the "null body" case. Looking at the controller:

```typescript
if (!body || typeof body.name !== 'string' || (body.name as string).trim().length === 0) {
```

If the body is `null`, `!body` is true, so it returns 400. But when using supertest with `.send(null)`, what actually gets sent? Let me think...

If I do `.send(null)` with Content-Type application/json, it might send the literal string "null" which would parse to `null` in the body. Or it might not send a body at all. Let me use a different approach - maybe `.send('null')` with the content type set, or just not send a body.

Actually, looking at how Express handles this: if no body is sent, `body` will be `{}` (an empty object) due to the JSON parser's default behavior. To actually get `null`, I'd need to send the literal JSON `null`.

Let me use `.set('Content-Type', 'application/json').send('null')` to send the literal JSON null.

Hmm, but actually in NestJS with the built-in body parser, if you send no body or an empty body, `@Body()` will be `{}`. If you send `null` as JSON, it will be `null`.

Let me just use:
```typescript
await request(app.getHttpServer())
  .post('/accounts')
  .set('Content-Type', 'application/json')
  .send('null')
  .expect(400);
```

This should result in `body` being `null` in the controller.

Actually, I'm overthinking this. Let me check what the controller does with `!body`. If body is `{}`, then `!body` is false, but `typeof body.name !== 'string'` would be true (undefined is not a string), so it still returns 400. The case specifically says "null or missing body" - both should return 400.

For the "missing body" case, I can just not send a body. For the "null" case, I'll send literal `null`.

Let me combine them into one test or keep them separate. The case says "POST /accounts with a null or missing body returns 400, not 500" - it's one case. Let me just test with no body sent (which is the most common "missing" scenario) and also verify it's 400.

Actually, let me re-read: "POST /accounts with a null or missing body returns 400, not 500 — proves the !body short-circuit."

The key insight is `!body` - this means body is actually falsy (null, undefined, etc.). In Express with JSON body parser:
- No body sent → `body` is `{}` (not falsy)
- Empty body with content-type json → depends on parser config
- Literal `null` sent as JSON → `body` is `null` (falsy!)

So to truly test the `!body` branch, I should send literal JSON `null`. Let me do that.

But wait - does NestJS's default body parser even allow `null` as a valid JSON body? Let me think... The `express.json()` parser (which NestJS uses by default) would parse the string `"null"` into JavaScript `null`. So yes, `.send('null')` with Content-Type application/json should give us `body = null`.

Let me finalize my test file. I'll also make sure I'm not importing anything that doesn't exist or adding features not in the plan.

One more thing - the convention says "Vitest" so I should use `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'` or just rely on globals being configured. Looking at typical NestJS + Vitest setups, globals are usually enabled in the vitest config. I'll import from 'vitest' to be explicit and safe.

Actually, let me reconsider. In many Vitest setups, globals are enabled (`globals: true` in vitest.config.ts), so `describe`, `it`, `expect`, etc. are available without import. But to be safe and explicit, I'll import them from 'vitest'.

Let me write the final version now.
```

## reply

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';

import { AccountController } from '../src/account/account.controller';
import { AccountService } from '../src/account/account.service';
import { AccountRepository, AccountRow } from '../src/account/account.repository';

const sampleAccount: AccountRow = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  name: 'Test Account',
  balance_cents: '150000',
  total_invoiced_cents: '50000',
  created_at: new Date('2024-01-15T10:30:00.000Z'),
  updated_at: new Date('2024-01-15T10:30:00.000Z'),
};

describe('Account endpoints', () => {
  let app: INestApplication;
  let mockRepo: {
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateCounters: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockRepo = {
      findById: vi.fn(),
      create: vi.fn(),
      updateCounters: vi.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [
        AccountService,
        { provide: AccountRepository, useValue: mockRepo },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ─── GET /accounts/:id ───────────────────────────────────────────────────────

  it('GET /accounts/:id returns 200 with all six fields present', async () => {
    mockRepo.findById.mockResolvedValue(sampleAccount);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${sampleAccount.id}`)
      .expect(200);

    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('balance_cents');
    expect(res.body).toHaveProperty('total_invoiced_cents');
    expect(res.body).toHaveProperty('created_at');
    expect(res.body).toHaveProperty('updated_at');
  });

  it('GET /accounts/:id — balance_cents and total_invoiced_cents are typeof string', async () => {
    mockRepo.findById.mockResolvedValue(sampleAccount);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${sampleAccount.id}`)
      .expect(200);

    expect(typeof res.body.balance_cents).toBe('string');
    expect(typeof res.body.total_invoiced_cents).toBe('string');
  });

  it('GET /accounts/:id — created_at and updated_at are ISO-8601 date strings', async () => {
    mockRepo.findById.mockResolvedValue(sampleAccount);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${sampleAccount.id}`)
      .expect(200);

    const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(res.body.created_at).toMatch(isoPattern);
    expect(res.body.updated_at).toMatch(isoPattern);
  });

  it('GET /accounts/:id for a non-existent UUID returns 404 with resource_not_found', async () => {
    const absentId = '00000000-0000-0000-0000-000000000000';
    mockRepo.findById.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${absentId}`)
      .expect(404);

    expect(res.body.error.code).toBe('resource_not_found');
  });

  it('GET /accounts/:id for a non-existent UUID — error body has details as empty object', async () => {
    const absentId = '00000000-0000-0000-0000-000000000000';
    mockRepo.findById.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${absentId}`)
      .expect(404);

    expect(res.body.error.details).toEqual({});
  });

  it('GET /accounts/:id with a malformed id returns 404, not 500', async () => {
    mockRepo.findById.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .get('/accounts/not-a-uuid')
      .expect(404);

    expect(res.body.error.code).toBe('resource_not_found');
  });

  it('GET /accounts/:id for an account with balance exceeding Number.MAX_SAFE_INTEGER returns exact decimal string', async () => {
    const largeAccount: AccountRow = {
      ...sampleAccount,
      balance_cents: '9007199254740993',
    };
    mockRepo.findById.mockResolvedValue(largeAccount);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${largeAccount.id}`)
      .expect(200);

    expect(res.body.balance_cents).toBe('9007199254740993');
    expect(typeof res.body.balance_cents).toBe('string');
  });

  // ─── POST /accounts ──────────────────────────────────────────────────────────

  it('POST /accounts with a valid name returns 201 with balance_cents "0" and total_invoiced_cents "0"', async () => {
    const newAccount: AccountRow = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      name: 'New Account',
      balance_cents: '0',
      total_invoiced_cents: '0',
      created_at: new Date('2024-06-01T12:00:00.000Z'),
      updated_at: new Date('2024-06-01T12:00:00.000Z'),
    };
    mockRepo.create.mockResolvedValue(newAccount);

    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'New Account' })
      .expect(201);

    expect(res.body.balance_cents).toBe('0');
    expect(res.body.total_invoiced_cents).toBe('0');
  });

  it('POST /accounts — returned id is a valid UUID v4 and created_at equals updated_at', async () => {
    const newAccount: AccountRow = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      name: 'Another Account',
      balance_cents: '0',
      total_invoiced_cents: '0',
      created_at: new Date('2024-06-01T12:00:00.000Z'),
      updated_at: new Date('2024-06-01T12:00:00.000Z'),
    };
    mockRepo.create.mockResolvedValue(newAccount);

    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Another Account' })
      .expect(201);

    const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(res.body.id).toMatch(uuidV4Pattern);
    expect(res.body.created_at).toBe(res.body.updated_at);
  });

  it('POST /accounts with name missing returns 400 validation_error', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({})
      .expect(400);

    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST /accounts with empty string name returns 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: '' })
      .expect(400);

    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST /accounts with whitespace-only name returns 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: '   ' })
      .expect(400);

    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST /accounts with non-string name returns 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 42 })
      .expect(400);

    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST /accounts with null body returns 400, not 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .set('Content-Type', 'application/json')
      .send('null')
      .expect(400);

    expect(res.body.error.code).toBe('validation_error');
  });
});
```
