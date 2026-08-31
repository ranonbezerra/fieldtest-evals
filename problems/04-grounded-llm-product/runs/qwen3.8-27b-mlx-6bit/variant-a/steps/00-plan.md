# plan

## reply

## 1. Assumptions

- No persistence: the pipeline is stateless (question + sources in, answer out). "none" for data model.
- File layout is flat under `src/`, one file per concern, named `kebab-case.ts`; no NestJS module/controller wiring because the task is a library pipeline, not an HTTP service.
- The LLM client is an injected interface; the eval harness uses a scripted fake. No real network, no env vars, no `DATABASE_URL`.
- "Sentence" = maximal run of text ending in `.`, `!`, or `?` (plus trailing whitespace). Grounding and redaction operate at that unit.
- Grounding gate is lexical, not semantic: a sentence survives only if its content words all appear in the sources (case-insensitive, punctuation-stripped). This makes the "5 vs 4 shards" and "invented item" failures deterministic and exactly catchable.
- Content words = non-stopword tokens, lowercased, alphanumeric; stopwords are a fixed small set (the, a, an, is, are, to, of, in, on, you, your, the, it, that, this, and, or, for, with, be, can, will, has, have). Digits are kept as tokens so quantities compare exactly.
- "Facts" in a scenario are normalized strings (lowercased, whitespace-collapsed, punctuation-stripped) so comparison is exact.
- A planted FALSE fact is a string that must NOT appear as a grounded/faithful claim in the answer; if it does, faithfulness fails.
- Helpfulness judge: fraction of expected facts present in the answer (string containment after normalization).
- Faithfulness judge: 1.0 if every sentence in the answer is grounded AND no planted-false fact appears in the answer; else 0.0. (Binary makes "caught exactly" trivially provable.)
- Final score = min(helpfulness, faithfulness).
- Refusal: when zero sentences survive grounding, the service returns a refusal object (not an exception) with message "not covered by my sources".
- Hint mode: redact the full grounded answer by replacing every token that is a boss name, an item location, or a quantity (digit) with `[REDACTED]`, then strip any resulting sentence that becomes empty of content. Player-mentioned tokens (from the question) are allowed to remain.
- Boss names and item locations are supplied per-scenario in the eval config (a `redaction` list), because the pipeline has no way to know which nouns are spoilers.
- The answer object carries both `text` and the surviving `sentences` so the hint redactor and the judges work on the same grounded artifact without re-prompting.
- Errors: only one error type, `GroundingError`, raised when sources are empty. All other failures are returned as refusal or low score, not thrown.

## 2. Data model

none

## 3. Types and signatures

```ts
// src/llm-client.ts
export interface LlmClient {
  generate(prompt: string, context: string[]): Promise<string>;
}

// src/grounding.ts
export interface GroundedAnswer {
  text: string;
  sentences: string[];
  refused: boolean;
}

export function splitSentences(text: string): string[];

export function tokenSet(text: string): Set<string>;

export function isGrounded(sentence: string, sourceTokens: Set<string>): boolean;

export function groundAnswer(rawAnswer: string, sources: string[]): GroundedAnswer;
// Raises GroundingError if sources is empty.

// src/hint.ts
export interface HintConfig {
  redactTokens: string[];   // boss names, item locations (lowercased)
  playerMentioned: string[]; // tokens from the question, lowercased
}

export function redactToHint(grounded: GroundedAnswer, config: HintConfig): string;
// Returns "" (refusal) if grounded.refused.

// src/answer.ts
export type AnswerMode = "full" | "hint";

export interface AnswerRequest {
  question: string;
  sources: string[];
  mode: AnswerMode;
}

export interface AnswerResult {
  text: string;
  refused: boolean;
}

export class GroundingError extends Error {
  code: "empty_sources";
}

export function answer(
  req: AnswerRequest,
  llm: LlmClient,
  hint?: HintConfig
): Promise<AnswerResult>;
// Raises GroundingError if req.sources is empty.
// hint is required when mode === "hint".

// src/eval.ts
export interface Scenario {
  id: string;
  question: string;
  sources: string[];
  expectedFacts: string[];
  plantedFalseFacts: string[];
  redactTokens: string[];
}

export interface JudgeResult {
  helpfulness: number; // 0..1
  faithfulness: number; // 0..1
  score: number;        // min of the two
}

export function judgeHelpfulness(answerText: string, expectedFacts: string[]): number;

export function judgeFaithfulness(
  answerText: string,
  sources: string[],
  plantedFalseFacts: string[]
): number;

export function evaluateScenario(
  scenario: Scenario,
  llm: LlmClient
): Promise<JudgeResult>;

// src/fake-llm.ts
export class ScriptedLlm implements LlmClient {
  constructor(responses: Map<string, string>);
  generate(prompt: string, context: string[]): Promise<string>;
}
```

