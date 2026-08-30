# 06-payout.worker.ts

## reasoning

```
Let me carefully analyze the plan regarding the worker file.

From the plan (§3):

```ts
@Injectable()
export class PayoutWorker {
  constructor(service: PayoutService, repo: PayoutRepository);

  // Single poll cycle: fetch pending messages, claim each, call service.processMessage.
  processMessages(): Promise<void>;

  // Starts the interval timer (called by module onModuleInit).
  start(intervalMs: number): void;

  // Stops the timer (called by module onModuleDestroy).
  stop(): void;
}
```

So the worker:
- Injects `PayoutService` and `PayoutRepository`.
- `processMessages()`: fetch pending messages (via `repo.findPendingMessages(limit)`), claim each (`repo.claimMessage(id)`) — wait, actually the plan says "fetch pending messages, claim each, call service.processMessage."

Hmm, but looking at the service's `processMessage(messageId)` — it itself handles claim: "if status is not PROCESSING, claim (step 2 above). If claim returns null, return." So `processMessage` already claims. But the worker plan says "single poll cycle: fetch pending messages, claim each, call service.processMessage."

There's a slight redundancy. Let me think about what's most defensible: the worker fetches pending messages and calls `service.processMessage(message.id)` for each. The service's `processMessage` handles the claim logic (it checks message status and claims if PENDING). But the plan's worker comment says "fetch pending messages, claim each, call service.processMessage."

Option A: worker calls `repo.findPendingMessages(limit)`, then for each message calls `service.processMessage(m.id)`. The service does the claim. This is simplest and consistent with the service signature `processMessage(messageId: string)`.

Option B: worker claims each message via `repo.claimMessage(m.id)`, and if claim succeeds, calls `service.processMessage(m.id)`. But then the service's processMessage would find the message in PROCESSING state and use `claimed = message` — that works with the service implementation shown (the reference service handles both PENDING and PROCESSING cases).

Actually looking at the reference service implementation: `processMessage` loads message by id; if DONE/DEAD return; if PENDING claim (return if null); else if PROCESSING use it. So both options work with the service.

The plan's worker description: "single poll cycle: fetch pending messages, claim each, call service.processMessage." This suggests the worker does the claiming. But wait — if the worker claims and then calls processMessage, processMessage will see PROCESSING and proceed. That's fine.

But there's a subtlety: if the worker claims and then `processMessage` fails / throws, the message stays PROCESSING. Hmm.

Which is more defensible? The plan explicitly says the worker "claims each." But the service's `processMessage` is also designed to claim. The reference implementation of the service handles both.

Let me re-read the plan's control flow for `processMessage`:
1. Load message by id. If DONE or DEAD, return.
2. If status is not PROCESSING, claim it. If claim returns null, return.
3. ...

So `processMessage` is self-contained: it claims if needed. The worker just needs to fetch pending messages and call `processMessage` for each. The comment "fetch pending messages, claim each, call service.processMessage" is a loose description of the overall effect (the claiming happens inside processMessage, or by the worker).

Given that the service's `processMessage` already handles claiming and is the layer that holds logic (layers: controller validates, service holds logic, repository touches DB), the worker should be thin: fetch pending ids and delegate to service. The worker calling `repo.claimMessage` directly would duplicate claim logic. But the plan says the worker constructor takes both service and repo — so the worker does use the repo for `findPendingMessages`.

I think the cleanest reading consistent with both the plan and layers is:

```ts
async processMessages(): Promise<void> {
  const messages = await this.repo.findPendingMessages(this.batchSize);
  for (const message of messages) {
    await this.service.processMessage(message.id);
  }
}
```

Should the worker also claim? The plan says "claim each." Hmm. If I add `const claimed = await this.repo.claimMessage(message.id); if (claimed) await this.service.processMessage(message.id);` — that matches the plan's wording literally. And the service handles PROCESSING state fine (uses message as claimed).

But wait — there's a problem: `processMessage` in the reference service, when status is PROCESSING, sets `claimed = message` and proceeds. So double-claiming isn't an issue; the second claim returns null (since status is no longer PENDING) but we only call processMessage if claim succeeded.

Actually, let me reconsider: which is better for the "duplicate message delivery" test? The test calls `processMessage` twice directly on the service, not through the worker. So worker behavior doesn't affect that test.

The "worker polls and processes" test: seed a PENDING message, call `processMessages()`, payout transitions to COMPLETED and message to DONE. Both options satisfy this:
- Option A: findPendingMessages returns the PENDING message; processMessage claims it, processes, completes.
- Option B: findPendingMessages returns it; worker claims (PENDING→PROCESSING); processMessage sees PROCESSING, proceeds, completes.

Both work. The plan's literal wording says the worker claims each. But the service is described as handling claim in its own flow ("2. If status is not PROCESSING, claim it (step 2 above).").

Hmm, there's tension. Let me look at the plan's worker comment again: "single poll cycle: fetch pending messages, claim each, call service.processMessage."

I'll go with the literal plan: worker fetches pending messages, claims each, and if claimed, calls service.processMessage. This matches the plan exactly and is safe (claim is idempotent-ish: returns null if not PENDING).

Wait, but there's a subtle issue with Option B and the service: after the worker claims, `claimed.attempts` in the service comes from `findMessageById` which re-reads — fine.

Actually, hold on. Let me reconsider whether the worker should claim at all. The layer discipline: "service holds logic." Claiming is definitely business logic (at-least-once semantics, retry counting). But the plan explicitly assigns `claimMessage` to the repository and has the worker's constructor take the repo. The plan's worker comment says it claims. I'll follow the plan literally — the plan governs.

Hmm, but actually, let me reconsider once more. If the worker claims and then calls processMessage, and processMessage internally would have claimed anyway… the net effect is the same. The only difference: in Option B, if claim fails (concurrent worker grabbed it), we skip processMessage entirely — good. In Option A, processMessage handles that internally.

Either is defensible; the plan's wording favors B. Let me go with B but keep it simple.

Now `start(intervalMs)` and `stop()`:

```ts
start(intervalMs: number): void {
  if (this.timer) return; // avoid double-start
  this.timer = setInterval(() => {
    void this.processMessages().catch(...)
  }, intervalMs);
}

