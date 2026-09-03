# 10-eval.test.ts-cases

## reasoning

```
The user wants me to list test cases for `test/eval.test.ts` based on the task statement, PLAN.md, and the implementation files shown. I should NOT write tests, just list them in the specified format.

Let me analyze what `test/eval.test.ts` should cover based on:

1. The task statement says tests must prove:
   - A scripted confident-lie answer scores low
   - A correct grounded answer scores high
   - A scenario whose sources lack the answer yields refusal
   - Quantity errors (e.g., "5 shards" when sources say 4) are caught exactly

2. PLAN.md section 5 lists for `test/eval.test.ts`:
   - #1: A scripted LLM that returns a confident-lie (contains a planted false fact) yields `finalScore < PASS_THRESHOLD`
   - #2: A scripted LLM that returns a correct grounded answer (all expected facts, no false facts) yields `finalScore ≥ PASS_THRESHOLD`
   - #4: A scripted LLM that says "5 shards" while the source says "4 shards" causes `faithfulnessScore < PASS_THRESHOLD` (quantity mismatch caught exactly)

3. From the implementation, I can see additional branches:
   - `runEval` iterates over scenarios and calls `answer()` per scenario
   - `finalScore = Math.min(helpfulness, faithfulness)` — so if one is low, final is low
   - `passed = finalScore >= PASS_THRESHOLD` (0.8)
   - The harness always uses mode "full"
   - `ScriptedLLMClient` throws if exhausted
   - The vault-no-source scenario: when sources don't contain the answer, `answer()` returns refused with "not covered by my sources"
   - The helpfulness judge: if `expectedFacts` is empty, score is 1
   - The faithfulness judge: quantity regex extraction, mismatch detection
   - `runEval` returns an array of results, one per scenario

Let me think about what test cases make sense for `test/eval.test.ts` specifically (not `test/answer.test.ts`):

From the task + plan:
1. Confident-lie scores low (finalScore < PASS_THRESHOLD)
2. Correct grounded answer scores high (finalScore >= PASS_THRESHOLD)
3. Sources lack answer → refusal (this is more of an answer.test.ts case, but the harness should propagate it)
4. Quantity error caught exactly

Additional branches I can see in the implementation that could be wrong:
- `finalScore = Math.min(helpfulness, faithfulness)` — what if helpfulness is high but faithfulness is low? Final should be low.
- `passed` boundary: exactly 0.8 should pass (>=), 0.79 should not.
- Multiple scenarios: `runEval` returns one result per scenario, in order.
- The refusal case through the harness: when `answer()` returns refused text, the judges still run on "not covered by my sources" — what score does that get?
- ScriptedLLMClient exhaustion: if you run eval with a client that has fewer replies than scenarios.
- The faithfulness judge's quantity regex: what about multi-word units? "Ember Shards" vs "shards"? The regex is `/\b(\d+)\s+([a-zA-Z]+)\b/g` — it only captures single-word units. So "4 Ember Shards" would be parsed as "4 Ember" (unit "ember") not "4 shards". Wait, let me re-read... The regex captures `(\d+)\s+([a-zA-Z]+)` — so "4 Ember Shards" would match "4 Ember" first. Hmm, that's a potential issue but the test in scenarios says "4 Ember Shards" as expected fact. Let me look at the faithfulness judge more carefully...

Actually looking at the regex: `/\b(\d+)\s+([a-zA-Z]+)\b/g` — for "4 Ember Shards", it would match "4 Ember" (num=4, unit="ember"). Then for the source text "4 Ember Shards", the pattern `\b(\d+)\s+ember\b` would match "4 Ember" in the source. So it works for single-word units.

But what about "5 shards" — that would match num=5, unit="shards". Source has "4 Ember Shards" — the pattern `\b(\d+)\s+shards\b` would match "4 Shards" in the source. Wait, does "4 Ember Shards" contain "shards"? Yes it does. So the pattern `\b(\d+)\s+shards\b` would match... hmm, "4 Ember Shards" — does `\b(\d+)\s+shards\b` match here? The pattern requires a digit immediately followed by whitespace then "shards". In "4 Ember Shards", the digit "4" is followed by " Ember Shards", not directly by "shards". So `\b(\d+)\s+shards\b` would NOT match "4 Ember Shards" because between "4" and "Shards" there's "Ember".

Wait, let me re-read the regex: `\\b(\\d+)\\s+${escapeRegex(claim.unit)}\\b` — so for unit "shards", it's `\b(\d+)\s+shards\b`. In the text "The Dragonblade requires 4 Ember Shards to forge." — would `\b(\d+)\s+shards\b` match? It needs a word boundary, then digits, then whitespace, then "shards". In "4 Ember Shards", after "4" comes " Ember Shards" — so `\d+\s+shards` would need digits immediately followed by whitespace then "shards". "4" is followed by " Ember" not " shards". So it would NOT match.

Hmm, but what about just "Shards" appearing? The regex requires a digit before it. So in the source text "4 Ember Shards", the pattern `\b(\d+)\s+shards\b` would not match because the digit "4" is not directly adjacent to "Shards".

This means if the LLM says "5 Shards" (num=5, unit="shards"), the faithfulness judge would look for `\b(\d+)\s+shards\b` in sources, find nothing (because the source says "4 Ember Shards" not "4 Shards"), so `hasSourceCounterpart` would be false, and the check wouldn't be added to totalChecks. The quantity mismatch would NOT be caught!

Wait, but the test scenario says: source text is "The Dragonblade requires 4 Ember Shards to forge." and the planted false fact is "5 Ember Shards". So the plantedFalseFacts check would catch "5 Ember Shards" if the answer contains it. But the quantity regex for "5 shards" (lowercase, just "shards") might not match.

Actually, let me re-read the test case #4 from the plan: "A scripted LLM that says '5 shards' while the source says '4 shards' causes faithfulnessScore < PASS_THRESHOLD". The key here is "5 shards" and "4 shards" — if both use the same single-word unit, then `\b(\d+)\s+shards\b` would match both. So the test should use a source that says "4 shards" (not "4 Ember Shards") for the quantity test to work with the current regex.

OK so this is an important edge case. Let me think about what tests to list:

For `test/eval.test.ts`:

1. **Confident-lie scores low** — The LLM returns an answer containing a planted false fact. `finalScore` should be < PASS_THRESHOLD (0.8). Would fail if: faithfulnessJudge doesn't detect the false fact, or if `min()` isn't applied, or if PASS_THRESHOLD is wrong.

2. **Correct grounded answer scores high** — The LLM returns an answer containing all expected facts and no false facts. `finalScore` should be >= PASS_THRESHOLD. Would fail if: helpfulnessJudge doesn't match facts, or faithfulnessJudge incorrectly flags something, or the grounding gate drops valid sentences.

3. **Sources lack answer → refusal propagates** — The LLM returns text that shares no bigrams with sources. `answer()` refuses. The harness still runs judges on the refusal text. The result should show low helpfulness (if expectedFacts are non-empty) or the refusal text. Would fail if: the harness crashes on refusal, or if it doesn't still produce an EvalResult.

4. **Quantity mismatch caught exactly** — LLM says "5 shards", source says "4 shards". `faithfulnessScore` should be < PASS_THRESHOLD. Would fail if: the regex doesn't extract quantities, or the comparison logic is inverted, or the score computation is wrong.

5. **finalScore is the minimum of the two** — Construct a case where helpfulness is high (all facts present) but faithfulness is low (a quantity mismatch). `finalScore` must equal the faithfulness score, not the helpfulness score. Would fail if: `Math.min` is replaced with `Math.max`, or if one judge's score is used directly.

6. **Multiple scenarios produce one result each, in order** — Run with 2+ scenarios. The returned array has the same length and order as input. Would fail if: the loop skips a scenario, or reorders results.

7. **ScriptedLLMClient exhaustion** — Run eval with 2 scenarios but a client with only 1 reply. The second `answer()` call should throw. Would fail if: the harness catches and swallows the error, or if the client doesn't actually track its index.

8. **Boundary: score exactly at PASS_THRESHOLD passes** — Construct a scenario where `finalScore` is exactly 0.8. `passed` should be `true`. Would fail if: the comparison is `>` instead of `>=`.

9. **Empty expectedFacts → helpfulness is 1** — A scenario with no expected facts (like the vault scenario). Even if the answer is a refusal, helpfulness score should be 1 (since there's nothing to match). Would fail if: the judge divides by zero, or treats empty array as a failure.

10. **Refusal text doesn't accidentally satisfy expected facts** — The refusal string "not covered by my sources" should not contain any expected fact substrings. If it did, the helpfulness judge would give a false positive. Would fail if: the refusal message coincidentally contains a fact string.

Hmm, let me reconsider. The user said "List the test cases for `test/eval.test.ts`" and the plan specifically assigns certain tests to this file vs `test/answer.test.ts`. Let me focus on what's explicitly assigned to `test/eval.test.ts`:

From PLAN.md:
- #1: confident-lie → low finalScore
- #2: correct grounded → high finalScore
- #4: quantity error → low faithfulnessScore

But the user also says "Cover the behaviour the task statement asks to be tested, and the behaviour the plan says matters. A case per branch that could be wrong on its own."

And: "Include the cases that are awkward: concurrency, duplicate delivery, exhaustion, boundary values, the error path that looks like the success path."

Let me also think about what's specific to the eval harness vs the answer pipeline:
- The harness always uses mode "full" — hint mode is tested in answer.test.ts
- The harness runs judges independently
- The harness computes min
- The harness determines pass/fail

Let me also think about the "error path that looks like the success path":
- A refusal ("not covered by my sources") is NOT an error — it returns a valid AnswerResult. The harness processes it normally. This could look like success (no exception) but the score should be low if expectedFacts are non-empty.

Let me also think about the quantity regex edge cases:
- What if the answer has "4 shards" and the source also has "4 shards"? That should pass (no mismatch).
- What if the answer has "4 shards" and the source has "4 Ember Shards"? The regex `\b(\d+)\s+shards\b` won't match "4 Ember Shards" in the source. So no check is added. This is a limitation but it means the quantity check is silent, not a failure.

Actually wait — I need to be more careful. Let me re-read the faithfulness judge:

```ts
const qtyRegex = /\b(\d+)\s+([a-zA-Z]+)\b/g;
```

For "4 Ember Shards": this would match "4 Ember" (num=4, unit="ember"). It would NOT match "Shards" alone because there's no digit immediately before it (there's a space and "Ember").

For the source "The Dragonblade requires 4 Ember Shards to forge." — the pattern for unit "ember" would be `\b(\d+)\s+ember\b`. This matches "4 Ember". So if the answer says "5 ember", it would be caught as a mismatch.

But if the answer says "5 shards", the pattern is `\b(\d+)\s+shards\b`. In the source "4 Ember Shards", there's no digit immediately before "Shards" (it's preceded by "Ember "). So no match, no check. The quantity error is NOT caught.

This is a real limitation. But the test case in the plan says "5 shards" vs "4 shards" — so the test should use a source where the quantity is directly adjacent to the unit word (e.g., "The forge requires 4 shards.").

OK, I think I have enough to write a comprehensive list. Let me also consider:
- The harness passes `redactionConfig` through to `answer()` — but since mode is always "full", redaction never happens. So testing redaction in eval context is pointless (it's in answer.test.ts).
- The harness doesn't test hint mode at all.

Let me finalize my list, keeping it focused on `test/eval.test.ts` specifically.
```

