# 08-grounding.test.ts

## reasoning

```
We need answer user's request: write exactly one file test/grounding.test.ts, complete inside fenced block only. Need analyze requirements. We have plan and read-only grounding.ts. Need produce Vitest tests proving sentence split and grounding gate. Need not add exports/features/files. Need rely on references, no rewrite. Need only file content in one fenced block.

Need understand plan: test/grounding.test.ts reads src/grounding.ts; proves sentence split and grounding gate. Need implement tests using Vitest. TypeScript strict? Tests likely import from "../src/grounding.js"? ESM type module. Need determine import extension. The layout says ESM, type: module. In TS with NodeNext? likely use .js extension for imports in ESM. But plan signatures no import specifiers. We need choose most defensible. Since pnpm, Vitest, ESM. In many NestJS projects with tsconfig moduleResolution bundler? Could import without extension? But ESM Node requires .js. The codebase conventions: TypeScript strict, ESM "type": "module". Likely tests should import from "../src/grounding.js". However if Vitest with esbuild can handle extensionless? In ESM TS, using .js is standard. Need maybe use `import { describe, expect, it } from "vitest";` and `import { GroundingError, groundAnswer, isGrounded, splitSentences, tokenSet } from "../src/grounding.js";`

Need tests: sentence split and grounding gate. Plan section 5 includes:
- `judgeFaithfulness` etc but for grounding.test only: proves sentence split and grounding gate.
- Specific in plan manifest: test/grounding.test.ts | reads: src/grounding.ts | proves sentence split and grounding gate.
Plan data types: splitSentences, tokenSet, isGrounded, groundAnswer. Need test behavior not implementation. Never assert only call happened. Need meaningful assertions.

Need ensure tests align with reference implementation. Let's inspect behavior:
SENTENCE_PATTERN = /[^.!?]*[.!?]+(?:\s*)|[^.!?]+$/g.
For "First. Second! Third? Fourth" matches: "First. ", "Second! ", "Third? ", "Fourth"? Let's test mentally: regex global: [^.!?]*[.!?]+(?:\s*) matches zero or more non sentence chars then one or more punctuation and optional spaces. It will match "First. " including trailing space. Then from index after space? "Second! " etc. Last [^.!?]+$ matches "Fourth". trim filter. Good.
For multiple punctuation: "Hello... World." matches? [^.!?]*[.!?]+(?:\s*) => "Hello..." then maybe trailing? It includes all punctuation, no space after if none. Then " World."? Actually after "Hello..." next char space. [^.!?]* can match " World" then [^.!?]? no, needs punctuation; matches " World." . Good. trim.
For empty string: match returns null -> [].
For only whitespace "   ": pattern? [^.!?]* can match spaces then needs punctuation no; second alternative [^.!?]+$ can match "   "? But $ with /g? Let's think: text "   ". First alternative can't match because no punctuation. Second alternative [^.!?]+$ matches entire string at start? It is anchored to end, but global search starts 0, [^.!?]+ matches spaces to end, so match "   ". Then trim -> "" filter. So returns []. Good.
For no punctuation "hello" -> ["hello"].
For leading punctuation ". hello" -> first alt matches "."? [^.!?]* zero, [^.!?]+ one, optional spaces maybe no? then space remains? Actually input ". hello": match "." at 0, then next " hello" second alt -> " hello". trim -> ["", "hello"]? first "." trim length 1 not empty? It's punctuation only, remains. Hmm splitSentences(". hello") returns [".", "hello"]? Maybe not important.

tokenSet: lowercases, matches [a-z0-9]+, removes stopwords. Note digits kept as tokens, e.g., "4" token. It does not split camel? no.
isGrounded: every content token in sentence must be in sourceTokens. Empty sentence? tokenSet empty -> true. But splitSentences filters empty after trim; punctuation only remains, tokenSet empty => grounded true? Could be issue but not test maybe.
groundAnswer: if sources empty throw GroundingError. Computes union tokens. splits raw, filters grounded. If none kept returns refusal text exactly "not covered by my sources", sentences [], refused true. Else join with space, refused false.

Need tests for sentence split and grounding gate. Could include:
- splitSentences splits on . ! ? and trims.
- splitSentences handles no punctuation, empty, multiple sentences.
- tokenSet lowercases, removes stopwords? Plan says tokenSet is exported. It may be part of grounding gate. We can test it as behavior: content words lowercased, stopwords removed, digits kept. But plan says proves sentence split and grounding gate; tokenSet maybe okay. Need not overdo? It's a test file, can include multiple tests. But discipline: exactly what plan specifies for this file. It says proves sentence split and grounding gate. We can test splitSentences and isGrounded/groundAnswer. tokenSet maybe not necessary but could be used indirectly. Avoid adding features? Tests can be thorough. But don't test implementation details too much? "Test the behaviour, not the implementation." So test splitSentences behavior and grounding gate behavior.

Need ensure tests are deterministic and pass with reference implementation. Let's design test cases carefully.

Test splitSentences:
- `expect(splitSentences("The gate opens. The key is red! What now?")).toEqual(["The gate opens.", "The key is red!", "What now?"]);`
Wait reference includes trailing spaces trimmed; yes.
- `expect(splitSentences("One sentence")).toEqual(["One sentence"]);`
- `expect(splitSentences("")).toEqual([]);`
- `expect(splitSentences("   ")).toEqual([]);`
Potential issue with multiple spaces? `splitSentences("A. B. C.")` -> ["A.", "B.", "C."]. Good.
- Maybe `splitSentences("First... Second.")` -> ["First...", "Second."]? Let's verify: regex first alt matches "First..." (no trailing space). Then space remains. Next match: [^.!?]* can match " Second" then punctuation "." -> " Second." trim -> "Second.". Good. So returns ["First...", "Second."]. Good.
But maybe avoid ellipsis because could be ambiguous. Use simple.

Test grounding gate:
- isGrounded returns true when all content tokens in sourceTokens. Need build sourceTokens via tokenSet or pass Set. We can use tokenSet to avoid manual? But test behavior maybe okay. `const sourceTokens = tokenSet("The ember key opens the gate.");` then `isGrounded("The ember key opens the gate.", sourceTokens)` true. But if using tokenSet, it's implementation? It's exported API. Fine.
- false when unknown token: `isGrounded("The ember key opens the vault.", sourceTokens)` false because vault not in sources.
- case-insensitive: `isGrounded("The EMBER KEY opens the gate.", sourceTokens)` true.
- punctuation stripped: `isGrounded("The ember key, opens the gate!", sourceTokens)`? tokens: ember, key, opens, gate. all present. true.
- digits exact: sourceTokens from "You need 4 shards." tokens: need? is stopword? no, need not in stopwords. 4 token. Sentence "You need 5 shards." tokens: need, 5, shards. 5 not in sourceTokens -> false. But "shards" token present? yes. Good.
- stopword-only sentence? Maybe true, but not necessary. Could be considered grounded but weird. Avoid.

Test groundAnswer:
- Keeps only grounded sentences, drops ungrounded. Example raw: "The ember key opens the gate. The vault needs 5 shards." sources: ["The ember key opens the gate."]; expected text "The ember key opens the gate.", sentences [same], refused false. The second sentence has vault, needs? "needs" not in source, 5 not; dropped.
- Refuses when no sentence grounded: raw "The vault needs 5 shards." sources ["The ember key opens the gate."] -> text "not covered by my sources", sentences [], refused true.
- Throws GroundingError when sources empty: `expect(() => groundAnswer("Anything.", [])).toThrow(GroundingError);` Could also check code? GroundingError has code. Test behavior: `const err = await expect(...).rejects?` It's synchronous throw. Use `expect(() => groundAnswer("Anything.", [])).toThrow(GroundingError);` and maybe `toThrowError`? In Vitest, can assert code via try/catch or `expect(...).toThrow(GroundingError)`. To prove code? Could do:
```
try {
  groundAnswer("Anything.", []);
  expect.unreachable();
} catch (error) {
  expect(error).toBeInstanceOf(GroundingError);
  expect((error as GroundingError).code).toBe("empty_sources");
}
```
But maybe too implementation? Error code is spec. Good. However plan says raises GroundingError if sources empty. Need test.
- Empty raw answer? If rawAnswer "" and sources non-empty: splitSentences [] -> none kept -> refusal. Is that expected? Plan says if none kept, refusal. Could test? Maybe yes: no sentences survive -> refusal. But "sources lack answer yields refusal" in high-level tests maybe answer.test. For grounding, can test `groundAnswer("", ["Source."])` returns refusal. But is that behavior? Yes. Could include.
- Grounded answer joins sentences with single space: raw "A. B." sources containing tokens? Need content tokens. Use simple words not stopwords. But if source tokens include all. Example sources ["alpha beta gamma delta"], raw "Alpha beta. Gamma delta." -> kept both, text "Alpha beta. Gamma delta."? join with space: "Alpha beta. Gamma delta." (there is already period then space from trim? Actually sentences trimmed: "Alpha beta.", "Gamma delta."; join(" ") => "Alpha beta. Gamma delta." Good). Could test.
- It drops ungrounded sentence but keeps others: as above.

Need be careful with stopwords and tokens. Stopwords include the, a, an, is, are, to, of, in, on, you, your, it, that, this, and, or, for, with, be, can, will, has, have. Words like "need", "needs", "shards", "ember", "key", "opens", "gate", "vault" are content. Good.

Potential issue: tokenSet removes stopwords but also any token in stopword set. If sentence contains "not" not stopword; source must contain not. Avoid unknown stopwords? We can use simple.

Need ensure tests do not rely on exact internal regex beyond spec: sentence = maximal run ending in . ! ? plus trailing whitespace. So tests can assert that.

Need file structure:
```
import { describe, expect, it } from "vitest";

