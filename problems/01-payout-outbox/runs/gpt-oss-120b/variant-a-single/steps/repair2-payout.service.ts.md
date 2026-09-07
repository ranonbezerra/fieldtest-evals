# repair2-payout.service.ts

## reasoning

```
We need to rewrite payout.service.ts to fix compile errors. We don't have existing files, but need to create a plausible service according to plan: controller validates input, service holds logic, repository touches DB. Also provider for crypto transfer.

We need to import modules correctly with correct paths. The errors show missing modules: '../prisma/prisma.service', './dto/create-payout.dto', './payout.repository', '../provider/crypto.provider'. Also errors about implicit any for tx parameter.

We need to define a service class with methods to create payout, handle processing, etc. Should use dependency injection.

We need to reference types like Message from @prisma/client, but schema may not have Message model. Since we can't see, we assume there is a Message model. However errors: Module '"@prisma/client"' has no exported member 'Message'. So we should not import Message from client. Probably Message is a table defined in schema, but not exported? In Prisma, models are exported as type definitions: e.g., PrismaClient['message'] etc. Actually each model becomes a property on PrismaClient, not a type export. Types are generated as e.g., Message (capitalized) if using `type Message = Prisma.Message`. Not sure.

Better to avoid importing Message directly. So we should not reference Message type; use generic any or Prisma type.

In payout.service.ts we likely need methods: createPayout(dto), processMessage(message). But we can simplify.

We'll write service with injected repository and provider, PrismaService for transaction. Use @Injectable.

We'll define method createPayout(createDto) that calls repository.createPayout with transaction, handles idempotency, reserves funds (creates ledger entry), and creates message in outbox.

We'll use PrismaService for transaction (prisma.$transaction). Since repository handles DB, service can call repository methods within transaction.

We need to import PrismaService from '../prisma/prisma.service' path.

Add proper types: import { CreatePayoutDto } from './dto/create-payout.dto'.

import { PayoutRepository } from './payout.repository'.

import { CryptoProvider } from '../provider/crypto.provider'.

Also maybe import Prisma from '@prisma/client' for types like Prisma.PrismaClientKnownRequestError.

We must avoid missing modules.

We'll write placeholder logic, but compile.

We'll add comments // ASSUMPTION: about missing types.

Also fix implicit any for tx parameter: define type as Prisma.TransactionClient.

We need to import Prisma from '@prisma/client'.

Implementation:

@Injectable()
export class PayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PayoutRepository,
    private readonly provider: CryptoProvider,
  ) {}

  async createPayout(dto: CreatePayoutDto) {
    return this.prisma.$transaction(async (tx) => {
      // idempotency check
      const existing = await this.repo.findByIdempotencyKey(dto.idempotencyKey, tx);
      if (existing) {
        return existing;
      }
      // check balance
      const account = await this.repo.getAccountForUpdate(dto.accountId, tx);
      if (account.availableBalance < dto.amount) {
        throw new Error('Insufficient funds');
      }
      // reserve funds by creating ledger entry (debit)
      await this.repo.createLedgerEntry({
        accountId: dto.accountId,
        amount: -dto.amount,
        type: 'RESERVED',
        referenceId: undefined,
      }, tx);
      // create payout record
      const payout = await this.repo.createPayout(dto, tx);
      // enqueue message
      await this.repo.createMessage({
        payoutId: payout.id,
        type: 'PAYOUT',
        payload: JSON.stringify(dto),
        attempts: 0,
      }, tx);
      return payout;
    });
  }

  // worker processing
  async processMessage(messageId: number) {
    const message = await this.repo.findMessageById(messageId);
    if (!message) return;
    const payout = await this.repo.getPayoutById(message.payoutId);
    // attempt transfer with retries bounded
    const maxAttempts = 3;
    let attempt = message.attempts;
    try {
      const result = await this.provider.transfer({
        to: payout.destinationAddress,
        amount: payout.amount,
      });
      // update payout status to sent
      await this.repo.updatePayoutStatus(payout.id, 'SENT', tx);
      // create ledger entry credit
      await this.repo.createLedgerEntry({
        accountId: payout.accountId,
        amount: payout.amount,
        type: 'SETTLED',
        referenceId: payout.id,
      }, tx);
      // mark message completed
      await this.repo.deleteMessage(message.id);
    } catch (e) {
      attempt++;
      if (attempt >= maxAttempts) {
        await this.repo.updatePayoutStatus(payout.id, 'FAILED', tx);
        await this.repo.deleteMessage(message.id);
      } else {
        await this.repo.updateMessageAttempts(message.id, attempt, tx);
      }
    }
  }
}

Need to adjust repository method signatures; we cannot know them. Use // ASSUMPTION.

Define types for DTO: interface CreatePayoutDto with fields.

We must import CreatePayoutDto.

Provide placeholders for repository methods returning Promise<any>.

Add any needed imports.

Let's craft final file.
```

