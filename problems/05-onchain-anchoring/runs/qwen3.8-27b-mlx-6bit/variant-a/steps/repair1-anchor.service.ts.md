# repair1-anchor.service.ts

## reply

Let me carefully analyze the compiler errors related to `src/anchor/anchor.service.ts`:

1. `src/anchor/anchor.service.ts(1,59): error TS2307: Cannot find module './anchor.repository'` — needs `.js` extension
2. `src/anchor/anchor.service.ts(2,38): error TS2307: Cannot find module './anchor.repository'` — needs `.js` extension
3. `src/anchor/anchor.service.ts(3,53): error TS2835: Relative import paths need explicit file extensions... Did you mean './chain.js'?`
4. `src/anchor/anchor.service.ts(4,29): error TS2835: ... Did you mean './canonical.js'?`
5. `src/anchor/anchor.service.ts(5,39): error TS2835: ... Did you mean './canonical.js'?`
6. `src/anchor/anchor.service.ts(35,35): error TS2307: Cannot find module './anchor.repository'` — needs `.js` extension

So the fixes for this file are:
- Line 1: import from `./anchor.repository.js` (two named imports at columns 10 and 59? Actually (1,59) is one import statement with two specifiers — `import { AnchorRepository, ... } from './anchor.repository'`)
- Line 2: another import from `./anchor.repository.js`
- Line 3: import from `./chain.js`
- Line 4: import from `./canonical.js`
- Line 5: another import from `./canonical.js`
- Line 35: type import from `./anchor.repository.js`

Now, the tricky part: I can't see the actual content of `src/anchor/anchor.service.ts`, nor the other files (`anchor.repository.ts`, `chain.ts`, `canonical.ts`). The task says: "if a message references a shape you can't see, say so in an `// ASSUMPTION:` line rather than repeatedly guessing."

But I do have a PLAN.md that describes everything in detail. The plan specifies:

`src/anchor/canonical.ts`:
- `canonicalize(value: unknown): string`
- `hashContent(value: unknown): string`
- `class CanonicalizationError extends Error`

`src/anchor/chain.ts`:
- `interface TxIdentity { txId: string; signedTx: string }`
- `interface Receipt { found: boolean; txId: string; blockNumber: number | null }`
- `interface ChainClient { prepare(tx: AnchorTx): TxIdentity; broadcast(signedTx: string): Promise<void>; getReceipt(txId: string): Promise<Receipt> }`
- `interface AnchorTx { documentId: string; version: number; contentHash: string }`
- `class FakeChainClient implements ChainClient`

`src/anchor/anchor.repository.ts`:
- `class AnchorRepository`
  - `constructor(private readonly prisma: PrismaClient)`
  - `create(input: NewAnchor): Promise<AnchorRecord>` — throws `DuplicateAnchorError` on unique violation
  - `findUnique(documentId: string, version: number): Promise<AnchorRecord | null>`
  - `findByState(state: AnchorState, limit?: number): Promise<AnchorRecord[]>`
  - `updateState(id: string, patch: { state?: AnchorState; txId?: string; blockNumber?: number | null }): Promise<AnchorRecord>`

Wait, but the error at `src/anchor/anchor.repository.ts(1,10): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.` and `(2,15) ... 'PrismaClient'` — this suggests the Prisma client hasn't been generated (or the schema isn't set up). But I've been told to fix only `src/anchor/anchor.service.ts` and "change nothing the messages don't name." The repository errors are named but they're in a different file — I shouldn't touch other files. My job is only to rewrite `src/anchor/anchor.service.ts`.

Also `anchor.repository.ts(67,9): error TS18046: 'error' is of type 'unknown'.` — that's in the repository file, not mine to fix.

So the only messages for my file are TS2307 (missing module due to missing extension) and TS2835 (explicit file extension required). The fix: add `.js` extensions to relative imports.

But wait — I need to write the whole file. I can't see the current file content. All I know is:
- Line 1 imports from `./anchor.repository` with something at column 59 (the module specifier position)
- Line 2 imports from `./anchor.repository`
- Line 3 imports from `./chain` (something)
- Line 4 imports from `./canonical`
- Line 5 imports from `./canonical`
- Line 35 references `./anchor.repository` (probably a type import, or a catch clause? No — TS2307 at line 35 column 35 is "Cannot find module './anchor.repository'" — so there's another import statement at line 35? That's odd for an import to be at line 35. Maybe it's a dynamic `import('./anchor.repository')`? Or maybe the file has imports at lines 1-5, then code, and line 35 is... hmm.

Actually, wait. Let me reconsider. The error list for anchor.service.ts:
```
src/anchor/anchor.service.ts(1,59): error TS2307: Cannot find module './anchor.repository' or its corresponding type declarations.
src/anchor/anchor.service.ts(2,38): error TS2307: Cannot find module './anchor.repository' or its corresponding type declarations.
src/anchor/anchor.service.ts(3,53): error TS2835: Relative import paths need explicit file extensions ... Did you mean './chain.js'?
src/anchor/anchor.service.ts(4,29): error TS2835: ... Did you mean './canonical.js'?
src/anchor/anchor.service.ts(5,39): error TS2835: ... Did you mean './canonical.js'?
src/anchor/anchor.service.ts(35,35): error TS2307: Cannot find module './anchor.repository' or its corresponding type declarations.
```

Interesting: lines 1-2 get TS2307 (Cannot find module), while lines 3-5 get TS2835 (needs explicit extension). Why the difference? TS2835 is reported when the module *can* be resolved if you add the `.js` extension (i.e., the file exists as `.ts` and the compiler suggests `./chain.js`). TS2307 means the module can't be found at all — even with extension? Hmm, actually no.

Let me think about how TypeScript under `node16`/`nodenext` resolution handles these:
- For `import ... from './chain'` when `chain.ts` exists: the compiler says TS2835 "Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './chain.js'?" — this is the specific diagnostic for when it knows the extensionless path would resolve if you added `.js`.
- For `import ... from './anchor.repository'` when `anchor.repository.ts` exists: it should similarly say TS2835 "Did you mean './anchor.repository.js'?"

But here lines 1, 2, 35 get TS2307 "Cannot find module './anchor.repository'" instead. That suggests `./anchor.repository` doesn't resolve at all — perhaps because... hmm, wait. Actually the difference might be: TS2835 is emitted when the file exists but the extension is missing. TS2307 is emitted when nothing is found.

Hmm, but `anchor.repository.ts` clearly exists (it has its own errors listed). So why TS2307?

Wait — actually, let me reconsider. Maybe the difference is `import type` vs value import? No, that wouldn't matter for resolution.

Or maybe... the file `anchor.repository.ts` fails to compile so badly that its types are unresolved? No, TS2307 is a resolution error, not a type error.

Hmm, actually let me think again about TS2835 vs TS2307. In TypeScript, when `moduleResolution: node16/nodenext` and you write an extensionless relative import in a `.ts` file that's treated as ESM:
- The compiler first tries to resolve. `./chain` — under node16 ESM, extensionless relative imports are not allowed at runtime, so the compiler emits TS2835 with a suggestion.
- Actually I recall: TS2835 is specifically "Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './x.js'?" and it's emitted when the extensionless path *would* resolve under classic/node10 rules.

So for `./anchor.repository` to give TS2307 instead of TS2835, the file `anchor.repository.ts` would have to not exist... but it does (errors listed at lines 1, 2, 67).

Wait a moment — maybe the file exists but is named differently? No, the errors reference `src/anchor/anchor.repository.ts` directly.

Hmm, or: maybe TS2307 vs TS2835 depends on whether the import is a value import or a type-only import? Let me think... Actually I don't think so.

Or maybe the difference is: lines 1 and 2 import *named bindings* that don't exist in the module? No — TS2307 is "Cannot find module", not "has no exported member" (that's TS2305, which we see for `@prisma/client`).

