# 07-answer.test.ts

## reply

The task is to write `test/answer.test.ts` based on the plan. The manifest says:

```
test/answer.test.ts | reads: src/answer.ts, src/fake-llm.ts, src/eval.ts | proves grounded high, lie low, refusal, quantity catch
```

So the tests should cover:
1. `answer` with a scripted LLM that returns a confident lie (containing an invented item requirement) scores faithfulness 0 and the final score is low.
2. `answer` with a scripted LLM that returns a correct, grounded answer (all sentences in the source, all expected facts present) scores helpfulness 1 and faithfulness 1.
3. `answer` where the source does not contain an answer yields `refused: true` and text "not covered by my sources".
4. A scenario where the answer says "5 shards" but the source says "4 shards" is caught: faithfulness 0 (quantity token mismatch).

The manifest says this file reads `src/answer.ts`, `src/fake-llm.ts`, `src/eval.ts`. So the tests should primarily use `answer` from `src/answer.ts`, `ScriptedLlm` from `src/fake-llm.ts`, and the judges / `evaluateScenario` from `src/eval.ts`.

Let me think about what's available:

From `src/answer.ts`:
- `AnswerMode` type
- `AnswerRequest` interface
- `AnswerResult` interface
- `GroundingError` class (re-exported)
- `answer(req, llm, hint?)`

From `src/fake-llm.ts`:
- `ScriptedLlm` class with a constructor taking `Map<string, string>` and an async `generate(prompt, context)`.

From `src/eval.ts`:
- `Scenario` interface: `{ id, question, sources, expectedFacts, plantedFalseFacts, redactTokens }`
- `JudgeResult`: `{ helpfulness, faithfulness, score }`
- `judgeHelpfulness(answerText, expectedFacts)`
- `judgeFaithfulness(answerText, sources, plantedFalseFacts)`
- `evaluateScenario(scenario, llm)`

From `src/grounding.ts` (referenced in the plan but not shown — I know its API from the plan):
- `GroundedAnswer` interface
- `splitSentences(text)`
- `tokenSet(text)`
- `isGrounded(sentence, sourceTokens)`
- `groundAnswer(rawAnswer, sources)` — throws GroundingError if sources is empty
- `GroundingError` class with `code: "empty_sources"`

Wait, in the plan `GroundingError` is defined in `src/grounding.ts`:

```ts
// src/grounding.ts
export interface GroundedAnswer {
  text: string;
  sentences: string[];
  refused: boolean;
}

export function splitSentences(text: string): string[];
...
```

Hmm, actually the plan's section 3 lists `GroundingError` under `src/answer.ts`:

```ts
// src/answer.ts
...
export class GroundingError extends Error {
  code: "empty_sources";
}
```

But the actual `src/answer.ts` shown imports `GroundingError` from `./grounding.js` and re-exports it. So `GroundingError` is defined in `src/grounding.ts` and re-exported from `src/answer.ts`. The manifest says test/answer.test.ts reads src/answer.ts, src/fake-llm.ts, src/eval.ts — so I should import `GroundingError` from `src/answer.js` (the re-export) or from `src/grounding.js`. Since the manifest lists only those three files, I'll import from `./../src/answer.js` — wait, what's the path?

The test is at `test/answer.test.ts` and source is at `src/answer.ts`. So the import would be `../src/answer.js` (ESM with `.js` extension, matching the style in the reference files which use `./llm-client.js`).

Now, the plan's test list includes tests that belong to other files:
- `test/grounding.test.ts` — sentence splitting and grounding gate
- `test/hint.test.ts` — redaction
- `test/eval.test.ts` — judges

So `test/answer.test.ts` should focus on:
1. Confident lie scores low (faithfulness 0, final score low)
2. Correct grounded answer scores high (helpfulness 1, faithfulness 1)
3. Source lacking an answer yields refusal
4. Quantity errors are caught exactly

And probably also:
- `answer` with `mode: "hint"` calls `llm.generate` exactly once (no re-prompt) — this is about the behavior of `answer`, so it belongs in answer.test.ts.
- `answer` throws `GroundingError` when sources is empty — this is also about `answer`.

The manifest description says "proves grounded high, lie low, refusal, quantity catch". The plan's test section lists 13 tests across all files. Which belong to answer.test.ts? The manifest says:

```
test/answer.test.ts | reads: src/answer.ts, src/fake-llm.ts, src/eval.ts | proves grounded high, lie low, refusal, quantity catch
test/grounding.test.ts | reads: src/grounding.ts | proves sentence split and grounding gate
test/hint.test.ts | reads: src/hint.ts, src/grounding.ts | proves redaction of spoilers and quantities
test/eval.test.ts | reads: src/eval.ts, src/fake-llm.ts, src/answer.ts | proves helpfulness and faithfulness judges
```

So answer.test.ts reads src/eval.ts too — which means it uses `evaluateScenario` or the judges. The four core proofs:

1. **Lie low**: scripted LLM returns a confident lie (containing an invented item requirement). Use `evaluateScenario` with a scenario whose `plantedFalseFacts` includes the invented item requirement. Expect faithfulness 0, score low (score = min(helpfulness, 0) = 0).

2. **Grounded high**: scripted LLM returns a correct grounded answer. Expect helpfulness 1, faithfulness 1, score 1.

3. **Refusal**: source does not contain an answer → all sentences ungrounded → `refused: true`, text "not covered by my sources". Test `answer` directly.

4. **Quantity catch**: answer says "5 shards" but source says "4 shards". Expect faithfulness 0. Test via `evaluateScenario` or `judgeFaithfulness`. The manifest says answer.test.ts reads src/eval.ts, so I can use `judgeFaithfulness` directly or `evaluateScenario`.

Additionally:
- `answer` throws `GroundingError` when sources is empty. This is a test of `answer`'s behavior — belongs here.
- `answer` with `mode: "hint"` calls `llm.generate` exactly once. This is also a test of `answer`. The plan lists it under tests. Since answer.test.ts is about the behavior of `answer`, I'll include it. But wait — does this require importing from src/hint.ts? No, I can pass a `HintConfig` object literal — `hint?: HintConfig`. The type is imported from src/hint.ts. Hmm, to pass a hint config I need the `HintConfig` type, which is in src/hint.ts. The manifest says answer.test.ts reads only src/answer.ts, src/fake-llm.ts, src/eval.ts. But `HintConfig` is a type — importing a type from src/hint.ts would be a "read" of that file.

Hmm. Let me think. The "calls llm.generate exactly once" test needs to call `answer` with `mode: "hint"` and a hint config. The hint config is `{ redactTokens: [...], playerMentioned: [...] }`. I can construct it as an object literal without importing the type — TypeScript will structurally check compatibility. Actually, to pass it as the `hint` parameter of type `HintConfig | undefined`, an object literal `{ redactTokens: [], playerMentioned: [] }` will work structurally without importing the type name. So I don't need to import from src/hint.ts.

Alternatively, I could skip the hint test in answer.test.ts... but the plan's test list includes it, and it's about `answer`'s behavior (no re-prompt). The manifest summary "proves grounded high, lie low, refusal, quantity catch" is a short description; the plan's test section is the full list. The instruction says "implement exactly what the plan specifies for this file." The plan's test section doesn't explicitly assign each test to a file, but the manifest does via "reads".