import {
  GroundingError,
  groundAnswer,
  isGrounded,
  splitSentences,
  tokenSet,
} from "../src/grounding.js";

describe("splitSentences", () => {
  it("splits text on sentence-ending punctuation and trims each sentence", () => {
    expect(splitSentences("The gate opens. The key is red! What now?")).toEqual([
      "The gate opens.",
      "The key is red!",
      "What now?",
    ]);
  });

  it("keeps a single sentence without terminator", () => {
    expect(splitSentences("The gate opens")).toEqual(["The gate opens"]);
  });

  it("returns an empty array for empty or whitespace-only text", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   ")).toEqual([]);
  });

  it("splits multiple sentences separated by spaces", () => {
    expect(splitSentences("Alpha beta. Gamma delta. Epsilon zeta?")).toEqual([
      "Alpha beta.",
      "Gamma delta.",
      "Epsilon zeta?",
    ]);
  });
});

describe("isGrounded", () => {
  const sourceTokens = tokenSet("The ember key opens the gate. You need 4 shards.");

  it("returns true when every content token appears in the sources", () => {
    expect(isGrounded("The ember key opens the gate.", sourceTokens)).toBe(true);
    expect(isGrounded("You need 4 shards.", sourceTokens)).toBe(true);
  });

  it("is case-insensitive and ignores punctuation", () => {
    expect(isGrounded("The EMBER KEY, opens the gate!", sourceTokens)).toBe(true);
  });

  it("returns false when a content token is missing from the sources", () => {
    expect(isGrounded("The ember key opens the vault.", sourceTokens)).toBe(false);
  });

  it("returns false when a quantity differs from the sources", () => {
    expect(isGrounded("You need 5 shards.", sourceTokens)).toBe(false);
  });
});

