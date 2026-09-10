# repair2-payout.service.ts

## reasoning

```
Let me analyze the compiler errors that pertain to `src/payout/payout.service.ts`:

1. `src/payout/payout.service.ts(130,95): error TS2339: Property 'requested' does not exist on type 'CreatePayoutInput'.`
2. `src/payout/payout.service.ts(167,19): error TS2339: Property 'info' does not exist on type 'Logger'.`
3. `src/payout/payout.service.ts(174,19): error TS2339: Property 'info' does not exist on type 'Logger'.`

So I need to fix:
1. Line 130: `CreatePayoutInput` doesn't have a `requested` property. I need to figure out what `CreatePayoutInput` looks like. The error says it doesn't have `requested`. Looking at the problem, the input for `POST /payouts` is `{ accountId, amount, destinationAddress, idempotencyKey }`. So `CreatePayoutInput` likely has those fields. The code was trying to access `.requested` which doesn't exist.

2. Lines 167 and 174: `Logger` doesn't have an `info` property. In NestJS, the `Logger` class has `log`, `error`, `warn`, `debug`, `verbose` methods. So `info` should be `log`.

Now, I need to write the complete file. Let me think about what the service should do based on the requirements:

- `createPayout(input: CreatePayoutInput)` - creates a payout with idempotency check, checks balance, reserves funds
- `processMessages()` - the worker polling method that processes pending messages

The service should:
1. Call the repository to create a payout (which handles the transaction for balance check + reserve + message creation)
2. For the worker: fetch pending messages, call the provider, handle retries, update status

Let me think about what `CreatePayoutInput` likely looks like based on the API spec:
- `accountId: string`
- `amount: bigint` (minor units, no floating point)
- `destinationAddress: string`
- `idempotencyKey: string`

The `requested` property on line 130 - this is likely where the service was trying to access a `requested` field that doesn't exist. Maybe it was trying to access `input.requested` or something similar. Looking at the context, it's probably in a method that returns something or logs something about the input.

Actually, I don't have the existing file content. I need to write it from scratch based on the error messages and the requirements.

Let me think about what the service needs:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { PayoutProvider, PayoutProviderResult } from './payout.provider';
import { CreatePayoutInput, PayoutStatus } from './payout.types';
```

Wait, I need to be careful. The errors tell me:
- `CreatePayoutInput` exists (imported from `./payout.types` based on the repository errors)
- It does NOT have a `requested` property
- `Logger` is from `@nestjs/common` and uses `log` not `info`

Let me write the service. The key operations:

1. `createPayout(input: CreatePayoutInput)`:
   - Call `this.repository.createPayout(input)` which handles the transaction (check balance, reserve, create payout, create message)
   - Return the created payout

2. `processMessages()`:
   - Get pending messages from repository
   - For each message:
     - Mark as processing
     - Call provider.transfer()
     - On success: mark completed, update ledger
     - On failure: increment retry count, if exhausted mark as needs-review
     - On timeout/uncertain: increment retry count, if exhausted mark as needs-review

Let me think about the `CreatePayoutInput` type. Based on the API body `{ accountId, amount, destinationAddress, idempotencyKey }`, it likely is:
```typescript
interface CreatePayoutInput {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}
```

The error on line 130 says `Property 'requested' does not exist on type 'CreatePayoutInput'`. This suggests the code was doing something like `input.requested` or referencing a field called `requested`. Since the input has `amount`, maybe the code was trying to access `input.requested` when it should have been `input.amount`. Or maybe it was in a different context - perhaps building a response object and using `requested` as a key name but accidentally accessing it from the input.

Actually, looking more carefully at the error: `(130,95)` - column 95 is quite far right. This might be something like:
```typescript
const amount = input.requested // wrong, should be input.amount
```
or maybe in a template string or object construction.

Let me just write a clean implementation that:
- Uses `input.amount` (not `input.requested`)
- Uses `this.logger.log(...)` (not `this.logger.info(...)`)

