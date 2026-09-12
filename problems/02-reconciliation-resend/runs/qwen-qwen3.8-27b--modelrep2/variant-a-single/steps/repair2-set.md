# repair2-set

## reasoning

```
Let me analyze the errors as a whole:

1. `src/payout/payout.module.ts(19,16)`: `'BankClient'` is a type (interface), not a value. It's being used as a provider token (`{ provide: BankClient, useValue: null }`). Since `BankClient` is an interface, it can't be used as a value. Need to use a string token or a different approach.

2. `src/payout/reconcile-window.dto.ts(9,4)` and `(16,4)`: `'Type'` from `@nestjs/common` is being used as a value (decorator) but it's only imported as a type. The import is `import { Type } from '@nestjs/common'` — wait, let me look at the actual file. The import line says `import { Type } from '@nestjs/common'`. But the error says it "only refers to a type". This means in the context of this file, `Type` is being resolved as a type-only import. 

Wait, looking more carefully at the import: `import { Type } from '@nestjs/common';` — in NestJS, `Type` is both a type and a value (it's a generic type that's also used as a decorator via `@Type(() => String)`). Actually no — in `class-transformer`, `Type` is a decorator function. In `@nestjs/common`, `Type` is a type utility (`type Type<T> = new (...args: any[]) => T`). 

Looking at the DTO file, it uses `@Type(() => String)` which is the `class-transformer` decorator, not the NestJS type. So the import should be from `class-transformer`, not `@nestjs/common`.

Wait, but the error says `'Type' only refers to a type, but is being used as a value here.` This confirms that `Type` from `@nestjs/common` is just a type alias, not a value. The decorator `@Type()` comes from `class-transformer`.

3. `test/payout.spec.ts(189,28)`: `FakeRepo` is not assignable to `PayoutRepository` because `PayoutRepository` has a `prisma` property. The test creates a `FakeRepo` and passes it to `buildService(repo, bank, clock)` which calls `new PayoutService(repo, bank, clock, ...)`. The `PayoutService` constructor expects a `PayoutRepository` instance.

So the issue is that `PayoutService` is typed to accept `PayoutRepository` specifically, but the test passes a `FakeRepo`. The fix should be to make `PayoutService` accept an interface that both `PayoutRepository` and `FakeRepo` can satisfy.

Let me think about what the minimal fix is:

1. **`payout.module.ts`**: `BankClient` is an interface used as a provider token. The fix is to use a string literal token instead. Looking at the module, it uses `{ provide: BankClient, useValue: null }`. Since `BankClient` is an interface (type-only), it can't be used as a value. The fix is to use a string token like `{ provide: 'BankClient', useValue: null }`.

But wait — if I change the token to a string, then the `PayoutService` would need to inject by that string token too. But the instructions say "Change exactly what the compiler requires" and "Do not add features, do not rename anything the errors do not mention, do not reorganise."

Actually, looking at this more carefully — the service probably injects `BankClient` by its interface. If I change the module to use a string token, the service injection would break. But the error is only in the module file.

The simplest fix that satisfies the compiler: use a string token for the provider. But then the service would need to match. However, the service file isn't listed as having errors, so maybe the service uses `@Inject()` with a string or uses `@Injectable()` with the type.

Actually wait — in NestJS, when you use `{ provide: SomeInterface, useValue: null }`, the interface needs to be a value (a class). Since `BankClient` is just an interface, this doesn't work. The standard pattern is to use a string token.

But the service isn't listed as having errors. So maybe the service already uses a string token for injection? Let me think...

The service constructor in the test is called as `new PayoutService(repo, bank, clock, { maxAttempts, lagMs: LAG })` — it takes positional args. So the service likely uses `@Inject()` decorators or constructor parameter types.

Given that the test instantiates the service directly with positional args, the service likely uses constructor injection with types. But `BankClient` is an interface, so it can't be used as a constructor parameter type for DI purposes (NestJS would need a token).

The minimal fix for the module: change `{ provide: BankClient, useValue: null }` to `{ provide: 'BankClient', useValue: null }`. But then the service would need `@Inject('BankClient')` to match.

Hmm, but the service file isn't listed as having an error. Let me reconsider.

Actually, the simplest approach: the service file isn't showing errors, so it must already be compatible. The module just needs to not use the interface as a value. The cleanest fix is to use a string token.

But wait — if the service uses `private readonly bank: BankClient` in its constructor, NestJS would try to resolve `BankClient` as a token. Since it's an interface, it would fail at runtime but not at compile time (TypeScript doesn't error on this because the type is used in a position where a type is expected for the parameter annotation).

Actually, for the module, the fix is simple: just use a string token. The service file doesn't have errors, so whatever it does is fine from the compiler's perspective. The DI resolution is a runtime concern, not a compile-time one.

Let me just fix the module to use a string token:
```ts
{ provide: 'BankClient', useValue: null },
```

2. **`reconcile-window.dto.ts`**: The `@Type` decorator is from `class-transformer`, not `@nestjs/common`. The import needs to be fixed to import `Type` from `class-transformer` instead.

Current: `import { Type } from '@nestjs/common';`
Fix: `import { Type } from 'class-transformer';`

3. **`test/payout.spec.ts(189,28)`**: `FakeRepo` is not assignable to `PayoutRepository`. The `buildService` function calls `new PayoutService(repo, bank, clock, ...)` and `PayoutService`'s constructor expects `PayoutRepository` as the first arg.

The fix: `PayoutService` should accept an interface (not the concrete class) for its repository dependency. This way, both `PayoutRepository` and `FakeRepo` can satisfy it.

But wait — the service file isn't listed as having errors. So the service already compiles fine. The issue is that the test passes `FakeRepo` where `PayoutRepository` is expected.

The fix options:
- Make `PayoutService` accept an interface instead of `PayoutRepository`
- Cast in the test
- Make `FakeRepo` extend `PayoutRepository` (not practical)

The cleanest minimal fix is to define an interface for the repository contract and have `PayoutService` accept that interface. But that's a change to the service file which isn't listed as having errors...

Actually, re-reading the instructions: "When two files disagree about a name, a signature or a type, one of them is the definition. Change the caller unless the definition is the thing the errors say is wrong."

The error is in the test file — `FakeRepo` is not assignable to `PayoutRepository`. The "definition" here is `PayoutService`'s constructor which expects `PayoutRepository`. The test is the "caller" that disagrees.

But the most pragmatic fix that doesn't change the service's public API: cast the `FakeRepo` to `PayoutRepository` in the test. Or better, make the `buildService` function accept a broader type.

Actually, the simplest fix: in the test, the `buildService` function signature can accept the repo as a structural type that `FakeRepo` satisfies, and then cast it when passing to `PayoutService`. Or we can just cast `repo as any as PayoutRepository` or use a type assertion.

Wait, let me look at the `buildService` function:
```ts
function buildService(repo: FakeRepo, bank: FakeBank, clock: FakeClock, maxAttempts = 5) {
  return new PayoutService(repo, bank, clock, { maxAttempts, lagMs: LAG });
}
```

The issue is `new PayoutService(repo, ...)` where `repo` is `FakeRepo` but `PayoutService` expects `PayoutRepository`.

The minimal fix: change the parameter type of `buildService` or add a cast. Since we want to fix the test file, the simplest is:

```ts
function buildService(repo: FakeRepo, bank: FakeBank, clock: FakeClock, maxAttempts = 5) {
  return new PayoutService(repo as unknown as PayoutRepository, bank, clock, { maxAttempts, lagMs: LAG });
}
```

But we'd need to import `PayoutRepository`. Let me check what's already imported in the test... The test imports:
```ts
import { PayoutController } from '../src/payout/payout.controller.js';
import { PayoutService, deriveTxid } from '../src/payout/payout.service.js';
import type { BankClient, BankSendResponse, StatementEntry } from '../src/payout/bank-client.types.js';
import type { ClaimResult, Order, ReconcileWindow, SendResult } from '../src/payout/order.types.js';
import { iterDays } from '../src/payout/date-window.js';
```

No import of `PayoutRepository`. We could add one, or we could just use `as any`:

```ts
return new PayoutService(repo as any, bank, clock, { maxAttempts, lagMs: LAG });
```

But that's ugly. Better to import the type and use a proper cast:

```ts
import type { PayoutRepository } from '../src/payout/payout.repository.js';
```

and then:
```ts
return new PayoutService(repo as unknown as PayoutRepository, bank, clock, { maxAttempts, lagMs: LAG });
```

Actually, even simpler — since `PayoutService` is being constructed directly (not via DI), and the test is a unit test, the cleanest approach is to change the `PayoutService` constructor to accept a structural interface. But the service file isn't listed as having errors, so I shouldn't change it.

Let me go with the cast approach in the test. I'll import `PayoutRepository` as a type and cast.

Wait, actually, let me reconsider. The `PayoutRepository` has a `prisma` property (from the constructor `private readonly prisma: PrismaClient`). The `FakeRepo` doesn't have this. So a simple `as PayoutRepository` won't work because TypeScript would complain about the missing property. We need `as unknown as PayoutRepository`.

Let me now write the three files:

1. `src/payout/payout.module.ts` — fix `BankClient` usage as value
2. `src/payout/reconcile-window.dto.ts` — fix `Type` import
3. `test/payout.spec.ts` — fix the type mismatch

Let me write them out.

For the module, I need to change `{ provide: BankClient, useValue: null }` to `{ provide: 'BankClient', useValue: null }`. I should also remove the import of `BankClient` if it's only used there... but wait, it might be used elsewhere in the file. Looking at the module file, `BankClient` is imported and only used in the providers array. So I can either:
- Change the import to `import type { BankClient }` (but then it can't be used as a value, which is what we're fixing)
- Just use a string token and remove the import

Actually, if I use a string token, I don't need the import at all. Let me remove it.

Wait, but the comment in the module says "BankClient: HTTP adapter implementing the bank's instant-payment API." So it's just documentation. I'll keep the comment but remove the import since it's no longer used as a value.

Actually, let me keep it simple. The import line is `import { BankClient } from './bank-client.types.js';`. If I change to a string token, I don't need this import. Let me remove it.

For the DTO, change `import { Type } from '@nestjs/common';` to `import { Type } from 'class-transformer';`.

For the test, I need to add the import for `PayoutRepository` (as type) and add a cast.

Let me write the complete files now.

Actually wait - for the test file, I need to be careful. The `buildService` function is used in many places. The cast should only be in `buildService`. Let me look at the exact line 189 to make sure I'm fixing the right spot.

The error is at line 189, column 28. Looking at the test file, the `buildService` function is:
```ts
function buildService(repo: FakeRepo, bank: FakeBank, clock: FakeClock, maxAttempts = 5) {
  return new PayoutService(repo, bank, clock, { maxAttempts, lagMs: LAG });
}
```

Line 189 would be the `return new PayoutService(repo, ...)` line. The fix is to cast `repo`.

Let me write all three files now.

For `payout.module.ts`:
- Remove `import { BankClient } from './bank-client.types.js';`
- Change `{ provide: BankClient, useValue: null }` to `{ provide: 'BankClient', useValue: null }`

For `reconcile-window.dto.ts`:
- Change `import { Type } from '@nestjs/common';` to `import { Type } from 'class-transformer';`

For `test/payout.spec.ts`:
- Add `import type { PayoutRepository } from '../src/payout/payout.repository.js';`
- Change `new PayoutService(repo, bank, clock, ...)` to `new PayoutService(repo as unknown as PayoutRepository, bank, clock, ...)`

Let me write the complete files.
```