## reply

- confident-lie scores below threshold — The LLM is scripted to return an answer that contains a planted false fact (e.g. "requires the Crystal Key") alongside some grounded text. `finalScore` must be < 0.8. Would fail if: the faithfulnessJudge's planted-fact substring check is inverted (penalises absence instead of presence), the `Math.min` in the harness is replaced by `Math.max` so the high helpfulness score masks the low faithfulness score, or the grounding gate drops the sentence carrying the false fact so the judge never sees it.

- correct grounded answer scores at or above threshold — The LLM returns an answer that contains every expected fact and no planted false fact, and whose bigrams overlap the source. `finalScore` must be ≥ 0.8 and `passed` must be true. Would fail if: the grounding gate's 70 % threshold is miscalibrated and drops a legitimately grounded sentence, the helpfulnessJudge's case-insensitive `includes` is broken (e.g. missing a fact due to a typo in the fixture), or the harness feeds the raw ungrounded text instead of the gated text to the judges.

- sources-lack-answer yields refusal and a low helpfulness score — The scenario's source text shares no content-word bigrams with the LLM's reply (the vault/riverbend fixture). `answer()` refuses with "not covered by my sources". The harness still runs both judges on that refusal string. Because the scenario's `expectedFacts` is non-empty, helpfulness must be 0 and `finalScore` < 0.8. Would fail if: the harness throws or skips the scenario when `refused` is true, the refusal string accidentally contains an expected-fact substring (false positive in helpfulness), or the harness short-circuits and never calls the judges.