OK, another thought: maybe the current `anchor.service.ts` file has imports like:
```ts
import { AnchorRepository, type AnchorRecord } from './anchor.repository';  // line 1
import { DuplicateAnchorError } from './anchor.repository';  // line 2
```
And the TS2307 vs TS2835 difference is... hmm.

Actually, you know what? Let me look at the column numbers:
- Line 1, column 59: `import { AnchorRepository, ... } from './anchor.repository';` — the string starts after `from `. If column 59 is where `'./anchor.repository'` begins... let me count: `import { AnchorRepository, type NewAnchor } from './anchor.repository';` — "import { " is 10 chars, then names... this is getting speculative.
- Line 2, column 38: shorter import.
- Line 35, column 35: another import from './anchor.repository'.

Honestly, the exact distinction between TS2307 and TS2835 doesn't change my fix: all six errors in my file are about module resolution of relative imports, and the fix is to use `.js` extensions. The task says "fix what these messages require of this file." The messages require that the imports resolve — i.e., use explicit `.js` extensions (which is what the TS2835 messages explicitly suggest: "Did you mean './chain.js'?" and "./canonical.js").

For the TS2307 ones on `./anchor.repository`, adding `.js` should make them resolve to `anchor.repository.ts` (the file exists). So the same fix applies.

