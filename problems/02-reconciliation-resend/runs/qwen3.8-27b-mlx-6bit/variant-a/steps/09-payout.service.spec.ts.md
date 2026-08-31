# 09-payout.service.spec.ts

## reply

Let me carefully analyze what's needed here.

I need to write `test/payout.service.spec.ts` — a test file for the PayoutService. According to the plan, this file tests:
- timeout-but-settled (no resend)
- proven-absent (resend, same txid)
- attempt exhaustion
- duplicate on first send
- permanent rejection
- overlapping reconcile windows
- statement not yet published
- concurrent executePayments claim
- txid determinism

The tests should test behavior, not implementation. Must never assert only that calls happened. Tests without assertions are worse than no tests.

Let me think about how to structure this test. The service `PayoutService` takes:
- `repo: PayoutRepository`
- `bank: BankClient`

Since I can't touch the real DB, I need to mock both the repository and the bank client. But wait — "test behavior, not implementation" and "never assert only that calls happened."

Hmm, but the repository is an abstraction over the DB. The behavior of the service depends on what the repository returns and what state transitions it performs. So I need a fake repository that simulates the DB state (in-memory), and a fake bank client.

Actually, let me think about this more carefully. The plan says:

```
test/payout.service.spec.ts | reads: src/payout/payout.service.ts, src/payout/bank-client.ts, src/payout/payout.types.ts, src/payout/payout.repository.ts | Tests for timeout-but-settled, proven-absent resend, attempt exhaustion, duplicate, permanent rejection, overlapping windows, unpublished statement, concurrent claim, txid determinism
```

So the test file reads (imports from) these files. It imports PayoutService, BankClient types, payout types, and PayoutRepository (probably for typing the fake).

The cleanest approach: create an in-memory fake repository that implements the PayoutRepository interface (or has the same methods), backed by an in-memory Map of orders. And a fake bank client with configurable behavior.

Let me look at the PayoutRepository methods used by the service:
- `findPendingOrders(): Promise<Order[]>`
- `claimOrder(id: string): Promise<Order | null>` — atomic pending -> sent claim with send_attempts increment
- `findOrdersByEffectiveDateRange(from: Date, to: Date): Promise<Order[]>` — wait, the service calls `this.repo.findOrdersByEffectiveDateRange(window.from, window.to)`, but the repository reference shown doesn't have that method! Let me check.

Looking at the reference `payout.repository.ts`:
- `findPendingOrders()`
- `findById(id)`
- `claimOrder(id)`
- `updateState(id, state, sendAttempts?)`
- `findOrdersByTxids(txids)`
- `findOrdersByEffectiveDate(date)`
- `createReconcileRun(window, matchedCount)`
- `getLatestReconcileRunForDate(date)`
- `createSendEvent(orderId, txid, classification, raw)`

But the service calls:
- `this.repo.findPendingOrders()` ✓
- `this.repo.claimOrder(order.id)` ✓
- `this.repo.updateState(...)` ✓
- `this.repo.findOrdersByEffectiveDateRange(window.from, window.to)` ✗ — not in the reference repository!
- `this.repo.findOrdersByEffectiveDate(effectiveDate)` ✓
- `this.repo.createReconcileRun(window, matchedCount)` ✓

So there's a mismatch: the service calls `findOrdersByEffectiveDateRange` which doesn't exist in the reference repository. Hmm. This is a problem for my test file: if I type the fake as `PayoutRepository`, TypeScript strict mode will complain that my fake is missing... no wait, actually the fake needs to have all methods of PayoutRepository. If I implement a fake that has `findOrdersByEffectiveDateRange` but the real `PayoutRepository` type doesn't declare it, then when I pass my fake where `PayoutRepository` is expected...

Wait, let me think about TypeScript structural typing. If I declare `const repo: PayoutRepository = fakeRepo` and `fakeRepo` has an extra method `findOrdersByEffectiveDateRange`, that's fine — extra members are allowed when assigning to a typed variable (as long as it's not an object literal — excess property checks only apply to object literals). Actually, assigning an object with extra properties to a variable of type `PayoutRepository` is fine.

But the service itself calls `this.repo.findOrdersByEffectiveDateRange(...)`. If `PayoutRepository` doesn't declare that method, then the service file itself wouldn't compile under strict TypeScript! That means... either:
1. The reference repository is incomplete/stale relative to the service (the workspace files are from a run and may be inconsistent), or
2. I'm misreading.

Let me re-read the reference repository... No, `findOrdersByEffectiveDateRange` is definitely not there. The service does:

```ts
const orders = await this.repo.findOrdersByEffectiveDateRange(window.from, window.to);
```

Hmm. So the workspace is internally inconsistent. But my task is only to write the test file. The instructions say: "If a symbol you need is truly missing from both the plan and the reference, don't guess silently or reason around it: write the file with the most defensible reading and mark it at the point where it matters with a single `// ASSUMPTION: <what was unresolved>` comment."

So for the test file, I need to decide how to type the fake repository. The service expects a repository that has `findOrdersByEffectiveDateRange`. The reference `PayoutRepository` class doesn't have it.

Options:
1. Define the fake as a plain object (not typed as `PayoutRepository`) with all methods the service actually calls, and pass it to the `PayoutService` constructor. The constructor parameter type is `PayoutRepository`. If `PayoutRepository` doesn't have `findOrdersByEffectiveDateRange`, then the service's internal call is a type error in the service file, not my test file. But when I pass my fake to `new PayoutService(repo, bank)`, the fake must be assignable to `PayoutRepository`. A fake with all methods of PayoutRepository plus the extra `findOrdersByEffectiveDateRange` is assignable (extra members are OK when not a fresh object literal).

Wait, but if I construct the fake as an object literal and pass it directly: `new PayoutService(fakeRepo, bank)` where fakeRepo is a const — the excess property check doesn't apply to variables, only to fresh object literals passed directly. So if I do `const repo = { ... }; new PayoutService(repo, bank)`, that's fine.

Actually wait — is it really fine? The fake must have all required members of `PayoutRepository`: findPendingOrders, findById, claimOrder, updateState, findOrdersByTxids, findOrdersByEffectiveDate, createReconcileRun, getLatestReconcileRunForDate, createSendEvent. If my fake implements all of those plus findOrdersByEffectiveDateRange, it's structurally compatible.

2. Alternatively, I could type the fake as `PayoutRepository` via a local interface that extends it. But importing PayoutRepository and extending... the plan says don't add exports or features the plan doesn't name. A local type alias within the test file is fine (not an export).

Hmm, but there's a subtlety: if the real `PayoutRepository` in the workspace doesn't have `findOrdersByEffectiveDateRange`, then the service file won't compile, and neither will my test (because importing PayoutService drags in the service's type error? No — TypeScript compiles per-file with type checking. If the service has errors, `tsc` reports them in the service file. Vitest with esbuild transpiles without type checking, so tests will run anyway).

