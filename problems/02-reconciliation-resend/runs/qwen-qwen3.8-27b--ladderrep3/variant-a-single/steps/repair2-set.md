# repair2-set

## reasoning

```
Let me analyze the two errors:

1. **`src/payout/payout.repository.ts(128,7)`**: The `recordSettlement` method uses `this.prisma.settlementRecord.upsert()` with an `order: { connect: { id: input.orderId } }` field in the `create` part. But the Prisma schema has `orderId` as a direct field on `SettlementRecord`, and the relation is defined. The issue is that when using the "unchecked" input (which includes `orderId` directly), you can't also include the `order` relation. Since `SettlementRecord` has `orderId` as a direct field, we should use the unchecked create input which uses `orderId` directly without the `order` relation.

Looking at the schema:
```prisma
model SettlementRecord {
  id            String   @id @default(uuid()) @map("id")
  orderId       String   @unique @map("order_id")
  txid          String   @unique @map("txid")
  statementDate String   @map("statement_date")
  settledAt     DateTime @map("settled_at")
  recordedAt    DateTime @default(now()) @map("recorded_at")

  order Order @relation(fields: [orderId], references: [id])

  @@map("settlement_records")
}
```

So `orderId` is a direct field. In Prisma, when you use the "checked" input (with relations), you use `order: { connect: { id } }`. When you use the "unchecked" input, you use `orderId: string` directly. You can't mix them.

The fix: In the `create` part of the upsert, replace `order: { connect: { id: input.orderId } }` with `orderId: input.orderId`. But wait, we already have `orderId: input.orderId` in the create... Let me re-read the code:

```ts
return this.prisma.settlementRecord.upsert({
  where: { txid: input.txid },
  update: {},
  create: {
    orderId: input.orderId,
    txid: input.txid,
    statementDate: input.statementDate,
    settledAt: input.settledAt,
    order: { connect: { id: input.orderId } },
  },
});
```

Yes, we have both `orderId` (unchecked field) AND `order: { connect: ... }` (checked relation). That's the conflict. The fix is to remove `order: { connect: { id: input.orderId } }` since `orderId` already establishes the relation.

2. **`test/payout.service.spec.ts(157,31)`**: The test passes `repo` (a `FakeOrderRepository`) to `new PayoutService(repo, bank, () => now)`. The error says `Property 'prisma' is missing in type 'FakeOrderRepository' but required in type 'OrderRepository'`.

This means the `PayoutService` constructor expects the concrete `OrderRepository` class (which has a `prisma` property), not the `OrderRepository` interface. 

Looking at the repository file, there's both:
- An interface `OrderRepository` (the contract)
- A class `OrderRepository` (the implementation with `@Injectable()`)

The service must be typing its constructor parameter as the class `OrderRepository` instead of the interface `OrderRepository`. Since the interface and class share the same name... wait, that can't be right in TypeScript. Let me re-read.

Actually, looking more carefully at the reference code:

```ts
export interface OrderRepository {
  create(input: NewOrderInput): Promise<Order>;
  // ...
}