Now, the bigger challenge: I have to write the *complete* file, but I can't see the current content. I have to reconstruct it from:
1. PLAN.md (authoritative spec)
2. The error messages (which tell me the import structure: 5 import lines + something at line 35)
3. The test file errors (which tell me what the tests expect from the service — e.g., `test/anchor.service.spec.ts(113,5): error TS2740: Type 'Promise<Row | null>' is missing the following properties from type 'Row': id, documentId, version, contentHash, and 4 more.` — this tells me the tests use a fake repository with `Row` type; not directly my concern but suggests the service's public types)

The instructions say: "if a message references a shape you can't see, say so in an `// ASSUMPTION:` line rather than repeatedly guessing."

So I should write the file based on PLAN.md, and add `// ASSUMPTION:` lines where I'm making assumptions about shapes I can't see (e.g., the exact export names from `anchor.repository.ts`, the exact export names from `chain.ts` and `canonical.ts`).

Wait, but PLAN.md is very specific about the exports. The plan says:

`canonical.ts` exports: `canonicalize`, `hashContent`, `CanonicalizationError`.
`chain.ts` exports: `TxIdentity`, `Receipt`, `ChainClient`, `AnchorTx`, `FakeChainClient`.
`anchor.repository.ts` exports: `AnchorRepository`, and per the plan's section 3, `AnchorState`, `AnchorRecord`, `NewAnchor` are defined in... hmm wait, let me re-read the plan.

The plan's section 3 lists under `src/anchor/anchor.repository.ts`:
- `class AnchorRepository` with methods.

And under `src/anchor/anchor.service.ts`:
- `type AnchorState = 'pending' | 'broadcasting' | 'confirmed' | 'failed'`
- `interface AnchorRecord { ... }`
- `interface NewAnchor { ... }`
- `interface AnchorProof { ... }`
- `interface MismatchReport { ... }`
- `type VerifyResult = ...`
- `class AnchorService`
- `class DuplicateAnchorError`
- `class ResourceNotFoundError`

Hmm interesting — so per the plan, `AnchorState`, `AnchorRecord`, `NewAnchor` are defined in `anchor.service.ts`, while `DuplicateAnchorError` is raised by the repository (per plan: "create(input): inserts; throws DuplicateAnchorError on unique violation") but *defined* in `anchor.service.ts`? That's a bit circular: the repository throws an error defined in the service, and the service imports the repository. That would create a circular import: `anchor.service.ts` imports `AnchorRepository` from `anchor.repository.ts`, and `anchor.repository.ts` would import `DuplicateAnchorError` from `anchor.service.ts`.

Hmm, wait. Let me re-read the plan's manifest:

```
src/anchor/anchor.repository.ts | reads: src/anchor/chain.ts | AnchorRepository, AnchorRecord, NewAnchor, AnchorState, DuplicateAnchorError
src/anchor/anchor.service.ts | reads: src/anchor/anchor.repository.ts, src/anchor/canonical.ts | AnchorService (anchorDocument, verify, runConfirmationPass, runRecoverySweep), AnchorProof, MismatchReport, VerifyResult, ResourceNotFoundError
```

So per the manifest:
- `anchor.repository.ts` reads (imports from) `chain.ts` and exports: `AnchorRepository`, `AnchorRecord`, `NewAnchor`, `AnchorState`, `DuplicateAnchorError`.
- `anchor.service.ts` reads (imports from) `anchor.repository.ts` and `canonical.ts` and exports: `AnchorService`, `AnchorProof`, `MismatchReport`, `VerifyResult`, `ResourceNotFoundError`.

So the manifest overrides section 3's placement: `AnchorRecord`, `NewAnchor`, `AnchorState`, `DuplicateAnchorError` all live in `anchor.repository.ts`. And the service imports them from there.

This matches the error messages! Line 1 of `anchor.service.ts` imports from `./anchor.repository` (column 59 — a long import list), line 2 also imports from `./anchor.repository` (column 38 — shorter). So probably:

Line 1: `import { AnchorRepository, AnchorRecord, NewAnchor, AnchorState, DuplicateAnchorError } from './anchor.repository';` — hmm let me count columns. `import { AnchorRepository, AnchorRecord, NewAnchor, AnchorState, DuplicateAnchorError } from './anchor.repository';`
- `import { ` = 10 chars (columns 1-10)
- `AnchorRepository` = 16 → ends at column 26, comma+space → 28
- `AnchorRecord` = 12 → ends at 40, comma+space → 42
- `NewAnchor` = 9 → ends at 51, comma+space → 53
- `AnchorState` = 11 → ends at 64...

Hmm, that doesn't get the module string to column 59. Let me try: `import { AnchorRepository, type AnchorRecord } from './anchor.repository';`
- `import { ` (10) + `AnchorRepository` (16) = 26, `, ` = 28, `type ` = 33, `AnchorRecord` (12) = 45, ` } from ` → ` }` = 47-48, ` from ` = 49-54, then `'./anchor.repository'` starts at column 55. Close to 59 but not exact.

Let me try line 2 column 38: `import { DuplicateAnchorError } from './anchor.repository';`
- `import { ` (10) + `DuplicateAnchorError` (20) = 30, ` } from ` = 31-37... wait: column 31 is `}`, space 32, `from` 33-36, space 37, `'` at 38. Yes! `import { DuplicateAnchorError } from './anchor.repository';` puts the module string at column 38.

So line 2 is probably `import { DuplicateAnchorError } from './anchor.repository';` — or some single import that lands at column 38. Let me verify: "import { DuplicateAnchorError } from '" — i-m-p-o-r-t(6) space(7) {(8) space(9) D(10)... DuplicateAnchorError is 20 chars: columns 10-29, space(30)? no wait.

Let me count carefully:
```
import { DuplicateAnchorError } from './anchor.repository';
1234567890...
```
- `i`=1, `m`=2, `p`=3, `o`=4, `r`=5, `t`=6, ` `=7, `{`=8, ` `=9
- `D`=10 ... `DuplicateAnchorError` = 20 chars → columns 10-29
- ` `=30, `}`=31, ` `=32, `f`=33, `r`=34, `o`=35, `m`=36, ` `=37, `'`=38

Yes! Column 38 is the opening quote of the module specifier. So line 2 = `import { DuplicateAnchorError } from './anchor.repository';` fits exactly.

For line 1 column 59: the module string starts at column 59. So `import { ... } from '` has length 58 before the quote... the quote is at column 59, so `import { X } from ` occupies columns 1-58. `import { ` = 9 chars (columns 1-9: i,m,p,o,r,t,space,{,space). Wait: `import` = 6 (1-6), space=7, `{`=8, space=9. Then names start at column 10. ` } from ` after names: space, `}`, space, f,r,o,m, space = 7 chars. Then `'` at column 59 means names occupy columns 10 through 59-8=51... let me compute: if the quote is at column 59, then ` } from ` ends at column 58. So `}` is at column 56, the space before `}` is at column 55... let me lay it out: columns: ... N (last name char) = c, space = c+1, `}` = c+2, space = c+3, `f`=c+4, `r`=c+5, `o`=c+6, `m`=c+7, space=c+8, `'`=c+9 = 59 → c = 50. So the imported names span columns 10-50, i.e., 41 characters total including commas and spaces.

Candidates: `AnchorRepository, AnchorRecord` = 16+2+12 = 30. `AnchorRepository, NewAnchor` = 16+2+9=27. `AnchorRecord, AnchorState, NewAnchor` = 12+2+11+2+9 = 36. `AnchorRepository, AnchorState` = 16+2+11 = 29. `AnchorRepository, AnchorRecord, NewAnchor` = 16+2+12+2+9 = 41. That's exactly 41!

So line 1 = `import { AnchorRepository, AnchorRecord, NewAnchor } from './anchor.repository';`

Let me double-check: columns 1-9 = `import { `, columns 10-25 = `AnchorRepository` (16 chars: 10..25), `,`=26, ` `=27, `AnchorRecord`=28..39 (12 chars), `,`=40, ` `=41, `NewAnchor`=42..50 (9 chars), ` `=51, `}`=52, ` `=53, `from`=54..57, ` `=58, `'`=59.

So the import structure of the original file:
```ts
1: import { AnchorRepository, AnchorRecord, NewAnchor } from './anchor.repository';
2: import { DuplicateAnchorError } from './anchor.repository';
3: import { ChainClient, ... } from './chain';         // column 53
4: import { hashContent } from './canonical';          // column 29? let me check
5: import { CanonicalizationError } from './canonical'; // column 39?
...
35: import ... from './anchor.repository';  // ??? another import at line 35
```

Line 4 column 29: `import { X } from './canonical';` — quote at column 29. By the same math: names end at column 29-9=20, so names span columns 10-20 = 11 chars. `hashContent` is 11 chars! So line 4 = `import { hashContent } from './canonical';`

Check: `import { ` (1-9), `hashContent` (10-20), ` } from ` (21-28: space=21, }=22, space=23, f=24,r=25,o=26,m=27, space=28), `'`=29. ✓

Line 5 column 39: names span columns 10 to 39-9=30 → 21 chars. `CanonicalizationError` is 21 chars! So line 5 = `import { CanonicalizationError } from './canonical';`

Check: `import { ` (1-9), `CanonicalizationError` (10-30), ` } from ` (31-38), `'`=39. ✓

Line 3 column 53: names span columns 10 to 53-9=44 → 35 chars. From `chain.ts`: candidates: `ChainClient, TxIdentity` = 11+2+10 = 23. `ChainClient, AnchorTx, TxIdentity` = 11+2+9+2+10 = 34. `ChainClient, TxIdentity, AnchorTx` = 11+2+10+2+9 = 34. `ChainClient, AnchorTx, Receipt` = 11+2+9+2+8=32. `ChainClient, TxIdentity, Receipt` = 11+2+10+2+8 = 33. `ChainClient, Receipt, TxIdentity` = 33. Hmm, 35? `ChainClient, AnchorTx, TxIdentity, ...` no. What about including a type keyword? `ChainClient, type AnchorTx, TxIdentity`? That's 11+2+5+9+2+10 = 39. No.

Hmm, maybe `AnchorTx, ChainClient, TxIdentity` = 9+2+11+2+10 = 34. Close but not 35.

Maybe the import is `import { type ChainClient, ... }`? Or maybe line 3 imports from chain with different names. What else does the service need from chain.ts? `ChainClient` (for the constructor), `AnchorTx` (to construct the prepare input — though it could be typed inline), `TxIdentity` (for the prepare result), `Receipt` (for the getReceipt result).

35 chars... let me try `ChainClient, TxIdentity, AnchorTx` = 11+2+10+2+9 = 34. `TxIdentity, ChainClient, AnchorTx` = 10+2+11+2+9 = 34. `ChainClient, AnchorTx, TxIdentity` = 34. Hmm all 34.

What if there's a `type` keyword somewhere? `type ChainClient, AnchorTx, TxIdentity` = 5+11+2+9+2+10 = 39. No.

What if line 3 also imports `Receipt`? `ChainClient, AnchorTx, TxIdentity, Receipt` = 11+2+9+2+10+2+8 = 44. No, too long.

Hmm, what if the import list is `ChainClient, TxIdentity` (23) — then quote would be at column 10+23+8 = 41. Not 53.

Let me recompute the formula. For `import { NAMES } from 'MOD';`:
- `import { ` = 9 chars → columns 1-9
- NAMES starts at column 10
- After NAMES: ` } from ` = 8 chars (space, }, space, f, r, o, m, space)
- Quote at column 10 + len(NAMES) + 8 = 18 + len(NAMES)

Line 3: quote at 53 → len(NAMES) = 35.
Line 4: quote at 29 → len(NAMES) = 11 → `hashContent` ✓
Line 5: quote at 39 → len(NAMES) = 21 → `CanonicalizationError` ✓
Line 2: quote at 38 → len(NAMES) = 20 → `DuplicateAnchorError` ✓
Line 1: quote at 59 → len(NAMES) = 41 → `AnchorRepository, AnchorRecord, NewAnchor` ✓

So line 3's NAMES is exactly 35 chars. Options from chain.ts exports {TxIdentity(10), Receipt(8), ChainClient(11), AnchorTx(9), FakeChainClient(15)}:
- 2 items: a+b+2 = 35 → a+b=33: 15+... no pair sums to 33 (11+10=21, 11+15=26, 10+15=25, ...). No.
- 3 items: a+b+c+4 = 35 → sum=31: 11+10+9=30, 11+10+8=29, 11+9+8=28, 10+9+8=27, 15+... 15+10+... no. No triple sums to 31. Hmm: 11+10+9 = 30, +4 = 34. Close.
- With `type` prefix: e.g., `ChainClient, type AnchorTx, TxIdentity` → 11+2+5+9+2+10 = 39. No.

Hmm, none fit exactly 35. So my reconstruction of line 3's exact contents is off — perhaps it imports something else, or the file uses `import type` differently. E.g., `import { ChainClient } from './chain';` would put the quote at column 18+11=29. Not 53.

Maybe line 3 is: `import { ChainClient, TxIdentity as ... }`? Unlikely.

Or maybe the chain.ts exports include a longer name. The plan says `interface TxIdentity { txId: string; signedTx: string }`. What if the actual file named it differently? I can't see it.

Or maybe line 3 imports from chain with a default + named? No, the plan says interface/class.

OK — key insight: I don't need to reproduce the original file exactly. I need to write a *correct, complete* `anchor.service.ts` that (a) satisfies the plan, (b) compiles given the other files as they exist. The exact column positions of the original imports don't constrain my rewrite — the errors just tell me which modules I need to import and that they need `.js` extensions. The instruction is: "rewrite `src/anchor/anchor.service.ts` completely, fixing what these messages require of this file."

What the messages require of this file:
1. All relative imports must use explicit `.js` extensions (TS2835 explicitly says "Did you mean './chain.js'?" and "./canonical.js"; TS2307 for './anchor.repository' is fixed the same way — the file exists as `anchor.repository.ts`).

That's it for *this* file. The other errors (Prisma exports, repository `error` unknown, test file issues) are in other files — "change nothing the messages don't name" and I'm only rewriting this one file.

But wait — there's a subtlety. The TS2307 errors on `./anchor.repository` (not TS2835) might mean the module genuinely can't be found even with extension... but `anchor.repository.ts` exists in the same directory. Under node16 resolution, `./anchor.repository.js` resolves to `anchor.repository.ts`. So adding `.js` fixes it. The difference between TS2307 and TS2835 might just be a quirk of how the compiler reports (maybe TS2835 is only suggested for certain cases, or the error list is from a state where... whatever). The fix is the same.

Hmm, actually wait. Let me reconsider: could TS2307 for `./anchor.repository` be because the import is inside a file that's... no. Or maybe lines 1/2 are `import type { ... } from './anchor.repository'`? No, resolution is the same.

Actually, you know what — I bet the distinction is this: TS2835 ("Did you mean './chain.js'?") is emitted when the extensionless specifier *would* resolve under a different resolution mode. For `./anchor.repository`, maybe the compiler couldn't even find `anchor.repository.ts` for the suggestion because... it exists. Hmm.

Or — the original file might have had a typo like `./anchor.repositories` or `./anchor-repository`? No, the error message says "Cannot find module './anchor.repository'" — that's the exact specifier.

Let me not overthink this. The fix for all six: use `.js` extensions. All three target files exist (`anchor.repository.ts`, `chain.ts`, `canonical.ts` — all referenced in the error list or plan).

Now, another consideration: the test file errors reference the service's types:
- `test/anchor.service.spec.ts(113,5): error TS2740: Type 'Promise<Row | null>' is missing the following properties from type 'Row': id, documentId, version, contentHash, and 4 more.` — this is in the test file; it suggests the test's fake repository has a `findUnique` returning `Promise<Row | null>` assigned to something expecting `Row`. Not my file's problem.
- `test/anchor.service.spec.ts(159,42): error TS2339: Property 'state' does not exist on type 'never'.` and (160,42) 'txId' — the test narrows to `never`, probably because of a discriminated union or type mismatch in the test's fake. Not my file.
- `test/anchor.service.spec.ts(430,71): error TS2322: Type 'null' is not assignable to type 'string | undefined'.` — Hmm, this suggests somewhere the test passes `null` where `string | undefined` is expected. Could be related to my service's types? E.g., if `AnchorProof.blockNumber` is... no. Or the test constructs a `NewAnchor` or `AnchorRecord` with `txId: null` where my type says `string | undefined`. Per the plan, `AnchorRecord.txId: string | null` and `NewAnchor.txId: string | undefined`? The plan says:

```
- `interface AnchorRecord { id: string; documentId: string; version: number; contentHash: string; content: string; txId: string | null; state: AnchorState; blockNumber: number | null }`
- `interface NewAnchor { documentId: string; version: number; contentHash: string; content: string; txId: string | null; state: AnchorState }`
```

Both `txId: string | null`. And the test error at 430,71 says `Type 'null' is not assignable to type 'string | undefined'` — that's in the test file, and I can't fix it from my file unless... hmm. If the shape causing it is in my service's types, I could adjust. But per the plan, `txId: string | null`. The test error suggests the test passes `null` to something typed `string | undefined`. What in my service API takes `string | undefined`? The repository's `updateState` patch: `{ state?: AnchorState; txId?: string; blockNumber?: number | null }` — there `txId?: string` means `string | undefined`. If the test calls `updateState(id, { txId: null })`... but that's the repository's type, not mine.

I shouldn't chase test file errors — they're in other files, and the task says fix what the messages require *of this file*. The messages for this file are only the six module resolution errors.

So my rewrite: same logical content as before (per plan), with `.js` extensions on imports. Since I can't see the original file, I'll reconstruct it faithfully from PLAN.md and add `// ASSUMPTION:` lines for shapes I can't verify.

Now let me design the file content per the plan:

```ts
import { AnchorRepository, AnchorRecord, NewAnchor, AnchorState, DuplicateAnchorError } from './anchor.repository.js';
import { ChainClient, AnchorTx, TxIdentity, Receipt } from './chain.js';
import { hashContent, CanonicalizationError } from './canonical.js';
```

Wait — but the manifest says the service reads `anchor.repository.ts` and `canonical.ts`. Does the service import from `chain.ts`? The original file's line 3 imports from `./chain` (per the error). Yes, the service needs `ChainClient`, `AnchorTx`, etc. The manifest line for the service says "reads: src/anchor/anchor.repository.ts, src/anchor/canonical.ts" — it omits chain.ts, but the compiler errors prove the service imports from `./chain`. The manifest may be incomplete; the actual file (per errors) imports chain. I'll keep the chain import — it's required for the `ChainClient` type in the constructor.

Hmm wait, actually could the service get `ChainClient` via a re-export from the repository? The manifest says the repository reads chain.ts. So the service could import `ChainClient` from `./anchor.repository.js` if the repository re-exports it. But the error at line 3 of the service is `Did you mean './chain.js'?` — so the original file imported from `./chain` directly. I'll do the same.

Now, which names to import from where:
- From `./anchor.repository.js`: `AnchorRepository` (class, for constructor), `AnchorRecord`, `NewAnchor`, `AnchorState` (types), `DuplicateAnchorError` (error class — per manifest, defined in the repository file; the service re-exports or just uses it).
- From `./chain.js`: `ChainClient`, `AnchorTx`, and possibly `TxIdentity`, `Receipt` (for local typing).
- From `./canonical.js`: `hashContent`, `CanonicalizationError`.

The service file also defines and exports (per manifest): `AnchorService`, `AnchorProof`, `MismatchReport`, `VerifyResult`, `ResourceNotFoundError`.

Now let me write the logic per plan section 4:

State machine: `pending → broadcasting → confirmed`, `broadcasting → failed` on terminal error.

`anchorDocument(documentId, version, content)`:
1. Hash content (outside any transaction). — `const contentHash = hashContent(content);` and also keep the canonical string? The plan says store `content` as "raw JSON string of structured content". Hmm — should I store the canonical form or the raw input? The plan says `content` String — "raw JSON string of structured content (source of truth)". For verify to recompute, we only need the hash. Storing canonical JSON makes sense (deterministic). I'll store `canonicalize(content)`. Wait, but the plan says "raw JSON string". Hmm. Let me think: `hashContent` = SHA-256 of canonicalize(content). For storage, storing the canonical form is safest (it's what was hashed). But "raw JSON string" might mean `JSON.stringify(content)`.

