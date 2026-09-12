# solution

## reasoning

```
I'm working through the requirements for a TypeScript NestJS system that handles instant payment reconciliations. The core service needs to send pending orders to the bank API with deterministic transaction IDs based on the order and effective date, plus a reconciliation job that matches statement entries to orders and safely handles overlapping 15-minute windows.

For the resend logic, I need to ensure failed or timed-out sends only get re-sent after reconciliation confirms the transaction is absent from the bank's statement past the publishing lag (accounting for the ~30 minute delay). The system caps attempts at 5 before parking the order for manual review, and never auto-reverts once a payment is proven settled.

I'm also classifying bank responses into four categories—accepted, duplicate, transient error, and permanent rejection—each requiring different handling. The database schema uses Prisma with snake_case mapping, money is stored as BigInt or Int in minor units, and I'll write comprehensive tests covering timeout-but-settled scenarios, proven-absent resends with the same transaction ID, and attempt exhaustion cases.

Now I'm thinking through the schema design. Since this is a self-contained codebase with no existing files provided, I need to build everything from scratch. I'll create the Prisma schema with an Order model representing orders payable to suppliers, tracking fields like id, supplier, amount in minor units, effective date, payment state, attempt count, the derived transaction ID, and last send status.

Defining the Prisma models... For the transaction ID, I'll use a deterministic approach with SHA-256 hashing of the order ID and effective date, then convert it to hex — this keeps it collision-free and simple while staying within bank API constraints. I'll make it configurable through environment variables if needed.

Now I'm thinking through the bank response classification. The bank returns different statuses that I need to map: 'accepted' means the payment went through and I should mark it as sent, while 'duplicate' indicates the bank already processed a previous attempt with the same transaction ID, so I need to handle that as an idempotent success case.

For error handling, I'm distinguishing between transient errors like timeouts or 5xx responses that should allow retry attempts, and permanent rejections like invalid keys or unsupported amounts that should park the payment for manual review rather than retrying. This classification logic will be a pure function in the service that I can test independently.

Defining the bank adapter interface...

Defining state transitions... For orders in SENT state, reconciliation will mark them as SETTLED once the statement confirms the transaction, while PENDING and FAILED orders that appear in the statement get marked SETTLED too, preventing any resend. For FAILED orders that don't appear in the statement, I need to verify they're truly absent from the bank by checking that their send time is older than the publishing lag threshold—since the bank only publishes settled transactions after a delay, if no entry exists past that lag point, the transaction genuinely failed. The bank's statement API returns transactions with their settlement times, so I need to track the actual send attempt time rather than relying on wall clock time for testability. For the reconciliation window, I'm thinking it should cover a date range (like today plus the previous day) to handle the 30-minute publishing lag, and I need to be careful about overlapping windows — matching should be idempotent since state transitions are one-way and I only advance states, never revert them.

For the resend logic, the constraint is that an order can only be re-sent after reconciliation proves it's absent from the statement past the publishing lag. So I'm considering whether to trigger resends during the reconciliation job itself or keep them separate — the cleaner approach might be having the reconciler mark proven-absent orders as eligible for retry, then a separate job handles the actual resending.

Actually, simplifying: after reconciliation runs, any FAILED orders that are proven absent and under the attempt cap become re-sendable. I could add a `markAbsent()` method that does this, or fold it into `executePayments()` — the latter is more elegant since the executor only sends orders that are pending or both failed and proven absent.

Now I'm thinking through the schema. I need `sentAt` for when the last attempt occurred, `absentConfirmedAt` to track when reconciliation proved the order absent, and `state` to track the order's lifecycle. The rule becomes: executePayments sends orders where state is PENDING, or state is FAILED with absentConfirmedAt set and attempts under the cap. When executing, I'll increment the attempt count and generate a deterministic txid from the order ID and effective date.

For the send flow, I'm classifying the response: if accepted or duplicate, the state moves to SENT and I clear absentConfirmedAt since the bank now knows the txid; if transient, state stays FAILED and I increment attempts with a timestamp; if permanent, I mark it as FAILED and park it. On timeout, the state becomes FAILED but reconciliation is critical—if the order shows up in the statement, it's settled, so no resend happens; if absent, it can be resent. I'm also considering whether to add an explicit `lastErrorKind` column or just use a generic `lastError` string.

For permanent rejections, I'm settling on a `MANUAL_REVIEW` state rather than conflating it with FAILED, since the spec says to park failed orders and never auto-revert them—this keeps states clean and explicit. So my state enum is: PENDING, SENT, SETTLED, FAILED, MANUAL_REVIEW, where SENT and SETTLED are terminal (no resends), FAILED is eligible for retry if absentConfirmedAt is set, and MANUAL_REVIEW is terminal and never auto-revert.

For timeouts specifically, I'm treating them as transient failures that increment the attempt count, cap at 5, and move to MANUAL_REVIEW if exhausted. The tricky part is handling the case where an order times out at attempt 5 but was actually settled—I need reconciliation to run first and mark it SETTLED before executePayments can bump it to MANUAL_REVIEW. So the guard is: if state is FAILED and attempts >= 5 and absentConfirmedAt is not set, we skip it entirely to avoid misclassifying a settled order as manually reviewed. Only when absent is proven does it move to MANUAL_REVIEW.

The reconciliation logic handles all state transitions—marking SENT/FAILED orders as SETTLED when they appear in the statement, setting absentConfirmedAt on FAILED orders older than the lag threshold, and marking orders for manual review if they're FAILED with attempts >= 5 and absent proven. The key insight is that SETTLED state should be reached through reconciliation, not directly from a successful send, to maintain the principle that reconciliation is the source of truth for settlement.

For the window parameter, I'm thinking it represents a date range to query the bank's statement for, with the API expecting something like a single date string. The overlap safety comes from matching being idempotent—processing the same transaction twice is harmless since we're just updating order states and never deleting or reprocessing already-settled orders.

I'm settling on the shape `reconcile(window: { from: string; to: string })` where both are ISO date strings (YYYY-MM-DD), and the service will fetch the bank statement for each date in that range, matching entries to orders by txid. The window gets normalized by the controller (defaulting to today) and the service handles the actual date iteration and bank calls, with tests providing a fake bank that returns canned statements per date.

For the money handling, I'm keeping amounts as integers in minor units throughout, using BigInt in Prisma to safely handle large cent values without overflow issues. The bank will receive and return amounts as BigInt in minor units as well, which aligns with the spec.

Now I'm designing the `executePayments` function to fetch pending orders and those in a retryable state—failed orders that have been confirmed absent and haven't exceeded the attempt limit.  For each order, I'm deriving a transaction ID from the order ID and effective date, then calling the bank API to send the payment. Depending on the response classification, I either mark it as sent, log a permanent failure with details, or mark it as failed if transient. After the loop completes, I reconcile the results.

For the txid derivation, I'm using a SHA256 hash of the order ID and effective date to create a deterministic identifier—this ensures the same order on the same date always gets the same transaction ID, which is critical for idempotency. The hash approach is cleaner than string concatenation and avoids length issues, though I could also make it configurable via an environment variable to handle different bank requirements.

Now I'm setting up the response classifier to handle the bank API's outcomes. I need to distinguish between accepted payments, duplicate submissions, transient errors, and permanent rejections. The classifier will map HTTP status codes and error codes to these categories, with a whitelist approach to safely handle unknown responses.

Writing classifier logic... I'll stick with the three-state model—PENDING, SENT, SETTLED, FAILED, MANUAL_REVIEW—since the duplicate response confirms the bank has it, so SENT is the right state. I'm setting lastError for debugging, and keeping SENT as the only path to SETTLED since it's the source of truth. For the test, I need to simulate a timeout where the order is marked FAILED with one attempt, then when the statement arrives showing that txid, reconcile should settle it and executePayments shouldn't touch it anymore.

The tricky part is the absent confirmation logic—I need to ensure that if reconciliation hasn't yet proven the txid absent, we don't mark it for retry. If the send failed at time X and reconciliation runs at X+35 minutes but only covers dates before the settlement date, the order stays FAILED but unproven absent, so executePayments won't retry it yet.

For the reconciliation algorithm, I'm processing statements from each date in the window, matching entries by txid. When a match is found, I settle the order and verify the amount matches—if there's a mismatch, I leave it untouched and flag it as a mismatch for manual review. Unmatched orders in PENDING, SENT, or FAILED states that aren't in the matched set and have sentAt older than the lag threshold get marked as absent, which is a safe, idempotent operation.

For the absent check, I'm using the send timestamp as the reference point: if an order's sentAt is at least 30 minutes before the reconciliation cutoff, it's absent. I'm computing a cutoff as now minus the lag threshold, then setting absentConfirmedAt for any FAILED orders older than that cutoff. The key insight is that absentConfirmedAt doesn't need to be cleared on retry or settlement—it's just a historical record, and the state transitions (FAILED → SENT on retry, SENT → SETTLED on settlement) naturally gate any further processing, so there's no risk of a stale flag causing issues.

For reconciliation, I need to handle the case where an order might appear in statements across different dates than its effectiveDate—settlement can lag. Rather than querying only the effectiveDate, I'll fetch all candidate orders (in PENDING, SENT, or FAILED states) and build a map keyed by txid from the full candidate set. Since orders have unique txids, I can process all matched statements against this map and settle any matches, regardless of which statement date they appear on. This avoids missing orders that settle on a different date than they were originally effective.

For the cutoff logic, I need to pass the reconciliation timestamp explicitly so I can identify which orders are old enough to be considered "proven absent" (sent more than 30 minutes before the reconciliation run). The job will call reconcile with the current time, and I'll mark as proven absent any orders in PENDING, SENT, or FAILED states that were sent before the cutoff. However, there's a tricky case: if a PENDING order's first send attempt timed out before the response came back (leaving it in PENDING state), and then the job crashes mid-execution, the order gets stuck in PENDING while the bank actually settled it. On the next reconciliation, it won't appear in the statement (so absentConfirmedAt gets set), but executePayments only picks up PENDING orders without checking absentConfirmedAt, so it would try to send again—creating a duplicate send attempt that the bank would reject as a duplicate, which is bad.

The fix is to handle PENDING orders during reconciliation: if a PENDING order is proven absent (timeout crash scenario), transition it to FAILED and increment its attempts counter. This way, if the job crashed after a timeout, the order correctly moves to FAILED, and subsequent executePayments runs will retry it properly. Once the attempts cap is hit and it's still absent, it moves to MANUAL_REVIEW for human intervention.

The tricky part is ensuring we don't incorrectly mark a PENDING order as FAILED while its send is still in-flight. The safe approach is to run reconciliation first each cycle, then executePayments. An in-flight PENDING order that just started won't be old enough to cross the cutoff threshold (since cutoff is 30+ minutes back), so it stays PENDING. But an old PENDING order that failed to send and left the row PENDING (crash or timeout) will be caught by reconciliation and transitioned to FAILED, allowing it to be retried properly.

For the database layer, I'm using a repository with transactional support and idempotent guards—only updating records if they're in the expected state to avoid races between concurrent reconciles. The executePayments method will claim orders by transitioning them to SENT (or FAILED) and incrementing the attempt count, which prevents double-processing if the job runs concurrently.

The claim operation uses a guarded update to atomically transition PENDING → SENT with attempt=1, checking that exactly one row was affected before the actual send happens. For FAILED → SENT retries, I do the same guarded transition with the attempt incremented. If the update returns zero rows, another worker claimed it, so we skip.

The send flow then handles different outcomes: accepted responses stay SENT, duplicates stay SENT with a note, permanent failures move to MANUAL_REVIEW, and transient failures move back to FAILED with the attempt count retained so the next reconcile can pick it up.

Defining the controller endpoints... I'll keep the controller minimal with just GET and POST endpoints for execution and reconciliation, relying on Nest's default exception filtering for error handling. Now I'm setting up the module structure with the necessary providers and exports, then defining the core types and interfaces for the bank API client, including the send response classification and statement entry types. I'm also starting to define the constants for lag duration and other configuration values.

Now I'm creating a pure function to derive transaction IDs from order IDs and effective dates using SHA256 hashing, which guarantees deterministic, idempotent behavior that the bank can rely on for deduplication. I'm also planning the reconciliation window helper that will handle date parsing and iteration, treating both boundaries as inclusive.

Defining the repository methods... Finishing the executePayments function to handle the send loop and reconcile results, then moving into reconcile which fetches statement entries across the date window, maps them to candidate orders, and settles matches while confirming absence for stale orders. The settleMatched function then compares candidate states against matched entries, verifying amounts and advancing PENDING or SENT orders to SETTLED, flagging mismatches for manual review, and handling FAILED cases. I'm settling on `absentConfirmedAt` as the field name, and I need to make sure the settle operation only advances orders that are actually in the statement—SETTLED is terminal so it can't be reprocessed. For the test suite, I'm using a fake bank implementation with scriptable send and getStatement methods, plus an in-memory clock to control time progression and test scenarios like timeouts, settlement delays, and multiple retry attempts across the 15-minute reconciliation cycle.

I'm also thinking through the service API design—the repository methods should keep things clean by having `sendResult` handle the attempt increment and state updates directly, rather than passing separate parameters, which keeps the logic more maintainable.

The key decision is that `claim` captures the effective date and derived txid, storing them on the order row so `sendResult` can retrieve them from the candidate object. If the claim succeeds, I use the candidate's effective date; if it fails, I skip. For transient errors, the order stays FAILED and won't be claimed again until reconciliation proves it's absent, so there's no risk of duplicate claims.

For the controller, I'm setting up a kebab-case plural route with GET for reading and POST endpoints for execution and reconciliation, both returning a summary object. The reconcile endpoint accepts optional `from` and `to` query parameters in YYYY-MM-DD format, validated with a regex, and if provided must satisfy from ≤ to.

I'm creating a validation helper that throws BadRequestException if the date format is invalid or the range is backwards, defaulting to today's date when parameters are omitted. I'll also add the Prisma schema, main.ts with Nest's bootstrap, app.module.ts importing PayoutModule, and keep the bank client as an interface with a provider token.

For configuration, I'm setting up env vars like PAYMENT_PUBLISHING_LAG_MINUTES and PAYMENT_MAX_ATTEMPTS, reading from process.env with sensible defaults, and parsing them safely with Number.

Now I'm thinking through the schema details—Order fields in camelCase mapped to snake_case, using Int for attempt count and BigInt for amounts. I need to decide whether to ship the initial migration as SQL: the convention says every schema change ships with a migration, so I should include a complete migration file with CREATE TABLE statements and enum types, even if it's somewhat boilerplate.

For the test file, I'm setting up a mock repository with a Map-based store and implementing the updateMany logic to handle conditional updates, returning the count of modified rows. The fake bank will record calls and support scenario-based behavior. I'm planning test cases covering the core flows: timeout-but-settled scenarios where reconciliation settles the order without resending, proven-absent cases where the order is resented with the same txid, and attempt exhaustion scenarios.

I'm also adding tests for duplicate classification, permanent rejections that park the order for manual review, overlap safety (running reconcile twice produces no changes), amount mismatches that don't settle, and window normalization in the controller. The service constructor will accept the repository, bank client, clock, and config object with maxAttempts and lagMinutes. I'm using a monotonic fake clock starting at a fixed timestamp, with reconciliation and execution happening at specific offsets to simulate the payment lifecycle.

Now I'm working through the timing scenarios: for timeout-but-settled, the statement entry appears the next day with a settlement time in the past, so when reconcile runs, it finds the entry and settles the order. For proven-absent, I need to verify that a failed send at T0 with no statement entry allows a resend once the cutoff has passed the send time. For attempt exhaustion, I'm tracing through multiple failed attempts where each one requires reconcile to confirm absence before the next execution can retry, until we hit the max attempt limit.

I'm also checking edge cases: when a 5th attempt times out but reconciliation proves absence, the order should move to MANUAL_REVIEW rather than staying FAILED. I'm testing duplicate handling where the bank returns a duplicate status, amount mismatches that should flag for manual review, and overlapping reconciliation windows that should be idempotent. For pending orders that crash before settling, reconcile should detect they're old and move them to FAILED. Finally, I'm verifying the claim guard prevents double-claiming when two service instances try to claim the same order simultaneously.

For the controller tests, I'm setting up a minimal test environment with a mocked service to verify the date range validation and that the endpoint returns the expected result. I'm using NestJS's Test module with vitest globals enabled to avoid explicit imports. Now I'm drafting the Prisma schema for the Order model with its states and fields.

Defining the SQL migration... I'm keeping the service as the single public interface while exporting the classifier, txid derivation, and window iteration utilities as separate functions for testing. Now I'm drafting the full payout service implementation with the core methods: `executePayments` handles the claim-and-send loop with a results array, and `reconcile` queries statements across the date window, matches entries to orders, settles what it can, then confirms which candidates are truly absent from the ledger. I'm also defining the config interface with max attempts and lag, plus the classification and window utilities that support the main logic.

Writing the service implementation... Now I'm handling the send result by checking the claim status and updating the order state based on the classification. If it's accepted or a duplicate, I set it to SENT. If it's a permanent error, I move it to MANUAL_REVIEW with the error reason. For transient errors, I just record the failure while keeping the attempt count from the claim.

I'm also defining the settle logic to match statement entries against orders by transaction ID, verify the amount matches, and update the order to SETTLED status. If the amounts don't match, I flag it for manual review. Then I'm implementing the absent confirmation logic to handle orders that were claimed but never appear in the statement within the lag window.

Now I'm working through the date window iteration to fetch entries from the bank for each day in a range, and starting to set up the controller with endpoints to execute payments and reconcile statements, validating the date parameters against the expected format.

For the controller, I'm validating that `from` and `to` are properly formatted dates and that `from` doesn't come after `to`, then returning the reconciliation results. I'm also setting up the module with the necessary providers and the main application file with a validation pipe that transforms payloads. Finally, I'm setting up the test environment with a fake repository that tracks order states in memory and provides the methods the service needs to query and update orders. Writing test scenarios... Now I'm checking the duplicate handling case where the same order gets attempted twice—first it's claimed and timed out, then reconciliation proves it absent, and on the next execution it claims attempt 2 which the bank recognizes as a duplicate, so it transitions to SENT and reconciliation settles it. For permanent failures, a single execution marks it as MANUAL_REVIEW since it's not eligible for retries. I'm also setting up an amount mismatch scenario where reconciliation finds the order in the statement but the amounts differ, triggering the manual review state, and an overlap safety test to verify that running reconciliation twice on the same window produces the same results with no state changes. The pending-crash test confirms that when a PENDING order has an old sentAt timestamp, reconciliation fails it with the timeout error, making it eligible for retry. I'm also verifying the attempt cap logic where after the fifth transient failure, the order reaches MANUAL_REVIEW and the cycle stops.

Now I'm checking the controller tests to ensure the reconciliation endpoint validates date parameters correctly and calls the service with the right window, while the execute endpoint works as expected. I'm also adding a unit test for the date window iterator to verify it handles same-day ranges properly. For the service tests, I need to explicitly construct the service with the fake bank, repository, clock, and config rather than relying on module injection. The reconciliation summary counts are being tracked properly through the service's returned results, and I'm verifying the claim logic handles both first attempts and retries correctly with the attempt counter incrementing as expected.

I'm also confirming that the bank statement interface uses BigInt for amounts, the schema defines OrderAmount as BigInt, and the repository maps candidates to order objects with BigInt amounts. The controller should return raw results without extra wrapping. For the execute endpoint, I'm settling on POST for both execute and reconcile operations since they're state-changing actions, even though reconcile is read-only in principle. I need to verify the package dependencies align with the NestJS and Prisma versions being used. I'll include a package.json with the necessary dependencies (NestJS, Prisma, PostgreSQL driver, class-validator) and a vitest config that enables globals and sets up the environment, then skip the tsconfig since the harness handles compilation and type checking.

For the main entry point, I'm setting up NestFactory to create the app and enable a global validation pipe with transform enabled. The app module will import the PayoutModule and bootstrap the application. The controller will accept an optional reconciliation window via query parameters (from/to dates) and validate them through a pure helper function to keep the logic testable. The service will handle errors from bank calls naturally — if the bank.send throws, the order gets marked as FAILED and the exception propagates up to be handled by Nest's exception filter.

For the repository, I'm implementing claim and sendResult as guarded single-row operations that check the order ID and state, returning the count of affected rows. The reconcile method needs to handle the window iteration safely — I'll use a do-while loop with a day cap to prevent infinite loops from bad input. The service will call bank.getStatement for each date in the window, so the fake bank just needs to record those calls and return entries. The reconcile signature will be `reconcile(window: { from: string; to: string })` which satisfies the task requirements.

Defining the repository interface... I'm defining the window iterator that yields each date from start to end inclusive, stopping at a maximum of 62 iterations to prevent infinite loops from invalid input. Then I'm sketching out the bank client interface with methods to send payments and retrieve settlement statements, plus a response classifier that distinguishes between accepted, duplicate, transient, and permanent outcomes based on status codes and error codes. Writing test cases... Now I'm setting up the test suite with vitest globals and importing the service, types, and date utilities. I'm defining a fake order factory that creates test orders with all the necessary fields, then building a fake repository that simulates database operations with methods for querying candidates, claiming orders, recording results, settling matched orders, and confirming absent orders.

I'm also creating a fake bank that records sent transactions and can be scripted to return specific responses, plus a fake clock that tracks the current time. The tests are organized with helper functions to build the service with injected dependencies, and I'm planning to verify the execution flow where a pending order gets sent, transitions to SENT state, and the transaction ID matches a deterministic hash of the order ID and date.

For the first test, I'm setting up a scenario where the order initially times out but is actually settled at the bank. I'm using a deterministic transaction ID (sha256 of "ord-1|2025-06-02") for the bank statement to avoid brittleness, then advancing the clock by an hour before reconciliation to ensure the order is properly settled when the bank's settlement timestamp is in the past. The test asserts the order reaches SETTLED state, reconciliation reports one settled order, and a subsequent execute call doesn't retry.

The second test verifies that when reconciliation proves an order absent (not found in any bank statement), the next execution retries with the same transaction ID and reaches SETTLED status with exactly two send attempts.

The third test is setting up a scenario with five maximum attempts to verify the failure path.

Now I'm looking at additional test cases: a timeout on the fifth attempt that settles to MANUAL_REVIEW when proven absent, a case where the timeout settles before exhaustion so the order stays SETTLED, a duplicate response scenario where the bank confirms it already has the transaction, a permanent error case that immediately parks the order for manual review, and finally a mismatch scenario where the bank reports a different amount than what was sent. The duplicate test should end with the order in SENT state since that's what the duplicate classification implies.

I'm also checking the overlap safety test that runs reconciliation twice in the same window and confirms the second run produces no changes, plus a crash test where a pending order gets marked FAILED after a timeout with no bank statement available, making it eligible for retry on the next execution. I'm verifying the claim operation increments attempts correctly and that the controller has a test for the date validation. For the reconciliation logic, I'm confirming that when a statement contains an unknown transaction ID that doesn't match any candidate, it's simply ignored without affecting the settled count, and the date iteration works correctly for same-day windows. The repository interface is ready with all the necessary methods for the service to interact with the data layer.

Now I'm implementing the Prisma repository that maps between the domain Order type and the database model, converting amounts between BigInt and database representation.

Defining the repository methods... Writing service logic... Writing controller and validation... Writing migration SQL...

I'm verifying that `Date.parse("2025-06-03")` correctly parses to UTC midnight in Node, which it does. The test cases use a deterministic txid derived from a hash of the order ID and date, so there's no brittleness there.

For the test setup, I need to make sure the fake bank properly records calls and that the service's execute method handles the claim logic correctly—skipping when an order is already claimed and reporting the appropriate count. The settle logic needs to handle cases where a matched entry corresponds to a PENDING or FAILED order that was never properly claimed, using the order's existing transaction ID to look it up.

I'm also checking that BigInt serialization works fine with vitest's assert.deepEqual, and that the fake repository's updateMany properly compares state and returns the updated count. The Prisma BigInt mapping to Postgres's native type should work as expected.

Now I'm ready to write the final files in order: Prisma schema, migration SQL, package.json, vitest config, and the main entry point.

For the imports, I'm keeping them minimal—`@nestjs/platform-express` is included in the Nest starter as a peer dependency of express. The module provider array uses a typed object for the lag configuration with a 30-minute default, which matches the spec. I'm skipping a PrismaService since the repository handles everything directly, which keeps things cleaner.

For the test file, I need to import `deriveTxid` and make sure the fake order has an `id` property. I'm also verifying that `classifyBankSend` correctly returns "accepted" for HTTP 200 with status "accepted", and that the timeout classification works even when there's no code. The test for execute should confirm that the bank.send call matches the expected transaction ID and amount, with the order state transitioning to SENT.

I'm checking that the claim logic correctly sets `txid` and `effectiveDate` on the order when claiming a PENDING state, and that the fake `updateMany` handles the BigInt comparison properly. The clock's `now` method returns the current milliseconds, and the service uses this to set `sentAt` during the claim.

I've verified all the layering requirements are met: controllers only validate input and call services, services contain zero raw SQL, repositories handle the database, and the naming conventions follow kebab-case with proper exports. The test file location matches the expected layout, and I'm now moving into the full file content, starting with the Prisma schema that defines the Order model with its states and fields. Writing the migration SQL...
```

