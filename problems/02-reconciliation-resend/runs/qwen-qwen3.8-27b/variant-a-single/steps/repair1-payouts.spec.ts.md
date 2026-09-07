# repair1-payouts.spec.ts

## reasoning

```
Let me analyze the compiler errors that relate to `test/payouts.spec.ts`:

1. `test/payouts.spec.ts(3,80): error TS2307: Cannot find module '../src/bank/bank.client' or its corresponding type declarations.`
2. `test/payouts.spec.ts(4,62): error TS2307: Cannot find module '../src/payouts/payouts.repository' or its corresponding type declarations.`
3. `test/payouts.spec.ts(5,85): error TS2307: Cannot find module '../src/payouts/payouts.service' or its corresponding type declarations.`
4. `test/payouts.spec.ts(6,36): error TS2307: Cannot find module '../src/payouts/payouts.service' or its corresponding type declarations.`

These are all "Cannot find module" errors. The test file is importing from:
- `../src/bank/bank.client` (line 3, column 80)
- `../src/payouts/payouts.repository` (line 4, column 62)
- `../src/payouts/payouts.service` (line 5, column 85)
- `../src/payouts/payouts.service` (line 6, column 36)

The "Cannot find module" errors for the source files mean those modules either don't exist or don't export what's being imported. But the task says "Change nothing the messages do not name." So I can only fix what the test file needs.

Looking at the other errors, the source files DO exist (they have their own errors referencing them), but they have internal issues. The test file's imports are failing because the modules can't be resolved.

Wait, let me re-read. The errors say "Cannot find module" — this means the module files either don't exist at those paths, or they don't have proper type exports. Since other errors reference these same files (like `src/payouts/payouts.service.ts(5,39)`) having errors, the files DO exist but have their own compilation issues.

But the task says to rewrite `test/payouts.spec.ts` only, fixing what these messages require of THIS file. The messages for this file are just "Cannot find module" errors. 

The issue is that the source modules have their own compilation errors, which means their type declarations can't be resolved. But I'm only asked to fix the test file.

Since the modules exist but have internal errors that prevent their types from being resolved, the test file's imports will fail regardless of how I write the test. However, the task says to fix what the messages require of THIS file.

The messages require that the test file can find those modules. Since the modules exist (they're referenced in other errors), the issue might be:
1. The file extensions might be needed (ESM with `"type": "module"`)
2. The named exports might not match

Wait, looking more carefully at the layout convention:
```
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
```

And the stack says ESM with `"type": "module"`. In ESM TypeScript, you typically need file extensions in imports. But NestJS projects usually handle this through tsconfig paths or module resolution settings.

Actually, looking at this more carefully - the "Cannot find module" errors on the source files themselves (like `src/payouts/payouts.module.ts(4,35): error TS2307: Cannot find module './payouts.controller'`) suggest that the project's tsconfig might need `.js` extensions for ESM, OR the files simply don't exist yet.

But wait - the task says these are the compiler's exact messages for the WHOLE workspace. The source files have errors too, meaning they exist but have issues. The test file's "Cannot find module" errors for those source files could be because:
1. The source files have errors that prevent their types from being emitted/resolved
2. The import paths in the test are wrong

Since I can only change the test file, and the source files exist (they have their own errors), the most likely issue is that the test is importing named exports that don't exist in those modules, OR the import paths need adjustment.

Actually, re-reading the problem: "Rewrite `test/payouts.spec.ts` complete, fixing what these messages require of this file."

The messages for the test file are all "Cannot find module" - meaning the modules can't be resolved. Since the source files DO exist (they have their own errors), the issue might be that the test's import paths are slightly off, or that with ESM, the imports need `.js` extensions.

But actually, in a typical NestJS + TypeScript setup, even with `"type": "module"`, the tsconfig usually has `"moduleResolution": "bundler"` or `"module": "NodeNext"` which handles this. The fact that ALL module imports are failing (including `@nestjs/schedule`, `express`, etc.) suggests this might be a node_modules issue OR a tsconfig issue.

Hmm, but I'm told to only fix the test file. Let me think about what I can do:

1. If the issue is missing `.js` extensions for ESM, I could add them
2. If the issue is that the modules don't export what's expected, I need to know what they export

The task says: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

So I should write the test file with reasonable assumptions about the exports, and add ASSUMPTION comments where I'm guessing.

Let me think about what the test needs based on the variant description:

The variant requires tests for:
- timeout-but-settled (no resend)
- proven-absent (resend, same txid)
- attempt exhaustion

The test needs to import:
- From `../src/bank/bank.client`: likely the `BankClient` class and/or types like `SendResponse`, `Settlement`
- From `../src/payouts/payouts.repository`: likely the `PayoutsRepository` class
- From `../src/payouts/payouts.service`: likely the `PayoutsService` class and possibly types

Looking at the column numbers:
- Line 3, col 80: `../src/bank/bank.client` - this is a long import, suggesting multiple named imports before the module path
- Line 4, col 62: `../src/payouts/payouts.repository` - also long
- Line 5, col 85: `../src/payouts/payouts.service` - long
- Line 6, col 36: `../src/payouts/payouts.service` - shorter, maybe a type import

Let me construct the test file. Given the ESM convention and the errors, I'll add `.js` extensions to the imports. Wait, but the source files' own errors don't show them needing `.js` extensions either - they use `./payouts.controller` without extension. So the project is probably configured to not need extensions (maybe `"moduleResolution": "bundler"` or similar).

Actually, the real issue is probably that the source files have compilation errors themselves, which prevents TypeScript from resolving their types. The test file can't import from a module that doesn't compile. But I can only fix the test file...

The best I can do is:
1. Write the test with correct import paths (matching the layout)
2. Use proper named imports based on the naming conventions (PascalCase classes)
3. Add ASSUMPTION comments for shapes I can't see

Let me write a comprehensive test file that tests the three required scenarios. I'll structure it based on the variant requirements:

- `BankClient` is the class in `bank.client.ts` (from the file name and NestJS conventions)
- `PayoutsRepository` is in `payouts.repository.ts`
- `PayoutsService` is in `payouts.service.ts`

For the test scenarios:
1. **Timeout-but-settled (no resend)**: Send times out, but reconciliation finds the txid in the statement. The order should be marked as settled and NOT resent.
2. **Proven-absent (resend, same txid)**: Send times out, reconciliation proves absence past publishing lag. The order should be resent with the SAME txid.
3. **Attempt exhaustion**: After 5 failed attempts, the order is parked for manual review and never auto-reverted.

Let me write this test now. I'll use Vitest with mocked dependencies.

For the bank client, based on the variant:
- `bank.send({txid, amount, key})` returns a response that can be classified as: accepted, duplicate, transient error, permanent rejection
- `bank.getStatement(date)` returns `Settlement[]`

For the repository, it would have methods to find pending orders, update order state, etc.

Let me write the test:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BankClient } from '../src/bank/bank.client.js';
import { PayoutsRepository } from '../src/payouts/payouts.repository.js';
import { PayoutsService, type SendResponse } from '../src/payouts/payouts.service.js';
import type { Order } from '../src/payouts/payouts.service.js';
```

