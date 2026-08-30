# 03-payout.provider.ts

## reasoning

```
The user is asking to write exactly one file: `src/payout/payout.provider.ts`.

According to the plan, this file is:
- `PayoutProvider` interface with `transfer(to: string, amount: bigint): Promise<{ txHash: string }>`
- Throws on transient or permanent failure; the caller distinguishes by error shape (see §4).

From §3 of the plan:
```ts
export interface PayoutProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}
```

The plan states "throws on transient or permanent failure; the caller distinguishes by error shape (see §4)."

Hmm, how does the caller distinguish? In §4:
- "If the error is a **definitive failure** (e.g., invalid address, provider 4xx): call `failPayout`."
- "If the error is **ambiguous** (timeout, 5xx, network error): call `markNeeds_review`."

So the distinction is made by error shape. The plan says "the caller distinguishes by error shape (see §4)." But what is the error shape? The plan doesn't specify a concrete error class for the provider. Let me re-read.

§3:
```ts
export interface PayoutProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}
```
"Throws on transient or permanent failure; the caller distinguishes by error shape (see §4)."

§4 says: "If the error is a **definitive failure** (e.g., invalid address, provider 4xx): call `failPayout`. If the error is **ambiguous** (timeout, 5xx, network error): call `markNeedsReview`."

The plan doesn't define a specific error type for the provider. The only specified content of this file is "PayoutProvider interface with transfer(to, amount) -> Promise<{txHash}>".

The task says: "Implement exactly what the plan specifies for this file. Do not add exports, features, or files that the plan doesn't name."

So should I only write the interface? The manifest line says: "PayoutProvider interface with transfer(to, amount) -> Promise<{txHash}>".

But the plan's §3 comment says "throws on transient or permanent failure; the caller distinguishes by error shape (see §4)." This suggests there might be some way to distinguish. However, the plan doesn't specify an error class.

Hmm. The instruction says: "If a symbol you genuinely need is missing from both the plan and references, do not silently guess or reason around it: write the file using the most defensible reading and mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters."

So, is there an unresolved symbol? The question is whether I should include a ProviderError class or similar. The plan's §3 only shows the interface. The manifest says "PayoutProvider interface with transfer(to, amount) -> Promise<{txHash}>".

The most defensible reading: the file contains only the `PayoutProvider` interface as specified. The comment about error shape is a doc comment on the interface explaining behavior — I can include that as a JSDoc comment, which is part of "implementing exactly what the plan specifies" (the plan includes that comment).

Wait, but should I add an error class to help with the "distinguish by error shape"? The plan doesn't name such a class in this file. The manifest says this file is the "PayoutProvider interface with transfer(to, amount) -> Promise<{txHash}>". Adding an exported error class would be "adding exports the plan doesn't name."

Hmm, but without an error shape, how does the caller distinguish? The plan says "the caller distinguishes by error shape (see §4)". §4 mentions "timeout" vs "non-timeout error". In the tests: "the provider throws a non-timeout error on every attempt" vs "the provider throws a timeout error on every attempt".

So the shape is probably: the error has some property. But the plan doesn't specify it in this file. The most defensible reading is to keep the file minimal — just the interface with a doc comment explaining the throwing behavior. The service (a different file) will do the distinguishing.

Actually, let me think about what "error shape" could be. Common patterns:
1. An error with a `code` property (e.g., `error.code === 'TIMEOUT'`).
2. An error class like `ProviderTimeoutError`.

Since the plan doesn't specify, and the task says not to add exports the plan doesn't name, I should write just the interface. But the "distinguish by error shape" comment suggests there's a documented contract about what errors look like.

Hmm, this is tricky. Let me re-read the exact wording of the task:

"This file: PayoutProvider interface with transfer(to, amount) -> Promise<{txHash}>"

"Implement exactly what the plan specifies for this file. Do not add exports, features, or files that the plan doesn't name."

So this file = the interface. The plan's §3 specifies exactly:

```ts
export interface PayoutProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}
```

Plus the comment "throws on transient or permanent failure; the caller distinguishes by error shape (see §4)."

I think the safest, most plan-faithful output is:

```ts
/**
 * Blockchain provider SDK abstraction.
 *
 * `transfer` throws on transient or permanent failure; the caller
 * distinguishes by error shape (see §4 of PLAN.md): a timeout or other
 * ambiguous error means the transfer may have landed on-chain, while a
 * definitive error (e.g. invalid address) means it did not.
 */
