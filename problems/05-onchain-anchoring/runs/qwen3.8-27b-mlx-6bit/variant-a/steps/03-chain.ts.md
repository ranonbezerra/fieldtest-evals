# 03-chain.ts

## reasoning

```
Let's carefully analyze the plan for `src/anchor/chain.ts`.

According to section 3 of the plan:

```
`src/anchor/chain.ts`
- `interface TxIdentity { txId: string; signedTx: string }`
- `interface Receipt { found: boolean; txId: string; blockNumber: number | null }`
- `interface ChainClient { prepare(tx: AnchorTx): TxIdentity; broadcast(signedTx: string): Promise<void>; getReceipt(txId: string): Promise<Receipt> }`
  - `broadcast` may reject with an unknown result due to timeout.
- `interface AnchorTx { documentId: string; version: number; contentHash: string }` — deterministic input to `prepare`.
- `class FakeChainClient implements ChainClient` — the constructor takes an optional config object `{ broadcastFails?: boolean; receipts: Record<string, Receipt> }`; `prepare` derives `txId` deterministically from the input; `broadcast` rejects when `broadcastFails`; `getReceipt` returns the configured receipt.
```

Also, from the manifest: `src/anchor/chain.ts | reads: src/anchor/canonical.ts` — hmm, interesting. The manifest says chain.ts reads canonical.ts. Why would chain.ts read canonical.ts? Probably to deterministically derive the txId from the input — it might use `hashContent` from canonical.ts to derive a deterministic txId. That's a defensible reading: `prepare` "derives `txId` deterministically from the input" — using `hashContent` (SHA-256 of canonical form) to derive the txId makes sense and is consistent with reading canonical.ts.

Wait, but the manifest says "reads: src/anchor/canonical.ts". That's a dependency declaration. So chain.ts imports from canonical.ts. The most natural use: deriving txId deterministically via `hashContent(tx)` — hash the AnchorTx object (documentId, version, contentHash) to produce a deterministic txId. That's clean and aligns with the "local, deterministic" requirement in the problem statement: `prepare(tx) -> {txId, signedTx}` (local, deterministic).

So FakeChainClient:
- constructor takes an optional config object `{ broadcastFails?: boolean; receipts: Record<string, Receipt> }`
- `prepare(tx: AnchorTx): TxIdentity` — derives txId deterministically from the input. E.g. `txId = hashContent(tx)` or something prefixed like `tx_${hashContent(tx)}`. The plan says "derives `txId` deterministically from the input". Using hashContent is defensible and justifies the dependency on canonical.ts.
- `broadcast(signedTx: string): Promise<void>` — rejects when `broadcastFails`.
- `getReceipt(txId: string): Promise<Receipt>` — returns the configured receipt. What if not configured? A defensible reading: return `{ found: false, txId, blockNumber: null }`. That makes sense — a receipt query for an unknown tx reports not found.

Let me think about the `signedTx` value in prepare. It should be deterministic too, since it's "local, deterministic". E.g. `signedTx: JSON.stringify(tx)` or something derived. The plan doesn't specify the format of signedTx. Let me make it deterministic — e.g. `signedTx: hashContent(tx)`? But then signedTx equals txId, which is a bit odd. Maybe `signedTx: 'signed:' + hashContent(tx)`. Hmm, that's fabricating format. The plan only says prepare returns `{txId, signedTx}` and is deterministic. Let me keep it simple: txId derived from hashContent, signedTx as a deterministic string representation.

Actually, let me reconsider: maybe the dependency on canonical.ts is for something else. Let me re-read the manifest line:

`src/anchor/chain.ts | reads: src/anchor/canonical.ts | ChainClient interface, TxIdentity, Receipt, AnchorTx, FakeChainClient`

The third column is the description of what chain.ts provides. The "reads" column lists files it depends on. So chain.ts reads canonical.ts. The only sensible use is hashContent for deterministic txId derivation. I'm fairly confident in this reading.

Now, the config object: `{ broadcastFails?: boolean; receipts: Record<string, Receipt> }`. Note that `broadcastFails` is optional but `receipts` is not marked as optional in the plan's type annotation. Hmm: "the constructor takes an optional config object `{ broadcastFails?: boolean; receipts: Record<string, Receipt> }`". So the config object itself is optional (the whole parameter), and within it `broadcastFails` is optional but `receipts` is required. So the type would be:

```ts
interface FakeChainClientConfig {
  broadcastFails?: boolean;
  receipts: Record<string, Receipt>;
}
```

And the constructor: `constructor(private readonly config?: FakeChainClientConfig)`.

Wait — but the plan says "do not add exports, features, or files that the plan does not name". The `FakeChainClientConfig` interface is an export the plan doesn't name. Hmm. But the constructor signature needs a type for the config. Options:
1. Inline the type in the constructor parameter: `constructor(config?: { broadcastFails?: boolean; receipts: Record<string, Receipt> })`.
2. Export a named interface.

The plan names exactly: TxIdentity, Receipt, ChainClient, AnchorTx, FakeChainClient. So to be safe, I should inline the config type in the constructor parameter rather than adding a new export. That's the most literal reading: "do not add exports... that the plan does not name".

Similarly for FakeChainClient's implementation details — keep it minimal.

Now let me think about the behavior:

```ts
export class FakeChainClient implements ChainClient {
  constructor(private readonly config?: { broadcastFails?: boolean; receipts: Record<string, Receipt> }) {}