## reply

Looking at the three errors as a whole, I see three distinct mistakes:

1. **`BankClient` used as a value** — it's an interface (type-only), so it can't be a DI token. Fix: use a string token in the module.
2. **`Type` imported from wrong package** — `@Type()` is a `class-transformer` decorator, not the `@nestjs/common` type alias. Fix: import from `class-transformer`.
3. **`FakeRepo` not assignable to `PayoutRepository`** — the test passes a structural fake where the concrete class is expected. Fix: cast in the one place it's constructed.

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';

/**
 * Provider tokens (resolved in the real app via HttpModule/ConfigService):
 *  - 'BankClient': HTTP adapter implementing the bank's instant-payment API.
 *  - PrismaClient: the Prisma client instance.
 *  - PayoutService clock: a wall-clock implementation returning Date.now().
 * The service itself is transport-agnostic and fully testable.
 */
@Module({
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    { provide: 'BankClient', useValue: null },
    { provide: 'PAYOUT_CLOCK', useValue: { now: () => Date.now() } },
    {
      provide: 'PAYOUT_CONFIG',
      useValue: {
        maxAttempts: Number(process.env.PAYMENT_MAX_ATTEMPTS ?? 5),
        lagMs: Number(process.env.PAYMENT_PUBLISHING_LAG_MS ?? 30 * 60 * 1000),
      },
    },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
```

### src/payout/reconcile-window.dto.ts
```ts
import { Type } from 'class-transformer';
import { IsDateString, IsOptional, MaxLength, MinLength } from 'class-validator';

export class ReconcileWindowDto {
  @IsOptional()
  @IsDateString()
  @MinLength(10)
  @MaxLength(10)
  @Type(() => String)
  from?: string;

  @IsOptional()
  @IsDateString()
  @MinLength(10)
  @MaxLength(10)
  @Type(() => String)
  to?: string;
}
```

### test/payout.spec.ts
```ts
import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { PayoutController } from '../src/payout/payout.controller.js';
import { PayoutService, deriveTxid } from '../src/payout/payout.service.js';
import type { PayoutRepository } from '../src/payout/payout.repository.js';
import type { BankClient, BankSendResponse, StatementEntry } from '../src/payout/bank-client.types.js';
import type { ClaimResult, Order, ReconcileWindow, SendResult } from '../src/payout/order.types.js';
import { iterDays } from '../src/payout/date-window.js';

const T0 = Date.parse('2025-06-01T12:00:00Z');
const LAG = 30 * 60 * 1000;
const H = 60 * 60 * 1000;

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ord-1',
    supplierKey: 'key-supplier-1',
    amountMinor: 12500n,
    effectiveDate: '2025-06-01',
    state: 'PENDING',
    attempts: 0,
    txid: null,
    sentAt: null,
    absentConfirmedAt: null,
    lastError: null,
    ...overrides,
  };
}

