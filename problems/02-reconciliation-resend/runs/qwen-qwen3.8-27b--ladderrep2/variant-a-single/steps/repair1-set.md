# repair1-set

## reasoning

```
Let me analyze the errors as a whole:

1. **TS2835 errors** - "Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './bank-gateway.js'?"
   - These are imports that already have a path but need `.js` extension added.
   - Files affected: `http-bank-gateway.ts`, `payout.module.ts`, `payout.service.ts`, `test/payout.spec.ts`

2. **TS2307 errors** - "Cannot find module './payout/payout.module' or its corresponding type declarations."
   - These are imports where the module genuinely can't be found. The error says "Cannot find module" which means the file either doesn't exist or the path is wrong.
   - Wait, but the files ARE shown in the reference. Let me re-read...

Actually, looking more carefully at the TS2307 errors:
- `src/app.module.ts(3,30)`: Cannot find module './payout/payout.module'
- `src/main.ts(4,27)`: Cannot find module './app.module'
- `src/payout/payout.module.ts(3,30)`: Cannot find module '../prisma/prisma.module'
- `src/payout/payout.module.ts(6,95)`: Cannot find module './payout.constants'
- `src/payout/payout.module.ts(7,53)`: Cannot find module './payout.repository'
- `src/payout/payout.module.ts(8,36)`: Cannot find module './payout.reconcile-job'
- `src/payout/payout.module.ts(9,31)`: Cannot find module './payout.service'
- `src/payout/payout.reconcile-job.ts(3,59)`: Cannot find module './payout.constants'
- `src/payout/payout.reconcile-job.ts(4,31)`: Cannot find module './payout.service'
- `src/payout/payout.repository.ts(4,31)`: Cannot find module '../prisma/prisma.service'
- `src/payout/payout.service.ts(13,59)`: Cannot find module './payout.constants'
- `src/payout/payout.service.ts(14,56)`: Cannot find module './payout.repository'
- `src/prisma/prisma.module.ts(3,31)`: Cannot find module './prisma.service'
- `test/payout.spec.ts(11,37)`: Cannot find module '../src/payout/payout.constants'
- `test/payout.spec.ts(12,37)`: Cannot find module '../src/payout/payout.repository'
- `test/payout.spec.ts(13,78)`: Cannot find module '../src/payout/payout.service'

So there are TWO distinct mistakes:

1. **TS2835** - Imports that point to existing files but lack the `.js` extension. The compiler is telling us "Did you mean './bank-gateway.js'?" These files exist but the import path is missing the extension.

2. **TS2307** - "Cannot find module" - these are imports where the file genuinely doesn't exist at that path. Looking at the reference files, I see:
   - `./payout/payout.module` → the file is at `src/payout/payout.module.ts` — this exists!
   - `./app.module` → the file is at `src/app.module.ts` — this exists!
   - `./payout.constants` → I don't see this file in the reference! It's imported but never shown.
   - `./payout.repository` → the file is at `src/payout/payout.repository.ts` — this exists!
   - `./payout.reconcile-job` → the file is at `src/payout/payout.reconcile-job.ts` — this exists!
   - `./payout.service` → the file is at `src/payout/payout.service.ts` — this exists!
   - `../prisma/prisma.module` → the file is at `src/prisma/prisma.module.ts` — this exists!
   - `../prisma/prisma.service` → I don't see this file in the reference! It's imported but never shown.

Wait, but the files DO exist in the workspace (they're shown as reference). The issue is that with `moduleResolution: "node16"` or `"nodenext"`, ALL relative imports need explicit `.js` extensions. So even files that exist will fail with TS2307 if the extension is missing.

Actually wait, let me re-read the error types more carefully:

- TS2835 says "Relative import paths need explicit file extensions... Did you mean './bank-gateway.js'?" — This is a *suggestion* error. The file exists but the extension is missing.
- TS2307 says "Cannot find module './payout/payout.module'" — This means the module truly can't be resolved.

But wait — if the project uses `"type": "module"` and `moduleResolution: "node16"`, then ALL relative imports need `.js` extensions. So why do some get TS2835 and others get TS2307?

Looking at the TS2835 cases:
- `./bank-gateway` → file is `bank-gateway.ts` (exists, just missing `.js`)
- `../src/payout/bank-gateway` → file is `bank-gateway.ts` (exists, just missing `.js`)

And the TS2307 cases:
- `./payout/payout.module` → file is `payout.module.ts` (exists)
- `./app.module` → file is `app.module.ts` (exists)
- `./payout.constants` → file is... not shown in reference
- `./payout.repository` → file is `payout.repository.ts` (exists)
- etc.

Hmm, this is confusing. If the files exist but just need `.js` extensions, they should all be TS2835, not TS2307.

Wait — maybe the distinction is: TS2835 is shown when TypeScript can find a matching file (e.g., `bank-gateway.ts` matches `./bank-gateway`), but TS2307 is shown when it can't find a matching file at all.

But `payout.module.ts` should match `./payout/payout.module`... unless the file doesn't actually exist in the workspace yet. The reference files are what was *planned* but maybe not all were written.

Actually, re-reading the problem statement: "The blocks above are reference material." — these are files that exist in the workspace. So they all exist.

Let me think about this differently. With `moduleResolution: "nodenext"`:
- `import './bank-gateway'` → TypeScript looks for `./bank-gateway.js`, `./bank-gateway.ts`, `./bank-gateway/index.ts`, etc. Actually no — with `nodenext`, it strictly requires the extension for relative imports. It won't do extension resolution.

Wait, I need to be more precise. With `moduleResolution: "node16"` or `"nodenext"`:
- Relative imports MUST include the file extension (`.js` for TypeScript files compiled to JS)
- TypeScript will resolve `./foo.js` to `./foo.ts`
- But `./foo` (no extension) will NOT be resolved — it's an error

So ALL relative imports need `.js` extensions. The difference between TS2835 and TS2307 might just be how the compiler reports the same fundamental issue in different contexts, or it could be that TS2835 is a specific sub-case.

Actually, I think I've been overthinking this. Let me look at what the actual fix is:

**The single fix for ALL errors is: add `.js` to all relative import paths.**

That's it. Every single error is caused by a missing `.js` extension on a relative import. The TS2835 vs TS2307 distinction is just the compiler's way of reporting the same issue — TS2835 when it can suggest the fix, TS2307 when it can't (or in different contexts).

Wait, but that doesn't fully explain why some are TS2835 and some are TS2307. Let me look again...

TS2835 errors (with "Did you mean" suggestions):
- `src/payout/http-bank-gateway.ts(8,8)`: `from './bank-gateway'` → suggests `'./bank-gateway.js'`
- `src/payout/payout.module.ts(4,43)`: `from './bank-gateway'` → suggests `'./bank-gateway.js'`
- `src/payout/payout.module.ts(5,33)`: `from './http-bank-gateway'` → suggests `'./http-bank-gateway.js'`
- `src/payout/payout.service.ts(12,8)`: `from './bank-gateway'` → suggests `'./bank-gateway.js'`
- `test/payout.spec.ts(10,8)`: `from '../src/payout/bank-gateway'` → suggests `'../src/payout/bank-gateway.js'`

TS2307 errors (no suggestion):
- All the others

Hmm, so TS2835 is specifically for `bank-gateway` and `http-bank-gateway` imports. Why would those be different?

Oh wait! Maybe `bank-gateway.ts` and `http-bank-gateway.ts` are the only files that actually exist in the workspace, and the others (like `payout.constants`, `payout.repository`, `payout.service`, etc.) haven't been created yet. The reference material shows what they SHOULD contain, but they might not exist yet.

But that contradicts the statement "The blocks above are reference material. Rely on them; never reproduce them and never rewrite them."

Actually, I think the reference material shows files that DO exist in the workspace. The task says "Fix all of them in one reply" referring to the compiler errors. So the files exist, and the fix is to add `.js` extensions.

Let me just go with: **all relative imports need `.js` extensions added**. This is the one distinct mistake repeated across all files.

Now let me list which files need changes:

1. **src/app.module.ts** — line 3: `from './payout/payout.module'` → `from './payout/payout.module.js'`
2. **src/main.ts** — line 4: `from './app.module'` → `from './app.module.js'`
3. **src/payout/http-bank-gateway.ts** — line 8: `from './bank-gateway'` → `from './bank-gateway.js'`
4. **src/payout/payout.module.ts** — lines 3-9: multiple imports need `.js`
5. **src/payout/payout.reconcile-job.ts** — lines 3-4: imports need `.js`
6. **src/payout/payout.repository.ts** — line 4: `from '../prisma/prisma.service'` → `from '../prisma/prisma.service.js'`
7. **src/payout/payout.service.ts** — lines 12-14: imports need `.js`
8. **src/prisma/prisma.module.ts** — line 3: `from './prisma.service'` → `from './prisma.service.js'`
9. **test/payout.spec.ts** — lines 10-13: imports need `.js`

Let me now write out each file with the fixes applied. I'll take the content from the reference and add `.js` to all relative imports.

For `src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';