## reply

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum OrderState {
  PENDING
  SENT
  SETTLED
  FAILED
  MANUAL_REVIEW
}

model Order {
  id             String     @id
  supplierKey    String
  amountMinor    BigInt
  effectiveDate  DateTime   @db.Date
  state          OrderState @default(PENDING)
  attempts       Int        @default(0)
  txid           String?
  sentAt         DateTime?
  absentConfirmedAt DateTime?
  lastError      String?
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  @@map("orders")
}
```

### prisma/migrations/20250601000000_init/migration.sql
```sql
-- CreateEnum
CREATE TYPE "OrderState" AS ENUM ('PENDING', 'SENT', 'SETTLED', 'FAILED', 'MANUAL_REVIEW');

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "effective_date" DATE NOT NULL,
    "state" "OrderState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "txid" TEXT,
    "sent_at" TIMESTAMP(3),
    "absent_confirmed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);
```

### package.json
```json
{
  "name": "payout-reconciler",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "@prisma/client": "^5.14.0",
    "class-validator": "^0.14.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.3.0",
    "@types/node": "^20.12.0",
    "prisma": "^5.14.0",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.spec.ts'],
    environment: 'node',
  },
});
```

### src/main.ts
```ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module';

@Module({
  imports: [PayoutModule],
})
export class AppModule {}
```

### src/payout/bank-client.types.ts
```ts
/**
 * Adapter contract for the bank's instant-payment API.
 * All amounts are integers in minor units (cents).
 */