Wait, but if I add `.js` extensions and the project doesn't use them, that would be wrong. And if I don't add them and the project needs them, that's also wrong.

Looking at the source file errors again:
- `src/payouts/payouts.module.ts(4,35): error TS2307: Cannot find module './payouts.controller'`

This shows the source files use `./payouts.controller` without extension. So the project convention is NO extensions. I'll follow that.

Now, the fact that these modules can't be found is likely because the source files have their own errors. But I'm told to only fix the test file. The best I can do is write correct imports and add ASSUMPTION comments.

Actually wait - let me re-read the task more carefully: "Rewrite `test/payouts.spec.ts` complete, fixing what these messages require of this file."

The messages for this file are:
```
test/payouts.spec.ts(3,80): error TS2307: Cannot find module '../src/bank/bank.client' or its corresponding type declarations.
test/payouts.spec.ts(4,62): error TS2307: Cannot find module '../src/payouts/payouts.repository' or its corresponding type declarations.
test/payouts.spec.ts(5,85): error TS2307: Cannot find module '../src/payouts/payouts.service' or its corresponding type declarations.
test/payouts.spec.ts(6,36): error TS2307: Cannot find module '../src/payouts/payouts.service' or its corresponding type declarations.
```

These say the modules can't be found. Since the source files exist (they have their own errors), the issue is that they can't be resolved as modules - likely because they have internal errors. But from the test file's perspective, I can't fix that.