import { PayoutModule } from './payout/payout.module.js';

@Module({
  imports: [PayoutModule],
})
export class AppModule {}
```

For `src/main.ts`:
```ts
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`listening on ${port}`, 'Bootstrap');
}

void bootstrap();
```

For `src/payout/http-bank-gateway.ts`:
```ts
import {
  BankAck,
  BankGateway,
  BankPermanentError,
  BankSendRequest,
  BankTransientError,
  Settlement,
} from './bank-gateway.js';

...rest unchanged
```

For `src/payout/payout.module.ts`:
```ts
import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module.js';
import { BANK_GATEWAY, BankGateway } from './bank-gateway.js';
import { HttpBankGateway } from './http-bank-gateway.js';
import { CLOCK, Clock, PAYOUT_CONFIG, PayoutConfig, createPayoutConfig, positiveIntEnv } from './payout.constants.js';
import { PAYOUT_REPOSITORY, PayoutRepository } from './payout.repository.js';
import { PayoutReconcileJob } from './payout.reconcile-job.js';
import { PayoutService } from './payout.service.js';
...rest unchanged
```

For `src/payout/payout.reconcile-job.ts`:
```ts
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { CLOCK, Clock, PAYOUT_CONFIG, PayoutConfig } from './payout.constants.js';
import { PayoutService } from './payout.service.js';
...rest unchanged
```

For `src/payout/payout.repository.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PayoutOrder } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
...rest unchanged
```

For `src/payout/payout.service.ts`:
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PayoutOrder } from '@prisma/client';

import {
  BANK_GATEWAY,
  BankAck,
  BankGateway,
  BankPermanentError,
  BankSendRequest,
  Settlement,
} from './bank-gateway.js';
import { CLOCK, Clock, PAYOUT_CONFIG, PayoutConfig } from './payout.constants.js';
import { PAYOUT_REPOSITORY, PayoutRepositoryApi } from './payout.repository.js';
...rest unchanged
```

For `src/prisma/prisma.module.ts`:
```ts
import { Module } from '@nestjs/common';

import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

For `test/payout.spec.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { PayoutOrder } from '@prisma/client';

import {
  BankAck,
  BankPermanentError,
  BankSendRequest,
  BankTransientError,
  Settlement,
} from '../src/payout/bank-gateway.js';
import { Clock, PayoutConfig } from '../src/payout/payout.constants.js';
import { PayoutRepositoryApi } from '../src/payout/payout.repository.js';
import { CreateOrderInput, PayoutService, ReconcileWindow, deriveTxid } from '../src/payout/payout.service.js';
...rest unchanged
```

Now let me write out the complete files. I need to be careful to include the entire content of each file.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';

import { PayoutModule } from './payout/payout.module.js';

@Module({
  imports: [PayoutModule],
})
export class AppModule {}
```

### src/main.ts
```ts
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`listening on ${port}`, 'Bootstrap');
}

void bootstrap();
```