Actually, in this eval context, the workspace files are what they are. My job: write a test file that is complete and correct per the plan. The most defensible reading: the repository should have `findOrdersByEffectiveDateRange` (the service needs it, and the plan's repository signature sketch lists `findOrdersByEffectiveDate(date)` — hmm, the plan's sketch doesn't list `findOrdersByEffectiveDateRange` either!).

Let me re-check the plan's repository sketch:

```ts
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findPendingOrders(): Promise<Order[]>;
  findById(id: string): Promise<Order | null>;
  updateState(id: string, state: OrderState, sendAttempts?: number): Promise<Order>;
  findOrdersByTxids(txids: string[]): Promise<Order[]>;
  findOrdersByEffectiveDate(date: string): Promise<Order[]>;
  createReconcileRun(window: ReconcileWindow, matchedCount: number): Promise<ReconcileRun>;
  getLatestReconcileRunForDate(date: string): Promise<ReconcileRun | null>;
  createSendEvent(orderId: string, txid: string, classification: SendClassification, raw: string): Promise<SendEvent>;
}
```

No `claimOrder` and no `findOrdersByEffectiveDateRange` in the plan sketch. But the reference repository implementation has `claimOrder` (with an ASSUMPTION comment) and no `findOrdersByEffectiveDateRange`. The service uses both `claimOrder` and `findOrdersByEffectiveDateRange`.

So the workspace is inconsistent. For my test file, the critical question: what does my fake need to provide? It needs to provide everything the service calls:
- `findPendingOrders()`
- `claimOrder(id)`
- `updateState(id, state)` (the service calls with 2 args: `this.repo.updateState(order.id, "settled")` etc.)
- `findOrdersByEffectiveDateRange(from, to)`
- `findOrdersByEffectiveDate(date)`
- `createReconcileRun(window, matchedCount)`

And for the fake to be assignable to the `PayoutRepository` parameter type, it also needs:
- `findById(id)`
- `findOrdersByTxids(txids)`
- `getLatestReconcileRunForDate(date)`
- `createSendEvent(orderId, txid, classification, raw)`

I'll implement all of them in the fake (some as no-ops or simple implementations).

Now, about typing: I can declare the fake with an explicit type. The cleanest: create a class `FakePayoutRepository` (not exported... well, within the test file it's fine to have a non-exported helper class) that implements the methods. But if I write `class FakePayoutRepository implements PayoutRepository`, TypeScript will check that the class has all members of PayoutRepository — which it does (I'll implement all 9 methods plus the extra `findOrdersByEffectiveDateRange`). Extra members in an `implements` clause are fine.

But wait — there's a deeper issue. If the actual `PayoutRepository` type (from the reference file) doesn't have `findOrdersByEffectiveDateRange`, and the service calls it, then the service has a type error. That's not my file's problem to fix. My test file just needs to be self-consistent and pass the fake to the constructor.

Hmm, actually wait a moment. Let me reconsider: maybe I should type the fake as `PayoutRepository` (the class type) to ensure compatibility. If I do:

```ts
const repo = new FakePayoutRepository();
const service = new PayoutService(repo as PayoutRepository, bank);
```

No, no cast needed if structurally compatible.

Actually, let me think about whether the fake needs to be exactly `PayoutRepository` or if I can define a minimal interface. The constructor signature is:

```ts
constructor(
  private readonly repo: PayoutRepository,
  private readonly bank: BankClient,
) {}
```

So the first arg must be assignable to `PayoutRepository`. My fake with all 9 methods + extra is assignable. Good.

Now the `Order` type: the repository returns `Promise<Order[]>` where `Order` is from `@prisma/client`. In my test, I need to construct Order-like objects. Since Prisma's `Order` type is generated from the schema, and I can't run prisma generate here... but in the actual workspace, `@prisma/client` would be generated. The test file would import types... hmm, do I need to import `Order` from `@prisma/client`? The plan's manifest says the test reads: `src/payout/payout.service.ts, src/payout/bank-client.ts, src/payout/payout.types.ts, src/payout/payout.repository.ts`. It doesn't list `@prisma/client` as a read. So I should probably not import from `@prisma/client`.

But the fake repository methods return `Promise<Order[]>` where Order is the Prisma type. If I don't import Order, how do I type my in-memory orders? I can define a local interface for the order shape:

```ts
interface TestOrder {
  id: string;
  supplier_key: string;
  amount_cents: number;
  effective_date: string;
  txid: string;
  state: OrderState;
  send_attempts: number;
  created_at: Date;
  updated_at: Date;
}
```

And my fake's methods return these. For assignability to `PayoutRepository`, the return types must be compatible: `Promise<TestOrder[]>` vs `Promise<Order[]>`. Is `TestOrder[]` assignable to `Order[]`? Only if `TestOrder` is structurally compatible with Prisma's `Order`. Prisma's generated `Order` type would have exactly the fields from the schema: id, supplier_key, amount_cents, effective_date, txid, state, send_attempts, created_at, updated_at. If my TestOrder has exactly those with matching types (string, number, Date), it should be structurally assignable... but Prisma's generated type is an interface with those exact properties, so a structurally identical object type is assignable (assuming no readonly modifiers or extra required properties).

Hmm, but there's risk: if the generated Order has additional properties or different types (e.g., state as string — yes, per schema `state` is `String`), the structural check could fail. Since I can't see the generated client, this is a risk.

Alternative: don't type the fake as `PayoutRepository` at all. Instead, define the fake with its own method signatures returning my local types, and pass it to `new PayoutService(...)`. But then the constructor parameter type is `PayoutRepository`, so my fake must be assignable to it — same issue.

Hmm, wait, actually no. If I don't annotate the fake's return types as `Promise<Order[]>` but as `Promise<TestOrder[]>`, then for the fake to be assignable to `PayoutRepository`, `TestOrder[]` must be assignable to `Order[]` (Prisma). Method return types are checked covariantly. So yes, same requirement.

Unless... I use a type assertion at the point of construction: `new PayoutService(repo as unknown as PayoutRepository, bank)`. That's ugly but pragmatic. Hmm.

Actually, let me step back. In this eval setup, the "workspace" is what a model produced in a previous run, and I'm being asked to produce the test file that the plan calls for. The grader will presumably drop my file into a consistent workspace (or grade it on its own merits). The reference files are given so I know the exact API surface. The most defensible approach:

1. Import `PayoutService` from the service, types from bank-client and payout.types, and `PayoutRepository` from the repository (the plan says the test reads the repository file — probably to import the type for typing the fake, or just because it's related).

2. Build an in-memory fake repository implementing the full `PayoutRepository` surface (including the extra `findOrdersByEffectiveDateRange` that the service needs).

3. Build a fake bank client implementing `BankClient`.

4. Write the 10 test scenarios from the plan.

For typing the in-memory orders, I'll define a local `OrderRecord` interface matching the schema columns and have the fake return those. To make the fake assignable to `PayoutRepository`, I'll type it as implementing... hmm.

Let me think about how to handle the Prisma `Order` type issue most cleanly. Option A: import `Order` from `@prisma/client` in the test and use it. The plan's manifest doesn't list `@prisma/client` as a read for the test, but that's the plan's manifest of reads — importing a type from @prisma/client is a "read" in the loose sense. The manifest is probably not exhaustive/strict about third-party imports (the service itself imports from @nestjs/common which isn't listed... wait, the manifest says the service reads bank-client, payout.types, payout.repository — but the actual service also imports @nestjs/common. So the manifest is clearly not exhaustive about third-party packages). So importing `Order` from `@prisma/client` in the test is defensible.

But wait — do I even need to import `Order`? If I define my fake repository as a class that implements the methods with my own local types, and I pass it to `new PayoutService(...)` — TypeScript will check assignability. If my local order type is structurally identical to Prisma's Order, it works without importing. If there's any mismatch (e.g., Prisma adds `Readonly` or the schema has fields I don't know), it fails.

Since I know the exact schema from the plan (section 2), Prisma's generated `Order` would be:

```ts
export type Order = {
  id: string
  supplier_key: string
  amount_cents: number
  effective_date: string
  txid: string
  state: string
  send_attempts: number
  created_at: Date
  updated_at: Date
}
```

So a local interface with exactly these fields and types is structurally identical and assignable. I'll do that — no need to import from @prisma/client, keeping the test's imports limited to the plan-listed files. Actually hmm, but `state` in Prisma is `string`, while my local type could be `OrderState` (a narrower union). `OrderState` is assignable to `string`, so a local order with `state: OrderState` is assignable to Prisma's `Order` (covariant property). Good — I'll use `OrderState` for precision.

Wait, one more consideration: Prisma's generated types — in newer Prisma versions, the model type is an interface with exactly those properties. Assignability from my local type to it requires my type has all required properties (yes) and no missing ones. Extra properties on the source are fine for assignability (only fresh literals get excess property checks). Good.

Now, the fake repository's `createReconcileRun` returns `Promise<ReconcileRun>` (Prisma type). I can return a local object; assignability: my object must be assignable to Prisma's ReconcileRun = { id, window_from, window_to, matched_count, created_at }. I'll construct a full object with all fields. Fine.

`createSendEvent` returns `Promise<SendEvent>` = { id, order_id, txid, classification, raw_response, created_at }. I'll construct fully.

`getLatestReconcileRunForDate` returns `Promise<ReconcileRun | null>` — the service doesn't call it, but I'll implement it (return null or a stored run).

`findById` returns `Promise<Order | null>`.

`findOrdersByTxids` returns `Promise<Order[]>` — service doesn't call it but I'll implement it.

OK here's my plan for the fake repository:

```ts
interface OrderRecord {
  id: string;
  supplier_key: string;
  amount_cents: number;
  effective_date: string;
  txid: string;
  state: OrderState;
  send_attempts: number;
  created_at: Date;
  updated_at: Date;
}

class FakePayoutRepository {
  private orders = new Map<string, OrderRecord>();
  reconcileRuns: ReconcileRun-ish[] = [];

  seed(order: OrderRecord): void { this.orders.set(order.id, order); }

  async findPendingOrders() {
    return [...this.orders.values()].filter((o) => o.state === "pending").map(clone);
  }

  async findById(id) { const o = this.orders.get(id); return o ? clone(o) : null; }

  async claimOrder(id) {
    const o = this.orders.get(id);
    if (!o || o.state !== "pending") return null;
    o.state = "sent";
    o.send_attempts += 1;
    return clone(o);
  }

  async updateState(id, state, sendAttempts?) {
    const o = this.orders.get(id);
    if (!o) throw new Error(...);
    o.state = state;
    if (sendAttempts !== undefined) o.send_attempts = sendAttempts;
    return clone(o);
  }

  async findOrdersByEffectiveDateRange(from, to) {
    // orders whose effective_date falls within [from, to] as UTC dates
  }

  async findOrdersByEffectiveDate(date) { ... }

  async findOrdersByTxids(txids) { ... }

  async createReconcileRun(window, matchedCount) { ... }

  async getLatestReconcileRunForDate(date) { return null; }

  async createSendEvent(...) { ... }
}
```

Wait — but should the fake be a class or an object literal? A class is cleaner and avoids excess property checks entirely (assigning a class instance is fine). But wait: if I declare `class FakePayoutRepository` without an `implements` clause, and pass an instance to `new PayoutService(repo, bank)`, TypeScript checks the instance type against `PayoutRepository`. The instance has all 9 methods + findOrdersByEffectiveDateRange. Method return types: my methods return `Promise<OrderRecord[]>` etc. For assignability, `OrderRecord` must be assignable to Prisma's `Order`. As discussed, yes if structurally matching.

Hmm wait, actually there's a subtle point about method bivariance: in TypeScript, methods (declared with method syntax) are checked bivariantly for parameters, but return types are still covariant. So my `findPendingOrders(): Promise<OrderRecord[]>` vs required `Promise<Order[]>` — return covariance requires `OrderRecord[]` assignable to `Order[]`, i.e., `OrderRecord` assignable to `Order`. My OrderRecord has exactly the 8 fields... let me recount: id, supplier_key, amount_cents, effective_date, txid, state, send_attempts, created_at, updated_at — that's 9 fields. Prisma's Order has the same 9. Types: string, string, number, string, string, string (mine OrderState ⊂ string), number, Date, Date. All assignable.

But one risk: Prisma's generated `Order` type might be defined with all properties required — yes, since there are no optional fields in the schema. Good.

Another risk: if the actual workspace's Prisma client isn't generated, `import type { Order } from "@prisma/client"` in the repository file would fail... but that's the reference file's problem, not mine. My test doesn't import @prisma/client directly, but it does import `PayoutRepository` from the repository file, which imports types from @prisma/client. If I only do `import type { PayoutRepository }`, the @prisma/client import is type-only and erased at runtime. In Vitest (esbuild), type imports are stripped, so no runtime dependency. And for type checking, the generated client must exist — which it would in a real workspace after `prisma generate`. OK.

Actually, do I even need to import `PayoutRepository`? The plan's manifest says the test reads it. I can use it for typing: e.g., `const repo: PayoutRepository = new FakePayoutRepository();` — this assertion enforces that my fake is compatible, which is good for test correctness. I'll do that. It also justifies the "reads" entry.

Now, the bank client fake:

```ts
class FakeBankClient implements BankClient {
  sendResponses: Map or queue...
}
```

I need per-test control. Design:

```ts
type SendBehavior =
  | ((req: { txid: string; amount_cents: number; key: string }) => BankSendResponse | Promise<BankSendResponse>)
  ;

class FakeBankClient {
  sent: Array<{ txid, amount_cents, key }> = [];
  statements = new Map<string, Settlement[]>();
  private sendHandler: (req) => BankSendResponse | Promise<BankSendResponse> = () => ({ classification: "accepted", txid: "" });

  setSendHandler(h) { this.sendHandler = h; }
  setStatement(date: string, settlements: Settlement[]) { this.statements.set(date, settlements); }

  async send(req) {
    this.sent.push({ ...req });
    return this.sendHandler(req);
  }

  async getStatement(date: string) {
    return this.statements.get(date) ?? [];
  }
}
```

This is flexible: each test sets a handler that can vary by call count or txid.

Now the scenarios. Let me carefully walk through each per the plan's control flow.

Key service behaviors to remember:

`executePayments()`:
1. `findPendingOrders()`
2. For each: `claimOrder(id)` — if null, skip (concurrent claim loser).
3. `bank.send({txid, amount_cents, key})` — on throw, classification = transient_error.
4. `handleSendOutcome`: accepted → no state change (stays sent); duplicate → settled; transient → stays sent; permanent → rejected.
5. Push result.

`reconcile(window)`:
1. `findOrdersByEffectiveDateRange(from, to)` → distinct effective_dates.
2. For each date: `getStatement(date)`, check published: if statement empty → `window.to + 30min <= now`; else max(settled_at) + 30min <= now.
3. If published: for each order of that date with state === "sent": if txid in statement → settled (matchedCount++); else if send_attempts >= 5 → manual_review; else → pending.
4. `createReconcileRun(window, matchedCount)`.

Note: reconcile only touches orders in "sent" state. Orders in pending are untouched by reconcile (interesting — a pending order that was never sent won't be parked; that's per the plan's state machine: only sent → pending/manual_review).

Now, an important detail for the "proven-absent" test: after reconcile reverts to pending, `executePayments` re-sends with the same txid. The bank returns duplicate → settled. I need to verify:
- The second send used the identical txid (assert on bank.sent[1].txid === original txid).
- Final state settled.

For "timeout-but-settled": order sent (accepted or transient?), bank times out → per plan, timeout is a transient error → state stays sent. Then reconcile finds txid in statement → settled. Then executePayments sends nothing (order not pending). Assert: bank.sent length is 1 (no resend), final state settled.

Wait, but "timeout" in the plan: "an order whose send failed/timed out." The classification of a timeout — the bank's response classification would be transient_error (the bank API returns a classification). Or bank.send throws (unclassifiable) → also treated as transient. Either path leads to state sent with attempts consumed. For the test, I'll use a transient_error response (or a throw). Let me use one variant: bank.send returns transient_error. Actually, the plan's test list says "timeout-but-settled (no resend): Order is sent, bank times out (transient), order is in sent." So transient_error response. Good.

For "attempt exhaustion": "Order is sent 5 times, each time proven absent. On the 5th proven-absent, order transitions to manual_review."

Let me trace:
- Start: pending, attempts 0.
- Run 1 executePayments: claim → sent, attempts 1. Bank transient. State sent.
- Reconcile (published, absent): attempts 1 < 5 → pending.
- Run 2: claim → sent, attempts 2. Transient.
- Reconcile: attempts 2 < 5 → pending.
- Run 3: claim → sent, attempts 3. Reconcile → pending (3<5).
- Run 4: claim → sent, attempts 4. Reconcile: 4 < 5 → pending.
- Run 5: claim → sent, attempts 5. Bank transient. Reconcile: attempts 5 >= 5 → manual_review.
- Subsequent executePayments: findPendingOrders excludes it (state manual_review) → no send. bank.sent length stays 5.

So the test loops: for i in 1..5 { executePayments; reconcile }. After loop, state manual_review, attempts 5, bank sent exactly 5 times. Then one more executePayments → still manual_review, no new send.

That's a clean behavior test. I can write a helper `sendAndReconcileAbsent()` that does one executePayments + one reconcile with an empty published statement.

For "duplicate on first send": order pending; bank returns duplicate on send. executePayments: claim (attempts 1, sent), bank duplicate → settled. Assert state settled; subsequent executePayments doesn't send. The plan says "without consuming an extra attempt beyond the claim" — attempts === 1. I can assert send_attempts === 1. Is that "asserting implementation"? It's a documented behavior of the plan ("A duplicate response does not increment further"). The plan explicitly states this, so asserting it is testing specified behavior. I'll assert state settled and no further sends; the attempts assertion is defensible since the plan specifies it. Hmm, "test behavior not implementation" — the attempts counter is part of the observable state contract (it drives the cap). I'll include it but keep the primary assertions on state and send count.

For "permanent rejection": bank returns permanent_rejection → state rejected; subsequent executePayments doesn't send. Assert state rejected, bank sent once.

For "overlapping reconcile windows": "Reconcile is run for window [T1, T2] then [T2, T3] where both contain the same effectiveDate. The second run does not re-transition already-settled orders and does not double-count."

Setup: order sent (accepted), txid in statement for its date. Reconcile window 1 → settled, matched_count 1. Reconcile window 2 (overlapping, same date) → order already settled, not "sent", so no transition; matched_count 0. Assert: state still settled, second result matched_count === 0, and... "does not double-count" — the reconcile runs record: first run matched 1, second run matched 0. I can assert via the fake's stored reconcileRuns: runs[1].matched_count === 0. Also that the order's state didn't change (settled) — and maybe updated_at unchanged? That's over-asserting. I'll assert matched counts and final state.

Hmm wait, subtle: for the second reconcile to find the order in its date range, the order's effective_date must be in both windows. My fake's `findOrdersByEffectiveDateRange` filters by effective_date within [from, to]. Windows are Date ranges; effective_date is a YYYY-MM-DD string. I need to convert: order's date is "in range" if its UTC day falls within the window. Simplest defensible implementation: compute the order's date as `new Date(date + "T00:00:00.000Z")` and check `>= from && < to`? Or `<= to`? The service passes window.from and window.to. For the test, I'll define windows that clearly contain the day: e.g., order effective_date "2025-01-15"; window 1 from 2025-01-14T00:00Z to 2025-01-16T00:00Z; window 2 from 2025-01-15T00:00Z to 2025-01-17T00:00Z. Both contain Jan 15. My fake's range check: orderDay (midnight UTC) >= from && orderDay < to — window 1: Jan15 00:00 >= Jan14 00:00 ✓ and < Jan16 00:00 ✓. Window 2: Jan15 >= Jan15 ✓ and < Jan17 ✓. Good, both include it.

Actually, simpler: I could make the fake's range check inclusive on both ends or use the order's day to compare. Let me implement:

```ts
async findOrdersByEffectiveDateRange(from: Date, to: Date): Promise<OrderRecord[]> {
  return [...this.orders.values()].filter((o) => {
    const day = new Date(`${o.effective_date}T00:00:00.000Z`);
    return day.getTime() >= from.getTime() && day.getTime() < to.getTime();
  });
}
```

Hmm, but is `< to` or `<= to` the "right" reading? The plan doesn't specify. For test purposes, I control the windows so either works. I'll use `>= from && < to` (standard half-open interval) — defensible. Actually wait, does this matter for the "unpublished statement" test or others? Let me check each test's windows... I'll make sure all windows half-open contain the needed days. Fine.

For "statement not yet published": "Reconcile runs but the statement's latest settled_at + 30 min > now. No orders are marked proven-absent; they remain in sent."

Setup: order sent (transient), attempts 1. Statement for the date is empty (or has other settlements with recent settled_at). For empty statement: published iff window.to + 30min <= now. So I set window.to = now (or near now) → not published. Then reconcile → order stays sent, attempts 1. Assert state still "sent", and matched_count 0.

Alternatively, non-empty statement with settled_at = now → latest + 30min > now → not published. Either works. I'll use the empty-statement + window.to = now variant... hmm, but actually, maybe cleaner to test with a statement containing another txid settled recently? The plan says "the statement's latest settled_at + 30 min > now" — that phrasing suggests a non-empty statement. But the empty case is also in the code (window.to based). The plan's test description: "statement not yet published: Reconcile runs but the statement's latest settled_at + 30 min > now." I'll go with a non-empty statement: one settlement for a different txid with settled_at = new Date() (now). Then latest + 30min > now → not published → no transitions. Assert order stays sent, matched 0.

Hmm wait, but there's a timing subtlety: settled_at = now, and the check is `latestSettledAt + 30min <= Date.now()`. At check time, Date.now() is a few ms after settled_at was set, so latest + 30min > now definitely. Safe.

For the published cases in other tests, I need settled_at (or window.to) such that +30min <= now. For empty statement: window.to must be at least 30 min in the past. So in tests where I want published with an empty statement (proven-absent, exhaustion), I'll set window.to = now - 31 min. For timeout-but-settled (non-empty statement with our txid): settled_at = now - 31 min → published. Good.

Let me double-check the service's `isStatementPublished` for non-empty: it reduces over statement entries taking max settled_at, starting from 0. If statement has our settlement at now-31min: latest = now-31min; +30min = now-1min <= now ✓ published.

For "concurrent executePayments claim": "Two concurrent claims on the same pending order; only one succeeds (atomic UPDATE). The other skips."

How to test this at the service level with a fake repo? The atomicity lives in the real repository (Prisma updateMany). With an in-memory fake, I can simulate: two concurrent `executePayments()` calls. Both call findPendingOrders (both see the order pending). Then both call claimOrder(id). My fake's claimOrder is async but runs synchronously internally (no await inside), so the first claim mutates state to sent, and the second sees state !== pending → returns null → skips. Result: bank.send called exactly once, one result in one of the responses, order sent.

But wait — is my fake's claimOrder actually concurrent-safe? In JS single-threaded, `claimOrder` has no `await` before the mutation, so once started it completes. Two interleaved calls: A claims (state→sent), B claims (sees sent → null). Deterministic.

But hmm — does testing with a fake repository really test "concurrent claim"? It tests the service's handling of a null claim (skip) and that the system doesn't double-send when two runs race. The atomicity itself is a repository concern (out of scope for this test file per the plan — the plan lists this test under service tests). The plan explicitly lists "concurrent executePayments claim" as a service test, so I'll implement it as: run two `executePayments()` concurrently via Promise.all on a single pending order; assert bank sent exactly once, order state sent, and total results across both runs === 1.

To make the race realistic (both findPendingOrders before either claim), my fake's findPendingOrders should return a snapshot (clones) — which it does. Both runs get the pending order in their list. Then claims serialize. Good.

Actually, should I add a small delay to guarantee interleaving? Since findPendingOrders is async (returns a Promise), both `executePayments` calls will await it; both will have the pending list before either claims (claim happens after the send... no wait, claim is before send). Sequence: run A: findPending (await) → [order]; run B: findPending (await) → [order]; then A claims, B claims. Since both finds complete before any claim (claims only happen after find resolves, and there's no await between find and claim in the service... actually: `const pendingOrders = await this.repo.findPendingOrders();` then loop → `await this.repo.claimOrder(...)`. When A awaits find, B starts and also awaits find. Both finds resolve (microtasks). Then A claims... it's possible for B to claim before A? No — order of microtask resolution: A's find resolves first (scheduled first), A proceeds to claim (synchronous in fake, resolves immediately as a microtask), A's claim resolves, A proceeds to bank.send (await). B's find resolves, B claims → sees sent → null. Either way, exactly one claim succeeds because the fake's claim is atomic (no await inside). So regardless of interleaving, exactly one send.

For "txid determinism": `deriveTxid(orderId, effectiveDate)` returns the same value for the same inputs across calls. Also (implicitly) different for different inputs? The plan says "returns the same value for the same inputs across calls." I'll assert: called twice with same args → equal; also that it's a 32-char hex string (per plan: truncated to 32 hex chars) — hmm, is that over-specifying? The plan's assumption says "truncated to 32 hex chars." Asserting `/^[0-9a-f]{32}$/` tests the documented derivation format. I think it's fine and valuable. And different order IDs → different txids (deterministic derivation should distinguish orders — that's the point of including orderId). I'll assert same-inputs-same-output as primary, plus 32-hex shape, plus different-inputs-different-output as secondary. Keep it focused.

Also "money is integer" test — the plan's section 5 lists "money is integer: Schema and service reject or ignore non-integer amounts (Prisma Int column enforces at DB level; service validates input)." Hmm, but the file description line (the authoritative list for this file) says: "Tests for timeout-but-settled, proven-absent resend, attempt exhaustion, duplicate, permanent rejection, overlapping windows, unpublished statement, concurrent claim, txid determinism." That's 9 items — no "money is integer." The plan's section 5 has 10 items including money. The task instruction's file line lists 9 (omitting money). Which governs? "PLAN.md above is your own specification and governs." But the explicit file description also says "Implement exactly what the plan specifies for this file." The plan specifies the test file contains those 9 (per manifest description) — and section 5 lists 10 scenarios. The money test would test schema/Prisma enforcement, which isn't really testable at the service level without DB. The service doesn't validate input amounts in the reference implementation (executePayments takes no input; orders come from DB). So a "money is integer" service test doesn't map to any service behavior. I'll follow the 9-item list in the file description (which matches the manifest for this exact file) and skip the money test. That's the most defensible: the manifest line for this file is the spec for this file's contents.

Hmm, but "PLAN.md governs" — section 5 of the plan includes money. Tension. The manifest (also in the plan) says this file tests the 9. I'll go with 9; adding a money test that asserts nothing real (since the service doesn't take amounts as input) would violate "test behavior" — there's no service behavior to test. Actually wait, could I test that the service passes integer amounts through to bank.send? E.g., order with amount_cents 1500 → bank receives 1500. That's a pass-through assertion — weak, and it's covered implicitly in other tests (I can assert bank.sent[0].amount_cents === 1500 in the timeout test). I'll weave amount assertions into existing tests rather than a standalone money test. That respects both: money stays integer end-to-end, observable via the bank request.

Now — error classes: `InsufficientAttemptsError` and `BankClientError` are in payout.types. The plan says InsufficientAttemptsError "should never surface to the caller because executePayments checks the cap before calling bank.send." Wait — but looking at the reference service, there's no check of the cap in executePayments! The service just claims and sends for any pending order. The cap enforcement is entirely in reconcile (sent → manual_review when attempts >= 5, never back to pending). So a parked order is never pending again, and executePayments never sees it. OK so the error class is effectively dead code in the reference service. My tests shouldn't test for it (it never surfaces). Fine — I won't import it. The manifest says the test reads payout.types.ts — I'll import `OrderState`, and maybe `ReconcileWindow` for typing windows. Good.

Now, let me also think: should tests assert on `createReconcileRun` being recorded? The plan says reconcile records a run row. In the overlapping test, "does not double-count" — I'll assert on matched_count values in the two ReconcileResults returned (first 1, second 0). That's directly observable from the return value — better than inspecting fake storage. I'll use the returned ReconcileResult.matched_count primarily.

Now, let me think about how to set up orders in each test. Helper:

```ts
function makeOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: overrides.id ?? `order-${++seq}`,
    supplier_key: "key-1",
    amount_cents: 1500,
    effective_date: "2025-01-15",
    txid: overrides.txid ?? derive a deterministic one,
    state: "pending",
    send_attempts: 0,
    created_at: new Date("2025-01-15T00:00:00.000Z"),
    updated_at: new Date("2025-01-15T00:00:00.000Z"),
    ...overrides,
  };
}
```

For txid, I can use `service.deriveTxid(id, effective_date)` to be realistic — nice touch: the txid in the DB is what executePayments sends, and reconcile matches on it. Using deriveTxid ties the test to the actual derivation. But note: deriveTxid is a service method; I can call it after constructing the service. Or just use a fixed string like "txid-abc". For matching tests, any consistent string works. Using deriveTxid is more end-to-end. I'll compute txid via the service's deriveTxid in the setup helper... but the helper needs a service instance. I'll create the service per test in beforeEach, and build orders with an explicit txid string (simple, no coupling). Actually, simpler: fixed txids per test. Determinism is tested separately. Keep setup simple and readable.

Now, windows: I need a helper to build windows around "2025-01-15":

```ts
const dayStart = (d: string) => new Date(`${d}T00:00:00.000Z`);
```

For published-with-empty-statement windows: to = now - 31min. But the window must also contain the effective date for findOrdersByEffectiveDateRange to return the order! If to = now - 31min and the order's effective_date is "2025-01-15" (a fixed past date, e.g., 2025-01-15), then as long as "now" is after 2025-01-16, the window [from, to] with from = dayStart("2025-01-15") and to = now-31min contains Jan 15. But if the test runs "before" 2025-01-16 (i.e., the eval runs in early 2025 or earlier — unlikely but possible; more relevantly, if the fixed date is in the future relative to the test run's clock), then to = now-31min < dayStart(Jan 15) → range empty → no effective dates → no statement fetch → matched 0, order untouched. That would break the test if run before that date!

To be robust regardless of wall clock, I should derive the effective_date from "now": e.g., `const today = new Date().toISOString().slice(0, 10)`. Then windows: from = dayStart(today - 1day), to = now - 31min (which is >= dayStart(today) since today's midnight is at most 24h ago... wait, to = now - 31min; today's midnight is at most ~24h in the past, so now-31min > today's midnight always (since now - 31min >= todayMidnight + (timeOfDay - 31min); timeOfDay can be as low as 00:00 → now-31min = todayMidnight - 31min < todayMidnight!). Edge case: if the test runs between 00:00 and 00:31 UTC, now - 31min is yesterday. Then the window [yesterdayMidnight-ish, now-31min] doesn't contain today. Hmm.

Better approach: use "yesterday" as the effective date and set the window to = now - 31min, from = dayStart(yesterday - 1). Yesterday's midnight is at least ~24h - ... ago: now - yesterdayMidnight is between 24h and 48h. to = now - 31min ≥ yesterdayMidnight + (24h - 31min) > yesterdayMidnight ✓. And to < todayMidnight always (now - 31min < now ≤ todayEnd; could now-31min ≥ todayMidnight? Only if timeOfDay ≥ 31min. If run at 00:10, to = yesterday 23:39 < todayMidnight ✓ still fine — the range [from, to] just ends before today, which is fine since the order is yesterday's). So: effective_date = yesterday (UTC), from = dayStart(yesterday) - maybe a bit earlier, to = now - 31min. The range contains yesterday's midnight ✓ always.

Let me define:
```ts
const todayUtc = new Date();
const yesterday = new Date(todayUtc.getTime() - 24*60*60*1000).toISOString().slice(0,10);
```
Wait, careful: subtracting 24h from now gives a datetime yesterday (same time of day). Its date part is yesterday's UTC date ✓ (unless now is exactly... no, subtracting 24h always lands on the previous UTC day at the same time). Good.

```ts
const EFFECTIVE_DATE = yesterday; // "YYYY-MM-DD"
const windowTo = new Date(Date.now() - 31*60*1000); // guarantees published for empty statements
const windowFrom = new Date(`${EFFECTIVE_DATE}T00:00:00.000Z`);
```

Window [windowFrom, windowTo]: contains EFFECTIVE_DATE's midnight ✓ (windowTo > windowFrom always? windowTo = now-31min; windowFrom = yesterdayMidnight. now - 31min > yesterdayMidnight ⟺ now > yesterdayMidnight + 31min. now is at least yesterdayMidnight + 24h - ... hmm: the earliest "now" for a given yesterday is just after yesterdayMidnight + 0? No: if now = todayMidnight + ε, then yesterday = today-1, yesterdayMidnight = now - 24h + ε... let me just compute: now ranges over [todayMidnight, todayMidnight+24h). yesterdayMidnight = todayMidnight - 24h. now - 31min > yesterdayMidnight ⟺ now > todayMidnight - 24h + 31min = yesterdayMidnight + 31min. Since now ≥ todayMidnight = yesterdayMidnight + 24h > yesterdayMidnight + 31min ✓ always. Good, window is valid and contains the date.

For non-empty published statements: settled_at = now - 31min → latest+30min = now-1min ≤ now ✓ published.

For unpublished: settled_at = now → not published ✓. And window.to = now (fine, window [yesterdayMidnight, now] contains the date).

OK this is robust. Let me also double-check `findOrdersByEffectiveDateRange` with from = yesterdayMidnight, to = now-31min: order's day = yesterdayMidnight; check day ≥ from (equal ✓) and day < to (yesterdayMidnight < now-31min ✓).

Now let me also reconsider: in `reconcile`, the service gets orders by range, extracts distinct effective_dates, and for each date calls getStatement. My fake's getStatement returns from a map keyed by date string; default empty. In proven-absent tests, I just don't set a statement → empty → published via window.to ✓.

Now let me write each test concretely.

**Setup (beforeEach):**
```ts
let repo: FakePayoutRepository;
let bank: FakeBankClient;
let service: PayoutService;

beforeEach(() => {
  repo = new FakePayoutRepository();
  bank = new FakeBankClient();
  service = new PayoutService(repo, bank);
});
```

Wait — `new PayoutService(repo, bank)`: the constructor types are (PayoutRepository, BankClient). My fakes must be assignable. FakeBankClient: I'll write `class FakeBankClient implements BankClient` — explicit, clean. FakePayoutRepository: I'll write it as a class and assert compatibility via `const repo: PayoutRepository = new FakePayoutRepository();` in beforeEach. Hmm, but then the type of `repo` is PayoutRepository and I lose access to fake-specific methods (seed, sentRuns) unless I keep a separate reference. I'll do:

```ts
const fakeRepo = new FakePayoutRepository();
const repo: PayoutRepository = fakeRepo; // compile-time check of compatibility
service = new PayoutService(repo, bank);
```

And use `fakeRepo` for seeding/inspection. Good — this enforces the fake matches the real interface (catches drift), which is exactly what "test behavior through the public contract" wants.

Hmm wait, one concern: does `FakePayoutRepository` as written actually pass the assignability check to `PayoutRepository`? The real PayoutRepository (reference) has methods with these signatures:

- findPendingOrders(): Promise<Order[]>
- findById(id: string): Promise<Order | null>
- claimOrder(id: string): Promise<Order | null>
- updateState(id: string, state: OrderState, sendAttempts?: number): Promise<Order>
- findOrdersByTxids(txids: string[]): Promise<Order[]>
- findOrdersByEffectiveDate(date: string): Promise<Order[]>
- createReconcileRun(window: ReconcileWindow, matchedCount: number): Promise<ReconcileRun>
- getLatestReconcileRunForDate(date: string): Promise<ReconcileRun | null>
- createSendEvent(orderId, txid, classification, raw): Promise<SendEvent>

My fake's methods must have compatible signatures. Return types: mine return Promise<OrderRecord | null> etc. OrderRecord must be assignable to Prisma's Order. As analyzed, yes (9 fields, matching types). But — risk: if the generated Prisma client's Order type has, say, `state: string` — mine is OrderState (narrower) → assignable ✓. If Prisma's Order includes all fields as required — mine has all ✓.

But what about `createReconcileRun` returning Promise<ReconcileRun>? My fake returns a local `RunRecord` = { id, window_from, window_to, matched_count, created_at }. Prisma's ReconcileRun = same 5 fields. Assignable ✓.

`createSendEvent` → SendEvent = { id, order_id, txid, classification, raw_response, created_at }. Mine matches ✓.

Now, another consideration: the reference PayoutRepository doesn't have `findOrdersByEffectiveDateRange`, but my fake does (extra). Extra members on a non-literal source are fine ✓.

But here's the real issue: the service calls `this.repo.findOrdersByEffectiveDateRange(...)`. If the workspace's PayoutRepository type lacks that method, the service file has a compile error — but that exists regardless of my test. My test still type-checks on its own: `new PayoutService(repo, bank)` requires repo: PayoutRepository ✓ (my fake is compatible). The service's internal error is in the service file. In Vitest runtime (esbuild, no type check), everything works as long as the fake implements the method at runtime ✓.

Should I add an ASSUMPTION comment about this? The instructions: "If a symbol you need is truly missing from both the plan and the reference, don't guess silently... mark it with a single // ASSUMPTION comment at the point where it matters." The symbol `findOrdersByEffectiveDateRange` is used by the service (reference) but missing from the repository reference and the plan's sketch. In my test, I must provide it in the fake for reconcile to work at runtime. That's a point where it matters. I'll add one ASSUMPTION comment on the fake's method explaining: the service calls findOrdersByEffectiveDateRange which isn't declared on PayoutRepository in the reference; the fake provides it so reconcile can be exercised. One comment, at the point where it matters. Good.

Similarly `claimOrder` — present in the reference repository (with its own ASSUMPTION comment), so no note needed.

Now, let me also double-check the service's reconcile flow for a subtlety in the overlapping test: after the first reconcile settles the order, the second reconcile (overlapping window) → findOrdersByEffectiveDateRange returns the order (state settled), effectiveDates = [date], getStatement → published, then `findOrdersByEffectiveDate(date)` returns the order, but `order.state !== "sent"` → skip. matchedCount 0 ✓.

Now the "timeout-but-settled" test details:
1. Seed order (pending, txid T).
2. bank.setSendHandler → transient_error (simulating timeout).
3. `await service.executePayments()` → result[0].classification "transient_error". Order now sent, attempts 1.
4. bank.setStatement(date, [{ txid: T, amount_cents: 1500, settled_at: now-31min }]).
5. `await service.reconcile(window)` → matched_count 1. Order settled.
6. `await service.executePayments()` → results [] (no pending). bank.sent.length still 1.
Assertions: final state settled; bank.sent.length === 1 (no resend); second execute results empty; matched_count 1.

"Proven-absent (resend, same txid)":
1. Seed order pending, txid T.
2. Bank handler → transient_error.
3. executePayments → sent, attempts 1. bank.sent[0].txid === T.
4. Statement for date: empty (or without T). Reconcile with published window → order reverts to pending (attempts 1 < 5). matched_count 0.
5. Bank handler → duplicate (the bank actually had it / now recognizes the same txid).
6. executePayments → claims (attempts 2), sends with same txid T. bank.sent[1].txid === T === bank.sent[0].txid. duplicate → settled.
7. Assert: final state settled; bank.sent.length === 2; txids identical; the second send used same amount and key (behavior: resend reuses identity). I'll assert txid equality as the core ("same txid"), plus final settled.

Wait — step 5: is "duplicate" the right bank response for the resend? Per the plan's test description: "Next executePayments sends it again with the identical txid. Bank returns duplicate. Order becomes settled." Yes ✓. (Scenario: the first send actually reached the bank but timed out; but wait — if reconciliation proved absence past the lag, the bank shouldn't have it... The plan's test is a bit contradictory in real-world logic, but I follow the plan: it's testing that the resend reuses txid and a duplicate response settles. Actually, hmm, in the proven-absent scenario, the bank truly doesn't have it, so the resend should be "accepted" → sent. Then a later reconcile settles it. But the plan explicitly says the bank returns duplicate and order becomes settled. I follow the plan — it governs.)

Hmm, let me re-read: "proven-absent (resend, same txid): Order is sent, bank times out. Reconcile proves absence (txid not in statement, statement published). Order reverts to pending. Next executePayments sends it again with the identical txid. Bank returns duplicate. Order becomes settled." Yes — I'll implement exactly that.

"Attempt exhaustion":
Loop 5 times: bank transient; executePayments (sends); reconcile absent-published (reverts to pending, except the last which parks).
After: state manual_review, attempts 5, bank.sent.length 5. Then executePayments again → no send (bank.sent still 5), state unchanged manual_review.
Also assert: after the 5th reconcile, matched_count 0 (no matches; parking isn't a match).

Let me verify the loop mechanics with my fake: iteration i (1-based):
- executePayments: findPending → order (pending, attempts i-1) → claim → sent, attempts i → bank transient → stays sent.
- reconcile: statement empty, published (to = now-31min) → order sent, txid absent → attempts i: if i < 5 → pending; if i === 5 → manual_review.
After loop: manual_review, attempts 5 ✓.

One more executePayments: findPending → none (manual_review) → results [] ✓ bank.sent.length 5 ✓.

"Duplicate on first send":
- Seed pending, txid T.
- Bank handler → duplicate immediately.
- executePayments → result classification duplicate; order settled; attempts 1 (claim incremented, no more).
- executePayments again → nothing sent.
Assertions: state settled; bank.sent.length 1; attempts === 1 (plan: "without consuming an extra attempt beyond the claim"). I'll assert attempts === 1 — it's specified behavior.

"Permanent rejection":
- Bank handler → permanent_rejection.
- executePayments → order rejected; attempts 1 (claim incremented — plan says permanent rejection "does not consume an attempt (it is terminal)"... wait, let me re-read: "Attempt counter increments on every bank.send call whose result is not a permanent rejection and not a confirmed duplicate; a permanent rejection does not consume an attempt (it is terminal)."

Hmm! The plan's assumption says permanent rejection doesn't consume an attempt. But the reference implementation increments at claim time, before knowing the outcome — so in the implementation, a permanent rejection does increment (attempts 1). The plan's control-flow section says: "A permanent_rejection does not increment further. The order moves to rejected, terminal." — "does not increment further" (beyond the claim). But the assumption section says the counter increments on every send "whose result is not a permanent rejection" — implying no increment at all for permanent. These two plan statements contradict each other, and the implementation (claim-time increment) matches "does not increment further" (i.e., +1 from claim, nothing more).

Since the order is terminal either way, attempts count is unobservable in behavior (no further sends). So I should NOT assert attempts for the permanent case — it's a plan-internal contradiction that has no behavioral consequence. I'll assert only: state rejected; subsequent executePayments sends nothing; bank sent once. That's the safe, behavior-only assertion.

Similarly for duplicate: attempts is also unobservable (terminal). The plan says "without consuming an extra attempt beyond the claim" — I could assert attempts === 1, but given the plan's internal contradiction on attempt semantics (claim-time vs outcome-based), asserting a specific number risks encoding the wrong reading. Behaviorally, what matters: terminal state, no further sends. I'll skip attempts assertions for terminal cases and keep them only where they drive behavior: the exhaustion test (where attempts >= 5 triggers parking — but even there, I observe parking, not the number). Hmm, in exhaustion I assert final state manual_review — that's the behavior. I could also assert bank.sent.length === 5 (exactly 5 sends — that's the cap behavior, very much observable and core). Yes: "Cap attempts at 5" → exactly 5 bank sends total. That's the key assertion. I'll assert bank.sent.length === 5 and no 6th send.

"Overlapping windows": as designed above.
- Seed pending, txid T; bank accepted; executePayments → sent.
- Statement: [{txid T, settled_at now-31min}].
- Window A: [yesterdayMidnight, now-31min] → reconcile → matched 1, settled.
- Window B: overlapping, e.g., [yesterdayMidnight + 12h... hmm, must contain yesterday's day for the range check. Let me do window B = [yesterdayMidnight, now-30min] (slightly different to). Or per plan "[T1, T2] then [T2, T3] where both contain the same effectiveDate": window A = [dayStart-1d, dayStart+12h], window B = [dayStart+12h, dayStart+2d]? But my range check uses order's midnight: window A must contain yesterdayMidnight: [dayStart-1d, dayStart+12h] ✓ (midnight ≥ from, midnight < to ✓). Window B = [dayStart+12h, ...] → midnight < from ✗ — order not in range B! That breaks "both contain the same effectiveDate" under my midnight-based range semantics.

Hmm. The plan's windows [T1,T2],[T2,T3] both containing the effectiveDate means the date's "span" (presumably the whole day) is covered by both — i.e., T2 is within the day. So window A = [dayStart, dayStart+12h], window B = [dayStart+12h, dayStart+24h]. Under my midnight-point range check: window A contains midnight ✓ (midnight ≥ from=dayStart ✓, midnight < to=dayStart+12h ✓). Window B: midnight ≥ from=dayStart+12h ✗. So under a point-in-time check, B doesn't contain it.

This reveals ambiguity: does "order in window" mean the order's effective day (a 24h span) overlaps the window, or the day's midnight point is in the window? The repository reference has `getLatestReconcileRunForDate` with an overlap interpretation: "the most recent run whose window overlaps the UTC calendar day of the given effective date" — that's for runs, not orders. For `findOrdersByEffectiveDateRange` (which isn't even in the reference repo), there's no guidance.

Most defensible for my fake: an order is in the window if its effective day [dayStart, dayStart+24h) overlaps [from, to): i.e., dayStart < to && dayEnd > from. That matches the "overlaps the UTC calendar day" reading used elsewhere in the reference (getLatestReconcileRunForDate), and makes the plan's overlapping-window test meaningful. I'll implement overlap semantics in the fake:

```ts
const dayStartMs = new Date(`${o.effective_date}T00:00:00.000Z`).getTime();
const dayEndMs = dayStartMs + 24*60*60*1000;
return dayStartMs < to.getTime() && dayEndMs > from.getTime();
```

Then window A = [dayStart, dayStart+12h]: dayStart < to ✓ (equal? dayStartMs < dayStart+12h ✓), dayEnd > from ✓ → in range. Window B = [dayStart+12h, dayStart+24h]: dayStart < dayStart+24h ✓, dayEnd (dayStart+24h) > dayStart+12h ✓ → in range. Both contain it ✓.

And for other tests with window [yesterdayMidnight, now-31min]: dayStart < to ✓ (to is ~24h later), dayEnd > from ✓ → in range ✓.

I'll add the ASSUMPTION comment here (or on the method) — actually, I already planned one ASSUMPTION for the method's existence. Can I combine? The instructions say "mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters" — per unresolved symbol. There are two unresolved aspects: (1) method not on reference PayoutRepository, (2) range semantics unspecified. I'll write one comment covering the method's presence + the overlap reading, or two comments. "One comment at the point where it matters" — I read this as: one comment per unresolved thing, placed where it matters. I'll place a single comment above the method covering both: method is called by the service but absent from the reference repository; implemented as day-overlap to match the plan's overlapping-window test. Hmm, let me keep it tight:

```ts
// ASSUMPTION: PayoutService calls repo.findOrdersByEffectiveDateRange, which is not declared
// on the reference PayoutRepository; the fake provides it, treating an order as in-window when
// its UTC effective day overlaps [from, to] (same overlap reading as getLatestReconcileRunForDate).
```

Good — one comment, at the point where it matters.

Now, is there any other truly missing symbol? Let me scan the service's repo calls again: findPendingOrders ✓, claimOrder ✓ (in reference), updateState ✓, findOrdersByEffectiveDateRange ✗ (handled), findOrdersByEffectiveDate ✓, createReconcileRun ✓. Bank: send ✓, getStatement ✓. Types: all present. `PayoutResult`, `ReconcileResult` ✓. OK, one ASSUMPTION total.

Wait, also check: the service's `reconcile` uses `window.to` in isStatementPublished — ReconcileWindow has from/to ✓.

Now, the FakeBankClient details:

```ts
class FakeBankClient implements BankClient {
  readonly sentRequests: Array<{ txid: string; amount_cents: number; key: string }> = [];
  private readonly statements = new Map<string, Settlement[]>();
  private sendHandler: (req: { txid: string; amount_cents: number; key: string }) => BankSendResponse | Promise<BankSendResponse> = () => {
    throw new Error("no send handler configured");
  };

  onSend(handler: typeof this.sendHandler): void { this.sendHandler = handler; }
  setStatement(date: string, settlements: Settlement[]): void { this.statements.set(date, settlements); }

  async send(req: { txid: string; amount_cents: number; key: string }): Promise<BankSendResponse> {
    this.sentRequests.push({ ...req });
    return this.sendHandler(req);
  }

  async getStatement(date: string): Promise<Settlement[]> {
    return this.statements.get(date) ?? [];
  }
}
```

Using `implements BankClient` — the reference BankClient interface: send(req: {txid, amount_cents, key}): Promise<BankSendResponse>; getStatement(date: string): Promise<Settlement[]>. My signatures match ✓.

Helper for classification responses:

```ts
const response = (classification: SendClassification, txid: string): BankSendResponse => ({ classification, txid });
```

FakePayoutRepository details:

```ts
interface OrderRecord {
  id: string;
  supplier_key: string;
  amount_cents: number;
  effective_date: string;
  txid: string;
  state: OrderState;
  send_attempts: number;
  created_at: Date;
  updated_at: Date;
}

interface RunRecord {
  id: string;
  window_from: Date;
  window_to: Date;
  matched_count: number;
  created_at: Date;
}

class FakePayoutRepository {
  private readonly orders = new Map<string, OrderRecord>();
  readonly runs: RunRecord[] = [];

  seed(order: OrderRecord): void {
    this.orders.set(order.id, { ...order });
  }

  get(id: string): OrderRecord | undefined {
    const o = this.orders.get(id);
    return o ? { ...o } : undefined;
  }

  async findPendingOrders(): Promise<OrderRecord[]> {
    return [...this.orders.values()].filter((o) => o.state === "pending").map((o) => ({ ...o }));
  }

  async findById(id: string): Promise<OrderRecord | null> {
    const o = this.orders.get(id);
    return o ? { ...o } : null;
  }

  async claimOrder(id: string): Promise<OrderRecord | null> {
    const o = this.orders.get(id);
    if (!o || o.state !== "pending") return null;
    o.state = "sent";
    o.send_attempts += 1;
    return { ...o };
  }

  async updateState(id: string, state: OrderState, sendAttempts?: number): Promise<OrderRecord> {
    const o = this.orders.get(id);
    if (!o) throw new Error(`order ${id} not found`);
    o.state = state;
    if (sendAttempts !== undefined) o.send_attempts = sendAttempts;
    return { ...o };
  }

  // ASSUMPTION: ...
  async findOrdersByEffectiveDateRange(from: Date, to: Date): Promise<OrderRecord[]> {
    return [...this.orders.values()].filter((o) => {
      const dayStart = new Date(`${o.effective_date}T00:00:00.000Z`).getTime();
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;
      return dayStart < to.getTime() && dayEnd > from.getTime();
    }).map((o) => ({ ...o }));
  }

  async findOrdersByEffectiveDate(date: string): Promise<OrderRecord[]> {
    return [...this.orders.values()].filter((o) => o.effective_date === date).map((o) => ({ ...o }));
  }

  async findOrdersByTxids(txids: string[]): Promise<OrderRecord[]> {
    const set = new Set(txids);
    return [...this.orders.values()].filter((o) => set.has(o.txid)).map((o) => ({ ...o });
  }

  async createReconcileRun(window: ReconcileWindow, matched
