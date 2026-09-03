# plan

## reasoning

```
Let me analyze the task carefully:

1. Build an answer pipeline + eval harness for a gameplay assistant
2. Input: player question + 2-3 fetched wiki page texts (fixtures)
3. Output: answer grounded ONLY in those pages, plus spoiler-free hint mode
4. TypeScript

Key deliverables:
1. `answer(question, sources, mode)` with injectable LLM client (scripted fake), sentence-level grounding gate
2. Hint mode derived by redacting the full grounded answer (not re-prompting)
3. Eval harness: golden scenarios, helpfulness judge, faithfulness judge (receives sources), final score = min of both
4. Tests proving specific scenarios

Now let me think about the architecture:

- No database, no persistence needed. This is a pure in-memory pipeline.
- The LLM client is injectable (scripted fake for tests).
- Grounding gate: split LLM output into sentences, check each sentence against sources. If a sentence isn't grounded, drop it or refuse entirely.
- Hint mode: take the full grounded answer, redact it (remove boss names, item locations, quantities beyond what player mentioned).
- Eval harness: scenarios with expected facts + planted FALSE facts. Two judges. Final score = min(helpfulness, faithfulness).

Let me think about the types:

- `LLMClient` - interface with a method to generate text
- `Source` - a wiki page (id, title, text)
- `Mode` - "full" | "hint"
- `AnswerResult` - the output of answer()
- `GroundedSentence` - a sentence with grounding status
- `Scenario` - for eval harness
- `JudgeResult` - from a judge
- `EvalResult` - final eval output

Let me think about the grounding gate:
- Split answer into sentences
- For each sentence, check if it's supported by the sources (keyword/semantic overlap)
- If a sentence is ungrounded: drop it. If ALL sentences are ungrounded: refuse with "not covered by my sources"

For the redaction (hint mode):
- Take grounded answer
- Remove: boss names (proper nouns that are bosses), item locations, quantities beyond what player mentioned
- This is a text transformation, not a re-prompt

For the eval harness:
- Golden scenarios: question, sources, expected facts (list of strings), planted false facts (list)
- Helpfulness judge: checks if expected facts are present in answer
- Faithfulness judge: receives sources + answer, checks no unsupported claims (especially catches planted false facts and quantity errors)
- Final score = min(helpfulness_score, faithfulness_score)

Now for file layout:

This is NOT a NestJS API. It's a library/CLI tool. The task says "answer pipeline + eval harness" in TypeScript. No HTTP endpoints, no database.

Let me re-read the conventions:
- "NestJS for the API" - but this isn't an API, it's a pipeline
- "Prisma as the ORM" - no persistence needed
- "Vitest for tests" - yes

Since there's no API, no database, I'll keep it as a library with:
- `src/llm-client.ts` - the LLMClient interface + scripted fake
- `src/grounding.ts` - grounding gate logic
- `src/redaction.ts` - hint mode redaction
- `src/answer.ts` - the main answer() function
- `src/eval/scenario.ts` - scenario types + fixtures
- `src/eval/judge.ts` - judges
- `src/eval/harness.ts` - the eval harness

Wait, let me reconsider. The task says "In TypeScript, deliver" and lists specific things. Let me keep it focused.

Actually, looking at the conventions more carefully:
- "src/<feature>/<feature>.module.ts" etc. is for NestJS features
- This isn't a NestJS app, it's a standalone pipeline

I'll structure it as:
- `src/llm-client.ts` - LLMClient interface, ScriptedLLMClient
- `src/sources.ts` - Source type
- `src/grounding.ts` - grounding gate
- `src/redaction.ts` - hint redaction
- `src/answer.ts` - answer() main function
- `src/eval/scenarios.ts` - scenario types + golden fixtures
- `src/eval/judges.ts` - helpfulness judge, faithfulness judge
- `src/eval/harness.ts` - runEval()
- `test/answer.test.ts` - tests for answer pipeline
- `test/eval.test.ts` - tests for eval harness

Let me think about what "injectable LLM client" means. It's an interface:
```typescript
interface LLMClient {
  generate(prompt: string): Promise<string>;
}
```

The scripted fake just returns pre-configured responses.

For the grounding gate, I need to think about what "grounded" means. A sentence is grounded if its key claims appear in the sources. For a simple implementation:
- Extract key phrases/entities from each sentence
- Check if they appear in the source texts
- A sentence is grounded if sufficient overlap

For a practical implementation, I'll use a simple approach:
- Split into sentences
- For each sentence, check if the sentence's content is supported by sources (keyword overlap threshold)
- Or: check if key noun phrases in the sentence appear in at least one source

Let me think about the redaction more carefully:
- Boss names: proper nouns that correspond to known entities in sources (I'll define a list or use a heuristic)
- Item locations: phrases like "in the basement", "on the shelf" that indicate where items are
- Quantities: numbers that go beyond what the player mentioned in their question

For the eval:
- `helpfulnessScore`: fraction of expected facts present in answer
- `faithfulnessScore`: 1 - (fraction of planted false facts present) and also check for quantity errors
- Final = min(helpfulnessScore, faithfulnessScore)

Wait, re-reading: "a helpfulness judge and a faithfulness judge that receives the sources; final score = min of the two"

So:
- Helpfulness judge: does the answer cover the expected facts? (receives question + answer)
- Faithfulness judge: is every claim in the answer supported by sources? (receives answer + sources)
- Final = min of both

For quantity errors: the faithfulness judge should catch "5 shards" when sources say "4 shards". This is a specific check.

Let me now think about the types more carefully:

```typescript
// src/sources.ts
interface Source {
  id: string;
  title: string;
  text: string;
}

