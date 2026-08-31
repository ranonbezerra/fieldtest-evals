# repair1-chain.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/anchor/chain.ts`:

From the error list:
```
src/anchor/chain.ts(1,43): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './canonical.js'?
```

That's the only error that directly references `src/anchor/chain.ts`. The other errors reference other files (anchor.module.ts, anchor.repository.ts, anchor.service.ts, test files).

Wait, but the task says "Rewrite `src/anchor/chain.ts` complete, fixing what these messages require of this file." So I need to fix the errors that are in `chain.ts`. The only error in chain.ts is:

```
src/anchor/chain.ts(1,43): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './canonical.js'?
```

So line 1, column 43 of chain.ts has a relative import that needs an explicit `.js` extension. The suggestion is `./canonical.js`.

Now, I need to reconstruct the full `chain.ts` file based on the PLAN.md. The plan says:

`src/anchor/chain.ts`
- `interface TxIdentity { txId: string; signedTx: string }`
- `interface Receipt { found: boolean; txId: string; blockNumber: number | null }`
- `interface ChainClient { prepare(tx: AnchorTx): TxIdentity; broadcast(signedTx: string): Promise<void>; getReceipt(txId: string): Promise<Receipt> }`
  - `broadcast` may reject with a timeout of unknown outcome.
- `interface AnchorTx { documentId: string; version: number; contentHash: string }` — the deterministic input to `prepare`.
- `class FakeChainClient implements ChainClient` — constructor takes an optional config object `{ broadcastFails?: boolean; receipts: Record<string, Receipt> }`; `prepare` derives `txId` deterministically from the input; `broadcast` rejects when `broadcastFails`; `getReceipt` returns configured receipts.

Wait, but the manifest says:
```
src/anchor/chain.ts | reads: src/anchor/canonical.ts | ChainClient interface, TxIdentity, Receipt, AnchorTx, FakeChainClient
```

So `chain.ts` reads from `canonical.ts`. That means chain.ts imports something from canonical.ts. Why would chain.ts need canonical.ts? Probably for the FakeChainClient's `prepare` method to derive a deterministic `txId` from the input — it might hash the AnchorTx using `hashContent` from canonical.ts.

So line 1 of chain.ts is:
```typescript
import { hashContent } from './canonical';
```

And the fix is to change it to:
```typescript
import { hashContent } from './canonical.js';
```

Now, the other errors are in other files and I should NOT fix them (the task says "Change nothing the messages do not name" — well, it says rewrite chain.ts fixing what these messages require of THIS file). So I only need to fix the import in chain.ts.

But wait — I need to be careful. The task says "Rewrite `src/anchor/chain.ts` complete". So I need to produce the complete file. I need to reconstruct it faithfully from the plan.

Let me think about what chain.ts should contain:

1. Import from canonical.js (with the .js extension)
2. `interface TxIdentity { txId: string; signedTx: string }`
3. `interface Receipt { found: boolean; txId: string; blockNumber: number | null }`
4. `interface AnchorTx { documentId: string; version: number; contentHash: string }`
5. `interface ChainClient { prepare(tx: AnchorTx): TxIdentity; broadcast(signedTx: string): Promise<void>; getReceipt(txId: string): Promise<Receipt> }`
6. `class FakeChainClient implements ChainClient`

Now, the FakeChainClient:
- constructor takes an optional config object `{ broadcastFails?: boolean; receipts: Record<string, Receipt> }`
- `prepare` derives `txId` deterministically from the input
- `broadcast` rejects when `broadcastFails`
- `getReceipt` returns configured receipts

Let me think about the deterministic txId derivation. Since chain.ts reads from canonical.ts, and the manifest confirms this dependency, the `prepare` method likely uses `hashContent` to derive the txId.

Let me write it:

```typescript
import { hashContent } from './canonical.js';

export interface TxIdentity {
  txId: string;
  signedTx: string;
}

export interface Receipt {
  found: boolean;
  txId: string;
  blockNumber: number | null;
}

export interface AnchorTx {
  documentId: string;
  version: number;
  contentHash: string;
}

export interface ChainClient {
  prepare(tx: AnchorTx): TxIdentity;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<Receipt>;
}

export interface FakeChainClientConfig {
  broadcastFails?: boolean;
  receipts: Record<string, Receipt>;
}

export class FakeChainClient implements ChainClient {
  private readonly config: FakeChainClientConfig;

  constructor(config?: FakeChainClientConfig) {
    this.config = config ?? { receipts: {} };
  }

  prepare(tx: AnchorTx): TxIdentity {
    const txId = hashContent(tx);
    const signedTx = `signed:${txId}`;
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    if (this.config.broadcastFails) {
      throw new Error('broadcast timed out with unknown outcome');
    }
  }

  async getReceipt(txId: string): Promise<Receipt> {
    const receipt = this.config.receipts[txId];
    if (receipt) {
      return receipt;
    }
    return { found: false, txId, blockNumber: null };
  }
}
```

Wait, but I need to be careful about the `signedTx` derivation. The plan says `prepare` derives `txId` deterministically from the input. It doesn't specify how signedTx is derived. Let me keep it simple and deterministic.

Actually, let me reconsider. The plan says the config is `{ broadcastFails?: boolean; receipts: Record<string, Receipt> }`. The `receipts` field is not optional in the config object type shown. But the constructor takes an *optional* config object. So if no config is provided, we need defaults.

Hmm, let me re-read: "constructor takes an optional config object `{ broadcastFails?: boolean; receipts: Record<string, Receipt> }`". So the config object itself is optional (the whole thing), but within it, `broadcastFails` is optional and `receipts` is required (if the config is provided). 

Actually, to be safe and flexible, let me make both optional in the config type. But the plan explicitly shows `receipts: Record<string, Receipt>` without a `?`. Let me follow the plan exactly. So the config type is:
```typescript
{ broadcastFails?: boolean; receipts: Record<string, Receipt> }
```

But then if the constructor is called with no config, we need a default. Let me handle that:
```typescript
constructor(config?: { broadcastFails?: boolean; receipts: Record<string, Receipt> }) {
  this.config = config ?? { receipts: {} };
}
```

That works.

Now, let me think about whether the `getReceipt` should return the receipt as-is or construct a new one. The test at line 159-160 references `state` and `txId` on a type that's `never`, but those are in the test file, not chain.ts. So I don't need to worry about them for chain.ts.

Let me reconsider the deterministic txId. The plan says "`prepare` derives `txId` deterministically from the input". Using `hashContent(tx)` where tx is the AnchorTx object would work and would be deterministic. This also justifies the import from canonical.js.

Actually wait — is `hashContent` the right function to import? Let me check the canonical.ts exports from the plan:
- `canonicalize(value: unknown): string`
- `hashContent(value: unknown): string`
- `class CanonicalizationError extends Error`

So `hashContent` is the right one to use for deriving a deterministic txId.

Now let me think about the `signedTx`. The plan doesn't specify how it's derived, but it should be deterministic too (since the whole point is that recovery can re-prepare to get the same txId and signedTx). Let me make it deterministic. Something like `signed:${txId}` or just a derived value. Actually, for the recovery to re-broadcast, it needs the signedTx. But wait — the plan says on restart "the signed tx is lost, so recovery must re-`prepare` (deterministic) to obtain the same `txId`, then query the chain by that `txId`." And in recovery step 3: "If not found: the broadcast likely never landed — re-`broadcast` the recovered `signedTx`". So yes, signedTx must also be deterministically recoverable via prepare.

So `signedTx` should be derived deterministically from the input too. Let me make it `signed:${txId}` which is deterministic given txId is deterministic.

Hmm, but actually maybe I'm overcomplicating. Let me just make signedTx a deterministic function of the input. `signed:${txId}` is fine.

Now, let me reconsider whether I should worry about the other errors. The task explicitly says: "Rewrite `src/anchor/chain.ts` complete, fixing what these messages require of this file." and "Change nothing the messages do not name."

The only message that names `chain.ts` is:
```
src/anchor/chain.ts(1,43): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './canonical.js'?
```

So I only need to fix that import. But I'm rewriting the whole file, so I need to make sure the rest is correct per the plan.