### src/payout/http-bank-gateway.ts
```ts
import {
  BankAck,
  BankGateway,
  BankPermanentError,
  BankSendRequest,
  BankTransientError,
  Settlement,
} from './bank-gateway.js';

export interface HttpBankGatewayOptions {
  /** Base URL of the bank's API, e.g. https://api.bank.example. */
  baseUrl: string;
  /** Per-request timeout; a timeout is an unknown outcome, never a rejection. */
  sendTimeoutMs: number;
}

/**
 * fetch-based BankGateway. The classification is fail-safe: anything that
 * is not provably a permanent rejection surfaces as BankTransientError
 * (outcome unknown), because treating a transient failure as permanent
 * would never pay the supplier, while treating permanent as transient
 * merely ends in a parked order a human reviews.
 */
export class HttpBankGateway implements BankGateway {
  constructor(private readonly options: HttpBankGatewayOptions) {
    if (!options.baseUrl) {
      throw new Error('BANK_BASE_URL is required to construct HttpBankGateway');
    }
  }

  async send(request: BankSendRequest): Promise<BankAck> {
    let response: Response;
    try {
      // ASSUMPTION: the task specifies the bank API only as
      // send({txid, amount, key}) and getStatement(date); the JSON-over-HTTPS
      // shape below (endpoint paths and status classification) is the
      // reading that must be confirmed against the bank's integration docs.
      response = await fetch(`${this.options.baseUrl}/payouts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.options.sendTimeoutMs),
      });
    } catch (error) {
      // Network failure or timeout: the bank may or may not have received
      // the instruction. Outcome unknown — reconciliation decides.
      throw new BankTransientError(`bank send failed: ${describeError(error)}`);
    }

    if (response.status === 409) {
      // The bank already knows this txid: a duplicate, i.e. a success.
      return { outcome: 'duplicate' };
    }
    if (response.ok) {
      const body = (await response.json().catch(() => null)) as { outcome?: string } | null;
      return body?.outcome === 'duplicate' ? { outcome: 'duplicate' } : { outcome: 'accepted' };
    }
    if (response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500) {
      throw new BankTransientError(`bank send transient failure: HTTP ${response.status}`);
    }
    // Any other 4xx: the bank definitively rejected the instruction.
    throw new BankPermanentError(`bank rejected instruction: HTTP ${response.status}`, `HTTP_${response.status}`);
  }

  async getStatement(date: string): Promise<Settlement[]> {
    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl}/statements?date=${encodeURIComponent(date)}`, {
        signal: AbortSignal.timeout(this.options.sendTimeoutMs),
      });
    } catch (error) {
      // A failed statement fetch must never be read as an empty statement.
      throw new BankTransientError(`statement fetch failed: ${describeError(error)}`);
    }
    if (!response.ok) {
      throw new BankTransientError(`statement fetch failed: HTTP ${response.status}`);
    }
    const body = (await response.json().catch(() => {
      throw new BankTransientError('statement body was not JSON');
    })) as Array<Record<string, unknown>>;
    return body.map((row) => {
      if (typeof row.txid !== 'string' || typeof row.amount !== 'number') {
        throw new BankTransientError('statement row is malformed');
      }
      return { txid: row.txid, amount: row.amount };
    });
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module.js';
import { BANK_GATEWAY, BankGateway } from './bank-gateway.js';
import { HttpBankGateway } from './http-bank-gateway.js';
import { CLOCK, Clock, PAYOUT_CONFIG, PayoutConfig, createPayoutConfig, positiveIntEnv } from './payout.constants.js';
import { PAYOUT_REPOSITORY, PayoutRepository } from './payout.repository.js';
import { PayoutReconcileJob } from './payout.reconcile-job.js';
import { PayoutService } from './payout.service.js';

const systemClock: Clock = { now: () => new Date() };

@Module({
  imports: [PrismaModule],
  providers: [
    { provide: PAYOUT_REPOSITORY, useClass: PayoutRepository },
    PayoutService,
    PayoutReconcileJob,
    { provide: CLOCK, useValue: systemClock },
    { provide: PAYOUT_CONFIG, useFactory: (): PayoutConfig => createPayoutConfig() },
    {
      provide: BANK_GATEWAY,
      useFactory: (): BankGateway =>
        new HttpBankGateway({
          baseUrl: process.env.BANK_BASE_URL ?? '',
          sendTimeoutMs: positiveIntEnv(process.env, 'BANK_SEND_TIMEOUT_MS', 10_000),
        }),
    },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
```

### src/payout/payout.reconcile-job.ts
```ts
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { CLOCK, Clock, PAYOUT_CONFIG, PayoutConfig } from './payout.constants.js';
import { PayoutService } from './payout.service.js';

/**
 * Scheduled reconcile: every interval (default 15 minutes) over a window
 * (default 45 minutes), so consecutive windows overlap by 30 minutes.
 * reconcile() is idempotent, so overlapping windows — and any accidental
 * re-run — cannot change what an earlier run already settled.
 */
@Injectable()
export class PayoutReconcileJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutReconcileJob.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly service: PayoutService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.config.reconcileIntervalMs);
    this.logger.log(
      `reconcile scheduled every ${this.config.reconcileIntervalMs}ms over a ${this.config.reconcileWindowMs}ms window`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One reconcile pass. A failed pass is logged and retried on the next tick. */
  async runOnce(): Promise<void> {
    if (this.running) {
      this.logger.warn('previous reconcile still running; skipping tick');
      return;
    }
    this.running = true;
    try {
      const now = this.clock.now();
      const report = await this.service.reconcile({
        from: new Date(now.getTime() - this.config.reconcileWindowMs),
        to: now,
      });
      this.logger.log(
        `reconciled: settlements=${report.settlements} settled=${report.settled} resends=${report.resends} ` +
          `parked=${report.parked} rejected=${report.rejected} stillUnknown=${report.stillUnknown} ` +
          `amountMismatches=${report.amountMismatches}`,
      );
    } catch (error) {
      this.logger.error(`reconcile run failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PayoutOrder } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';