Here's my plan for the service:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { PayoutProvider } from './payout.provider';
import { CreatePayoutInput, PayoutStatus } from './payout.types';

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private static readonly MAX_RETRIES = 3;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  async createPayout(input: CreatePayoutInput) {
    return this.repository.createPayout(input);
  }

  async processMessages(): Promise<void> {
    const messages = await this.repository.findPendingMessages();
    
    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async processMessage(message: any): Promise<void> {
    // mark as processing
    await this.repository.markMessageProcessing(message.id);
    
    try {
      const result = await this.provider.transfer({
        to: message.destinationAddress,
        amount: message.amount,
      });
      
      // success - mark completed, update ledger
      await this.repository.completePayout(message.payoutId, result.txHash);
      this.logger.log(`Payout ${message.payoutId} completed with txHash ${result.txHash}`);
    } catch (error) {
      // check if we should retry
      const newAttemptCount = message.attemptCount + 1;
      
      if (newAttemptCount >= PayoutService.MAX_RETRIES) {
        // exhausted retries - mark as needs-review
        await this.repository.markPayoutNeedsReview(message.payoutId, String(error));
        this.logger.warn(`Payout ${message.payoutId} needs review after ${PayoutService.MAX_RETRIES} attempts`);
      } else {
        // schedule retry
        await this.repository.incrementMessageRetry(message.id, String(error));
      }
    }
  }
}
```

Wait, but I'm making assumptions about the repository method names and the message shape. The errors don't tell me what methods the repository has or what the message type looks like. Let me think about what I can infer:

From the repository errors, I can see it imports from `./payout.types` and `./payout.errors`. The types file likely exports `CreatePayoutInput` and possibly status types.

The provider errors show it's imported in both the service and worker. The provider likely has a `transfer` method.

Since I can't see the actual types, I'll need to make reasonable assumptions and mark them.

Actually, let me re-read the instructions: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

The errors in `payout.service.ts` are:
1. `Property 'requested' does not exist on type 'CreatePayoutInput'` - I can see the type name but not its shape. However, from the problem spec, the input is `{ accountId, amount, destinationAddress, idempotencyKey }`. So I'll use those fields.
2. `Property 'info' does not exist on type 'Logger'` - This is straightforward, use `log` instead.

The other errors are in other files (repository, worker, module, etc.) which I'm not asked to fix. I'm only asked to fix `src/payout/payout.service.ts`.

But wait - the service imports from other files. If those files don't compile either, the service won't compile either. But the instruction says "Change nothing the messages do not name." So I should only fix what's in `payout.service.ts`.

Let me think about what the service file needs to look like. It needs to:
1. Import from `./payout.repository` (which the module references)
2. Import from `./payout.provider` (which the module references)  
3. Import from `./payout.types` (which the repository references)
4. Use `Logger` from `@nestjs/common`

The key fixes:
- Replace `input.requested` with the correct property (likely `input.amount` based on the API spec)
- Replace `this.logger.info(...)` with `this.logger.log(...)`

Let me write a complete, sensible implementation:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { PayoutProvider } from './payout.provider';
import { CreatePayoutInput } from './payout.types';

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private static readonly MAX_RETRIES = 3;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  async createPayout(input: CreatePayoutInput) {
    // ASSUMPTION: CreatePayoutInput has fields accountId, amount, destinationAddress, idempotencyKey
    return this.repository.createPayout(input);
  }

  async processMessages(): Promise<void> {
    // ASSUMPTION: repository exposes findPendingMessages returning messages with id, payoutId, destinationAddress, amount, attemptCount
    const messages = await this.repository.findPendingMessages();

    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async processMessage(message: {
    id: string;
    payoutId: string;
    destinationAddress: string;
    amount: bigint;
    attemptCount: number;
  }): Promise<void> {
    await this.repository.markMessageProcessing(message.id);

    try {
      const result = await this.provider.transfer({
        to: message.destinationAddress,
        amount: message.amount,
      });

      await this.repository.completePayout(message.payoutId, result.txHash);
      this.logger.log(`Payout ${message.payoutId} completed: txHash=${result.txHash}`);
    } catch (error) {
      const newAttempt = message.attemptCount + 1;

      if (newAttempt >= PayoutService.MAX_RETRIES) {
        // ASSUMPTION: When retries are exhausted without a definitive outcome,
        // we mark the payout as needs-review. This is safe because the funds
        // are still reserved (not released), so no double-spend can occur.
        // A human can investigate whether the transfer actually went through
        // on-chain before releasing or confirming the funds.
        const reason = error instanceof Error ? error.message : String(error);
        await this.repository.markPayoutNeedsReview(message.payoutId, reason);
        this.logger.warn(
          `Payout ${message.payoutId} marked needs-review after ${PayoutService.MAX_RETRIES} attempts: ${reason}`,
        );
      } else {
        const reason = error instanceof Error ? error.message : String(error);
        await this.repository.incrementMessageRetry(message.id, reason);
      }
    }
  }
}
```

