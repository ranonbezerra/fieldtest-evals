# 05-payout.repository.ts

## reasoning

```
Let me analyze what's needed for `src/payout/payout.repository.ts`.

According to the plan, this file is:
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

The repository is the only layer that touches the database. It uses PrismaClient.

Now, considerations:

1. **Importing types**: The plan says `Order`, `ReconcileRun`, `SendEvent` are Prisma models. In Prisma with the `prisma-client-js` generator, these types come from `@prisma/client`. The plan's signature references `Order`, `ReconcileRun`, `SendEvent` — these are Prisma-generated types from `@prisma/client`.

2. **OrderState** comes from `./payout.types`, and **SendClassification** comes from `./bank-client`.

3. **ReconcileWindow** comes from `./payout.types`.

4. The plan mentions an atomic claim: "Atomically claim: `UPDATE orders SET state = 'sent', send_attempts = send_attempts + 1 WHERE id = ? AND state = 'pending'`. If 0 rows updated, skip (another run claimed it)."

Hmm — but the plan's repository signature only lists the methods above. The atomic claim is described in the control flow of `executePayments`. Where does it belong? The repository is "the only layer that touches the database," and the service has "zero raw SQL, zero Prisma client calls." So the atomic claim must be a repository method. But it's not in the plan's signature list…

Wait, let me re-read the plan's repository section:

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

And the ordering rule says: "`executePayments` must not run concurrently with itself for the same order. A single Postgres advisory lock, or an atomic `UPDATE ... WHERE state = 'pending'` guard, ensures a single winner. The loser sees no row and skips."

The control flow says: "a. Atomically claim: `UPDATE orders SET state = 'sent', send_attempts = send_attempts + 1 WHERE id = ? AND state = 'pending'`. If 0 rows updated, skip (another run claimed it)."

So the repository needs a `claimOrder` method (or similar) that performs this atomic update. The plan's signature block doesn't explicitly name it, but the control flow requires it. The instructions say: "If a symbol you need is genuinely missing from both the plan and the references, do not guess silently… write the file using the most defensible interpretation and mark it with a single `// ASSUMPTION:` comment at the point where it matters."

Hmm, but is it "genuinely missing"? The plan describes the atomic claim in detail (control flow section 2a), but doesn't give it a name in the repository signature. The most defensible interpretation: add a `claimOrder(id: string): Promise<Order | null>` method that performs the atomic UPDATE and returns the updated order or null if 0 rows. This is required by the plan's control flow. I think adding it with an ASSUMPTION comment marking that the name is my choice is correct. Actually, wait — let me think about whether the claim can be implemented with `updateState`.

`updateState(id, state, sendAttempts?)` — the signature takes an absolute `sendAttempts`, not an increment. The claim requires `send_attempts = send_attempts + 1`. With Prisma's `update`, you can do `send_attempts: { increment: 1 }`, but the signature takes a number. So `updateState` as specified can't do the claim's increment.

Options:
1. Add a `claimOrder(id: string): Promise<Order | null>` method that does `updateMany` with where `{ id, state: "pending" }`, data `{ state: "sent", send_attempts: { increment: 1 } }`, and if `count === 0` returns null, otherwise fetches the order.
2. Extend `updateState` — no, the plan fixes its signature.

The plan's test list includes "concurrent executePayments claim: two concurrent claims on the same pending order. Only one succeeds (atomic UPDATE). The other skips." So the repository must expose an atomic claim. I'll add `claimOrder` with an ASSUMPTION comment that the method name isn't in the plan's signature block but is required by the control flow.

Actually, let me reconsider. The instructions say "implement exactly what the plan specifies for this file. Do not add exports, features, or files that the plan does not name." The plan names the atomic claim behavior in the control flow ("What must not be in a transaction: … the claim is a single atomic UPDATE"). The control flow is part of the plan and governs. The repository signature block is a sketch, and the claim must live somewhere — since the service has zero Prisma calls, it must be in the repository. So adding `claimOrder` is implementing what the plan specifies, just not named in the sketch. I'll mark it with an ASSUMPTION comment about the name.

Hmm, but should I? Let me weigh: without the claim method, the service can't implement the plan's control flow at all (it has zero Prisma access). So the claim method is necessary. The most defensible interpretation: include it, mark with an ASSUMPTION comment about the name/shape.