However, the task says "fixing what these messages require of this file." If the modules truly don't exist or can't be resolved, maybe the fix is to mock them differently, or use a different import strategy.

One approach: use `vi.mock()` to mock the modules before importing them. But you still need to import them for `vi.mock` to work properly in most cases.

Another approach: The test file might be importing things that don't exist as named exports. For instance, if `payouts.service.ts` exports `PayoutsService` but not `SendResponse` or `Order`, those would cause "cannot find module" in some TS configurations (though typically they'd be "has no exported member" errors).

Actually, "Cannot find module" specifically means the file/path can't be resolved at all. This is different from "has no exported member." So the issue is purely about path resolution.

Given that ALL module imports in the entire project are failing (even `@nestjs/schedule`, `express`, etc.), this strongly suggests a node_modules or tsconfig issue that affects the whole project. But I can only fix the test file.

The most reasonable interpretation: I should write the test file with correct paths and exports, and the "Cannot find module" errors will resolve once the source files are fixed (which is out of scope for me). My job is to make sure the test file itself is correct in its imports and structure.

Let me write the test with:
- Correct relative paths (no extensions, matching the source convention)
- Reasonable named imports based on conventions
- ASSUMPTION comments for shapes I'm guessing at
- Tests for the three required scenarios

Let me think about what the service's public API would look like based on the variant:

The service needs:
- `executePayments()` - sends pending orders
- `reconcile(window)` - matches statement entries to orders

The service would depend on:
- `BankClient` (for `send` and `getStatement`)
- `PayoutsRepository` (for database operations)

For the test, I'll mock `BankClient` and `PayoutsRepository` and test `PayoutsService` directly.

Let me think about the types I need:

From `bank.client.ts`:
- `BankClient` class
- Types for the send response and settlement

From `payouts.repository.ts`:
- `PayoutsRepository` class

From `payouts.service.ts`:
- `PayoutsService` class
- Possibly some types for orders, responses, etc.

Since I can't see the actual shapes, I'll add ASSUMPTION comments.

Let me draft the test:

```typescript
// ASSUMPTION: BankClient is the exported class name from bank.client.ts
// ASSUMPTION: PayoutsRepository is the exported class name from payouts.repository.ts
// ASSUMPTION: PayoutsService is the exported class name from payouts.service.ts
// ASSUMPTION: The service constructor takes (bankClient, repository)
// ASSUMPTION: bank.send returns an object with a 'status' or 'code' field for classification
// ASSUMPTION: bank.getStatement returns an array of settlement objects with 'txid' field
// ASSUMPTION: The repository exposes methods to find, update, and count attempts for orders

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BankClient } from '../src/bank/bank.client';
import { PayoutsRepository } from '../src/payouts/payouts.repository';
import { PayoutsService } from '../src/payouts/payouts.service';
import type { SendResponse } from '../src/payouts/payouts.service';
```

Hmm, but line 5 has col 85 which is a long import, and line 6 has col 36 which is shorter. Let me think about what would produce those column positions.

Line 5, col 85: `import { PayoutsService, SomeType, OtherType } from '../src/payouts/payouts.service';`
- That's about 85 chars if there are a few named imports

Line 6, col 36: `import type { Something } from '../src/payouts/payouts.service';`
- That's about 36+ chars

Actually the column number points to where the module string starts (the `'` character), not the end of the line. Let me count:

`import { X, Y } from '../src/payouts/payouts.service';`
- `import { X, Y } from ` is about 24 chars, so col would be around 25-30 for the opening quote

For col 85 on line 5: `import { PayoutsService, type SendClassification, type Order } from '../src/payouts/payouts.service';`
- `import { PayoutsService, type SendClassification, type Order } from ` is about 70 chars... that gives col ~71 for the quote. Close to 85 if there are more imports.

For col 36 on line 6: `import type { Window } from '../src/payouts/payouts.service';`
- `import type { Window } from ` is about 31 chars, so col would be ~32. Close to 36.

Or: `import type { ReconcileWindow } from '../src/payouts/payouts.service';`
- `import type { ReconcileWindow } from ` is about 39 chars. That's close to 36.