Let me assign:
- `test/grounding.test.ts`: "proves sentence split and grounding gate" → tests for `splitSentences` and `isGrounded`.
- `test/hint.test.ts`: "proves redaction of spoilers and quantities" → tests for `redactToHint` (removal of boss names/locations, removal of digits, preservation of player-mentioned quantities).
- `test/eval.test.ts`: "proves helpfulness and faithfulness judges" → direct tests of `judgeHelpfulness` and `judgeFaithfulness`.
- `test/answer.test.ts`: "proves grounded high, lie low, refusal, quantity catch" → integration tests through `answer` + `evaluateScenario`, plus `GroundingError` on empty sources, and probably the single-LLM-call test.

The "quantity catch" test: "A scenario where the answer says '5 shards' but the source says '4 shards' is caught: faithfulness 0 (quantity token mismatch)." This can be done via `evaluateScenario` (scenario-based) — which uses src/eval.ts, matching the manifest's "reads: src/eval.ts".

Now let me design the test scenarios.

Key semantics from the plan:
- Grounding is lexical: a sentence survives if all its content words appear in the source (case-insensitive, punctuation stripped).
- Content words = non-stopword tokens, lowercased, alphanumeric; digits preserved as tokens.
- Stopwords: the, a, an, is, are, to, of, in, on, you, your, it, that, this, and, or, for, with, be, can, will, has, have. (Note: "the" is listed twice in the plan, whatever.)
- Refusal message: "not covered by my sources".

**Test 1: Grounded high.**

Source: let me write a wiki-like page.

```
const sources = [
  "The Ember Caverns contain the Dragonheart Boss. Defeating it requires 4 ember shards.",
  "Ember shards are found in the Caverns' side rooms. The Dragonheart drops the Fire Sigil."
];
```

Question: "How do I defeat the boss in the Ember Caverns?"

Scripted LLM response (grounded): "Defeating it requires 4 ember shards. Ember shards are found in the Caverns side rooms."

Wait — I need to make sure every content word of each sentence appears in the source tokens. Let me check sentence 1: "Defeating it requires 4 ember shards." Tokens: defeating (content), it (stopword), requires (content), 4 (content, digit), ember (content), shards (content). Source tokens: the, ember, caverns, contain, dragonheart, boss, defeating, it, requires, 4, ember, shards, ... — "defeating" ✓, "requires" ✓, "4" ✓, "ember" ✓, "shards" ✓. Good.

Sentence 2: "Ember shards are found in the Caverns side rooms." Tokens: ember ✓, shards ✓, found ✓ (source has "found"), in (stopword), caverns ✓, side ✓, rooms ✓. Good.

Expected facts: ["defeating it requires 4 ember shards", ...]. Hmm, `judgeHelpfulness` checks that the normalized fact string is contained in the normalized answer. So the expected facts must be substrings of the answer (after normalization).

Let me pick expected facts:
- "requires 4 ember shards" — normalized answer contains "defeating it requires 4 ember shards. ember shards are found in the caverns side rooms" → normalized: "defeating it requires 4 ember shards ember shards are found in the caverns side rooms". Contains "requires 4 ember shards" ✓.
- "found in the caverns side rooms" — contains ✓ (normalized answer: "ember shards are found in the caverns side rooms").

So helpfulness = 1.

Planted false facts: e.g., ["requires a silver key"]. The answer doesn't contain it → faithfulness stays 1.

`evaluateScenario` returns `{ helpfulness: 1, faithfulness: 1, score: 1 }`.

Assert all three.

**Test 2: Lie low.**

Same scenario setup, but the scripted LLM returns a confident lie: "Defeating it requires 4 ember shards and a silver key. The boss drops the Fire Sigil."

Hmm, wait. If I plant "requires a silver key" as a false fact and the answer contains it, then faithfulness = 0 (planted-fact check). Also the sentence "Defeating it requires 4 ember shards and a silver key." — is it grounded? Tokens: defeating ✓, requires ✓, 4 ✓, ember ✓, shards ✓, silver ✗ (not in source), key ✗. So ungrounded → dropped by the gate. Then `groundAnswer` keeps only grounded sentences.

Wait — this is important! In `evaluateScenario`, `answer` runs the grounding gate first. Un-grounded sentences are dropped. So the lie "Defeating it requires 4 ember shards and a silver key." would be dropped entirely, and the answer would only contain the grounded sentences. Then `judgeFaithfulness` on the resulting text...

Hmm, let me re-read `judgeFaithfulness`: it takes `answerText` (the final answer text after gating), re-runs `groundAnswer`, checks all sentences are grounded, and checks planted false facts aren't present.

So if the gate already dropped the lying sentence, the final text won't contain "silver key", and faithfulness would be 1 (if the remaining sentences are grounded). That doesn't prove "lie scores low"!

Hmm. So how does a "confident lie" score low? Let me think more carefully about the grounding gate semantics.

The gate: "a sentence survives if all its content words appear in the source." So a lie that uses only words from the source but arranges them falsely would survive. E.g., source says "Defeating it requires 4 ember shards" and "The Dragonheart drops the Fire Sigil." A lie: "Defeating it requires 4 ember shards and the Fire Sigil." — all content words (defeating, requires, 4, ember, shards, fire, sigil) appear in the source. So it survives the gate. But it's a lie (the sigil isn't required).

And the planted false fact: "requires 4 ember shards and the fire sigil" — appears in the answer → faithfulness 0.

Alternatively, a lie with an invented item: "You must bring a silver key to open the boss door." — "silver" and "key" aren't in the source → dropped by gate. Then the answer might be entirely ungrounded → refusal. Hmm, that would be a refusal, not a low score per se (refusal text "not covered by my sources" — helpfulness 0, faithfulness: `judgeFaithfulness` on the refusal text... `groundAnswer("not covered by my sources", sources)` — tokens: not, covered, by, my, sources. "not" — is that a stopword? The plan's stopword list: the, a, an, is, are, to, of, in, on, you, your, it, that, this, and, or, for, with, be, can, will, has, have. "not", "covered", "by", "my", "sources" are not in the stopword list. So the refusal sentence is ungrounded (unless source contains those words) → dropped → refused again → `judgeFaithfulness` returns 0. And helpfulness 0. Score 0.

But the plan's test says: "a scripted confident-lie answer scores low" — and specifically "contains an invented item requirement". Hmm: "Golden scenarios (question, source, expected facts, planted FALSE facts like an invented item requirement)". So the planted false fact is like an invented item requirement. The lie contains it.

For the lie to survive the gate and reach the judge, the lie's sentence must be fully grounded lexically. So the "invented item requirement" must be composed of words that appear in the source. E.g., source mentions "Fire Sigil" (a drop) and "ember shards" (a requirement). Lie: "Defeating the Dragonheart requires 4 ember shards and the Fire Sigil." — all words in source → survives gate. Planted false fact: "requires 4 ember shards and the fire sigil" → present in answer → faithfulness 0.

But wait — is that an "invented item requirement"? It invents a requirement (that the sigil is required) using real items. That's a classic grounded-LLM failure: recombination of true facts into a false claim. And the planted-fact check catches it exactly.

Alternatively, the lie could be a quantity error: "requires 5 ember shards" — "5" not in source → dropped by gate. Hmm, that's the quantity-catch test (#4). In that case, what does "caught exactly" mean? Let me think.

Test 4: "A scenario where the answer says '5 shards' but the source says '4 shards' is caught: faithfulness 0 (quantity token mismatch)."

If the answer is "Defeating it requires 5 ember shards." and source says "4 ember shards", then the gate drops that sentence (token "5" not in source). If that's the only sentence → refusal. Then `judgeFaithfulness(refusalText, ...)` = 0 (refused). So faithfulness 0 — "caught".

But maybe the test should demonstrate that the gate catches it: e.g., answer has two sentences, one correct ("Defeating it requires 4 ember shards.") and one wrong ("You need 5 ember shards to open the door."). The wrong one is dropped, the right one survives. Final text = only the correct sentence. Then faithfulness of the final text = 1?? That doesn't prove "caught".