Alternatively, could I implement the claim via `updateState` with a special convention? No — that would be guessing silently. An ASSUMPTION-marked `claimOrder` is cleaner.

Now, other methods:

**findPendingOrders()**: `prisma.order.findMany({ where: { state: "pending" } })`. Should I order? The plan says orders are processed sequentially. Ordering by created_at for determinism is reasonable but not specified. Keep it simple: `findMany({ where: { state: "pending" } })`. Maybe add `orderBy: { created_at: "asc" }` — hmm, that's adding behavior not in the plan. The plan doesn't specify ordering. Keep it minimal: just the where clause. Actually, deterministic ordering is defensible but not required. Minimal is safer per "do exactly what the task asks." I'll leave it without orderBy… actually, a stable order is nice for fairness but not specified. Keep it minimal.

**findById(id)**: `prisma.order.findUnique({ where: { id } })` returns `Order | null`.

**updateState(id, state, sendAttempts?)**:
```ts
const data: Prisma.OrderUpdateInput = { state };
if (sendAttempts !== undefined) data.send_attempts = sendAttempts;
return prisma.order.update({ where: { id }, data });
```
Note: in Prisma with `@map`, the JS-side field names are the model field names (`sendAttempts`? no wait). Let me check the schema:

```prisma
model Order {
  id             String   @id @default(cuid())
  supplier_key   String   @map("supplier_key")
  amount_cents   Int      @map("amount_cents")
  ...
}
```

The model field name is `supplier_key` (the Prisma field name), which is mapped to the DB column `supplier_key`. So in TypeScript, the field is accessed as `order.supplier_key`, `order.amount_cents`, `order.send_attempts`. The Prisma client uses the model field names (before `@map`), so `data: { send_attempts: 5 }` is correct.

So in the repository, I use `send_attempts`, `amount_cents`, etc. Good — the schema uses snake_case for both field names and mapped columns, so there's no mismatch.

**findOrdersByTxids(txids)**: `prisma.order.findMany({ where: { txid: { in: txids } } })`. Edge case: empty array — Prisma's `in: []` returns an empty result, which is fine.

**findOrdersByEffectiveDate(date)**: `prisma.order.findMany({ where: { effective_date: date } })`.

**createReconcileRun(window, matchedCount)**:
```ts
return prisma.reconcileRun.create({
  data: {
    window_from: window.from,
    window_to: window.to,
    matched_count: matchedCount,
  },
});
```

**getLatestReconcileRunForDate(date)**: Hmm. The plan says: "Also used to determine the latest reconciled window for a given effectiveDate, so we know the statement is 'published enough.'" The signature: `getLatestReconcileRunForDate(date: string): Promise<ReconcileRun | null>`.

How do we find the latest reconcile run "for a date"? The ReconcileRun has window_from/window_to (DateTime) but no effective_date column. So "for a date" means: the run whose window covers that date? The most defensible interpretation: find runs where `window_from <= endOfDay(date)` and `window_to >= startOfDay(date)`, i.e., the window overlaps/covers that calendar day, and take the latest one (max window_to or max created_at).

Hmm, this is genuinely ambiguous. Let me think about how the service would use it: in `reconcile(window)`, for each effectiveDate in the window, it checks whether the statement is "published." The plan's actual published check (section 4) uses the statement's max settled_at + 30 min <= now. So getLatestReconcileRunForDate is more of an audit helper ("also used to…").

Most defensible implementation: convert the date string (YYYY-MM-DD) to a UTC day range [start, end), and find the most recent run (ordered by created_at desc or window_to desc) whose window overlaps that range:

```ts
const start = new Date(`${date}T00:00:00.000Z`);
const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
return prisma.reconcileRun.findFirst({
  where: {
    window_from: { lt: end },
    window_to: { gte: start },
  },
  orderBy: { created_at: "desc" },
});
```

This finds runs whose window overlaps the calendar day. Take the latest by created_at. This is a defensible interpretation. Should I mark it with ASSUMPTION? The instruction says to mark when "a symbol you need is genuinely missing from both the plan and the references." The method is named in the plan. Its semantics ("latest reconciled window for a given effectiveDate") are described but not precisely defined. I think an ASSUMPTION comment about the overlap interpretation is warranted — it's a genuine ambiguity. Let me add one concise ASSUMPTION comment there.

**createSendEvent(orderId, txid, classification, raw)**:
```ts
return prisma.sendEvent.create({
  data: { order_id: orderId, txid, classification, raw_response: raw },
});
```