describe("groundAnswer", () => {
  it("keeps grounded sentences and drops ungrounded sentences", () => {
    const sources = ["The ember key opens the gate."];
    const raw = "The ember key opens the gate. The vault needs 5 shards.";

    expect(groundAnswer(raw, sources)).toEqual({
      text: "The ember key opens the gate.",
      sentences: ["The ember key opens the gate."],
      refused: false,
    });
  });

  it("refuses when no sentence is grounded", () => {
    const sources = ["The ember key opens the gate."];
    const raw = "The vault needs 5 shards.";

    expect(groundAnswer(raw, sources)).toEqual({
      text: "not covered by my sources",
      sentences: [],
      refused: true,
    });
  });

  it("refuses when the raw answer has no sentences", () => {
    expect(groundAnswer("", ["The ember key opens the gate."])).toEqual({
      text: "not covered by my sources",
      sentences: [],
      refused: true,
    });
  });

  it("throws GroundingError when sources are empty", () => {
    try {
      groundAnswer("The ember key opens the gate.", []);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(GroundingError);
      expect((error as GroundingError).code).toBe("empty_sources");
    }
  });
});
```

Need consider `expect.unreachable()` in Vitest? It exists? Vitest has `expect.unreachable()`? I think yes? In Jest, `expect.anything` etc. `expect.unreachable()` is in Vitest? Let's verify: Vitest has `expect.unreachable()` maybe. But to be safe, use `expect.assertions`? Or simpler:
```
const promise = ... no sync.
expect(() => groundAnswer(...)).toThrow(GroundingError);
```
But to assert code, can use:
```
const error = groundAnswer("...", []) as never; // not.
```
Better:
```
let thrown: unknown;
try { groundAnswer(...); } catch (error) { thrown = error; }
expect(thrown).toBeInstanceOf(GroundingError);
expect((thrown as GroundingError).code).toBe("empty_sources");
```
This avoids expect.unreachable. But if no throw, thrown undefined, toBeInstanceOf fails. Good.
Could also use `expect(() => groundAnswer(...)).toThrow(GroundingError);` and separate code? Can't get error. Use try/catch.

Need TypeScript strict: `thrown` type unknown, cast. Good.

Potential issue with import path extension. Need decide. Since ESM and Node 20, likely `.js`. But if project uses Vitest and tsconfig moduleResolution bundler, extensionless may be accepted. The plan layout doesn't specify. The read-only reference files are at workspace/src/grounding.ts, tests likely in test/grounding.test.ts. In many NestJS ESM projects, imports use `.js`. The conventions say ESM, "type": "module". So use `.js` to be defensible. But if they run Vitest with tsconfig module: ESNext, moduleResolution: bundler, extensionless also works. `.js` works in bundler too? Yes TS allows .js mapping to .ts. Vitest resolves .js to .ts? With Vite, yes likely. If no allowImportingTsExtensions, .js is safe. Use `../src/grounding.js`.

Need ensure no extra exports. Test file no export. Good.

Need maybe include `tokenSet` tests? The plan says proves sentence split and grounding gate. tokenSet is part of tokenization but not necessarily required. Including isGrounded with tokenSet uses it. Could add direct tests for tokenSet? It might be beyond "sentence split and grounding gate"? But tokenSet is exported in plan; testing it could prove grounding gate behavior (stopwords, digits). But "Do not add a feature" doesn't forbid extra tests? It says implement exactly what plan specifies for this file. The plan manifest only high-level. Section 5 includes specific tests but not all for grounding? It lists tests across files: "proves sentence split and grounding gate" only. Could include tokenSet tests if they prove grounding gate. But maybe keep focused.

Need think about potential hidden evaluator: They may run tests against reference implementation. Need all pass. Let's verify each assertion against reference exactly.

1. splitSentences("The gate opens. The key is red! What now?")
Regex: Let's simulate precisely.
Input indices:
0 T... "The gate opens" then . at 14? match1 [^.!?]* matches "The gate opens" (no punctuation), [^.!?]+ matches ".", optional \s* matches " " after period. So match "The gate opens. ". trim -> "The gate opens."
Next start after space at index 16? "The key is red! What now?" match2 [^.!?]* "The key is red" then ! and space -> trim "The key is red!". match3 [^.!?]* "What now" then ? no trailing space -> trim "What now?". Good.

2. splitSentences("The gate opens") -> second alternative [^.!?]+$ matches entire string? With /g, at pos 0, first alt fails (no punctuation), second alt matches to end. returns ["The gate opens"]. Good.

3. empty: text.match(pattern) returns null? For empty string, /g match returns null. returns []. whitespace: as above second alt matches "   ", trim empty filter. Good.

4. multiple: good.

isGrounded sourceTokens = tokenSet("The ember key opens the gate. You need 4 shards.");
Let's compute tokens: lower "the ember key opens the gate. you need 4 shards."
Matches: the, ember, key, opens, the, gate, you, need, 4, shards. Remove stopwords: the, you? yes stopword. Remaining: ember, key, opens, gate, need, 4, shards.
- "The ember key opens the gate." tokens: the stop, ember, key, opens, the stop, gate. all in set true.
- "You need 4 shards." tokens: you stop, need, 4, shards. all true.
- "The EMBER KEY, opens the gate!" lower tokens: the, ember, key, opens, the, gate. true.
- "The ember key opens the vault." tokens: vault missing false.
- "You need 5 shards." tokens: need, 5, shards; 5 missing false. Good.

groundAnswer keep/drop:
sources = ["The ember key opens the gate."] sourceTokens: ember,key,opens,gate.
raw sentences: "The ember key opens the gate." tokens all present; "The vault needs 5 shards." tokens: vault, needs, 5, shards. None present? Actually none of these in sourceTokens. So ungrounded. kept first. text join -> first. Good.
But note "needs" vs "need" not in source. Good.

refuse no grounded: raw "The vault needs 5 shards." tokens none in source? sourceTokens ember,key,opens,gate. false. returns refusal. Good.

refuse empty raw: splitSentences("") [] -> none kept -> refusal. Good.

throws: sources length 0 throws before anything. Good.

Need maybe test groundAnswer with multiple grounded sentences to prove join. Could add:
```
it("joins surviving sentences with a single space", () => {
 const sources = ["Alpha beta gamma delta"];
 expect(groundAnswer("Alpha beta. Gamma delta.", sources)).toEqual({ text: "Alpha beta. Gamma delta.", sentences: ["Alpha beta.", "Gamma delta."], refused: false });
});
```
Check sourceTokens: alpha,beta,gamma,delta. Sentence tokens: alpha,beta; gamma,delta. true. Good. This is behavior. Could include.

Need avoid using words that are stopwords? "Alpha beta" fine. "Gamma delta" fine.

Could test `groundAnswer` drops ungrounded sentence in middle? Not necessary.

Need consider if `splitSentences` with trailing spaces after last sentence: "A. B.   " -> matches? first "A. ", second "B.   "? [^.!?]*[.!?]+(?:\s*) includes trailing spaces after B. yes, trim. Good. Not test.

Potential issue: `tokenSet` is not directly in plan's test manifest? It is exported. If we import tokenSet, okay. But if hidden environment only has grounding.ts as shown, tokenSet exists. Good.

Need maybe not import tokenSet if we can create sourceTokens manually? But isGrounded requires Set<string>. We could pass `new Set(["ember","key","opens","gate","need","4","shards"])` to test isGrounded without tokenSet. That may be more behavior-focused? But sourceTokens in real flow comes from tokenSet. Testing isGrounded with manually created set proves gate given source tokens. But to prove full grounding gate from sources, groundAnswer tests do that. For isGrounded, using tokenSet is fine and tests exported API. However if we use tokenSet, we are relying on its behavior; if tokenSet had bug removing digits? Then tests fail. That's okay, plan says tokenSet. But the file's purpose is sentence split and grounding gate; tokenSet is part of gate.

Could there be a circular issue: `GroundingError` defined in grounding.ts, plan said answer.ts but reference has it. We import from grounding.js. Good.

Need final output only fenced block. No explanation. Ensure code compiles under strict. Use type annotation for thrown:
```
let thrown: unknown;
try {
  groundAnswer("The ember key opens the gate.", []);
} catch (error) {
  thrown = error;
}

