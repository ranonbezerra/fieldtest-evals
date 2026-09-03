## 1. Assumptions

| Open question | Choice | Why |
|---|---|---|
| Persistence | None. All state is in-memory per call. | Task defines a pure pipeline, no CRUD. |
| HTTP surface | None. Library + test entry point only. | Task asks for a pipeline and harness, not an API. |
| Grounding algorithm | Sentence-level keyword-overlap: a sentence is grounded if ≥ 70 % of its content-word bigrams appear in at least one source. | Deterministic, testable without an embedding model; matches "sentence-level" requirement. |
| Redaction strategy (hint mode) | Regex + entity list: strip proper nouns flagged as boss names, strip "in/on/at <location>" phrases, clamp numeric quantities to those already present in the player's question. | Derived from the full answer; no re-prompt. |
| LLM prompt shape | Single prompt string: system role + concatenated sources + question. The `LLMClient` receives one `string`. | Minimal contract; the scripted fake only needs to return a canned string. |
| Scenario fixtures location | Inlined as exported consts in `src/eval/scenarios.ts`. | Task says "provided as fixtures"; no external file adds a dependency. |
| `answer()` return on refusal | `{ text: "not covered by my sources", refused: true }`. No separate exception. | Task says "refuses with" that string; keeping it in the result keeps the caller simple. |
| Score pass threshold | 0.8 for `finalScore`. | Arbitrary; tests assert relative ordering (high vs low), not the absolute boundary. |

## 2. Data model

none

## 3. Types and signatures

### `src/sources.ts`

```ts
export interface Source {
  id: string;
  title: string;
  text: string;
}
```

### `src/llm-client.ts`

```ts
export interface LLMClient {
  generate(prompt: string): Promise<string>;
}

/** Scripted fake. Returns the string given at construction, or throws if called more than `replies` times. */
export declare class ScriptedLLMClient implements LLMClient {
  constructor(replies: string[]);
  generate(prompt: string): Promise<string>;
}
```

**Error:** `ScriptedLLMClient` throws `Error("ScriptedLLMClient exhausted")` if `generate` is called after all replies are consumed.

### `src/grounding.ts`

```ts
export interface GroundedSentence {
  text: string;
  grounded: boolean;
  sourceId: string | null;
}

/** Split raw LLM text into sentences, then classify each against sources. */
export declare function gateSentences(
  raw: string,
  sources: Source[],
): GroundedSentence[];

/** Return sentences that passed the gate, or empty array. */
export declare function groundedOnly(sentences: GroundedSentence[]): string[];
```

### `src/redaction.ts`

```ts
export interface RedactionConfig {
  bossNames: string[];
}

/**
 * Redact `answer` for hint mode.
 * Removes boss names (case-insensitive), location prepositional phrases,
 * and clamps quantities to those appearing in `question`.
 * Returns the redacted text plus a list of terms that were removed.
 */
export declare function redactForHint(
  answer: string,
  question: string,
  config: RedactionConfig,
): { text: string; removedTerms: string[] };
```

### `src/answer.ts`

```ts
export type Mode = "full" | "hint";

export interface AnswerInput {
  question: string;
  sources: Source[];
  mode: Mode;
}

export interface AnswerResult {
  text: string;
  refused: boolean;
  groundedSentences: GroundedSentence[];
}

/**
 * Pipeline entry point.
 * 1. Build prompt from question + sources.
 * 2. Call `llm.generate(prompt)`.
 * 3. Gate sentences; if none grounded → refuse.
 * 4. If mode === "hint", redact the grounded answer.
 * 5. Return `AnswerResult`.
 */
export declare function answer(
  input: AnswerInput,
  llm: LLMClient,
  redactionConfig?: RedactionConfig,
): Promise<AnswerResult>;
```

**Ordering rule:** The full grounded answer is always computed first. Hint mode redacts that result; it never calls `llm.generate` a second time.

### `src/eval/scenarios.ts`

```ts
export interface Scenario {
  id: string;
  question: string;
  sources: Source[];
  expectedFacts: string[];      // substrings the answer MUST contain
  plantedFalseFacts: string[];  // substrings the answer must NOT contain (invented/incorrect)
}

/** Golden fixtures. At minimum: one correct scenario, one confident-lie scenario, one no-source scenario. */
export declare const GOLDEN_SCENARIOS: Scenario[];
```

### `src/eval/judges.ts`