// ---------- fakes ----------

class FakeRepo {
  orders: Order[];
  calls: { op: string; orderId: string }[] = [];

  constructor(orders: Order[] = []) {
    this.orders = orders.map((o) => ({ ...o }));
  }

  private get(id: string): Order {
    const o = this.orders.find((x) => x.id === id);
    if (!o) throw new Error(`no order ${id}`);
    return o;
  }

  async findSendableOrders(maxAttempts: number): Promise<Order[]> {
    return this.orders
      .filter(
        (o) =>
          o.state === 'PENDING' ||
          (o.state === 'FAILED' && o.absentConfirmedAt !== null && o.attempts < maxAttempts),
      )
      .map((o) => ({ ...o }));
  }

  async claim(id: string, txid: string, now: Date): Promise<ClaimResult> {
    this.calls.push({ op: 'claim', orderId: id });
    const o = this.orders.find((x) => x.id === id);
    if (!o) return { ok: false, reason: 'already_claimed' };
    if (o.state !== 'PENDING' && o.state !== 'FAILED') {
      return { ok: false, reason: 'already_claimed' };
    }
    o.state = 'SENT';
    o.attempts = o.state === 'SENT' ? o.attempts + 1 : 1; // note: state already flipped; see below
    o.txid = txid;
    o.sentAt = now;
    o.lastError = null;
    return { ok: true, order: { ...o } };
  }