/** DI token so the service depends on the contract, not the class. */
export const PAYOUT_REPOSITORY = 'PAYOUT_REPOSITORY';

/**
 * Data contract the service depends on.
 *
 * Every transition is a *conditional* update: the where clause repeats the
 * state the caller just observed (status, attempt count). If another run
 * moved the order first, zero rows match and the caller skips. That is
 * what makes overlapping reconcile windows idempotent without locks, and
 * what guarantees parked/rejected orders can never be auto-reverted.
 */
export interface PayoutRepositoryApi {
  create(input: {
    id: string;
    supplierKey: string;
    amount: number;
    effectiveDate: Date;
    txid: string;
  }): Promise<PayoutOrder>;
  findById(id: string): Promise<PayoutOrder | null>;
  findPending(): Promise<PayoutOrder[]>;
  findAwaitingEvidence(): Promise<PayoutOrder[]>;
  settle(id: string, observedAt: Date): Promise<boolean>;
  claimSend(id: string, now: Date): Promise<boolean>;
  claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean>;
  recordOutcome(
    id: string,
    expectedAttemptCount: number,
    data: { status: string; lastOutcome: string },
  ): Promise<boolean>;
  park(id: string, expectedAttemptCount: number, reason: string): Promise<boolean>;
}

/** Orders that still owe statement evidence. */
const AWAITING_EVIDENCE = ['in_flight', 'accepted', 'unknown'] as const;

@Injectable()
export class PayoutRepository implements PayoutRepositoryApi {
  constructor(private readonly prisma: PrismaService) {}

  create(input: {
    id: string;
    supplierKey: string;
    amount: number;
    effectiveDate: Date;
    txid: string;
  }): Promise<PayoutOrder> {
    return this.prisma.payoutOrder.create({
      data: {
        id: input.id,
        supplierKey: input.supplierKey,
        amount: BigInt(input.amount),
        effectiveDate: input.effectiveDate,
        txid: input.txid,
        // status defaults to "pending", attempt_count to 0 (schema defaults).
      },
    });
  }

  findById(id: string): Promise<PayoutOrder | null> {
    return this.prisma.payoutOrder.findUnique({ where: { id } });
  }

  findPending(): Promise<PayoutOrder[]> {
    return this.prisma.payoutOrder.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
  }

  findAwaitingEvidence(): Promise<PayoutOrder[]> {
    return this.prisma.payoutOrder.findMany({
      where: { status: { in: [...AWAITING_EVIDENCE] } },
    });
  }