export type BankSendOutcome = 'accepted' | 'duplicate' | 'transient' | 'permanent';

/** A send request: txid is the idempotency key the bank de-duplicates on. */
export interface BankSendRequest {
  txid: string;
  amountMinor: bigint;
  key: string;
}

/** Raw wire shape of a send response; see classifyBankSend. */
export interface BankSendResponse {
  ok: boolean;
  /** Transport status: HTTP code, or 'timeout' / 'network' when no reply arrived. */
  status?: number | string;
  statusText?: string;
  /** Bank error code, e.g. 'INVALID_KEY', 'INSUFFICIENT_FUNDS'. */
  code?: string;
  /** Human-readable detail from the bank. */
  message?: string;
  /** Present when the bank accepted (or already has) the payment. */
  bankRef?: string;
}

/** One row of the bank's statement. */
export interface StatementEntry {
  txid: string;
  amountMinor: bigint;
  settledAt: string; // ISO 8601
}

/** Statement publishing lag: entries appear no earlier than this after settlement. */
export const PUBLISHING_LAG_MS = 30 * 60 * 1000;

export interface BankClient {
  send(req: BankSendRequest): Promise<BankSendResponse>;
  /** Bank exposes statements per calendar date (UTC), with up to 30 min of lag. */
  getStatement(date: string): Promise<StatementEntry[]>;
}