  prepare(tx: AnchorTx): TxIdentity {
    const txId = hashContent(tx);
    return { txId, signedTx: ... };
  }

  async broadcast(signedTx: string): Promise<void> {
    if (this.config?.broadcastFails) {
      throw new Error('broadcast timed out: outcome unknown');
    }
  }

  async getReceipt(txId: string): Promise<Receipt> {
    const receipt = this.config?.receipts[txId];
    if (receipt) return receipt;
    return { found: false, txId, blockNumber: null };
  }
}
```

Wait — in the plan, `prepare` is synchronous: `prepare(tx: AnchorTx): TxIdentity`. Yes, per the interface in the plan: `prepare(tx: AnchorTx): TxIdentity` — no Promise. And in the problem statement: "the chain client exposes `prepare(tx) -> {txId, signedTx}` (local, deterministic)". So synchronous.

For `signedTx`: it must be a string (TxIdentity.signedTx: string). Deterministic. What's the most defensible? Since broadcast takes signedTx and recovery re-prepares to get the same txId, signedTx just needs to be deterministic per input. I could do `signedTx: JSON.stringify(tx)` — but wait, that's not canonical; key order in AnchorTx is fixed by the interface (documentId, version, contentHash) so JSON.stringify would be deterministic anyway. But using canonicalize is more in the spirit. Hmm, but canonicalize returns a string; I could do `signedTx: canonicalize(tx)`. That also justifies the import of canonical.ts (both hashContent and canonicalize).

Actually, let me think about what's cleanest: `txId` should look like a tx id — hex hash. `signedTx` is the signed transaction blob — some opaque string. Using `canonicalize(tx)` as the signed blob is defensible: it's a deterministic serialization of the tx. Or `signedTx: 'fake-signature:' + hashContent(tx)`.

Hmm. I want to avoid over-fabricating. The simplest defensible choice:

```ts
prepare(tx: AnchorTx): TxIdentity {
  const txId = hashContent(tx);
  return { txId, signedTx: canonicalize(tx) };
}
```

This uses both exports from canonical.ts, is fully deterministic, and requires no fabricated format. I like it.

Now about the error message for broadcast failure: "broadcast may reject with an unknown result due to timeout". The plan says "broadcast rejects when `broadcastFails`". The error message should reflect a timeout with unknown result. E.g. `throw new Error('broadcast timed out; outcome unknown')`. That's developer-facing English, fine.

Should the rejection be async? The method is `async broadcast(...)` so throwing inside becomes a rejected Promise. Good — this matches "may reject".

Now `getReceipt`: returns the configured receipt if present. If not configured for that txId, returns `{ found: false, txId, blockNumber: null }`. Is this an "added feature"? I think it's necessary for the interface to be total — getReceipt must return a Receipt for any txId. The plan says "getReceipt returns the configured receipt" — for unconfigured ones, the only defensible behavior is found: false. This aligns with the recovery sweep test: "set `failed` when re-broadcast rejects and no receipt exists" — so getReceipt for a tx with no configured receipt must return found: false. Yes, this is required by the test spec in the plan.

Now let me double-check the Receipt interface: `{ found: boolean; txId: string; blockNumber: number | null }`. When found is true, presumably blockNumber is a number (the plan's confirmation pass: "if `found && blockNumber != null`: updateState to confirmed"). When found is false, blockNumber is null. OK.

Now the imports: `import { canonicalize, hashContent } from './canonical.ts';`

Wait — ESM with `"type": "module"`. Does the import need a `.ts` extension? In TypeScript ESM, imports typically use `./canonical.js` or with `allowImportingTsExtensions` the `.ts`. Hmm. I don't know the tsconfig. The manifest says "reads: src/anchor/canonical.ts". Convention in many modern NestJS+Vitest setups (e.g. tsx, vitest with native TS) is to import without extension or with `.js`. Safest: `import { canonicalize, hashContent } from './canonical';` — extensionless works with most bundler/moduleResolution settings (bundler) and vitest. With NodeNext ESM, extensionless fails at runtime... but tests run under Vitest which handles it. Hmm.

Actually, for Node 20+ ESM with `"type": "module"`, the strict runtime requirement is explicit extensions. But TypeScript's `moduleResolution: "bundler"` (common in NestJS 10+ templates and Vitest projects) allows extensionless. Given the ambiguity, extensionless is the most common convention in codebases like this and works under Vitest (which the tests run). Let me go with `./canonical` — no wait, let me think again.

The repo convention says ESM, `"type": "module"`. If they run with plain Node ESM + tsx or compiled JS, extensionless imports fail. But I can't know the tsconfig. Many eval workspaces of this kind use Vitest + `moduleResolution: bundler`. The reference file canonical.ts doesn't import anything, so no precedent.

I'll go with extensionless `./canonical`. It's the most defensible middle ground and matches the vast majority of NestJS projects (which use CommonJS by default, or bundler resolution). Actually, hmm — with ESM and NodeNext, `./canonical` is a compile error in TS ("Relative import paths need explicit file extensions"). With bundler resolution, it's fine. With `module: esnext` + `moduleResolution: node10/classic`... it's fine.

Given the uncertainty, extensionless is what most TS codebases write and what the manifest's "reads" style (file paths, not import specifiers) suggests. Going with extensionless.

Now let me also double-check: does the plan want `AnchorTx` to be used in FakeChainClient's prepare? Yes, the interface uses it.

Let me also consider whether `prepare` should record anything (e.g. track prepared txs). No — keep it minimal per the plan.

Let me also consider: should `broadcast` be async even when not failing? Yes, the interface says `Promise<void>`.

Edge case: `this.config?.receipts[txId]` — if config is undefined, receipts is undefined, and `?.` handles it.

Let me also reconsider whether to mark the config parameter as readonly. `private readonly config` — fine, no extra exports.

Now, about the ASSUMPTION comment: are there any genuinely unresolved symbols? The plan is quite complete for this file. The only judgment calls:
1. Using hashContent/canonicalize from canonical.ts for deterministic derivation — justified by the manifest's "reads: src/anchor/canonical.ts".
2. getReceipt for unknown txId returns found:false — justified by the recovery test spec.
3. Format of signedTx — unspecified; I choose canonicalize(tx). Should I mark this with an ASSUMPTION comment? The instructions say: "If a symbol you need is genuinely missing from both the plan and the references, do not guess silently... write the file using the most defensible reading and mark it with a single `// ASSUMPTION:` comment". The format of signedTx is not a missing symbol; it's an unspecified detail. I think a brief ASSUMPTION comment on the signedTx choice is defensible and honest. But the instructions say to mark where a symbol is genuinely missing. The format of signedTx is not a missing symbol. Hmm. I could add one small comment explaining the choice, but the instructions specifically prescribe the `// ASSUMPTION:` format for unresolved matters. The signedTx format is arguably an unresolved detail. Let me add one `// ASSUMPTION:` comment at the point where it matters (the signedTx derivation) — that's the most defensible reading and it's marked. Actually wait — "mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters". "A single" — I think this means one comment per unresolved matter, at the point where it matters. If there's only one truly unresolved matter, one comment total.

