# 09-hint.test.ts

## reasoning

```
We need answer user's request: write exactly one file test/hint.test.ts, complete fenced block only. Need analyze plan and references. Need produce tests proving redaction of spoilers and quantities. Must follow conventions? This is eval variant not NestJS layout? Plan flat src, tests test/hint.test.ts. Need use Vitest. Need import from ../src/hint.js? Since ESM type module, likely .js extension. Reference workspace files use import from "./grounding.js". Tests in plan: test/hint.test.ts reads src/hint.ts, src/grounding.ts. Need prove redaction of spoilers and quantities.

Need understand existing hint.ts behavior:
- redactToHint(grounded, config)
- if grounded.refused returns grounded.text.
- redactSet from config.redactTokens lowercased; mentionedSet from playerMentioned lowercased.
- For each sentence, replace TOKEN_PATTERN /[a-z0-9]+/gi: token lower; isQuantityToken = /^[0-9]+$/. If (redactSet.has(token) || isQuantityToken) && !mentionedSet.has(token), replace with [REDACTED]. Else match.
- remainingContent = tokenSet(redactedSentence.replaceAll(REDACTED, " ")); if size >0 push.
- join spaces.

grounding.ts: tokenSet removes stopwords, lowercases alphanumeric tokens. splitSentences pattern. GroundedAnswer {text, sentences, refused}. Need construct grounded objects in tests directly; no need call groundAnswer except maybe to create grounded answer. But file must test redactToHint. Can import GroundedAnswer type? We can create object literals.

Plan tests for hint:
- redactToHint removes boss names and item locations from a grounded answer.
- redactToHint removes digit quantities not mentioned by the player.
- redactToHint preserves a quantity the player already mentioned in the question.
Also maybe refusal returns refusal text? Plan section 5 includes hint tests only those three. But file description: proves redaction of spoilers and quantities. Could include refusal? It's in control flow but not listed under tests? Plan section 5 includes "redactToHint removes boss names and item locations...", "removes digit quantities not mentioned", "preserves a quantity...". It also says test/hint.test.ts proves redaction of spoilers and quantities. We should implement exactly what plan specifies for this file. Do not add feature/file. But adding refusal test? Plan's tests section doesn't list it for hint, though control flow says if refused return refusal text. The instruction: Implement exactly what the plan specifies for this file. The plan for test/hint.test.ts in manifest: "proves redaction of spoilers and quantities". Section 5 tests includes three hint tests. We should include those three, maybe also test that refused answer returns refusal text? Is that part of redaction? Could be extra not specified. "Do not add an export, a feature or a file the plan does not name." Tests are not exports/features? But adding tests not in plan may be disallowed. Need be conservative: only the specified hint tests. However test with no assertion? We'll assert. Need maybe include multiple assertions per test.

Need consider "player already mentioned" tokens: HintConfig.playerMentioned are tokens from question, lowercased. If quantity token is mentioned, preserve. For boss names? The spec says player-mentioned tokens allowed to remain. But spoiler-free hint mode must not reveal boss names, item locations, or quantities beyond what player already mentioned. If player mentioned boss name? Could remain? Plan says unless token in playerMentioned. But tests only quantity preserve. We can test boss and location redacted.

Need ensure tokens are alphanumeric. Example:
const grounded: GroundedAnswer = { text: "The boss is Gorgon in the crypt. Bring 4 shards.", sentences: ["The boss is Gorgon in the crypt.", "Bring 4 shards."], refused: false };
config redactTokens ["gorgon", "crypt"], playerMentioned [] => output "[REDACTED] is [REDACTED] in the [REDACTED]. Bring [REDACTED] shards." Wait redact pattern replaces gorgon and crypt, 4. "The" lower not redacted. tokenSet remaining after replacing [REDACTED] with space: tokens: boss? "boss" not redacted. It remains, maybe okay. But if we want sentence not empty. Could use "Gorgon guards the crypt." -> "[REDACTED] guards the [REDACTED]." remaining tokens: guards, crypt? crypt redacted. OK.

Need be careful: redactTokens are lowercased but original sentence may capitalized "Gorgon". Token match lower. Good.

Quantity: "You need 4 shards." playerMentioned [] -> "You need [REDACTED] shards." The digit removed. If playerMentioned ["4"] -> "You need 4 shards." Because 4 in mentionedSet. Need note if playerMentioned contains "shards"? Then quantity still redacted? No, only token 4. Good.

Potential issue: tokenSet uses STOPWORDS includes you? yes "you" is stopword, so remainingContent for sentence "You need [REDACTED] shards." after replacing digit: tokens: need, shards (you stopword). size >0. Good.

Need test boss names and item locations: maybe two redactTokens. Use expect(result).toContain("[REDACTED]"); expect(result).not.toContain("Gorgon"); not.toContain("crypt") case-insensitive? Since replacement lower? If original "Crypt" becomes [REDACTED], not contain. Could assert exact string.

Need ensure hint derived from full grounded answer, not re-prompting? That's in answer test. Not here.

Need imports: import { describe, expect, it } from "vitest"; import { redactToHint } from "../src/hint.js"; import type { GroundedAnswer } from "../src/grounding.js"; Maybe no need type if object literal matches. But to ensure types, import type.

Need file complete. Use ESM .js extension. Tests in Vitest.

Need think about exact expected strings. Let's design robust tests:

describe("redactToHint", () => {
  it("removes boss names and item locations from a grounded answer", () => {
    const grounded: GroundedAnswer = {
      text: "Gorgon guards the crypt. The crypt holds the key.",
      sentences: ["Gorgon guards the crypt.", "The crypt holds the key."],
      refused: false,
    };
    const result = redactToHint(grounded, { redactTokens: ["gorgon", "crypt"], playerMentioned: [] });
    expect(result).toBe("[REDACTED] guards the [REDACTED]. The [REDACTED] holds the key.");
  });

But check sentence 2: "The crypt holds the key." Replace crypt -> [REDACTED]. Result "The [REDACTED] holds the key." remaining tokens: holds, key. OK. Join with space: "[REDACTED] guards the [REDACTED]. The [REDACTED] holds the key."

Potential issue: "crypt" in redactTokens lower. Good.

  it("removes digit quantities not mentioned by the player", () => {
    const grounded: GroundedAnswer = { text: "You need 4 shards.", sentences: ["You need 4 shards."], refused: false };
    const result = redactToHint(grounded, { redactTokens: [], playerMentioned: [] });
    expect(result).toBe("You need [REDACTED] shards.");
  });

Check tokenSet after replace: "You need [REDACTED] shards." -> replace [REDACTED] with space => "You need   shards." tokens: need, shards. size >0.

  it("preserves a quantity the player already mentioned in the question", () => {
    const grounded: GroundedAnswer = { text: "You need 4 shards.", sentences: ["You need 4 shards."], refused: false };
    const result = redactToHint(grounded, { redactTokens: [], playerMentioned: ["4"] });
    expect(result).toBe("You need 4 shards.");
  });

Need maybe test multiple quantities? Not necessary. But "quantities" plural. Could include two digits: "You need 4 shards and 2 keys." playerMentioned [] -> both redacted. But plan says removes digit quantities not mentioned. Could test one or multiple. Maybe include multiple to be thorough but not add unspecified? It's still same behavior. But exact expected string: "You need [REDACTED] shards and [REDACTED] keys." tokenSet remaining: need, shards, and? "and" stopword, keys. OK.

Need consider if redactTokens include multi-word? HintConfig redactTokens string[] lowercased tokens. It only redacts single tokens. Boss names may be multi-word? Plan says tokens. So tests single token.

Need maybe test that a redacted boss name mentioned by player remains? Not in plan tests. Avoid.

Need maybe test refusal? Plan control flow: if grounded.refused returns refusal text. But not in section 5 hint tests. The file description: proves redaction of spoilers and quantities. I'd avoid refusal to stay exact. But could be considered part of redaction? Hmm.

The instruction: "This file: proves redaction of spoilers and quantities". It doesn't say only those, but plan's tests list exactly. "Implement exactly what the plan specifies for this file." The plan section 5 lists tests. We should implement those. It may be okay to add a test for refusal if it's in control flow, but "Do not add ... feature" maybe tests are not feature. However the evaluation may expect only specified tests? Usually these tasks want file according to plan; extra tests likely acceptable but could be seen as not exactly. To be safe, include only the three specified hint tests. But need "tests proving" maybe enough.

Need ensure no missing symbols: GroundedAnswer type exists in grounding.ts. redactToHint exists. HintConfig inferred? We can import type { GroundedAnswer } from "../src/grounding.js"; no need import HintConfig. Object literal config matches.

Potential issue with TypeScript strict: object literal for GroundedAnswer requires exact? Yes text, sentences, refused. Good.

Need maybe use `new Set`? No.

Need ensure no unused imports. If import type GroundedAnswer used. Good.

Could we avoid type import and just pass object? TypeScript would infer and check against parameter. But type import clearer.

Need final output only fenced code block. No explanation. Ensure first line fence? User: Reply with complete content inside one fenced block, and nothing else. So final:
```ts
import { describe, expect, it } from "vitest";
...
```

Need maybe use `assert`? Vitest.

Double-check exact replacement behavior with punctuation:
Sentence "Gorgon guards the crypt." TOKEN_PATTERN matches Gorgon, guards, crypt. Replaces Gorgon -> [REDACTED], crypt -> [REDACTED]. Punctuation remains. Good.
Sentence "The crypt holds the key." The matches? The lower token "the" stopword but not redact, remains. crypt replaced. Good.

Quantity: "You need 4 shards." matches You, need, 4, shards. isQuantityToken true for 4, redactSet empty, mentioned empty -> [REDACTED]. Good.

Preserve: playerMentioned ["4"], mentionedSet has "4", condition false for 4, returns match "4". Good.

Need maybe if playerMentioned has numeric string with uppercase? lower. Good.

Potential hidden requirement: "spoiler-free hint mode that must not reveal boss names, item locations, or quantities beyond what the player already mentioned." The hint config redactTokens are boss names/item locations. Tests prove. Good.

Could include a test that redacted sentence with only redacted tokens is dropped? Plan says strip any resulting sentence empty of content. But section 5 doesn't list. File description maybe redaction of spoilers and quantities, not empty sentence stripping. Avoid? If we add, extra. But maybe important to prove redaction? Hmm.

Let's inspect plan section 5:
- `redactToHint` removes boss names and item locations from a grounded answer.
- `redactToHint` removes digit quantities not mentioned by the player.
- `redactToHint` preserves a quantity the player already mentioned in the question.

So exactly three. We'll do those.

Need consider test names maybe align. Use it("...").

Could there be a requirement to test via `groundAnswer` to ensure hint derived from full grounded answer? That's answer.test.ts. Not here.

Need maybe use fixtures? Plan says eval harness golden scenarios, but hint tests can inline. No file creation.

Need no comments? Fine. Could include none.

Potential issue: The read-only references show workspace/src/hint.ts and grounding.ts. We must not reproduce or rewrite them. Our test file is new.

Need ensure final no extra text outside fenced block. Good.

Let's think if there are any TypeScript config specifics: ESM, type module. Import path "../src/hint.js" correct from test/ directory. If tests run with Vitest, it resolves TS. Good.

Could use `import { redactToHint } from "../src/hint";`? Since ESM and references use .js, use .js.

Need maybe `import type { GroundedAnswer } from "../src/grounding.js";` This is type-only, okay.

Let's consider if `GroundedAnswer` is exported from grounding.ts? Yes export interface. Good.

Need maybe if `redactToHint` returns refusal text for refused; not tested. Fine.

Could exact expected string in first test: "[REDACTED] guards the [REDACTED]. The [REDACTED] holds the key." Let's simulate:
Input sentences:
1 "Gorgon guards the crypt." -> replace: "[REDACTED] guards the [REDACTED]."
2 "The crypt holds the key." -> "The [REDACTED] holds the key."
Join with space: "[REDACTED] guards the [REDACTED]. The [REDACTED] holds the key."
Yes.

Second: "You need [REDACTED] shards." Good.
Third: "You need 4 shards." Good.

Need maybe if redactTokens includes "gorgon" and "crypt", but sentence has "Gorgon" capitalized. Good.

Potential problem: tokenSet for remainingContent uses STOPWORDS; in first sentence after redaction: "[REDACTED] guards the [REDACTED]." replace REDACTED with " ": "   guards the  ." tokens: guards (the stopword) => size 1. Good. Second: "The   holds the key." tokens: holds, key. Good.

Need maybe if a sentence becomes all redacted and stopwords only, it is dropped. Not tested.

Let's think about "playerMentioned: string[]; // tokens from the question, lowercased". In test preserve quantity, we pass ["4"]. Good.

Could there be a need to prove "beyond what the player already mentioned" for boss names? If player mentioned boss name, it remains. But plan tests only quantity. The variant says hint mode must not reveal boss names, item locations, or quantities beyond what player already mentioned. If player mentioned boss name, revealing it is not beyond? It's okay. But test not required.

Need maybe use `expect(result).not.toContain("Gorgon")` etc instead of exact to be less brittle. But exact is fine and stronger. Could combine exact plus not contain. But exact enough.

Need maybe if output includes [REDACTED] for both boss and location, exact proves.

Could there be hidden issue with `[REDACTED]` contains letters REDACTED that might be tokenized? In remainingContent we replace all [REDACTED] with space, so no. In output exact includes. Good.

Need maybe if `redactToHint` lowercases redactTokens but not playerMentioned? It does. Good.

Now final. Ensure only code fence. Use ts. No trailing explanation.
```