export interface PayoutProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}
```

Wait — should I reference "§4 of PLAN.md"? The plan is a separate document; referencing it in code comments might be odd, but the plan itself uses that phrasing. Actually, the plan's comment is literally "throws on transient or permanent failure; the caller distinguishes by error shape (see §4)." I can adapt it to a JSDoc.

Now, the "error shape" issue: does the plan imply this file should define the error shape? Let me check the manifest again:

`src/payout/payout.provider.ts | reads: - | PayoutProvider interface with transfer(to, amount) -> Promise<{txHash}>`

"reads: -" means it doesn't read anything. The description is just the interface. So no error class in this file per the manifest.

But then, how does the service distinguish? That's the service file's problem — it can check something like `error.name === 'TimeoutError'` or a `code` property. Since I'm only writing this file, I don't need to solve that here. But the doc comment should probably mention the contract so future readers understand.

Hmm, but wait — is there a risk that the grader expects an error class? The instruction says: "If a symbol you genuinely need is missing from both the plan and references, do not silently guess or reason around it: write the file using the most defensible reading and mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters."

Do I "need" a symbol? The interface itself compiles without any error type. `Promise<{ txHash: string }>` — no problem. The throwing behavior is just a doc comment; TypeScript doesn't require an error type to be declared for throwing.

So no symbol is genuinely missing. The file can be written completely as just the interface.

Should I add an ASSUMPTION comment? The unresolved question is: what error shape does the provider throw, so the caller can distinguish definitive from ambiguous failure? The plan says "the caller distinguishes by error shape (see §4)" but doesn't define the shape in this file.

Options:
1. Write just the interface with a doc comment describing the throwing contract (timeout/ambiguous vs definitive). No ASSUMPTION comment needed since nothing is missing from the file itself.
2. Add an ASSUMPTION comment noting that the concrete error shape is left to the provider implementation/fake, and the caller distinguishes by e.g. `error.name`/message.

Hmm. The plan's §3 comment is the spec for this file: "throws on transient or permanent failure; the caller distinguishes by error shape (see §4)." I think the most defensible reading is to include that contract in the JSDoc. Whether to add an ASSUMPTION: the "error shape" is genuinely unspecified — the plan doesn't say what property indicates a timeout. But that's not something this file needs to define; it's something the service (another file) will handle.

Actually, wait. Let me think about whether the plan intends for this file to also export an error class or a type guard. Re-reading §4:

"**Failure**: record the attempt (`recordAttemptFailure`). ... If `attempts >= PAYOUT_MAX_ATTEMPTS`:
- If the error is a **definitive failure** (e.g., invalid address, provider 4xx): call `failPayout`.
- If the error is **ambiguous** (timeout, 5xx, network error): call `markNeedsReview`."

And §1: "If the provider throws a non-timeout error (definitive failure) the payout is `failed`; if it times out or throws ambiguously and attempts are exhausted, the payout is `needs-review`."

So the distinction: timeout → ambiguous → needs-review; non-timeout → definitive → failed. The simplest shape: the error is a timeout or not. In tests, "the provider throws a timeout error" — probably an `Error` with `name = 'TimeoutError'` or a message containing "timeout".

Since this file is just the interface, I'll document that `transfer` may throw, and that the caller treats timeout-like errors as ambiguous. Should I pin down the shape in a comment? The plan says "the caller distinguishes by error shape" — implying the shape exists and is known. But it's not defined anywhere.

Given the instruction about ASSUMPTION comments: "If a symbol you genuinely need is missing from both the plan and references... write the file using the most defensible reading and mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters."

I don't think I need a missing symbol to write this file. The interface is fully specified. The error shape is relevant to the service, not this file. So no ASSUMPTION comment is needed...

But hmm, one could argue the doc comment's reference to "error shape" is unresolved. To be safe and honest, I could add a brief ASSUMPTION comment noting that the concrete error shape (how a timeout is signaled) is not defined by the plan and is left to the provider implementation; the caller distinguishes based on it. Actually, that might be overkill. Let me weigh it.

The instruction says to mark with an ASSUMPTION comment "at the point where it matters" if a symbol is genuinely missing. No symbol is missing for this file. The file is self-contained: just the interface. I'll write clean JSDoc that faithfully reflects the plan's comment.

Actually, let me reconsider: should the doc comment mention "see §4"? Referencing PLAN.md §4 in production code is a bit unusual, but this is an eval context where the plan governs. I think it's better to paraphrase: describe the contract directly in the comment without referencing the plan document. The plan's comment itself says "(see §4)" but the actual content of §4 is: timeout/ambiguous vs definitive. I'll write a self-contained JSDoc.

Let me draft:

```ts
/**
 * Abstraction over the blockchain provider SDK used to execute stablecoin
 * transfers. Implementations may throw, time out, or succeed slowly; the
 * caller must treat a thrown error as either:
 *
 * - ambiguous (e.g. timeout, network failure): the transfer may have landed
 *   on-chain, so the funds must stay reserved for manual reconciliation; or
 * - definitive (e.g. invalid destination address): the transfer did not
 *   happen, so the reservation can be released.
 *
 * Amounts are in minor units (bigint); no floating point.
 */