expect(thrown).toBeInstanceOf(GroundingError);
expect((thrown as GroundingError).code).toBe("empty_sources");
```
TS strict: `thrown` could be undefined? It's unknown, okay. But if no throw, toBeInstanceOf fails. No need unreachable. However TypeScript might complain that `thrown` is used before assigned? Since it's initialized `let thrown: unknown;` no. Good.

Could use `expect(() => groundAnswer(...)).toThrow(GroundingError);` simpler but no code. Use try/catch.

Need maybe import `GroundingError` type? It's a class, value. Good.

Potential issue with `toBeInstanceOf(GroundingError)` when module loaded via .js and .ts? Same class. Good.

Need maybe use `describe.each`? no.

Let's think about hidden grading: They may compare file to expected? Need exact? Probably run tests. Need ensure no missing test from plan? The task: "This file: proves sentence split and grounding gate". It might expect tests for `splitSentences` and `isGrounded`/`groundAnswer`. We have enough.

But the plan section 5 lists tests for whole deliverable, not per file. For grounding.test, maybe should include:
- `splitSentences` splits on . ! ? and keeps no-punctuation.
- `isGrounded` true/false, case-insensitive, punctuation, quantity mismatch.
- `groundAnswer` drops ungrounded, refusal, empty sources error.
Good.

Need consider "sentence = maximal run of text ending in ., !, or ? (plus trailing whitespace)." Our split test with "The key is red!" includes exclamation. Good.

Need maybe test that splitSentences does not split on periods inside abbreviations? Plan doesn't specify; don't.

Need maybe test that grounding gate is lexical: all content words appear in sources. Our tests show missing token false, quantity false. Good.

Potential issue: `isGrounded` with sentence "The EMBER KEY, opens the gate!" tokenSet lowercases and matches [a-z0-9]+. The comma separates? It matches "the", "ember", "key", "opens", "the", "gate". Good.

Potential issue: sourceTokens from tokenSet includes "4" as string. isGrounded quantity 5 false. Good.

Need maybe include direct `tokenSet` tests to prove digits kept and stopwords removed? Could be useful. But if we add, ensure pass:
```
describe("tokenSet", () => {
 it("lowercases tokens, removes stopwords, and keeps digits", () => {
   expect([...tokenSet("The Key is RED. You need 4 shards.")].sort()).toEqual(["4","key","need","red","shards"]);
 });
});
```
Check tokens: the stop, key, is stop, red, you stop, need, 4, shards. sorted: "4","key","need","red","shards". Good. This proves tokenization behavior. But plan file says proves sentence split and grounding gate; tokenSet is not explicitly in section 5 but exported. Could be okay. But "Do not add an export, a feature or a file the plan does not name." Tests aren't features. Adding tokenSet tests might be considered beyond manifest? The manifest says test/grounding.test.ts reads src/grounding.ts proves sentence split and grounding gate. TokenSet is part of grounding gate? It's a helper. Maybe okay but not necessary. To be safe, keep focused on splitSentences and grounding gate (isGrounded, groundAnswer). We already import tokenSet to build source tokens. That's enough.

Need maybe avoid using `tokenSet` in tests because then if tokenSet is changed, isGrounded tests still pass? But we need sourceTokens. Could manually create set to isolate isGrounded. However groundAnswer tests prove tokenization from sources. If tokenSet has bug, groundAnswer fails. For isGrounded, manual set may be cleaner:
```
const sourceTokens = new Set(["ember", "key", "opens", "gate", "need", "4", "shards"]);
```
Then isGrounded tests don't depend on tokenSet. But the grounding gate in product includes tokenSet; groundAnswer covers it. Which is better? The plan exports tokenSet; tests can use it. But "test behaviour not implementation" maybe using public API is fine. Using tokenSet to derive source tokens mirrors real usage. I'd keep tokenSet.

Need ensure import order? Not important.

Potential hidden tsconfig: `verbatimModuleSyntax`? If so, importing types and values together okay if all values. GroundingError is class value, functions values. No type-only imports needed. Good.

Potential hidden ESLint: no unused imports. We use all imported: describe, expect, it, GroundingError, groundAnswer, isGrounded, splitSentences, tokenSet. Good.

Potential issue: `describe` and `it` from vitest. Good.

Need final only fenced block. Use ```ts maybe. User: "inside one fenced block". Could be ```typescript. Fine.

Let's consider if test file should use `.ts` extension import? In ESM TS, some configs allow `.js`. If project uses `moduleResolution: "bundler"` and `allowImportingTsExtensions` false, `.js` is okay. If uses NodeNext, `.js` required. So .js best.

Need maybe include `// ASSUMPTION:`? Only if symbol absent. All present. No assumption needed.