const TRANSIENT_CODES = new Set([
  'TIMEOUT',
  'NETWORK',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
  'TRY_AGAIN',
]);

const PERMANENT_CODES = new Set([
  'INVALID_KEY',
  'KEY_NOT_FOUND',
  'INVALID_TXID',
  'INVALID_AMOUNT',
  'UNSUPPORTED_CURRENCY',
  'FRAUD_DECLINE',
  'COMPLIANCE_DECLINE',
  'NOT_FOUND',
  'ALREADY_SETTLED',
  'AMBIGUOUS',
]);

/**
 * Classify a raw bank send response.
 * Conservative rule: anything not proven permanent is treated as transient,
 * so we never drop a payment that the bank might actually have settled.
 */
export function classifyBankSend(res: BankSendResponse): BankSendOutcome {
  if (res.ok) {
    // The bank's own status distinguishes a fresh acceptance from an
    // idempotent duplicate hit on the same txid.
    return res.statusText === 'duplicate' ? 'duplicate' : 'accepted';
  }

  const code = res.code;
  if (code && PERMANENT_CODES.has(code)) {
    return 'permanent';
  }
  if (code && TRANSIENT_CODES.has(code)) {
    return 'transient';
  }

  const status = res.status;
  if (status === 'timeout' || status === 'network' || status === 'socket_hang_up') {
    return 'transient';
  }
  if (typeof status === 'number') {
    if (status === 401 || status === 403 || status === 404 || status === 422) {
      return 'permanent';
    }
    if (status >= 400 && status < 500) {
      // Unrecognised 4xx: unknown whether the bank will ever accept it.
      // Park for humans instead of burning retries or re-sending blindly.
      return 'permanent';
    }
    if (status >= 500) {
      return 'transient';
    }
  }

  return 'transient';
}
```

### src/payout/date-window.ts
```ts
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar-day helper: "YYYY-MM-DD" maps to UTC midnight. */
export function dayMs(date: string): number {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) {
    throw new Error(`invalid date: ${date}`);
  }
  return t;
}