## reply

```ts
import { describe, expect, it } from "vitest";
import { redactToHint } from "../src/hint.js";
import type { GroundedAnswer } from "../src/grounding.js";

describe("redactToHint", () => {
  it("removes boss names and item locations from a grounded answer", () => {
    const grounded: GroundedAnswer = {
      text: "Gorgon guards the crypt. The crypt holds the key.",
      sentences: ["Gorgon guards the crypt.", "The crypt holds the key."],
      refused: false,
    };

    const result = redactToHint(grounded, {
      redactTokens: ["gorgon", "crypt"],
      playerMentioned: [],
    });

    expect(result).toBe("[REDACTED] guards the [REDACTED]. The [REDACTED] holds the key.");
  });

  it("removes digit quantities not mentioned by the player", () => {
    const grounded: GroundedAnswer = {
      text: "You need 4 shards.",
      sentences: ["You need 4 shards."],
      refused: false,
    };

    const result = redactToHint(grounded, {
      redactTokens: [],
      playerMentioned: [],
    });

    expect(result).toBe("You need [REDACTED] shards.");
  });

  it("preserves a quantity the player already mentioned in the question", () => {
    const grounded: GroundedAnswer = {
      text: "You need 4 shards.",
      sentences: ["You need 4 shards."],
      refused: false,
    };

    const result = redactToHint(grounded, {
      redactTokens: [],
      playerMentioned: ["4"],
    });

    expect(result).toBe("You need 4 shards.");
  });
});
```