Actually, for verify: we recompute the hash from the provided content and compare to the stored `contentHash`. We don't need the stored content at all for verify. The stored content is for audit (to show what was anchored). Storing the canonical form is more defensible: it's exactly what was hashed. But the plan says "raw JSON string of the structured content".

Hmm, I have to pick. The plan's data model says: `content` String — "raw JSON string of structured content (source of truth)". I'll store the canonicalized JSON string — no wait, "raw" suggests non-canonical. But then if the input has different key order, the stored string differs from what was hashed...

Let me reconsider: maybe I should compute `const canonical = canonicalize(content)` and `const contentHash = hashContent(canonical)`? But per the plan, `hashContent(value: unknown)` takes unknown and canonicalizes internally. So I'd call `canonicalize` and `hashContent` separately, or just store `canonicalize(content)`.

I think the cleanest is:
```ts
const canonical = canonicalize(content); // throws CanonicalizationError on bad input
const contentHash = hashContent(canonical);
```
Wait but `hashContent` canonicalizes its input; if I pass an already-canonical string, it would JSON-stringify the string (adding quotes and escaping). That's wrong! `hashContent(canonical)` where canonical is a string would hash `JSON.stringify(canonicalString)` = the quoted string. That's not what we want.

So: either (a) call `hashContent(content)` on the original value and separately `canonicalize(content)` for storage, or (b) compute canonical once and hash the canonical string directly with crypto.