Actually, let me not over-think the exact column positions since I'm rewriting the file anyway. The key requirement is that the imports resolve and the tests are correct.

Let me write a proper test file now. I'll focus on the three test scenarios and use reasonable assumptions.

Actually, I realize I should think about this differently. The test file currently EXISTS (it has errors), so it has some content. I need to REWRITE it. The errors tell me what it currently imports (4 lines of imports from those modules). I need to write a new version that:
1. Has correct imports (which will work once the source files are fixed)
2. Tests the three required scenarios
3. Follows the testing conventions (Vitest, test behaviour not implementation, assert meaningful things)

Let me write it:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BankClient } from '../src/bank/bank.client';
import { PayoutsRepository } from '../src/payouts/payouts.repository';
import { PayoutsService, type BankSendResult } from '../src/payouts/payouts.service';
import type { ReconcileWindow } from '../src/payouts/payouts.service';
```

Wait, I need to be more careful. Let me think about what makes sense for the domain:

The bank.send response classification:
- accepted
- duplicate
- transient error
- permanent rejection

This classification is likely done IN the service. The raw response from the bank client would be something the service interprets.

Let me think about the service's interface:

```typescript
class PayoutsService {
  constructor(bank: BankClient, repo: PayoutsRepository) {}
  
  async executePayments(): Promise<void> {}
  async reconcile(window: ReconcileWindow): Promise<void> {}
}
```

The repository would have methods like:
- `findPendingOrders()` 
- `updateOrderStatus(orderId, status)`
- `incrementAttempt(orderId)`
- `findOrderById(orderId)`

The bank client would have:
- `send(params: { txid: string, amount: number, key: string })`
- `getStatement(date: Date)`

For the test scenarios:

**1. Timeout-but-settled (no resend)**
- `bank.send` throws/times out (transient error)
- Later, `reconcile` is called
- `bank.getStatement` returns a settlement with the same txid
- The order should be marked as settled
- The order should NOT be resent (attempt count doesn't increment, or status moves to settled)

**2. Proven-absent (resend, same txid)**
- `bank.send` throws/times out
- `reconcile` is called
- `bank.getStatement` does NOT return the txid
- The order should be resent with the SAME txid (deterministic derivation)
- Attempt count increments

**3. Attempt exhaustion**
- Order has already been attempted 5 times
- Another failure occurs
- Order is parked (status = 'manual_review' or similar)
- Subsequent reconciles do NOT resend it

Let me write the test now. I'll use `vi.fn()` for mocks.

For the "same txid" requirement, the test should verify that when a resend happens, the txid passed to `bank.send` is the same as the original attempt. This proves the deterministic derivation is working.

Let me finalize:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BankClient } from '../src/bank/bank.client';
import { PayoutsRepository } from '../src/payouts/payouts.repository';
import { PayoutsService } from '../src/payouts/payouts.service';
import type { PayoutOrder } from '../src/payouts/payouts.service';
```

Hmm, but I'm guessing at export names. Let me add ASSUMPTION comments for each.

Actually, you know what, let me think about this more carefully. The task says the test file "does not compile" and gives me the exact errors. My job is to rewrite it so it compiles. The errors are all "Cannot find module" which means the modules can't be resolved.

But the source files DO exist (they have their own errors). The "Cannot find module" for the test's imports of source files is likely a cascading effect of the source files' own errors. Once the source files are fixed, the test's imports should resolve.

So my job is to:
1. Write a test file with the correct import paths and named exports
2. The named exports must match what the source files actually export
3. Since I can't see the source files, I add ASSUMPTION comments

The key question is: what do the source files export?

Based on the naming conventions:
- `bank.client.ts` → exports `BankClient` (PascalCase class)
- `payouts.repository.ts` → exports `PayoutsRepository` (PascalCase class)
- `payouts.service.ts` → exports `PayoutsService` (PascalCase class)

These are safe assumptions based on the conventions stated.

For types, I'll need to make assumptions. Let me keep it minimal and use the class instances directly, defining local types in the test where needed.