  async sendResult(id: string, kind: SendResult['kind'], note: string | null): Promise<void> {
    this.calls.push({ op: 'sendResult', orderId: id });
    const o = this.get(id);
    if (o.state !== 'SENT') throw new Error('sendResult on non-SENT order');
    if (kind === 'success') o.lastError = note;
    else if (kind === 'permanent') {
      o.state = 'MANUAL_REVIEW';
      o.lastError = note;
    } else {
      o.state = 'FAILED';
      o.lastError = note;
    }
  }

  async findSettleCandidates(): Promise<Order[]> {
    return this.orders
      .filter((o) => (o.state === 'PENDING' || o.state === 'SENT' || o.state === 'FAILED') && o.txid !== null)
      .map((o) => ({ ...o }));
  }

  async settleMatched(id: string): Promise<number> {
    this.calls.push({ op: 'settle', orderId: id });
    const o = this.get(id);
    if (o.state !== 'PENDING' && o.state !== 'SENT' && o.state !== 'FAILED') return 0;
    o.state = 'SETTLED';
    o.lastError = null;
    return 1;
  }

  async parkForReview(id: string, note: string): Promise<number> {
    this.calls.push({ op: 'park', orderId: id });
    const o = this.get(id);
    if (o.state !== 'SENT' && o.state !== 'FAILED') return 0;
    o.state = 'MANUAL_REVIEW';
    o.lastError = note;
    return 1;
  }