```ts
export interface JudgeVerdict {
  score: number;   // 0..1
  matched: string[];
  missed: string[];
}

/** Checks that every `expectedFact` appears (case-insensitive) in `answer`. */
export declare function helpfulnessJudge(
  answer: string,
  expectedFacts: string[],
): JudgeVerdict;

/**
 * Checks that no `plantedFalseFact` appears in `answer`, AND that every
 * quantity claim in `answer` is consistent with `sources`.
 * A quantity mismatch (e.g. "5 shards" vs source "4 shards") counts as
 * a violation and reduces the score.
 */
export declare function faithfulnessJudge(
  answer: string,
  sources: Source[],
  plantedFalseFacts: string[],
): JudgeVerdict;
```

### `src/eval/harness.ts`

```ts
export interface EvalResult {
  scenarioId: string;
  helpfulnessScore: number;
  faithfulnessScore: number;
  finalScore: number;          // min(helpfulness, faithfulness)
  passed: boolean;             // finalScore >= PASS_THRESHOLD
}

export declare const PASS_THRESHOLD: number; // 0.8

/** Run `answer()` for each scenario, then score with both judges. */
export declare function runEval(
  scenarios: Scenario[],
  llm: LLMClient,
  redactionConfig?: RedactionConfig,
): Promise<EvalResult[]>;
```

**Ordering rule:** `runEval` calls `answer()` once per scenario (mode `"full"`), then feeds the resulting text to both judges. Judges are independent; neither sees the other's output.

## 4. Control flow

```
answer(input, llm, redactionConfig?)
│
├─ 1. Build prompt: "You are a game guide. Answer using ONLY these pages:\n"
│      + sources joined by "\n---\n" + "\n\nQuestion: " + question
│
├─ 2. raw = await llm.generate(prompt)
│
├─ 3. sentences = gateSentences(raw, sources)
│     ├─ Split raw on sentence delimiters (. ! ? + whitespace)
│     └─ For each sentence: extract content-word bigrams; compute overlap
│        with every source. grounded = (maxOverlap / totalBigrams) ≥ 0.7
│        sourceId = id of the best-matching source, or null.
│
├─ 4. If groundedOnly(sentences).length === 0:
│     return { text: "not covered by my sources", refused: true, groundedSentences: sentences }
│
├─ 5. text = groundedOnly(sentences).join(" ")
│
├─ 6. If input.mode === "hint" && redactionConfig:
│     text = redactForHint(text, input.question, redactionConfig).text
│
└─ 7. return { text, refused: false, groundedSentences: sentences }
```

No transactions, no state machine, no side effects beyond the single `llm.generate` call.

## 5. Tests

| # | File | Proves |
|---|------|--------|
| 1 | `test/eval.test.ts` | A scripted LLM that returns a confident-lie (contains a planted false fact) yields `finalScore < PASS_THRESHOLD`. |
| 2 | `test/eval.test.ts` | A scripted LLM that returns a correct grounded answer (all expected facts, no false facts) yields `finalScore ≥ PASS_THRESHOLD`. |
| 3 | `test/answer.test.ts` | When sources do not contain the answer, `answer()` returns `refused: true` and `text === "not covered by my sources"`. |
| 4 | `test/eval.test.ts` | A scripted LLM that says "5 shards" while the source says "4 shards" causes `faithfulnessScore < PASS_THRESHOLD` (quantity mismatch caught exactly). |
| 5 | `test/answer.test.ts` | In hint mode, boss names from the grounded answer are redacted (absent from output) and quantities are clamped to those in the question. |
| 6 | `test/answer.test.ts` | Ungrounded sentences are dropped; only grounded ones appear in the returned text. |

## 6. Manifest

<!-- manifest
src/sources.ts | reads: - | Source interface
src/llm-client.ts | reads: - | LLMClient interface and ScriptedLLMClient
src/grounding.ts | reads: src/sources.ts | gateSentences, groundedOnly
src/redaction.ts | reads: - | redactForHint and RedactionConfig
src/answer.ts | reads: src/sources.ts, src/llm-client.ts, src/grounding.ts, src/redaction.ts | answer() pipeline entry point
src/eval/scenarios.ts | reads: src/sources.ts | Scenario type and GOLDEN_SCENARIOS fixtures
src/eval/judges.ts | reads: src/sources.ts | helpfulnessJudge, faithfulnessJudge
src/eval/harness.ts | reads: src/answer.ts, src/eval/scenarios.ts, src/eval/judges.ts | runEval and EvalResult
test/answer.test.ts | reads: src/answer.ts, src/llm-client.ts, src/sources.ts, src/redaction.ts | refusal, grounding drop, hint redaction
test/eval.test.ts | reads: src/eval/harness.ts, src/eval/scenarios.ts, src/eval/judges.ts, src/llm-client.ts | low score on lie, high score on correct, quantity error caught
-->