Now, the claim method. Let me design it:

```ts
async claimOrder(id: string): Promise<Order | null> {
  const result = await this.prisma.order.updateMany({
    where: { id, state: "pending" },
    data: { state: "sent", send_attempts: { increment: 1 } },
  });
  if (result.count === 0) return null;
  return this.prisma.order.findUniqueOrThrow({ where: { id } });
}
```

Wait — is there a race between updateMany and findUnique? After the claim, another reconcile could transition sent -> settled or pending. Then findUniqueOrThrow would return the order in a different state, but that's fine — the claim succeeded (we won the pending->sent transition), and the bank call proceeds with the txid. Actually, returning the current order is fine. The service knows it won the claim. Alternatively, return the order as claimed. Simpler: use findUnique and return (could be null only if the row was deleted, which doesn't happen). Use `findUniqueOrThrow`? If a row is concurrently deleted… no delete path exists in this system. `findUnique` returning Order | null and handling null is… hmm, the signature I'd declare: `Promise<Order | null>`. If findUnique returns null (impossible in practice), return null? That would be misinterpreted as "lost the claim." Better to use findUniqueOrThrow since the row must exist after a successful updateMany. Actually, for safety and simplicity:

```ts
const order = await this.prisma.order.findUnique({ where: { id } });
return order; // Order | null
```

Since the row exists, it won't be null. But the type is Order | null. The service treats null as "skip." That's acceptable and avoids throwing. Hmm, but conceptually null means either "lost the claim" or "row vanished." Since there's no delete, it's fine. I'll go with findUnique and return Order | null.

Alternatively, a single query: use `update` with where `{ id, state: "pending" }`? Prisma's `update` requires a unique where (id only), not compound. `updateMany` allows compound where but returns count, not the row. So two steps is the standard pattern.

Is this claim a "feature the plan doesn't name"? The plan names the behavior (atomic UPDATE claim) in the control flow and ordering rule. I'm confident including it is correct, with an ASSUMPTION comment noting the name isn't in the plan's signature sketch.

Wait, actually — let me re-read: "This file: PayoutRepository with all DB access methods." And the plan's section 3 lists exactly 8 methods + constructor. The control flow requires an atomic claim that must live in the repository (service has zero Prisma calls). So "all DB access methods" includes the claim. I'll include it with an ASSUMPTION comment.

Hmm, one more consideration: should the claim return the order? The service needs txid, amount_cents, supplier_key for the bank call. It already has them from findPendingOrders. But after the claim, it's safer to re-read (the row is now 'sent'). Either way. Returning Order | null is most useful.

Now, imports:

```ts
import { PrismaClient } from "@prisma/client";
import type { Order, ReconcileRun, SendEvent } from "@prisma/client";
import type { OrderState, ReconcileWindow } from "./payout.types";
import type { SendClassification } from "./bank-client";
```

Wait — `payout.types.ts` imports `SendClassification` from `./bank-client`. The repository needs `SendClassification` for createSendEvent. I can import it directly from `./bank-client`. The plan's manifest says: `payout.repository.ts | reads: src/payout/payout.types.ts, prisma/schema.prisma`. Hmm, the manifest says the repository reads payout.types.ts and schema.prisma — not bank-client.ts. But createSendEvent's signature requires SendClassification, which lives in bank-client.ts (per the plan: "src/payout/bank-client.ts | BankClient interface, SendClassification, BankSendResponse, Settlement").

The manifest's "reads" list may be loose. To type `createSendEvent(..., classification: SendClassification, ...)`, I must import SendClassification from "./bank-client." That's a genuine dependency. The plan's own signature for the repository includes `SendClassification` in createSendEvent, so importing from bank-client is required. I'll import it. The manifest isn't binding to the point of producing a type error.

Alternatively, import `SendClassification` via payout.types? payout.types re-exports it… no, it just imports the type, doesn't re-export. So I must import from "./bank-client."

Prisma types: with `prisma-client-js` generator, `@prisma/client` exports the `PrismaClient` class and model types (`Order`, `ReconcileRun`, `SendEvent`). Standard.

Now, is there a risk that the generated client isn't available in this workspace? The task says to write the repository file. The standard import is `@prisma/client`. That's the defensible interpretation.

Let me also consider whether to use `Prisma` namespace types for update input. In updateState:

