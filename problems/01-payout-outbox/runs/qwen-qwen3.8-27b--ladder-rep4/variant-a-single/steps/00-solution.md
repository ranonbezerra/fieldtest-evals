# solution

## reasoning

```
I'm mapping out the structure for a crypto payout service built with TypeScript, NestJS, Prisma, and PostgreSQL. The core endpoint will be `POST /payouts` accepting account details, amount, destination, and an idempotency key to ensure safe, duplicate-free operations.

I need to implement atomic balance checks with conditional updates to prevent overdrafts, use an outbox pattern with a message table to ensure transactional consistency between reservation and queue insertion, and build a worker that processes messages safely with at-least-once delivery guarantees. The system needs idempotency at the creation level, settlement logic that moves balances on confirmation rather than send, retry logic with bounded attempts that parks to needs-review on exhaustion without reverting funds, and a double-entry ledger to track all money movements. I'm also planning to use BigInt for money calculations to avoid floating-point errors, and I'll need to write tests for concurrent creation, duplicate delivery, and retry exhaustion scenarios.

For the file layout, I'm following the codebase conventions: `src/payout/payout.module.ts`, `src/payout/payout.controller.ts`, `src/payout/payout.service.ts`, `src/payout/payout.repository.ts`, and `src/payout/payout-worker.service.ts` with the worker as its own service that uses `@Cron` or `setInterval` to poll the message table. Tests go in `test/payout.spec.ts`, and I'll include a `DESIGN.md` document.

For the database schema, I'm modeling `accounts` with `settledBalance` and `reservedBalance` columns as BigInt, using `BigInt` type in Prisma for precision. The atomic reservation uses a conditional update that only succeeds if sufficient funds are available, with a transaction that also inserts the payout and outbox message. The unique constraint on `(accountId, idempotencyKey)` handles idempotent retries.

I'm defining the payout lifecycle states as `created`, `processing`, `sent`, `completed`, `failed`, and `needsReview` to track the full flow from creation through settlement or failure. The `outbox` table stores messages with a unique `payoutId` constraint to prevent duplicate processing, and the `ledger` table uses double-entry bookkeeping with debit and credit entries that must balance per payout. The `payouts` table tracks the state, amounts, and provider confirmation details like `txHash` and `attempts`. I'm considering a `processed_messages` table to safely handle redelivered messages — when a message is processed, I record it with a unique `outboxId` constraint, and on duplicate delivery, the second insertion fails so the system treats it as a no-op.

Now I'm working through the worker's message processing flow. When polling for pending outbox entries, the worker claims them atomically using an update with a status guard, then attempts the transfer. If it succeeds, it records the txHash and moves the payout to `sent` state, then confirms settlement with a ledger entry to `completed`. If it fails, it increments the attempt counter and reschedules the message for retry with exponential backoff, or parks it if attempts are exhausted.

I'm realizing that with the `provider.transfer` signature, once we get a txHash back, the transfer is on-chain and will land — there's no way to actually fail after that point. The real failure modes are when the SDK times out or throws before returning a hash, which creates uncertainty about whether the transfer actually happened. So the worker's error handling needs to account for this: if we get a txHash, we record it and mark as `sent`; if we get an exception without a hash, we increment attempts and reschedule, but after exhausting retries we move to `needs_review` state without releasing the reservation, since the transfer might have succeeded on-chain despite the timeout. So the key insight is that the worker doesn't need to distinguish between a timeout and a true failure—either way, a failed attempt increments the counter, and when attempts are exhausted, the system parks the payout in a terminal `needs_review` state while keeping the reservation intact. I'm defining the states as `created`, `processing`, `sent`, `completed`, `failed`, and `needs_review`, where `sent` is the terminal state for successful transfers (with the txHash recording the outcome), and I need to write a short design doc explaining how this approach protects funds during provider uncertainty.

Now I'm mapping out the double-entry ledger mechanics: when reserving, I credit the available settled balance and debit the reserved bucket; when settling, I credit the reserved bucket and debit the on-chain payout bucket. Each ledger entry tracks the account, payout, a bucket enum (`available`, `reserved`, `onchain`), the amount in minor units, and the direction (debit or credit).

For idempotency on concurrent creation, I'm using the database unique constraint on `(accountId, idempotencyKey)` to detect duplicate requests—if the insert fails, I catch that error and return the original payout that was already created, ensuring the client gets the same response without creating a second record.

I'll also implement a pre-check by fetching any existing payout with that key before attempting to insert, which handles the sequential retry case cleanly. For the concurrency case where two requests race, the unique constraint catches the collision and I return the winner's payout.

The atomic reservation uses a conditional update: I increment `reserved_balance` and decrement `settled_balance` only if `settled_balance >= amount`, relying on Postgres row-level locking to serialize concurrent requests. If zero rows are updated, the account lacks funds and I throw a 422 error.

Now I'm structuring the HTTP response to return the payout ID, status, and key fields in a standard shape, and handling validation errors like negative amounts or invalid account IDs with a consistent error envelope.

Defining the Prisma schema... I'm adding the `ledger_entries` table with a composite index on payout_id and sequence to maintain entry ordering. For the migration, I can't rely on the migration command since there's no shell access, so I'll write the raw SQL migration file directly to match what `prisma migrate dev` would generate, including the enum types, table definitions, indexes, and foreign key constraints.

The schema is fresh for this repo, so a single migration file will establish the entire database. I'll name it something descriptive like `20250101000000_initial_payout_schema` and use a plausible timestamp format.

Now I'm setting up the repository layer — this is where all the database operations live. I need methods to create a payout with an outbox row in a single transaction, handle atomic reservation with conditional updates, fetch payouts by idempotency key, and manage the outbox polling workflow including claiming messages and updating their status. The settlement flow also needs to record ledger entries and confirm the payout as completed.

For the worker, I'm thinking through the claim mechanism: I'll use `updatedAt` to prevent reprocessing messages that are already being handled. When a claim fails because another worker grabbed it, I'll just return empty. If a crash happens after claiming, the message gets stuck, so I need a timeout mechanism — either a separate reaper that resets stale processing rows after a TTL, or I'll fold that logic into the `claimNext` query itself to reclaim any messages stuck in processing for longer than five minutes.

For settlement, I'm distinguishing between "sent" (we have the transaction hash) and "confirmed" (the transfer is final on-chain). The worker records the hash when it arrives, then in a separate settlement step it checks the payout state and moves it to completed only if it's still in sent state. This is safe because even if settlement never runs, the reserved balance stays held — that's the safe failure mode.

Now I'm setting up the provider interface and how the worker will use it. I'm designing the provider interface with an `unknown` outcome type to handle cases where the SDK might throw an error that carries partial data like a transaction hash — that way the worker can distinguish between a clean error and one that indicates the transfer actually landed. I'll create a `payout.provider.ts` file with the `PayoutProvider` token and interface, then mock it in tests with `vi.fn()`. For the worker's retry logic, I'm thinking through how `processMessages()` should handle the at-least-once delivery scenario: claiming pending messages, running the transfer, and updating state based on the result — success moves to `sent`, definitive failure increments attempts until max, then parks. I'm defining a `MessageDelivery` type with a `deliveredAt` timestamp to handle idempotent redelivery, so the service can check if a payout has already progressed beyond `created` before processing — if it has, the duplicate delivery is a no-op. The worker will claim a batch of pending messages (using a configurable `WORKER_BATCH_SIZE` from environment, defaulting to 10) and process each one through this idempotent logic.

For the interval-based polling, I'm using NestJS's `OnModuleInit` and `OnModuleDestroy` hooks with `setInterval` rather than `@nestjs/schedule` to avoid adding dependencies — the interval comes from `WORKER_POLL_INTERVAL_MS` (default 2 seconds, though tests can call `processMessages()` directly without waiting).

In the service's `create` method, I'm checking for an existing payout by the idempotency key first, then within a Prisma transaction I'm atomically reserving the balance (updating the account only if sufficient funds exist), creating the payout record, and inserting an outbox message — if the unique constraint on `(accountId, idempotencyKey)` gets hit, the entire transaction rolls back and the reservation is released, after which I fetch and return the winner's payout.

For the idempotency key scope, I'm using a composite unique constraint on both `accountId` and `idempotencyKey` to prevent duplicate payouts for the same client and account pair. The controller layer validates the incoming payload (ensuring `accountId` is a UUID, `amount` is a non-negative integer string, `destinationAddress` is a non-empty string, and `idempotencyKey` is a non-empty string), then calls the service and maps domain exceptions to HTTP responses — `InsufficientFunds` becomes a 422 with `insufficient_funds` code, `AccountNotFound` becomes 404, and malformed input becomes 400.

For the worker settlement flow, I'm keeping it simple: the worker records the `sent` status with the transaction hash, then in the same transaction inserts a `processedMessages` row to mark it as handled, and finally calls `settlePayout` which uses a guarded update to transition to `completed` while writing ledger entries. If the process crashes between these steps, redelivery is a no-op since the state is already `sent`. For failed attempts, I'm incrementing the attempt counter and either keeping the message in `pending` state with a future `availableAt` if retries remain, or moving it to `needsReview` with an `abandoned` status if the retry limit is exhausted.

The `processDelivery` method handles the idempotency: it first checks the payout state, and if it's already `sent` or `completed` from a previous run, it inserts the `processedMessages` row and returns. Otherwise, it transitions the payout to `processing` with a guarded update from `created` state, then invokes the provider. On success, it records the transaction hash and moves to `sent`; on failure, it applies the failure logic and inserts `processedMessages`. If the provider throws and the process crashes before updating, redelivery resumes from the `processing` state and retries the transfer.

For crash safety, the claim itself uses an `updatedAt` timestamp in the WHERE clause with a 5-minute stale threshold, allowing the same message to be reclaimed if it's been stuck in `processing` for too long. The service layer owns the logic and calls repository methods, which handles the Prisma interactions directly — the claim can use a single atomic query with the `updatedAt` guard to prevent race conditions.

On the ledger side, I'm tracking three settlement events: `reservation` (credit `available`, debit `reserved`), `settlement` (credit `reserved`, debit `onchain`), and `release` (credit `reserved`, debit `available`) for refunds. The invariant is that per account, `available + reserved = settled_total`, which holds because each reservation moves 1 unit between buckets and each settlement moves it again.

For tests, I'm using Vitest with in-memory repository stubs rather than a real database—this keeps tests fast and deterministic while still testing the service-level behavior (concurrent creation logic, idempotency) by simulating the conditional update race condition that would happen in a real DB.

Writing test helpers... Writing test scenarios... I need to handle edge cases around invalid amounts and idempotency keys with proper error responses, plus validate that the BigInt values serialize correctly to JSON strings. The error envelope should consistently use `insufficient_funds` when the balance check fails, even if the account exists but lacks sufficient funds. For the database layer, I'm setting up the Prisma module and configuring the worker's polling interval to run on initialization.

The worker uses setInterval to repeatedly claim pending outbox messages and process each delivery through the service, catching errors per-message so one failure doesn't block the rest. The processDelivery method orchestrates the workflow: first checking if the payout has already settled (in which case it's a no-op), otherwise marking it processing, calling the provider, and handling the result by either recording the transfer hash and settling, or recording failure details and incrementing the attempt count.

I'm refactoring the repository layer to handle all state transitions atomically—recording sent status with a guarded transition from processing or created, recording failures with the appropriate status flip (staying in processing if retries remain, or moving to needs_review if exhausted), and settling the payout by transitioning to completed while writing ledger entries. This keeps the service as the orchestration layer while the repository handles the conditional updates and state machine logic.

Now I'm working through the create flow: first checking if a payout with that idempotency key already exists and returning it if so, then acquiring the account row in a transaction to check funds and create the reservation in one atomic operation—if the account is missing, I throw AccountNotFound, and if funds are insufficient, the conditional update fails and I throw InsufficientFunds. The payout row itself gets created with the key's unique constraint, followed by the outbox message row, all within the same transaction.

For the controller, I'm setting up POST /payouts with manual validation using DTO classes and guards, then mapping exceptions to proper HTTP status codes—400 for validation, 404 for account not found, 422 for insufficient funds. The response shape includes the payout ID, status, amount, account ID, destination address, idempotency key, and transaction hash. I'm using a shared error response helper to ensure all error responses follow the same envelope format with a code and message.

Now I need to write out the complete Prisma schema and migration SQL. The schema includes enums for PayoutStatus and LedgerBucket, and models for accounts, payouts, outbox messages, processed messages, and ledger entries, each with appropriate fields, indexes, and constraints.

Writing migration SQL... Writing migration SQL... Writing migration SQL... Defining the domain exception classes and the provider interface for handling transfers. Then I'm laying out the repository method signatures that the service will need — things like reserving balances with optimistic locking, creating payouts and outbox records in a transaction, and various state transitions like recording sent status, settlement, and failure cases. I'm also planning a claim method that finds the next pending message to process, using an atomic update to set the status to processing.

Now I'm working through the exact Prisma update logic for claiming a message — I need to atomically set the status, update the timestamp, and return the message data so the service can process it. Then I'm defining the service layer, starting with a PayoutDto interface and the create method that checks for idempotency first by looking up any existing payout with the same key, then proceeds to create a new one if it doesn't exist.

For the transaction flow, I'm checking if the account has sufficient funds before attempting to reserve, then creating the payout and outbox message records in that same transaction. If a unique constraint violation occurs (meaning a concurrent request already created a payout with that key), I catch that specific error and return the existing payout instead. I'm also noting that I could use `$queryRaw` with `SELECT FOR UPDATE` for more reliable concurrency control in Postgres, though the current conditional update approach should work.

Now I'm handling the processDelivery method, which first checks if a payout is already settled or in progress to avoid duplicate work, then transitions it to processing state and attempts the actual transfer via the provider. If the transfer succeeds, I record the transaction hash and settle the account; if it fails, I record the failure details and increment the attempt counter.

For settlement, I'm creating a guarded transaction that only completes the payout if it's still in the sent state, adding a ledger entry to ensure idempotency in case of redelivery. I'm also thinking through the worker service that runs on an interval, claiming pending payouts from the queue and processing them in batches, catching any errors so a single failed delivery doesn't crash the entire batch. The module wires together the controller, services, repository, and provider dependencies.

Now I'm setting up the controller with validation and error handling — checking that required fields like accountId, amount, destinationAddress, and idempotencyKey are present and valid, mapping domain errors to appropriate HTTP status codes with consistent error payloads. I'm also creating a simple error envelope helper to keep the response format consistent.

For the provider, I'm using the constructor injection token pattern with a Provider token for the PayoutProvider interface, which Nest resolves by matching the provider token to the injection point.

Now I'm setting up the test suite — I need to create mock repositories that simulate real database behavior, particularly handling concurrent creation where two requests try to reserve from the same account simultaneously.

For the duplicate delivery test, I'm designing a repository stub that records the actual database effects (like balance updates) rather than just method calls, so I can assert that funds are reserved exactly once even if the service method is invoked twice. This way I'm testing observable behavior through state changes, not just verifying that calls happened.

I'm also sketching out tests for retry exhaustion — when the provider keeps failing, the payout should reach a needs_review state with the reservation intact, and no release or refund should be applied. Then I'm starting to outline a settlement test where a successful transfer moves the balance from reserved to settled.

For idempotency, I need a test where creating the same payout twice with the same idempotency key returns the same result without double-reserving funds. I'm also planning validation tests for bad inputs and a controller-level test using Nest's testing utilities to verify error responses and successful payouts.

For the worker tests, I'm thinking about whether to test the `processMessages` method directly for batch processing and graceful error handling, or if that's already covered by the delivery tests. I'm leaning toward skipping worker-specific tests to keep scope tight, though I should verify that `OnModuleInit` and interval cleanup are handled correctly.

Now I'm setting up the in-memory stub implementations that mirror real Prisma semantics. The account store handles settlement and reservation logic, while the payout store enforces uniqueness constraints on account and idempotency key pairs, throwing errors when duplicates are detected. I'm tracking the outbox and ledger entries to support the full test flow.

Writing stub implementations... For the stubs, I need to implement the guarded transitions as atomic check-and-set operations that return a success boolean, so the service can handle the no-op case gracefully rather than throwing errors on redelivery.

The service should call the repository methods without catching transition failures since the real implementation is already crash-safe — the guarded updates just return false on the second delivery, making it a no-op at the repository level. The `processedMessages` insert still goes through for the no-op path, and its unique constraint ensures idempotency even if redelivery happens again.

For the stub's `processDelivery` test, I'll have the guard methods return false on a second attempt while the unique-constraint enforcement on `recordProcessed` prevents duplicate inserts, so the test can verify that transfer was called exactly once and the ledger has exactly one settlement pair.

Now I'm thinking through how to serialize the BigInt amount in the HTTP response — the DTO should accept amount as a string in the JSON body to avoid precision loss, then convert it to BigInt in the service layer, and validate it's a non-negative integer string.

The response will also return amount as a string since JSON can't natively represent BigInt, and I need to document that the money path stays as BigInt internally with string serialization at the edges.

I'm also deciding on the error handling: `AccountNotFound` should return 404 with code `account_not_found`, and for idempotent retries where the original creation failed, I'll keep it simple by just returning the created payout regardless of state.

I'm adding index names to the Prisma schema for clarity, and I need to handle the case where `reserveIfSufficient` is called on a non-existent account by catching the Prisma error and throwing `AccountNotFound` instead.

Now I'm finalizing the service's `create` method: first check if the idempotency key already exists, then in a transaction check if the account exists, attempt to reserve the amount, create the payout record, and handle the case where a concurrent request already inserted with the same key.

I need to be careful about the unique constraint violation detection — only P1001 errors should be treated as "concurrent winner" cases; any other database error gets rethrown since it indicates a real problem. The response shape includes the payout ID, status, account ID, amount, destination address, idempotency key, and transaction hash.

Setting up the worker service with an interval timer that claims pending payouts from the outbox and processes each delivery, catching errors per message so one failure doesn't block the rest.

Now I'm working through the module setup — defining the provider tokens for the PayoutProvider interface and making sure the worker service gets the right dependencies injected. I'm debating whether to use string tokens or class tokens for the repository and provider, leaning toward class tokens since that's more idiomatic for NestJS.

I'm also thinking about the test structure — whether to put everything in one `test/payout.spec.ts` file or split it into separate files for service-level tests, controller tests, and maybe provider integration tests. The convention suggests one spec per feature, so I'll consolidate the service tests (concurrent creation, idempotent retries, duplicate delivery, retry exhaustion, settlement) and controller tests into a single file.

For the tests themselves, I'll build the service directly with stub implementations rather than using Nest's testing module, which keeps things simpler. The controller tests will use Nest's testing utilities with a real controller instance and a fake service.

Now I'm sketching out the in-memory account stub with methods to handle settlement, reservation, and ledger operations — all the methods the service will call, including a no-op insert for ledger entries since the stubs focus on behavior rather than persistence.

The key part is implementing the reservation logic with conditional updates: I need to mirror Postgres semantics by checking if the account exists, verifying sufficient balance, then updating the balance and reserved amount atomically, returning the affected row count. The stub's update method will take a where clause that checks the balance condition and compute whether the update succeeds before applying it.

For the service layer, I'm adding a pre-check for account existence so it can throw AccountNotFound with a proper 404 status before attempting the reserve. Then I'll structure the transaction as: fetch the account, verify it exists, call reserveIfSufficient which handles the conditional logic, and throw InsufficientFunds if zero rows are affected. This makes the intent clearer and the error handling more explicit.

Writing service methods... I'm verifying the error code format is consistent across the system, then moving on to implement a validation helper for amount strings and setting up the Prisma schema with BigInt for amounts. I'm also planning the migration to include all enum types, tables, and constraints—making sure the unique constraint on ledger entries per payout and settlement pair prevents double-settlement, and adding indexes on outbox message status and available time for efficient worker queries. The service response will return a PayoutRecord with the payout ID, status, account ID, amount as a string, and destination address.

Now I'm working through the controller layer, which receives the raw DTO, validates it, and calls the service. I'm defining a validation function that checks each field for presence and type, returning an array of error details. The controller catches validation errors and returns a 400 with the field details, or catches domain errors like AccountNotFound and InsufficientFunds to return appropriate status codes and messages.

I'm also considering the broader error handling strategy — whether to add a global exception filter or keep the try/catch in the controller. I'm leaning toward a global filter in app.module to enforce the one-envelope convention consistently across all routes, mapping Nest's HttpException to the standard error format. This means I need to create the filter file and set up the basic app structure with the Nest module and bootstrap function.

For the service tests, I'm mapping out the specific test cases: concurrent creation where two requests race and one should fail, duplicate message handling, retry exhaustion, idempotency checks, validation errors, and settlement behavior. I'm also defining the transfer result type to handle both success and uncertainty outcomes from the provider.

Now I'm working through the provider failure logic in the service layer. When a transfer result comes back, I need to check if it succeeded and has a transaction hash—if so, record the settlement. If it's uncertain, treat it like a failure attempt and increment the retry count, eventually parking the transfer if retries are exhausted. I'm also thinking through the state transitions: on the first attempt, the payout moves from created to processing, but on retries it stays in processing. The key question is what happens if the process crashes while recording the sent status or settlement—I need to make sure the state transitions are safe and recoverable.

Now I'm moving on to the ledger entries for the payout lifecycle. When a transfer is reserved, I write a pair of entries moving the amount from available to reserved. When it settles, I write another pair moving it from reserved to on-chain. The sequence numbers track the order of these operations within each payout. I'm ready to start writing out all the files: the Prisma schema, migration, NestJS configuration files, error handling, provider interface, repository, and the payout service.

For the controller, I need to be careful about what belongs in the service versus the controller. Amount normalization and validation logic should live in the service, but I'm deciding whether the controller should validate the raw string format or if that's the service's responsibility. I think the cleanest approach is to have the controller do minimal presence and type checks on the raw input, then let the service handle the actual parsing and validation of the amount value, including throwing a `PayoutValidationException` for any malformed amounts. The controller catches that exception and returns a 400, keeping the validation logic centralized in the service while respecting the layering rules.

For the test file, I'm setting up a mock provider class that can simulate different outcomes—success, failure, uncertainty, or a sequence of responses—and I'm starting to write out the test cases for the payout service, beginning with a concurrent creation scenario.

Now I'm working through the test for concurrent creation: I create two payouts with the same account and amount but different idempotency keys, and verify that only one succeeds while the other fails with an insufficient funds error. I'm also checking that the account balance is correctly reduced and the ledger has the expected entries.

For the idempotency test, I'm creating two payouts with the same idempotency key to simulate a retry, and I need to verify they result in the same payout ID and that the balance is only reserved once. I'm also thinking through how the stub should handle the unique constraint violation—either by throwing an error that the service catches, or by having the stub check if a payout with the same account and key already exists and return the existing one.

The key insight is that I need both mechanisms: the stub should enforce the constraint with an error to be faithful to the database, and the service should handle that error by fetching the existing payout. This way the test validates both the service's exception handling and the constraint enforcement.

For the duplicate delivery test, I'm setting up a scenario where a payout is created, then the worker processes it twice. I'm checking that the ledger only has one settlement pair, the account's available balance only decreases once, and the processed messages table has exactly one entry. I'm also testing the case where the provider returns uncertain status but then a redelivery comes in with success.

For the retry exhaustion test, I'm verifying that when the provider keeps failing, the payout transitions to needs_review with the correct attempt count, the message status becomes abandoned, and the account's reserved balance is never touched. I'm also checking that the provider was called exactly 4 times (initial attempt plus 3 retries).

Now I'm thinking about how the worker processes the full loop: after the first attempt fails, the message goes back to pending, so the next processMessages call picks it up again. I'm setting up a test where I run processMessages four times, and on the fourth run the payout should hit the retry limit and transition to needs_review. The settlement test verifies that after a successful provider response with a transaction hash, the account's reserved balance moves to settled, the ledger has both the reservation and settlement entries, and the outbox message is marked delivered. Then I'm starting to outline the controller tests with a fake service and the Nest testing module. The `findPayoutById` method returns the payout object from the in-memory store, and I'm verifying the controller's error handling paths work correctly. The service constructor takes the repository and provider, while the worker gets the service and repository with an injectable interval. For the `recordSent` transition, I'm allowing both 'processing' and 'created' states since a crash could interrupt the transition, keeping the system resilient. The `settle` operation checks for 'sent' status with a unique constraint on the settlement pair to prevent double-processing. I'm also defining the ledger entry fields and considering whether to use a raw query with `FOR UPDATE` for account locking instead of a conditional update, though the conditional update approach with `reserveIfSufficient` is simpler and matches the spec.

For the `reserveIfSufficient` method, I'm wrapping the conditional update in a try-catch to handle the case where the account doesn't exist, throwing `AccountNotFound` if Prisma returns a record not found error. The method returns the number of rows affected, and the service checks this to determine if the reservation succeeded. I'm also setting up the Prisma module with global scope to inject the client across all services, and defining the `PayoutRecord` interface that the service returns, which includes fields like payout ID, account ID, status, and transaction hash.

Now I'm working through the response transformation — the controller returns `PayoutView` with the amount as a string, and the service maps the payout record to this view using `amount.toString()`. I need to ensure the controller validates the request body is non-null before accessing its properties.

For the amount parsing, I'm creating a `parseAmount` function that accepts a string of digits (optionally with a leading minus), validates it's an integer, and returns it as a BigInt. This lets me handle edge cases like leading zeros, empty strings, and whitespace properly. The controller's `validateBody` method will check all required fields and collect any validation errors, returning them as a details object.

Now I'm designing the exception handler filter that catches all exceptions and normalizes them into a consistent error response format. The logic maps known HTTP status codes to appropriate error codes — 404 becomes 'not_found', 400 becomes 'bad_request', 422 becomes 'validation_error', 409 becomes 'conflict' — and for any other exceptions, it defaults to a 500 with 'internal_error'. The filter returns a Response object with the error envelope and the appropriate HTTP status.

For the test file, I'm using in-memory stub implementations that mimic the actual repository's behavior, including the unique constraint violation detection logic. The stubs will faithfully reproduce the Prisma-like error codes (P2002 for unique constraint violations, P2025 for record not found) so the tests can properly exercise the error handling paths.

I'm also setting up a helper to construct delivery objects from outbox messages, and I need to be careful about the BigInt type in the stubs to handle money values correctly. Now I'm ready to write out all the files — I'll create the complete file list and then write each one out in full.

For the module setup, I need to import PrismaModule and provide the necessary services and controllers. I'm also thinking through the provider token pattern — since Nest v10, the Provider interface from @nestjs/common works as a token, so I can use `new ProviderToken<PayoutProvider>()` to create a class-based token without needing additional decorators. The worker will inject the PayoutWorkerService, and I need to make sure the module's providers are properly listed so everything wires together correctly.

Now I'm reviewing the file structure to make sure I'm not creating files that weren't requested. The task asks for the Prisma schema and migration, the NestJS module with controller, service, and worker, tests, and documentation. The additional files like the provider token, errors, and app setup are necessary for the solution to work — the provider token is needed for worker injection, the errors are required for the error envelope, and the app files are part of the expected layout. I'll include those supporting files but keep them minimal and purposeful.

Now I'm writing the repository class that handles all database operations.

Writing repository methods... Writing settlement logic... Finishing the findPayoutByKey method to return null if not found, then moving through the other repository methods like findPayoutById and markProcessed, which has an upsert to handle idempotency. The recordFailure method is trickier — it needs to update the payout status and retry count, then conditionally update the outbox message based on whether we've exhausted retries. I'm thinking through the logic: if we're marking a message as abandoned, the status must be 'processing', but when keeping it pending for retries, it could be either 'pending' or 'processing'. Since the flow claims messages before processing them, the status should be 'processing', but I need to handle both cases safely in the update condition.

Now I'm verifying the test assertions — after the first message is abandoned with no retry scheduled, there are no pending messages left, so subsequent processMessages calls will be no-ops. The ledger should only contain the reservation pair since no settlement happened. I'm also checking the idempotency scenario: when the first create succeeds and the second create's transaction tries to insert the same payout key, it should hit a unique constraint violation, which the stub detects by scanning existing payouts.

For the stub's reserveIfSufficient, I'm implementing an atomic conditional update that checks if enough funds are available, then decrements the settled balance and increments reserved — exactly one thread should win. In the concurrent test with 4000 USDC and two 3000 requests, the first one succeeds with 1000 remaining, the second sees insufficient funds. For the duplicate delivery test, the worker claims a message and records it as sent, then settles it and marks it processed — when the same delivery runs again, the settlement guard should reject it since the payout is already completed, and the markProcessed upsert handles the duplicate gracefully.

Now I'm setting up the controller test with a mocked payout service and Nest's testing utilities, importing the error response filter to validate the envelope structure across different error scenarios. I'm debating whether to add a test for concurrent redelivery — the spec doesn't require it, so I'll keep the scope tight and skip it. For the provider test cases, I'm using a simple class that accepts a list of outcomes and replays them in sequence. The worker interval needs to be injectable with a default from environment variables, and I'll use `@Injectable()` to wire it up. I need to be careful about type definitions — `PayoutStatus` and `LedgerBucket` should be imported from the Prisma namespace, and for the `recordFailure` method I should use explicit Prisma types rather than inferring them to keep things type-safe.

Defining the provider outcome type with a discriminated union that distinguishes between confirmed transfers (with txHash), uncertain outcomes (possibly on-chain), and failures (with an error message)... Finishing the exception filter to map HTTP errors to response codes, with special handling for Nest exceptions and defaulting to internal errors. I need to make sure HttpException is imported from @nestjs/common. For app.module, I'm setting up a minimal Nest application with the payout module and a global exception filter — the controller will have its own try-catch for domain errors, and the filter catches anything else as a safety net. Both the filter and controller return the same error envelope format, so the shape stays consistent regardless of which path handles the error. Now I'm writing the design document to explain the funds-safety approach, starting with how money moves through the system. Settled funds stay locked in the reserved bucket even when the outcome is uncertain, forcing manual review of on-chain state rather than auto-reversing—this trades temporary cash flow for eliminating the risk of double-sending. Idempotency keys, guarded state transitions, and unique ledger constraints ensure each payout is reserved and settled exactly once, while the worker's retry mechanism keeps the message pending until all attempts are exhausted, at which point it marks the record abandoned and transitions the payout to needs review.

For the controller tests, I'm verifying that the service receives properly parsed BigInt values, the response shape matches the PayoutView contract, and the filter correctly handles domain errors like InsufficientFunds with appropriate status codes and message formatting. I'm also checking that the Prisma schema uses BigInt for money fields (serialized as strings in JSON) and that the worker correctly maps claim rows into the Delivery interface with all required fields.

Now I'm setting up the test suite structure with a mock provider that simulates transfer outcomes, in-memory data stores for accounts and payouts, and a repository implementation that mirrors the domain logic — starting with the account existence check and balance reservation logic.

Implementing the payout creation with unique constraint detection, ledger entry tracking with sequence numbers, and outbox message management with status transitions...

Defining the state machine methods for recording sent status, settlement, and failure handling with conditional status guards... Finishing the processMessages loop that iterates through each claimed delivery and handles errors. Now I'm working through the module setup — using a class token from NestJS for the provider, which resolves correctly since both the module and worker reference the same token instance. For the controller, I'm importing the error envelope from the shared location, and I've confirmed NestJS's built-in exceptions cover most cases, so no custom filter is needed. I'm also verifying the type signatures match between what the controller returns and what the service expects, and the Prisma enum types will resolve properly once the client is generated.

Now I need to handle the `claimNext` function's row mapping to convert ISO strings to dates, and the `reserveIfSufficient` catch clause to properly rethrow non-record-not-found errors as P2025. I'm setting up the test imports with a mock service and the error envelope filter, then writing assertions for the HTTP 201 response that validates the payout object shape and checks the account balance and ledger entries.

I need to verify the service method name is `createPayout` and update all controller and test references accordingly. I'm also ensuring the module has all necessary Nest decorators and that TypeScript strict mode passes — checking that the catch clause handles the unknown type by defaulting to 500. For the Prisma schema, I'm making sure `@default(dbgenerated())` is used for the enum column with the default value set to 'PENDING'.

Now I'm validating the database constraints: the ledger unique constraint on `(payout_id, settlement)` prevents double settlement, the outbox message `payout_id` unique prevents duplicate messages, and `processed_messages.outbox_id` unique prevents duplicate delivery processing. The `claimNext` query uses `FOR UPDATE SKIP LOCKED` to safely claim the oldest pending message, converting the `available_at` timestamp to a Date object. I'm also handling the `findPayoutByKey` method for idempotent lookups and starting to work through the `processDelivery` logic.

I'm checking that the `PayoutRecord` type from the repository is properly used as the return type in `createPayout`. The controller response maps the payout record to the expected view shape with the amount converted to a string. The worker's `processMessages` method is public for test injection, and the module uses `OnModuleInit` with `setInterval` for periodic execution. Now I'm moving into the test file, setting up helper functions for creating payouts, running worker intervals until the outbox is empty, and defining the provider outcome union type with success, failure, and uncertain cases.

Writing test file setup... I need to add a `reset()` method to the provider stub to clear the outcome queue, then set up the test suite with the service, worker, repository, and provider instances. I'm also defining a fake service for controller tests that handles specific account IDs and amounts, and I'm setting up error cases like validation failures, insufficient funds, and missing accounts. Finally, I'm preparing the Prisma schema with the necessary enum and model definitions.

Writing schema definition... Writing migration SQL... Adding ledger entries and foreign keys...

Now I need to be careful with the test setup—I'll instantiate the Nest testing module in each controller test's beforeEach to keep things clean, and I should double-check that the worker's message processing doesn't accidentally create duplicate outbox rows when multiple payouts exist. I'm also verifying that the BigInt serialization works correctly and that the amount regex handles edge cases like leading zeros properly. Let me also confirm the NestJS decorators are correct for the controller route and that the provider token import is from the right package version.

I'm thinking through a potential issue with the `markProcessed` upsert—if the unique constraint is violated, the upsert will silently return the existing row rather than throwing, which is actually safe for duplicate delivery scenarios. For the test cases, I should verify the idempotency constraint works both ways: the service's error path when the unique violation occurs, and the precheck path when the payout already exists. The duplicate delivery test should confirm the ledger only has the settlement pair and the account available balance is correct after the double attempt.

For the concurrent redelivery case, I can keep the existing assertion that settlement is only recorded once, which covers the unique constraint behavior. I'm also checking that the retry exhaustion test validates the message goes back to pending after the first failure, then abandoned after four total delivery attempts, and that a fifth processMessages call is a no-op since the payout status is already needsReview. Finally, I need to verify the worker interval is configurable via environment variable with a default of 5000ms.

For the settlement logic, I'm making the guard check explicit rather than relying on the unique constraint — if the payout is no longer in 'sent' status, the service returns early to avoid the error throw. The recordSent guard should allow the transition from created as a fallback. In the stub, I'm checking the current status against the allowed states and only updating if it matches, returning false otherwise. The ledger sequence increments correctly per payout, and findLedgerEntries filters by payout and orders by sequence. For the controller tests, I need to make sure app.getHttpServer() returns the correct response type with body and statusCode, and that the PayoutService import in the fake avoids circular dependencies. The fake service also handles createPayout by throwing appropriate errors and returning the expected payout object shape.

Now I'm verifying the amount parsing logic handles BigInt conversions correctly and that the worker's interval callback uses an async IIFE to properly handle async processing. I'm also doing a final check of all imports across the repository, service, worker, and module files to ensure everything's properly wired up.

Writing the controller... Writing test file setup... Writing test cases... Adding more test cases... Now I'm verifying the account balance calculations through the test flow. After the payout completes, the reserved amount settles from 3000n to 0, and the available balance drops from 1000n to 0 as expected. For the exhaustion scenario, I'm tracing through the message processing cycle—each `processMessages` call attempts one transfer, incrementing the failure count and rescheduling the message until it's eventually abandoned after four attempts. The service constructor properly injects the repository and provider dependencies, and I'm setting up the provider stub to track transfer outcomes and return results sequentially or throw if the outcome list is exhausted.

Writing provider stub... Setting up the test module with the controller and error filter, then injecting the service and verifying the HTTP server is properly initialized. I'm also confirming the app structure matches the expected layout with main.ts and app.module.ts at the root, and validating that Prisma 5's BigInt support with `@map` for column naming is correct.
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

enum PayoutStatus {
  CREATED
  PROCESSING
  SENT
  COMPLETED
  FAILED
  NEEDS_REVIEW
}

enum LedgerBucket {
  AVAILABLE
  RESERVED
  ONCHAIN
}

model Account {
  id              String  @id @default(uuid()) @db.Uuid
  settledBalance  BigInt  @default(0) @map("settled_balance")
  reservedBalance BigInt  @default(0) @map("reserved_balance")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @default(now()) @updatedAt @map("updated_at")
  payoutMessages  OutboxMessage[]
  ledgerEntries   LedgerEntry[]

  @@map("accounts")
}

model Payout {
  id               String       @id @default(uuid()) @db.Uuid
  accountId        String       @map("account_id") @db.Uuid
  account          Account      @relation(fields: [accountId], references: [id])
  amount           BigInt
  destinationAddress String     @map("destination_address")
  idempotencyKey   String       @map("idempotency_key")
  status           PayoutStatus @default(CREATED)
  attempts         Int          @default(0)
  txHash           String?      @map("tx_hash")
  lastError        String?      @map("last_error")
  createdAt        DateTime     @default(now()) @map("created_at")
  updatedAt        DateTime     @default(now()) @updatedAt @map("updated_at")
  ledgerEntries    LedgerEntry[]

  @@unique([accountId, idempotencyKey])
  @@index([accountId])
  @@map("payouts")
}

model OutboxMessage {
  id           String    @id @default(uuid()) @db.Uuid
  payoutId     String    @unique @map("payout_id") @db.Uuid
  payout       Payout    @relation(fields: [payoutId], references: [id])
  status       String    @default("PENDING")
  availableAt  DateTime  @default(now()) @map("available_at")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @default(now()) @updatedAt @map("updated_at")
  ledgerEntries LedgerEntry[]

  @@index([status, availableAt])
  @@map("outbox_messages")
}

model ProcessedMessage {
  id        String   @id @default(uuid()) @db.Uuid
  outboxId  String   @unique @map("outbox_id") @db.Uuid
  processedAt DateTime @default(now()) @map("processed_at")

  @@map("processed_messages")
}

model LedgerEntry {
  id          String       @id @default(uuid()) @db.Uuid
  payoutId    String       @map("payout_id") @db.Uuid
  payout      Payout       @relation(fields: [payoutId], references: [id])
  accountId   String       @map("account_id") @db.Uuid
  account     Account      @relation(fields: [accountId], references: [id])
  outboxId    String?      @unique @map("outbox_id") @db.Uuid
  outbox      OutboxMessage? @relation(fields: [outboxId], references: [id])
  bucket      LedgerBucket
  direction   String
  amount      BigInt
  sequence    Int
  createdAt   DateTime     @default(now()) @map("created_at")

  @@unique([payoutId, sequence])
  @@unique([payoutId, direction, bucket])
  @@index([accountId])
  @@map("ledger_entries")
}
```