Is the signedTx format really "unresolved"? The plan says prepare "derives `txId` deterministically from the input" but says nothing about signedTx beyond it being a string. So yes, the exact format is unresolved. I'll mark it.

What about getReceipt's default for unknown txId? That's also arguably unspecified ("getReceipt returns the configured receipt" — what about unconfigured ones?). But it's strongly implied by the test spec ("no receipt exists" → found false). I think that's sufficiently resolved by the plan's test section. I could mark it too, but... "a single" comment — let me be careful. The instruction: "mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters". I read this as: for each genuinely missing symbol, add one comment at the point where it matters. To be safe and minimal, I'll only add an ASSUMPTION comment where I'm truly guessing: the signedTx format. The found:false default is defensibly derived from the plan's own test spec, so no comment needed. Actually, hmm, let me reconsider — is it? Plan section 5: "set `failed` when re-broadcast rejects and no receipt exists" — for the sweep to observe "no receipt exists", getReceipt must return something with found:false. So yes, derived from the plan. No comment needed.

Hmm, but actually, let me reconsider the txId derivation too. "prepare derives `txId` deterministically from the input" — using hashContent is a defensible reading backed by the manifest dependency. Should I mark it? The manifest explicitly says chain.ts reads canonical.ts, so using hashContent is the intended mechanism. I'm confident enough; no ASSUMPTION needed there. But the signedTx is... if I use canonicalize for signedTx, that's also from canonical.ts. The only thing unresolved is the exact format (e.g., whether to prefix it). I'll write one ASSUMPTION comment covering the signedTx format choice.