## reply

```typescript
// src/payout/payout.service.ts

import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoProvider } from '../provider/crypto.provider';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { PayoutRepository } from './payout.repository';

// ASSUMPTION: The repository exposes the methods used below with the indicated signatures.
// If the real repository differs, adjust the calls accordingly.

@Injectable()
export class PayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: PayoutRepository,
    private readonly cryptoProvider: CryptoProvider,
  ) {}

  /**
   * Creates a payout request while guaranteeing:
   *   - Idempotency (no double‑reserve for the same idempotencyKey)
   *   - Sufficient funds (account balance is checked inside a transaction)
   *   - Ledger entry for the reserved amount
   *   - Outbox message for asynchronous processing
   */
  async createPayout(dto: CreatePayoutDto): Promise<any> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1️⃣ Idempotency check – if a payout already exists for this key, return it.
      const existingPayout = await this.repository.findByIdempotencyKey(
        dto.idempotencyKey,
        tx,
      );
      if (existingPayout) {
        return existingPayout;
      }

      // 2️⃣ Load the account with a row‑level lock (FOR UPDATE) to avoid races.
      const account = await this.repository.getAccountForUpdate(
        dto.accountId,
        tx,
      );
      if (!account) {
        throw new Error('Account not found');
      }

      // 3️⃣ Verify sufficient available balance.
      if (account.availableBalance < dto.amount) {
        throw new Error('Insufficient funds');
      }

      // 4️⃣ Create a ledger entry that *reserves* the amount.
      await this.repository.createLedgerEntry(
        {
          accountId: dto.accountId,
          amount: -dto.amount, // negative = debit / reservation
          type: 'RESERVED', // ASSUMPTION: enum/value understood by the repository
          referenceId: null,
        },
        tx,
      );

      // 5️⃣ Persist the payout record (status = 'CREATED').
      const payout = await this.repository.createPayout(dto, tx);

      // 6️⃣ Enqueue an outbox message for the async worker.
      await this.repository.createMessage(
        {
          payoutId: payout.id,
          type: 'PAYOUT',
          payload: JSON.stringify(dto),
          attempts: 0,
        },
        tx,
      );

      return payout;
    });
  }

  /**
   * Worker‑side processing of a single outbox message.
   * Delivery is at‑least‑once; the method must be safe against duplicate execution.
   *
   * @param messageId Identifier of the outbox message to process.
   */
  async processMessage(messageId: number): Promise<void> {
    // Load the message (no transaction – we only read here).
    const message = await this.repository.findMessageById(messageId);
    if (!message) {
      // Message may have been already processed/deleted.
      return;
    }

    // Load the associated payout.
    const payout = await this.repository.findPayoutById(message.payoutId);
    if (!payout) {
      // Inconsistent state – mark the message for review.
      await this.repository.markMessageNeedsReview(message.id);
      return;
    }

    const MAX_ATTEMPTS = 3;

    // The whole processing is wrapped in a transaction to guarantee atomic updates.
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      try {
        // Attempt the blockchain transfer.
        const result = await this.cryptoProvider.transfer({
          to: payout.destinationAddress,
          amount: payout.amount,
        });

        // Transfer succeeded – update payout status.
        await this.repository.updatePayoutStatus(
          payout.id,
          'SENT', // ASSUMPTION: status literals understood by the repository
          tx,
        );

        // Create a settled ledger entry (credit).
        await this.repository.createLedgerEntry(
          {
            accountId: payout.accountId,
            amount: payout.amount, // positive = credit / settlement
            type: 'SETTLED',
            referenceId: payout.id,
          },
          tx,
        );

        // Remove the processed outbox message.
        await this.repository.deleteMessage(message.id, tx);
      } catch (err) {
        // Transfer failed – decide whether to retry or give up.
        const attempts = (message.attempts ?? 0) + 1;

        if (attempts >= MAX_ATTEMPTS) {
          // Exhausted retries – mark payout as failed and remove the message.
          await this.repository.updatePayoutStatus(
            payout.id,
            'FAILED',
            tx,
          );
          await this.repository.deleteMessage(message.id, tx);
        } else {
          // Increment the attempt counter so the worker can retry later.
          await this.repository.updateMessageAttempts(
            message.id,
            attempts,
            tx,
          );
        }
      }
    });
  }
}
```