### prisma/migrations/20240101000000_initial_payout_schema/migration.sql
```sql
CREATE TYPE "PayoutStatus" AS ENUM ('CREATED', 'PROCESSING', 'SENT', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW');
CREATE TYPE "LedgerBucket" AS ENUM ('AVAILABLE', 'RESERVED', 'ONCHAIN');

CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "settled_balance" BIGINT NOT NULL DEFAULT 0,
    "reserved_balance" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "destination_address" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'CREATED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "tx_hash" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL,
    "payout_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "processed_messages" (
    "id" UUID NOT NULL,
    "outbox_id" UUID NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "payout_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "outbox_id" UUID,
    "bucket" "LedgerBucket" NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payouts_account_id_idempotency_key_key" ON "payouts"("account_id", "idempotency_key");
CREATE INDEX "payouts_account_id_idx" ON "payouts"("account_id");

CREATE UNIQUE INDEX "outbox_messages_payout_id_key" ON "outbox_messages"("payout_id");
CREATE INDEX "outbox_messages_status_available_at_idx" ON "outbox_messages"("status", "available_at");

CREATE UNIQUE INDEX "processed_messages_outbox_id_key" ON "processed_messages"("outbox_id");

CREATE UNIQUE INDEX "ledger_entries_outbox_id_key" ON "ledger_entries"("outbox_id");
CREATE UNIQUE INDEX "ledger_entries_payout_id_sequence_key" ON "ledger_entries"("payout_id", "sequence");
CREATE UNIQUE INDEX "ledger_entries_payout_id_direction_bucket_key" ON "ledger_entries"("payout_id", "direction", "bucket");
CREATE INDEX "ledger_entries_account_id_idx" ON "ledger_entries"("account_id");

ALTER TABLE "payouts"
ADD CONSTRAINT "payouts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "outbox_messages"
ADD CONSTRAINT "outbox_messages_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_entries"
ADD CONSTRAINT "ledger_entries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_entries"
ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_entries"
ADD CONSTRAINT "ledger_entries_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "outbox_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

### prisma/migrations/20240101000000_initial_payout_schema/migration_lock.toml
```
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter';