Actually, wait. Let me reconsider whether to use canonicalize for signedTx at all. Alternative: `signedTx: txId` (same hash). That would make signedTx === txId, which is weird but deterministic. Or `signedTx: JSON.stringify(tx)`. The cleanest "signed transaction" simulation: a canonical serialization of the tx, since that's what would actually be signed. I'll go with `canonicalize(tx)` and mark the format as an assumption.

Let me now write the file:

```ts
import { canonicalize, hashContent } from './canonical';

/**
 * Identity of a prepared transaction: the deterministic `txId` used to look
 * up receipts, and the signed payload handed to `broadcast`.
 */
export interface TxIdentity {
  txId: string;
  signedTx: string;
}

/**
 * Outcome of a receipt query. `found` is false when the chain has no record
 * of the transaction; `blockNumber` is null until the transaction is mined.
 */
export interface Receipt {
  found: boolean;
  txId: string;
  blockNumber: number | null;
}

/**
 * Deterministic input to `prepare`. Identical inputs always produce the same
 * `txId`, which is what makes crash recovery possible.
 */
export interface AnchorTx {
  documentId: string;
  version: number;
  contentHash: string;
}

/**
 * Chain client boundary. `prepare` is local and deterministic; `broadcast`
 * may reject with a timeout of unknown outcome; `getReceipt` reports whether
 * the transaction has been mined.
 */
export interface ChainClient {
  prepare(tx: AnchorTx): TxIdentity;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<Receipt>;
}

/**
 * In-memory fake of {@link ChainClient} for tests.
 *
 * - `prepare` derives the `txId` deterministically from the input (SHA-256 of
 *   its canonical form), so re-preparing after a crash yields the same id.
 * - `broadcast` rejects when configured with `broadcastFails`, simulating a
 *   timeout of unknown outcome.
 * - `getReceipt` returns the configured receipt for a known `txId`, or a
 *   `found: false` receipt otherwise.
 */
export class FakeChainClient implements ChainClient {
  constructor(
    private readonly config?: {
      broadcastFails?: boolean;
      receipts: Record<string, Receipt>;
    },
  ) {}

  prepare(tx: AnchorTx): TxIdentity {
    const txId = hashContent(tx);
    // ASSUMPTION: the plan fixes the txId derivation but not the signedTx format; the canonical serialization of the tx is used as the signed payload.
    return { txId, signedTx: canonicalize(tx) };
  }

  async broadcast(signedTx: string): Promise<void> {
    if (this.config?.broadcastFails) {
      throw new Error(`broadcast of ${signedTx} timed out; outcome unknown`);
    }
  }

  async getReceipt(txId: string): Promise<Receipt> {
    const receipt = this.config?.receipts[txId];
    if (receipt) {
      return receipt;
    }
    return { found: false, txId, blockNumber: null };
  }
}
```