Double-check reference grounding.ts has `GroundingError` exported. Yes.

Let's think about exact refusal text: "not covered by my sources". We assert exact. Good.

Could there be a problem with `groundAnswer(raw, sources)` where raw has ungrounded sentence that contains some source tokens but also unknown. isGrounded false if any missing. Good.

Potential edge: In keep/drop test, raw = "The ember key opens the gate. The vault needs 5 shards." The second sentence tokens include "the" stop, vault, needs, 5, shards. None in source? source has ember,key,opens,gate. false. Good.

Potential edge: If sourceTokens includes "shards" from another source? In test sources only gate. Good.

Need maybe test multiple sources: groundAnswer uses union. Could add:
```
it("uses the union of tokens from all sources", () => {
 const sources = ["The ember key opens the gate.", "You need 4 shards."];
 expect(groundAnswer("The ember key opens the gate. You need 4 shards.", sources)).toEqual({...});
});
```
This proves multi-source. Plan input 2-3 pages. Could be valuable. Does it add beyond? It's grounding gate. Let's include maybe. Ensure pass:
sourceTokens union: ember,key,opens,gate,need,4,shards. raw sentences both grounded. text join: "The ember key opens the gate. You need 4 shards." (join with space; first sentence ends period, then space, second). Good.
Could test a sentence grounded only by second source: raw "You need 4 shards." sources ["The ember key opens the gate.", "You need 4 shards."] -> kept. But above enough.