Per plan, `hashContent(value: unknown): string` — "returns SHA-256 hex of canonicalize(value)". So `hashContent(content)` is the hash. For storage, `canonicalize(content)` gives the canonical string. Calling both means double-canonicalizing (fine, cheap) — or I could import `canonicalize` too and do:

```ts
const canonicalContent = canonicalize(content);
const contentHash = hashContent(canonicalContent) // WRONG if hashContent canonicalizes again
```

Hmm. Unless `hashContent` detects string input? I can't see canonical.ts. The plan says `hashContent(value: unknown)` returns SHA-256 of `canonicalize(value)`. If value is a string, canonicalize(string) = JSON.stringify of the string = quoted. So passing a pre-canonicalized string to hashContent would double-encode.

Safest: call `hashContent(content)` directly on the original content for the hash, and `canonicalize(content)` for the stored string. Both take `unknown`. This works regardless of internal implementation details:

```ts
const contentHash = hashContent(content);      // throws CanonicalizationError if not serializable
const canonicalContent = canonicalize(content); // same content, canonical form for storage
```

But wait — is it guaranteed that `canonicalize` throws on the same inputs as `hashContent`? Per plan, both throw `CanonicalizationError` on non-serializable. Fine.

Order: hash first (to fail fast before any DB write) — plan step 1 is "hash content (outside any transaction)". Then step 2: create row with `state=pending`, `txId=null`.

Hmm wait, actually per plan: "2. `create` a row with `state=pending`, `txId=null` (transaction 1: insert only). 3. `prepare` ... 4. `updateState` to `{txId, state=broadcasting}` (transaction 2). 5. `broadcast(signedTx)`. If it rejects, row stays `broadcasting` (limbo); do not mark failed here. 6. Return proof once confirmed; if not yet confirmed, return proof with current known fields (txId set, blockNumber pending) — worker completes it."

Hmm, step 6 is confusing: "return proof once confirmed; if not yet confirmed, return proof with current known fields (txId set, blockNumber pending)". But `AnchorProof` per plan is `{ documentId, version, contentHash, txId, blockNumber: number }` — blockNumber is `number`, not nullable. So how do we return a proof with "blockNumber pending"?

Hmm. Let me re-read: "`anchorDocument(documentId, version, content): Promise<AnchorProof>` — raises CanonicalizationError (bad content), DuplicateAnchorError (already anchored)."

And `AnchorProof { documentId: string; version: number; contentHash: string; txId: string; blockNumber: number }`.

If broadcast is async and the worker confirms later, `anchorDocument` can't return a confirmed proof immediately... unless `anchorDocument` itself waits for confirmation? The plan's control flow says step 5 broadcast, step 6 "return proof once confirmed; if not yet confirmed, return proof with current known fields (txId set, blockNumber pending) — worker completes it."

This is ambiguous. Options:
(a) `anchorDocument` broadcasts and then polls `getReceipt` until confirmed (with some bound)? The plan doesn't mention polling in anchorDocument.
(b) `AnchorProof.blockNumber` is actually `number | null` and the plan's interface listing is loose.
(c) `anchorDocument` returns the proof with blockNumber from... hmm.

Wait, the test error might help: `test/anchor.service.spec.ts(113,5): error TS2740: Type 'Promise<Row | null>' is missing the following properties from type 'Row': id, documentId, version, contentHash, and 4 more.` — "and 4 more" → Row has 8 properties: id, documentId, version, contentHash, +4 = 8 total. AnchorRecord per plan has: id, documentId, version, contentHash, content, txId, state, blockNumber = 8. ✓ So the test's Row matches AnchorRecord shape (8 fields).

And `test/anchor.service.spec.ts(159,42)/(160,42)`: `Property 'state' does not exist on type 'never'` / `'txId'` — the test at lines 159-160 accesses `.state` and `.txId` on something narrowed to `never`. Probably the test does something like:
```ts
const row = await fake.rows.find(...); // Row | undefined
expect(row!.state)... 
```
Hmm, `never` arises from unsatisfiable narrowing, e.g., after `if (!row) throw`, row is Row... or from a discriminated union where the discriminator doesn't match. I can't tell. Not my file's problem per se — unless my exported types cause it. E.g., if the test does `const result = await service.anchorDocument(...)` and my return type is a union, and it narrows... I can't know.

Let me focus: my file must compile on its own given the other files. The test file errors are pre-existing issues in the test file (which I'm told not to change — "change nothing the messages don't name" — well, the messages do name the test file, but the task says rewrite only `src/anchor/anchor.service.ts`; "reply with the complete contents of src/anchor/anchor.service.ts in a single fenced block and nothing else"). So I only produce this one file.

Given that, my constraints:
1. Use `.js` extensions on relative imports.
2. Faithfully implement the plan.
3. Add `// ASSUMPTION:` lines where I'm assuming shapes I can't see.

Now, the `AnchorProof.blockNumber` issue: the plan says `blockNumber: number`. If `anchorDocument` returns before confirmation, we don't have a block number. The plan's step 6 says "return proof with current known fields (txId set, blockNumber pending)". "blockNumber pending" contradicts `number`.

Resolution options:
- Make `AnchorProof.blockNumber` be `number | null`? That deviates from the plan's interface.
- Have `anchorDocument` wait for confirmation: after broadcast, do a confirmation check (getReceipt) — if confirmed, return full proof; otherwise... still no block.

Hmm, actually maybe the intended flow is: `anchorDocument` broadcasts, and in the fake/tests, the receipt is available immediately (FakeChainClient has pre-configured receipts). So `anchorDocument` could do one confirmation attempt after broadcast: call `getReceipt(txId)`, and if found with block → confirmed, return proof; otherwise → return proof with... what?

Let me look at the plan's test list:
- "`anchorDocument` persists a row with `txId` set and `state=broadcasting` before `broadcast` is called (asserts on repository state observed by the fake, not just that broadcast was invoked)."

So after `anchorDocument` returns, the row is in `broadcasting` state (not confirmed)! "persists a row with txId set and state=broadcasting before broadcast is called" — the assertion is about ordering (txId persisted before broadcast), observed via the fake. And the crash-safety test: "a fake whose broadcast throws ... leaves the row in broadcasting with a valid txId; a subsequent runRecoverySweep confirms it".

So `anchorDocument` does NOT wait for confirmation — it returns while the row is in `broadcasting`. Then what does it return as `AnchorProof`? The plan says "return proof with current known fields (txId set, blockNumber pending)".

So `AnchorProof.blockNumber` must be nullable in practice... or the proof returned by anchorDocument has blockNumber as `null`. The plan's interface says `blockNumber: number` — but that's for the *confirmed* proof (e.g., what `verify` returns).

Hmm, wait. Let me re-read the plan's verify: "`verify(documentId, version, content)` — recomputes hash and returns anchoring proof (txId, block) or mismatch report." And `VerifyResult = { ok: true; proof: AnchorProof } | { ok: false; mismatch: MismatchReport }`. If the anchor isn't confirmed yet, verify would... return a proof without block? Or the plan assumes verified anchors are confirmed.

I think the pragmatic resolution is: `AnchorProof.blockNumber: number | null`. This satisfies "blockNumber pending" (null) and confirmed proofs (number). This is a deviation from the plan's literal `blockNumber: number`, but the plan's own control flow (step 6) requires a pending block number. Per instructions: "if satisfying the compiler seems to require dropping something the plan specified, keep the plan and add one // ASSUMPTION: line stating what you couldn't reconcile."

Hmm, but does the *compiler* require it? The compiler errors in my file are only about imports. So strictly, I could keep `blockNumber: number` and... then what does anchorDocument return? It can't return a number it doesn't have. It could return `0`? That's wrong/misleading. Or anchorDocument blocks until confirmed — but the tests expect the row to remain in `broadcasting` after anchorDocument (per test description: "leaves the row in broadcasting" — well, that's for the crash case where broadcast throws).