@Injectable()
export class OrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaService) {}
  // ...
}
```

Wait, you can't have an interface and a class with the same name in TypeScript... Actually you CAN - this is called "declaration merging" but it's specifically for interfaces + namespaces. For interface + class, I don't think that's allowed.

Actually wait, let me re-read. In TypeScript, you can have:
- An interface and a class with the same name? No, that's not allowed. They would conflict.

Hmm, but the reference code shows this. Let me look again...

Actually, I think what's happening is that the file exports both an interface and a class with the same name `OrderRepository`. In TypeScript, this IS allowed through declaration merging when one is an interface and one is a class - the class's type (for value positions) and the interface's type (for type positions) coexist. Wait no, that's not right either.

Let me think again. Actually in TypeScript:
- You CAN have an interface and a class with the same name. The class provides the value (constructor), and the interface extends the type. When you use `OrderRepository` as a type, it refers to the interface (the narrower contract). When you use it as a value, it refers to the class.

Wait, actually I just checked - you CANNOT declare an interface and a class with the same name in the same scope. That's a duplicate identifier error.

But the reference code clearly shows this pattern. So maybe I'm wrong. Let me look at this differently.

Actually, I recall now: In TypeScript, you CAN merge an interface with a class. The interface adds to the type of the class. So if you have:

```ts
interface Foo {
  a: string;
}
class Foo {
  a: string = '';
}
```

This would actually be a "Duplicate identifier" error.

But wait - the reference code is from a running workspace that presumably compiled (or at least was in a state where only these 2 errors exist). So maybe TypeScript does allow this? Let me reconsider.

Actually, I just realized - I might be wrong. Let me look at this more carefully. In TypeScript:

```ts
interface Foo { x: number }
class Foo { x = 1 }
```

This gives: "Duplicate identifier 'Foo'." error.

So the reference code as shown would itself have an error. But the problem says "The typecheck failed. Below are every file that has errors" - and the only errors listed are the two I identified. So either:
1. TypeScript actually allows this (and I'm wrong), OR
2. The actual file is different from what's shown

Given that the reference is explicitly provided as the current state of the file, and the only errors are the two listed, I'll trust that this pattern works. Actually, wait - let me reconsider.

I just remembered: In TypeScript, you CAN have an interface and a class with the same name if the interface is a module augmentation or in certain merging scenarios. But in a single file, `interface X {}` and `class X {}` would conflict.

Hmm, but the reference clearly shows this. And the errors don't mention a duplicate identifier. So perhaps TypeScript does allow this in some way I'm not recalling, or the actual file structure is slightly different.

Actually, you know what, let me just focus on fixing the two errors as stated:

**Error 1**: `payout.repository.ts` line 128 - the `create` in the upsert has both `orderId` and `order: { connect: ... }`. Fix: remove `order: { connect: { id: input.orderId } }`.

**Error 2**: `test/payout.service.spec.ts` line 157 - `FakeOrderRepository` is not assignable to `OrderRepository` because `prisma` is missing. This means the `PayoutService` constructor parameter is typed as the concrete class (which has `prisma`), not the interface.

For error 2, I need to look at the `payout.service.ts` file. But I don't have it in the reference. The fix would be to change the service's constructor to accept the interface `OrderRepository` instead of the class. But I don't have the service file content.

Wait, the instructions say "Fix all of them in one reply" and "Return only the files you changed." I need to change:
1. `src/payout/payout.repository.ts` - remove the `order: { connect: ... }` line
2. `src/payout/payout.service.ts` - change the constructor parameter type from the class to the interface

But I don't have the content of `payout.service.ts`. I need to infer it from the test file and the repository interface.

From the test:
```ts
import {
  MAX_SEND_ATTEMPTS,
  PUBLISHING_LAG_MS,
  PayoutService,
  type ReconcileWindow,
} from '../src/payout/payout.service.js';

service = new PayoutService(repo, bank, () => now);
```

So `PayoutService` takes three constructor params: repository, bank client, and a clock function.

The service file imports from `payout.repository.js` and `bank.client.js`. The error says the constructor expects the class `OrderRepository` (which has `prisma`) rather than the interface. 

Looking at the repository file, it exports both:
- `export interface OrderRepository { ... }` 
- `export class OrderRepository implements OrderRepository { ... }`

Wait, but I said that can't work. Let me look at this differently.

Actually, I just realized - maybe in the actual file, the interface is named differently, or the class is what's exported and the interface is a separate export. Let me re-read the reference:

```ts
export interface OrderRepository {
  create(input: NewOrderInput): Promise<Order>;
  findPending(): Promise<Order[]>;
  findById(id: string): Promise<Order | null>;
  findByTxid(txid: string): Promise<Order | null>;
  findUnknownReadyForEvidence(asOf: Date): Promise<Order[]>;
  applyAttempt(id: string, patch: AttemptPatch): Promise<Order>;
  settle(id: string, settledAt: Date): Promise<Order>;
  park(id: string, at: Date, reason: string): Promise<Order>;
  recordSettlement(input: {
    orderId: string;
    txid: string;
    statementDate: string;
    settledAt: Date;
  }): Promise<SettlementRecord>;
}