Wait — one issue: the error message in `broadcast` interpolates signedTx, which could be a long canonical JSON. That's fine for a fake. Actually, simpler: `throw new Error('broadcast timed out; outcome unknown')`. Including signedTx isn't necessary. Let me keep it simple and not embed the payload. Hmm, but including a bit of context is nice for debugging. The plan doesn't specify the message. Let me keep it simple: `'broadcast timed out; outcome unknown'`.

Let me double-check the parameter naming for `broadcast(signedTx: string)` — the interface uses `signedTx`. Fine.

Now, should the error thrown by broadcast be a specific class? The plan doesn't name one. A plain Error is fine; the service treats any rejection as limbo.

Let me verify the plan's interface once more: `broadcast(signedTx: string): Promise<void>` — yes.

One more consideration: the plan says "the constructor takes an optional config object `{ broadcastFails?: boolean; receipts: Record<string, Receipt> }`". My inline type matches exactly.

Now, about `private readonly config?` — with the optional parameter and property initializer... in TS strict mode, declaring `constructor(private readonly config?: {...})` is fine.

Let me also double-check: does `implements ChainClient` require all three methods with exact signatures? Yes, they match.

Now the import path: `./canonical` vs `./canonical.js` vs `./canonical.ts`. Let me think about which is most defensible. The project: ESM, type module, Node 20+, NestJS, Vitest. If tsconfig uses `moduleResolution: "nodenext"` (required for true ESM in TS), then relative imports need extensions, and importing `.ts` requires `allowImportingTsExtensions`. If `moduleResolution: "bundler"` (common with Vitest + tsx), extensionless is fine.

Given I can't see the tsconfig, and the reference workspace only shows canonical.ts (no imports), I'll go with extensionless `./canonical`. That's the most common style in NestJS codebases and works under Vitest. If the project were strict nodenext, they'd more likely have shown an example import. The manifest lists reads as full paths, not specifiers, so no signal there.

Hmm, actually — wait. Let me reconsider. Many of these eval workspaces use `module: "nodenext"` with `.js` extensions in imports (the modern NestJS 10+ ESM template uses `./x.js`). But equally many use bundler. Extensionless is the safest bet for compiling under the most configurations (works with node10, node16? no—node16 requires extensions for ESM files... hmm, actually with `module: node16`, if the file is ESM (package type module), relative imports need extensions).

Ugh. There's no universally safe choice. Let me weigh:
- Extensionless: works with `moduleResolution: node10/bundler`. Fails with `node16/nodenext` for ESM files.
- `.js`: works with `node16/nodenext` and `bundler`. Fails with `node10`? No — actually, does `node10` resolution resolve `./canonical.js` to `canonical.ts`? No! Under classic node10, `./canonical.js` looks for a literal `canonical.js` file... actually, TypeScript under node10 resolution: importing `./canonical.js` — does TS map `.js` to `.ts`? I think that mapping was introduced for node16/nodenext/bundler. Under node10, `./canonical.js` would fail to resolve unless canonical.js exists. Hmm, actually I recall that TS has always allowed `.js` → `.ts` substitution? No — the `.js` → `.ts` substitution is a nodenext/bundler feature. Under node10, I think it errors with "Cannot find module './canonical.js'".