Hmm wait, actually let me re-read the test: "`anchorDocument` persists a row with `txId` set and `state=broadcasting` before `broadcast` is called (asserts on repository state observed by the fake, not just that broadcast was invoked)."

This asserts ordering: at the moment broadcast is called, the row already has txId + broadcasting. It doesn't say what state the row is in after anchorDocument returns. If anchorDocument waits for confirmation (polling getReceipt), then after return the row would be confirmed (in the fake, receipts are pre-configured). That's consistent with this test too.

And the crash test: broadcast throws → row stays broadcasting → recovery confirms. Also consistent.

So option (a): `anchorDocument` after broadcast, polls/awaits receipt until confirmed, then returns full proof with blockNumber. But the plan explicitly says "the worker completes it" — suggesting anchorDocument does NOT wait. And "return proof with current known fields (txId set, blockNumber pending) — worker completes it."

Ugh. The plan is self-contradictory between `AnchorProof.blockNumber: number` and "blockNumber pending".

Given the instruction hierarchy: plan governs; don't drop requirements to silence errors; if compiler forces a deviation, keep the plan + ASSUMPTION line. The compiler doesn't force anything here (my file's errors are only imports). So I should implement the plan as literally as possible. The literal interface is `blockNumber: number`. The literal control flow says return with pending block. These conflict; I have to pick one and note it.

Which pick lets the file compile and be coherent?
- Pick 1: `AnchorProof.blockNumber: number | null`. anchorDocument returns `{..., blockNumber: null}` when not yet confirmed; verify returns the actual number (or also null if unconfirmed?). The plan's interface is slightly modified.
- Pick 2: `AnchorProof.blockNumber: number`. anchorDocument must obtain the block number before returning → it waits for confirmation (e.g., a bounded poll loop, or a single getReceipt call). If not confirmed after broadcast... it can't return a valid proof. It could loop until confirmed — but in the crash scenario (broadcast throws), it doesn't reach that. In the normal fake, receipts exist so a single getReceipt after broadcast would confirm. But "worker completes it" is dropped.

Hmm, hmm. Let me look at the plan's test list once more:
- "`runConfirmationPass` advances a `broadcasting` row to `confirmed` with the receipt's block number, and leaves it unchanged if the receipt isn't found yet." — so there are scenarios where a broadcasting row has no receipt yet; the confirmation pass leaves it. If anchorDocument waited for confirmation, it would be stuck in such a scenario (or need a poll loop with timeout).
- "`verify` returns `{ok:true, proof}` with matching hash, correct `txId` and `blockNumber`." — verify returns blockNumber, implying the anchor is confirmed by then.

I think Pick 1 (`number | null`) is the coherent reading: the proof carries `blockNumber: number | null`, null while pending. The plan's interface listing (`blockNumber: number`) describes the confirmed shape. I'll go with `number | null` and add an `// ASSUMPTION:` line explaining the reconciliation.

Wait, actually, hold on. Let me reconsider — maybe I'm overcomplicating. Let me re-read plan step 6: "return proof once confirmed; if not yet confirmed, return proof with current known fields (txId set, blockNumber pending) — worker completes it."

Another reading: maybe `anchorDocument` DOES try to confirm inline (one getReceipt after broadcast), and "if not yet confirmed" is the fallback. Either way, the fallback needs a nullable blockNumber. So `number | null` it is.

Hmm but then verify: if the anchor exists but isn't confirmed, what does verify return? Options: return proof with blockNumber null (ok:true), or... The plan says verify returns "anchoring proof (txId, block) or mismatch report". If not confirmed, no block. I'll return `{ok: true, proof: {..., blockNumber: null}}` — the hash matches and it's anchored (txId exists). Actually wait — should verify require confirmation? The purpose: "auditors can verify integrity years later" — by then it's confirmed. But for robustness, returning the proof with null block when unconfirmed seems right; the hash match is the integrity check. I'll do that and note it in an assumption if needed.

Now, `DuplicateAnchorError` — per manifest, defined in `anchor.repository.ts`. The service imports it (line 2 of the original file: `import { DuplicateAnchorError } from './anchor.repository'` — matches my column calc!). The service's `anchorDocument` "raises DuplicateAnchorError (already anchored)" — by calling `repo.create`, which throws on unique violation. But also: what if the row already exists with state confirmed? `create` would throw DuplicateAnchorError via unique constraint. Good — the schema-level enforcement is the unique index; the repository translates P2002 into DuplicateAnchorError.

But should the service also check `findUnique` first for a friendlier path? The plan says create throws on unique violation; the repository handles it. But there's a race: two concurrent anchorDocument calls — one wins, the other gets DuplicateAnchorError. Fine.

Hmm wait, but there's a subtlety: what if the existing row is in `failed` state? Should re-anchoring be allowed? The plan says "exactly one anchor per (document, version), enforced at the schema level" — so no, even failed rows block new anchors. The unique index enforces it. OK, simple: always `create`; on DuplicateAnchorError, rethrow (the service "raises DuplicateAnchorError").

Actually wait — should the service catch and rethrow, or let it propagate? Let it propagate from repo.create. The plan says anchorDocument raises it — propagation satisfies that.

Now `ResourceNotFoundError` — defined in the service (per manifest). verify raises it when no anchor exists.

Now `runConfirmationPass`:
```ts
async runConfirmationPass(): Promise<number> {
  const rows = await this.repo.findByState('broadcasting');
  let confirmed = 0;
  for (const row of rows) {
    if (!row.txId) continue; // shouldn't happen for broadcasting, but guard
    const receipt = await this.chain.getReceipt(row.txId);
    if (receipt.found && receipt.blockNumber != null) {
      await this.repo.updateState(row.id, { state: 'confirmed', blockNumber: receipt.blockNumber });
      confirmed++;
    }
  }
  return confirmed;
}
```

Wait — the plan says "per broadcasting row, in its own transaction" — but the repository's `updateState` is a single Prisma update (its own implicit transaction). The service has zero Prisma calls, so "transaction" is a repository concern. Fine.

Also, should confirmation pass use `receipt.txId` to validate? The receipt has a txId field. We could check `receipt.txId === row.txId`. Hmm, the plan doesn't say. Keep it simple: `found && blockNumber != null` → confirm. Maybe validate txId match as a safety? The plan's step: "1. getReceipt(txId). 2. If found && blockNumber != null: updateState to {state=confirmed, blockNumber}. 3. Otherwise: leave as broadcasting." I'll follow exactly.

`runRecoverySweep` per plan:
"1. Re-prepare from stored deterministic inputs to recover txId (same as stored; validate). 2. getReceipt(txId). 3. If found with block: confirm. If found without block: leave broadcasting. If not found: broadcast likely never landed — re-broadcast recovered signedTx; if it rejects, set state=failed."

```ts
async runRecoverySweep(): Promise<number> {
  const rows = await this.repo.findByState('broadcasting');
  let resolved = 0;
  for (const row of rows) {
    const tx: AnchorTx = { documentId: row.documentId, version: row.version, contentHash: row.contentHash };
    const { txId, signedTx } = this.chain.prepare(tx);
    if (row.txId && txId !== row.txId) {
      // determinism violation — plan says "same as stored; validate". What to do on mismatch?
      // ASSUMPTION: leave the row unchanged (do not act on an identity we can't trust).
      continue;
    }
    const receipt = await this.chain.getReceipt(txId);
    if (receipt.found && receipt.blockNumber != null) {
      await this.repo.updateState(row.id, { state: 'confirmed', blockNumber: receipt.blockNumber });
      resolved++;
    } else if (receipt.found) {
      // found but no block yet: leave broadcasting
    } else {
      // not found: re-broadcast
      try {
        await this.chain.broadcast(signedTx);
        // after re-broadcast, the anchor may land; leave as broadcasting for the confirmation pass?
        // or count as resolved? Hmm.
      } catch {
        await this.repo.updateState(row.id, { state: 'failed' });
        resolved++;
      }
    }
  }
  return resolved;
}
```

Hmm, "returns the count of resolutions". What counts as "resolved"? Confirmed (chain had it), or failed (terminal). Re-broadcast success → the anchor is now in-flight again; is that "resolved"? The limbo was resolved (we know what happened: it never landed, and we re-sent). I think counting confirmed + failed as resolved is right; a successful re-broadcast leaves it in broadcasting (not yet resolved — waiting for confirmation). Hmm, but then the limbo row is still broadcasting...

Let me think about what's most defensible: "a recovery sweep that resolves anchors stuck in broadcast limbo by querying the chain first." Outcomes:
- Chain has receipt with block → confirmed. Resolved. ✓
- Chain has receipt without block (weird — found but no block; maybe pending in mempool?) → leave broadcasting. Not resolved.
- Chain doesn't have it → the broadcast was lost. Re-broadcast:
  - Re-broadcast succeeds → the tx is in-flight again; still `broadcasting` (correct state!). Resolved? The limbo is cleared (we know it didn't land and re-sent). I'd count it as resolved — the sweep did its job; confirmation pass will finish.
  - Re-broadcast fails → `failed` (terminal). Resolved. ✓

Hmm, but wait: if re-broadcast succeeds and we count it as resolved while the row stays broadcasting, then a subsequent runRecoverySweep would see it again and re-broadcast again (since no receipt yet) → double broadcast! But broadcast is idempotent by txId (deterministic prepare → same txId), so re-broadcasting the same signedTx is harmless (the chain dedupes by txId). Actually that's a nice property: deterministic txId makes re-broadcast idempotent. So it's safe.

Alternatively, to avoid repeated re-broadcasts, we could... the plan doesn't specify a "retriedAt" field. Keep it simple per plan: re-broadcast on not-found; count confirmed and failed as resolved. Hmm, what about successful re-broadcast?

Let me reconsider: "returns the count of resolutions" — I'll count rows whose limbo was definitively cleared: confirmed, failed. Successful re-broadcast → still ambiguous until receipt → not counted. Hmm, but then the sweep "resolves" 0 for a row that it re-broadcast successfully...

Actually, you know what, let me reconsider. The test list says: "`runRecoverySweep` re-derives txId, confirms when the chain reports a block, and sets failed when re-broadcast rejects and no receipt exists." — the tests only check confirm-on-block and fail-on-rebroadcast-reject. So the count semantics for successful re-broadcast aren't pinned by tests. I'll make a choice and document it: count confirmed + failed as resolved; successful re-broadcast leaves the row in `broadcasting` (not counted) — no wait, hmm.

Hmm, let me think about which is less surprising. "runRecoverySweep(): Promise<number> — resolves broadcasting anchors stuck in limbo by querying the chain first; returns count of resolutions." If I re-broadcast successfully, the anchor is no longer "stuck in limbo" — it's freshly in-flight. I'd argue that IS resolved (the limbo state was cleared). And since re-broadcast is idempotent (same txId), subsequent sweeps are harmless.

Decision: count as resolved = confirmed OR failed OR successfully re-broadcast. Hmm, no wait... ugh.

Let me think about the confirmation pass: it polls receipts for broadcasting rows. After a successful re-broadcast, the row is broadcasting and the confirmation pass will pick it up when the receipt appears. So the system converges either way. The count is just a return metric.

I'll go with: resolved = rows that left the limbo with a definitive outcome this pass: confirmed (chain had it), failed (terminal), or re-broadcast dispatched (limbo cleared, in-flight again). Actually — simpler and more defensible: count every row the sweep successfully processed to a decision. Hmm, but "found without block → leave broadcasting" is also a decision (no receipt yet; wait). Should that count? No — it's still stuck.

Final decision:
- confirmed → resolved++
- failed → resolved++
- re-broadcast ok → resolved++ (limbo cleared; idempotent re-broadcast safe)
- found without block → not resolved (still waiting)
- txId mismatch on re-prepare → not resolved, skip (ASSUMPTION line)

Hmm wait, actually, let me reconsider the re-broadcast ok case once more. If I count it as resolved and leave it in broadcasting, a reader of the return value might think "all good, done". But the row is still broadcasting — that's fine, that's a normal in-flight state, same as right after anchorDocument. OK, I'm comfortable: limbo = "broadcast outcome unknown"; after a successful re-broadcast, the outcome is known (we just sent it; it's in-flight). Resolved.

Hmm, one more consideration: after re-broadcast succeeds, should I update the row at all? The txId is the same (deterministic). State stays broadcasting. No update needed. OK.

Now `anchorDocument` in detail:

```ts
async anchorDocument(documentId: string, version: number, content: unknown): Promise<AnchorProof> {
  // 1. Canonical hash, outside any transaction.
  const contentHash = hashContent(content);          // throws CanonicalizationError
  const canonicalContent = canonicalize(content);    // stored as source of truth

  // 2. Persist intent BEFORE any chain call (insert only).
  const newAnchor: NewAnchor = {
    documentId, version, contentHash, content: canonicalContent,
    txId: null, state: 'pending',
  };
  const created = await this.repo.create(newAnchor); // throws DuplicateAnchorError

  // 3. Local deterministic prepare.
  const { txId, signedTx } = this.chain.prepare({ documentId, version, contentHash });

  // 4. Persist tx identity BEFORE broadcast (ordering rule).
  const broadcasting = await this.repo.updateState(created.id, { txId, state: 'broadcasting' });

  // 5. Broadcast; unknown outcome on rejection — leave in broadcasting (limbo).
  try {
    await this.chain.broadcast(signedTx);
  } catch {
    // outcome unknown; recovery sweep will resolve. Do not mark failed.
  }

  // 6. Return proof with current known fields; worker completes confirmation.
  return {
    documentId, version, contentHash,
    txId: broadcasting.txId ?? txId,
    blockNumber: null,
  };
}
```

Wait — but the plan says step 6 "return proof once confirmed; if not yet confirmed, return proof with current known fields (txId set, blockNumber pending)". Should I try a getReceipt after broadcast to see if it's immediately confirmed? The plan's wording "return proof once confirmed" might mean: if confirmed (e.g., receipt already available), return the full proof. Let me add a single best-effort confirmation check:

```ts
  let blockNumber: number | null = null;
  try {
    const receipt = await this.chain.getReceipt(txId);
    if (receipt.found && receipt.blockNumber != null) {
      await this.repo.updateState(created.id, { state: 'confirmed', blockNumber: receipt.blockNumber });
      blockNumber = receipt.blockNumber;
    }
  } catch {
    // receipt lookup failed; worker will retry.
  }
```

Hmm, is that over-engineering beyond the plan? The plan's step 6 says "return proof once confirmed" — implying confirmation can happen within anchorDocument. But the state machine section says "pending → broadcasting → confirmed" and the worker does confirmation. And the test: "`runConfirmationPass` advances a broadcasting row to confirmed" — that test would first create a broadcasting row (via anchorDocument with a fake whose receipt is... available?).

Hmm, if anchorDocument auto-confirms when the receipt is available, then for the confirmation pass test to have a broadcasting row, the fake would need to withhold the receipt initially. The FakeChainClient per plan: "constructor takes an optional config object { broadcastFails?: boolean; receipts: Record<string, Receipt> }". Static receipts. So if a receipt is configured, anchorDocument's inline check would confirm immediately, and the row would never be broadcasting after anchorDocument. Then the confirmation pass test would need to create a broadcasting row some other way (e.g., call repo directly, or use a fake that starts with no receipt and adds one later — but the plan's fake config is static...).