```ts
async updateState(id: string, state: OrderState, sendAttempts?: number): Promise<Order> {
  const data: Prisma.OrderUpdateInput = { state };
  if (sendAttempts !== undefined) {
    data.send_attempts = sendAttempts;
  }
  return this.prisma.order.update({ where: { id }, data });
}
```

I need `import { Prisma } from "@prisma/client"` or use inline typing. Simpler: build the object and let TS infer:

```ts
const data: { state: string; send_attempts?: number } = { state };
```

Hmm, but passing that to `update`'s data parameter — Prisma's `OrderUpdateInput` accepts `{ state?: string, send_attempts?: number | IntNullableFilter... }`. An object literal typed as `{ state: string; send_attempts?: number }` should be assignable. Actually, Prisma's input types are often complex (nullable filters etc.), but plain values are accepted. To be safe, use `Prisma.OrderUpdateInput`:

```ts
import { Prisma, PrismaClient } from "@prisma/client";
...
const data: Prisma.OrderUpdateInput = { state };
if (sendAttempts !== undefined) data.send_attempts = sendAttempts;
```

This is clean and type-safe. `Prisma.OrderUpdateInput` includes all optional fields, so `{ state }` is valid.

Hmm wait, one subtlety: `Prisma.OrderUpdateInput` — with the `prisma-client-js` generator, yes, it exists.

Now let me write out all the methods:

```ts
import { Prisma, PrismaClient } from "@prisma/client";
import type { Order, ReconcileRun, SendEvent } from "@prisma/client";
import type { SendClassification } from "./bank-client";
import type { OrderState, ReconcileWindow } from "./payout.types";

export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findPendingOrders(): Promise<Order[]> {
    return this.prisma.order.findMany({ where: { state: "pending" } });
  }

  findById(id: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { id } });
  }

  // ASSUMPTION: the plan's control flow requires an atomic pending->sent claim
  // (UPDATE ... WHERE state = 'pending' with send_attempts + 1) but its
  // repository signature sketch does not name it; `claimOrder` is the name used here.
  async claimOrder(id: string): Promise<Order | null> {
    const result = await this.prisma.order.updateMany({
      where: { id, state: "pending" },
      data: { state: "sent", send_attempts: { increment: 1 } },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.order.findUnique({ where: { id } });
  }

  async updateState(id: string, state: OrderState, sendAttempts?: number): Promise<Order> {
    const data: Prisma.OrderUpdateInput = { state };
    if (sendAttempts !== undefined) {
      data.send_attempts = sendAttempts;
    }
    return this.prisma.order.update({ where: { id }, data });
  }

  findOrdersByTxids(txids: string[]): Promise<Order[]> {
    return this.prisma.order.findMany({ where: { txid: { in: txids } } });
  }

  findOrdersByEffectiveDate(date: string): Promise<Order[]> {
    return this.prisma.order.findMany({ where: { effective_date: date } });
  }

  createReconcileRun(window: ReconcileWindow, matchedCount: number): Promise<ReconcileRun> {
    return this.prisma.reconcileRun.create({
      data: {
        window_from: window.from,
        window_to: window.to,
        matched_count: matchedCount,
      },
    });
  }

  // ASSUMPTION: "latest reconcile run for a date" is read as the most recent run
  // whose window overlaps the UTC calendar day of the given effective date.
  getLatestReconcileRunForDate(date: string): Promise<ReconcileRun | null> {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 86_400_000);
    return this.prisma.reconcileRun.findFirst({
      where: {
        window_from: { lt: end },
        window_to: { gte: start },
      },
      orderBy: { created_at: "desc" },
    });
  }

  createSendEvent(
    orderId: string,
    txid: string,
    classification: SendClassification,
    raw: string,
  ): Promise<SendEvent> {
    return this.prisma.sendEvent.create({
      data: {
        order_id: orderId,
        txid,
        classification,
        raw_response: raw,
      },
    });
  }
}
```

Wait — the instruction says "mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters." "A single" — does that mean one total, or one per unresolved point? I read it as: for each genuinely missing symbol, mark with a single (i.e., one) comment at the point where it matters. I have two ambiguous points: the claim method name, and the getLatestReconcileRunForDate semantics. Hmm.

Let me reconsider whether these are "genuinely missing":