  async failStalePending(id: string, note: string): Promise<number> {
    this.calls.push({ op: 'failStale', orderId: id });
    const o = this.get(id);
    if (o.state !== 'PENDING') return 0;
    o.state = 'FAILED';
    o.attempts += 1;
    o.lastError = note;
    return 1;
  }

  async confirmAbsent(id: string, at: Date): Promise<number> {
    this.calls.push({ op: 'absent', orderId: id });
    const o = this.get(id);
    if (o.state !== 'FAILED' || o.absentConfirmedAt !== null) return 0;
    o.absentConfirmedAt = at;
    return 1;
  }
}

// Fix the fake claim() attempt bump: PENDING starts at 0, FAILED already counted.
// (Implemented correctly below by restoring the original state before flipping.)
class CorrectFakeRepo extends FakeRepo {
  override async claim(id: string, txid: string, now: Date): Promise<ClaimResult> {
    const o = this.orders.find((x) => x.id === id);
    if (!o) return { ok: false, reason: 'already_claimed' };
    if (o.state !== 'PENDING' && o.state !== 'FAILED') {
      return { ok: false, reason: 'already_claimed' };
    }
    const wasPending = o.state === 'PENDING';
    o.attempts = wasPending ? 1 : o.attempts + 1;
    o.state = 'SENT';
    o.txid = txid;
    o.sentAt = now;
    o.lastError = null;
    this.calls.push({ op: 'claim', orderId: id });
    return { ok: true, order: { ...o } };
  }
}

class FakeBank implements BankClient {
  sent: { txid: string; amountMinor: bigint; key: string }[] = [];
  statements = new Map<string, StatementEntry[]>();
  script: ((txid: string) => BankSendResponse)[] = [];
  defaultResponse: BankSendResponse = { ok: true, statusText: 'accepted' };
  statementCalls: string[] = [];

  pushResponse(r: BankSendResponse) {
    this.script.push(() => r);
  }

  async send(req: { txid: string; amountMinor: bigint; key: string }): Promise<BankSendResponse> {
    this.sent.push(req);
    const next = this.script.shift();
    return next ? next(req.txid) : this.defaultResponse;
  }

  async getStatement(date: string): Promise<StatementEntry[]> {
    this.statementCalls.push(date);
    return this.statements.get(date) ?? [];
  }
}

class FakeClock {
  private t: number;
  constructor(t: number) {
    this.t = t;
  }
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
  set(ms: number) {
    this.t = ms;
  }
}