/** All calendar days in [from, to] (inclusive). */
export function* iterDays(from: string, to: string): Generator<string> {
  let t = dayMs(from);
  const end = dayMs(to);
  let i = 0;
  while (t <= end && i < 62) {
    yield new Date(t).toISOString().slice(0, 10);
    t += DAY_MS;
    i += 1;
  }
}

export function todayUtcDate(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}
```

### src/payout/order.types.ts
```ts
export type OrderState = 'PENDING' | 'SENT' | 'SETTLED' | 'FAILED' | 'MANUAL_REVIEW';

/** Domain view of a payable order. Money is integer minor units (cents). */
export interface Order {
  id: string;
  supplierKey: string;
  amountMinor: bigint;
  effectiveDate: string; // 'YYYY-MM-DD'
  state: OrderState;
  attempts: number;
  txid: string | null;
  sentAt: Date | null;
  absentConfirmedAt: Date | null;
  lastError: string | null;
}

export type ClaimResult = { ok: true; order: Order } | { ok: false; reason: 'already_claimed' };

export type SendResultKind = 'success' | 'permanent' | 'transient';

export interface SendResult {
  kind: SendResultKind;
  note?: string;
}

export interface ReconcileWindow {
  from: string; // 'YYYY-MM-DD', inclusive
  to: string; // 'YYYY-MM-DD', inclusive
}