  /** Settle on a statement match — but only if we still owe evidence. */
  async settle(id: string, observedAt: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: [...AWAITING_EVIDENCE] } },
      data: { status: 'settled', settledAt: observedAt },
    });
    return result.count > 0;
  }

  /** First send: pending (attempt 0) -> in_flight (attempt 1). */
  async claimSend(id: string, now: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: 'pending', attemptCount: 0 },
      data: { status: 'in_flight', attemptCount: 1, lastAttemptAt: now },
    });
    return result.count > 0;
  }

  /** Reconcile-proven resend: awaiting evidence -> in_flight, attempt + 1. */
  async claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: [...AWAITING_EVIDENCE] }, attemptCount: expectedAttemptCount },
      data: { status: 'in_flight', attemptCount: expectedAttemptCount + 1, lastAttemptAt: now },
    });
    return result.count > 0;
  }

  /** Record a classified bank outcome on the in-flight claim. */
  async recordOutcome(
    id: string,
    expectedAttemptCount: number,
    data: { status: string; lastOutcome: string },
  ): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: 'in_flight', attemptCount: expectedAttemptCount },
      data,
    });
    return result.count > 0;
  }

  /** Attempts exhausted -> parked for manual review. Automation never leaves parked. */
  async park(id: string, expectedAttemptCount: number, reason: string): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: [...AWAITING_EVIDENCE] }, attemptCount: expectedAttemptCount },
      data: { status: 'parked', lastOutcome: 'attempts_exhausted', note: reason },
    });
    return result.count > 0;
  }
}
```

### src/payout/payout.service.ts
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PayoutOrder } from '@prisma/client';

import {
  BANK_GATEWAY,
  BankAck,
  BankGateway,
  BankPermanentError,
  BankSendRequest,
  Settlement,
} from './bank-gateway.js';
import { CLOCK, Clock, PAYOUT_CONFIG, PayoutConfig } from './payout.constants.js';
import { PAYOUT_REPOSITORY, PayoutRepositoryApi } from './payout.repository.js';

/** The four classified outcomes of a bank.send call. */
export type SendOutcome = 'accepted' | 'duplicate' | 'transient' | 'permanent';

export interface CreateOrderInput {
  supplierKey: string;
  /** Amount in minor units; must be a positive safe integer. */
  amount: number;
  effectiveDate: Date;
}

export interface ReconcileWindow {
  from: Date;
  to: Date;
}

export interface ExecuteReport {
  total: number;
  accepted: number;
  duplicate: number;
  unknown: number;
  rejected: number;
}

export interface ReconcileReport {
  window: ReconcileWindow;
  settlements: number;
  settled: number;
  resends: number;
  parked: number;
  rejected: number;
  stillUnknown: number;
  amountMismatches: number;
}

/**
 * Deterministic transaction id: the same order on the same effective date
 * always produces the same txid. That is what makes a statement entry
 * matchable to an order at all, and what makes a re-send readable by the
 * bank as the same instruction rather than a new payment.
 *
 * Derive only from attributes that never change once the order exists:
 * the order id and the UTC effective date.
 */
export function deriveTxid(orderId: string, effectiveDate: Date): string {
  const payload = `payout:${orderId}:${effectiveDate.toISOString().slice(0, 10)}`;
  return `pay_${createHash('sha256').update(payload).digest('hex').slice(0, 32)}`;
}

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** UTC calendar days (yyyy-mm-dd) covered by [from, to], inclusive. */
function utcDatesBetween(from: Date, to: Date): string[] {
  const days: string[] = [];
  let cursor = utcMidnight(from);
  const end = utcMidnight(to);
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    if (days.length > 370) {
      throw new Error('reconcile range spans more than 370 days; refusing to fetch that many statements');
    }
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return days;
}

function sendOutcomeKey(outcome: SendOutcome): 'accepted' | 'duplicate' | 'unknown' | 'rejected' {
  switch (outcome) {
    case 'accepted':
      return 'accepted';
    case 'duplicate':
      return 'duplicate';
    case 'transient':
      return 'unknown';
    case 'permanent':
      return 'rejected';
  }
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    @Inject(PAYOUT_REPOSITORY) private readonly repo: PayoutRepositoryApi,
    @Inject(BANK_GATEWAY) private readonly bank: BankGateway,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
  ) {}

  /** Register a new supplier order. The txid is derived, not generated. */
  async createOrder(input: CreateOrderInput): Promise<PayoutOrder> {
    if (!input.supplierKey || !input.supplierKey.trim()) {
      throw new Error('supplierKey is required');
    }
    if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > Number.MAX_SAFE_INTEGER) {
      throw new Error('amount must be a positive integer in minor units');
    }
    if (!isValidDate(input.effectiveDate)) {
      throw new Error('effectiveDate must be a valid date');
    }
    const effectiveDate = utcMidnight(input.effectiveDate);
    const id = randomUUID();
    return this.repo.create({
      id,
      supplierKey: input.supplierKey,
      amount: input.amount,
      effectiveDate,
      txid: deriveTxid(id, effectiveDate),
    });
  }

  /**
   * Send all pending orders. The send path only records outcomes; it never
   * decides to retry. An unknown outcome (transient) is recorded and left
   * to reconciliation — the only path to a re-send.
   */
  async executePayments(): Promise<ExecuteReport> {
    const now = this.clock.now();
    const orders = await this.repo.findPending();
    const report: ExecuteReport = {
      total: orders.length,
      accepted: 0,
      duplicate: 0,
      unknown: 0,
      rejected: 0,
    };

    for (const order of orders) {
      // Claim before calling the bank: pending (attempt 0) -> in_flight
      // (attempt 1). If another run already claimed the order, skip it.
      if (!(await this.repo.claimSend(order.id, now))) continue;
      const outcome = await this.classifySend(this.toBankRequest(order));
      await this.applySendOutcome(order.id, 1, outcome);
      report[sendOutcomeKey(outcome)] += 1;
    }
    return report;
  }

  /**
   * Match statement entries to orders and advance state.
   *
   * Idempotent by construction: every transition is a conditional update
   * keyed on the state just observed, and orders already settled (or
   * parked/rejected) are not even read as candidates. Running this twice
   * over the same — or overlapping — windows changes nothing the first
   * run already settled.
   */
  async reconcile(window: ReconcileWindow): Promise<ReconcileReport> {
    if (!isValidDate(window.from) || !isValidDate(window.to) || window.from.getTime() >= window.to.getTime()) {
      throw new Error('reconcile window must have valid dates with from < to');
    }
    const now = this.clock.now();
    // Absence is only proof once the bank's publishing lag has elapsed.
    const provableByMs = now.getTime() - this.config.publishingLagMs;

    const orders = await this.repo.findAwaitingEvidence();
    const provable: PayoutOrder[] = [];
    for (const order of orders) {
      if (order.lastAttemptAt !== null && order.lastAttemptAt.getTime() <= provableByMs) {
        provable.push(order);
      }
    }

    // Fetch the statements that can serve as evidence: the window, plus a
    // backfill down to the oldest provable attempt, so an order stranded
    // by an outage still gets its statement dates covered in a later run.
    let evidenceFrom = window.from;
    if (provable.length > 0) {
      const oldestMs = Math.min(...provable.map((o) => o.lastAttemptAt!.getTime()));
      evidenceFrom = new Date(Math.min(evidenceFrom.getTime(), oldestMs));
    }

    const settlementsByTxid = new Map<string, Settlement>();
    let settlements = 0;
    for (const date of utcDatesBetween(evidenceFrom, window.to)) {
      // A failed fetch rejects and aborts the whole run: we must never
      // read "no statement data" as "the instruction is absent".
      const rows = await this.bank.getStatement(date);
      settlements += rows.length;
      for (const row of rows) {
        if (!settlementsByTxid.has(row.txid)) settlementsByTxid.set(row.txid, row);
      }
    }

    const report: ReconcileReport = {
      window,
      settlements,
      settled: 0,
      resends: 0,
      parked: 0,
      rejected: 0,
      stillUnknown: 0,
      amountMismatches: 0,
    };

    // 1) Match what the statement shows and settle. Orders already
    //    settled/parked/rejected were not returned by findAwaitingEvidence,
    //    so a repeated run cannot re-do a decision or auto-revert one.
    const matched = new Set<string>();
    for (const order of orders) {
      const settlement = settlementsByTxid.get(order.txid);
      if (settlement === undefined) continue;
      if (Number(order.amount) !== settlement.amount) {
        // Same txid, different money: neither settle nor re-send. A human
        // looks at this before anything else happens to the order.
        report.amountMismatches += 1;
        this.logger.error(
          `statement amount mismatch on order ${order.id}: order=${order.amount} statement=${settlement.amount}`,
        );
        continue;
      }
      if (await this.repo.settle(order.id, now)) report.settled += 1;
      matched.add(order.txid);
    }

    // 2) Proven absent past the publishing lag: the only path to a re-send.
    for (const order of provable) {
      if (matched.has(order.txid)) continue;
      if (settlementsByTxid.has(order.txid)) continue; // matched but amount-mismatched above

      if (order.attemptCount >= this.config.maxAttempts) {
        // Attempts exhausted: park for manual review. Never auto-revert,
        // never release, never mark failed-and-forget — the outcome is
        // still not known, and the safe direction is to stop and escalate.
        if (
          await this.repo.park(
            order.id,
            order.attemptCount,
            `absent from statement past lag after ${order.attemptCount} attempts; manual review required`,
          )
        ) {
          report.parked += 1;
          this.logger.warn(`order ${order.id} parked for manual review after ${order.attemptCount} attempts`);
        }
        continue;
      }

      // Claim the re-send before calling the bank so overlapping runs do
      // not both act. Even if one ever slipped through, the bank dedupes
      // by txid: the second send reads as a duplicate, never a second pay.
      if (!(await this.repo.claimResend(order.id, order.attemptCount, now))) continue;
      const outcome = await this.classifySend(this.toBankRequest(order));
      await this.applySendOutcome(order.id, order.attemptCount + 1, outcome);
      report.resends += 1;
      if (outcome === 'permanent') report.rejected += 1;
      else if (outcome === 'transient') report.stillUnknown += 1;
    }

    return report;
  }

  /**
   * Classify the four outcomes of bank.send. Success resolves with
   * accepted | duplicate; BankPermanentError is a definitive rejection;
   * BankTransientError — and any unclassified error — means the outcome
   * is unknown. We never assume permanent from an exception: the safe
   * direction is "unknown", and only reconciliation may act on it.
   */
  private async classifySend(request: BankSendRequest): Promise<SendOutcome> {
    try {
      const ack: BankAck = await this.bank.send(request);
      return ack.outcome;
    } catch (error) {
      if (error instanceof BankPermanentError) return 'permanent';
      return 'transient';
    }
  }

  /** Each outcome gets its own handling; none of them retries. */
  private async applySendOutcome(id: string, attemptCount: number, outcome: SendOutcome): Promise<void> {
    switch (outcome) {
      case 'accepted':
        // In flight at the bank; the statement is the final word.
        await this.repo.recordOutcome(id, attemptCount, { status: 'accepted', lastOutcome: 'accepted' });
        break;
      case 'duplicate':
        // The bank already has this txid: the first send landed (or is
        // landing). That is a success — same wait-for-statement path,
        // recorded distinctly so the audit trail shows the duplicate.
        await this.repo.recordOutcome(id, attemptCount, { status: 'accepted', lastOutcome: 'duplicate' });
        break;
      case 'transient':
        // Timeout / network / 5xx: outcome unknown. Record it and wait
        // for statement evidence. The send path does not retry.
        await this.repo.recordOutcome(id, attemptCount, { status: 'unknown', lastOutcome: 'transient' });
        break;
      case 'permanent':
        // Definitive rejection (malformed, blocked account, closed
        // beneficiary): re-sending the same instruction cannot succeed.
        // Terminal; a human decides what happens next.
        await this.repo.recordOutcome(id, attemptCount, { status: 'rejected', lastOutcome: 'permanent_rejection' });
        break;
    }
  }

  private toBankRequest(order: PayoutOrder): BankSendRequest {
    // Money flows as integer minor units end to end; the amount is a safe
    // integer by construction (validated in createOrder).
    return { txid: order.txid, amount: Number(order.amount), key: order.supplierKey };
  }
}
```