Wait, but there's a subtlety. The other files import from chain.ts. For example, anchor.service.ts imports from './chain.js'. And the errors show that anchor.service.ts has issues importing from './anchor.repository' (TS2307 Cannot find module). But that's because anchor.repository.ts itself has errors (Prisma exports missing). Those are separate files I'm not touching.

Actually, hold on. Let me reconsider. The task is specifically about chain.ts. The compiler errors for the WHOLE workspace are given, but I only need to fix what affects chain.ts. The instruction is clear: "fixing what these messages require of this file" and "Change nothing the messages do not name."

So my job: produce a complete, correct chain.ts that fixes the TS2835 error (add .js extension to the import).

Let me make sure I'm not introducing new errors. Let me double check:
- `import { hashContent } from './canonical.js';` — this fixes the TS2835.
- All interfaces and the class are properly typed.

Let me reconsider the `getReceipt` return. The config has `receipts: Record<string, Receipt>`. When a txId is found, return the receipt. When not found, return `{ found: false, txId, blockNumber: null }`. That matches the Receipt interface.

Actually, wait. Let me reconsider whether `receipts` should be optional in the config. Looking at the plan again: "constructor takes an optional config object `{ broadcastFails?: boolean; receipts: Record<string, Receipt> }`". 

The phrasing "an optional config object" means the whole config is optional. Inside, `broadcastFails?` is optional, `receipts` is required. I'll follow that exactly but handle the no-config case with a default.

Hmm, but if `receipts` is required in the config type, then when someone constructs `new FakeChainClient()` with no args, that's fine because the whole config is optional. When they construct `new FakeChainClient({ broadcastFails: true })`, that would be a type error because `receipts` is missing. But that's per the plan's spec, so I'll follow it. Actually, to be safe and avoid being too strict in a way that might break tests, maybe I should make `receipts` optional too. But the plan explicitly shows it as required. Let me follow the plan.

Actually, let me reconsider. The tests in the workspace might construct FakeChainClient in various ways. But I can't see the test file content (only error messages). The error messages for the test file don't tell me how FakeChainClient is constructed. Let me just follow the plan exactly: config object is optional, `broadcastFails` optional, `receipts` required within the config.

Hmm, but this could cause issues if a test does `new FakeChainClient({ broadcastFails: true })`. But I have no evidence of that. The plan is the source of truth. Let me follow it.

Wait, actually, let me reconsider. To be maximally safe and not break anything, I could make `receipts` optional with a default. That would be a superset of the plan's requirement (it still accepts `{ broadcastFails?: boolean; receipts: Record<string, Receipt> }`). Making `receipts` optional doesn't violate the plan — it just makes the constructor more permissive. But the instruction says "Do not drop a requirement to silence an error" and "Change nothing the messages do not name." 

The messages don't name anything about the config shape. So I should follow the plan exactly for the parts not named by errors. The plan says `receipts: Record<string, Receipt>` (required). So I'll keep it required.

Actually, you know what, let me reconsider once more. The safest interpretation that follows the plan: the config type is exactly `{ broadcastFails?: boolean; receipts: Record<string, Receipt> }`. I'll use that.

Let me also double-check: does the plan say anything about `prepare` being synchronous? Yes: "`ChainClient { prepare(tx: AnchorTx): TxIdentity; ... }`" — prepare returns `TxIdentity` directly (not a Promise). And in the variant description: "`prepare(tx) -> {txId, signedTx}` (local, deterministic)". So prepare is synchronous. Good, my implementation has `prepare` returning `TxIdentity` (not async).

And `broadcast(signedTx): Promise<void>` — async. Good.
And `getReceipt(txId): Promise<Receipt>` — async. Good.

Now, let me reconsider the `signedTx` type. It's a string in TxIdentity. In broadcast, it's `broadcast(signedTx: string)`. Good.

Let me also think: should FakeChainClient track state (e.g., which txs were broadcast)? The plan doesn't mention it. It just says `broadcast` rejects when `broadcastFails`. So no state tracking needed. Keep it simple.

Let me finalize the file:

```typescript
import { hashContent } from './canonical.js';

export interface TxIdentity {
  txId: string;
  signedTx: string;
}

export interface Receipt {
  found: boolean;
  txId: string;
  blockNumber: number | null;
}

export interface AnchorTx {
  documentId: string;
  version: number;
  contentHash: string;
}

export interface ChainClient {
  prepare(tx: AnchorTx): TxIdentity;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<Receipt>;
}

export interface FakeChainClientConfig {
  broadcastFails?: boolean;
  receipts: Record<string, Receipt>;
}

export class FakeChainClient implements ChainClient {
  private readonly config: FakeChainClientConfig;

  constructor(config?: FakeChainClientConfig) {
    this.config = config ?? { receipts: {} };
  }

  prepare(tx: AnchorTx): TxIdentity {
    const txId = hashContent(tx);
    return { txId, signedTx: `signed:${txId}` };
  }

  async broadcast(signedTx: string): Promise<void> {
    if (this.config.broadcastFails) {
      throw new Error('broadcast timed out with unknown outcome');
    }
  }

  async getReceipt(txId: string): Promise<Receipt> {
    const receipt = this.config.receipts[txId];
    if (receipt !== undefined) {
      return receipt;
    }
    return { found: false, txId, blockNumber: null };
  }
}
```

Wait, I should double check the `broadcast` signature. In the interface it's `broadcast(signedTx: string): Promise<void>`. In my class, `async broadcast(signedTx: string): Promise<void>` — the parameter is unused if broadcastFails is false. That's fine in TS (unused params are allowed unless noUnusedParameters is on). Let me check — strict mode doesn't include noUnusedParameters by default. But to be safe, I could use the parameter or prefix with underscore. Actually, the plan says `broadcast(signedTx: string)`. If noUnusedParameters is on, an unused param would error. But the given compiler errors don't show any such error for chain.ts, so it's probably fine. But since I'm rewriting, let me be safe.

Hmm, actually the error list is the complete set of errors for the current (broken) file. The current chain.ts might have had a different body. I don't know if noUnusedParameters is on. Let me check the tsconfig — I can't see it. 

To be safe against noUnusedParameters, I could reference the parameter in a no-op way, or just not worry. Actually, a cleaner approach: since `broadcast` may reject with a timeout of unknown outcome, and in the fake it rejects when broadcastFails, I could make the success path do nothing. The unused parameter is a real concern if noUnusedParameters is enabled.

Let me think about how to handle this cleanly. One option:
```typescript
async broadcast(signedTx: string): Promise<void> {
  if (this.config.broadcastFails) {
    throw new Error('broadcast timed out with unknown outcome');
  }
}
```

If noUnusedParameters is on, `signedTx` unused would be an error. To avoid it, I could do:
```typescript
async broadcast(_signedTx: string): Promise<void> {
```

But the plan's interface uses `signedTx`. Renaming to `_signedTx` in the implementation is fine (param names don't need to match the interface). But it's a bit ugly. 

Alternatively, I can just leave it as `signedTx` and trust that noUnusedParameters is off. Given the errors listed don't include any unused-parameter errors (and they're described as "the compiler's exact messages for the whole workspace — not a summary"), if noUnusedParameters were on and the current file had unused params, we'd see them. But the current file is broken in other ways, so maybe it didn't get far enough to report those. Hmm.

Actually, the TS2835 error on line 1 means the import failed. But the rest of the file would still be type-checked. If there were unused parameter errors, they'd show up. The fact that no such errors appear for chain.ts suggests either (a) the current file doesn't have unused params, or (b) noUnusedParameters is off. Since I'm rewriting, I want to be safe.

Let me just reference the parameter to be safe, or use it meaningfully. Actually, a clean way: I could store the last broadcast or something. But that adds state not in the plan.

The simplest safe approach: keep `signedTx` as the param name (matching the interface for clarity) and just not use it. If noUnusedParameters is on, this would error. 

Hmm. Let me think about what's most likely. The tsconfig for a NestJS + strict setup... The convention says "TypeScript (strict)". `strict` does NOT include `noUnusedParameters` or `noUnusedLocals`. Those are separate flags. So it's likely off. I'll go with the clean version using `signedTx`.

Actually, to be maximally safe without adding unplaned state, I'll just leave it. The risk is low.

Wait, let me reconsider. Let me re-read: "TypeScript (strict), Node 20+". So `strict: true`. That's it. noUnusedParameters is not part of strict. So I'm safe.