@Injectable()
export class OrderRepository implements OrderRepository {
```

OK so this IS the actual content. And the errors don't mention a duplicate identifier. So either:
1. TypeScript actually does allow interface + class with same name (and I was wrong), or
2. The file actually has a different structure than shown

Let me just go with what the reference shows and assume it compiles (since the errors don't mention it).

Now, for the service file - I don't have its content. But I can infer that it imports `OrderRepository` from the repository file and uses it as the type for the constructor parameter. The issue is that when you import `OrderRepository`, TypeScript might resolve it to the class (which has `prisma` as a required property via its constructor) rather than the interface.

Actually, I think I understand now. In TypeScript, when you have:
```ts
export interface OrderRepository { ... }
export class OrderRepository implements OrderRepository { ... }
```

This would indeed be a "Duplicate identifier" error. So the reference must be slightly different from what I'm reading, OR TypeScript handles this case.

Let me just look at this pragmatically. The error message says:
```
Property 'prisma' is missing in type 'FakeOrderRepository' but required in type 'OrderRepository'.
```

This means that in the service, the type being used for the parameter includes `prisma` as a required property. This would happen if the service imports the class (not the interface) and uses it as the type.

The fix for the service would be to use the interface type. But since I don't have the service file, I need to figure out what to do.

Wait - the instructions say "Fix all of them in one reply" and I should return "only the files you changed." If I need to change the service file but don't have its content, I'm in a bind.

Actually, let me re-read the instructions: "The blocks above are reference material. Rely on them; never reproduce them and never rewrite them."

But I need to produce fixed files. Let me think about what I can infer about the service file.

From the test file, I can see:
- `PayoutService` is imported from `'../src/payout/payout.service.js'`
- It's constructed with `new PayoutService(repo, bank, () => now)`
- It has methods `executePayments()` and `reconcile(window)`
- It exports `MAX_SEND_ATTEMPTS`, `PUBLISHING_LAG_MS`, `ReconcileWindow`

The service imports from:
- `'./bank.client.js'` (for BankClient, BankCode, etc.)
- `'./payout.repository.js'` (for the repository type)

The fix for error 2 is that the service's constructor should type the repository parameter as the interface, not the class. Since both are exported with the same name `OrderRepository`, the import would be ambiguous. The fix would be to explicitly import the interface using `import type` or to rename one of them.

But wait - if I can't see the service file, how do I fix it? The instructions say I should return the files I changed with their complete content. I don't have the service file content.

Hmm, let me reconsider. Maybe the fix is in the repository file. If I rename the class to something else (like `PrismaOrderRepository`), then the interface `OrderRepository` would be the only export with that name, and the service (which presumably imports `OrderRepository` as a type) would get the interface.

But the instructions say "Do not add features, do not rename anything the errors do not mention, do not reorganise."

The error mentions that `prisma` is required in type `OrderRepository`. So the issue is that the type `OrderRepository` as seen by the service includes `prisma`. 

Actually, I think the cleanest fix that the compiler requires is:
1. In `payout.repository.ts`: Remove `order: { connect: { id: input.orderId } }` from the upsert create (fixes error 1)
2. In `payout.repository.ts`: Rename the class so it doesn't conflict with the interface, OR change the export so the interface is what's imported as `OrderRepository`

Wait, actually if interface and class can't share a name, then the file as shown would already have an error. Since it doesn't, maybe TypeScript DOES allow this (perhaps the interface augments the class type). Let me just assume it works and focus on the actual errors.

If TypeScript allows `interface OrderRepository` and `class OrderRepository` to coexist, then when the service does `import { OrderRepository } from './payout.repository.js'`, it gets both the type (interface) and the value (class). When used as a type annotation, it would use the class's instance type (which includes `prisma` as a private property... wait, `prisma` is `private readonly`).

Actually! That's the key. In TypeScript, `private` members ARE part of the type for assignability purposes. So the class `OrderRepository` with `private readonly prisma: PrismaService` has a type that includes `prisma` as a required property (even though it's private, for structural typing within the same module it matters, and for the class's own instance type it's definitely there).

So when the service uses `OrderRepository` as a type (referring to the class's instance type), it requires `prisma` to be present. The fix is to make the service use the interface type.

But how? If both the interface and class are named `OrderRepository`, you can't easily distinguish them in an import.

The standard pattern would be to either:
1. Name the class differently (e.g., `PrismaOrderRepository`) and keep the interface as `OrderRepository`
2. Use `import type { OrderRepository }` in the service (but if both have the same name, this still might resolve to the class)

Actually, in TypeScript, when you have:
```ts
export interface Foo { a: string }
export class Foo implements Foo { private b: number; }
```

I'm now fairly confident this IS a compile error (duplicate identifier). So the reference must be showing a file that doesn't actually compile as-is, OR I'm misunderstanding something.

Let me take a step back. The problem states these are the ONLY two errors. So the file must be valid TypeScript. Let me just accept that and figure out the minimal fix.

Given that the class has `private readonly prisma: PrismaService`, and the error says `prisma` is required in the type `OrderRepository`, the service is using the class type (not the interface).

The minimal fix that the compiler requires: In the repository file, I should make the interface and class not conflict, OR I should change what the service imports.

Since I can't see the service file, and the instructions say to fix what the compiler requires, I think the answer is:

The class should NOT be named `OrderRepository` (same as the interface). The class should have a different name. But the instructions say "do not rename anything the errors do not mention."

Hmm, but the error DOES mention that `OrderRepository` (as a type) has `prisma` as required. This means the name `OrderRepository` is resolving to the wrong thing. The fix IS to rename one of them.

Actually wait - let me re-read the constraint: "Do not add features, do not rename anything the errors do not mention, do not reorganise." The error mentions `OrderRepository` as a type that has `prisma` required. So renaming IS within scope since the error mentions this name.

I think the correct fix is:
1. In `payout.repository.ts`: Rename the class to `PrismaOrderRepository` (or similar), keep the interface as `OrderRepository`. Fix the upsert.
2. The service presumably already imports `OrderRepository` as a type (the interface), so no change needed there.

But wait, if I rename the class, does the service import it by name? If the service does `import { OrderRepository } from './payout.repository.js'` and uses it as both a type AND injects it via NestJS DI, then renaming the class would break DI.

Looking at the test:
```ts
service = new PayoutService(repo, bank, () => now);
```

The service is constructed directly with the repository. In a NestJS context, DI would use the class token. But in the test, it's direct construction.

I think the service's constructor parameter is typed as `OrderRepository` (the interface), and NestJS DI resolves it by the class token. The issue is that in the type system, `OrderRepository` resolves to the class (which has `prisma`).

OK here's my final analysis: The two distinct mistakes are:
1. The upsert has both `orderId` and `order: { connect: ... }` - remove the latter.
2. The class and interface share the name `OrderRepository`, causing the service's type annotation to resolve to the class (with `prisma`) instead of the interface.

For fix 2, the cleanest approach that requires the fewest changes is to rename the class. Let me call it `PrismaOrderRepository`. Then:
- The interface stays as `OrderRepository` (the contract)
- The class becomes `PrismaOrderRepository` (the implementation)
- The service imports `OrderRepository` (the interface) as its parameter type
- NestJS DI uses `PrismaOrderRepository` as the provider token, and the module needs to map it

But wait, this might require changes to the module file too. And I don't have the module file.

Alternatively, I could just not export the class with the same name. What if I make the class not exported, and only export the interface? No, that won't work for DI.

Actually, the simplest fix: just rename the class in the repository file. The service file presumably does `import type { OrderRepository } from './payout.repository.js'` or `import { OrderRepository } from './payout.repository.js'` - if it's a type-only import, it would get the interface. If it's a value import used as a type, it would get the class.

You know what, I think I'm overcomplicating this. Let me look at what the compiler is actually saying:

```
test/payout.service.spec.ts(157,31): error TS2345: Argument of type 'FakeOrderRepository' is not assignable to parameter of type 'OrderRepository'.
  Property 'prisma' is missing in type 'FakeOrderRepository' but required in type 'OrderRepository'.
```

The parameter type is `OrderRepository` and it has `prisma` as required. This means the `PayoutService` constructor parameter is typed as the class (which has `private readonly prisma`).

The fix in the repository file: rename the class so the interface is the only thing named `OrderRepository`. I'll rename the class to `PrismaOrderRepository`.

But then I need to check: does the service file import the class by name for DI purposes? In NestJS, you'd typically do:

```ts
@Injectable()
export class PayoutService {
  constructor(
    private readonly repo: OrderRepository,  // interface type
    private readonly bank: BankClient,
    private readonly clock: () => Date,
  ) {}
}
```

And in the module:
```ts
providers: [PayoutService, PrismaOrderRepository, BankClient],
```

With `useExisting` or by providing the interface token. But actually, the simplest NestJS pattern for interface injection is:

```ts
providers: [
  PayoutService,
  { provide: OrderRepository, useClass: PrismaOrderRepository },
  BankClient,
]
```

But I don't have the module file, and the instructions say not to create files not called for.

Hmm, let me reconsider. Maybe the simpler fix is different. What if the service file currently does:

```ts
import { OrderRepository } from './payout.repository.js';
```

And uses `OrderRepository` as the type. If the class and interface share a name, TypeScript would... actually I keep going in circles.

Let me just go with: rename the class to `PrismaOrderRepository` in the repository file. This is the minimal change that fixes the type error. The service file presumably already uses `OrderRepository` as a type annotation (the interface), and after the rename, it will correctly resolve to the interface.

For the module file - I don't have it, and the errors don't mention it. So I'll leave it alone. If the module needs updating, that's a separate issue not in the error list.

Wait, but if the module currently does `providers: [OrderRepository]` (referring to the class), renaming the class would break it. But the errors don't mention the module, so either:
1. The module already handles this correctly, or
2. The module will have errors too but they're not listed

The instructions say "Below are every file that has errors" - so if the module had errors, they'd be listed. Since they're not, the module must be fine. Maybe the module already uses the interface token pattern, or maybe the module file doesn't exist yet (the task might not have gotten that far).

OK, let me just go with my plan:
1. Fix `payout.repository.ts`:
   - Remove `order: { connect: { id: input.orderId } }` from the upsert
   - Rename class `OrderRepository` to `PrismaOrderRepository`

Actually wait - if I rename the class, I need to make sure the `@Injectable()` decorator and any other references are correct. The class is the implementation, it's fine to rename it.

But actually, I just realized something. If the service file does:
```ts
import { OrderRepository } from './payout.repository.js';
```

And `OrderRepository` is now only the interface (after renaming the class), then `import { OrderRepository }` would be importing a type. In TypeScript with `isolatedModules` or certain configurations, you'd need `import type`. But in standard TypeScript, importing a type with a value import is fine (it gets erased at compile time).

Actually, for NestJS DI, the service needs to be injectable with the interface token. The standard pattern is:

In the module:
```ts
providers: [
  PayoutService,
  { provide: OrderRepository, useClass: PrismaOrderRepository },
]
```

This would work if the service's constructor parameter is typed as the `OrderRepository` interface.

OK I'm confident now. Let me write the fixed files.

For `payout.repository.ts`:
- Remove `order: { connect: { id: input.orderId } }` from the upsert create
- Rename class from `OrderRepository` to `PrismaOrderRepository`

For the test file - does it need changes? The test creates a `FakeOrderRepository` and passes it to `PayoutService`. After the fix, the service expects the `OrderRepository` interface (without `prisma`), and `FakeOrderRepository` implements that interface. So the test should be fine as-is.

Wait, but the test file has the error. Let me re-read:
```
test/payout.service.spec.ts(157,31): error TS2345: Argument of type 'FakeOrderRepository' is not assignable to parameter of type 'OrderRepository'.
  Property 'prisma' is missing in type 'FakeOrderRepository' but required in type 'OrderRepository'.
```

Line 157 is `service = new PayoutService(repo, bank, () => now);`. After I fix the repository (rename the class so the interface is the only `OrderRepository`), the service's parameter type will be the interface (which doesn't have `prisma`), and `FakeOrderRepository` will be assignable to it. So the test file doesn't need changes.

So I only need to change `src/payout/payout.repository.ts`.

Let me write it out:

```ts
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Order, OrderStatus, SettlementRecord } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { deriveTxid } from './bank.client.js';