1. **claimOrder**: The plan's control flow explicitly describes the atomic claim as part of executePayments step 2a, and the ordering rule says "an atomic `UPDATE ... WHERE state = 'pending'` guard ensures a single winner. The loser sees no row and skips." "The loser sees no row" — this suggests the repository method returns a row or nothing. So the behavior is specified. Only the name is missing. Is the name "genuinely missing"? The plan's signature block is a sketch of the class, and the claim is required by other parts of the plan. I think this is a borderline case. Given the instruction "do not add exports, features, or files that the plan does not name" — but this feature IS named in the plan (as a behavior). The name `claimOrder` is my choice. I'll include one ASSUMPTION comment covering it.

Actually, wait. Let me reconsider: could the claim be intended to be implemented in the service via `updateState`? No — updateState takes an absolute sendAttempts, and the service can't do `send_attempts + 1` without reading first (race). And the plan explicitly says "the claim is a single atomic UPDATE." The service has zero Prisma calls. So the repository must expose it. Definitely include.

2. **getLatestReconcileRunForDate semantics**: The plan says the reconcile_runs table is "also used to determine the latest reconciled window for a given effectiveDate, so we know the statement is 'published enough.'" The method name takes a date string. Since ReconcileRun has no effective_date column, "for a date" must mean window overlap. My interpretation (window overlaps the UTC day, latest by created_at) is defensible. Is this "genuinely missing"? The semantics are loosely specified. I'll mark with an ASSUMPTION comment.

Hmm, but the instruction says "a single `// ASSUMPTION:` comment" — maybe it means at most one comment total? That would be odd if there are multiple unresolved points. I think it means: use a single comment (not multiple) at the point where it matters, per unresolved item. Two comments for two genuinely different unresolved points is defensible. But to be safe, could I consolidate? No — they're at different points in the file. The phrasing "at the point where it matters" implies locality. I'll use two concise ASSUMPTION comments, each one line.

Actually, let me reconsider #2 more carefully. Is there a simpler reading? "getLatestReconcileRunForDate(date)" — maybe it just returns the latest run overall? No, "for a date" implies filtering by date. Since there's no date column, overlap is the only sensible filter. Or maybe it means runs where window_from is on that date? That's less useful (a run covering date D might have started earlier). Overlap is most defensible.