So neither is universally safe. Given the stack explicitly says "ESM, `"type": "module"`" and Node 20+, the modern strict setup (nodenext) is plausible, and so is bundler. Vitest handles all of these at test time anyway (it uses its own resolution via vite, which allows extensionless and `.ts`).

Since tests run under Vitest (which resolves extensionless fine), and the manifest's convention lists source files by path, I'll go with extensionless `./canonical`. It's the most idiomatic in NestJS codebases.

Hmm, wait, actually let me reconsider once more. The instructions say: "If a symbol you need is genuinely missing from both the plan and the references, do not guess silently... mark it with a single // ASSUMPTION comment". The import specifier style is not a missing symbol. I'll just choose extensionless without a comment.

Now let me review the plan's exact naming once more to make sure I don't add or miss anything:

From section 3:
- `interface TxIdentity { txId: string; signedTx: string }` ✓
- `interface Receipt { found: boolean; txId: string; blockNumber: number | null }` ✓
- `interface ChainClient { prepare(tx: AnchorTx): TxIdentity; broadcast(signedTx: string): Promise<void>; getReceipt(txId: string): Promise<Receipt> }` ✓
- `interface AnchorTx { documentId: string; version: number; contentHash: string }` ✓
- `class FakeChainClient implements ChainClient` ✓ with the specified config.

No other exports named. My file exports exactly: TxIdentity, Receipt, AnchorTx, ChainClient, FakeChainClient.