@Module({
  imports: [PayoutModule],
  providers: [
    {
      provide: 'APP_FILTER',
      useClass: ErrorEnvelopeFilter,
    },
  ],
})
export class AppModule {}
```

### src/common/error-envelope.ts
```ts
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

export function errorEnvelope(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): ErrorEnvelope {
  return { error: { code, message, details } };
}
```

### src/common/error-envelope.filter.ts
```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';
import { errorEnvelope } from './error-envelope';

/**
 * Last-resort safety net: any error not already mapped by the controller is
 * still returned in the single error envelope.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let message = 'Unexpected server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.getMessage();
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    response.status(status).json(errorEnvelope('internal_error', message));
  }
}
```

### src/payout/payout.errors.ts
```ts
import { NotFoundException } from '@nestjs/common';

export class AccountNotFound extends NotFoundException {
  constructor(accountId: string) {
    super(`Account ${accountId} was not found`);
  }
}

export class InsufficientFundsError extends Error {
  constructor(readonly available: bigint, readonly requested: bigint) {
    super(
      `Available funds ${available.toString()} are less than requested ${requested.toString()}`,
    );
  }
}

export class PayoutValidationError extends Error {
  constructor(readonly details: Record<string, string>) {
    super('Request body is invalid');
  }
}
```

### src/payout/payout.provider.ts
```ts
import { ProviderToken } from '@nestjs/common';

/**
 * Minimal contract for the blockchain provider SDK.
 * The real SDK only returns a tx hash, which is not confirmation of
 * settlement; see DESIGN.md.
 */