Hmm, wait. Let me re-read `judgeFaithfulness`: it's called on `result.text` — the gated text. If the gate already removed the "5 shards" sentence, the final text is clean and faithfulness 1. So to prove "quantity errors are caught exactly", the assertion must be about what?

Option A: The quantity-error sentence is the only/entire answer → gate drops it → refusal → faithfulness 0, helpfulness 0 (expected facts absent), score 0. "Caught" = the error doesn't reach the user; the service refuses instead of answering with a wrong quantity.

Option B: Test `judgeFaithfulness` directly on the raw lying text (before gating): `judgeFaithfulness("Defeating it requires 5 ember shards.", sources, [])` → re-runs `groundAnswer`, sentence ungrounded → refused → returns 0. This directly proves the judge catches quantity mismatches exactly.

The manifest says test/answer.test.ts reads src/eval.ts, so I can call `judgeFaithfulness` directly in answer.test.ts. But the plan's test list says "A scenario where the answer says '5 shards' but the source says '4 shards' is caught: faithfulness 0 (quantity token mismatch)." — "a scenario" suggests `evaluateScenario`.

Hmm, but with `evaluateScenario`, if the LLM returns only the wrong-quantity sentence, the result is a refusal and faithfulness 0. That works: score 0, refused true. Let me do it this way:

Scenario: source says "4 ember shards". LLM answers "Defeating it requires 5 ember shards." → gate drops (token "5" not in source) → refusal → `judgeFaithfulness` = 0, helpfulness = 0 (expected fact "requires 4 ember shards" not in refusal text), score 0. And I can also assert `result.refused` via a direct `answer` call.

Actually, let me make the quantity test more precise: assert both that `answer` returns a refusal (the wrong-quantity sentence was dropped) AND that `judgeFaithfulness` on the raw text returns 0. Hmm, but "implement exactly what the plan specifies" — the plan says: "A scenario where the answer says '5 shards' but the source says '4 shards' is caught: faithfulness 0 (quantity token mismatch)."

I think the cleanest interpretation that proves "caught exactly" is:
- Call `answer` with a scripted LLM that returns "Defeating it requires 5 ember shards." → expect `refused: true` and text "not covered by my sources" (the quantity mismatch caused the sentence to be dropped).
- Call `judgeFaithfulness("Defeating it requires 5 ember shards.", sources, [])` → expect 0.

Hmm wait, but actually, hold on. Let me reconsider: does `judgeFaithfulness` return 0 for that? `groundAnswer("Defeating it requires 5 ember shards.", sources)` → sentence tokens: defeating, requires, 5, ember, shards. Source has "4" not "5" → ungrounded → dropped → no sentences kept → refused: true → `judgeFaithfulness` returns 0. Yes.

Alternatively, a mixed answer: "Defeating it requires 4 ember shards. The boss needs 5 ember shards to be opened." — first sentence grounded, second dropped. Final text = "Defeating it requires 4 ember shards." → faithfulness 1, helpfulness 1. That proves the gate drops the bad sentence but doesn't prove "faithfulness 0". So for the "caught exactly" test, the refusal path is the right one.

Hmm, but wait — maybe I'm overthinking. Maybe the intended design is: the planted false fact is "requires 5 ember shards" and the LLM's lying sentence survives because... no, "5" isn't in source so it can't survive.

Actually wait a moment. Let me reconsider the lie test (#1) again: "a scripted confident-lie answer scores low". With the gate, a lie with out-of-source words gets dropped → possibly refusal → score 0 (low). A lie with in-source words survives → planted-fact check → faithfulness 0 → score 0 (low). Either way, "scores low".

For the "invented item requirement" case: e.g., LLM says "You must also bring a silver key." — "silver", "key" not in source → dropped. If the answer has other grounded sentences, they survive; if the planted false fact "silver key" is checked against the final text — it's not there (dropped) → faithfulness 1?? That would be bad.

Wait no — `judgeFaithfulness` checks the final (gated) text. If the gate dropped the lying sentence, the planted-fact check passes. So for the lie test to score low via the planted-fact mechanism, the lie must survive the gate. So the lie must be composed of in-source words.

So: source mentions items A and B separately; the lie claims a requirement combining them falsely, or asserts a false relation between in-source entities.

Let me design:

Source 1: "The Dragonheart guards the Ember Caverns. Defeating it requires 4 ember shards."
Source 2: "Ember shards burn in the forge of the Caverns. The Dragonheart drops the Fire Sigil when slain."

Hmm, "burn", "forge", "slain" — extra words. Let me keep it simple.

Actually, let me be careful about which words are in the source. Let me define:

```ts
const sources = [
  "The Dragonheart guards the Ember Caverns. Defeating it requires 4 ember shards.",
  "The Dragonheart drops the Fire Sigil when it is slain."
];
```

Source tokens (content): dragonheart, guards, ember, caverns, defeating, requires, 4, shards, drops, fire, sigil, slain. Plus stopwords: the, it, when, is... wait "when" — is "when" a stopword? Plan's list: the, a, an, is, are, to, of, in, on, you, your, it, that, this, and, or, for, with, be, can, will, has, have. "when" is not in the list! So "when" is a content word. Hmm, that's a problem for grounding sentences that use "when".

I need to be careful: any word I use in the LLM's answer must either be a stopword (per the plan's list) or appear in the source.

Stopwords per plan: {the, a, an, is, are, to, of, in, on, you, your, it, that, this, and, or, for, with, be, can, will, has, have}.

Notable absences: "when", "must", "need", "needs", "also", "not", "after", "before", "then", "so", "if", "but".

So my scripted answers must only use words from: source content words + the stopword set. Let me constrain the answers tightly.

Let me redesign with a minimal vocabulary.

Source:
```
"The Dragonheart guards the Ember Caverns."
"Defeating it requires 4 ember shards."
"The Dragonheart drops the Fire Sigil."
```

Content tokens: dragonheart, guards, ember, caverns, defeating, requires, 4, shards, drops, fire, sigil.
Stopwords present: the, it.

Now the scripted answers:

**Grounded (high) answer:**
"Defeating it requires 4 ember shards. The Dragonheart drops the Fire Sigil."

Sentence 1 tokens: defeating ✓, it (sw), requires ✓, 4 ✓, ember ✓, shards ✓ → grounded.
Sentence 2 tokens: dragonheart ✓, drops ✓, fire ✓, sigil ✓, the (sw) → grounded.

Expected facts:
- "defeating it requires 4 ember shards" → normalized answer = "defeating it requires 4 ember shards the dragonheart drops the fire sigil" → contains ✓.
- "the dragonheart drops the fire sigil" → contains ✓.

Planted false: ["requires the fire sigil"] — not in answer → faithfulness 1.

Score: helpfulness 1, faithfulness 1, score 1. ✓

**Lie (low) answer:**
"Defeating it requires 4 ember shards and the Fire Sigil."

Sentence tokens: defeating ✓, requires ✓, 4 ✓, ember ✓, shards ✓, and (sw), fire ✓, sigil ✓ → all in source → survives the gate! It's a confident lie (invents a requirement: that the sigil is required).

Planted false fact: "requires 4 ember shards and the fire sigil" → normalized answer contains it → faithfulness 0.

Helpfulness: expected facts — "defeating it requires 4 ember shards" is contained in the lie answer ("defeating it requires 4 ember shards and the fire sigil" contains "defeating it requires 4 ember shards") → helpfulness could be 1 if that's the only expected fact. Score = min(1, 0) = 0. "Scores low" ✓.