Ordering rule: `answer` must build the full grounded answer first, then derive the hint from it; hint mode never calls `llm.generate` a second time.

## 4. Control flow

- `answer`:
  1. If `sources` empty, raise `GroundingError`.
  2. Build prompt from `question`; call `llm.generate` once, get raw text.
  3. Run `groundAnswer(rawText, sources)` → `GroundedAnswer`.
  4. If `mode === "full"`: return `{ text: grounded.text, refused: grounded.refused }`.
  5. If `mode === "hint"`: run `redactToHint(grounded, hint)`; return `{ text: redacted, refused: grounded.refused }`.
- `groundAnswer`:
  1. Compute `sourceTokens` = union of `tokenSet` over all sources.
  2. Split raw text into sentences.
  3. Keep sentences where `isGrounded` is true.
  4. If none kept, return `{ text: "not covered by my sources", sentences: [], refused: true }`.
  5. Else return `{ text: kept.join(" "), sentences: kept, refused: false }`.
- `redactToHint`:
  1. If `grounded.refused`, return the refusal text.
  2. For each sentence, replace any token in `redactTokens` or any digit-token with `[REDACTED]`, unless the token is in `playerMentioned`.
  3. Drop sentences with no remaining content tokens; join and return.
- `evaluateScenario`:
  1. Call `answer({ question, sources, mode: "full" }, llm)`.
  2. Compute `helpfulness = judgeHelpfulness(result.text, scenario.expectedFacts)`.
  3. Compute `faithfulness = judgeFaithfulness(result.text, scenario.sources, scenario.plantedFalseFacts)`.
  4. Return `{ helpfulness, faithfulness, score: min(...) }`.
- No transactions (no persistence). No state carried between calls.

## 5. Tests

- `answer` with a scripted LLM that returns a confident lie (contains an invented item requirement) scores faithfulness 0 and final score low.
- `answer` with a scripted LLM that returns a correct grounded answer (all sentences in sources, all expected facts present) scores helpfulness 1 and faithfulness 1.
- `answer` where the sources do not contain the answer yields `refused: true` and text "not covered by my sources".
- A scenario where the answer says "5 shards" but sources say "4 shards" is caught: faithfulness 0 (quantity token mismatch).
- `judgeFaithfulness` returns 1 when every sentence is grounded and no planted-false fact appears.
- `judgeFaithfulness` returns 0 when a planted-false fact string appears in the answer.
- `judgeHelpfulness` returns 1 when all expected facts (normalized) are contained in the answer.
- `judgeHelpfulness` returns a fraction < 1 when only some expected facts are present.
- `redactToHint` removes boss names and item locations from a grounded answer.
- `redactToHint` removes digit quantities not mentioned by the player.
- `redactToHint` preserves a quantity the player already mentioned in the question.
- `answer` with `mode: "hint"` calls `llm.generate` exactly once (no re-prompt).
- `answer` raises `GroundingError` when sources is empty.

## 6. Manifest

<!-- manifest
src/llm-client.ts | reads: - | LlmClient interface
src/grounding.ts | reads: src/llm-client.ts | sentence split, token set, grounding gate, GroundedAnswer
src/hint.ts | reads: src/grounding.ts | HintConfig, redactToHint
src/answer.ts | reads: src/llm-client.ts, src/grounding.ts, src/hint.ts | AnswerMode, AnswerRequest, AnswerResult, GroundingError, answer
src/eval.ts | reads: src/answer.ts, src/llm-client.ts | Scenario, JudgeResult, judges, evaluateScenario
src/fake-llm.ts | reads: src/llm-client.ts | ScriptedLlm
test/answer.test.ts | reads: src/answer.ts, src/fake-llm.ts, src/eval.ts | proves grounded high, lie low, refusal, quantity catch
test/grounding.test.ts | reads: src/grounding.ts | proves sentence split and grounding gate
test/hint.test.ts | reads: src/hint.ts, src/grounding.ts | proves redaction of spoilers and quantities
test/eval.test.ts | reads: src/eval.ts, src/fake-llm.ts, src/answer.ts | proves helpfulness and faithfulness judges
-->