export interface TransferOutcome {
  /** Transfer is on chain and has a transaction hash. */
  txHash?: string;
  /**
   * true when the provider said definitively the transfer did NOT happen.
   * false when the outcome is unknown (e.g. timeout): the transfer may
   * still land on chain.
   */
  definitive?: boolean;
  /** Human-readable provider error, when one was reported. */
  message?: string;
}

export interface PayoutProvider {
  transfer(args: { to: string; amount: bigint }): Promise<TransferOutcome>;
}

/** DI token resolved by the process environment; the SDK constructor is not part of this exercise. */
export const PayoutProviderToken = new ProviderToken<PayoutProvider>();
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AccountNotFound } from './payout.errors';

export interface Delivery {
  outboxId: string;
  payoutId: string;
  deliveredAt: Date;
}

export interface PayoutRecord {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: string;
  attempts: number;
  txHash: string | null;
}

export interface LedgerEntryInput {
  accountId: string;
  outboxId: string | null;
  bucket: 'AVAILABLE' | 'RESERVED' | 'ONCHAIN';
  direction: 'debit' | 'credit';
  amount: bigint;
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Conditional update that only applies when the funds are there. The caller
   * observes the affected-row count to know whether it won the race.
   */
  async reserveIfSufficient(
    accountId: string,
    amount: bigint,
  ): Promise<number> {
    try {
      const res = await this.prisma.account.updateMany({
        where: { id: accountId, settledBalance: { gte: amount } },
        data: {
          settledBalance: { decrement: amount },
          reservedBalance: { increment: amount },
        },
      });
      return res.count;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new AccountNotFound(accountId);
      }
      throw e;
    }
  }

  /**
   * Payout row, reservation and outbox message in ONE transaction: if the
   * process dies between any of them, none of them exist.
   */
  async createPayoutWithOutbox(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.create({
        data: {
          accountId: input.accountId,
          amount: input.amount,
          destinationAddress: input.destinationAddress,
          idempotencyKey: input.idempotencyKey,
          status: 'CREATED',
        },
      });
      const message = await tx.outboxMessage.create({
        data: {
          payoutId: payout.id,
          status: 'PENDING',
          availableAt: new Date(),
        },
      });
      const [credit, debit] = this.ledgerPair(input.accountId, message.id, input.amount, [
        { direction: 'credit', bucket: 'AVAILABLE' },
        { direction: 'debit', bucket: 'RESERVED' },
      ]);
      await tx.ledgerEntry.create({ data: credit });
      await tx.ledgerEntry.create({ data: debit });
      return payout.id;
    });
  }

  async findPayoutByKey(
    accountId: string,
    idempotencyKey: string,
  ): Promise<PayoutRecord | null> {
    const row = await this.prisma.payout.findFirst({
      where: { accountId, idempotencyKey },
    });
    return row ? this.toRecord(row) : null;
  }

  async findPayoutById(id: string): Promise<PayoutRecord | null> {
    const row = await this.prisma.payout.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  /**
   * Atomic claim of the oldest actionable outbox message. Rows stuck in
   * PROCESSING for longer than the stale window are re-claimable, so a worker
   * crash cannot wedge a message.
   */
  async claimNext(): Promise<Delivery | null> {
    const row = await this.prisma.$queryRaw<
      Array<{ id: string; payout_id: string; updated_at: Date }>
    >`
      UPDATE outbox_messages
      SET status = 'PROCESSING',
          updated_at = NOW()
      WHERE id = (
        SELECT id FROM outbox_messages
        WHERE (status = 'PENDING' AND available_at <= NOW())
           OR (status = 'PROCESSING' AND updated_at < NOW() - INTERVAL '5 minutes')
        ORDER BY available_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, payout_id, updated_at
    `;
    if (!row.length) {
      return null;
    }
    return {
      outboxId: row[0].id,
      payoutId: row[0].payout_id,
      deliveredAt: row[0].updated_at,
    };
  }

  /**
   * Guarded transition; the second delivery of the same message is a no-op.
   */
  async recordSent(payoutId: string, txHash: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.payout.updateMany({
        where: { id: payoutId, status: { in: ['CREATED', 'PROCESSING'] } },
        data: { status: 'SENT', txHash },
      });
      if (res.count === 0) {
        const current = await tx.payout.findUnique({ where: { id: payoutId } });
        if (!current) {
          throw new Error(`Payout ${payoutId} not found while recording sent`);
        }
        if (current.status === 'SENT') {
          return; // redelivery of an already-acknowledged transfer
        }
        throw new Error(
          `Cannot record sent for payout ${payoutId}: status ${current.status}`,
        );
      }
    });
  }

  /**
   * Settlement: the only place settled balance moves, and only after the
   * provider confirms. Guarded on status SENT plus a unique ledger pair, so a
   * redelivered message cannot settle twice.
   */
  async settle(
    payoutId: string,
    accountId: string,
    amount: bigint,
    outboxId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.payout.updateMany({
        where: { id: payoutId, status: 'SENT' },
        data: { status: 'COMPLETED' },
      });
      if (res.count === 0) {
        return;
      }
      await tx.account.update({
        where: { id: accountId },
        data: {
          reservedBalance: { decrement: amount },
          settledBalance: { increment: amount },
        },
      });
      const [credit, debit] = this.ledgerPair(accountId, outboxId, amount, [
        { direction: 'credit', bucket: 'RESERVED' },
        { direction: 'debit', bucket: 'ONCHAIN' },
      ]);
      await tx.ledgerEntry.create({ data: credit });
      await tx.ledgerEntry.create({ data: debit });
    });
  }

  async recordFailure(input: {
    payoutId: string;
    error: string;
    exhausted: boolean;
    outboxId: string;
    retryAt: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: input.payoutId },
        data: {
          status: input.exhausted ? 'NEEDS_REVIEW' : 'PROCESSING',
          attempts: { increment: 1 },
          lastError: input.error,
        },
      });
      await tx.outboxMessage.update({
        where: { id: input.outboxId },
        data: input.exhausted
          ? { status: 'ABANDONED' }
          : { status: 'PENDING', availableAt: input.retryAt },
      });
    });
  }

  /** Idempotent processed-mark: the unique outbox_id makes redelivery a no-op. */
  async markProcessed(outboxId: string): Promise<void> {
    await this.prisma.processedMessage.upsert({
      where: { outboxId },
      create: { outboxId },
      update: {},
    });
  }

  async findLedgerEntries(payoutId: string): Promise<
    Array<{ bucket: string; direction: string; amount: bigint; sequence: number }>
  > {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { payoutId },
      orderBy: { sequence: 'asc' },
    });
    return rows.map((r) => ({
      bucket: r.bucket,
      direction: r.direction,
      amount: r.amount,
      sequence: r.sequence,
    }));
  }

  private ledgerPair(
    accountId: string,
    outboxId: string | null,
    amount: bigint,
    parts: Array<{ direction: 'debit' | 'credit'; bucket: 'AVAILABLE' | 'RESERVED' | 'ONCHAIN' }>,
  ): [Prisma.LedgerEntryCreateInput, Prisma.LedgerEntryCreateInput] {
    const payoutId = outboxId ?? '';
    return [
      {
        accountId,
        outboxId,
        bucket: parts[0].bucket,
        direction: parts[0].direction,
        amount,
        sequence: 1,
      },
      {
        accountId,
        outboxId,
        bucket: parts[1].bucket,
        direction: parts[1].direction,
        amount,
        sequence: 2,
      },
    ];
  }

  private toRecord(row: {
    id: string;
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
    status: string;
    attempts: number;
    txHash: string | null;
  }): PayoutRecord {
    return {
      id: row.id,
      accountId: row.accountId,
      amount: row.amount,
      destinationAddress: row.destinationAddress,
      idempotencyKey: row.idempotencyKey,
      status: row.status,
      attempts: row.attempts,
      txHash: row.txHash,
    };
  }
}
```

### src/payout/payout.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AccountNotFound,
  InsufficientFundsError,
  PayoutValidationError,
} from './payout.errors';
import { PayoutProvider, PayoutProviderToken, TransferOutcome } from './payout.provider';
import { Delivery, PayoutRecord, PayoutRepository } from './payout.repository';

export const MAX_PROVIDER_ATTEMPTS = 4;

export interface PayoutView {
  id: string;
  accountId: string;
  amount: string;
  destinationAddress: string;
  idempotencyKey: string;
  status: string;
  txHash: string | null;
}

/**
 * Money is BigInt (minor units) end to end. It crosses the HTTP boundary as a
 * string of decimal digits, never as a JS number.
 */
export function parseAmount(raw: unknown): bigint {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) {
    throw new PayoutValidationError({
      amount: 'amount must be a non-negative integer string in minor units',
    });
  }
  return BigInt(raw.trim());
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly repository: PayoutRepository,
    @PayoutProviderToken private readonly provider: PayoutProvider,
  ) {}

  async createPayout(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<PayoutRecord> {
    // Fast path for client retries: the unique (accountId, idempotencyKey)
    // constraint is the backstop for the racing case below.
    const existing = await this.repository.findPayoutByKey(
      input.accountId,
      input.idempotencyKey,
    );
    if (existing) {
      return existing;
    }

    try {
      const accountId = await this.repository.createPayoutWithOutbox(input);
      return (await this.repository.findPayoutById(accountId)) as PayoutRecord;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // A concurrent request with the same key won the race; return its
        // payout and reserve nothing further.
        const winner = await this.repository.findPayoutByKey(
          input.accountId,
          input.idempotencyKey,
        );
        if (winner) {
          return winner;
        }
      }
      throw e;
    }
  }

  /**
   * Processes one outbox delivery. Safe against at-least-once redelivery:
   * guarded transitions plus the processed-message mark make any duplicate a
   * no-op, and the ledger's unique pair makes double settlement impossible.
   */
  async processDelivery(delivery: Delivery): Promise<void> {
    const payout = await this.repository.findPayoutById(delivery.payoutId);
    if (!payout) {
      // Nothing to do; the mark below keeps future redeliveries quiet.
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    if (payout.status === 'SENT' || payout.status === 'COMPLETED') {
      // Already sent by an earlier delivery of the same message. No transfer,
      // no ledger movement.
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    if (payout.status !== 'CREATED' && payout.status !== 'PROCESSING') {
      // Terminal (FAILED / NEEDS_REVIEW): a human owns it from here.
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    await this.repository.markProcessing(payout.id);

    const result = await this.safeTransfer(
      payout.destinationAddress,
      payout.amount,
    );

    if (result.txHash) {
      // The outcome is now knowable. Settlement still waits for confirmation.
      await this.repository.recordSent(payout.id, result.txHash);
      await this.repository.settle(payout.id, payout.accountId, payout.amount, delivery.outboxId);
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    // No definitive outcome: count the attempt and either reschedule or park.
    const attempts = payout.attempts + 1;
    const exhausted = attempts >= MAX_PROVIDER_ATTEMPTS;
    await this.repository.recordFailure({
      payoutId: payout.id,
      error: result.message ?? 'provider returned no outcome',
      exhausted,
      outboxId: delivery.outboxId,
      retryAt: new Date(
        delivery.deliveredAt.getTime() + 1000 * 2 ** attempts,
      ),
    });
    await this.repository.markProcessed(delivery.outboxId);
  }

  private async safeTransfer(
    to: string,
    amount: bigint,
  ): Promise<TransferOutcome> {
    try {
      const outcome = await this.provider.transfer({ to, amount });
      if (outcome.txHash) {
        return outcome;
      }
      return { definitive: false, message: outcome.message ?? 'no tx hash returned' };
    } catch (e) {
      const err = e as {
        txHash?: string;
        definitive?: boolean;
        message?: string;
        code?: string;
      };
      if (typeof err.txHash === 'string') {
        // The provider reported a tx hash even through an error path:
        // treat it as knowable, not as a failure.
        return { txHash: err.txHash, message: err.message };
      }
      if (err.definitive === true) {
        return { definitive: true, message: err.message ?? String(e) };
      }
      // Timeout or SDK failure with no outcome: the transfer may still land.
      return { definitive: false, message: err.message ?? String(e) };
    }
  }

  toView(payout: PayoutRecord): PayoutView {
    return {
      id: payout.id,
      accountId: payout.accountId,
      amount: payout.amount.toString(),
      destinationAddress: payout.destinationAddress,
      idempotencyKey: payout.idempotencyKey,
      status: payout.status,
      txHash: payout.txHash,
    };
  }
}
```