This suggests anchorDocument does NOT do an inline confirmation check — it just returns with blockNumber null, and the worker confirms. The phrase "return proof once confirmed" is... hmm.

You know, I think I'm reading too much into "return proof once confirmed; if not yet confirmed, return proof with current known fields". The semicolon structure: "return [the] proof once confirmed; if not yet confirmed, return [a] proof with current known fields". I now think this describes the general contract: callers eventually get a confirmed proof; if you call before confirmation, you get the pending fields. It's describing the shape of the return value in both cases, not mandating an inline poll.

Simplest, most faithful implementation: no inline getReceipt in anchorDocument. Return `{ documentId, version, contentHash, txId, blockNumber: null }`. The worker confirms. This matches the tests (crash test leaves broadcasting; confirmation pass test can use a row left in broadcasting by anchorDocument with broadcastFails... wait no, if broadcastFails then the row is in limbo and recovery handles it...).

Hmm, for the confirmation pass test: "advances a broadcasting row to confirmed with the receipt's block number". How does the test get a broadcasting row? Via anchorDocument with a fake where broadcast succeeds and receipt is configured → after anchorDocument, row is broadcasting (no inline confirm) → runConfirmationPass → confirmed. ✓ That works cleanly with no inline check. If I had an inline check, that test would need a different setup. So: NO inline confirmation in anchorDocument.