Need not over-test. But desired oververbosity 9? For final code, thorough tests okay.

Let's think about "A test with no assertion, or one that only exercises the happy path, is worse than no test." Our tests include negative. Good.

Potential issue: `expect(splitSentences("   ")).toEqual([]);` We reasoned second alt matches whitespace. Let's verify regex with /g and $ in JS. Pattern: /[^.!?]*[.!?]+(?:\s*)|[^.!?]+$/g. For "   ":
- At index 0, first alternative: [^.!?]* can match all three spaces? Then needs [^.!?]+ punctuation, fails. Backtrack [^.!?]* match two spaces, next char space not punctuation, fail; etc. First alt fails at index 0? It could match zero spaces then next char space not punctuation fail. So first alt no match at 0. Second alternative: [^.!?]+$: one or more non punctuation to end. At index 0, matches "   " because $ at end. So match. Good. For empty: second alt requires +, fails; first fails; no match. Good.

Potential issue: `splitSentences("The gate opens.")` with trailing period no space: first alt matches "The gate opens." optional spaces zero. Good.

Potential issue: `splitSentences("The gate opens.  The key is red!")` two spaces after period: first alt optional \s* matches both spaces. Good.

Need maybe test that trailing whitespace is not included. Our toEqual trimmed proves.

Could there be a problem with sentence containing multiple terminators "What?? Now."? Plan says ending in . ! ?; maximal run. Reference would split at first terminator? Actually regex [^.!?]*[.!?]+ matches all consecutive punctuation as one sentence end. "What?? Now." -> "What??" and "Now." maybe. Not test.

Need maybe test `isGrounded` returns true for empty content? Not spec. Avoid.

Let's consider if `tokenSet` removes stopword "red"? No, red not stopword. Good.

Potential hidden style: They may expect no `describe`? Vitest supports. Fine.

Need final answer only code block. Ensure no trailing explanation.

Let's draft final:
```ts
import { describe, expect, it } from "vitest";

import {
  GroundingError,
  groundAnswer,
  isGrounded,
  splitSentences,
  tokenSet,
} from "../src/grounding.js";

describe("splitSentences", () => {
  it("splits text on sentence-ending punctuation and trims each sentence", () => {
    expect(splitSentences("The gate opens. The key is red! What now?")).toEqual([
      "The gate opens.",
      "The key is red!",
      "What now?",
    ]);
  });

  it("keeps text without a terminator as a single sentence", () => {
    expect(splitSentences("The gate opens")).toEqual(["The gate opens"]);
  });

  it("returns an empty array for empty or whitespace-only text", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   ")).toEqual([]);
  });

  it("splits multiple sentences separated by spaces", () => {
    expect(splitSentences("Alpha beta. Gamma delta. Epsilon zeta?")).toEqual([
      "Alpha beta.",
      "Gamma delta.",
      "Epsilon zeta?",
    ]);
  });
});

describe("isGrounded", () => {
  const sourceTokens = tokenSet(
    "The ember key opens the gate. You need 4 shards."
  );

  it("returns true when every content token appears in the sources", () => {
    expect(isGrounded("The ember key opens the gate.", sourceTokens)).toBe(true);
    expect(isGrounded("You need 4 shards.", sourceTokens)).toBe(true);
  });

  it("is case-insensitive and ignores punctuation", () => {
    expect(isGrounded("The EMBER KEY, opens the gate!", sourceTokens)).toBe(true);
  });

  it("returns false when a content token is missing from the sources", () => {
    expect(isGrounded("The ember key opens the vault.", sourceTokens)).toBe(false);
  });

  it("returns false when a quantity differs from the sources", () => {
    expect(isGrounded("You need 5 shards.", sourceTokens)).toBe(false);
  });
});

describe("groundAnswer", () => {
  it("keeps grounded sentences and drops ungrounded sentences", () => {
    const sources = ["The ember key opens the gate."];
    const raw = "The ember key opens the gate. The vault needs 5 shards.";

    expect(groundAnswer(raw, sources)).toEqual({
      text: "The ember key opens the gate.",
      sentences: ["The ember key opens the gate."],
      refused: false,
    });
  });

  it("uses the union of tokens from every source", () => {
    const sources = [
      "The ember key opens the gate.",
      "You need 4 shards.",
    ];
    const raw = "The ember key opens the gate. You need 4 shards.";

    expect(groundAnswer(raw, sources)).toEqual({
      text: "The ember key opens the gate. You need 4 shards.",
      sentences: ["The ember key opens the gate.", "You need 4 shards."],
      refused: false,
    });
  });

  it("refuses when no sentence is grounded", () => {
    const sources = ["The ember key opens the gate."];
    const raw = "The vault needs 5 shards.";

    expect(groundAnswer(raw, sources)).toEqual({
      text: "not covered by my sources",
      sentences: [],
      refused: true,
    });
  });

  it("refuses when the raw answer has no sentences", () => {
    expect(groundAnswer("", ["The ember key opens the gate."])).toEqual({
      text: "not covered by my sources",
      sentences: [],
      refused: true,
    });
  });

  it("throws GroundingError when sources are empty", () => {
    let thrown: unknown;

    try {
      groundAnswer("The ember key opens the gate.", []);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GroundingError);
    expect((thrown as GroundingError).code).toBe("empty_sources");
  });
});
```