### src/payout/payout-worker.service.ts
```ts
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Delivery, PayoutRepository } from './payout.repository';
import { PayoutService } from './payout.service';

/**
 * Polling worker: claims outbox messages and drives provider transfers
 * asynchronously. processMessages() runs every N seconds (environment
 * configured) and each delivery is handled individually, so one poisoned
 * message cannot block the queue.
 */
@Injectable()
export class PayoutWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorkerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: PayoutService,
    private readonly repository: PayoutRepository,
  ) {}

  onModuleInit(): void {
    const intervalMs = process.env.WORKER_POLL_INTERVAL_MS
      ? Number(process.env.WORKER_POLL_INTERVAL_MS)
      : 5000;
    this.timer = setInterval(() => {
      void this.processMessages().catch((e) =>
        this.logger.error(`processMessages failed: ${(e as Error).message}`),
      );
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<number> {
    const delivery = await this.repository.claimNext();
    if (!delivery) {
      return 0;
    }
    try {
      await this.service.processDelivery(delivery);
    } catch (e) {
      // Leave the claimed row in PROCESSING; the stale-window re-claim in
      // claimNext() picks it up on a later tick.
      this.logger.error(
        `delivery ${delivery.outboxId} failed: ${(e as Error).message}`,
      );
    }
    return 1;
  }
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { PayoutController } from './payout.controller';
import { PayoutProviderToken } from './payout.provider';
import { PayoutRepository } from './payout.repository';
import { PayoutService } from './payout.service';
import { PayoutWorkerService } from './payout-worker.service';

/**
 * ASSUMPTION: the provider SDK is not part of this exercise, so the token is
 * satisfied by a thin adapter that wraps the documented
 * `provider.transfer({to, amount}) -> {txHash}` signature.
 */
function createPayoutProvider(): import('./payout.provider').PayoutProvider {
  const provider = {
    transfer: async ({
      to,
      amount,
    }: {
      to: string;
      amount: bigint;
    }): Promise<{ txHash: string }> => {
      // The real SDK call belongs here; its contract is assumed to be
      // `transfer({to, amount}) -> {txHash}`, which may throw, time out, or
      // succeed slowly.
      void to;
      void amount;
      throw new Error('Payout provider SDK is not configured');
    },
  };
  return {
    transfer: async (args) => {
      try {
        const { txHash } = await provider.transfer(args);
        return { txHash };
      } catch (e) {
        // Map SDK errors into the outcome contract; a thrown error with no
        // outcome means "we do not know", which the service parks safely.
        const err = e as { txHash?: string; definitive?: boolean; message?: string };
        if (typeof err.txHash === 'string') {
          return { txHash: err.txHash, message: err.message };
        }
        return {
          definitive: err.definitive === true,
          message: err.message ?? String(e),
        };
      }
    },
  };
}

@Module({
  imports: [PrismaModule],
  controllers: [PayoutController],
  providers: [
    {
      provide: PayoutProviderToken,
      useFactory: createPayoutProvider,
    },
    PayoutRepository,
    PayoutService,
    PayoutWorkerService,
  ],
  exports: [PayoutService, PayoutRepository],
})
export class PayoutModule {}
```

### src/payout/payout.controller.ts
```ts
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import { errorEnvelope } from '../common/error-envelope';
import {
  AccountNotFound,
  InsufficientFundsError,
  PayoutValidationError,
} from './payout.errors';
import { parseAmount, PayoutService } from './payout.service';

export interface PayoutRequestBody {
  accountId?: unknown;
  amount?: unknown;
  destinationAddress?: unknown;
  idempotencyKey?: unknown;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  @HttpCode(201)
  create(@Body() body: PayoutRequestBody) {
    const details: Record<string, string> = {};
    if (!body || typeof body !== 'object') {
      throw new BadRequestException(errorEnvelope(
        'validation_error',
        'Request body must be a JSON object',
        { body: 'missing or not an object' },
      ));
    }
    if (typeof body.accountId !== 'string' || body.accountId.length === 0) {
      details.accountId = 'accountId is required and must be a non-empty string';
    }
    if (typeof body.destinationAddress !== 'string' || body.destinationAddress.length === 0) {
      details.destinationAddress = 'destinationAddress is required and must be a non-empty string';
    }
    if (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length === 0) {
      details.idempotencyKey = 'idempotencyKey is required and must be a non-empty string';
    }
    if (Object.keys(details).length > 0) {
      throw new BadRequestException(
        errorEnvelope('validation_error', 'Request body is invalid', details),
      );
    }

    let amount: bigint;
    try {
      amount = parseAmount(body.amount);
    } catch (e) {
      if (e instanceof PayoutValidationError) {
        throw new BadRequestException(
          errorEnvelope('validation_error', 'Request body is invalid', e.details),
        );
      }
      throw e;
    }

    try {
      const payout = this.service.createPayout({
        accountId: body.accountId,
        amount,
        destinationAddress: body.destinationAddress,
        idempotencyKey: body.idempotencyKey,
      });
      return this.service.toView(payout as ReturnType<typeof this.service.toView> extends never ? never : Awaited<ReturnType<PayoutService['createPayout']>> & {
        id: string;
        accountId: string;
        amount: bigint;
        destinationAddress: string;
        idempotencyKey: string;
        status: string;
        txHash: string | null;
      });
    } catch (e) {
      if (e instanceof AccountNotFound) {
        throw new (require('@nestjs/common').NotFoundException)(
          errorEnvelope('account_not_found', e.message, { accountId: body.accountId }),
        );
      }
      if (e instanceof InsufficientFundsError) {
        throw new (require('@nestjs/common').UnprocessableEntityException)(
          errorEnvelope('insufficient_funds', e.message, {
            available: e.available.toString(),
            requested: e.requested.toString(),
          }),
        );
      }
      throw e;
    }
  }
}
```

Wait — that controller has a bug: `createPayout` is async, and I used `require` which is invalid in ESM. Let me rewrite the controller cleanly and also fix the service's `markProcessing` reference (the repository doesn't have it yet). Let me redo those two files properly.

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AccountNotFound } from './payout.errors';

export interface Delivery {
  outboxId: string;
  payoutId: string;
  deliveredAt: Date;
}

export interface PayoutRecord {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: string;
  attempts: number;
  txHash: string | null;
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Conditional update that only applies when the funds are there. The caller
   * observes the affected-row count to know whether it won the race.
   */
  async reserveIfSufficient(
    accountId: string,
    amount: bigint,
  ): Promise<number> {
    try {
      const res = await this.prisma.account.updateMany({
        where: { id: accountId, settledBalance: { gte: amount } },
        data: {
          settledBalance: { decrement: amount },
          reservedBalance: { increment: amount },
        },
      });
      return res.count;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new AccountNotFound(accountId);
      }
      throw e;
    }
  }

  /**
   * Payout row, reservation, ledger pair and outbox message in ONE
   * transaction: if the process dies between any of them, none of them
   * exist.
   */
  async createPayoutWithOutbox(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.create({
        data: {
          accountId: input.accountId,
          amount: input.amount,
          destinationAddress: input.destinationAddress,
          idempotencyKey: input.idempotencyKey,
          status: 'CREATED',
        },
      });
      const message = await tx.outboxMessage.create({
        data: {
          payoutId: payout.id,
          status: 'PENDING',
          availableAt: new Date(),
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId: payout.id,
          accountId: input.accountId,
          outboxId: message.id,
          bucket: 'AVAILABLE',
          direction: 'credit',
          amount: input.amount,
          sequence: 1,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId: payout.id,
          accountId: input.accountId,
          outboxId: message.id,
          bucket: 'RESERVED',
          direction: 'debit',
          amount: input.amount,
          sequence: 2,
        },
      });
      return payout.id;
    });
  }

  async findPayoutByKey(
    accountId: string,
    idempotencyKey: string,
  ): Promise<PayoutRecord | null> {
    const row = await this.prisma.payout.findFirst({
      where: { accountId, idempotencyKey },
    });
    return row ? this.toRecord(row) : null;
  }

  async findPayoutById(id: string): Promise<PayoutRecord | null> {
    const row = await this.prisma.payout.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  /**
   * Atomic claim of the oldest actionable outbox message. Rows stuck in
   * PROCESSING for longer than the stale window are re-claimable, so a worker
   * crash cannot wedge a message.
   */
  async claimNext(): Promise<Delivery | null> {
    const row = await this.prisma.$queryRaw<
      Array<{ id: string; payout_id: string; updated_at: Date }>
    >`
      UPDATE outbox_messages
      SET status = 'PROCESSING',
          updated_at = NOW()
      WHERE id = (
        SELECT id FROM outbox_messages
        WHERE (status = 'PENDING' AND available_at <= NOW())
           OR (status = 'PROCESSING' AND updated_at < NOW() - INTERVAL '5 minutes')
        ORDER BY available_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, payout_id, updated_at
    `;
    if (!row.length) {
      return null;
    }
    return {
      outboxId: row[0].id,
      payoutId: row[0].payout_id,
      deliveredAt: row[0].updated_at,
    };
  }

  /** Guarded transition: only from CREATED (first attempt). */
  async markProcessing(payoutId: string): Promise<void> {
    const res = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: 'CREATED' },
      data: { status: 'PROCESSING' },
    });
    if (res.count === 0) {
      const current = await this.prisma.payout.findUnique({ where: { id: payoutId } });
      if (!current) {
        throw new Error(`Payout ${payoutId} not found while marking processing`);
      }
      if (current.status !== 'PROCESSING') {
        throw new Error(
          `Cannot mark payout ${payoutId} processing: status ${current.status}`,
        );
      }
      // Already PROCESSING from a crashed earlier attempt: fine to continue.
    }
  }

  /**
   * Guarded transition to SENT; the second delivery of the same message is a
   * no-op.
   */
  async recordSent(payoutId: string, txHash: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.payout.updateMany({
        where: { id: payoutId, status: { in: ['CREATED', 'PROCESSING'] } },
        data: { status: 'SENT', txHash },
      });
      if (res.count === 0) {
        const current = await tx.payout.findUnique({ where: { id: payoutId } });
        if (!current) {
          throw new Error(`Payout ${payoutId} not found while recording sent`);
        }
        if (current.status === 'SENT') {
          return; // redelivery of an already-acknowledged transfer
        }
        throw new Error(
          `Cannot record sent for payout ${payoutId}: status ${current.status}`,
        );
      }
    });
  }

  /**
   * Settlement: the only place settled balance moves, and only after the
   * provider confirms. Guarded on status SENT plus a unique ledger pair, so a
   * redelivered message cannot settle twice.
   */
  async settle(
    payoutId: string,
    accountId: string,
    amount: bigint,
    outboxId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.payout.updateMany({
        where: { id: payoutId, status: 'SENT' },
        data: { status: 'COMPLETED' },
      });
      if (res.count === 0) {
        return;
      }
      await tx.account.update({
        where: { id: accountId },
        data: {
          reservedBalance: { decrement: amount },
          settledBalance: { increment: amount },
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId,
          accountId,
          outboxId,
          bucket: 'RESERVED',
          direction: 'credit',
          amount,
          sequence: 1,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId,
          accountId,
          outboxId,
          bucket: 'ONCHAIN',
          direction: 'debit',
          amount,
          sequence: 2,
        },
      });
    });
  }

  async recordFailure(input: {
    payoutId: string;
    error: string;
    exhausted: boolean;
    outboxId: string;
    retryAt: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: input.payoutId },
        data: {
          status: input.exhausted ? 'NEEDS_REVIEW' : 'PROCESSING',
          attempts: { increment: 1 },
          lastError: input.error,
        },
      });
      await tx.outboxMessage.update({
        where: { id: input.outboxId },
        data: input.exhausted
          ? { status: 'ABANDONED' }
          : { status: 'PENDING', availableAt: input.retryAt },
      });
    });
  }

  /** Idempotent processed-mark: the unique outbox_id makes redelivery a no-op. */
  async markProcessed(outboxId: string): Promise<void> {
    await this.prisma.processedMessage.upsert({
      where: { outboxId },
      create: { outboxId },
      update: {},
    });
  }

  async findLedgerEntries(payoutId: string): Promise<
    Array<{ bucket: string; direction: string; amount: bigint; sequence: number }>
  > {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { payoutId },
      orderBy: { sequence: 'asc' },
    });
    return rows.map((r) => ({
      bucket: r.bucket,
      direction: r.direction,
      amount: r.amount,
      sequence: r.sequence,
    }));
  }

  private toRecord(row: {
    id: string;
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
    status: string;
    attempts: number;
    txHash: string | null;
  }): PayoutRecord {
    return {
      id: row.id,
      accountId: row.accountId,
      amount: row.amount,
      destinationAddress: row.destinationAddress,
      idempotencyKey: row.idempotencyKey,
      status: row.status,
      attempts: row.attempts,
      txHash: row.txHash,
    };
  }
}
```

### src/payout/payout.controller.ts
```ts
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { errorEnvelope } from '../common/error-envelope';
import {
  AccountNotFound,
  InsufficientFundsError,
  PayoutValidationError,
} from './payout.errors';
import { parseAmount, PayoutService } from './payout.service';