function buildService(repo: FakeRepo, bank: FakeBank, clock: FakeClock, maxAttempts = 5) {
  return new PayoutService(repo as unknown as PayoutRepository, bank, clock, { maxAttempts, lagMs: LAG });
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const window0 = (): ReconcileWindow => ({ from: day(T0), to: day(T0) });
const window1 = (): ReconcileWindow => ({ from: day(T0), to: day(T0 + 2 * 24 * 60 * 60 * 1000) });

// ---------- payout.service ----------

describe('PayoutService', () => {
  it('sends PENDING orders with a deterministic txid and parks nothing on accept', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    const r = await svc.executePayments();
    expect(r).toEqual({ executed: 1, skipped: 0 });

    const expectedTxid = hash('ord-1|2025-06-01');
    expect(bank.sent).toHaveLength(1);
    expect(bank.sent[0]).toEqual({ txid: expectedTxid, amountMinor: 12500n, key: 'key-supplier-1' });
    expect(repo.orders[0].state).toBe('SENT');
    expect(repo.orders[0].attempts).toBe(1);
    expect(repo.orders[0].txid).toBe(expectedTxid);
  });

  it('derives the txid purely from order id + effective date', () => {
    expect(deriveTxid('ord-1', '2025-06-01')).toBe(hash('ord-1|2025-06-01'));
    expect(deriveTxid('ord-1', '2025-06-02')).not.toBe(deriveTxid('ord-1', '2025-06-01'));
  });

  it('timeout-but-settled: reconciles to SETTLED and never resends', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    // First attempt times out.
    bank.pushResponse({ ok: false, status: 'timeout', code: 'TIMEOUT' });
    await svc.executePayments();
    expect(repo.orders[0].state).toBe('FAILED');
    expect(repo.orders[0].attempts).toBe(1);

    // No absent-confirmation yet (within publishing lag) -> not re-sent.
    clock.advance(10 * 60 * 1000);
    expect((await svc.executePayments()).executed).toBe(0);

    // Reconcile a window that does not yet contain the settlement date.
    await svc.reconcile(window0());
    expect(repo.orders[0].state).toBe('FAILED');
    expect(repo.orders[0].absentConfirmedAt).toBeNull();

    // The statement shows the txid as settled -> advance to SETTLED.
    const txid = hash('ord-1|2025-06-01');
    bank.statements.set('2025-06-02', [{ txid, amountMinor: 12500n, settledAt: '2025-06-02T09:00:00Z' }]);
    clock.advance(2 * H);
    const r = await svc.reconcile(window1());
    expect(r.settled).toBe(1);
    expect(repo.orders[0].state).toBe('SETTLED');

    // A later execute must not touch it.
    clock.advance(H);
    expect((await svc.executePayments()).executed).toBe(0);
    expect(bank.sent).toHaveLength(1);
  });

  it('proven-absent: reconciliation enables a retry with the same txid', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    bank.pushResponse({ ok: false, status: 503, code: 'SERVICE_UNAVAILABLE' });
    await svc.executePayments();
    expect(repo.orders[0].state).toBe('FAILED');

    // Before the lag elapses, no retry.
    clock.advance(10 * 60 * 1000);
    expect((await svc.executePayments()).executed).toBe(0);

    // Past the lag with an empty statement: proven absent.
    clock.advance(25 * 60 * 1000); // 35 min after send
    const r = await svc.reconcile(window0());
    expect(r.absentConfirmed).toBe(1);
    expect(repo.orders[0].absentConfirmedAt).not.toBeNull();

    // Retry: same txid, attempt 2, succeeds this time.
    const first = bank.sent[0].txid;
    const r2 = await svc.executePayments();
    expect(r2.executed).toBe(1);
    expect(bank.sent).toHaveLength(2);
    expect(bank.sent[1].txid).toBe(first);
    expect(repo.orders[0].attempts).toBe(2);
    expect(repo.orders[0].state).toBe('SENT');

    // Statement confirms -> settled.
    bank.statements.set('2025-06-01', [
      { txid: first, amountMinor: 12500n, settledAt: new Date(T0 + 40 * 60 * 1000).toISOString() },
    ]);
    clock.advance(10 * 60 * 1000);
    const r3 = await svc.reconcile(window0());
    expect(r3.settled).toBe(1);
    expect(repo.orders[0].state).toBe('SETTLED');
  });

  it('attempt exhaustion: parks for manual review after 5 proven-absent failures', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      bank.pushResponse({ ok: false, status: 'timeout', code: 'TIMEOUT' });
      const r = await svc.executePayments();
      expect(r.executed).toBe(1);
      expect(repo.orders[0].state).toBe('FAILED');
      expect(repo.orders[0].attempts).toBe(attempt);

      // Prove absent so the next attempt is allowed (if any remain).
      clock.advance(35 * 60 * 1000);
      const rr = await svc.reconcile(window0());
      if (attempt < 5) {
        expect(rr.absentConfirmed).toBe(1);
      } else {
        expect(rr.parked).toBe(1);
        expect(repo.orders[0].state).toBe('MANUAL_REVIEW');
      }
    }

    // No further execute or reconcile can move it; attempts stay at 5.
    clock.advance(6 * H);
    expect((await svc.executePayments()).executed).toBe(0);
    const rr = await svc.reconcile(window1());
    expect(rr.parked).toBe(0);
    expect(repo.orders[0].state).toBe('MANUAL_REVIEW');
    expect(repo.orders[0].attempts).toBe(5);
  });

  it('a timeout on the 5th attempt settles instead of parking', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    // Four transient failures, each proven absent.
    for (let i = 0; i < 4; i += 1) {
      bank.pushResponse({ ok: false, status: 503, code: 'SERVICE_UNAVAILABLE' });
      await svc.executePayments();
      clock.advance(35 * 60 * 1000);
      await svc.reconcile(window0());
    }
    expect(repo.orders[0].attempts).toBe(4);

    // 5th attempt times out; the statement still shows it settled.
    bank.pushResponse({ ok: false, status: 'timeout', code: 'TIMEOUT' });
    await svc.executePayments();
    expect(repo.orders[0].attempts).toBe(5);
    const txid = hash('ord-1|2025-06-01');
    bank.statements.set('2025-06-01', [{ txid, amountMinor: 12500n, settledAt: new Date().toISOString() }]);
    clock.advance(35 * 60 * 1000);
    const r = await svc.reconcile(window0());
    expect(r.settled).toBe(1);
    expect(repo.orders[0].state).toBe('SETTLED');
    expect(repo.orders[0].lastError).toBeNull();
  });

  it('duplicate response: no extra attempt, no double count', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    bank.pushResponse({ ok: false, status: 'timeout', code: 'TIMEOUT' });
    await svc.executePayments();
    clock.advance(35 * 60 * 1000);
    await svc.reconcile(window0());

    // Retry hits the bank's idempotency store.
    bank.pushResponse({ ok: true, statusText: 'duplicate' });
    const r = await svc.executePayments();
    expect(r.executed).toBe(1);
    expect(repo.orders[0].state).toBe('SENT');
    expect(repo.orders[0].attempts).toBe(2);
    expect(repo.orders[0].lastError).toContain('duplicate');

    bank.statements.set('2025-06-01', [
      { txid: bank.sent[0].txid, amountMinor: 12500n, settledAt: new Date().toISOString() },
    ]);
    clock.advance(10 * 60 * 1000);
    expect((await svc.reconcile(window0())).settled).toBe(1);
    expect(repo.orders[0].state).toBe('SETTLED');
  });

  it('permanent rejection: parked for manual review immediately', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    bank.pushResponse({ ok: false, status: 422, code: 'INVALID_KEY', message: 'key not found' });
    await svc.executePayments();
    expect(repo.orders[0].state).toBe('MANUAL_REVIEW');
    expect(repo.orders[0].lastError).toContain('INVALID_KEY');
    expect(repo.orders[0].attempts).toBe(1);

    // Never auto-reverted, never re-sent.
    clock.advance(6 * H);
    expect((await svc.executePayments()).executed).toBe(0);
    expect(bank.sent).toHaveLength(1);
  });

  it('amount mismatch in the statement parks instead of settling', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    await svc.executePayments(); // accepted
    expect(repo.orders[0].state).toBe('SENT');

    const txid = hash('ord-1|2025-06-01');
    bank.statements.set('2025-06-01', [{ txid, amountMinor: 9999n, settledAt: new Date().toISOString() }]);
    clock.advance(35 * 60 * 1000);
    const r = await svc.reconcile(window0());
    expect(r.settled).toBe(0);
    expect(r.mismatches).toBe(1);
    expect(repo.orders[0].state).toBe('MANUAL_REVIEW');
  });

  it('overlapping windows are idempotent: a second run changes nothing', async () => {
    const repo = new CorrectFakeRepo([makeOrder({ state: 'SENT', attempts: 1, txid: hash('ord-1|2025-06-01'), sentAt: new Date(T0) })]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    const txid = hash('ord-1|2025-06-01');
    bank.statements.set('2025-06-01', [{ txid, amountMinor: 12500n, settledAt: new Date(T0).toISOString() }]);
    const first = await svc.reconcile(window0());
    expect(first.settled).toBe(1);
    expect(repo.orders[0].state).toBe('SETTLED');

    // Same window again, shifted, and overlapping.
    clock.advance(15 * 60 * 1000);
    const second = await svc.reconcile(window1());
    expect(second.settled).toBe(0);
    expect(second.absentConfirmed).toBe(0);
    expect(second.parked).toBe(0);
    expect(second.mismatches).toBe(0);
    expect(repo.orders[0].state).toBe('SETTLED');
  });

  it('a stale PENDING (crashed send) becomes FAILED via reconciliation and retries next round', async () => {
    const repo = new CorrectFakeRepo([
      makeOrder({ sentAt: new Date(T0), txid: hash('ord-1|2025-06-01') }),
    ]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    clock.advance(40 * 60 * 1000);
    const r = await svc.reconcile(window0());
    expect(r.parked).toBe(1);
    expect(repo.orders[0].state).toBe('FAILED');
    expect(repo.orders[0].attempts).toBe(1);

    // Not yet proven absent at this instant? sentAt is 40 min old -> proven.
    // It is now retryable on the next execute.
    const r2 = await svc.executePayments();
    expect(r2.executed).toBe(1);
    expect(repo.orders[0].attempts).toBe(2);
    expect(repo.orders[0].txid).toBe(hash('ord-1|2025-06-01'));
  });

  it('unknown txids in the statement are ignored', async () => {
    const repo = new CorrectFakeRepo([makeOrder({ state: 'SENT', attempts: 1, txid: hash('ord-1|2025-06-01'), sentAt: new Date(T0) })]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    bank.statements.set('2025-06-01', [
      { txid: 'unknown-txid', amountMinor: 100n, settledAt: new Date(T0).toISOString() },
    ]);
    clock.advance(40 * 60 * 1000);
    const r = await svc.reconcile(window0());
    expect(r.entries).toBe(1);
    expect(r.settled).toBe(0);
    expect(repo.orders[0].state).toBe('SENT');
  });

  it('iterDays covers inclusive calendar days', () => {
    expect([...iterDays('2025-06-01', '2025-06-01')]).toEqual(['2025-06-01']);
    expect([...iterDays('2025-06-01', '2025-06-03')]).toEqual(['2025-06-01', '2025-06-02', '2025-06-03']);
  });
});

// ---------- payout.controller ----------

describe('PayoutController', () => {
  async function buildController() {
    const service = {
      executePayments: vi.fn(async () => ({ executed: 1, skipped: 0 })),
      reconcile: vi.fn(async () => ({ scannedDays: 1, entries: 0, settled: 0, absentConfirmed: 0, parked: 0, mismatches: 0 })),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [PayoutController],
      providers: [{ provide: 'PayoutService', useValue: service }],
    }).compile();
    const controller = moduleRef.get(PayoutController);
    return { controller, service };
  }

  it('execute posts to the service', async () => {
    const { controller, service } = await buildController();
    const r = await controller.execute({});
    expect(r).toEqual({ executed: 1, skipped: 0 });
    expect(service.executePayments).toHaveBeenCalledTimes(1);
  });

  it('reconcile defaults to today when no window is given', async () => {
    const { controller, service } = await buildController();
    await controller.reconcile({});
    const today = new Date().toISOString().slice(0, 10);
    expect(service.reconcile).toHaveBeenCalledWith({ from: today, to: today });
  });

  it('reconcile forwards an explicit window', async () => {
    const { controller, service } = await buildController();
    await controller.reconcile({ from: '2025-06-01', to: '2025-06-02' });
    expect(service.reconcile).toHaveBeenCalledWith({ from: '2025-06-01', to: '2025-06-02' });
  });

  it('reconcile rejects a window whose start is after its end', async () => {
    const { controller } = await buildController();
    await expect(controller.reconcile({ from: '2025-06-02', to: '2025-06-01' })).rejects.toThrow(
      /start must not be after end/,
    );
  });
});
```