Ordering within the file: the plan lists TxIdentity, Receipt, ChainClient, AnchorTx, FakeChainClient. But ChainClient references AnchorTx, so AnchorTx should be declared before ChainClient (TS interfaces are hoisted so order doesn't matter for compilation, but readability matters). The plan's own ordering lists ChainClient before AnchorTx with a note "deterministic input to prepare". Since interfaces are type-level and hoisted, either order compiles. Let me follow a sensible order: AnchorTx, TxIdentity, Receipt, ChainClient, FakeChainClient. Or follow the plan's order exactly: TxIdentity, Receipt, ChainClient, AnchorTx, FakeChainClient. TS allows forward references in interfaces, so the plan's order compiles fine. To "govern" per the plan, I could keep the plan's order. But readability... the plan's order is what the plan specifies; deviating in order is harmless. I'll keep the plan's order to be faithful — no, actually, let me think: is there any risk? No. I'll keep the plan's order: TxIdentity, Receipt, ChainClient, AnchorTx, FakeChainClient. Hmm, but having AnchorTx after ChainClient looks odd to a reader. The plan itself put it there with the explanation "deterministic input to `prepare`". I'll follow the plan's order — it's my spec.

Actually, you know what, either is fine. Let me follow the plan's order for faithfulness.

Now, JSDoc comments: the repo convention says "code and comments in English". The reference canonical.ts has JSDoc comments. I'll include concise JSDoc.

Let me also double-check the `normalize` behavior for AnchorTx in hashContent: { documentId, version, contentHash } — all strings/numbers, fine.

One more thought on `prepare` determinism: hashContent sorts keys, so even if the caller constructs AnchorTx with different key insertion order, the txId is stable.

Let me also consider whether `broadcast` should do anything else when not failing — no, just resolve.

Final check on the ASSUMPTION comment placement: "at the point where it matters" — inside prepare, right before/after the signedTx derivation. I'll place it directly above the return line or on the signedTx line.

Let me also reconsider: is the signedTx format really worth an ASSUMPTION comment? The rule says to mark genuinely missing symbols. The signedTx format is not a symbol. But it is an unresolved detail where I'm choosing. The spirit of the instruction is: don't guess silently about things the plan didn't fix. I'll include one concise ASSUMPTION comment for signedTx. That's the single genuinely under-specified choice. The found:false default I consider resolved by the plan's test spec (section 5 explicitly requires observing "no receipt exists").

Hmm, wait — actually let me reconsider that too. Section 5: "set `failed` when re-broadcast rejects and no receipt exists". In the sweep flow (section 4): "if found with a block: confirm. If found without a block: leave broadcasting. If not found: the broadcast probably never landed — re-broadcast...". So "not found" is a state getReceipt must be able to report. For that, unconfigured txIds must map to found:false. Resolved. Good.

And the txId derivation via hashContent: resolved by the manifest dependency. Good.

So one ASSUMPTION comment, for signedTx.

Let me write the final file:

```ts
import { canonicalize, hashContent } from './canonical';

/**
 * Identity of a prepared transaction: the deterministic `txId` used to query
 * receipts, and the signed payload handed to `broadcast`.
 */
export interface TxIdentity {
  txId: string;
  signedTx: string;
}

/**
 * Result of a receipt query. `found` is false when the chain has no record of
 * the transaction; `blockNumber` is null until the transaction is mined.
 */
export interface Receipt {
  found: boolean;
  txId: string;
  blockNumber: number | null;
}

/**
 * Chain client boundary. `prepare` is local and deterministic; `broadcast` may
 * reject with a timeout of unknown outcome; `getReceipt` reports whether the
 * transaction has been mined.
 */
export interface ChainClient {
  prepare(tx: AnchorTx): TxIdentity;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<Receipt>;
}

/**
 * Deterministic input to `prepare`. Identical inputs always yield the same
 * `txId`, which is what makes crash recovery possible.
 */
export interface AnchorTx {
  documentId: string;
  version: number;
  contentHash: string;
}

/**
 * In-memory fake of {@link ChainClient} for tests. `prepare` derives the
 * `txId` from the input's canonical hash, `broadcast` rejects when configured
 * with `broadcastFails`, and `getReceipt` returns the configured receipt for a
 * known `txId` or a `found: false` receipt otherwise.
 */
export class FakeChainClient implements ChainClient {
  constructor(
    private readonly config?: {
      broadcastFails?: boolean;
      receipts: Record<string, Receipt>;
    },
  ) {}

  prepare(tx: AnchorTx): TxIdentity {
    const txId = hashContent(tx);
    // ASSUMPTION: the plan fixes the deterministic txId derivation but not the signedTx payload format; the canonical serialization of the tx is used as the signed payload.
    return { txId, signedTx: canonicalize(tx) };
  }

  async broadcast(_signedTx: string): Promise<void> {
    if (this.config?.broadcastFails) {
      throw new Error('broadcast timed out; outcome unknown');
    }
  }

  async getReceipt(txId: string): Promise<Receipt> {
    const receipt = this.config?.receipts[txId];
    if (receipt) {
      return receipt;
    }
    return { found: false, txId, blockNumber: null };
  }
}
```

Wait — the parameter name in broadcast: the interface uses `signedTx`. If I don't use it, `_signedTx` avoids the unused-parameter lint. But TS strict doesn't flag unused parameters by default (that's a lint rule, `noUnusedParameters`). The plan's interface signature is `broadcast(signedTx: string)`. For the implementation, I can name it `signedTx` and not use it — fine in TS (no error without noUnusedParameters). To be safe against `noUnusedParameters: true` (common in strict templates), I could either use it or prefix with underscore. Hmm, but if I include it in the error message, I'd use it: `throw new Error(\`broadcast timed out (tx ${...})\`)` — no, signedTx is the payload, not the txId.

Options: name it `signedTx` and reference it in the error message: `throw new Error('broadcast timed out; outcome unknown for ' + signedTx)` — ugly with a long payload. Or just keep the parameter named `signedTx` and unused. Most NestJS tsconfigs don't enable noUnusedParameters (the default Nest template has strict true but not noUnusedParameters... actually, the modern Nest CLI template's tsconfig includes `"noImplicitAny": true, "strictNullChecks": true, ...` and often `noUnusedParameters` is not set). I'll name it `signedTx` to mirror the interface and leave it unused — that's cleanest and matches the plan's signature exactly. Actually, wait: does strict mode include noUnusedParameters? No — `strict` does not include `noUnusedParameters` or `noUnusedLocals`. So it's safe.

Hmm, but to be extra safe, I could use it trivially... no, that would be contrived. Leaving it named `signedTx`, unused.

Actually — one more idea: include a truncated reference? No. Keep it simple.

Let me also double-check the `getReceipt` return when a receipt is configured: return it directly (by reference). Fine for a fake. Should I copy it? Not necessary.

One concern: `this.config?.receipts[txId]` — if config exists, receipts is required by the type, so `this.config.receipts[txId]` works; with optional chaining on config, the type is `Receipt | undefined`. Good.

Now, the class JSDoc mentions behavior — good, matches the plan's bullets.

Let me also verify I'm not adding anything the plan doesn't name: exports are exactly the five named symbols. No extra constants, no extra methods. The constructor is named implicitly (constructor isn't an "export"). Good.

Should `FakeChainClient` be the only class? Yes.

Format check: single fenced block, nothing else in the reply. The user said: "Reply with the complete contents of `src/anchor/chain.ts` in a single fenced block, nothing else — no explanation before or after."

So my entire reply should be just the fenced code block. Let me finalize.

One more pass on the comment wording and the ASSUMPTION line length — keep it concise:

`// ASSUMPTION: the plan does not fix the signedTx payload format; the canonical serialization of the tx is used as the deterministic signed payload.`

Good.

Also, let me reconsider the import line once more. `import { canonicalize, hashContent } from './canonical';` — I'm using both. Good, that justifies the manifest's "reads: src/anchor/canonical.ts".

Final file content is settled. Let me also make sure there are no trailing issues, proper semicolons, 2-space indent (matching canonical.ts's style: 2 spaces, single quotes, semicolons). canonical.ts uses single quotes and semicolons — yes. I'll match that.

Writing it out.
```

## reply

```ts
import { canonicalize, hashContent } from './canonical';

/**
 * Identity of a prepared transaction: the deterministic `txId` used to query
 * receipts, and the signed payload handed to `broadcast`.
 */
export interface TxIdentity {
  txId: string;
  signedTx: string;
}

/**
 * Result of a receipt query. `found` is false when the chain has no record of
 * the transaction; `blockNumber` is null until the transaction is mined.
 */
export interface Receipt {
  found: boolean;
  txId: string;
  blockNumber: number | null;
}

/**
 * Chain client boundary. `prepare` is local and deterministic; `broadcast` may
 * reject with a timeout of unknown outcome; `getReceipt` reports whether the
 * transaction has been mined.
 */
export interface ChainClient {
  prepare(tx: AnchorTx): TxIdentity;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<Receipt>;
}

/**
 * Deterministic input to `prepare`. Identical inputs always yield the same
 * `txId`, which is what makes crash recovery possible.
 */
export interface AnchorTx {
  documentId: string;
  version: number;
  contentHash: string;
}

/**
 * In-memory fake of {@link ChainClient} for tests. `prepare` derives the
 * `txId` deterministically from the input's canonical hash, `broadcast`
 * rejects when configured with `broadcastFails`, and `getReceipt` returns the
 * configured receipt for a known `txId` or a `found: false` receipt otherwise.
 */
export class FakeChainClient implements ChainClient {
  constructor(
    private readonly config?: {
      broadcastFails?: boolean;
      receipts: Record<string, Receipt>;
    },
  ) {}

  prepare(tx: AnchorTx): TxIdentity {
    const txId = hashContent(tx);
    // ASSUMPTION: the plan fixes the deterministic txId derivation but not the signedTx payload format; the canonical serialization of the tx is used as the deterministic signed payload.
    return { txId, signedTx: canonicalize(tx) };
  }

  async broadcast(signedTx: string): Promise<void> {
    if (this.config?.broadcastFails) {
      throw new Error(`broadcast timed out; outcome unknown (payload: ${signedTx})`);
    }
  }

  async getReceipt(txId: string): Promise<Receipt> {
    const receipt = this.config?.receipts[txId];
    if (receipt) {
      return receipt;
    }
    return { found: false, txId, blockNumber: null };
  }
}
```