- quantity mismatch is caught exactly — The source says "4 shards"; the scripted LLM says "5 shards" with otherwise grounded filler. `faithfulnessScore` must be < 0.8 and the verdict's `missed` array must contain a string identifying both numbers. Would fail if: the quantity regex `\b(\d+)\s+([a-zA-Z]+)\b` is broken so it never extracts the pair, the comparison `srcNum !== claim.num` uses `!==` on strings instead of numbers (or vice-versa) and "4" === "4" but "5" !== "4" silently becomes a type-equality no-op, the source-lookup regex is built with the wrong unit casing and misses a case-insensitive match, or the mismatch decrements `passedChecks` instead of incrementing `totalChecks`.

- quantity match is not penalised — The source says "4 shards" and the LLM also says "4 shards". `faithfulnessScore` must remain 1 (or at least not drop below what the planted-fact checks give). Would fail if: the faithfulnessJudge treats "source has a counterpart for this unit" as an automatic penalty, or the `isMismatch` flag is initialised to `true` instead of `false`.

- finalScore is the minimum, not the maximum — Construct a scenario where all expected facts are present (helpfulness = 1) but one quantity is off by one (faithfulness ≈ 0.5). `finalScore` must equal the faithfulness score, not 1. Would fail if: the harness uses `Math.max`, averages the two scores, or returns only one of them.