So `AnchorProof.blockNumber: number | null` — anchorDocument returns null; verify returns the stored blockNumber (null if unconfirmed).

Wait, then what does verify do for an unconfirmed anchor? Return `{ok: true, proof: {..., blockNumber: null}}`? The plan's verify test: "returns {ok:true, proof} with matching hash, correct txId and blockNumber" — presumably after confirmation. For unconfirmed, I'll return ok:true with null block (the hash matches; the anchor exists). Or should verify fail/404-ish if unconfirmed? No — resource_not_found is for missing anchors. An unconfirmed anchor exists. I'll return the proof with null block. That's coherent with `blockNumber: number | null`.

Now — controller mapping (not my file, but for consistency): 404 resource_not_found, 409 duplicate_anchor, 400 hash_mismatch. My service raises ResourceNotFoundError and DuplicateAnchorError; the mismatch is a return value (ok:false), not an error. Fine — controller's problem, not mine.

Now types to export from my file (per manifest): `AnchorService`, `AnchorProof`, `MismatchReport`, `VerifyResult`, `ResourceNotFoundError`. Plus I need to import: `AnchorRepository`, `AnchorRecord` (? do I use it? maybe for typing local variables — `const created: AnchorRecord`), `NewAnchor`, `AnchorState` (? do I use it? for typing state literals — I use string literals 'pending'/'broadcasting'/'confirmed'/'failed'; if NewAnchor.state is AnchorState, literals work without importing AnchorState. But I might import it for clarity or to type a local. The original line 1 imported exactly `AnchorRepository, AnchorRecord, NewAnchor` (per my column calc) — NOT AnchorState! And line 2 imported `DuplicateAnchorError`. So the original file didn't import AnchorState. OK, I'll match: import { AnchorRepository, AnchorRecord, NewAnchor } and { DuplicateAnchorError }.

Do I use `AnchorRecord`? Yes: typing the result of findUnique in verify, and rows in the passes. `NewAnchor`: typing the create input. Good.

From chain.js: original line 3 had a 35-char name list. My candidates didn't hit 35 exactly. What I need: `ChainClient` (constructor param type), `AnchorTx` (typing the prepare input — or inline object literal works if prepare's param type is AnchorTx; I don't need to name it), `TxIdentity` (typing prepare result — or let inference do it), `Receipt` (typing getReceipt result — inference). Strictly, I only need to name `ChainClient`. But the original imported 35 chars worth. Possibilities: `ChainClient, AnchorTx, TxIdentity` = 34. Off by one. `ChainClient, TxIdentity, AnchorTx` = 34. Hmm. What if it was `ChainClient, AnchorTx, Receipt` = 32? No. `type ChainClient, AnchorTx, TxIdentity`? = 5+1+11+2+9+2+10 = 40. No.

What if chain.ts has additional exports not in the plan? I can't see it. The instruction says: "if a message references a shape you can't see, say so in an // ASSUMPTION: line rather than repeatedly guessing." The TS2835 message references `./chain.js` — the shape of its exports I can only partially see (via plan). I'll import what I need (`ChainClient`, and `AnchorTx` for explicit typing) and add an ASSUMPTION line noting that I'm assuming the chain.ts exports per PLAN.md since I can't see the file.

Actually — do I even need to name `AnchorTx`? In `runRecoverySweep`, I construct the prepare input: `this.chain.prepare({ documentId: row.documentId, version: row.version, contentHash: row.contentHash })` — the object literal is checked against `AnchorTx` structurally; no import needed. Same in anchorDocument. So minimal: `import { ChainClient } from './chain.js';`. But hmm, the original file imported more (35 chars). It's fine if my rewrite imports fewer — as long as it compiles and satisfies the plan. The plan doesn't mandate specific import lists.

But wait — should I re-export anything? The controller imports from the service (per manifest: controller reads service). The module wires ChainClient → FakeChainClient. Not my concern.

From canonical.js: `hashContent` (line 4, 11 chars ✓) and `CanonicalizationError` (line 5, 21 chars ✓). Do I need to import `CanonicalizationError`? The service "raises CanonicalizationError (bad content)" — by calling hashContent/canonicalize, which throw it. Do I need to name the class? Only if I catch/rethrow or reference the type. I don't catch it. But the original file imported it (line 5). Maybe for a doc comment, or to re-export? Hmm. Maybe the service catches CanonicalizationError from hashContent and rethrows it (