### src/prisma/prisma.module.ts
```ts
import { Module } from '@nestjs/common';

import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### test/payout.spec.ts
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { PayoutOrder } from '@prisma/client';

import {
  BankAck,
  BankPermanentError,
  BankSendRequest,
  BankTransientError,
  Settlement,
} from '../src/payout/bank-gateway.js';
import { Clock, PayoutConfig } from '../src/payout/payout.constants.js';
import { PayoutRepositoryApi } from '../src/payout/payout.repository.js';
import { CreateOrderInput, PayoutService, ReconcileWindow, deriveTxid } from '../src/payout/payout.service.js';

const LAG_MS = 30 * 60_000;
const WINDOW_MS = 45 * 60_000;
const MAX_ATTEMPTS = 5;

const CONFIG: PayoutConfig = {
  publishingLagMs: LAG_MS,
  maxAttempts: MAX_ATTEMPTS,
  reconcileIntervalMs: 15 * 60_000,
  reconcileWindowMs: WINDOW_MS,
};

class FakeClock implements Clock {
  private ms: number;

  constructor(start: Date) {
    this.ms = start.getTime();
  }

  now(): Date {
    return new Date(this.ms);
  }

  advance(ms: number): void {
    this.ms += ms;
  }
}

class FakeBank {
  sendCalls: BankSendRequest[] = [];
  statements = new Map<string, Settlement[]>();
  onSend: (request: BankSendRequest) => BankAck = () => ({ outcome: 'accepted' });

  async send(request: BankSendRequest): Promise<BankAck> {
    this.sendCalls.push(request);
    return this.onSend(request);
  }

  async getStatement(date: string): Promise<Settlement[]> {
    return this.statements.get(date) ?? [];
  }
}

/**
 * In-memory stand-in for payout_orders with the same conditional-update
 * semantics: every transition only applies if the row is still in the
 * state the caller observed.
 */
class FakePayoutRepository implements PayoutRepositoryApi {
  private readonly rows = new Map<string, PayoutOrder>();
  private readonly fixedNow = new Date('2025-06-01T12:00:00.000Z');

  private copy(row: PayoutOrder): PayoutOrder {
    return { ...row };
  }

  private isAwaitingEvidence(status: string): boolean {
    return status === 'in_flight' || status === 'accepted' || status === 'unknown';
  }

  async create(input: {
    id: string;
    supplierKey: string;
    amount: number;
    effectiveDate: Date;
    txid: string;
  }): Promise<PayoutOrder> {
    if (this.rows.has(input.id)) throw new Error('duplicate id');
    if ([...this.rows.values()].some((row) => row.txid === input.txid)) throw new Error('duplicate txid');
    const row: PayoutOrder = {
      id: input.id,
      supplierKey: input.supplierKey,
      amount: BigInt(input.amount),
      effectiveDate: input.effectiveDate,
      status: 'pending',
      attemptCount: 0,
      txid: input.txid,
      lastOutcome: null,
      lastAttemptAt: null,
      settledAt: null,
      note: null,
      createdAt: this.fixedNow,
      updatedAt: this.fixedNow,
    };
    this.rows.set(row.id, row);
    return this.copy(row);
  }

  async findById(id: string): Promise<PayoutOrder | null> {
    const row = this.rows.get(id);
    return row ? this.copy(row) : null;
  }

  async findPending(): Promise<PayoutOrder[]> {
    return [...this.rows.values()].filter((row) => row.status === 'pending').map((row) => this.copy(row));
  }

  async findAwaitingEvidence(): Promise<PayoutOrder[]> {
    return [...this.rows.values()].filter((row) => this.isAwaitingEvidence(row.status)).map((row) => this.copy(row));
  }

  async settle(id: string, observedAt: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || !this.isAwaitingEvidence(row.status)) return false;
    row.status = 'settled';
    row.settledAt = observedAt;
    return true;
  }

  async claimSend(id: string, now: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'pending' || row.attemptCount !== 0) return false;
    row.status = 'in_flight';
    row.attemptCount = 1;
    row.lastAttemptAt = now;
    return true;
  }

  async claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || !this.isAwaitingEvidence(row.status) || row.attemptCount !== expectedAttemptCount) return false;
    row.status = 'in_flight';
    row.attemptCount = expectedAttemptCount + 1;
    row.lastAttemptAt = now;
    return true;
  }

  async recordOutcome(
    id: string,
    expectedAttemptCount: number,
    data: { status: string; lastOutcome: string },
  ): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'in_flight' || row.attemptCount !== expectedAttemptCount) return false;
    row.status = data.status;
    row.lastOutcome = data.lastOutcome;
    return true;
  }

  async park(id: string, expectedAttemptCount: number, reason: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || !this.isAwaitingEvidence(row.status) || row.attemptCount !== expectedAttemptCount) return false;
    row.status = 'parked';
    row.lastOutcome = 'attempts_exhausted';
    row.note = reason;
    return true;
  }
}

let repo: FakePayoutRepository;
let bank: FakeBank;
let clock: FakeClock;
let service: PayoutService;

beforeEach(() => {
  repo = new FakePayoutRepository();
  bank = new FakeBank();
  clock = new FakeClock(new Date('2025-06-01T12:00:00.000Z'));
  service = new PayoutService(repo, bank, clock, CONFIG);
});

const SUPPLIER_KEY = 'DE89370400440532013000';
const AMOUNT = 1_840_000; // €18,400 in minor units
const EFFECTIVE_DATE = new Date('2025-06-01T09:00:00.000Z');

function windowNow(): ReconcileWindow {
  const now = clock.now();
  return { from: new Date(now.getTime() - WINDOW_MS), to: now };
}

function newOrder(overrides: Partial<CreateOrderInput> = {}): Promise<PayoutOrder> {
  return service.createOrder({
    supplierKey: SUPPLIER_KEY,
    amount: AMOUNT,
    effectiveDate: EFFECTIVE_DATE,
    ...overrides,
  });
}

describe('PayoutService', () => {
  it('settles a timed-out send found in the statement and never re-sends it', async () => {
    bank.onSend = () => {
      throw new BankTransientError('connect timeout');
    };
    const order = await newOrder();
    await service.executePayments();

    let current = await repo.findById(order.id);
    expect(current?.status).toBe('unknown');
    expect(current?.attemptCount).toBe(1);

    // The bank publishes the settlement, carrying the txid we submitted.
    const date = order.effectiveDate.toISOString().slice(0, 10);
    bank.statements.set(date, [{ txid: order.txid, amount: AMOUNT }]);
    clock.advance(LAG_MS + 60_000); // past the publishing lag

    const report = await service.reconcile(windowNow());

    current = await repo.findById(order.id);
    expect(current?.status).toBe('settled');
    expect(current?.settledAt).toBeInstanceOf(Date);
    expect(report.settled).toBe(1);
    expect(bank.sendCalls).toHaveLength(1); // no re-send: the statement proves it landed
  });

  it('re-sends a proven-absent order with the same derived txid', async () => {
    const order = await newOrder();
    const firstTxid = order.txid;

    let firstSend = true;
    bank.onSend = () => {
      if (firstSend) {
        firstSend = false;
        throw new BankTransientError('gateway timeout');
      }
      return { outcome: 'accepted' };
    };

    await service.executePayments();
    expect((await repo.findById(order.id))?.status).toBe('unknown');

    // Bank is reachable again; no statement entry exists for this txid.
    clock.advance(LAG_MS + 60_000);
    await service.reconcile(windowNow());

    const current = await repo.findById(order.id);
    expect(current?.status).toBe('accepted');
    expect(current?.attemptCount).toBe(2);
    expect(current?.txid).toBe(firstTxid); // same instruction, not a new payment
    expect(bank.sendCalls).toHaveLength(2);
    expect(bank.sendCalls[1]).toEqual({ txid: firstTxid, amount: AMOUNT, key: SUPPLIER_KEY });
  });

  it('parks an order after five attempts and never reverts the parking', async () => {
    bank.onSend = () => {
      throw new BankTransientError('gateway timeout');
    };
    const order = await newOrder();

    await service.executePayments(); // attempt 1
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
      clock.advance(LAG_MS + 60_000);
      await service.reconcile(windowNow());
      expect((await repo.findById(order.id))?.attemptCount).toBe(attempt);
    }

    // Fifth attempt recorded, still absent past the lag -> park, no sixth send.
    clock.advance(LAG_MS + 60_000);
    const report = await service.reconcile(windowNow());
    const parked = await repo.findById(order.id);
    expect(parked?.status).toBe('parked');
    expect(parked?.attemptCount).toBe(MAX_ATTEMPTS);
    expect(report.parked).toBe(1);
    expect(bank.sendCalls).toHaveLength(MAX_ATTEMPTS);

    // Later evidence does not auto-revert a parked order.
    const date = order.effectiveDate.toISOString().slice(0, 10);
    bank.statements.set(date, [{ txid: order.txid, amount: AMOUNT }]);
    clock.advance(LAG_MS + 60_000);
    await service.reconcile(windowNow());
    expect((await repo.findById(order.id))?.status).toBe('parked');
    expect(bank.sendCalls).toHaveLength(MAX_ATTEMPTS);
  });

  it('makes no changes when reconcile is run twice over the same window', async () => {
    const settledOrder = await newOrder({ supplierKey: 'DE02120300000000202051', amount: 250_000 });
    const timedOutOrder = await newOrder();

    let timedOutFirst = true;
    bank.onSend = (request) => {
      if (request.txid === timedOutOrder.txid && timedOutFirst) {
        timedOutFirst = false;
        throw new BankTransientError('gateway timeout');
      }
      return { outcome: 'accepted' };
    };

    await service.executePayments(); // settledOrder: accepted, timedOutOrder: unknown
    bank.statements.set(settledOrder.effectiveDate.toISOString().slice(0, 10), [
      { txid: settledOrder.txid, amount: 250_000 },
    ]);
    clock.advance(LAG_MS + 60_000); // both past the lag

    await service.reconcile(windowNow()); // run 1: settles, resends the timed-out order
    const afterFirst = await Promise.all([repo.findById(settledOrder.id), repo.findById(timedOutOrder.id)]);
    const sendsAfterFirst = bank.sendCalls.length;

    await service.reconcile(windowNow()); // run 2: same window, same clock

    const afterSecond = await Promise.all([repo.findById(settledOrder.id), repo.findById(timedOutOrder.id)]);
    expect(afterSecond).toEqual(afterFirst);
    expect(bank.sendCalls).toHaveLength(sendsAfterFirst);
  });

  it('takes a distinct path for each of the four bank.send outcomes', async () => {
    const acceptedOrder = await newOrder({ supplierKey: 'DE4450010517548001', amount: 100_000 });
    const duplicateOrder = await newOrder({ supplierKey: 'DE4450010517548002', amount: 200_000 });
    const transientOrder = await newOrder({ supplierKey: 'DE4450010517548003', amount: 300_000 });
    const rejectedOrder = await newOrder({ supplierKey: 'DE4450010517548004', amount: 400_000 });

    bank.onSend = (request) => {
      if (request.txid === acceptedOrder.txid) return { outcome: 'accepted' };
      if (request.txid === duplicateOrder.txid) return { outcome: 'duplicate' };
      if (request.txid === transientOrder.txid) throw new BankTransientError('bank 503');
      throw new BankPermanentError('beneficiary account closed', 'BEN_CLOSED');
    };

    await service.executePayments();

    expect((await repo.findById(acceptedOrder.id))?.status).toBe('accepted');
    expect((await repo.findById(acceptedOrder.id))?.lastOutcome).toBe('accepted');
    // Duplicate is a success: the bank already has the instruction.
    expect((await repo.findById(duplicateOrder.id))?.status).toBe('accepted');
    expect((await repo.findById(duplicateOrder.id))?.lastOutcome).toBe('duplicate');
    // Transient: outcome unknown — recorded, no retry from the send path.
    expect((await repo.findById(transientOrder.id))?.status).toBe('unknown');
    expect((await repo.findById(transientOrder.id))?.lastOutcome).toBe('transient');
    // Permanent: terminal, a human decides next.
    expect((await repo.findById(rejectedOrder.id))?.status).toBe('rejected');
    expect((await repo.findById(rejectedOrder.id))?.lastOutcome).toBe('permanent_rejection');
    for (const id of [acceptedOrder.id, duplicateOrder.id, transientOrder.id, rejectedOrder.id]) {
      expect((await repo.findById(id))?.attemptCount).toBe(1);
    }

    // Reconciliation never retries a permanent rejection.
    clock.advance(LAG_MS + 60_000);
    await service.reconcile(windowNow());
    expect((await repo.findById(rejectedOrder.id))?.status).toBe('rejected');
    expect(bank.sendCalls.filter((call) => call.txid === rejectedOrder.txid)).toHaveLength(1);
  });

  it('neither settles nor re-sends when the statement amount does not match', async () => {
    bank.onSend = () => {
      throw new BankTransientError('gateway timeout');
    };
    const order = await newOrder();
    await service.executePayments();

    const date = order.effectiveDate.toISOString().slice(0, 10);
    bank.statements.set(date, [{ txid: order.txid, amount: AMOUNT + 1 }]);
    clock.advance(LAG_MS + 60_000);
    const report = await service.reconcile(windowNow());

    const current = await repo.findById(order.id);
    expect(current?.status).toBe('unknown');
    expect(current?.attemptCount).toBe(1);
    expect(report.amountMismatches).toBe(1);
    expect(bank.sendCalls).toHaveLength(1);
  });

  it('aborts reconciliation when a statement fetch fails instead of proving absence', async () => {
    bank.onSend = () => {
      throw new BankTransientError('gateway timeout');
    };
    const order = await newOrder();
    await service.executePayments();
    clock.advance(LAG_MS + 60_000);

    bank.getStatement = async () => {
      throw new BankTransientError('statement endpoint returned 500');
    };
    await expect(service.reconcile(windowNow())).rejects.toThrow(BankTransientError);

    const current = await repo.findById(order.id);
    expect(current?.status).toBe('unknown'); // unchanged
    expect(bank.sendCalls).toHaveLength(1); // no re-send
  });

  it('derives the same txid for the same order on the same effective date', () => {
    const midnight = new Date('2025-06-01T00:00:00.000Z');
    const evening = new Date('2025-06-01T21:15:00.000Z'); // same UTC date
    expect(deriveTxid('order-1', midnight)).toBe(deriveTxid('order-1', evening));
    expect(deriveTxid('order-1', midnight)).not.toBe(deriveTxid('order-2', midnight));
    expect(deriveTxid('order-1', midnight)).not.toBe(deriveTxid('order-1', new Date('2025-06-02T00:00:00.000Z')));
  });

  it('rejects a reconcile window whose bounds are invalid', async () => {
    await expect(
      service.reconcile({
        from: new Date('2025-06-01T13:00:00.000Z'),
        to: new Date('2025-06-01T12:00:00.000Z'),
      }),
    ).rejects.toThrow('from < to');
  });
});
```