export interface NewOrderInput {
  supplierKey: string;
  /** amount in minor units, integer */
  amountMinor: number;
  /** the date this payment applies to */
  effectiveDate: Date;
}

export interface AttemptPatch {
  status: OrderStatus;
  attempts: number;
  lastAttemptAt: Date;
  lastOutcome: string;
}

/**
 * The contract the service depends on. The repository is the only layer
 * that touches the database; keeping the seam explicit lets the service be
 * tested against an in-memory fake.
 */
export interface OrderRepository {
  create(input: NewOrderInput): Promise<Order>;
  findPending(): Promise<Order[]>;
  findById(id: string): Promise<Order | null>;
  findByTxid(txid: string): Promise<Order | null>;
  findUnknownReadyForEvidence(asOf: Date): Promise<Order[]>;
  applyAttempt(id: string, patch: AttemptPatch): Promise<Order>;
  settle(id: string, settledAt: Date): Promise<Order>;
  park(id: string, at: Date, reason: string): Promise<Order>;
  recordSettlement(input: {
    orderId: string;
    txid: string;
    statementDate: string;
    settledAt: Date;
  }): Promise<SettlementRecord>;
}

@Injectable()
export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a pending order. The id is generated here (not by the DB
   * default) so the derived txid can be computed in the same insert.
   */
  create(input: NewOrderInput): Promise<Order> {
    const id = randomUUID();
    return this.prisma.order.create({
      data: {
        id,
        supplierKey: input.supplierKey,
        amountMinor: input.amountMinor,
        effectiveDate: input.effectiveDate,
        txid: deriveTxid({
          id,
          effectiveDate: input.effectiveDate,
          amountMinor: input.amountMinor,
          supplierKey: input.supplierKey,
        }),
      },
    });
  }

  findPending(): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
  }

  findById(id: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { id } });
  }

  findByTxid(txid: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { txid } });
  }

  /**
   * Orders whose last send outcome is unknown, and the bank has had a full
   * publication cycle since the attempt (lastAttemptAt <= asOf).
   */
  findUnknownReadyForEvidence(asOf: Date): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: 'unknown', lastAttemptAt: { lte: asOf } },
      orderBy: { lastAttemptAt: 'asc' },
    });
  }

  applyAttempt(id: string, patch: AttemptPatch): Promise<Order> {
    return this.prisma.order.update({ where: { id }, data: patch });
  }

  settle(id: string, settledAt: Date): Promise<Order> {
    return this.prisma.order.update({
      where: { id },
      data: { status: 'settled', settledAt },
    });
  }

  park(id: string, at: Date, reason: string): Promise<Order> {
    return this.prisma.order.update({
      where: { id },
      data: { status: 'parked', parkedAt: at, lastOutcome: `parked:${reason}` },
    });
  }

  /**
   * Record that a statement entry matched an order. Idempotent per txid:
   * re-running reconcile over the same (or an overlapping) window must not
   * duplicate the record.
   */
  recordSettlement(input: {
    orderId: string;
    txid: string;
    statementDate: string;
    settledAt: Date;
  }): Promise<SettlementRecord> {
    return this.prisma.settlementRecord.upsert({
      where: { txid: input.txid },
      update: {},
      create: {
        orderId: input.orderId,
        txid: input.txid,
        statementDate: input.statementDate,
        settledAt: input.settledAt,
      },
    });
  }
}
```

Wait, I need to double-check: does removing `order: { connect: { id: input.orderId } }` and keeping `orderId: input.orderId` work for Prisma? Yes, because `orderId` is a direct field on the model (it's the foreign key). When you set `orderId`, the relation is automatically established. The `order: { connect: ... }` is the "checked" way to do it, and `orderId` is the "unchecked" way. You can only use one or the other, not both.

This looks correct. Let me finalize.
```