Here's my plan for the test file:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BankClient } from '../src/bank/bank.client';
import { PayoutsRepository } from '../src/payouts/payouts.repository';
import { PayoutsService } from '../src/payouts/payouts.service';
```

Wait, that's only 3 import lines from source files, but the errors show 4 (lines 3, 4, 5, 6). Line 5 and 6 both import from `payouts.service`. So there's a second import from the service - likely a type import.

Let me structure it as:
```
line 1: import { describe, it, expect, vi, beforeEach } from 'vitest';
line 2: (blank or comment)
line 3: import { BankClient, type ... } from '../src/bank/bank.client';
line 4: import { PayoutsRepository, type ... } from '../src/payouts/payouts.repository';
line 5: import { PayoutsService, type ... } from '../src/payouts/payouts.service';
line 6: import type { ... } from '../src/payouts/payouts.service';
```

This matches the 4 error lines. Good.

Now let me write the complete test. I need to be practical here - I'll write a test that would work given reasonable implementations of the service.

Key design decisions for the test:
1. Mock `BankClient` and `PayoutsRepository` using `vi.fn()`
2. Instantiate `PayoutsService` with the mocks
3. Test the three scenarios by setting up mock return values and calling service methods

For the "same txid" assertion in scenario 2, I need to know how the txid is derived. The variant says "derived deterministically from the order + effective date." I'll assume it's a function of order ID and date, and the test just needs to verify that the same txid is used across attempts.

Let me write it out:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BankClient } from '../src/bank/bank.client';
import { PayoutsRepository } from '../src/payouts/payouts.repository';
import { PayoutsService } from '../src/payouts/payouts.service';
import type { PayoutOrder } from '../src/payouts/payouts.service';
```

Actually, I'm overcomplicating this. Let me just write a clean, well-structured test file with ASSUMPTION comments where needed. The important thing is that:
1. The imports use correct paths
2. The named imports are reasonable (PascalCase for classes)
3. The tests cover the three required scenarios
4. The tests assert behaviour, not implementation details
5. Money is in minor units (integers)