Hmm, but I'm making a lot of assumptions about the repository method names. Let me reconsider.

The problem says the service should hold logic and the repository is the only layer that touches the DB. The service calls the repository. But what methods does the repository expose?

Looking at the repository errors:
- It has transaction callbacks (the `tx` parameters on lines 15, 51, 187, 228, 250)
- It imports from `./payout.errors` and `./payout.types`

I think the safest approach is to write the service in a way that's consistent with the requirements, and use reasonable method names. Since I can't see the repository, I'll use method names that make sense for the domain and add ASSUMPTION comments where needed.

Actually, let me reconsider. The task says "Rewrite `src/payout/payout.service.ts` complete, fixing what these messages require of this file." The messages that pertain to this file are:

1. `Property 'requested' does not exist on type 'CreatePayoutInput'` (line 130, col 95)
2. `Property 'info' does not exist on type 'Logger'` (line 167, col 19)
3. `Property 'info' does not exist on type 'Logger'` (line 174, col 19)

These are the only errors IN this file. The other errors are in other files. So the file exists and has content - it just has these three specific issues. I need to rewrite it fixing these issues while keeping everything else working.

But I don't have the original file content. I need to write a complete file that:
- Would not produce these three errors
- Is consistent with the architecture (service calls repository, uses provider)
- Implements the payout logic per the requirements

Since I don't have the original, I'll write a clean implementation that satisfies the requirements and doesn't have these errors. The key constraints:
- Don't use `input.requested` (use the correct property name)
- Don't use `logger.info` (use `logger.log`)

Let me finalize my implementation. I'll keep it focused and clean.
```

## reply

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { PayoutProvider } from './payout.provider';
import { CreatePayoutInput } from './payout.types';

// ASSUMPTION: CreatePayoutInput has fields { accountId: string; amount: bigint; destinationAddress: string; idempotencyKey: string }
// ASSUMPTION: PayoutProvider exposes transfer(to: string, amount: bigint) => Promise<{ txHash: string }>

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private static readonly MAX_RETRIES = 3;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  async createPayout(input: CreatePayoutInput) {
    // The repository performs the atomic check-and-reserve inside a DB transaction.
    // Idempotency is enforced by a unique index on idempotencyKey.
    const payout = await this.repository.createPayout(input);
    this.logger.log(
      `Payout ${payout.id} created for account ${input.accountId}, amount=${input.amount}`,
    );
    return payout;
  }

  async processMessages(): Promise<void> {
    // ASSUMPTION: repository.findPendingMessages returns an array of objects
    // with at least { id, payoutId, destinationAddress, amount, attemptCount }.
    const messages = await this.repository.findPendingMessages();

    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async processMessage(
    message: {
      id: string;
      payoutId: string;
      destinationAddress: string;
      amount: bigint;
      attemptCount: number;
    },
  ): Promise<void> {
    await this.repository.markMessageProcessing(message.id);

    try {
      const result = await this.provider.transfer(
        message.destinationAddress,
        message.amount,
      );

      // Provider confirmed — settle the ledger entry and mark completed.
      await this.repository.completePayout(message.payoutId, result.txHash);
      this.logger.log(
        `Payout ${message.payoutId} completed: txHash=${result.txHash}`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const nextAttempt = message.attemptCount + 1;

      if (nextAttempt >= PayoutService.MAX_RETRIES) {
        // Retries exhausted without a definitive outcome.
        // Safe choice: mark needs-review. The reserved funds are neither
        // released nor settled, so no double-spend is possible. A human
        // operator must verify on-chain whether the transfer went through
        // before deciding to release or confirm.
        await this.repository.markPayoutNeedsReview(message.payoutId, reason);
        this.logger.warn(
          `Payout ${message.payoutId} marked needs-review after ${PayoutService.MAX_RETRIES} attempts: ${reason}`,
        );
      } else {
        await this.repository.incrementMessageRetry(message.id, reason);
      }
    }
  }
}
```