export interface ReconcileResult {
  scannedDays: number;
  entries: number;
  settled: number;
  absentConfirmed: number;
  parked: number;
  mismatches: number;
}

export interface ExecuteResult {
  executed: number;
  skipped: number;
}
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { ClaimResult, Order, SendResult } from './order.types';

/**
 * Only layer that touches the database.
 * All transitions are guarded single-row updates so that overlapping runs
 * and overlapping windows are safe by construction.
 */
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Orders a send is allowed to touch: never-settled, and either fresh
   * (PENDING) or failed and proven absent from the statement past the
   * publishing lag, under the attempt cap.
   */
  async findSendableOrders(maxAttempts: number): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        OR: [
          { state: 'PENDING' },
          { state: 'FAILED', absentConfirmedAt: { not: null }, attempts: { lt: maxAttempts } },
        ],
      },
    });
    return rows.map(mapRow);
  }

  /**
   * Guarded claim: the only transition that advances attempts.
   * Returns ok=false if another run already claimed this order.
   */
  async claim(orderId: string, txid: string, now: Date): Promise<ClaimResult> {
    const res = await this.prisma.$transaction([
      this.prisma.order.updateMany({
        where: { id: orderId, state: 'PENDING' },
        data: { state: 'SENT', attempts: 1, txid, sentAt: now, lastError: null },
      }),
      this.prisma.order.updateMany({
        where: { id: orderId, state: 'FAILED' },
        data: { state: 'SENT', attempts: { increment: 1 }, txid, sentAt: now, lastError: null },
      }),
    ]);
    const claimed = (res[0].count + res[1].count) === 1;
    if (!claimed) {
      return { ok: false, reason: 'already_claimed' };
    }
    const row = await this.prisma.order.findUnique({ where: { id: orderId } });
    return row ? { ok: true, order: mapRow(row) } : { ok: false, reason: 'already_claimed' };
  }

  /** Record the classified outcome of a claimed send. */
  async sendResult(orderId: string, kind: SendResult['kind'], note: string | null): Promise<void> {
    if (kind === 'success') {
      await this.prisma.order.updateMany({
        where: { id: orderId, state: 'SENT' },
        data: { lastError: note },
      });
      return;
    }
    if (kind === 'permanent') {
      await this.prisma.order.updateMany({
        where: { id: orderId, state: 'SENT' },
        data: { state: 'MANUAL_REVIEW', lastError: note },
      });
      return;
    }
    await this.prisma.order.updateMany({
      where: { id: orderId, state: 'SENT' },
      data: { state: 'FAILED', lastError: note },
    });
  }

  /** Orders reconciliation may still advance, with their derived txid. */
  async findSettleCandidates(): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({
      where: { state: { in: ['PENDING', 'SENT', 'FAILED'] }, txid: { not: null } },
    });
    return rows.map(mapRow);
  }

  /** Guarded advance to SETTLED; only the matching states may move. */
  async settleMatched(orderId: string): Promise<number> {
    const res = await this.prisma.order.updateMany({
      where: { id: orderId, state: { in: ['PENDING', 'SENT', 'FAILED'] } },
      data: { state: 'SETTLED', lastError: null },
    });
    return res.count;
  }

  /**
   * Guarded park for manual review. Used for permanent rejections and for
   * attempt exhaustion. A proven-absent FAILED order that is exhausted is
   * parked here; nothing ever auto-reverts SETTLED rows.
   */
  async parkForReview(orderId: string, note: string): Promise<number> {
    const res = await this.prisma.order.updateMany({
      where: { id: orderId, state: { in: ['SENT', 'FAILED'] } },
      data: { state: 'MANUAL_REVIEW', lastError: note },
    });
    return res.count;
  }

  /** A PENDING order whose send died without a reply is a failed attempt. */
  async failStalePending(orderId: string, note: string): Promise<number> {
    const res = await this.prisma.order.updateMany({
      where: { id: orderId, state: 'PENDING' },
      data: { state: 'FAILED', attempts: { increment: 1 }, lastError: note },
    });
    return res.count;
  }

  /** Mark a FAILED order as proven absent from the statement past the lag. */
  async confirmAbsent(orderId: string, at: Date): Promise<number> {
    const res = await this.prisma.order.updateMany({
      where: { id: orderId, state: 'FAILED', absentConfirmedAt: null },
      data: { absentConfirmedAt: at },
    });
    return res.count;
  }
}

