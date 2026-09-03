# 09-answer.test.ts-cases

## reasoning

```
The user wants me to list the test cases for `test/answer.test.ts` based on the PLAN.md and the implementation files shown. I need to follow the specific format:

- <name of the test> — <what it proves, and what would have to be broken for it to fail>

Let me analyze what `test/answer.test.ts` covers based on the plan:

From PLAN.md section 5, tests for `test/answer.test.ts`:
- #3: When sources do not contain the answer, `answer()` returns `refused: true` and `text === "not covered by my sources"`.
- #5: In hint mode, boss names from the grounded answer are redacted (absent from output) and quantities are clamped to those in the question.
- #6: Ungrounded sentences are dropped; only grounded ones appear in the returned text.

But I need to go deeper and think about what could break on its own for each branch:

1. **Refusal path**: `answer()` should refuse when no sentences are grounded. What breaks: the gate logic is too lenient (everything passes), or the refusal string is wrong, or `refused` flag isn't set to true.

2. **Full mode returns grounded text**: In full mode, the answer should be the joined grounded sentences. What breaks: it joins ungrounded sentences too, or it redacts in full mode, or it calls LLM twice.

3. **Hint mode redacts boss names**: Boss names from `redactionConfig.bossNames` should not appear in hint output. What breaks: the redaction config isn't passed through, or redaction happens before grounding (redacting text that would be dropped anyway), or case sensitivity.

4. **Hint mode clamps quantities**: Numbers not in the question should be redacted; numbers in the question should remain. What breaks: all numbers are stripped, or numbers in the question are also stripped.

5. **Hint mode strips location phrases**: "in/on/at <Capitalized>" phrases should be redacted. What breaks: lowercase locations aren't caught (by design), or the regex is too greedy.

6. **Ungrounded sentences are dropped**: Only grounded sentences appear in the output. What breaks: the gate threshold is wrong, or ungrounded sentences sneak through.

7. **Hint mode does NOT call LLM a second time**: The ordering rule says hint mode redacts the full answer, never re-prompts. What breaks: the code calls `llm.generate` again for hint mode.

8. **ScriptedLLMClient exhaustion**: If the LLM is called more times than scripted replies, it throws. What breaks: `answer()` silently retries or catches the error.

9. **Boundary: single grounded sentence out of many**: If only 1 of 5 sentences is grounded, the output should contain only that one. What breaks: the code returns all sentences if at least one passes.

10. **Boundary: zero grounded sentences vs one**: The refusal threshold is exactly 0 grounded sentences. What breaks: it refuses at 1, or doesn't refuse at 0.

11. **The `groundedSentences` field in the result**: Even on refusal, the full sentence list (with grounding flags) should be returned. What breaks: it returns empty array on refusal, or omits the field.

12. **Prompt construction**: The prompt should contain sources joined by `---` and the question. What breaks: sources are concatenated without separators, or question is missing.

Wait, let me re-read the task. It says "List the test cases for `test/answer.test.ts`". So I should focus on what's specifically in that file, not the eval tests.

Let me also think about awkward cases:
- Empty sources array
- LLM returns empty string
- LLM returns a single sentence that's fully grounded
- Multiple boss names, some present, some not
- Question contains a number that appears in the answer (should be preserved)
- Question contains NO numbers (all numbers in answer should be redacted)

Let me also think about what the plan says the failure conditions are:

For the refusal test (#3): "When sources do not contain the answer, `answer()` returns `refused: true` and `text === "not covered by my sources"`."

For hint redaction (#5): "In hint mode, boss names from the grounded answer are redacted (absent from output) and quantities are clamped to those in the question."

For grounding drop (#6): "Ungrounded sentences are dropped; only grounded ones appear in the returned text."

Now let me think about what would have to break for each:

1. Refusal: The bigram overlap threshold must be too low (so ungrounded sentences pass), OR the code skips the refusal check, OR the refusal string is wrong.

2. Full mode no redaction: The code must apply redaction in full mode (mode check missing or inverted).

3. Boss name redaction: The `redactionConfig` must not be threaded through, OR the regex is case-sensitive, OR the replacement doesn't happen.

4. Quantity clamping: The number extraction from question must be wrong, OR the comparison is inverted (redacts numbers IN the question instead of those NOT in it).

5. Location redaction: The regex must not match, OR it over-matches (catches "in the room" where "the" is lowercase).

6. Ungrounded dropped: The threshold must be 0 (everything passes), OR the join includes ungrounded sentences.

7. Single LLM call: The ScriptedLLMClient has only 1 reply; if code calls generate twice, it throws "ScriptedLLMClient exhausted".

8. Exhaustion: If answer() is called and the LLM has no replies, it should throw (propagate).

Let me also think about:
- What if `redactionConfig` is undefined in hint mode? The plan says `if (input.mode === "hint" && redactionConfig)` — so it skips redaction. Is that a test case? The plan doesn't explicitly call for it, but it's a branch.
- What if sources array is empty? Then no bigrams can match, so all sentences are ungrounded → refusal.

Let me structure my list now. I'll aim for comprehensive but focused on `answer.test.ts` specifically.

Actually, re-reading the plan more carefully:

The plan says tests #3, #5, #6 are in `test/answer.test.ts`. But the instructions say "Cover the behaviour the task statement asks to be tested, and the behaviour the plan says matters." So I should include cases beyond just those three if there are important branches.

Let me finalize my list:
```