Let me also double check the `getReceipt` — I use `this.config.receipts[txId]`. With `noUncheckedIndexedAccess` (not part of strict), this would be `Receipt | undefined`. Without it, it's `Receipt`. Either way, my check `if (receipt !== undefined)` handles both. Good. Actually, without noUncheckedIndexedAccess, `receipt` is typed as `Receipt`, and comparing to undefined is fine (no error, though TS might say the comparison is always... no, TS doesn't error on that by default). Actually, `receipt !== undefined` when receipt is typed as `Receipt` — TS allows this comparison. It's fine.

Hmm, but if noUncheckedIndexedAccess is off, then `receipt` is `Receipt` and the `if (receipt !== undefined)` branch — TS would narrow... actually it's fine, no error. Let me keep it.

Actually, let me reconsider: to be clean and avoid any potential "this condition is always true/false" lint (that's a lint rule, not a compiler error), I'll keep the check. It's defensive and correct.

Let me reconsider whether I even need the `!== undefined` check vs truthy check. A Receipt could theoretically be falsy? No, it's an object. So `if (receipt)` would work too. But `!== undefined` is more precise. I'll use it.

Now, one more consideration: the plan says `getReceipt` "returns configured receipts". So if a receipt is configured for the txId, return it. Otherwise... the plan doesn't explicitly say what to return for an unconfigured txId. But logically, it should return `{ found: false, ... }` since the receipt wasn't found. This matches the Receipt interface with `found: boolean`. So my implementation is correct.

Let me also verify: the variant says `getReceipt(txId)`. In the confirmation worker, it queries receipts. If not found yet (pending), leave as broadcasting. So `found: false` is the right signal for "not yet confirmed". Good.

Now, let me reconsider the import. The error says line 1 column 43. My import `import { hashContent } from './canonical.js';` — let me count: `import { hashContent } from ` is 29 chars, then `'./canonical.js'` starts at column 30. Hmm, the error was at column 43 in the ORIGINAL file, which presumably had `from './canonical'` (without .js). The exact column doesn't matter for my fix; what matters is that I add the `.js` extension. 

Actually wait, let me reconsider. The original file's line 1 was `import { hashContent } from './canonical';` and the error pointed to column 43 which would be the `./canonical` part. My fix changes it to `'./canonical.js'`. Good.

But hold on — I need to make sure the import is actually needed and correct. The manifest says chain.ts reads canonical.ts. So yes, it imports from canonical. And `hashContent` is the function I use for deterministic txId derivation. This makes sense and justifies the dependency.

Let me reconsider: is there any other function from canonical that chain.ts might need? The plan for chain.ts doesn't mention CanonicalizationError or canonicalize. Just the deterministic txId. So `hashContent` is the only import needed.

Alright, I'm fairly confident in my reconstruction. Let me also make sure I export everything the other files need:
- anchor.service.ts imports from './chain.js' — likely `ChainClient` and maybe `AnchorTx`.
- anchor.repository.ts imports from './chain.js' per the manifest? Let me check: "src/anchor/anchor.repository.ts | reads: src/anchor/chain.ts". Hmm, why would the repository read from chain.ts? Maybe for the AnchorState type? No wait, AnchorState is defined in anchor.service.ts per the plan. Let me re-read.

Actually the manifest says:
```
src/anchor/chain.ts | reads: src/anchor/canonical.ts
src/anchor/anchor.repository.ts | reads: src/anchor/chain.ts
```

So anchor.repository.ts reads from chain.ts. Why? Maybe it doesn't need anything from chain actually, or maybe the manifest is just noting potential dependencies. Actually, the repository deals with AnchorRecord which has `txId`, `state`, etc. It doesn't obviously need chain.ts types. But the manifest says it reads chain.ts. Hmm.

Wait, maybe I'm misreading the manifest direction. Let me re-read: "src/anchor/anchor.repository.ts | reads: src/anchor/chain.ts". This means anchor.repository.ts imports from chain.ts. That's a bit odd for a repository. But it's not my concern for chain.ts — I just need to make sure chain.ts exports whatever is needed. The key exports are `ChainClient`, `TxIdentity`, `Receipt`, `AnchorTx`, `FakeChainClient`. 

Actually, the repository probably doesn't import from chain.ts in a meaningful way, or maybe it imports a type. Regardless, my job is just chain.ts. I'll export all the types and the class.

Let me make sure I export:
- `TxIdentity` (interface)
- `Receipt` (interface)
- `AnchorTx` (interface)
- `ChainClient` (interface)
- `FakeChainClientConfig` (interface) — I added this, the plan doesn't name it explicitly but it's fine to have
- `FakeChainClient` (class)

The plan for chain.ts lists: TxIdentity, Receipt, ChainClient, AnchorTx, FakeChainClient. I'll also export FakeChainClientConfig since it's a named type I introduced. That's fine and doesn't drop anything.

Actually, to minimize surface area and stay close to the plan, maybe I shouldn't introduce `FakeChainClientConfig` as a separate exported interface. The plan says "constructor takes an optional config object `{ broadcastFails?: boolean; receipts: Record<string, Receipt> }`". I could inline the type in the constructor. But naming it is cleaner and doesn't hurt. However, "Change nothing the messages do not name" — introducing a new exported type is a change not named by errors. But it's part of faithfully implementing the plan (the config object needs a type). Inlining vs naming is an implementation detail. 

Hmm, let me just inline it to be minimal and avoid introducing an unplaned export:

```typescript
constructor(config?: { broadcastFails?: boolean; receipts: Record<string, Receipt> }) {
  this.config = config ?? { receipts: {} };
}
```

But then `this.config` needs a type. I can type the field:
```typescript
private readonly config: { broadcastFails?: boolean; receipts: Record<string, Receipt> };
```

That duplicates the inline type. A bit verbose but fine. Or I keep the named interface. 

I think a named interface is cleaner and more idiomatic. It doesn't "drop a requirement" or "change something the messages name". It's just good code. I'll keep `FakeChainClientConfig` exported. Actually, exporting it is harmless and potentially useful for tests. Let me keep it.

Hmm, wait. Let me reconsider the "Change nothing the messages do not name" instruction more carefully. This instruction is about not making unrelated changes to OTHER parts of the codebase (or other files). For chain.ts itself, I'm rewriting it completely as instructed. So within chain.ts, I have latitude to write correct, plan-conformant code. The instruction means: don't go fix anchor.repository.ts or the test files, etc.

So I'm good to write a clean chain.ts per the plan.

Let me finalize. Let me also reconsider: should `prepare` be a method that could be called and return the same result for the same input? Yes, deterministic. `hashContent(tx)` is deterministic given the same `tx` object structure. Since AnchorTx has `documentId`, `version`, `contentHash`, and hashContent canonicalizes (sorts keys), it's deterministic. 

One concern: `hashContent` takes `unknown` and canonicalizes. For an AnchorTx object, it'll produce a canonical JSON string and hash it. Deterministic. 

Let me write the final version.

Actually, let me reconsider the `signedTx` format. The plan doesn't specify it. I'll use something deterministic and clearly a "signed" representation. `signed:${txId}` is fine. Or I could hash it further. But simple is good. Let me use `signed:${txId}`.

Wait, actually, does the format of signedTx matter for the tests? The tests might check that `prepare` returns a `signedTx` and that `broadcast` is called with it. The exact format probably doesn't matter as long as it's a string and deterministic. `signed:${txId}` is safe.

Let me also double check: in the recovery flow, after re-prepare, it gets `{txId, signedTx}` and re-broadcasts the `signedTx`. For this to work across a "restart", the FakeChainClient would need to produce the same signedTx. Since it's deterministic from the input (which is reconstructed from stored data), it works. Good.

Final answer:

```typescript
import { hashContent } from './canonical.js';

export interface TxIdentity {
  txId: string;
  signedTx: string;
}

export interface Receipt {
  found: boolean;
  txId: string;
  blockNumber: number | null;
}

export interface AnchorTx {
  documentId: string;
  version: number;
  contentHash: string;
}

export interface ChainClient {
  prepare(tx: AnchorTx): TxIdentity;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<Receipt>;
}

export interface FakeChainClientConfig {
  broadcastFails?: boolean;
  receipts: Record<string, Receipt>;
}

export class FakeChainClient implements ChainClient {
  private readonly config: FakeChainClientConfig;

  constructor(config?: FakeChainClientConfig) {
    this.config = config ?? { receipts: {} };
  }

  prepare(tx: AnchorTx): TxIdentity {
    const txId = hashContent(tx);
    return { txId, signedTx: `signed:${txId}` };
  }

  async broadcast(signedTx: string): Promise<void> {
    if (this.config.broadcastFails) {
      throw new Error('broadcast timed out with unknown outcome');
    }
  }

  async getReceipt(txId: string): Promise<Receipt> {
    const receipt = this.config.receipts[txId];
    if (receipt !== undefined) {
      return receipt;
    }
    return { found: false, txId, blockNumber: null };
  }
}
```

This fixes the TS2835 error (added `.js` extension) and implements everything the plan specifies for chain.ts.

Let me reconsider once more if there are any other chain.ts errors I might have missed by re-reading the full error list:

```
ule './anchor.service' or its corresponding type declarations.   <- truncated, from some file (module?)
src/anchor/anchor.module.ts(2,34): ... './anchor.controller'
src/anchor/anchor.module.ts(3,31): ... './anchor.service'
src/anchor/anchor.module.ts(4,34): ... './anchor.repository'
src/anchor/anchor.module.ts(5,46): TS2835 ... Did you mean './chain.js'?
src/anchor/anchor.repository.ts(1,10): TS2305 Prisma
src/anchor/anchor.repository.ts(2,15): TS2305 PrismaClient
src/anchor/anchor.repository.ts(67,9): TS18046 'error' is unknown
src/anchor/anchor.service.ts(1,59): TS2307 './anchor.repository'
src/anchor/anchor.service.ts(2,38): TS2307 './anchor.repository'
src/anchor/anchor.service.ts(3,53): TS2835 './chain.js'
src/anchor/anchor.service.ts(4,29): TS2835 './canonical.js'
src/anchor/anchor.service.ts(5,39): TS2835 './canonical.js'
src/anchor/anchor.service.ts(35,35): TS2307 './anchor.repository'
src/anchor/chain.ts(1,43): TS2835 './canonical.js'   <- THE ONLY chain.ts ERROR
test/... (various)
```

Yes, the only error naming `src/anchor/chain.ts` is line 1 col 43, TS2835, needing `./canonical.js`. My fix addresses exactly that.

Note: anchor.module.ts(5,46) TS2835 "Did you mean './chain.js'?" — this is the module importing chain without .js. But that's anchor.module.ts, not chain.ts. I should NOT fix that (different file). My instruction is only to rewrite chain.ts. Good.

So my single-file fix is correct and complete.

I'm confident. Let me write the final response with just the fenced block.

One more sanity check on the import path: the file is `src/anchor/chain.ts` and canonical is `src/anchor/canonical.ts`. So relative import is `./canonical.js`. Correct.

Let me write it out.
```

## reply

```typescript
import { hashContent } from './canonical.js';

export interface TxIdentity {
  txId: string;
  signedTx: string;
}

export interface Receipt {
  found: boolean;
  txId: string;
  blockNumber: number | null;
}

export interface AnchorTx {
  documentId: string;
  version: number;
  contentHash: string;
}

export interface ChainClient {
  prepare(tx: AnchorTx): TxIdentity;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<Receipt>;
}

export interface FakeChainClientConfig {
  broadcastFails?: boolean;
  receipts: Record<string, Receipt>;
}

export class FakeChainClient implements ChainClient {
  private readonly config: FakeChainClientConfig;

  constructor(config?: FakeChainClientConfig) {
    this.config = config ?? { receipts: {} };
  }

  prepare(tx: AnchorTx): TxIdentity {
    const txId = hashContent(tx);
    return { txId, signedTx: `signed:${txId}` };
  }

  async broadcast(signedTx: string): Promise<void> {
    if (this.config.broadcastFails) {
      throw new Error('broadcast timed out with unknown outcome');
    }
  }

  async getReceipt(txId: string): Promise<Receipt> {
    const receipt = this.config.receipts[txId];
    if (receipt !== undefined) {
      return receipt;
    }
    return { found: false, txId, blockNumber: null };
  }
}
```