Hmm, but is this a "confident lie with an invented item requirement"? It invents that the Fire Sigil is required. The plan's golden scenario description: "planted FALSE facts like an invented item requirement". So the planted false fact = "requires 4 ember shards and the fire sigil" (an invented requirement). Yes, this fits.

Alternatively, a more transparent "invented item": "Defeating it requires 4 ember shards and a silver key." — but "silver"/"key" aren't in source → dropped by gate → if it's the only sentence, refusal. Then helpfulness 0, faithfulness: `judgeFaithfulness("not covered by my sources", ...)` → 0. Score 0. That also "scores low" but via refusal, which muddles with test #3.

I think the recombination lie is a better proof of the planted-fact mechanism, and it's deterministic. But hmm, the plan explicitly says "invented item requirement" as an example of a planted false fact. Let me use both aspects: the lie invents a requirement for an item that exists in the source (the Fire Sigil). The planted false fact string captures that invented requirement.

Actually, wait. Let me reconsider. Maybe simpler and more faithful to "invented item": the lie mentions an item not in the source, and the test asserts it scores low. As analyzed, that sentence gets dropped by the gate. If the LLM's entire response is that one lying sentence → refusal → score 0 (low). The test "confident-lie answer scores low" would pass with score 0. But then it's essentially the same as the refusal test. The plan lists them as separate tests: (1) lie scores low, (3) source lacking an answer yields refusal. For distinction, the lie test should go through the planted-fact path (faithfulness 0 with a non-refusal answer) — that's more informative and proves the faithfulness judge works end-to-end via `evaluateScenario`.

Let me go with the recombination lie. And I'll name it clearly in the test description: "confident lie (invented item requirement) scores low".

Hmm, actually, let me reconsider once more. "Invented item requirement" — maybe the scenario's source mentions an item (like "Fire Sigil") in a different context, and the lie invents that it's a requirement. That's exactly recombination. OK, going with this.