export interface PayoutProvider {
  /**
   * Executes a transfer of `amount` minor units to `to`.
   * Resolves with the on-chain transaction hash on success.
   * Throws on transient or permanent failure; the caller distinguishes by
   * error shape (timeout-like errors are ambiguous, everything else is
   * definitive).
   */
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}
```

Hmm, wait. "The caller distinguishes by error shape (timeout-like errors are ambiguous, everything else is definitive)" — is that faithful to the plan? §4: "If the error is a definitive failure (e.g., invalid address, provider 4xx)... If the error is ambiguous (timeout, 5xx, network error)". Hmm, so per §4, 5xx and network errors are also ambiguous, not just timeouts. But §1 says "if the provider throws a non-timeout error (definitive failure) the payout is failed; if it times out or throws ambiguously...".

There's a slight tension between §1 and §4. §4 is more detailed: ambiguous = timeout, 5xx, network error; definitive = invalid address, 4xx. The service will implement the distinction per §4. For this file's doc comment, I should be careful not to over-specify the shape. The plan's own one-liner is: "throws on transient or permanent failure; the caller distinguishes by error shape (see §4)."

I'll keep the doc comment close to that: "throws on transient or permanent failure; the caller distinguishes by error shape." And I can briefly describe the two categories without pinning down the exact property.

Now, is there a risk that adding JSDoc comments counts as "adding features"? No — comments are fine; the plan's code block itself includes an explanatory comment. The convention says "code and comments in English" — fine.

Should the file have any other exports? No. Just `PayoutProvider`.

One more consideration: ESM, TypeScript strict. An interface-only file is fine. No imports needed.

Let me also double-check the signature: `transfer(to: string, amount: bigint): Promise<{ txHash: string }>` — exactly as in the plan.

Final file:

```ts
/**
 * Abstraction over the blockchain provider SDK that executes stablecoin
 * transfers. The real SDK is out of scope; tests inject a fake.
 *
 * `transfer` may throw, time out, or succeed slowly. It throws on transient
 * or permanent failure; the caller distinguishes by error shape (see the
 * control-flow rules): a timeout or other ambiguous failure means the
 * transfer may still have landed on-chain, while a definitive failure (e.g.
 * an invalid destination address) means it did not.
 *
 * Amounts are in minor units, carried as `bigint` — never floating point.
 */
export interface PayoutProvider {
  /**
   * Executes a transfer of `amount` minor units to the destination address
   * `to`. Resolves with the provider's transaction hash on success; throws
   * otherwise.
   */
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}
```

Hmm, "see the control-flow rules" — a bit vague. Maybe I should just say "the caller distinguishes by error shape" without the parenthetical, or briefly describe it. Let me simplify to stay faithful:

Actually, I realize I should think about whether to include an ASSUMPTION comment after all. The "error shape" is genuinely undefined in the plan — what property makes an error a timeout? For this file, that doesn't matter; the interface just throws `unknown`/`Error`. TypeScript's default is that a function can throw anything. So no symbol is missing. I'll skip the ASSUMPTION comment.

Wait, but let me reconsider once more. The eval instruction: "If a symbol you genuinely need is missing from both the plan and references, do not silently guess or reason around it." I don't need any missing symbol. The file is fully determined. Good.

Let me also make sure not to reference "PLAN.md" or "§4" in the code — that would be a weird dependency. I'll paraphrase self-containedly.

Final version:

```ts
/**
 * Abstraction over the blockchain provider SDK used to execute stablecoin
 * transfers. The concrete SDK is out of scope; implementations (including
 * test fakes) are injected.
 *
 * `transfer` may throw, time out, or succeed slowly. It throws on transient
 * or permanent failure; the caller distinguishes by error shape: an ambiguous
 * failure (e.g. a timeout) means the transfer may have landed on-chain and
 * the funds must stay reserved, while a definitive failure (e.g. an invalid
 * destination address) means it did not.
 *
 * Amounts are in minor units, carried as `bigint` — never floating point.
 */
export interface PayoutProvider {
  /**
   * Executes a transfer of `amount` minor units to the destination address
   * `to`. Resolves with the provider's transaction hash on success and
   * throws otherwise.
   */
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}
```

This is complete, first line to last, no fragments. One fenced block, nothing else.
```

## reply

```ts
/**
 * Abstraction over the blockchain provider SDK used to execute stablecoin
 * transfers. The concrete SDK is out of scope; implementations (including
 * test fakes) are injected.
 *
 * `transfer` may throw, time out, or succeed slowly. It throws on transient
 * or permanent failure; the caller distinguishes by error shape: an ambiguous
 * failure (e.g. a timeout) means the transfer may have landed on-chain and
 * the funds must stay reserved, while a definitive failure (e.g. an invalid
 * destination address) means it did not.
 *
 * Amounts are in minor units, carried as `bigint` — never floating point.
 */
export interface PayoutProvider {
  /**
   * Executes a transfer of `amount` minor units to the destination address
   * `to`. Resolves with the provider's transaction hash on success and
   * throws otherwise.
   */
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}
```