Or — maybe the intended reading is simpler: find runs where the window contains that date, i.e., `window_from <= startOfDay AND window_to >= endOfDay` (the run's window fully covers the day). Hmm. "The latest reconciled window for a given effectiveDate" — a reconcile run for window [from, to] "covers" effectiveDate D if the statement for D was fetched during that run. The service's reconcile fetches statements for each effectiveDate in the window. So a run "covers" D if D's calendar day intersects [from, to]. Overlap: `window_from < endOfDay(D) AND window_to >= startOfDay(D)`. I'll go with overlap.

Now, let me double-check the field names against the schema:
- Order: `id`, `supplier_key`, `amount_cents`, `effective_date`, `txid`, `state`, `send_attempts`, `created_at`, `updated_at`. ✓
- ReconcileRun: `id`, `window_from`, `window_to`, `matched_count`, `created_at`. ✓
- SendEvent: `id`, `order_id`, `txid`, `classification`, `raw_response`, `created_at`. ✓

Prisma client property names: model `Order` → `prisma.order`, `ReconcileRun` → `prisma.reconcileRun`, `SendEvent` → `prisma.sendEvent`. ✓

Types from @prisma/client: `Order`, `ReconcileRun`, `SendEvent` are exported as types (interfaces) by the generated client. ✓ `PrismaClient` is a class. ✓ `Prisma.OrderUpdateInput` exists. ✓

One question: should `findOrdersByTxids` handle the empty array? `in: []` is valid in Prisma and returns []. Fine.

Should `createReconcileRun`/`createSendEvent` be async or return the promise directly? The plan's signatures show `Promise<...>` returns. Returning `this.prisma.x.create(...)` directly (without async/await) is fine and matches the signature. I'll keep non-async where possible for conciseness. For claimOrder, I need async since there's logic.

ESM / "type": "module" — imports without extensions? The convention in this codebase: payout.types.ts uses `import type { SendClassification } from "./bank-client";` — no extension. So I follow: `from "@prisma/client"`, `from "./bank-client"`, `from "./payout.types"`. ✓ Consistent with the reference file.

Import style: the reference uses `import type { ... }`. For PrismaClient, it's a value (class) used only as a type in the constructor parameter — `private readonly prisma: PrismaClient` is a type position. So I could use `import type { PrismaClient } from "@prisma/client"`. But I also need the `Prisma` namespace for `Prisma.OrderUpdateInput` — that's also type-only. So:

```ts
import type { Order, Prisma, PrismaClient, ReconcileRun, SendEvent } from "@prisma/client";
```

`Prisma` as a type-only import: `import type { Prisma }` — the Prisma namespace is both a value and a type namespace. In type positions, `import type { Prisma }` works since we only use it in type positions. Yes, that's valid TS.

Hmm, but is `Prisma` exported as a named export from @prisma/client? Yes: `import { Prisma } from "@prisma/client"` is standard. And `import type { Prisma }` also works since it's a namespace usable in type positions.

Let me write:

```ts
import type { Order, Prisma, PrismaClient, ReconcileRun, SendEvent } from "@prisma/client";
import type { SendClassification } from "./bank-client";
import type { OrderState, ReconcileWindow } from "./payout.types";
```

All type-only imports. Clean.

Now, one more check on `updateState` with `Prisma.OrderUpdateInput`: the model has a relation `send_events SendEvent[]`, so `OrderUpdateInput` includes optional `send_events?: Prisma.SendEventUpdateManyWithoutOrderNestedInput`. Fine, we don't touch it.

Also `state` is a plain String in the schema (no enum), so passing an `OrderState` string is fine.

Let me reconsider `findPendingOrders` — should it include an order? The plan doesn't specify. Minimal: no orderBy. OK.

Double-checking the claim's data too: `{ state: "sent", send_attempts: { increment: 1 } }`. In `updateMany`, the data type is `Prisma.OrderUpdateManyMutationInput`, which supports `{ increment: number }` for Int fields. ✓ And `state: "sent"` — a string literal, fine.

The where in updateMany: `{ id, state: "pending" }` — compound where is allowed in updateMany (where is `Prisma.OrderWhereInput`). ✓

Now, the return of claimOrder: after winning, fetch the order. `findUnique({ where: { id } })` returns `Order | null`. Since the row exists, it will be an Order. Return type `Promise<Order | null>`. Good.

Should I add a `@Injectable()` decorator? The plan's module lists PayoutRepository in providers. NestJS requires @Injectable() for DI… but the plan's repository sketch has no decorator, and the class sketch shows a plain class with a constructor. The plan's module: `providers: [PayoutService, PayoutRepository]`. In NestJS, providers without @Injectable() actually work if they have no dependencies (Nest can instantiate them)… actually, NestJS requires @Injectable() for DI metadata, but a provider with no injectable dependencies can be instantiated without the decorator? Let me think. NestJS uses reflect-metadata to get constructor parameter types. Without @Injectable(), design:paramtypes metadata isn't emitted for the class… actually, `design:paramtypes` is emitted by TypeScript for any class with constructor parameters when `emitDecoratorMetadata` is on — but that requires at least one decorator? No: `emitDecoratorMetadata` emits design:paramtypes only for classes with decorators… hmm, actually TS emits design:paramtypes metadata only when the class has at least one decorator (or when useDefineForClassFields… no). The rule: design metadata is emitted for classes that have decorators. Without a decorator, no metadata, and Nest would fail to resolve PrismaClient as a constructor dependency…

But wait — the plan explicitly sketches the repository as a plain class with no decorator, and the module lists it in providers. The plan governs: "implement exactly what the plan specifies for this file." The plan's signature block for payout.repository.ts shows no @Injectable(). If I add it, I'm adding something the plan doesn't name. The instructions are strict: "do not add exports, features, or files that the plan does not name." A decorator is arguably part of the wiring, but the plan's sketch omits it. Hmm.

This is a real tension: NestJS DI would need @Injectable() (or PrismaClient would need to be provided some other way). But the plan is my spec and it shows a plain class. The task says PLAN.md "governs." I'll follow the plan: no decorator. If DI breaks, that's a plan-level issue (maybe they intended to provide PrismaClient differently, or the app module handles it). My job: this file per the plan.

Hmm, but wait — would a reviewer consider @Injectable() as "what the plan specifies" implicitly? The plan's module section shows `providers: [PayoutService, PayoutRepository]` without showing the service's decorator either (the service sketch also has no @Injectable()). The plan consistently omits decorators in sketches. So omitting in the repository is consistent with the plan's own style. Decision: no decorator.

Same for the controller — not my file. OK.

Now, let me also reconsider: should `claimOrder` be named something else, like `claimPendingOrder` or `atomicClaim`? The plan says "Atomically claim." `claimOrder` is the most natural. I'll note in the ASSUMPTION comment that the plan doesn't name it.

Let me also reconsider whether to include `findOrdersByStateAndEffectiveDate` — no, the plan doesn't name it. The service can filter in memory or use findOrdersByEffectiveDate + state filter… the plan's reconcile says "for each order in `sent` state with that effectiveDate" — the service can call findOrdersByEffectiveDate and filter by state in memory, or… hmm, that's a service concern. My file: only the plan's methods + claim.

Wait, actually — should I double-check whether the plan intends `findOrdersByEffectiveDate` to return only sent orders? The signature: `findOrdersByEffectiveDate(date: string): Promise<Order[]>` — no state parameter. So all orders for that date. The service filters. OK.

Final file:

```ts
import type { Order, Prisma, PrismaClient, ReconcileRun, SendEvent } from "@prisma/client";
import type { SendClassification } from "./bank-client";
import type { OrderState, ReconcileWindow } from "./payout.types";

export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findPendingOrders(): Promise<Order[]> {
    return this.prisma.order.findMany({ where: { state: "pending" } });
  }

  findById(id: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { id } });
  }

  // ASSUMPTION: the plan's control flow requires an atomic pending -> sent claim
  // (UPDATE ... WHERE state = 'pending' with send_attempts incremented) but its
  // repository signature sketch does not name the method; `claimOrder` is that method.
  async claimOrder(id: string): Promise<Order | null> {
    const result = await this.prisma.order.updateMany({
      where: { id, state: "pending" },
      data: { state: "sent", send_attempts: { increment: 1 } },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.order.findUnique({ where: { id } });
  }

  async updateState(id: string, state: OrderState, sendAttempts?: number): Promise<Order> {
    const data: Prisma.OrderUpdateInput = { state };
    if (sendAttempts !== undefined) {
      data.send_attempts = sendAttempts;
    }
    return this.prisma.order.update({ where: { id }, data });
  }

  findOrdersByTxids(txids: string[]): Promise<Order[]> {
    return this.prisma.order.findMany({ where: { txid: { in: txids } } });
  }

  findOrdersByEffectiveDate(date: string): Promise<Order[]> {
    return this.prisma.order.findMany({ where: { effective_date: date } });
  }

  createReconcileRun(window: ReconcileWindow, matchedCount: number): Promise<ReconcileRun> {
    return this.prisma.reconcileRun.create({
      data: {
        window_from: window.from,
        window_to: window.to,
        matched_count: matchedCount,
      },
    });
  }

  // ASSUMPTION: "latest reconcile run for a date" is read as the most recent run
  // whose window overlaps the UTC calendar day of the given effective date.
  getLatestReconcileRunForDate(date: string): Promise<ReconcileRun | null> {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 86_400_000);
    return this.prisma.reconcileRun.findFirst({
      where: {
        window_from: { lt: end },
        window_to: { gte: start },
      },
      orderBy: { created_at: "desc" },
    });
  }

  createSendEvent(
    orderId: string,
    txid: string,
    classification: SendClassification,
    raw: string,
  ): Promise<SendEvent> {
    return this.prisma.sendEvent.create({
      data: {
        order_id: orderId,
        txid,
        classification,
        raw_response: raw,
      },
    });
  }
}
```

Hmm, wait. Let me reconsider the two ASSUMPTION comments against the instruction: "If a symbol you need is genuinely missing from both the plan and the references, do not guess silently and do not reason around it: write the file using the most defensible interpretation and mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters."

The claim method: is it "genuinely missing"? The plan's section 3 (types and signatures) for the repository does not include it. But sections 4 and 5 describe its behavior in detail. The *symbol* (the method name) is missing. The behavior is present. I think marking it is the honest choice — the name is my invention. Keep the comment but make it concise.

Actually, hmm, let me reconsider once more whether I should include claimOrder at all. The strict instruction: "implement exactly what the plan specifies for this file. Do not add exports, features, or files that the plan does not name." If I don't include it, the service (next file) can't implement the plan's control flow — but that's not my problem in this file. If I do include it, am I "adding a feature the plan doesn't name"? The feature (atomic claim) IS named in the plan — it's central to requirements 2 and the concurrency safety. The signature sketch is incomplete relative to the control flow. Given "This file: PayoutRepository with all DB access methods" — all DB access methods includes the claim. I'm confident: include it, mark the name with ASSUMPTION.

For getLatestReconcileRunForDate: the method is named in the plan. Only its exact query semantics are underspecified. Is that "a symbol genuinely missing"? Not a symbol — it's semantics. The ASSUMPTION instruction targets missing symbols. But marking the interpretive choice is still honest and within the spirit. I'll keep a concise comment. Two comments total, each one line-ish.

Let me tighten the comments to be single-line where possible:

```ts
  // ASSUMPTION: plan mandates an atomic pending->sent claim (control flow 2a) but its
  // signature sketch does not name it; `claimOrder` is that method.
```

and

```ts
  // ASSUMPTION: "for a date" is read as the most recent run whose window overlaps
  // the UTC calendar day of the given effective date.
```

Good.

One more style check: the codebase uses 2-space indentation, double quotes (per the reference file). ✓ Semicolons. ✓

Line length — keep reasonable.

Also: `86_400_000` numeric separator — fine in TS. Or write `24 * 60 * 60 * 1000` for clarity. I'll use `24 * 60 * 60 * 1000` for readability.

Double-checking `new Date("2025-01-15T00:00:00.000Z")` — valid ISO, parses as UTC midnight. ✓ If the date string is malformed, it yields Invalid Date — but effective_date is stored as YYYY-MM-DD per the plan. Fine.

Also `orderBy: { created_at: "desc" }` — two runs with the same created_at (unlikely, ms precision) — fine.

I think the file is complete. Let me also verify no unused imports: Order (used in return types), Prisma (OrderUpdateInput), PrismaClient (constructor), ReconcileRun, SendEvent (return types), SendClassification (createSendEvent param), OrderState (updateState param), ReconcileWindow (createReconcileRun param). All used. ✓

Reply format: one fenced block, nothing else.
```

## reply

```ts
import type { Order, Prisma, PrismaClient, ReconcileRun, SendEvent } from "@prisma/client";
import type { SendClassification } from "./bank-client";
import type { OrderState, ReconcileWindow } from "./payout.types";

export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findPendingOrders(): Promise<Order[]> {
    return this.prisma.order.findMany({ where: { state: "pending" } });
  }

  findById(id: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { id } });
  }

  // ASSUMPTION: the plan's control flow (step 2a) mandates an atomic
  // pending -> sent claim with send_attempts incremented, but its signature
  // sketch does not name the method; `claimOrder` is that method.
  async claimOrder(id: string): Promise<Order | null> {
    const result = await this.prisma.order.updateMany({
      where: { id, state: "pending" },
      data: { state: "sent", send_attempts: { increment: 1 } },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.order.findUnique({ where: { id } });
  }

  async updateState(id: string, state: OrderState, sendAttempts?: number): Promise<Order> {
    const data: Prisma.OrderUpdateInput = { state };
    if (sendAttempts !== undefined) {
      data.send_attempts = sendAttempts;
    }
    return this.prisma.order.update({ where: { id }, data });
  }

  findOrdersByTxids(txids: string[]): Promise<Order[]> {
    return this.prisma.order.findMany({ where: { txid: { in: txids } } });
  }

  findOrdersByEffectiveDate(date: string): Promise<Order[]> {
    return this.prisma.order.findMany({ where: { effective_date: date } });
  }

  createReconcileRun(window: ReconcileWindow, matchedCount: number): Promise<ReconcileRun> {
    return this.prisma.reconcileRun.create({
      data: {
        window_from: window.from,
        window_to: window.to,
        matched_count: matchedCount,
      },
    });
  }

  // ASSUMPTION: "latest reconcile run for a date" is read as the most recent
  // run whose window overlaps the UTC calendar day of the given effective date.
  getLatestReconcileRunForDate(date: string): Promise<ReconcileRun | null> {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return this.prisma.reconcileRun.findFirst({
      where: {
        window_from: { lt: end },
        window_to: { gte: start },
      },
      orderBy: { created_at: "desc" },
    });
  }

  createSendEvent(
    orderId: string,
    txid: string,
    classification: SendClassification,
    raw: string,
  ): Promise<SendEvent> {
    return this.prisma.sendEvent.create({
      data: {
        order_id: orderId,
        txid,
        classification,
        raw_response: raw,
      },
    });
  }
}
```