stop(): void {
  if (this.timer) {
    clearInterval(this.timer);
    this.timer = null;
  }
}
```

Considerations:
- The interval callback should not reject unhandled. `processMessages()` returns a Promise; in the setInterval callback we should catch errors to avoid unhandled rejections crashing the process. The plan doesn't specify error handling for poll cycles, but a safe worker should catch and log. Is logging allowed? The plan doesn't mention a logger. Using NestJS's `Logger` is standard and not an "added feature" per se — it's part of a defensible worker. Hmm, but "don't add exports, features, or files the plan doesn't name." A Logger is a feature? I'd argue minimal error containment is necessary for a polling worker (an unhandled rejection in setInterval would crash Node). I'll use NestJS `Logger` for a single error log. That's defensible and minimal. Actually, let me think — is it safer to just swallow with `.catch(() => {})`? Silently swallowing is bad practice. Logging via NestJS Logger is idiomatic. I'll include it.

- Should the timer be unref'd? `this.timer.unref()` would allow the process to exit without the worker. In tests, if the module starts the worker, an active interval would keep the test process alive. The plan says `start` is called by module's onModuleInit and `stop` by onModuleDestroy. In Nest tests, module destroy calls stop. But for safety in a polling worker, `unref()` is a common defensible choice. Hmm — but it changes behavior (process could exit mid-work). For a payout worker, you'd generally want the process to stay alive… but in this app, the API server keeps it alive anyway. `unref()` is defensible for test hygiene. The plan doesn't mention it. I'll add `unref()` with an ASSUMPTION comment? The instructions say: "If a symbol you need is genuinely missing from both the plan and references, don't guess silently… write the file using the most defensible reading and mark it with a single `// ASSUMPTION:` comment."

`unref` is not a missing symbol — it's a behavior choice. The rule about ASSUMPTION comments is for missing symbols. Adding unref is a judgment call; I can include it without an ASSUMPTION mark since it's not a missing symbol. But is it "adding a feature the plan doesn't name"? It's borderline. Let me keep it minimal: no unref? If tests start the worker and don't stop it, vitest will hang… but the plan's tests call `processMessages()` directly (test: "seed a PENDING message, call `processMessages()`, …") — they don't necessarily call start/stop. The module wiring (onModuleInit) is in the module file, not this file. So start/stop correctness only matters if the module calls them.