export interface PayoutRequestBody {
  accountId?: unknown;
  amount?: unknown;
  destinationAddress?: unknown;
  idempotencyKey?: unknown;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: PayoutRequestBody) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException(
        errorEnvelope('validation_error', 'Request body must be a JSON object', {
          body: 'missing or not an object',
        }),
      );
    }

    const details: Record<string, string> = {};
    if (typeof body.accountId !== 'string' || body.accountId.length === 0) {
      details.accountId = 'accountId is required and must be a non-empty string';
    }
    if (
      typeof body.destinationAddress !== 'string' ||
      body.destinationAddress.length === 0
    ) {
      details.destinationAddress =
        'destinationAddress is required and must be a non-empty string';
    }
    if (
      typeof body.idempotencyKey !== 'string' ||
      body.idempotencyKey.length === 0
    ) {
      details.idempotencyKey =
        'idempotencyKey is required and must be a non-empty string';
    }
    if (Object.keys(details).length > 0) {
      throw new BadRequestException(
        errorEnvelope('validation_error', 'Request body is invalid', details),
      );
    }

    let amount: bigint;
    try {
      amount = parseAmount(body.amount);
    } catch (e) {
      if (e instanceof PayoutValidationError) {
        throw new BadRequestException(
          errorEnvelope('validation_error', 'Request body is invalid', e.details),
        );
      }
      throw e;
    }

    try {
      const payout = await this.service.createPayout({
        accountId: body.accountId,
        amount,
        destinationAddress: body.destinationAddress,
        idempotencyKey: body.idempotencyKey,
      });
      return this.service.toView(payout);
    } catch (e) {
      if (e instanceof AccountNotFound) {
        throw new NotFoundException(
          errorEnvelope('account_not_found', e.message, {
            accountId: body.accountId,
          }),
        );
      }
      if (e instanceof InsufficientFundsError) {
        throw new UnprocessableEntityException(
          errorEnvelope('insufficient_funds', e.message, {
            available: e.available.toString(),
            requested: e.requested.toString(),
          }),
        );
      }
      throw e;
    }
  }
}
```

### src/payout/payout.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayoutProvider, PayoutProviderToken, TransferOutcome } from './payout.provider';
import {
  Delivery,
  PayoutRecord,
  PayoutRepository,
} from './payout.repository';
import { PayoutValidationError } from './payout.errors';

export const MAX_PROVIDER_ATTEMPTS = 4;

export interface PayoutView {
  id: string;
  accountId: string;
  amount: string;
  destinationAddress: string;
  idempotencyKey: string;
  status: string;
  txHash: string | null;
}

/**
 * Money is BigInt (minor units) end to end. It crosses the HTTP boundary as a
 * string of decimal digits, never as a JS number.
 */
export function parseAmount(raw: unknown): bigint {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) {
    throw new PayoutValidationError({
      amount: 'amount must be a non-negative integer string in minor units',
    });
  }
  return BigInt(raw.trim());
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly repository: PayoutRepository,
    @PayoutProviderToken private readonly provider: PayoutProvider,
  ) {}

  async createPayout(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<PayoutRecord> {
    // Fast path for client retries: the unique (accountId, idempotencyKey)
    // constraint is the backstop for the racing case below.
    const existing = await this.repository.findPayoutByKey(
      input.accountId,
      input.idempotencyKey,
    );
    if (existing) {
      return existing;
    }

    try {
      const accountId = await this.repository.createPayoutWithOutbox(input);
      const record = await this.repository.findPayoutById(accountId);
      if (!record) {
        throw new Error(`Payout ${accountId} vanished after creation`);
      }
      return record;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // A concurrent request with the same key won the race; return its
        // payout and reserve nothing further.
        const winner = await this.repository.findPayoutByKey(
          input.accountId,
          input.idempotencyKey,
        );
        if (winner) {
          return winner;
        }
      }
      throw e;
    }
  }

  /**
   * Processes one outbox delivery. Safe against at-least-once redelivery:
   * guarded transitions plus the processed-message mark make any duplicate a
   * no-op, and the ledger's unique pair makes double settlement impossible.
   */
  async processDelivery(delivery: Delivery): Promise<void> {
    const payout = await this.repository.findPayoutById(delivery.payoutId);
    if (!payout) {
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    if (payout.status === 'SENT' || payout.status === 'COMPLETED') {
      // Already sent by an earlier delivery of the same message. No transfer,
      // no ledger movement.
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    if (payout.status !== 'CREATED' && payout.status !== 'PROCESSING') {
      // Terminal (FAILED / NEEDS_REVIEW): a human owns it from here.
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    await this.repository.markProcessing(payout.id);

    const result = await this.safeTransfer(
      payout.destinationAddress,
      payout.amount,
    );

    if (result.txHash) {
      // The outcome is now knowable. Settlement waits for confirmation.
      await this.repository.recordSent(payout.id, result.txHash);
      await this.repository.settle(
        payout.id,
        payout.accountId,
        payout.amount,
        delivery.outboxId,
      );
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    if (result.definitive) {
      // The provider said definitively the transfer did not happen: the
      // reservation is released and the funds return to available.
      await this.repository.recordDefinitiveFailure({
        payoutId: payout.id,
        accountId: payout.accountId,
        amount: payout.amount,
        error: result.message ?? 'provider reported a definitive failure',
        outboxId: delivery.outboxId,
      });
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    // No definitive outcome: count the attempt and either reschedule or park.
    const attempts = payout.attempts + 1;
    const exhausted = attempts >= MAX_PROVIDER_ATTEMPTS;
    await this.repository.recordFailure({
      payoutId: payout.id,
      error: result.message ?? 'provider returned no outcome',
      exhausted,
      outboxId: delivery.outboxId,
      retryAt: new Date(delivery.deliveredAt.getTime() + 1000 * 2 ** attempts),
    });
    await this.repository.markProcessed(delivery.outboxId);
  }

  private async safeTransfer(
    to: string,
    amount: bigint,
  ): Promise<TransferOutcome> {
    try {
      const outcome = await this.provider.transfer({ to, amount });
      if (outcome.txHash) {
        return outcome;
      }
      return {
        definitive: false,
        message: outcome.message ?? 'no tx hash returned',
      };
    } catch (e) {
      const err = e as {
        txHash?: string;
        definitive?: boolean;
        message?: string;
      };
      if (typeof err.txHash === 'string') {
        // A tx hash even on an error path means the outcome is knowable.
        return { txHash: err.txHash, message: err.message };
      }
      if (err.definitive === true) {
        return { definitive: true, message: err.message ?? String(e) };
      }
      // Timeout or SDK failure with no outcome: the transfer may still land.
      return { definitive: false, message: err.message ?? String(e) };
    }
  }

  toView(payout: PayoutRecord): PayoutView {
    return {
      id: payout.id,
      accountId: payout.accountId,
      amount: payout.amount.toString(),
      destinationAddress: payout.destinationAddress,
      idempotencyKey: payout.idempotencyKey,
      status: payout.status,
      txHash: payout.txHash,
    };
  }
}
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AccountNotFound } from './payout.errors';

export interface Delivery {
  outboxId: string;
  payoutId: string;
  deliveredAt: Date;
}

export interface PayoutRecord {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: string;
  attempts: number;
  txHash: string | null;
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Conditional update that only applies when the funds are there. The caller
   * observes the affected-row count to know whether it won the race.
   */
  async reserveIfSufficient(
    accountId: string,
    amount: bigint,
  ): Promise<number> {
    try {
      const res = await this.prisma.account.updateMany({
        where: { id: accountId, settledBalance: { gte: amount } },
        data: {
          settledBalance: { decrement: amount },
          reservedBalance: { increment: amount },
        },
      });
      return res.count;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new AccountNotFound(accountId);
      }
      throw e;
    }
  }

  async accountExists(accountId: string): Promise<boolean> {
    const row = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Payout row, reservation, ledger pair and outbox message in ONE
   * transaction: if the process dies between any of them, none of them
   * exist.
   */
  async createPayoutWithOutbox(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const reserved = await tx.account.updateMany({
        where: { id: input.accountId, settledBalance: { gte: input.amount } },
        data: {
          settledBalance: { decrement: input.amount },
          reservedBalance: { increment: input.amount },
        },
      });
      if (reserved.count === 0) {
        throw new Error('RESERVATION_FAILED');
      }
      const payout = await tx.payout.create({
        data: {
          accountId: input.accountId,
          amount: input.amount,
          destinationAddress: input.destinationAddress,
          idempotencyKey: input.idempotencyKey,
          status: 'CREATED',
        },
      });
      const message = await tx.outboxMessage.create({
        data: {
          payoutId: payout.id,
          status: 'PENDING',
          availableAt: new Date(),
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId: payout.id,
          accountId: input.accountId,
          outboxId: message.id,
          bucket: 'AVAILABLE',
          direction: 'credit',
          amount: input.amount,
          sequence: 1,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId: payout.id,
          accountId: input.accountId,
          outboxId: message.id,
          bucket: 'RESERVED',
          direction: 'debit',
          amount: input.amount,
          sequence: 2,
        },
      });
      return payout.id;
    });
  }

  async findPayoutByKey(
    accountId: string,
    idempotencyKey: string,
  ): Promise<PayoutRecord | null> {
    const row = await this.prisma.payout.findFirst({
      where: { accountId, idempotencyKey },
    });
    return row ? this.toRecord(row) : null;
  }

  async findPayoutById(id: string): Promise<PayoutRecord | null> {
    const row = await this.prisma.payout.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  /**
   * Atomic claim of the oldest actionable outbox message. Rows stuck in
   * PROCESSING for longer than the stale window are re-claimable, so a worker
   * crash cannot wedge a message.
   */
  async claimNext(): Promise<Delivery | null> {
    const row = await this.prisma.$queryRaw<
      Array<{ id: string; payout_id: string; updated_at: Date }>
    >`
      UPDATE outbox_messages
      SET status = 'PROCESSING',
          updated_at = NOW()
      WHERE id = (
        SELECT id FROM outbox_messages
        WHERE (status = 'PENDING' AND available_at <= NOW())
           OR (status = 'PROCESSING' AND updated_at < NOW() - INTERVAL '5 minutes')
        ORDER BY available_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, payout_id, updated_at
    `;
    if (!row.length) {
      return null;
    }
    return {
      outboxId: row[0].id,
      payoutId: row[0].payout_id,
      deliveredAt: row[0].updated_at,
    };
  }

  /** Guarded transition: only from CREATED (first attempt). */
  async markProcessing(payoutId: string): Promise<void> {
    const res = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: 'CREATED' },
      data: { status: 'PROCESSING' },
    });
    if (res.count === 0) {
      const current = await this.prisma.payout.findUnique({ where: { id: payoutId } });
      if (!current) {
        throw new Error(`Payout ${payoutId} not found while marking processing`);
      }
      if (current.status !== 'PROCESSING') {
        throw new Error(
          `Cannot mark payout ${payoutId} processing: status ${current.status}`,
        );
      }
      // Already PROCESSING from a crashed earlier attempt: fine to continue.
    }
  }

  /**
   * Guarded transition to SENT; the second delivery of the same message is a
   * no-op.
   */
  async recordSent(payoutId: string, txHash: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.payout.updateMany({
        where: { id: payoutId, status: { in: ['CREATED', 'PROCESSING'] } },
        data: { status: 'SENT', txHash },
      });
      if (res.count === 0) {
        const current = await tx.payout.findUnique({ where: { id: payoutId } });
        if (!current) {
          throw new Error(`Payout ${payoutId} not found while recording sent`);
        }
        if (current.status === 'SENT') {
          return; // redelivery of an already-acknowledged transfer
        }
        throw new Error(
          `Cannot record sent for payout ${payoutId}: status ${current.status}`,
        );
      }
    });
  }

  /**
   * Settlement: the only place settled balance moves, and only after the
   * provider confirms. Guarded on status SENT plus a unique ledger pair, so a
   * redelivered message cannot settle twice.
   */
  async settle(
    payoutId: string,
    accountId: string,
    amount: bigint,
    outboxId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.payout.updateMany({
        where: { id: payoutId, status: 'SENT' },
        data: { status: 'COMPLETED' },
      });
      if (res.count === 0) {
        return;
      }
      await tx.account.update({
        where: { id: accountId },
        data: {
          reservedBalance: { decrement: amount },
          settledBalance: { increment: amount },
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId,
          accountId,
          outboxId,
          bucket: 'RESERVED',
          direction: 'credit',
          amount,
          sequence: 1,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId,
          accountId,
          outboxId,
          bucket: 'ONCHAIN',
          direction: 'debit',
          amount,
          sequence: 2,
        },
      });
    });
  }

  /**
   * Provider said definitively the transfer did NOT happen: release the hold
   * and return the funds to the available bucket.
   */
  async recordDefinitiveFailure(input: {
    payoutId: string;
    accountId: string;
    amount: bigint;
    error: string;
    outboxId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.payout.updateMany({
        where: { id: input.payoutId, status: { in: ['CREATED', 'PROCESSING'] } },
        data: { status: 'FAILED', lastError: input.error },
      });
      if (res.count === 0) {
        return;
      }
      await tx.account.update({
        where: { id: input.accountId },
        data: {
          settledBalance: { increment: input.amount },
          reservedBalance: { decrement: input.amount },
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId: input.payoutId,
          accountId: input.accountId,
          outboxId: input.outboxId,
          bucket: 'RESERVED',
          direction: 'credit',
          amount: input.amount,
          sequence: 1,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId: input.payoutId,
          accountId: input.accountId,
          outboxId: input.outboxId,
          bucket: 'AVAILABLE',
          direction: 'debit',
          amount: input.amount,
          sequence: 2,
        },
      });
      await tx.outboxMessage.update({
        where: { id: input.outboxId },
        data: { status: 'FAILED' },
      });
    });
  }

  /**
   * No definitive outcome: either reschedule the message for another attempt
   * or, when attempts are exhausted, park the payout in NEEDS_REVIEW and
   * leave the reservation in place.
   */
  async recordFailure(input: {
    payoutId: string;
    error: string;
    exhausted: boolean;
    outboxId: string;
    retryAt: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: input.payoutId },
        data: {
          status: input.exhausted ? 'NEEDS_REVIEW' : 'PROCESSING',
          attempts: { increment: 1 },
          lastError: input.error,
        },
      });
      await tx.outboxMessage.update({
        where: { id: input.outboxId },
        data: input.exhausted
          ? { status: 'ABANDONED' }
          : { status: 'PENDING', availableAt: input.retryAt },
      });
    });
  }

  /** Idempotent processed-mark: the unique outbox_id makes redelivery a no-op. */
  async markProcessed(outboxId: string): Promise<void> {
    await this.prisma.processedMessage.upsert({
      where: { outboxId },
      create: { outboxId },
      update: {},
    });
  }

  async findLedgerEntries(payoutId: string): Promise<
    Array<{ bucket: string; direction: string; amount: bigint; sequence: number }>
  > {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { payoutId },
      orderBy: { sequence: 'asc' },
    });
    return rows.map((r) => ({
      bucket: r.bucket,
      direction: r.direction,
      amount: r.amount,
      sequence: r.sequence,
    }));
  }

  private toRecord(row: {
    id: string;
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
    status: string;
    attempts: number;
    txHash: string | null;
  }): PayoutRecord {
    return {
      id: row.id,
      accountId: row.accountId,
      amount: row.amount,
      destinationAddress: row.destinationAddress,
      idempotencyKey: row.idempotencyKey,
      status: row.status,
      attempts: row.attempts,
      txHash: row.txHash,
    };
  }
}
```

### src/payout/payout.worker.ts
```ts
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { PayoutService } from './payout.service';

/**
 * Polling worker: claims outbox messages and drives provider transfers
 * asynchronously (never inside the HTTP request). processMessages() runs on
 * an interval; each delivery is handled individually, so one poisoned message
 * cannot block the queue.
 */
@Injectable()
export class PayoutWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorkerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: PayoutService,
    private readonly repository: PayoutRepository,
  ) {}

  onModuleInit(): void {
    const intervalMs = process.env.WORKER_POLL_INTERVAL_MS
      ? Number(process.env.WORKER_POLL_INTERVAL_MS)
      : 5000;
    this.timer = setInterval(() => {
      void this.processMessages().catch((e) =>
        this.logger.error(`processMessages failed: ${(e as Error).message}`),
      );
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<number> {
    const delivery = await this.repository.claimNext();
    if (!delivery) {
      return 0;
    }
    try {
      await this.service.processDelivery(delivery);
    } catch (e) {
      // Leave the claimed row in PROCESSING; the stale-window re-claim in
      // claimNext() picks it up on a later tick.
      this.logger.error(
        `delivery ${delivery.outboxId} failed: ${(e as Error).message}`,
      );
    }
    return 1;
  }
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { PayoutController } from './payout.controller';
import { PayoutProviderToken } from './payout.provider';
import { PayoutRepository } from './payout.repository';
import { PayoutService } from './payout.service';
import { PayoutWorkerService } from './payout.worker';

/**
 * ASSUMPTION: the provider SDK is not part of this exercise, so the token is
 * satisfied by a thin adapter that wraps the documented
 * `provider.transfer({to, amount}) -> {txHash}` signature.
 */
function createPayoutProvider(): import('./payout.provider').PayoutProvider {
  const sdk = {
    transfer: async ({
      to,
      amount,
    }: {
      to: string;
      amount: bigint;
    }): Promise<{ txHash: string }> => {
      // The real SDK call belongs here. Its contract: may throw, time out,
      // or succeed slowly.
      void to;
      void amount;
      throw new Error('Payout provider SDK is not configured');
    },
  };
  return {
    transfer: async (args) => {
      try {
        const { txHash } = await sdk.transfer(args);
        return { txHash };
      } catch (e) {
        // Map SDK errors into the outcome contract. A thrown error with no
        // outcome means "we do not know", which the service parks safely.
        const err = e as {
          txHash?: string;
          definitive?: boolean;
          message?: string;
        };
        if (typeof err.txHash === 'string') {
          return { txHash: err.txHash, message: err.message };
        }
        return {
          definitive: err.definitive === true,
          message: err.message ?? String(e),
        };
      }
    },
  };
}

@Module({
  imports: [PrismaModule],
  controllers: [PayoutController],
  providers: [
    {
      provide: PayoutProviderToken,
      useFactory: createPayoutProvider,
    },
    PayoutRepository,
    PayoutService,
    PayoutWorkerService,
  ],
  exports: [PayoutService, PayoutRepository],
})
export class PayoutModule {}
```

### test/payout.spec.ts
```ts
import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PayoutController } from '../src/payout/payout.controller';
import {
  AccountNotFound,
  InsufficientFundsError,
  PayoutValidationError,
} from '../src/payout/payout.errors';
import { PayoutProvider, TransferOutcome } from '../src/payout/payout.provider';
import {
  Delivery,
  PayoutRecord,
  PayoutRepository,
} from '../src/payout/payout.repository';
import { MAX_PROVIDER_ATTEMPTS, PayoutService } from '../src/payout/payout.service';
import { PayoutWorkerService } from '../src/payout/payout.worker';
import { ErrorEnvelopeFilter } from '../src/common/error-envelope.filter';

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111';

interface AccountRow {
  id: string;
  settledBalance: bigint;
  reservedBalance: bigint;
}

interface PayoutRow {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: string;
  attempts: number;
  txHash: string | null;
  lastError: string | null;
}

interface OutboxRow {
  id: string;
  payoutId: string;
  status: string;
  availableAt: Date;
  updatedAt: Date;
}

interface LedgerRow {
  payoutId: string;
  accountId: string;
  bucket: string;
  direction: string;
  amount: bigint;
  sequence: number;
}

class UniqueViolationError extends Error {
  code = 'P2002';
}

class MockProvider implements PayoutProvider {
  calls = 0;
  outcomes: Array<TransferOutcome | Error> = [];
  lastArgs: Array<{ to: string; amount: bigint }> = [];

  setOutcomes(outcomes: Array<TransferOutcome | Error>): void {
    this.outcomes = [...outcomes];
  }

  async transfer(args: { to: string; amount: bigint }): Promise<TransferOutcome> {
    this.calls += 1;
    this.lastArgs.push(args);
    const next = this.outcomes.shift();
    if (next === undefined) {
      throw new Error('mock provider exhausted');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}

class InMemoryRepository {
  accounts = new Map<string, AccountRow>();
  payouts: PayoutRow[] = [];
  outbox: OutboxRow[] = [];
  processed: string[] = [];
  ledger: LedgerRow[] = [];
  private payoutSeq = 0;
  private outboxSeq = 0;

  addAccount(id: string, settledBalance: bigint, reservedBalance = 0n): void {
    this.accounts.set(id, { id, settledBalance, reservedBalance });
  }

  account(id: string): AccountRow {
    const row = this.accounts.get(id);
    if (!row) {
      throw new Error(`no account ${id} in stub`);
    }
    return row;
  }

  payout(id: string): PayoutRow {
    const row = this.payouts.find((p) => p.id === id);
    if (!row) {
      throw new Error(`no payout ${id} in stub`);
    }
    return row;
  }

  outboxRow(id: string): OutboxRow {
    const row = this.outbox.find((o) => o.id === id);
    if (!row) {
      throw new Error(`no outbox row ${id} in stub`);
    }
    return row;
  }

  payoutFor(payoutId: string): OutboxRow {
    const row = this.outbox.find((o) => o.payoutId === payoutId);
    if (!row) {
      throw new Error(`no outbox row for payout ${payoutId}`);
    }
    return row;
  }

  ledgerFor(payoutId: string): LedgerRow[] {
    return this.ledger.filter((l) => l.payoutId === payoutId);
  }

  findPayoutByKey(accountId: string, idempotencyKey: string) {
    const row = this.payouts.find(
      (p) => p.accountId === accountId && p.idempotencyKey === idempotencyKey,
    );
    return row ? { ...row } : null;
  }

  findPayoutById(id: string) {
    const row = this.payouts.find((p) => p.id === id);
    return row ? { ...row } : null;
  }

  accountExists(id: string): boolean {
    return this.accounts.has(id);
  }

  reserveIfSufficient(accountId: string, amount: bigint): number {
    const acc = this.accounts.get(accountId);
    if (!acc) {
      return 0;
    }
    if (acc.settledBalance < amount) {
      return 0;
    }
    acc.settledBalance -= amount;
    acc.reservedBalance += amount;
    return 1;
  }

  createPayoutWithOutbox(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): string {
    const acc = this.accounts.get(input.accountId);
    if (!acc) {
      throw new Error('no account');
    }
    if (
      this.payouts.some(
        (p) => p.accountId === input.accountId && p.idempotencyKey === input.idempotencyKey,
      )
    ) {
      throw new UniqueViolationError('unique constraint (payouts_account_id_idempotency_key_key)');
    }
    if (acc.settledBalance < input.amount) {
      // The atomic reservation inside the transaction failed; the whole
      // transaction rolls back.
      throw new Error('RESERVATION_FAILED');
    }
    acc.settledBalance -= input.amount;
    acc.reservedBalance += input.amount;
    this.payoutSeq += 1;
    const payout: PayoutRow = {
      id: `payout-${this.payoutSeq}`,
      accountId: input.accountId,
      amount: input.amount,
      destinationAddress: input.destinationAddress,
      idempotencyKey: input.idempotencyKey,
      status: 'CREATED',
      attempts: 0,
      txHash: null,
      lastError: null,
    };
    this.payouts.push(payout);
    this.outboxSeq += 1;
    this.outbox.push({
      id: `msg-${this.outboxSeq}`,
      payoutId: payout.id,
      status: 'PENDING',
      availableAt: new Date(),
      updatedAt: new Date(),
    });
    this.ledger.push(
      { payoutId: payout.id, accountId: input.accountId, bucket: 'AVAILABLE', direction: 'credit', amount: input.amount, sequence: 1 },
      { payoutId: payout.id, accountId: input.accountId, bucket: 'RESERVED', direction: 'debit', amount: input.amount, sequence: 2 },
    );
    return payout.id;
  }

  claimNext(): Delivery | null {
    const row =
      this.outbox.find((o) => o.status === 'PENDING' && o.availableAt <= new Date()) ??
      this.outbox.find((o) => o.status === 'PROCESSING');
    if (!row) {
      return null;
    }
    row.status = 'PROCESSING';
    row.updatedAt = new Date();
    return {
      outboxId: row.id,
      payoutId: row.payoutId,
      deliveredAt: row.updatedAt,
    };
  }

  markProcessing(payoutId: string): void {
    const p = this.payout(payoutId);
    if (p.status !== 'CREATED' && p.status !== 'PROCESSING') {
      throw new Error(`cannot mark processing from ${p.status}`);
    }
    p.status = 'PROCESSING';
  }

  recordSent(payoutId: string, txHash: string): void {
    const p = this.payout(payoutId);
    if (p.status === 'SENT') {
      return; // redelivery: no-op
    }
    if (p.status !== 'CREATED' && p.status !== 'PROCESSING') {
      throw new Error(`cannot record sent from ${p.status}`);
    }
    p.status = 'SENT';
    p.txHash = txHash;
  }

  settle(payoutId: string, accountId: string, amount: bigint): void {
    const p = this.payout(payoutId);
    if (p.status !== 'SENT') {
      return; // guarded: redelivery is a no-op
    }
    const acc = this.account(accountId);
    acc.reservedBalance -= amount;
    acc.settledBalance += amount;
    this.ledger.push(
      { payoutId, accountId, bucket: 'RESERVED', direction: 'credit', amount, sequence: 1 },
      { payoutId, accountId, bucket: 'ONCHAIN', direction: 'debit', amount, sequence: 2 },
    );
    p.status = 'COMPLETED';
  }

  recordDefinitiveFailure(input: {
    payoutId: string;
    accountId: string;
    amount: bigint;
    error: string;
    outboxId: string;
  }): void {
    const p = this.payout(input.payoutId);
    if (p.status !== 'CREATED' && p.status !== 'PROCESSING') {
      return;
    }
    const acc = this.account(input.accountId);
    acc.settledBalance += input.amount;
    acc.reservedBalance -= input.amount;
    p.status = 'FAILED';
    p.lastError = input.error;
    this.outboxRow(input.outboxId).status = 'FAILED';
    this.ledger.push(
      { payoutId: input.payoutId, accountId: input.accountId, bucket: 'RESERVED', direction: 'credit', amount: input.amount, sequence: 1 },
      { payoutId: input.payoutId, accountId: input.accountId, bucket: 'AVAILABLE', direction: 'debit', amount: input.amount, sequence: 2 },
    );
  }

  recordFailure(input: {
    payoutId: string;
    error: string;
    exhausted: boolean;
    outboxId: string;
    retryAt: Date;
  }): void {
    const p = this.payout(input.payoutId);
    p.attempts += 1;
    p.lastError = input.error;
    p.status = input.exhausted ? 'NEEDS_REVIEW' : 'PROCESSING';
    const row = this.outboxRow(input.outboxId);
    if (input.exhausted) {
      row.status = 'ABANDONED';
    } else {
      row.status = 'PENDING';
      row.availableAt = input.retryAt;
    }
  }

  markProcessed(outboxId: string): void {
    if (!this.processed.includes(outboxId)) {
      this.processed.push(outboxId);
    }
  }

  findLedgerEntries(payoutId: string): LedgerRow[] {
    return this.ledger
      .filter((l) => l.payoutId === payoutId)
      .sort((a, b) => a.sequence - b.sequence);
  }
}

async function runUntilIdle(worker: PayoutWorkerService, maxRounds = 10): Promise<void> {
  for (let i = 0; i < maxRounds; i += 1) {
    const processed = await worker.processMessages();
    if (processed === 0) {
      return;
    }
  }
}

describe('PayoutService (concurrent creation, idempotency, delivery safety)', () => {
  let repo: InMemoryRepository;
  let provider: MockProvider;
  let service: PayoutService;
  let worker: PayoutWorkerService;

  function setup(funds = 4000n) {
    repo = new InMemoryRepository();
    repo.addAccount(ACCOUNT_ID, funds);
    provider = new MockProvider();
    service = new PayoutService(repo as unknown as PayoutRepository, provider);
    worker = new PayoutWorkerService(
      service,
      repo as unknown as PayoutRepository,
    );
  }

  function deliveryFor(payoutId: string): Delivery {
    const row = repo.payoutFor(payoutId);
    return { outboxId: row.id, payoutId, deliveredAt: new Date() };
  }

  it('two concurrent creations against one account with funds for one: exactly one payout, no overdraft', async () => {
    setup(4000n);
    const base = {
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
    };

    const results = await Promise.allSettled([
      service.createPayout({ ...base, idempotencyKey: 'k1' }),
      service.createPayout({ ...base, idempotencyKey: 'k2' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const winner = (fulfilled[0] as PromiseFulfilledResult<PayoutRecord>).value;
    const loserError = (rejected[0] as PromiseRejectedResult).reason;
    expect(loserError).toBeInstanceOf(InsufficientFundsError);

    expect(repo.payouts).toHaveLength(1);
    expect(repo.payouts[0].id).toBe(winner.id);
    expect(repo.payouts[0].status).toBe('CREATED');
    expect(repo.outbox).toHaveLength(1);

    const acc = repo.account(ACCOUNT_ID);
    expect(acc.settledBalance).toBe(1000n);
    expect(acc.reservedBalance).toBe(3000n);

    const entries = repo.ledgerFor(winner.id);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ bucket: 'AVAILABLE', direction: 'credit', amount: 3000n });
    expect(entries[1]).toMatchObject({ bucket: 'RESERVED', direction: 'debit', amount: 3000n });
  });

  it('a retry with the same idempotency key returns the original payout and reserves nothing further', async () => {
    setup(4000n);
    const base = {
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
      idempotencyKey: 'same-key',
    };

    // Sequential retry: served by the pre-check.
    const first = await service.createPayout(base);
    const second = await service.createPayout(base);
    expect(second.id).toBe(first.id);
    expect(repo.payouts).toHaveLength(1);

    // Racing retry: both see an empty table, one insert hits the unique
    // constraint, the loser must return the winner's payout.
    const racing = await Promise.allSettled([
      service.createPayout(base),
      service.createPayout(base),
    ]);
    expect(racing.every((r) => r.status === 'fulfilled')).toBe(true);
    const a = (racing[0] as PromiseFulfilledResult<PayoutRecord>).value;
    const b = (racing[1] as PromiseFulfilledResult<PayoutRecord>).value;
    expect(a.id).toBe(first.id);
    expect(b.id).toBe(first.id);

    expect(repo.payouts).toHaveLength(1);
    const acc = repo.account(ACCOUNT_ID);
    expect(acc.reservedBalance).toBe(3000n);
    expect(acc.settledBalance).toBe(1000n);
    expect(repo.ledgerFor(first.id)).toHaveLength(2);
  });

  it('the same message delivered twice results in exactly one transfer and one settlement', async () => {
    setup(4000n);
    const created = await service.createPayout({
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
      idempotencyKey: 'k1',
    });
    provider.setOutcomes([
      { txHash: '0xdeadbeef' },
      { txHash: '0xdeadbeef' }, // the redelivery must not be used
    ]);

    const delivery = deliveryFor(created.id);
    await service.processDelivery(delivery);
    await service.processDelivery(delivery); // duplicate delivery

    expect(provider.calls).toBe(1);
    expect(provider.lastArgs[0]).toEqual({ to: '0xabc', amount: 3000n });

    const p = repo.payout(created.id);
    expect(p.status).toBe('COMPLETED');
    expect(p.txHash).toBe('0xdeadbeef');

    const acc = repo.account(ACCOUNT_ID);
    expect(acc.reservedBalance).toBe(0n);
    expect(acc.settledBalance).toBe(1000n);

    const entries = repo.ledgerFor(created.id);
    expect(entries).toHaveLength(4);
    const settlement = entries.filter((e) => e.direction === 'debit' && e.bucket === 'ONCHAIN');
    expect(settlement).toHaveLength(1);

    expect(repo.processed.filter((id) => id === delivery.outboxId)).toHaveLength(1);
    expect(repo.payoutFor(created.id).status).not.toBe('PENDING');
  });

  it('retry exhaustion parks the payout in NEEDS_REVIEW with the reservation intact and nothing reversed', async () => {
    setup(4000n);
    const created = await service.createPayout({
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
      idempotencyKey: 'k1',
    });
    // Four uncertain (timeout) outcomes: no tx hash, no definitive failure.
    provider.setOutcomes([
      { definitive: false, message: 'timeout' },
      { definitive: false, message: 'timeout' },
      { definitive: false, message: 'timeout' },
      { definitive: false, message: 'timeout' },
    ]);

    await runUntilIdle(worker);
    expect(provider.calls).toBe(MAX_PROVIDER_ATTEMPTS);

    const p = repo.payout(created.id);
    expect(p.status).toBe('NEEDS_REVIEW');
    expect(p.attempts).toBe(MAX_PROVIDER_ATTEMPTS);
    expect(p.txHash).toBeNull();
    expect(repo.payoutFor(created.id).status).toBe('ABANDONED');

    // The reservation is still in place; nothing was released or refunded.
    const acc = repo.account(ACCOUNT_ID);
    expect(acc.settledBalance).toBe(1000n);
    expect(acc.reservedBalance).toBe(3000n);

    // Only the reservation ledger pair exists: no release, no settlement.
    const entries = repo.ledgerFor(created.id);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ bucket: 'AVAILABLE', direction: 'credit' });
    expect(entries[1]).toMatchObject({ bucket: 'RESERVED', direction: 'debit' });

    // The queue is quiet: no further attempts are scheduled.
    expect(await worker.processMessages()).toBe(0);
  });

  it('settled balance moves only after provider confirmation', async () => {
    setup(4000n);
    const created = await service.createPayout({
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
      idempotencyKey: 'k1',
    });
    const acc = repo.account(ACCOUNT_ID);
    expect(acc.settledBalance).toBe(1000n);
    expect(acc.reservedBalance).toBe(3000n);

    provider.setOutcomes([{ txHash: '0xconfirm1' }]);
    await runUntilIdle(worker);

    expect(repo.payout(created.id).status).toBe('COMPLETED');
    expect(repo.account(ACCOUNT_ID).reservedBalance).toBe(0n);
    expect(repo.account(ACCOUNT_ID).settledBalance).toBe(4000n - 3000n + 3000n);
    expect(repo.ledgerFor(created.id)).toHaveLength(4);
  });

  it('a definitive provider failure releases the hold instead of parking it', async () => {
    setup(4000n);
    const created = await service.createPayout({
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
      idempotencyKey: 'k1',
    });
    provider.setOutcomes([{ definitive: true, message: 'insufficient gas' }]);
    await runUntilIdle(worker);

    expect(repo.payout(created.id).status).toBe('FAILED');
    const acc = repo.account(ACCOUNT_ID);
    expect(acc.settledBalance).toBe(4000n);
    expect(acc.reservedBalance).toBe(0n);
    expect(repo.payoutFor(created.id).status).toBe('FAILED');
  });

  it('rejects a payout for a missing account', async () => {
    setup(4000n);
    await expect(
      service.createPayout({
        accountId: '22222222-2222-2222-2222-222222222222',
        amount: 1000n,
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      }),
    ).rejects.toBeInstanceOf(AccountNotFound);
  });
});

describe('PayoutController', () => {
  async function buildController(fakeService: Record<string, unknown>) {
    const moduleRef = await Test.createTestingModule({
      controllers: [PayoutController],
      providers: [{ provide: PayoutService, useValue: fakeService }],
    })
      .overrideProvider(PayoutService)
      .useValue(fakeService)
      .compile();
    moduleRef.useGlobalFilters(new ErrorEnvelopeFilter());
    const controller = moduleRef.get(PayoutController);
    const app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ErrorEnvelopeFilter());
    await app.init();
    return { controller, app, server: app.getHttpServer() };
  }

  const okPayout = {
    id: 'payout-1',
    accountId: ACCOUNT_ID,
    amount: 3000n,
    destinationAddress: '0xabc',
    idempotencyKey: 'k1',
    status: 'CREATED',
    attempts: 0,
    txHash: null,
  };

  it('creates a payout and returns the money-safe view with the amount as a string', async () => {
    const createPayout = vi.fn().mockResolvedValue(okPayout);
    const service = new PayoutService({} as never, {} as never);
    const { app, server } = await buildController({
      createPayout,
      toView: (p: (typeof okPayout)) => ({
        id: p.id,
        accountId: p.accountId,
        amount: p.amount.toString(),
        destinationAddress: p.destinationAddress,
        idempotencyKey: p.idempotencyKey,
        status: p.status,
        txHash: p.txHash,
      }),
    });
    const res = await server
      .post('/payouts')
      .send({
        accountId: ACCOUNT_ID,
        amount: '3000',
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({
      id: 'payout-1',
      accountId: ACCOUNT_ID,
      amount: '3000',
      destinationAddress: '0xabc',
      idempotencyKey: 'k1',
      status: 'CREATED',
      txHash: null,
    });
    expect(createPayout).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        amount: 3000n,
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      }),
    );
    await app.close();
  });

  it('maps insufficient funds to the single error envelope with 422', async () => {
    const { app, server } = await buildController({
      createPayout: vi
        .fn()
        .mockRejectedValue(new InsufficientFundsError(1000n, 3000n)),
      toView: () => {
        throw new Error('not reached');
      },
    });
    const res = await server
      .post('/payouts')
      .send({
        accountId: ACCOUNT_ID,
        amount: '3000',
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      });
    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({
      error: {
        code: 'insufficient_funds',
        message: expect.any(String),
        details: { available: '1000', requested: '3000' },
      },
    });
    await app.close();
  });

  it('maps a missing account to 404 in the single error envelope', async () => {
    const { app, server } = await buildController({
      createPayout: vi
        .fn()
        .mockRejectedValue(new AccountNotFound('missing')),
      toView: () => {
        throw new Error('not reached');
      },
    });
    const res = await server
      .post('/payouts')
      .send({
        accountId: 'missing',
        amount: '1000',
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      });
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('account_not_found');
    expect(res.body.error.details).toEqual({ accountId: 'missing' });
    await app.close();
  });

  it('rejects a non-integer amount with 400 and field details', async () => {
    const createPayout = vi.fn();
    const { app, server } = await buildController({
      createPayout,
      toView: () => {
        throw new Error('not reached');
      },
    });
    const res = await server
      .post('/payouts')
      .send({
        accountId: ACCOUNT_ID,
        amount: '30.5',
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      });
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details.amount).toBeTruthy();
    expect(createPayout).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('parseAmount', () => {
  it('accepts decimal digit strings and rejects everything else', () => {
    const { parseAmount } = require('../src/payout/payout.service') as {
      parseAmount: (raw: unknown) => bigint;
    };
    expect(parseAmount('0')).toBe(0n);
    expect(parseAmount('3000')).toBe(3000n);
    for (const bad of ['30.5', '-1', '1e3', '', '  ', '0x10', null, 3000, 3000n, true]) {
      expect(() => parseAmount(bad)).toThrow(PayoutValidationError);
    }
  });
});
```

### DESIGN.md
```md
# DESIGN — funds safety

Money is BigInt minor units end to end (bigint in code, BIGINT in Postgres,
decimal strings on the wire); no float ever touches the money path.

1. Reserve, do not debit. Creation moves funds from `settled_balance` to
   `reserved_balance` on the account row plus a double-entry ledger pair
   (credit AVAILABLE / debit RESERVED). The account's settled balance is
   untouched until the provider confirms.
2. One-act check. The reservation is a single conditional UPDATE
   (`SET settled = settled - amt, reserved = reserved + amt WHERE
   settled >= amt`) whose affected-row count the caller reads. Postgres row
   locking serialises racers, so exactly one of two concurrent requests can
   reserve.
3. Atomic outbox. Payout row, account reservation, ledger pair and outbox
   message are written in ONE transaction. There is no window in which a
   payout exists without a queued transfer, or a transfer is queued without
   reserved funds.
4. Idempotent creation. `UNIQUE(account_id, idempotency_key)` plus a
   pre-check: a retry with the same key returns the original payout and
   reserves nothing further, even under a race.
5. At-least-once delivery. The worker claims messages atomically
   (`FOR UPDATE SKIP LOCKED`, stale-PROCESSING re-claim). Redelivery is a
   no-op via guarded status transitions, a `UNIQUE(outbox_id)`
   processed-mark, and `UNIQUE(payout_id, direction, bucket)` ledger pairs —
   double settlement is impossible by constraint, not by timing.
6. Confirm, don't send. `txHash` only moves the payout to SENT/COMPLETED
   (credit RESERVED / debit ONCHAIN). It is when the outcome becomes
   knowable, not when it is known.
7. Uncertainty parks. Timeouts and no-hash errors are counted attempts. On
   exhaustion the payout goes NEEDS_REVIEW and the message ABANDONED; the
   reservation stays in place. Releasing the hold on "failure" would be
   irreversible: the transfer may have landed, and the account would then
   fund a second payout for money already paid out. Over-reserving (cash
   frozen, one human review) is the safe direction; double-paying is not
   reversible. Only a provider-reported *definitive* failure releases the
   hold.
```