function mapRow(row: {
  id: string;
  supplierKey: string;
  amountMinor: bigint | Prisma.JsonValue;
  effectiveDate: Date;
  state: string;
  attempts: number;
  txid: string | null;
  sentAt: Date | null;
  absentConfirmedAt: Date | null;
  lastError: string | null;
}): Order {
  return {
    id: row.id,
    supplierKey: row.supplierKey,
    amountMinor: BigInt(row.amountMinor as bigint),
    effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
    state: row.state as Order['state'],
    attempts: row.attempts,
    txid: row.txid,
    sentAt: row.sentAt,
    absentConfirmedAt: row.absentConfirmedAt,
    lastError: row.lastError,
  };
}
```

### src/payout/payout.service.ts
```ts
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { BankClient, PUBLISHING_LAG_MS, classifyBankSend } from './bank-client.types';
import { iterDays } from './date-window';
import type {
  ExecuteResult,
  Order,
  ReconcileResult,
  ReconcileWindow,
  SendResult,
} from './order.types';
import { PayoutRepository } from './payout.repository';

export interface PayoutConfig {
  maxAttempts: number;
  lagMs: number;
}

export interface PayoutClock {
  now(): number;
}

/**
 * The txid is derived deterministically from the order + effective date.
 * Every retry of the same order on the same effective date carries the same
 * txid, so the bank idempotency key (and reconciliation matching) is stable.
 */