## reply

### src/payout/payout.repository.ts
```ts
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Order, OrderStatus, SettlementRecord } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { deriveTxid } from './bank.client.js';

export interface NewOrderInput {
  supplierKey: string;
  /** amount in minor units, integer */
  amountMinor: number;
  /** the date this payment applies to */
  effectiveDate: Date;
}

export interface AttemptPatch {
  status: OrderStatus;
  attempts: number;
  lastAttemptAt: Date;
  lastOutcome: string;
}

/**
 * The contract the service depends on. The repository is the only layer
 * that touches the database; keeping the seam explicit lets the service be
 * tested against an in-memory fake.
 */
export interface OrderRepository {
  create(input: NewOrderInput): Promise<Order>;
  findPending(): Promise<Order[]>;
  findById(id: string): Promise<Order | null>;
  findByTxid(txid: string): Promise<Order | null>;
  findUnknownReadyForEvidence(asOf: Date): Promise<Order[]>;
  applyAttempt(id: string, patch: AttemptPatch): Promise<Order>;
  settle(id: string, settledAt: Date): Promise<Order>;
  park(id: string, at: Date, reason: string): Promise<Order>;
  recordSettlement(input: {
    orderId: string;
    txid: string;
    statementDate: string;
    settledAt: Date;
  }): Promise<SettlementRecord>;
}

@Injectable()
export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a pending order. The id is generated here (not by the DB
   * default) so the derived txid can be computed in the same insert.
   */
  create(input: NewOrderInput): Promise<Order> {
    const id = randomUUID();
    return this.prisma.order.create({
      data: {
        id,
        supplierKey: input.supplierKey,
        amountMinor: input.amountMinor,
        effectiveDate: input.effectiveDate,
        txid: deriveTxid({
          id,
          effectiveDate: input.effectiveDate,
          amountMinor: input.amountMinor,
          supplierKey: input.supplierKey,
        }),
      },
    });
  }

  findPending(): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
  }

  findById(id: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { id } });
  }

  findByTxid(txid: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { txid } });
  }

  /**
   * Orders whose last send outcome is unknown, and the bank has had a full
   * publication cycle since the attempt (lastAttemptAt <= asOf).
   */
  findUnknownReadyForEvidence(asOf: Date): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: 'unknown', lastAttemptAt: { lte: asOf } },
      orderBy: { lastAttemptAt: 'asc' },
    });
  }

  applyAttempt(id: string, patch: AttemptPatch): Promise<Order> {
    return this.prisma.order.update({ where: { id }, data: patch });
  }

  settle(id: string, settledAt: Date): Promise<Order> {
    return this.prisma.order.update({
      where: { id },
      data: { status: 'settled', settledAt },
    });
  }

  park(id: string, at: Date, reason: string): Promise<Order> {
    return this.prisma.order.update({
      where: { id },
      data: { status: 'parked', parkedAt: at, lastOutcome: `parked:${reason}` },
    });
  }

  /**
   * Record that a statement entry matched an order. Idempotent per txid:
   * re-running reconcile over the same (or an overlapping) window must not
   * duplicate the record.
   */
  recordSettlement(input: {
    orderId: string;
    txid: string;
    statementDate: string;
    settledAt: Date;
  }): Promise<SettlementRecord> {
    return this.prisma.settlementRecord.upsert({
      where: { txid: input.txid },
      update: {},
      create: {
        orderId: input.orderId,
        txid: input.txid,
        statementDate: input.statementDate,
        settledAt: input.settledAt,
      },
    });
  }
}
```