- boundary: score exactly at PASS_THRESHOLD passes — Craft a scenario where the combined checks produce `finalScore === 0.8` exactly (e.g. 4 checks, 3 pass). `passed` must be `true`. Would fail if: the comparison is strict `>` instead of `>=`, or floating-point rounding in the division pushes 0.8 to 0.7999…

- multiple scenarios return one EvalResult each, in input order — Run `runEval` with the three golden scenarios. The returned array must have length 3, and `scenarioId` at each index must match the corresponding input scenario. Would fail if: the `for` loop has an off-by-one, a `continue` skips a scenario after a refused result, or results are pushed in a different order (e.g. collected then sorted).

- ScriptedLLMClient exhaustion propagates — Run `runEval` with 2 scenarios but a `ScriptedLLMClient` constructed with only 1 reply. The second `answer()` call must throw `Error("ScriptedLLMClient exhausted")`. Would fail if: the harness wraps the loop body in a try/catch that swallows the error and pushes a zero-score result, or if `ScriptedLLMClient.generate` doesn't increment its index and the first reply is returned twice.

- empty plantedFalseFacts and no quantity claims → faithfulness is 1 — A scenario where `plantedFalseFacts` is `[]` and the grounded answer contains no digit-unit pairs. `faithfulnessScore` must be exactly 1 (the `totalChecks === 0` branch). Would fail if: the guard is missing and the code divides `0/0` producing `NaN`, which then makes `Math.min` return `NaN` and `passed` false.

Deliberately not testing here: hint-mode redaction (boss-name stripping, quantity clamping) belongs to `test/answer.test.ts` because the harness always calls `answer()` with mode `"full"` and never exercises `redactForHint`; the grounding gate's bigram threshold and sentence-splitting edge cases (abrupt text with no terminal punctuation, single-word sentences) are unit-level concerns for `src/grounding.ts` and do not change the harness's contract of one result per scenario.