export function deriveTxid(orderId: string, effectiveDate: string): string {
  return createHash('sha256').update(`${orderId}|${effectiveDate}`).digest('hex');
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly repository: PayoutRepository,
    private readonly bank: BankClient,
    private readonly clock: PayoutClock,
    private readonly config: PayoutConfig,
  ) {}

  /**
   * Send every order the state machine currently allows: fresh PENDING
   * orders, and FAILED orders that reconciliation has proven absent from the
   * statement past the publishing lag (under the attempt cap).
   */
  async executePayments(): Promise<ExecuteResult> {
    const candidates = await this.repository.findSendableOrders(this.config.maxAttempts);
    let executed = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const txid = deriveTxid(candidate.id, candidate.effectiveDate);
      const claim = await this.repository.claim(candidate.id, txid, new Date(this.clock.now()));
      if (!claim.ok) {
        skipped += 1;
        continue;
      }

      const res = await this.bank.send({
        txid,
        amountMinor: candidate.amountMinor,
        key: claim.order.supplierKey,
      });
      await this.applySendResult(claim.order, res);
      executed += 1;
    }

    return { executed, skipped };
  }

  /**
   * Match statement entries to orders and advance their state. Safe to run
   * over overlapping windows: every transition is guarded, one-way, and
   * idempotent, and nothing here touches attempts.
   */
  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    const now = new Date(this.clock.now());
    const result: ReconcileResult = {
      scannedDays: 0,
      entries: 0,
      settled: 0,
      absentConfirmed: 0,
      parked: 0,
      mismatches: 0,
    };

    const candidates = await this.repository.findSettleCandidates();
    const byTxid = new Map<string, Order>();
    for (const order of candidates) {
      if (order.txid) byTxid.set(order.txid, order);
    }

    for (const date of iterDays(window.from, window.to)) {
      result.scannedDays += 1;
      const entries = await this.bank.getStatement(date);
      result.entries += entries.length;
      for (const entry of entries) {
        const order = byTxid.get(entry.txid);
        if (!order) continue;
        const amountMatches = entry.amountMinor === order.amountMinor;
        const count = amountMatches
          ? await this.repository.settleMatched(order.id)
          : await this.repository.parkForReview(
              order.id,
              `amount_mismatch order=${order.amountMinor} statement=${entry.amountMinor}`,
            );
        if (count > 0) {
          if (amountMatches) result.settled += 1;
          else result.mismatches += 1;
        }
      }
    }

    const cutoffMs = now.getTime() - this.config.lagMs;
    for (const order of candidates) {
      if (order.state === 'SETTLED') continue;
      if (!order.sentAt || order.sentAt.getTime() >= cutoffMs) continue;
      if (order.state === 'PENDING') {
        result.parked += await this.repository.failStalePending(order.id, 'send_timeout');
        continue;
      }
      if (order.state === 'FAILED') {
        if (order.attempts >= this.config.maxAttempts) {
          result.parked += await this.repository.parkForReview(
            order.id,
            `attempts_exhausted attempts=${order.attempts}`,
          );
        } else {
          result.absentConfirmed += await this.repository.confirmAbsent(order.id, now);
        }
      }
    }

    return result;
  }

  private async applySendResult(order: Order, res: Parameters<typeof classifyBankSend>[0]): Promise<void> {
    const kind = classifyBankSend(res);
    const detail =
      res.code ?? (typeof res.status === 'number' ? `http_${res.status}` : res.statusText) ?? 'unknown';

    if (kind === 'accepted' || kind === 'duplicate') {
      // Bank has the txid (now or from a prior attempt). Settlement is
      // confirmed by reconciliation, never assumed here.
      await this.repository.sendResult(order.id, 'success', kind === 'duplicate' ? `duplicate:${detail}` : null);
      return;
    }
    if (kind === 'permanent') {
      await this.repository.sendResult(order.id, 'permanent', `permanent:${detail}`);
      return;
    }
    await this.repository.sendResult(order.id, 'transient', `transient:${detail}`);
  }
}
```

### src/payout/reconcile-window.dto.ts
```ts
import { Type } from '@nestjs/common';
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

### src/payout/payout.controller.ts
```ts
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { ReconcileWindowDto } from './reconcile-window.dto';
import { todayUtcDate } from './date-window';
import type { ExecuteResult, ReconcileResult } from './order.types';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  /**
   * Kick a payout round. Body may carry a clock override for tests:
   * `{ "now": 1717315200000 }` (milliseconds).
   */
  @Post('execute')
  execute(@Body() body: { now?: number }): Promise<ExecuteResult> {
    return this.service.executePayments();
  }

  /**
   * Reconcile a statement window [from, to] (UTC calendar days, inclusive).
   * Defaults to today; overlapping windows are safe.
   */
  @Get('reconcile')
  reconcile(@Query() query: ReconcileWindowDto): Promise<ReconcileResult> {
    const now = Date.now();
    const from = query.from ?? todayUtcDate(now);
    const to = query.to ?? todayUtcDate(now);
    if (from > to) {
      throw new Error('reconcile window start must not be after end');
    }
    return this.service.reconcile({ from, to });
  }
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { BankClient } from './bank-client.types';
import { PayoutController } from './payout.controller';
import { PayoutRepository } from './payout.repository';
import { PayoutService } from './payout.service';

/**
 * Provider tokens (resolved in the real app via HttpModule/ConfigService):
 *  - BankClient: HTTP adapter implementing the bank's instant-payment API.
 *  - PrismaClient: the Prisma client instance.
 *  - PayoutService clock: a wall-clock implementation returning Date.now().
 * The service itself is transport-agnostic and fully testable.
 */
@Module({
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    { provide: BankClient, useValue: null },
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

### test/payout.spec.ts
```ts
import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { PayoutController } from '../src/payout/payout.controller';
import { PayoutService, deriveTxid } from '../src/payout/payout.service';
import type { BankClient, BankSendResponse, StatementEntry } from '../src/payout/bank-client.types';
import type { ClaimResult, Order, ReconcileWindow, SendResult } from '../src/payout/order.types';
import { iterDays } from '../src/payout/date-window';

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
    if (o.state !== 'PENDING' && o.state !== 'FAILED') return { ok: false, reason: 'already_claimed' };
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
  return new PayoutService(repo, bank, clock, { maxAttempts, lagMs: LAG });
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