## reply

- **refuses when no sentence is grounded** — Proves that when the LLM's every sentence fails the bigram-overlap gate against the provided sources, `answer()` returns `{ refused: true, text: "not covered by my sources" }`. Fails if the overlap threshold is 0 (everything passes), if the refusal branch is missing, or if the refusal string differs even slightly.

- **refuses when sources array is empty** — Proves the same refusal path triggers with zero sources, not just "wrong" sources. Fails if the code short-circuits on empty input and returns an empty grounded list without setting `refused: true`, or if it throws instead of returning the refusal envelope.

- **full mode returns grounded sentences verbatim** — Proves that in `"full"` mode the returned text is the concatenation of only the grounded sentences, with no redaction applied. Fails if the mode check is inverted (redacts in full mode), or if ungrounded sentences are included in the join.

- **ungrounded sentences are dropped from output** — Proves that given a multi-sentence LLM reply where only a subset passes the gate, the output text contains only the passing sentences. Fails if the join step iterates over all sentences rather than `groundedOnly(...)`, or if the threshold is set so low that a wholly fabricated sentence still passes.

- **hint mode redacts boss names from the grounded answer** — Proves that a boss name present in the grounded text is absent (replaced by `[REDACTED]`) in hint-mode output. Fails if `redactionConfig` is not threaded into `redactForHint`, if the replacement regex is case-sensitive and the answer uses different casing, or if redaction runs on the pre-gate text and the name was in a dropped sentence (making the test vacuously pass).

- **hint mode clamps quantities to those in the question** — Proves that a number in the grounded answer that does NOT appear in the question is replaced with `[REDACTED]`, while a number that DOES appear in the question is preserved. Fails if the numeric comparison is inverted (redacts known quantities, keeps unknown ones), or if the question-number extraction regex misses multi-digit numbers.

- **hint mode strips location prepositional phrases** — Proves that a phrase like `"in the Ember Sanctum"` in the grounded answer is redacted in hint mode. Fails if the location regex does not fire (e.g. it requires two or more capitalised words but the fixture has only one), or if it over-matches lowercase phrases like `"in the room"` and the test asserts those are untouched.

- **hint mode does not call the LLM a second time** — Proves the ordering rule: hint redacts the already-grounded full answer. Fails if the code calls `llm.generate` again for hint mode; with a `ScriptedLLMClient` seeded with exactly one reply, a second call throws `"ScriptedLLMClient exhausted"`.

- **groundedSentences field is populated even on refusal** — Proves the caller can inspect per-sentence grounding results in both success and refusal paths. Fails if the refusal branch returns `groundedSentences: []` instead of the classified list, or omits the field entirely.

- **ScriptedLLMClient exhaustion propagates as an error** — Proves that when the LLM client has no replies left, `answer()` rejects rather than returning a silent fallback. Fails if the service catches the error and returns a grounded-looking default, or if it retries and masks the exhaustion.

- **boundary: single sentence that is fully grounded passes** — Proves the gate accepts a one-sentence reply whose bigrams all appear in a source. Fails if the denominator in the overlap ratio is off-by-one (e.g. counting a trailing period token) causing the ratio to dip below 0.7 for short sentences.

- **boundary: sentence at exactly the 0.7 threshold** — Proves a sentence whose bigram overlap is precisely 70 % is accepted (≥, not >). Fails if the comparison uses strict `>` instead of `>=`.

Deliberately not testing: the specific bigram extraction algorithm (which words count as "content", stopword lists) because that is an internal detail of `gateSentences` and would couple the test to implementation; the eval harness scoring logic because that lives in `test/eval.test.ts`; and the prompt string format because it is invisible to any observable output without intercepting the LLM call, which `ScriptedLLMClient` deliberately ignores.