I'll keep `start`/`stop` simple: guard against double-start, store the timer, clear on stop. I'll add `unref()` — hmm. Let me decide: I'll include it because a polling worker that prevents process shutdown is a real footgun, and NestJS apps often unref background timers. Actually no — let me not overthink. The plan is the spec; it says "start interval timer (called by module onModuleInit)" and "stop timer (called by module onModuleDestroy)." Minimal faithful implementation: setInterval, clearInterval. I'll skip unref to avoid adding unspecified behavior. Hmm, but actually many would argue… no. Discipline: "do exactly what the task asks." Skip unref.

Wait, one more consideration on `start`: should it run a poll immediately (e.g., setTimeout first, or call processMessages immediately)? The plan says "start interval timer." Just setInterval. Keep it simple.

Now, the batch limit for `findPendingMessages(limit)`. The plan's repository has `findPendingMessages(limit: number)`. The worker needs to pass a limit. What value? The plan doesn't specify a config for batch size. Options: hardcode (e.g., 10), or read from env. The plan's assumptions say "poll interval and max retries are env-configured: `PAYOUT_WORKER_INTERVAL_MS` (default 1000) and `PAYOUT_MAX_ATTEMPTS` (default 3)." No env var for batch size. So the worker needs a limit constant. I'll use a private constant, e.g., `private static readonly BATCH_SIZE = 10;` or just pass a literal. Hmm — "don't add features" — a batch size constant is necessary to call the repo method. I'll define it as a private readonly property or a module-level constant. Minimal: `const POLL_BATCH_SIZE = 10;` at the top of the file? Or inline. Let me make it a private field on the class or just pass `10` with a comment. A named constant is cleaner. It's not an export, so it doesn't violate "don't add exports."

Where does `start` get its intervalMs from? The signature is `start(intervalMs: number)` — the module passes it (presumably reading env). So the worker doesn't read env itself. Good — that keeps env config in the module (which is not my file).

Now imports:
- `Injectable` from '@nestjs/common'.
- `PayoutService` from './payout.service'.
- `PayoutRepository` from './payout.repository'.

Do I need the Logger? If I catch errors in the interval callback, I need somewhere to put them. Options: `console.error` (not idiomatic in Nest) or `Logger`. I'll use `Logger` from '@nestjs/common' — it's standard NestJS and not a "new feature." I think this is defensible: a worker that swallows poll errors silently is worse. Actually, hmm, let me reconsider: do I even need to catch? If `processMessages()` rejects inside the setInterval callback, it becomes an unhandled promise rejection → in Node 20, that crashes the process (unhandled rejections are fatal by default since Node 15). A single transient DB hiccup would kill the whole API. So catching is essential for a safe worker. I'll catch and log via NestJS Logger.

Let me also think about whether `processMessages` should be resilient to individual message failures: if processing message 1 throws, should we continue with message 2? For a worker, yes — wrap each in try/catch so one bad message doesn't block the queue. But the service's `processMessage` — does it throw? Looking at the reference service: it catches provider errors internally; repo calls could throw (DB errors). If `processMessage` throws, the message stays PROCESSING (claimed) — hmm, that's a stuck message. The plan mentions in §4: "if the provider call succeeded but crashed before status update, results in at-least-once redelivery" — wait, that's about claim before provider call. The plan also mentions "re-claim after timeout/reclaim" for PROCESSING messages. But there's no explicit reclaim mechanism in the repo signatures (no `findStuckMessages` or reset). So stuck PROCESSING messages are… a known gap, but not something my worker file should solve beyond what the plan says.

Should the worker wrap each `processMessage` call in try/catch to continue the loop? That's defensible worker behavior. I'll do it: for each message, try to claim + process; catch and log, continue. This keeps the poll cycle alive.

Hmm wait, but if I claim in the worker and then processMessage throws midway (e.g., DB error on markProcessing), the message is PROCESSING and won't be re-claimed (claimMessage only claims PENDING). The message is stuck. Without a reclaim mechanism in the plan, this is unavoidable. Not my problem to solve beyond the plan.

Actually — wait. Let me reconsider Option A vs B once more, because it affects this stuck scenario:

Option A (worker doesn't claim; service claims): same stuck scenario if DB fails after claim.

Either way, same. OK.

Now, let me also double-check the service's `processMessage` signature: `processMessage(messageId: string): Promise<void>`. Yes.

And repo: `findPendingMessages(limit: number): Promise<MessageRow[]>`, `claimMessage(messageId: string): Promise<MessageRow | null>`. Yes.

Let me now write the file:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';

const POLL_BATCH_SIZE = 10;

@Injectable()
export class PayoutWorker {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: PayoutService,
    private readonly repo: PayoutRepository,
  ) {}

  /**
   * Single poll cycle: fetch pending messages, claim each, and hand the
   * claimed ones to the service. One failing message must not block the rest.
   */
  async processMessages(): Promise<void> {
    const messages = await this.repo.findPendingMessages(POLL_BATCH_SIZE);

    for (const message of messages) {
      try {
        const claimed = await this.repo.claimMessage(message.id);
        if (claimed === null) {
          // Another worker claimed it first; skip.
          continue;
        }
        await this.service.processMessage(claimed.id);
      } catch (err) {
        this.logger.error(
          `Failed to process payout message ${message.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Starts the polling interval. Called by the module on init.
   */
  start(intervalMs: number): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      this.processMessages().catch((err) => {
        this.logger.error(`Payout poll cycle failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, intervalMs);
  }

  /**
   * Stops the polling interval. Called by the module on destroy.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
```

Wait — one issue: in the worker I claim, then call `processMessage(claimed.id)`. Inside the service, `processMessage` loads the message (now PROCESSING), skips the DONE/DEAD check, goes to `else if (message.status === 'PROCESSING') { claimed = message; }` and proceeds. Good, consistent with the reference service implementation.

But hold on — is it OK for the worker to call `repo.claimMessage` directly? Layer discipline: "repository is the only layer that touches the database" — the worker calling the repository is fine (the plan's constructor takes repo). "Service holds logic" — claiming is arguably service logic, but the plan explicitly describes the worker as claiming. The plan governs. OK.

Hmm, actually let me reconsider once more whether to claim in the worker or just delegate. The plan's §3 worker comment: "single poll cycle: fetch pending messages, claim each, call service.processMessage." That's unambiguous: the worker claims each. I'll keep the claim in the worker.

But then, is the service's internal claim path dead code for the worker-driven flow? No — it's used by the duplicate-delivery test (calling processMessage directly on a PENDING message) and for safety. Fine.

Now, the `NodeJS.Timeout` type — in Node 20 with TS, `setInterval` returns `NodeJS.Timeout`. That's a global type available without import (needs @types/node, which is standard in a Node project). Fine.

Should `start` guard against double start? The plan doesn't say, but it's a one-line safety that prevents duplicate timers if the module init runs twice. Is that "adding a feature"? It's defensive and minimal. I'll keep it — it's part of correct timer management, not a feature.

Batch size: I need to pick something. 10 is reasonable and arbitrary. The plan doesn't specify. Is this a "missing symbol" requiring an ASSUMPTION comment? The repo method requires a limit argument; the plan doesn't give one. I'm choosing 10 as a defensible default. The instructions say to mark with ASSUMPTION when "a symbol you need is genuinely missing from both the plan and references." POLL_BATCH_SIZE isn't really a symbol from the plan; it's a parameter value. I think a brief comment noting the choice is enough, but to be safe and transparent, I could add: `// ASSUMPTION: the plan does not specify a poll batch size; 10 per cycle.` Hmm, the instructions say "mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point it matters." This is a judgment call — the batch limit value is genuinely unspecified. I'll include one ASSUMPTION comment there. Actually wait — is it "genuinely missing"? The plan says `findPendingMessages(limit: number)` and the worker calls it. The value of limit is not specified anywhere. So yes, it's unresolved. One ASSUMPTION comment at the constant definition. That follows the instructions precisely.

Let me also double-check: does the plan name any other members for the worker? "PayoutWorker: processMessages, start, stop; interval timer for polling." So three public methods + internal timer. My file has exactly those plus a private logger and the constant. The logger — is that OK? It's needed for error containment in the timer callback. I think it's defensible; without it, errors would be silently swallowed or crash the process. NestJS Logger is idiomatic. I'll keep it.

Alternative: don't use Logger, just `.catch(() => undefined)`? No — silent swallowing is bad. Keep Logger.

One more check on imports: `Logger` from '@nestjs/common' — yes, exported there.

ESM, type module — no import extensions needed for TS source (Nest handles it). The reference files use extensionless relative imports (`'./payout.repository'`). I'll match that.

Naming: file `src/payout/payout.worker.ts`, class `PayoutWorker`. Matches plan.

Let me also consider: should `processMessages` be safe to call concurrently (e.g., a poll cycle overlaps with the previous one)? The plan doesn't address it; claimMessage's SKIP LOCKED / status flip handles cross-worker safety. Overlapping cycles within one process: findPendingMessages returns PENDING; by the time we claim, it may be PROCESSING → claim returns null → skip. Safe enough. No extra guard needed.

Should I add a `running` flag to prevent overlapping cycles? Not in the plan. Skip — keep discipline.

Final check on the for-loop: `for (const message of messages)` with await inside — sequential processing. Fine for a simple worker; the plan doesn't ask for concurrency.

Let me also reconsider the error message format in catch — keep it simple.

Also, `claimed.id` vs `message.id` — same thing; I'll use `message.id` for clarity since claimed is the same row. Either works. I'll pass `message.id`.

Let me write the final file:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';

// ASSUMPTION: the plan does not specify a poll batch size; 10 messages per cycle.
const POLL_BATCH_SIZE = 10;

@Injectable()
export class PayoutWorker {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: PayoutService,
    private readonly repo: PayoutRepository,
  ) {}

  /**
   * Single poll cycle: fetch pending messages, claim each, and hand the
   * claimed ones to the service. A failure on one message must not stop the
   * rest of the cycle.
   */
  async processMessages(): Promise<void> {
    const messages = await this.repo.findPendingMessages(POLL_BATCH_SIZE);

    for (const message of messages) {
      try {
        const claimed = await this.repo.claimMessage(message.id);
        if (claimed === null) {
          // Already claimed by a concurrent worker; nothing to do.
          continue;
        }
        await this.service.processMessage(message.id);
      } catch (err) {
        this.logger.error(
          `Failed to process payout message ${message.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Starts the polling interval. Called by the module on init.
   */
  start(intervalMs: number): void {
    if (this.timer !== null) {
      return;
    }

    this.timer = setInterval(() => {
      this.processMessages().catch((err) => {
        this.logger.error(
          `Payout poll cycle failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, intervalMs);
  }

  /**
   * Stops the polling interval. Called by the module on destroy.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
```

That's complete, first line to last. Only one fenced block in the reply, nothing else.

Let me double-check against constraints:
- No added exports: only `PayoutWorker` is exported (as the plan names). The constant is module-private. ✓
- No added files/features: logger and batch constant are internal necessities. ✓
- Uses plan's signatures exactly: `processMessages(): Promise<void>`, `start(intervalMs: number): void`, `stop(): void`. ✓
- Constructor takes service and repo per plan. ✓
- ESM/TS strict: all typed; `NodeJS.Timeout` is available via @types/node (standard in this stack). ✓

I'm confident. Reply with just the fenced block.
```

## reply

```ts
import { Injectable, Logger } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';

// ASSUMPTION: the plan does not specify a poll batch size; 10 messages per cycle.
const POLL_BATCH_SIZE = 10;

@Injectable()
export class PayoutWorker {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: PayoutService,
    private readonly repo: PayoutRepository,
  ) {}

  /**
   * Single poll cycle: fetch pending messages, claim each, and hand the
   * claimed ones to the service. A failure on one message must not stop the
   * rest of the cycle.
   */
  async processMessages(): Promise<void> {
    const messages = await this.repo.findPendingMessages(POLL_BATCH_SIZE);

    for (const message of messages) {
      try {
        const claimed = await this.repo.claimMessage(message.id);
        if (claimed === null) {
          // Already claimed by a concurrent worker; nothing to do.
          continue;
        }
        await this.service.processMessage(message.id);
      } catch (err) {
        this.logger.error(
          `Failed to process payout message ${message.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Starts the polling interval. Called by the module on init.
   */
  start(intervalMs: number): void {
    if (this.timer !== null) {
      return;
    }

    this.timer = setInterval(() => {
      this.processMessages().catch((err) => {
        this.logger.error(
          `Payout poll cycle failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, intervalMs);
  }

  /**
   * Stops the polling interval. Called by the module on destroy.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
```