// src/llm-client.ts
interface LLMClient {
  generate(prompt: string): Promise<string>;
}

// src/answer.ts
type Mode = "full" | "hint";

interface AnswerInput {
  question: string;
  sources: Source[];
  mode: Mode;
}

interface AnswerResult {
  text: string;
  groundedSentences: GroundedSentence[];
  refused: boolean;
  refusalReason?: string;
}

interface GroundedSentence {
  text: string;
  grounded: boolean;
  sourceId?: string;
}

// src/redaction.ts
interface RedactionResult {
  text: string;
  redactedTerms: string[];
}

// src/eval/scenarios.ts
interface Scenario {
  id: string;
  question: string;
  sources: Source[];
  expectedFacts: string[];
  plantedFalseFacts: string[];
}

// src/eval/judges.ts
interface JudgeVerdict {
  score: number; // 0..1
  matchedFacts: string[];
  missedFacts: string[];
  violations: string[]; // for faithfulness: unsupported claims
}

// src/eval/harness.ts
interface EvalResult {
  scenarioId: string;
  helpfulnessScore: number;
  faithfulnessScore: number;
  finalScore: number;
  verdict: "pass" | "fail";
}
```

Now for the ordering rule: hint mode is derived FROM the full grounded answer. So you must always compute the full answer first, then redact. Never re-prompt.

Let me think about what the tests need to prove:
1. A scripted confident-lie answer scores low (in eval)
2. A correct grounded answer scores high (in eval)
3. A scenario whose sources lack the answer yields refusal
4. Quantity errors are caught exactly

For test 1: Script the LLM to output an answer containing a planted false fact. Run eval. Score should be low.
For test 2: Script the LLM to output a correct grounded answer. Run eval. Score should be high.
For test 3: Script the LLM to output sentences not in sources. The grounding gate should refuse.
For test 4: Script the LLM to say "5 shards" when sources say "4". Faithfulness judge should catch it.

Now let me write the plan. I need to be terse and complete.

Let me reconsider the file structure. Since this isn't a NestJS API (no controllers, no database), I'll use a flat structure under src/:

```
src/llm-client.ts
src/sources.ts  
src/grounding.ts
src/redaction.ts
src/answer.ts
src/eval/scenarios.ts
src/eval/judges.ts
src/eval/harness.ts
test/answer.test.ts
test/eval.test.ts
```

Wait, the conventions say `kebab-case.role.ts` for files. Let me use:
- `src/llm-client.ts` (it's a single interface + implementation, not a role split)
- Actually the convention is for feature modules. For a library like this, I'll just use descriptive names.

Let me finalize my plan and write it out concisely.
```

## reply

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