Check line lengths? Not important. Could format tokenSet call one line. Fine.

Need consider if `groundAnswer` with raw "The ember key opens the gate. You need 4 shards." and sources union: first sentence tokens all in source1; second all in source2. kept. text join: "The ember key opens the gate. You need 4 shards." Good.

Potential issue: In `isGrounded` case-insensitive test, sourceTokens from tokenSet includes lower tokens. The sentence has "EMBER" and "KEY" upper, lowercased by tokenSet. Good.

Potential issue: `isGrounded` with "The EMBER KEY, opens the gate!" token pattern [a-z0-9]+ after lower: "the ember key, opens the gate!" matches "key" before comma. Good.

Potential issue: Stopwords include "the", but not "a"? yes. We don't rely.

Could there be an expectation that test file should not import tokenSet because plan's manifest for test/grounding.test.ts reads src/grounding.ts only, but tokenSet is in it. Fine.

Need maybe include `// ASSUMPTION` for import extension? The instructions: If symbol genuinely absent... not. Import extension not symbol. No comment.

Let's think if final should be only fenced block with no language? "one fenced block" likely ```ts. Good.

Double-check no hidden requirement about NestJS? This variant plan says no NestJS. Test file only.

Potential problem: The reference `grounding.ts` has a comment at top about assumption. We must not reproduce. We won't.

Potential problem: The task says "Files shown read-only are references. Rely on them; never restate or rewrite them." We are writing test file, not rewriting. Good.

Potential problem: "Never a fragment, never an 'unchanged' comment, never a diff." We provide complete.

Potential problem: "Do not add an export, a feature or a file the plan does not name." We don't export. Tests are named by plan. Good.

Let's consider if using `tokenSet` in `isGrounded` tests makes the test less isolated and maybe if tokenSet changes to keep stopwords, sourceTokens includes the, you; isGrounded still true/false? For missing vault false, quantity 5 false. If tokenSet keeps stopwords, sourceTokens includes the, you; still true for first, true for second, false vault, false 5. So tests robust. If tokenSet lowercases differently? no.

Could `groundAnswer` with empty raw and non-empty sources be considered not "sources lack answer" but no sentences; plan says if none kept refusal. Good.

Need maybe test `GroundingError` code property with type cast. In strict, `(thrown as GroundingError).code` ok. But if thrown is undefined, cast still okay? At runtime undefined as GroundingError, `.code` would throw TypeError before expect? Actually `expect((thrown as GroundingError).code)` evaluates expression first. If thrown undefined, accessing .code throws TypeError, test fails with error not assertion. But if no throw, we want assertion fail gracefully. Could avoid by:
```
expect(thrown).toBeInstanceOf(GroundingError);
if (thrown instanceof GroundingError) {
  expect(thrown.code).toBe("empty_sources");
} else {
  throw new Error("Expected GroundingError");
}
```
But if thrown undefined, first expect fails, but second line still executes? In Vitest, `expect` throws, so second line not executed if in same try? Actually after expect fails, it throws AssertionError, so subsequent code not run. But the expression `(thrown as GroundingError).code` is evaluated before expect call, so if thrown undefined, it throws TypeError before assertion. To be safe, use `expect(thrown).toBeInstanceOf(GroundingError);` then `expect((thrown as GroundingError | undefined)?.code).toBe("empty_sources");` But optional chaining on cast? `thrown` unknown, can't optional? We can do:
```
expect(thrown).toBeInstanceOf(GroundingError);
expect((thrown as GroundingError).code).toBe("empty_sources");
```
If no throw, first expect throws before second? Wait evaluation order: The statement `expect(thrown).toBeInstanceOf(GroundingError);` executes and throws AssertionError, so second statement not executed. So no TypeError. Good. The second statement only reached if first passed, meaning thrown is GroundingError instance, so .code safe. So fine.

But TypeScript: `thrown` is unknown; `expect(thrown)` okay. `(thrown as GroundingError).code` okay. Good.

Could use `expect(() => groundAnswer(...)).toThrow(GroundingError);` and not code. But code is spec. Good.

Need maybe use `expect.hasAssertions()`? Not necessary.

Let's think about test "returns an empty array for empty or whitespace-only text". If reference regex for whitespace-only maybe returns [""]? We filter length > 0. Good.

Potential issue: `splitSentences` with "   " might match "   " and filter. Good.

Potential issue: `splitSentences` with multiple spaces between sentences: first match includes trailing spaces, so next starts after all spaces? optional \s* greedy matches all spaces. Good.

Potential issue: `splitSentences` with newline? \s includes newline. Not test.

Need maybe include test for grounding gate with all content words but different order? `isGrounded("Gate opens the key ember.", sourceTokens)` true. Not necessary.

Could add test for `groundAnswer` preserving original sentence casing/punctuation. Our toEqual does.

Now, ensure final no extra text. Use fenced block.

One more thought: The plan's type signature for `answer` says hint config etc, but this test file only grounding. No issue.