**Refusal test:**
Source that lacks an answer: e.g., question "How do I defeat the Frost Giant?" and source about ember caverns (no frost giant info). LLM confidently answers "The Frost Giant is defeated with 9 ice arrows." → tokens: frost, giant, defeated, 9, ice, arrows — none in source (well "defeated" vs source's "defeating" — different tokens; "9" not in source) → all dropped → refused: true, text "not covered by my sources".

Assert `result.refused === true` and `result.text === "not covered by my sources"`.

**Quantity catch test:**
Source: "Defeating it requires 4 ember shards." LLM: "Defeating it requires 5 ember shards." → "5" not in source → dropped → refused. Assert refusal and `judgeFaithfulness("Defeating it requires 5 ember shards.", sources, []) === 0`.

Hmm wait, but should I also show that the correct quantity passes? The grounded-high test already covers "4 ember shards" being fine.

Actually, let me make the quantity test a full scenario via `evaluateScenario`:

```ts
const quantityScenario: Scenario = {
  id: "quantity-mismatch",
  question: "How many ember shards do I need?",
  sources: ["Defeating the Dragonheart requires 4 ember shards."],
  expectedFacts: ["requires 4 ember shards"],
  plantedFalseFacts: [],
  redactTokens: ["dragonheart"],
};
llm = new ScriptedLlm(new Map([[question, "Defeating the Dragonheart requires 5 ember shards."]]));
result = await evaluateScenario(quantityScenario, llm);
expect(result.faithfulness).toBe(0);
expect(result.score).toBe(0);
```

And also assert the direct `answer` call returns refusal (proving the gate caught the "5"):

```ts
const direct = await answer({ question, sources, mode: "full" }, llm);
expect(direct.refused).toBe(true);
expect(direct.text).toBe("not covered by my sources");
```

Wait, but the ScriptedLlm is keyed by prompt. `answer` calls `llm.generate(req.question, req.sources)` — the prompt is the question. So the map key = question string. Both calls use the same question → OK, I can reuse one ScriptedLlm instance for both `answer` and `evaluateScenario` (generate is called twice total, once per call — that's fine).

Hmm wait, one nuance: "Defeating the Dragonheart requires 5 ember shards." — tokens: defeating ✓, dragonheart ✓, requires ✓, 5 ✗, ember ✓, shards ✓ → ungrounded → dropped → refused.

And `judgeFaithfulness("Defeating the Dragonheart requires 5 ember shards.", sources, [])`: `groundAnswer` → refused → 0. ✓

Should I also assert that the exact correct answer scores high in this scenario? The grounded-high test covers that. Keep focused.

**Empty sources → GroundingError:**

```ts
await expect(answer({ question: "q", sources: [], mode: "full" }, llm)).rejects.toBeInstanceOf(GroundingError);
```

And maybe assert `code === "empty_sources"`. The plan says GroundingError has `code: "empty_sources"`. I can do:

```ts
await expect(...).rejects.toMatchObject({ code: "empty_sources" });
```

Or combine: rejects.toBeInstanceOf(GroundingError). Let me use both assertions in one test via a try/catch, or two expects. Actually `rejects.toBeInstanceOf` is cleanest; I can add a separate check for code:

```ts
const promise = answer({ question: "How do I start?", sources: [], mode: "full" }, llm);
await expect(promise).rejects.toBeInstanceOf(GroundingError);
```

For code, I'd need to catch:

```ts
try {
  await answer(...);
  throw new Error("expected rejection"); // hmm, ugly
} catch (err) {
  expect(err).toBeInstanceOf(GroundingError);
  expect((err as GroundingError).code).toBe("empty_sources");
}
```

Hmm, `rejects.toMatchObject({ code: "empty_sources" })` also works and asserts the code. Let me do:

```ts
await expect(
  answer({ question: "How do I start?", sources: [], mode: "full" }, llm)
).rejects.toMatchObject({ name: "Error", code: "empty_sources" });
```

Hmm, `name` — GroundingError extends Error so name is "Error" by default (unless the class sets it). I don't know if the implementation sets `this.name`. Safer: just `code`. And `rejects.toBeInstanceOf(GroundingError)`. Two separate expects on two separate promise calls? No — one promise can't be awaited twice with rejects... actually you can attach two `rejects` assertions to the same promise? Each `expect(promise).rejects...` creates a new handler; attaching two handlers to the same promise is fine (both get the rejection). But creating two separate `answer(...)` calls is cleaner and avoids any weirdness with unhandled rejections. Actually, calling `answer` twice for the same assertion is a bit wasteful but fine. Alternatively:

```ts
const promise = answer({ question: "How do I start?", sources: [], mode: "full" }, llm);
await expect(promise).rejects.toBeInstanceOf(GroundingError);
```

And for the code:

```ts
await expect(promise).rejects.toMatchObject({ code: "empty_sources" });
```

Two assertions on the same promise — both handlers registered before await... `expect(promise).rejects` returns a promise; awaiting the first attaches a handler. The second `expect(promise).rejects` also attaches. Both resolve. This works in Vitest/Jest. But to be safe and simple, let me just do one `rejects.toMatchObject({ code: "empty_sources" })` plus a separate instance check... hmm.

Actually, the simplest and most robust:

```ts
it("raises GroundingError when sources is empty", async () => {
  const llm = new ScriptedLlm(new Map());
  let caught: unknown;
  try {
    await answer({ question: "How do I start?", sources: [], mode: "full" }, llm);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(GroundingError);
  expect((caught as GroundingError).code).toBe("empty_sources");
});
```

This is explicit and avoids any matcher subtleties. Good. But hmm, "never assert only that a call happened" — this asserts the error type and code. Fine.

Wait, does `GroundingError` have a constructor that takes no args? The plan: `export class GroundingError extends Error { code: "empty_sources"; }`. And `answer.ts` does `throw new GroundingError();` — no args. So the constructor takes no message (or optional). Fine, I don't construct it in the test.

**Hint mode single-call test:**

The plan lists: "`answer` with `mode: "hint"` calls `llm.generate` exactly once (no re-prompt)."

To prove this, I need to count calls. `ScriptedLlm` doesn't expose a call count. I can write a small counting wrapper in the test:

```ts
class CountingLlm implements LlmClient {
  calls = 0;
  constructor(private inner: LlmClient) {}
  async generate(prompt: string, context: string[]) {
    this.calls += 1;
    return this.inner.generate(prompt, context);
  }
}
```

But wait — that requires importing `LlmClient` from src/llm-client.ts, which is not in the manifest's "reads" list for answer.test.ts. Hmm.

Alternative: use a plain object literal that structurally satisfies `LlmClient`:

```ts
let calls = 0;
const llm = {
  async generate(prompt: string, _context: string[]): Promise<string> {
    calls += 1;
    return "Defeating it requires 4 ember shards.";
  },
};
```

This works without importing LlmClient — structural typing. The `answer` parameter is typed `LlmClient`; passing an object literal with a compatible `generate` method works.

Now, hint mode requires a `hint` config: `{ redactTokens: [...], playerMentioned: [...] }`. I can pass an object literal without importing `HintConfig`.

Test:

```ts
it("hint mode derives from the same single LLM call (no re-prompt)", async () => {
  let calls = 0;
  const llm = {
    async generate(_prompt: string, _context: string[]): Promise<string> {
      calls += 1;
      return "Defeating it requires 4 ember shards.";
    },
  };
  const result = await answer(
    { question: "How do I defeat the Dragonheart?", sources: [SOURCES...], mode: "hint" },
    llm,
    { redactTokens: ["dragonheart"], playerMentioned: [] }
  );
  expect(calls).toBe(1);
  expect(result.refused).toBe(false);
});
```

Hmm wait — should I assert anything about the redacted text? The manifest says answer.test.ts proves "grounded high, lie low, refusal, quantity catch" — redaction details belong to hint.test.ts. But asserting `calls === 1` is the core of this test (no re-prompt). Maybe I should also assert that the text was redacted... but redaction behavior is hint.test.ts's job. The plan's test item is specifically "calls llm.generate exactly once (no re-prompt)". Let me assert `calls === 1` and maybe that the result is not refused. To be safe about redaction semantics (which I don't fully see — src/hint.ts is not shown), let me avoid asserting specific redacted text. Actually wait — do I know what `redactToHint` does with "Defeating it requires 4 ember shards."? redactTokens: ["dragonheart"] — not present. Digit tokens: "4" → replaced with [REDACTED] (unless player-mentioned). So the text would be "Defeating it requires [REDACTED] ember shards." I could assert that, but... the plan says hint.test.ts proves redaction. To stay in scope, let me assert only `calls === 1` and `refused === false`. Hmm, but "never assert only that a call happened" — the convention says tests should not assert only that a call happened. So I need a behavioral assertion too. `result.refused === false` and maybe that the text is non-empty and different from... hmm.

Actually, let me assert the redacted output here too — it's a behavior of `answer` in hint mode (the returned text is the redacted grounded answer, derived without a second call). The plan's assumption: "Hint mode: redacts the full grounded answer by replacing every token that is a boss name, item location, or quantity (digit) with [REDACTED]". So for input "Defeating it requires 4 ember shards." with playerMentioned: [] → "Defeating it requires [REDACTED] ember shards."

Hmm, but is the replacement token-exact? "replace every token that is ... a quantity (digit) with [REDACTED]". So "4" → "[REDACTED]". Result: "Defeating it requires [REDACTED] ember shards." I'm fairly confident. But there's a risk: maybe it strips the sentence if it becomes empty of content — not the case here.

But wait — is it safe to assert the exact redacted string? The hint.ts implementation isn't shown. The plan describes it: "For each sentence, replace any token in redactTokens or any digit-token with [REDACTED] unless the token is in playerMentioned." So "4" → "[REDACTED]". The sentence remains (has content tokens: defeating, requires, ember, shards). Join → single sentence. So text = "Defeating it requires [REDACTED] ember shards."

I think asserting this is defensible and makes the test behavioral (not just call-counting). It also proves "Hint mode derived by redacting the full grounded answer, not by re-prompting" — the two requirements together: one call + redacted text.

Hmm, but the risk: if the actual hint.ts implementation differs subtly (e.g., preserves original case of [REDACTED], or handles the period differently). The plan is my spec ("PLAN.md above is your own specification and governs"). So I'll follow the plan. The plan says replace with `[REDACTED]`. OK.

Actually, wait a moment. Let me reconsider whether to include the exact text assertion. The instruction: "implement exactly what the plan specifies for this file." The plan's test list item: "`answer` with `mode: "hint"` calls `llm.generate` exactly once (no re-prompt)." The primary assertion is the call count. Adding a text assertion is extra but aligns with proving requirement #2 (hint derived by redaction). The convention warns against tests that "only assert a call happened". So I'll include the text assertion to make it behavioral. Let me keep it minimal: expect calls === 1, refused false, and text equals the redacted form.

Hmm, one more consideration: `playerMentioned` — "tokens from the question". In this test, the question is "How do I defeat the Dragonheart?" — tokens include "dragonheart". If I set playerMentioned to [] and redactTokens to ["dragonheart"], the sentence "Defeating it requires 4 ember shards." doesn't contain "dragonheart" anyway. Fine.

Wait, actually — should the question mention the boss? In a real flow, `playerMentioned` would be derived from the question. But `answer` takes `hint?: HintConfig` as a parameter — the caller builds it. So in the test I build it directly. OK.

Now, let me also double-check the "grounded high" test via `evaluateScenario`: it calls `answer` with mode "full". The scripted LLM must be keyed by the question. Let me write it out.

Let me also double-check `judgeHelpfulness` normalization: lowercases, strips non-letter/non-number (unicode), collapses whitespace. Facts are checked by `includes`.

Grounded-high scenario:

```ts
const sources = [
  "The Dragonheart guards the Ember Caverns.",
  "Defeating it requires 4 ember shards.",
  "The Dragonheart drops the Fire Sigil.",
];
const question = "How do I defeat the boss in the Ember Caverns?";
const llmResponse = "Defeating it requires 4 ember shards. The Dragonheart drops the Fire Sigil.";
```

Expected facts:
- "defeating it requires 4 ember shards"
- "the dragonheart drops the fire sigil"

Normalized answer: "defeating it requires 4 ember shards the dragonheart drops the fire sigil"
- Fact 1 normalized: "defeating it requires 4 ember shards" → includes ✓
- Fact 2: "the dragonheart drops the fire sigil" → includes ✓
Helpfulness = 1.

Planted false: ["requires the fire sigil"] — normalized answer contains "requires 4 ember shards the dragonheart drops the fire sigil"... does it contain "requires the fire sigil"? The substring "requires the fire sigil" — in the answer, after "requires" comes "4 ember shards the dragonheart drops the fire sigil". So "requires the fire sigil" is not a contiguous substring. ✓ faithfulness stays 1.

Wait, I should double-check the planted false isn't accidentally contained. "requires the fire sigil" — no. Good.

Faithfulness: `groundAnswer(answerText, sources)` → both sentences grounded (verified above) → not refused. Then per-sentence `isGrounded` check → both pass. Planted-fact check → passes. → 1.

Score = 1. Assert helpfulness 1, faithfulness 1, score 1.

Lie scenario:

```ts
const lieResponse = "Defeating it requires 4 ember shards and the Fire Sigil.";
```

Sentence tokens: defeating ✓, it (sw), requires ✓, 4 ✓, ember ✓, shards ✓, and (sw), the (sw), fire ✓, sigil ✓ → grounded → survives.

Result text = "Defeating it requires 4 ember shards and the Fire Sigil." (refused false).

Expected facts: same as before? "defeating it requires 4 ember shards" → contained in lie text ✓. "the dragonheart drops the fire sigil" → not contained. So helpfulness = 0.5.

Planted false: ["requires 4 ember shards and the fire sigil"] → normalized lie text: "defeating it requires 4 ember shards and the fire sigil" → contains "requires 4 ember shards and the fire sigil" ✓ → faithfulness 0.

Score = min(0.5, 0) = 0. Assert faithfulness 0 and score 0. "Scores low" ✓. Should I assert helpfulness? It's 0.5 — asserting the exact fraction is fine but maybe brittle to my fact choice; let me keep the expected facts such that it's deterministic. I'll assert `result.faithfulness).toBe(0)` and `result.score).toBe(0)`. Maybe also assert score < 1... no, toBe(0) is exact. The plan says "scores low" — 0 is low. Let me assert exactly 0 for faithfulness and score.

Hmm, should the lie scenario use the same expected facts as the high scenario? For independence, let me define the scenario separately. Let me give the lie scenario expectedFacts: ["defeating it requires 4 ember shards"] (which is present in the lie → helpfulness 1) and plantedFalseFacts: ["requires 4 ember shards and the fire sigil"] → faithfulness 0 → score 0. This isolates: even when helpfulness is high, the lie scores 0 due to faithfulness. That's a stronger proof of "final score = min of the two". Let me do that: helpfulness 1, faithfulness 0, score 0. Assert all three? Asserting helpfulness 1 shows the min is doing work. Yes, let me assert all three — it proves the min semantics exactly.

Refusal scenario:

```ts
const refusalSources = [
  "The Dragonheart guards the Ember Caverns.",
  "Defeating it requires 4 ember shards.",
];
const refusalQuestion = "How do I defeat the Frost Giant?";
const refusalResponse = "The Frost Giant is defeated with 9 ice arrows.";
```

Tokens: frost ✗, giant ✗, defeated ✗ (source has "defeating" not "defeated"), 9 ✗, ice ✗, arrows ✗ → ungrounded → dropped → refused.

Assert `result.refused === true`, `result.text === "not covered by my sources"`.

Should I also run it through the judge? The plan's test item: "a scenario whose source lacks an answer yields refusal" — a direct `answer` assertion suffices.

Quantity scenario:

```ts
const quantitySources = ["Defeating the Dragonheart requires 4 ember shards."];
const quantityQuestion = "How many ember shards do I need to defeat the Dragonheart?";
const quantityResponse = "Defeating the Dragonheart requires 5 ember shards.";
```

Direct `answer` → refused true, text "not covered by my sources" (the "5" token isn't in source).

And `judgeFaithfulness(quantityResponse, quantitySources, [])` → 0. This proves "caught exactly": the judge returns exactly 0 for a quantity mismatch, and the gate refuses.

Hmm wait — should I also show that "4" passes? The grounded-high test covers the correct quantity. Fine.

Actually, let me reconsider: for the quantity test, is it better to use `evaluateScenario`? The manifest says answer.test.ts reads src/eval.ts — which I already use for the high/lie tests via `evaluateScenario`. For quantity, using both a direct `answer` (refusal) and `judgeFaithfulness` (0) is thorough. Let me do both in one test.

Now, imports for the test file:

```ts
import { describe, it, expect } from "vitest";
import { answer, GroundingError } from "../src/answer.js";
import { ScriptedLlm } from "../src/fake-llm.js";
import { evaluateScenario, judgeFaithfulness } from "../src/eval.js";
import type { Scenario } from "../src/eval.js";
```

Path: test is at `test/answer.test.ts`, source at `src/`. So `../src/answer.js`. ESM with `.js` extension (matching the codebase style).

Do I need `Scenario` type? If I construct scenario objects inline and pass to `evaluateScenario`, TypeScript will infer/structurally check — I don't strictly need the type import. But typing them as `Scenario` is cleaner. The manifest says this file reads src/eval.ts — importing the type from there is consistent. Let me import `type { Scenario }`.

Now, let me also think: does `evaluateScenario` need `redactTokens`? Yes, the Scenario interface requires it. I'll provide `[]` or a value. It's unused in evaluation (only for hints), but required by the type. I'll provide e.g. `["dragonheart"]` or `[]`. Let me use `["dragonheart"]` for realism... actually `[]` is simpler and honest (not used). Hmm, the scenario represents a golden scenario; redactTokens is part of it. Either works. Let me use `["dragonheart"]` where the boss is relevant, `[]` otherwise. Actually, to minimize noise: `redactTokens: []` for all, since these tests don't exercise hints. Hmm, but the high/lie scenarios are about the Dragonheart... it doesn't matter for evaluation. Let me use `[]` — no wait, let me think about what's most defensible: the Scenario type requires it; providing `[]` is valid. OK, `[]`.

Hmm, actually, let me use a meaningful value in at least one place to show the shape... no — discipline: "Do exactly what the task asks." `[]` is fine.

Now, the counting LLM for the hint test — an object literal:

```ts
let generateCalls = 0;
const llm = {
  async generate(_prompt: string, _context: string[]): Promise<string> {
    generateCalls += 1;
    return "Defeating it requires 4 ember shards.";
  },
};
```

Pass to `answer(req, llm, { redactTokens: ["dragonheart"], playerMentioned: [] })`.

Wait — the `answer` signature: `answer(req, llm, hint?)`. The object literal must be assignable to `LlmClient` — which has `generate(prompt: string, context: string[]): Promise<string>`. My literal: `async generate(_prompt: string, _context: string[]): Promise<string>` — compatible. ✓

Expected redacted text: "Defeating it requires [REDACTED] ember shards."

Let me re-verify with the plan's redaction rule: "replace any token in redactTokens or any digit-token with [REDACTED] unless the token is in playerMentioned." Token "4" is a digit, not in playerMentioned → "[REDACTED]". Other tokens unchanged. Result: "Defeating it requires [REDACTED] ember shards." ✓

And `result.refused === false`, `generateCalls === 1`.

Hmm, one risk: does the redactor preserve sentence-final punctuation? "4" is mid-sentence here ("requires 4 ember shards."), so the output is "requires [REDACTED] ember shards." — punctuation untouched. Safe.

Now, let me also reconsider: should the hint test use `ScriptedLlm` instead? No — I need call counting. A plain object is fine and avoids importing LlmClient.

Now, let me structure the file:

```ts
import { describe, expect, it } from "vitest";

import { answer, GroundingError } from "../src/answer.js";
import { ScriptedLlm } from "../src/fake-llm.js";
import { evaluateScenario, judgeFaithfulness } from "../src/eval.js";
import type { Scenario } from "../src/eval.js";

const SOURCES = [
  "The Dragonheart guards the Ember Caverns.",
  "Defeating it requires 4 ember shards.",
  "The Dragonheart drops the Fire Sigil.",
];

describe("answer", () => {
  it("scores a correct grounded answer high (helpfulness 1, faithfulness 1)", async () => {
    const scenario: Scenario = {
      id: "grounded-high",
      question: "How do I defeat the boss in the Ember Caverns?",
      sources: SOURCES,
      expectedFacts: [
        "defeating it requires 4 ember shards",
        "the dragonheart drops the fire sigil",
      ],
      plantedFalseFacts: ["requires the fire sigil"],
      redactTokens: [],
    };

    const llm = new ScriptedLlm(
      new Map([
        [
          scenario.question,
          "Defeating it requires 4 ember shards. The Dragonheart drops the Fire Sigil.",
        ],
      ])
    );

    const result = await evaluateScenario(scenario, llm);

    expect(result.helpfulness).toBe(1);
    expect(result.faithfulness).toBe(1);
    expect(result.score).toBe(1);
  });

  it("scores a confident lie (invented item requirement) low", async () => {
    const scenario: Scenario = {
      id: "confident-lie",
      question: "What do I need to defeat the boss in the Ember Caverns?",
      sources: SOURCES,
      expectedFacts: ["defeating it requires 4 ember shards"],
      plantedFalseFacts: ["requires 4 ember shards and the fire sigil"],
      redactTokens: [],
    };

    const llm = new ScriptedLlm(
      new Map([[scenario.question, "Defeating it requires 4 ember shards and the Fire Sigil."]])
    );

    const result = await evaluateScenario(scenario, llm);

    expect(result.helpfulness).toBe(1);
    expect(result.faithfulness).toBe(0);
    expect(result.score).toBe(0);
  });

  it("refuses when the sources lack the answer", async () => {
    const llm = new ScriptedLlm(
      new Map([["How do I defeat the Frost Giant?", "The Frost Giant is defeated with 9 ice arrows."]])
    );

    const result = await answer(
      {
        question: "How do I defeat the Frost Giant?",
        sources: SOURCES,
        mode: "full",
      },
      llm
    );

    expect(result.refused).toBe(true);
    expect(result.text).toBe("not covered by my sources");
  });

  it("catches a quantity error exactly (5 shards when sources say 4)", async () => {
    const question = "How many ember shards do I need to defeat the Dragonheart?";
    const sources = ["Defeating the Dragonheart requires 4 ember shards."];
    const llm = new ScriptedLlm(new Map([[question, "Defeating the Dragonheart requires 5 ember shards."]]));

    const result = await answer({ question, sources, mode: "full" }, llm);

    expect(result.refused).toBe(true);
    expect(result.text).toBe("not covered by my sources");
    expect(judgeFaithfulness("Defeating the Dragonheart requires 5 ember shards.", sources, [])).toBe(0);
  });

  it("derives hint mode by redacting the single grounded answer, without re-prompting", async () => {
    let generateCalls = 0;
    const llm = {
      async generate(_prompt: string, _context: string[]): Promise<string> {
        generateCalls += 1;
        return "Defeating it requires 4 ember shards.";
      },
    };

    const result = await answer(
      { question: "How do I defeat the Dragonheart?", sources: SOURCES, mode: "hint" },
      llm,
      { redactTokens: ["dragonheart"], playerMentioned: [] }
    );

    expect(generateCalls).toBe(1);
    expect(result.refused).toBe(false);
    expect(result.text).toBe("Defeating it requires [REDACTED] ember shards.");
  });

  it("raises GroundingError when sources are empty", async () => {
    const llm = new ScriptedLlm(new Map());
    let caught: unknown;

    try {
      await answer({ question: "How do I start?", sources: [], mode: "full" }, llm);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(GroundingError);
    expect((caught as GroundingError).code).toBe("empty_sources");
  });
});
```

Wait — let me verify the lie test's helpfulness. Expected fact: "defeating it requires 4 ember shards". Normalized lie answer: "defeating it requires 4 ember shards and the fire sigil". Contains "defeating it requires 4 ember shards" ✓ → helpfulness 1. Faithfulness: planted "requires 4 ember shards and the fire sigil" → normalized answer contains it ✓ → 0. Score 0.

But wait — I need to double-check the lie sentence survives the gate. Tokens: defeating, it (sw), requires, 4, ember, shards, and (sw), the (sw), fire, sigil. All content tokens in source? Source content tokens: dragonheart, guards, ember, caverns, defeating, requires, 4, shards, drops, fire, sigil. ✓ All present. Survives.

Also verify: does the lie answer contain any other planted-fact issue? Only one planted fact. OK.

Now, the grounded-high test: verify both sentences survive (done above). Helpfulness 1 (both facts contained). Faithfulness: not refused; per-sentence grounded ✓; planted "requires the fire sigil" — is it in the normalized answer "defeating it requires 4 ember shards the dragonheart drops the fire sigil"? Substring "requires the fire sigil" — let me scan: "...requires 4 ember shards the dragonheart drops the fire sigil". After "requires" comes " 4", so no match. ✓ → faithfulness 1. Score 1.

Refusal test: verify "The Frost Giant is defeated with 9 ice arrows." tokens: frost, giant, defeated, 9, ice, arrows — all content (is "with" a stopword? yes; "is" stopword). None of frost/giant/defeated/9/ice/arrows in SOURCES tokens. Wait — "arrows"? Not in source. "ice"? No. "defeated"? Source has "defeating" — different token. ✓ Ungrounded → dropped → refused. Text = "not covered by my sources". ✓

Quantity test: "Defeating the Dragonheart requires 5 ember shards." tokens: defeating ✓, dragonheart ✓, requires ✓, 5 ✗ → ungrounded → dropped → refused. judgeFaithfulness on raw text: `groundAnswer` → refused → 0 ✓.

Hmm wait, one more check on `judgeFaithfulness`: it first checks `sources.length === 0` → no. Then `groundAnswer(answerText, sources)` → refused → returns 0. ✓

Hint test: SOURCES contains "Defeating it requires 4 ember shards." so the sentence is grounded → not refused. Redaction: "4" → [REDACTED]. Text: "Defeating it requires [REDACTED] ember shards." ✓ generateCalls 1 ✓.

Empty sources: `answer` throws GroundingError before calling llm. ✓ caught is instance, code "empty_sources".

Now — one concern: in the hint test, the `llm` object literal is passed where `LlmClient` is expected. TypeScript structural check: the interface method `generate(prompt: string, context: string[]): Promise<string>`. My literal has exactly that. ✓ No import from llm-client.ts needed — consistent with the manifest (answer.test.ts reads only answer, fake-llm, eval).

Another concern: `import type { Scenario }` — used to type the scenario objects. Good.

Do I use `judgeFaithfulness` import — yes, in the quantity test. `evaluateScenario` — yes, in high/lie tests. `ScriptedLlm` — yes. `answer`, `GroundingError` — yes. All imports used. ✓

Now, test naming and structure: use `describe("answer", ...)` with nested `it`s. The convention says "test behavior, not implementation" — my tests assert on scores/refusal/text, which are behaviors. The call-count test asserts `generateCalls === 1` — that's a behavioral contract (no re-prompt) explicitly required by the plan, plus text assertions. OK.

Let me reconsider whether to include the hint test and empty-sources test in this file. The plan's test section (section 5) lists all tests; the manifest assigns files by "reads". The hint test doesn't need src/hint.ts import (object literal). The empty-sources test is purely `answer`. Both are about `answer`'s behavior. The manifest summary "proves grounded high, lie low, refusal, quantity catch" lists the four headline proofs but doesn't exclude others. The plan's item "answer raises GroundingError when sources is empty" is clearly an `answer` test — it must live somewhere; grounding.test.ts reads only src/grounding.ts (could test `groundAnswer` throwing, but the plan item says "`answer` raises..."). So it belongs in answer.test.ts. Similarly "hint mode calls generate once" is an `answer` item. I'm confident including both is correct.

Should I also add a test that hint mode returns the refusal text when grounded.refused? The plan's `redactToHint` says "returns '' (refusal) if grounded.refused" — hmm, actually the plan says: `redactToHint ... // Returns "" (refusal) if grounded.refused.` Wait, let me re-read: "Returns \"\" (refusal) if grounded.refused." Hmm, and the control flow: "If mode === 'hint': run redactToHint(grounded, hint); return { text: redacted, refused: grounded.refused }." So on refusal in hint mode, text = ""? Or the refusal message? The plan's comment says returns "". Hmm, but that contradicts... actually wait, in section 4 control flow for `redactToHint`: "1. If grounded.refused, return the refusal text." — contradiction between the signature comment ("Returns \"\"") and the control flow ("return the refusal text"). Ugh. This is an internal plan inconsistency, but it's about hint.ts implementation and hint.test.ts — not my file. I should avoid testing that edge in answer.test.ts to sidestep the ambiguity. My hint test uses a non-refused grounded answer. Good — I'll leave the refusal-in-hint edge out of this file (it belongs to hint.test.ts, and the plan is ambiguous there; not my problem for this file).

Now, let me double-check the `ScriptedLlm` usage: constructor takes `Map<string, string>`. `generate(prompt, _context)` looks up by prompt. In `evaluateScenario`, the prompt passed is `scenario.question`. My map keys are `scenario.question` — same string reference. ✓

One more: in the refusal test I hardcode the question string twice (map key and request). To avoid drift, let me use a const.

Let me also reconsider the "details" error envelope convention — that's for HTTP API errors; this is a library, and the plan defines GroundingError. Not applicable here.

Also, convention: "Tests ... Never assert only that a call happened." My hint test asserts calls + refused + text. Fine.

Let me also consider: should the quantity test also assert helpfulness 0 via `evaluateScenario`? The plan item says "faithfulness 0 (quantity token mismatch)". I assert refusal + judgeFaithfulness 0. That's exact. Maybe I should also run `evaluateScenario` for completeness... let me keep it tight: the two assertions capture "caught exactly". Actually, hmm — "caught exactly" — the judge returns exactly 0 (not partial). `judgeFaithfulness` is binary per the plan. toBe(0) proves it.

Now, let me also double-check `judgeFaithfulness` signature: `(answerText: string, sources: string[], plantedFalseFacts: string[])`. I call with `[]` for planted. ✓

Edge: in the quantity test, `judgeFaithfulness` re-runs `groundAnswer` on the raw text — which throws GroundingError if sources empty; sources non-empty here. ✓

Let me also verify the stopword handling for "How do I..." — wait, the question isn't grounded (only the answer is). The question is just a prompt key. ✓

One more consideration: `SOURCES` is shared across tests — fine, it's a const array; nothing mutates it. `groundAnswer`/`tokenSet` don't mutate. ✓

TypeScript strictness: `caught` is typed `unknown`, then cast. `(caught as GroundingError).code` — fine. Actually, `expect(caught).toBeInstanceOf(GroundingError)` doesn't narrow `caught` for the next line (TS doesn't narrow via expect). The cast is needed. ✓

Vitest imports: `import { describe, expect, it } from "vitest";` — standard.

File header comment? The convention says code and comments in English; minimal comments are fine. Let me add a brief comment where it aids clarity (e.g., why the lie survives the gate). Actually, let me keep comments sparse but useful — e.g., a comment on the lie test explaining that the lie recombines source words so it passes the lexical gate and is caught by the planted-fact check. That documents intent.

Let me also reconsider the lie scenario's expectedFacts. If I set expectedFacts to ["defeating it requires 4 ember shards"], helpfulness = 1. That makes the min semantics visible: score = min(1, 0) = 0.

Now, the refusal test — should I also verify via `evaluateScenario` that a refusal scores 0? The plan item only says "yields refusal". Direct `answer` assertion is exact. Keep it.

Let me also verify the grounded-high answer text: "Defeating it requires 4 ember shards. The Dragonheart drops the Fire Sigil." — `splitSentences` splits on "." → ["Defeating it requires 4 ember shards", "The Dragonheart drops the Fire Sigil"] (probably trimmed). Both grounded. `grounded.text` = kept.join(" ") = "Defeating it requires 4 ember shards The Dragonheart drops the Fire Sigil" (joined with a space, periods stripped? hmm — depends on whether `splitSentences` keeps the period).

Wait, this matters for helpfulness! If `splitSentences` strips punctuation, then `grounded.text` = "Defeating it requires 4 ember shards The Dragonheart drops the Fire Sigil". Normalized: "defeating it requires 4 ember shards the dragonheart drops the fire sigil". Facts still contained. ✓ (Normalization strips punctuation anyway, and `includes` works on the normalized string.)

But faithfulness re-runs `groundAnswer` on that text — fine, same tokens.

Either way (period kept or not), my assertions hold because normalization handles punctuation. ✓

For the hint test, the redacted text assertion: input sentence "Defeating it requires 4 ember shards." — if `splitSentences` strips the period, the sentence is "Defeating it requires 4 ember shards" and redaction gives "Defeating it requires [REDACTED] ember shards" (no trailing period!). Hmm. That breaks my exact-text assertion.

Ugh. The plan says: "\"Sentence\" = maximal run of text ending in ., !, or ? (plus trailing whitespace)." — "maximal run of text ending in ." suggests the period is part of the sentence (the run ends with the period). So `splitSentences("A. B.")` → ["A.", "B."]? Or ["A", "B"]? "Maximal run of text ending in ." — the run includes the period. I'll read it as keeping the period: ["A.", "B."].

Then `grounded.text` = "Defeating it requires 4 ember shards. The Dragonheart drops the Fire Sigil." (join with space). And redaction: "Defeating it requires [REDACTED] ember shards." with the period.

But I'm not 100% sure. To be safe, should I avoid the exact-text assertion in the hint test? The convention forbids asserting only a call happened. Alternative behavioral assertions that don't depend on punctuation details:
- `result.text` does not contain "4" (the quantity was redacted) — wait, "4" as a substring... the text is "Defeating it requires [REDACTED] ember shards." — contains no "4". But `expect(result.text).not.toContain("4")` is a bit weak, though behavioral.
- `result.text` contains "[REDACTED]" — behavioral (redaction happened).
- `generateCalls === 1` — the no-re-prompt contract.

Hmm, but "not.toContain('4')" could be flaky if... no, it's deterministic. But is it strong enough? The plan's hint semantics: digit tokens → [REDACTED]. Asserting the text contains "[REDACTED]" and does not contain " 4 " is a decent behavioral check. But honestly, the exact string is cleaner if I trust the plan's sentence definition.

Let me weigh: the instruction says "PLAN.md above is your own specification and governs." The plan defines a sentence as a maximal run ending in a period — the period is included in the run. So `splitSentences` keeps punctuation. I'll go with the exact string "Defeating it requires [REDACTED] ember shards."

Hmm, but wait — actually, let me reconsider. "Maximal run of text ending in ., !, or ? (plus trailing whitespace)." If the sentence includes the period, then joining with " " reconstructs the original text exactly. That's a sensible design (the gate drops sentences but keeps them intact). And `isGrounded` tokenizes with punctuation stripped anyway. I'm fairly confident the period is kept.

But there's residual risk on the exact redacted string (e.g., maybe the redactor replaces "4" with "[REDACTED]" but also... no, that's the spec). Let me go with the exact assertion — it's the strongest proof and follows the plan. If I'm wrong about punctuation, the test would fail, but per the instructions the plan governs and I should write to it.

Hmm, actually, let me hedge slightly differently: assert the exact string, because that's what the plan specifies. Yes.