Let me write the final version:
```

## reply

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
// ASSUMPTION: BankClient is the default named export of bank.client.ts
import { BankClient } from '../src/bank/bank.client';
// ASSUMPTION: PayoutsRepository is the default named export of payouts.repository.ts
import { PayoutsRepository } from '../src/payouts/payouts.repository';
// ASSUMPTION: PayoutsService and PayoutOrder are named exports of payouts.service.ts
import { PayoutsService, type PayoutOrder } from '../src/payouts/payouts.service';
// ASSUMPTION: ReconcileWindow is a named type export of payouts.service.ts
import type { ReconcileWindow } from '../src/payouts/payouts.service';

function makeOrder(overrides: Partial<PayoutOrder> = {}): PayoutOrder {
  return {
    id: 'ord-1',
    txid: 'tx-ord-1-20250101',
    amountMinor: 15000,
    key: 'bank-account-key',
    status: 'pending',
    attempts: 0,
    effectiveDate: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('PayoutsService', () => {
  let bank: BankClient;
  let repo: PayoutsRepository;
  let service: PayoutsService;

  beforeEach(() => {
    bank = {
      send: vi.fn(),
      getStatement: vi.fn(),
    } as unknown as BankClient;

    repo = {
      findPendingOrders: vi.fn().mockResolvedValue([]),
      findOrderById: vi.fn(),
      updateOrder: vi.fn().mockResolvedValue(undefined),
      incrementAttempt: vi.fn().mockResolvedValue(undefined),
    } as unknown as PayoutsRepository;

    service = new PayoutsService(bank, repo);
  });

  describe('executePayments', () => {
    it('sends each pending order via bank.send with the order txid, amount, and key', async () => {
      const order = makeOrder();
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      (bank.send as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'accepted' });

      await service.executePayments();

      expect(bank.send).toHaveBeenCalledWith({
        txid: order.txid,
        amount: order.amountMinor,
        key: order.key,
      });
    });

    it('classifies a transient error and does not advance the order past pending', async () => {
      const order = makeOrder();
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      (bank.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));

      await service.executePayments();

      // ASSUMPTION: on transient error the repo is told to increment attempt but status stays 'pending'
      expect(repo.incrementAttempt).toHaveBeenCalledWith(order.id);
      expect(repo.updateOrder).not.toHaveBeenCalledWith(order.id, expect.objectContaining({ status: 'settled' }));
    });

    it('does not advance an order to settled when bank.send returns duplicate', async () => {
      const order = makeOrder({ status: 'pending' });
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      (bank.send as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'duplicate' });

      await service.executePayments();

      // ASSUMPTION: duplicate means the bank already has it; service defers to reconcile
      expect(repo.updateOrder).not.toHaveBeenCalledWith(order.id, expect.objectContaining({ status: 'settled' }));
    });

    it('marks an order as permanently rejected when bank.send returns a permanent rejection', async () => {
      const order = makeOrder();
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      (bank.send as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'rejected', reason: 'invalid_key' });

      await service.executePayments();

      // ASSUMPTION: permanent rejection parks the order in a terminal 'rejected' state
      expect(repo.updateOrder).toHaveBeenCalledWith(order.id, expect.objectContaining({ status: 'rejected' }));
    });
  });

  describe('reconcile', () => {
    const window: ReconcileWindow = {
      from: new Date('2025-01-01T00:00:00Z'),
      to: new Date('2025-01-01T01:00:00Z'),
    };

    it('marks an order as settled when the statement contains its txid (timeout-but-settled: no resend)', async () => {
      const order = makeOrder({ status: 'pending', attempts: 1 });
      (repo.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValue(order);
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([
        { txid: order.txid, settledAt: new Date('2025-01-01T00:30:00Z') },
      ]);

      await service.reconcile(window);

      expect(repo.updateOrder).toHaveBeenCalledWith(order.id, expect.objectContaining({ status: 'settled' }));
      // The order must NOT be re-sent
      expect(bank.send).not.toHaveBeenCalled();
    });

    it('resends a proven-absent order with the same txid after publishing lag has passed', async () => {
      const order = makeOrder({ status: 'pending', attempts: 1 });
      (repo.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValue(order);
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      // Statement does NOT contain the order's txid → proven absent
      (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (bank.send as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'accepted' });

      await service.reconcile(window);

      // Same txid is reused (deterministic derivation from order + effective date)
      expect(bank.send).toHaveBeenCalledWith({
        txid: order.txid,
        amount: order.amountMinor,
        key: order.key,
      });
      expect(repo.incrementAttempt).toHaveBeenCalledWith(order.id);
    });

    it('does not resend while within the publishing lag window', async () => {
      // ASSUMPTION: the service compares the order's last-attempt timestamp against the lag
      const order = makeOrder({ status: 'pending', attempts: 1 });
      (repo.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValue(order);
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      // Window is still within the ~30 min lag
      const lagWindow: ReconcileWindow = {
        from: new Date('2025-01-01T00:00:00Z'),
        to: new Date('2025-01-01T00:20:00Z'), // only 20 min elapsed
      };
      (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await service.reconcile(lagWindow);

      expect(bank.send).not.toHaveBeenCalled();
    });

    it('is idempotent: running reconcile twice over overlapping windows does not double-advance', async () => {
      const order = makeOrder({ status: 'pending', attempts: 1 });
      (repo.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValue(order);
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([
        { txid: order.txid, settledAt: new Date('2025-01-01T00:30:00Z') },
      ]);

      await service.reconcile(window);
      // Second call: order is already settled, should be a no-op
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await service.reconcile(window);

      // updateOrder to 'settled' should have been called exactly once
      expect(repo.updateOrder).toHaveBeenCalledTimes(1);
    });
  });

  describe('attempt exhaustion', () => {
    it('parks an order for manual review after 5 failed attempts and never auto-reverts', async () => {
      const order = makeOrder({ status: 'pending', attempts: 5 });
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      // 6th send attempt would exceed the cap — service should park instead
      (bank.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));

      await service.executePayments();

      // ASSUMPTION: status becomes 'manual_review' (or 'parked') after cap is reached
      expect(repo.updateOrder).toHaveBeenCalledWith(order.id, expect.objectContaining({ status: 'manual_review' }));
      // No further send is attempted
      expect(bank.send).not.toHaveBeenCalled();
    });

    it('does not attempt to resend a manually-parked order', async () => {
      const order = makeOrder({ status: 'manual_review', attempts: 5 });
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await service.reconcile(window);

      expect(bank.send).not.toHaveBeenCalled();
    });
  });
});
```