Could hidden lint require no `any`? We don't use.

Could hidden tsconfig have `noUncheckedIndexedAccess`? We don't index.

Could hidden vitest config require test files under `test/` and import from `../src/grounding.js`. Good.

Let's consider if `import ... from "../src/grounding.js"` might fail if Vitest's resolver doesn't map .js to .ts for source files? Vite by default resolves .js to .ts? In Vitest, yes it supports TypeScript path mapping? Let's recall: Vite has `resolve.extensions` default includes '.mjs', '.js', '.mts', '.ts', etc. When importing './foo.js', Vite will first try exact file? There is no foo.js, but it has `resolve.extensions`? Actually Vite's resolver will try to replace .js with .ts? I know in Vitest, you can import `.ts` files using `.js` extension if TypeScript ESM. It works with `allowImportingTsExtensions`? Hmm. In a typical Vite project, importing `./foo.js` when only foo.ts exists works because Vite has a plugin for TypeScript? I think yes, Vite's resolver has `isFromTsImporter` and tries .ts for .js. Vitest uses Vite. So okay. If not, extensionless might work better in Vite. But Node ESM requires .js. Which is more defensible? The conventions explicitly ESM, type module. In Node 20+ ESM, relative imports require file extensions. TypeScript with NodeNext requires .js. So .js is correct.

Could the project use `moduleResolution: "bundler"` where .js still okay? Yes.

Need maybe import from `../src/grounding` (no extension) if their tsconfig uses bundler and no .js files. But .js likely accepted. If not, hidden tests? We need choose. I lean .js due ESM convention.

Let's see read-only reference path: workspace/src/grounding.ts. No package.json shown. But conventions: ESM, "type": "module". So .js.

Potential issue: If they run `vitest` with `deps.interopDefault` etc, no.

Need final.
```

## reply

```ts
import { describe, expect, it } from "vitest";

import {
  GroundingError,
  groundAnswer,
  isGrounded,
  splitSentences,
  tokenSet,
} from "../src/grounding.js";

describe("splitSentences", () => {
  it("splits text on sentence-ending punctuation and trims each sentence", () => {
    expect(splitSentences("The gate opens. The key is red! What now?")).toEqual([
      "The gate opens.",
      "The key is red!",
      "What now?",
    ]);
  });

  it("keeps text without a terminator as a single sentence", () => {
    expect(splitSentences("The gate opens")).toEqual(["The gate opens"]);
  });

  it("returns an empty array for empty or whitespace-only text", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   ")).toEqual([]);
  });

  it("splits multiple sentences separated by spaces", () => {
    expect(splitSentences("Alpha beta. Gamma delta. Epsilon zeta?")).toEqual([
      "Alpha beta.",
      "Gamma delta.",
      "Epsilon zeta?",
    ]);
  });
});

describe("isGrounded", () => {
  const sourceTokens = tokenSet(
    "The ember key opens the gate. You need 4 shards."
  );

  it("returns true when every content token appears in the sources", () => {
    expect(isGrounded("The ember key opens the gate.", sourceTokens)).toBe(true);
    expect(isGrounded("You need 4 shards.", sourceTokens)).toBe(true);
  });

  it("is case-insensitive and ignores punctuation", () => {
    expect(isGrounded("The EMBER KEY, opens the gate!", sourceTokens)).toBe(true);
  });

  it("returns false when a content token is missing from the sources", () => {
    expect(isGrounded("The ember key opens the vault.", sourceTokens)).toBe(false);
  });

  it("returns false when a quantity differs from the sources", () => {
    expect(isGrounded("You need 5 shards.", sourceTokens)).toBe(false);
  });
});

describe("groundAnswer", () => {
  it("keeps grounded sentences and drops ungrounded sentences", () => {
    const sources = ["The ember key opens the gate."];
    const raw = "The ember key opens the gate. The vault needs 5 shards.";

    expect(groundAnswer(raw, sources)).toEqual({
      text: "The ember key opens the gate.",
      sentences: ["The ember key opens the gate."],
      refused: false,
    });
  });

  it("uses the union of tokens from every source", () => {
    const sources = [
      "The ember key opens the gate.",
      "You need 4 shards.",
    ];
    const raw = "The ember key opens the gate. You need 4 shards.";

    expect(groundAnswer(raw, sources)).toEqual({
      text: "The ember key opens the gate. You need 4 shards.",
      sentences: ["The ember key opens the gate.", "You need 4 shards."],
      refused: false,
    });
  });

  it("refuses when no sentence is grounded", () => {
    const sources = ["The ember key opens the gate."];
    const raw = "The vault needs 5 shards.";

    expect(groundAnswer(raw, sources)).toEqual({
      text: "not covered by my sources",
      sentences: [],
      refused: true,
    });
  });

  it("refuses when the raw answer has no sentences", () => {
    expect(groundAnswer("", ["The ember key opens the gate."])).toEqual({
      text: "not covered by my sources",
      sentences: [],
      refused: true,
    });
  });

  it("throws GroundingError when sources are empty", () => {
    let thrown: unknown;

    try {
      groundAnswer("The ember key opens the gate.", []);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GroundingError);
    expect((thrown as GroundingError).code).toBe("empty_sources");
  });
});
```
