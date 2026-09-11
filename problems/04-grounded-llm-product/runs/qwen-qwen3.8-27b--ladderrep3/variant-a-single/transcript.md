# Transcript — 04-grounded-llm-product / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
Let me think carefully about this task.

The task is to build the answer pipeline + evaluation harness for the game guide assistant (variant A). It's in TypeScript, and the spec says:

1. `answer(question, sources, mode)` uses an injectable LLM client (scripted fakes are OK), with sentence-level grounding gating: ungrounded sentences are dropped, or the service refuses with "not covered by my sources".
2. Hint mode is derived by redacting (masking) the complete grounded answer. Not by re-prompting.
3. Evaluation harness: golden scenarios (question, source, expected facts, planted false facts such as fabricated item requirements); a helpfulness judge and a faithfulness judge (which receives the sources); final score = min of both.
4. Tests to prove: scripted confident-lie answers score low; correct grounded answers score high; scenarios where the source doesn't contain the answer produce refusal; quantity errors (e.g. "5 shards" when source says 4) are caught accurately.

Context conventions:
- TypeScript strict, Node 20+, NestJS for the API, Prisma/PostgreSQL, Vitest for tests, pnpm, ESM `"type": "module"`.
- Layout: `prisma/schema.prisma`, `src/main.ts`, `src/app.module.ts`, `src/<feature>/<feature>.module.ts`, `src/<feature>/<feature>.controller.ts`, `src/<feature>/<feature>.service.ts`, `src/<feature>/<feature>.repository.ts`, `test/<feature>.spec.ts`.
- Layers: controllers validate input and call the service. Services hold the logic, zero raw SQL, zero Prisma calls. Repositories touch the DB.
- Errors: a single envelope `{ "error": { "code": "snake_case", "message": "...", "details": {} } }`.
- Naming: tables/columns are snake_case via `@map`/`@@map`, endpoints are kebab-case plural, TS files are kebab-case.role.ts, classes are PascalCase.
- "Environment: configuration is only from environment variables. DATABASE_URL for Postgres."
- "Do exactly what the task asks. Don't create files that aren't asked for, and don't improve code you weren't asked to change."

Hmm, this is tricky. The repo is NestJS + Prisma + Postgres convention, but this task is a pure in-memory LLM pipeline — no DB involvement at all. The conventions say "always hold" but the task itself is self-contained: build `answer(question, sources, mode)`, redaction, evaluation harness, tests.

Should I include Prisma/Postgres? The task doesn't require persistence. "Do exactly what the task asks. Don't create files that aren't asked for." The deliverables are: `answer(question, sources, mode)` with a grounding gate, redaction-based hint mode, evaluation harness with golden scenarios and both judges, tests for the acceptance cases.

The conventions say "Migrations: every schema change ships with a migration." — no schema changes here, so no migration needed. "DATABASE_URL for Postgres" — only relevant if using DB. Since the task doesn't require persistence, I think the cleanest, most defensible reading is: build the feature in NestJS-style module structure (guide-assistant feature), use Vitest tests, and skip Prisma/Postgres entirely since there's no persistence requirement. But wait — the conventions say the stack includes Prisma + Postgres. Hmm.

But then again "Do exactly what the task asks. Don't create files that aren't asked for." Creating a prisma schema for a task that needs no persistence is speculative. But the convention block says "these always hold." However the task statement "holds everything else." The conventions are about how to write code in this codebase: if you use a DB, use Prisma; if you make a module, follow the layout. Since the task doesn't require persistence, there's no repository, no schema, no migrations.

Hmm, but should the answer service be a NestJS module with a controller? The L2 spec says "deliverables: `answer(question, sources, mode)` with grounding gate · redaction-based hint mode · evaluation harness with golden scenarios and both judges · tests." A controller isn't strictly needed. But the repo is a NestJS API. The task says "build the answer pipeline + evaluation harness for the game guide assistant."

I think the most defensible approach: build a `guide` feature (or `guide-assistant`?) with:
- `src/guide/llm.client.ts` — interface + scripted fake
- `src/guide/grounding.ts` (gate)
- `src/guide/redaction.ts` (hint redaction)
- `src/guide/guide.service.ts` — `answer(question, sources, mode)`
- `src/guide/guide.controller.ts` — REST endpoint (kebab-case plural)
- `src/guide/guide.module.ts`
- `src/eval/eval.harness.ts` or `src/evaluation/...` — golden scenarios, judges, scoring
- `test/guide.spec.ts`, `test/eval.spec.ts`
- `src/app.module.ts`, `src/main.ts`

Wait — but is there an existing codebase? The prompt says "if files were given above the task, that's the existing codebase, and it's real." The only files given are the variant-a.md and L2-spec.md references, which are "read-only reference" and explicitly "not part of what should be produced." So there's no existing code — we're creating from scratch. So we need to deliver a complete solution: package.json? Hmm. "Deliver every file the solution needs, complete, first line to last line."

If there's no existing codebase, the solution needs: `package.json` (with type: module, deps: @nestjs/common, @nestjs/core, reflect-metadata, vitest, typescript, rxjs?), `tsconfig.json`, and probably `vitest.config.ts`. The tests use Vitest. The conventions say Vitest, pnpm, ESM.

Hmm, but "don't create files that aren't asked for" — package.json and tsconfig are definitely needed to run tests. I'll include minimal `package.json`, `tsconfig.json`, and probably `vitest.config.ts`. Actually can Vitest work without config? For ESM TS tests, it works out of the box with esbuild transform. `vitest.config.ts` is optional. Minimal but functional: package.json + tsconfig.json + source files + tests.

Now, how deep to go with NestJS? If I include @nestjs/common in package.json and write `@Injectable()` decorators, tests need `reflect-metadata` and probably `@nestjs/core` testing module. NestJS tests can get heavy. Alternative: write the service as a plain class (with Nest decorators) and unit test by direct instantiation — simpler and more robust. The convention says services hold logic, controllers call services. I can write:

- `GuideService` with `@Injectable()`, takes `LlmClient` in the constructor (Nest DI by token). Provide `LlmClient` as an abstract class/interface token.
- `ScriptedLlmClient implements LlmClient` for testing and demo.
- Controller `GuideController` with POST endpoint, e.g. `/guide/answers`? Endpoints are kebab-case plural. `POST /guide/answers` fits. Or `POST /assistant/answer`... "Endpoint: kebab-case, plural." So `POST /guide/answers`.

Body: `{ question: string, sources: string[], mode: 'full' | 'hint' }`. Response: `{ answer: string, mode: 'full'|'hint', refused: boolean, droppedSentences: number }`? Keep it simple: `{ answer: string, mode, grounded: boolean }`. On refusal, answer = "not covered by my sources".

Error envelope for validation failures: `@BadRequestException` with the envelope shape. Controllers validate input. Use Nest's exception filter? The convention says one error envelope. I can add a simple `AllExceptionsFilter` in `main.ts`, or just throw `BadRequestException({ error: { code: ..., message: ..., details: {} } })`. Hmm, Nest by default serializes `BadRequestException`'s payload as-is, so `this.logger`... Actually, if I throw `new BadRequestException({ error: {...} })`, the response body becomes exactly that object. That satisfies the envelope without an extra filter. For 404s etc. — probably not needed here. Keep it simple: validate in the controller, throw BadRequestException with the envelope. That's enough.

Now the core algorithm:

### Grounding gate (sentence-level)

Given the model's answer (string), split into sentences. For each sentence, decide whether it's grounded in the source.

How to check grounding without a real NLP engine? Options:

1. **Token overlap / n-gram coverage**: for each "claim token" (content word / number) in the sentence, require it appears in the source (case-insensitive, normalized). Numbers must match exactly: numbers in the sentence must be present as numbers in the source (unless mentioned in the question? No — grounding is against source; question numbers are... hmm. The player's question might contain numbers, e.g. "I have 3 shards." For grounding, the answer's numbers should be supported by the source. But the hint redaction cares about numbers the player didn't mention).

Actually, let me define: a sentence is grounded if every *checkable claim* is supported. Claim = each content token (word of length > 2, non-stopword, non-punctuation) and each number. Support = the token appears (normalized, possibly stem-matched) in the source text, or in the question? No — grounding is about source. But the "I" pronoun etc. is a stopword, ignored.

Edge case: "5 shards" when the source says "4 shards" — "shards" appears, "5" doesn't → sentence not grounded → dropped.

"Fabricated item requirements" e.g. "You must collect the Obsidian Chalice" — "obsidian" and "chalice" not in source → not grounded → dropped.

Confident lie: the whole paragraph is fabricated → every sentence not grounded → nothing remains → refuse: "not covered by my sources".

Correct grounded answer: sentences made of source vocabulary and matching numbers → all survive → high score.

This is a lexical-verification approach — deterministic, testable, defensible for a fake-LLM pipeline. A real system would use a verifier LLM or embedding similarity; I'll note in a comment that the gate is a lexical entailment proxy. Hmm, but should the gate itself be LLM-based (judge-style)? The spec says "check each sentence of the model's answer against the source text" — a lexical gate suffices and is testable deterministically. I'll implement `isGrounded(sentence, sources)`.

Normalization: lowercase, strip punctuation, tokenize. Numbers: extract `\d+` tokens and require exact digit match in source. Word tokens: require substring/word match in source; allow simple stemming (strip trailing 's', 'es', 'ing', 'ed')? Careful: "shards" vs "shard". Source says "4 shards", answer says "collect 4 shards" — both have "shards" so no issue. Answer says "shard" and source says "shards" — stemming helps. Keep a light stemmer: try exact, then strip common suffixes, and also try source-side variants. Even simpler: normalize both sides to a set of "word forms" (word + word minus suffixes) and check membership.

Numbers: extract numbers from sentence; for each, require the same number to be present in source (as a standalone digit). What if the answer repeats the number from the question? E.g. player: "I found 2 shards, how many more?" Answer: "You need 4 shards in total" — source has "4". Fine. If answer says "you already have 2" — "2" is from question, not source. Strictly, the claim "you have 2" is grounded in the player's statement, not source. Should the gate accept question numbers? The gate's job: "check each sentence against the source text." Strictly source. But then a truthful echo of the question's numbers would fail. Hmm. To be safe and precise, treat numbers that appear in the question as *known to the player* and allowed (not a checkable source claim), while numbers not in the question must appear exactly in source. That's defensible: the gate prevents the model from introducing new facts (numbers) not in source; echoing the player's own numbers is not fabrication. Note it in a comment. Actually — the planted failure case "5 shards" when source says 4: question probably wouldn't mention 5. So both strict-source and question-allowing catch it. Allow question numbers and document the rule. Hmm, wait: is that overengineering? It changes the behavior of `answer(question, sources, mode)` to accept question. Fine — the signature already takes question.

Also for words: should question words be allowed? E.g. answer: "To beat the boss you mentioned" — "boss" might be in the question. A sentence like "You're asking about the Molten Keep" where the question says "Molten Keep" but source doesn't. Is that "ungrounded"? The claim is just restating the question. Hmm, strict reading: a sentence whose claims aren't supported by source → drop. But "the question is..." type sentences... Simplest and most robust rule: allow question vocabulary too? That weakens the gate: a lie could smuggle in fabricated words by first planting them in the question. But the question is player-authored, not model-authored. The fabrication risk is model output. If a model says "you need the Obsidian Chalice" and the player's question happened to mention "Obsidian Chalice"... the player knows, so telling them is not fabrication of game truth — it's a conversationally valid echo. I think allowing question tokens is defensible and matches "grounded in source *plus* what the player already said" — consistent with hint mode's "numbers beyond what the player already mentioned." Hmm, but hint mode's spec only exempts numbers, and for the gate says "against the source text."

Let me decide: **Words are grounded if in source OR in the question** (the player's own words are not model claims); **Numbers are grounded if exact-match in source OR in the question**. This is clean, documented, and all acceptance tests still pass:
- Confident lie (fabricated items/requirements not in source or question) → low score. ✓
- "5 shards" with source=4, question not containing 5 → not grounded. ✓

Wait, careful with stopword filtering: short/generic words ("the", "a", "to", "you", "your", "can", "is", "have", "need", "must", "then", "just", "will", "this", "that", "and", "or", "for", "with", "not", "it", "its") — don't require source. Also interrogatives? The answer is declarative. Words like "shard", "forge", "boss" are content. Threshold: word length ≥ 3 after normalization, non-stopword, non-number, non-pure-punctuation. Should I also ignore words that appear in the question? — Already handled.

Hmm, another risk: correct grounded answers use source vocabulary but might paraphrase with synonyms ("shards" → "fragments") → lexically ungrounded → dropped → wrongly refuses. In our scripted fake, the fake returns answers crafted to be lexically grounded. In reality a paraphrasing problem exists; a real system would use an entailment judge. I'll add a comment noting the lexical gate is a deterministic proxy and a paraphrase is treated as ungrounded (fail closed). Fail-closed is what the spec wants: "refusal is a correct outcome."

Actually, hmm, let me reconsider: should I use an *LLM* judge for the sentence gate? "With an injectable LLM client (scripted fakes are OK) and sentence-level grounding gating" — the LLM client is for *generation*. The gate could be anything. Lexical is deterministic, testable, and the tests need exact behavior ("caught accurately"). An LLM-judged gate on a scripted fake would just return canned verdicts — the tests would only be testing the fake. Lexical gate is the right engineering choice here and matches "tests should use [the scripted fake]" — the fake plants lies; the *gate* catches them. Yes.

### Sentence splitting

Split on `.?!` boundaries with a bit of care about abbreviations — keep it simple: regex split on `/(?<=[.!?])\s+/`. Handle trailing periods. Empty sentences are skipped.

### Refusal

If all sentences dropped → return refusal. What's the refusal output? Spec: the service refuses with "not covered by my sources". So the answer string is exactly that. And the eval harness must score refusal on scenarios where source lacks the answer as *correct*. In the API response, maybe `{ answer: "not covered by my sources", refused: true }`. For `mode: 'hint'`, if the full answer refuses... redact the refusal? The refusal string itself contains no spoilers — "not covered by my sources" — redaction leaves it as-is. That's consistent: hint mode is derived from the grounded answer; if the answer is a refusal, hint = refusal. Fine.

Edge: partial drop. Some sentences drop, some remain → answer = joined grounded sentences. If mode=hint, redact the joined grounded answer.

### Redaction (hint mode)

Rules (must remove boss names, item locations, and numbers beyond what the player mentioned):

- **Boss names / proper-noun entities**: without a game ontology, how to detect boss names generically? Options: (a) a list of entity classes; (b) proper-noun heuristics (title-case sequences not present in the player's question?); (c) known entity vocabulary in the source tagged as boss/location.

The spec says: "whatever rule you choose — proper nouns, entity class, numbers not in the player's question — write a test that feeds a sentence containing a boss name, a location, and a number, and asserts all three disappear."

I'll implement a composite redactor:
1. **Named entity spans** (boss names, locations, item names): model as *multi-word proper-noun sequences* + *proper-noun game entities*. To be deterministic and testable, define redaction over:
   - Title-case word runs (e.g. "Molten Keep", "Pyreth the Ashen") — redact entire run.
   - Words appearing in source and flagged... we don't have flags. Hmm.
   - Single capitalized words that are entities: "Pyreth" alone is title-case → caught by the run rule. Lowercase entity words like "chalice" aren't caught — but a location/boss name is typically proper-noun in the wiki text. The redaction test asserts on a sentence containing a boss name (title-case), a location (title-case), and a number — the run rule catches both names, and number rule catches the number.

   Risk: title-case redaction kills "The" at sentence start, "I", "A" — handle: keep stopword-capitals ("I", "The", "A", "An" at sentence start...). Standard approach: redact sequences of ≥ 1 title-case words that contain at least one non-stopper title-case word; a lone "The" at sentence start is a stopper → keep. E.g. "The Molten Keep is guarded by Pyreth the Ashen." → "The" (sentence-initial stopper) kept; "Molten Keep" redacted; "Pyreth the Ashen" — "the" is lowercase mid-run... proper-noun runs with embedded lowercase function words ("Pyreth the Ashen") need to include embedded stop words between title-case words. Rule: scan for maximal runs of title-case words where each word is title-case or a short lowercase function word ("the", "of", "and", "de", "la", "le") and the run contains ≥ 1 non-sentence-initial title-case word (or any title-case word not a sentence-initial stopper). Redact the entire run including embedded function words.

   Also **item names**? "item locations, and numbers" — item locations are locations. Item names themselves: the spec says the hint must not reveal "boss names, item locations, or numbers." Item *names* aren't required to be redacted (only their locations). But a boss named with a title-case run is caught. Keep the scope: proper-noun runs + numbers + location markers?

2. **Locations**: proper-noun runs cover "Molten Keep". Also lowercase location words after a "location marker" ("in", "at", "near", "behind", "inside", "under", "on", "beyond", "past", "across from", "at the end of")? E.g. "drop the shard in the lower vault" — "lower vault" is lowercase. Hmm. Add a rule: redact a noun phrase following a location preposition? That could over-redact ("in the game", "at the end"). Risky. Alternative: keep a small configurable set of *location nouns* ("keep", "vault", "cavern", "dungeon", "ruins", "tower", "sanctum", "cathedral", "forge", "chasm", "grotto") — if such a word appears in the source (so it's a real place in the source), redact the noun phrase around it (e.g. "the lower vault" → "[location]"). This is an "entity class" approach, allowed by the spec. I'll do: **location noun list** — when a listed location noun appears (and appears in the source, so it's a real place in the source), redact the immediately-preceding modifier ("the", adjectives) up to the nearest clause boundary. More simply: redact the noun phrase = sequence of up to 3 preceding non-stopword words + the stopper + the location noun. Let me define: for a location noun at index i, the phrase is words[max(0,i-3) .. i] filtered — redact that span. "in the lower vault" → span "the lower vault" → "in [location]".

   Hmm, complexity is creeping. But the redaction has to "actually redact" — the tests must prove a boss name, a location, and a number disappear. My test sentence will use title-case names for boss/location, so the run rule suffices for the test. But a lowercase location in a real source would leak. For robustness I'll include the location-noun rule. I'll keep it bounded.

3. **Numbers**: redact all number tokens in the answer, *except* numbers that the player already mentioned (i.e. appear in the question). "4 shards" with a question not containing 4 → "N shards" or "[quantity] shards". Replace with a token like "[quantity]"? Or just drop the number? For hint usability, "collect the required number of shards" reads better than "N shards", but the simplest and most provable: replace with "a few"? No — "a few" is itself a quantity. Use a placeholder "[some]"? Hmm, the spec says "must not reveal ... numbers beyond what the player already mentioned." The cleanest: replace disallowed numbers with "some"? "some shards" is OK. But placeholder like `[number]` is more explicit and testable: assert the output has no `\d` other than the question's numbers, and that the original number string is absent. Replace with "a required number of"? Ugh. Decision: replace each disallowed number with the placeholder `[quantity]`. Test asserts: no digits from the original number appear, and the question-mentioned numbers are preserved. A placeholder makes the assertion trivial and explicit.

   Also spelled-out numbers? ("four", "five") — a redaction should catch "four" if the source says "four shards". Ugh, scope. The gate works on digit numbers; the planted quantity failure is digit "5" vs "4". Should I also map spelled-out numbers 1-20 in redaction? That adds a word list: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty". If in a spelled-out form and not in the question, redact the spelled-out number. I'll include — it's cheap, and the gate should also treat spelled-out numbers as numbers! Important: the gate must catch "five shards" when source says 4 — the spec example is digit, but for robustness: the gate's number extraction should include spelled-out numbers. I'll add spelled-out numbers to number extraction for both gate and redaction. Hmm, wait, careful: "one" as an article-ish word... "the one true path" — "one" is a spelled number but not a quantity claim. If the gate requires "one" ∈ source, that sentence might be wrongly dropped. Trade-off. For the gate: only treat spelled-out numbers as numbers if followed by a countable noun? Too clever. Compromise: the gate checks digits strictly; spelled-out numbers are checked loosely: require presence in source OR question (if "one" is a quantifier, it's likely in source anyway...). Hmm, actually simpler: gate checks only digits (exact), redaction redacts digits + spelled-out numbers (fail-safe: over-redact in hint mode is OK — the hint is supposed to hide; over-redaction is a small usability loss, not a safety issue). And for the gate, spelled-out numbers: require presence in source or question, else ungrounded. Risk: "the one" — if source doesn't have "one", drop sentence. Acceptable fail-closed behavior.

   Wait, let me reconsider gate + spelled-out numbers. The fake LLM in the tests is what I script; I control that the planted lie uses digit "5". The spelled-out number rule adds robustness at a small false-positive cost. I'll do: digits are strictly required in source/question; spelled-out numbers (two..twenty, plus "dozen"?) — hmm "dozen" isn't in the list; skip. Just two..twenty? "one" — include "one" with the same rule; "the one" would fail unless in source/question. I'll accept that.

Hmm, wait. Let me reconsider whether to require the spelled-out numbers in the gate at all. If the correct grounded answer says "the final boss" — "final" is fine, no numbers. OK.

### Redaction output format

- Title-case entity runs → `[name]`.
- Location phrases → `[location]`.
- Disallowed numbers → `[quantity]`.
- Collapse "  " (double space) after replacement.
- Preserve the rest of the sentence.

The test: feed "Pyreth the Ashen guards the Molten Keep behind the altar, and you need 9 ember shards to enter." with a question "How do I get past the front gate?" → after redaction: no "Pyreth", no "Ashen" (hmm "the Ashen" — "the" is embedded lowercase function word in the run "Pyreth the Ashen" → entire run redacted → "[name]"), no "Molten Keep" → "[name]"; "altar"? "altar" is a location noun? Put "altar" in the location-noun list → "behind the altar" → "behind [location]". "9" → "[quantity]". Assertions: output does not contain /Pyreth|Ashen|Molten|Keep|altar|9/i and contains "[name]" and "[quantity]".

But wait — how does the redactor know "altar" is a location? The location-noun list includes it. OK.

Ordering of redaction passes: entities (runs) → locations (nouns + preceding modifiers) → numbers. Careful: number redaction after location redaction to avoid interference (a location could contain a digit? "Keep 4"? Unlikely). Fine.

Edge: question-mentioned number preservation: extract numbers from question (digit + spelled-out, normalized) into a set; in redaction, skip any number token whose value ∈ question's numbers. Compare numeric values (e.g. "4" vs "04" — normalize to integer). Spelled-out: map word → value.

Edge: player says "I have 2 shards" and answer has "2 shards" → keep "2". Good — matches "beyond what the player already mentioned."

### API shape

`GuideService.answer(input: { question: string; sources: string[]; mode: 'full' | 'hint' }): Promise<GuideAnswer>`:
```ts
interface GuideAnswer {
  answer: string;        // grounded answer or the refusal string
  refused: boolean;
  droppedSentences: number;
  totalSentences: number;
  mode: 'full' | 'hint';
}
```
The refusal string constant: `NOT_COVERED = 'not covered by my sources'`.

Controller: `POST /guide/answers`. Body validation: question is non-empty string; sources is a non-empty array of non-empty strings (spec says 2-3 provided, but shouldn't enforce exactly 2-3? "Input: player question + 2-3 fetched wiki page texts (provided as fixtures)." The API should accept 1+; the fixtures use 2-3. Hmm — "Do exactly what the task asks": 2-3 is a property of the input, not necessarily a constraint. But if we validate, do we require 2..3? Rejecting 1 source is weird. I'll require non-empty array of strings, each non-empty; enforce length 1..3? I'll enforce: must be an array of 1–3 non-empty strings. Hmm, 3+ → reject? In the pipeline the fixture says 2–3 fetched pages; more than that shouldn't be an error. I'll just require ≥ 1. Decision: require ≥ 1, non-empty strings. Mode must be 'full' | 'hint' (default 'full'). Invalid → 400 with envelope `{ error: { code: 'invalid_input', message, details: {field} } }`.

Nest validation: do it manually in the controller (no class-validator dependency — fewer deps; manual validation is fine and keeps the envelope consistent).

### LLM client

```ts
export interface LlmClient {
  complete(prompt: string): Promise<string>;
}
```
Hmm, injectable LLM client — the service calls it once with a prompt built from question + sources (+ mode instructions? No — hint mode must not re-prompt; the service calls the LLM once regardless of mode, and redacts if mode === 'hint').

Scripted fake:
```ts
export class ScriptedLlmClient implements LlmClient {
  constructor(private readonly script: Record<string, string> | ((prompt: string) => string)) {}
  async complete(prompt: string): Promise<string> {
    // pick a response by scenario key match or fallback
  }
}
```
Better design for tests: the fake is keyed by *scenario* — but the fake only sees the prompt. The prompt contains the question, so key on the question substring. Let me design: `new ScriptedLlmClient({ byQuestion: [{ match: 'shards', reply: '...' }, ...], fallback: '...' })`. Or a map question→reply with substring matching. Keep it: `ScriptedLlmClient(responses: Array<{ when: string; reply: string }>, fallback: string)` — `when` matches when it's a substring of the prompt. Also record calls (callLog) so tests can assert exactly one LLM call per answer, even for hint mode (a critical property: "no second LLM call").

Should the fake be in `src/` (part of the product) or in `test/`? "The LLM client is an interface and scriptable fakes — tests have no network, and the fakes must return a specific answer per scenario." The fake is a production artifact (an injectable fake client), and the eval harness uses it. I'll put `llm.client.ts` with interface + `ScriptedLlmClient` in `src/guide/`. In a real deployment, one would swap in an `HttpLlmClient` — I won't build network clients (task: no network; "scripted fakes are OK and should be what tests use"). Should I add a note? No — I won't create unasked files. Just the interface + fake.

Hmm, module wiring: `GuideModule` providers: `GuideService`, and `LlmClient` — how do I provide an interface? Use an abstract class as a token:
```ts
export abstract class LlmClient { complete(p: string): Promise<string> }
```
Abstract class as DI token (Nest supports abstract-class tokens via `useClass`). Default provider: `{ provide: LlmClient, useClass: ScriptedLlmClient }`? But ScriptedLlmClient needs a script (constructor arg) — a default useClass without a script will fail at runtime. Options: a `LlmClientConfig` from env? "Configuration only from environment variables" — no real LLM endpoint configured anyway. Simplest: the module accepts an optional override via `setExtraProviders`/forFeature style: the module defines the provider `{ provide: LlmClient, useFactory: ... }`? For the deliverable, the app needs to boot. I'll do: `GuideModule` provides `GuideService` and `{ provide: LlmClient, useClass: ScriptedLlmClient }`, and `ScriptedLlmClient` takes an *optional* script (constructor `script?: ScriptedResponses`); without a script it returns a safe refusal-ish reply? Hmm, an LLM that always refuses is a defensible default when no backend is configured: `return 'not covered by my sources'`? Wait — that conflates LLM output with the refusal constant. If the LLM returns that string, the gate: words "not covered by my sources" — are they in source? Probably not → all dropped → service refuses. Ha, consistent. But cleaner: default factory that reads from an env var `LLM_SCRIPT`? No, overkill.

Decision: `GuideModule` has `@Module({ providers: [GuideService, { provide: LlmClient, useClass: ScriptedLlmClient }] })`. `ScriptedLlmClient` constructor: `constructor(private readonly script: LlmScript = {})`. `LlmScript = { replies: Array<{ when: string; reply: string }>; fallback: string }`. Default fallback: `''` (empty answer → gate drops everything → service refuses). Boot-safe, no network. Tests inject their own scripted fake with `useValue`/`useClass` via `Test.createTestingModule` overrides.

Hmm, but do I even need `@nestjs/testing`? I can instantiate `GuideService` directly with a fake client — unit-test the behavior without booting Nest. That's simpler and more robust, and the conventions say "test behavior, not implementation." But a Nest app... should I add a smoke test for the controller? The task's acceptance cases are all about the pipeline + eval, not HTTP. I'll unit-test `GuideService` (direct construction) and the eval harness. Controller wiring is standard; a light controller test via `Test.createTestingModule` would need `@nestjs/testing` + `@nestjs/core` + `reflect-metadata` + rxjs. More deps, more failure modes, marginal value. But "wire: ... the controller is declared in the module." I'll write the controller+module properly; a minimal e2e-ish test with supertest? No supertest dependency. I can call controller methods directly in a test — meh. I'll skip HTTP-level tests; the acceptance criteria don't mention it. Direct service tests + eval harness tests cover all four required test groups.

Hmm, actually wait. Let me reconsider whether to include Nest at all in the first place. The convention block strongly suggests this repo is NestJS. The task: "build the answer pipeline + evaluation harness." A controller is the natural home for an `answer` endpoint in this codebase, and the conventions dictate the layout for features. I'll include:
- `src/main.ts` (bootstrap, global prefix? no—paths are already kebab-case)
- `src/app.module.ts` (imports GuideModule, EvalModule? — the eval harness is a library used by the harness; is it a module? A Nest module `eval` that exports `EvalHarness` service? The harness is a batch tool, not an API. But it could be exposed... The task says "an evaluation harness: golden scenarios ... judges; final score." Not necessarily an endpoint. Should I make `src/eval/` a plain library (no controller) with `eval.harness.ts`, `judges.ts`, `scenarios.ts`? Conventions require module/controller/service files only when there is a feature with those roles... The layout shows feature/module/controller/service/repository as the standard shape but not every file is mandatory. A library-style feature without a controller is defensible. But "wire" says services are listed in their module's providers — so I'll make `EvalModule` to keep the DI story clean, exporting the harness + judges. No controller. OK.

Actually, simpler: put the eval harness files in `src/eval/` without a Nest module — they're pure functions/classes. "Wire" convention: "a service, repository, or processor is listed in its module's providers." If I don't create a class with `@Injectable()` that's wired by Nest, the wiring rules don't bite. The judges are pure functions (deterministic) — no Nest involvement. The harness is a pure class (no decorators) taking a runner function. This is cleanest: eval = pure TS library; guide = Nest feature.

But app.module needs something to import — GuideModule. Fine.

Now, is `src/main.ts` + `app.module.ts` "files not asked for"? For a NestJS repo, they're the minimal shell to make the feature real. "Deliver every file the solution needs" — the solution needs to be runnable/testable. Include: `package.json`, `tsconfig.json`, `src/main.ts`, `src/app.module.ts`, guide feature (module, controller, service, llm.client, grounding, redaction), eval (harness, judges, scenarios), tests. `vitest.config.ts` too? Vitest can auto-discover `test/**/*.spec.ts` with default config (include: `**/*.{test,spec}.?(c|m)[jt]s?(x)`). ESM + TS works out of the box. Skip vitest.config to reduce surface? tsconfig is required for TS strictness and decorators? Vitest's esbuild handles decorators with the experimentalDecorators flag — esbuild only supports decorators if the tsconfig has `experimentalDecorators: true`. Yes, esbuild reads tsconfig for `experimentalDecorators` and `emitDecoratorMetadata`. emitDecoratorMetadata is not supported by esbuild (it ignores it), but I'm not using metadata-based DI in the tested path (I'll construct directly; Nest uses metadata at runtime for the app, but tests don't boot it). For the controller: `constructor(private readonly guide: GuideService)` — Nest needs design:paramtypes metadata; without emitDecoratorMetadata, Nest can't auto-resolve. Hmm! If someone actually boots the app, the controller needs metadata. Options: (a) add `tsconfig` with `emitDecoratorMetadata: true` (works with tsc, not esbuild — but the app is compiled/run via tsc or ts-node; tests via vitest/esbuild). (b) In the controller, avoid param-types reliance: Nest supports explicit injection with `@Inject()` only for tokens; for a class-typed param, metadata is needed... Actually, if there's exactly one constructor parameter and it's a class, does Nest resolve without metadata? No — Nest reads `design:paramtypes`; esbuild omits it → error "Nest cannot create the module instance" only when the app is booted. Since tests don't boot the app, the tests pass. But `pnpm start` would fail with esbuild-based runners. To be safe, I could compile the app with tsc (tsconfig with emitDecoratorMetadata) — standard Nest setup. Tests run via vitest; the service is tested by direct instantiation (no DI metadata needed). The controller has `@Injectable()`? Controllers typically don't have `@Injectable`. For the controller param metadata: with tsc + emitDecoratorMetadata, no problem.

Alternatively, avoid the controller entirely (no controller in the task's deliverables!). The deliverables list: answer with gate, redaction hint mode, eval harness, tests. The controller is a convention-driven extra. Risk: including a controller that requires DI metadata complicates tests? Not really — I just don't test it. But "don't create files that aren't asked for." A controller is not asked for... but this repo is a NestJS API, and the feature's entry point is the endpoint. Hmm, the variant says "build the answer pipeline + evaluation harness for the game guide assistant. Input: ... Output: ..." — product framing. I'll include a controller + module + app shell: defensible as "the solution" for this repo. Keep it lean.

Let me also reconsider: do I need `@nestjs/platform-express`? For a full app, yes for main.ts's `NestFactory.create(AppModule)`. package.json deps: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `reflect-metadata`, `rxjs` (Nest requires rxjs for some things), `class-transformer`/`class-validator` (skip — manual validation), devDeps: `typescript`, `vitest`, `@types/node`, `ts-node`? Keep minimal: typescript, vitest, @types/node. tsconfig: module NodeNext? Nest + ESM is tricky (`.js` extension imports required). Hmm! ESM `"type": "module"` + NestJS — NestJS's ESM support is finicky (need `--experimental-loader` etc). The conventions say ESM, type: module. For a vitest-only deliverable, the cleanest: tsconfig `module: "ESNext"`, `moduleResolution: "Bundler"`, no file-extension imports (Vitest/esbuild resolves without extensions). If someone tries `tsc && node dist`, Nest's ESM is... known pain. Since the task is pipeline + eval + tests, I'll set up tsconfig for bundler-style resolution, vitest runs tests, no compile-emit script. I won't provide a start script; the deliverable is evaluated by tests. I'll note? A short comment in main.ts? "Don't improve code you weren't asked to change" — no. Keep main.ts standard.

Hmm, actually — do I need `main.ts`? If tests don't boot the app, main.ts is decorative. But the convention layout lists it; in a NestJS repo, a solution missing main.ts looks broken. I'll include a standard minimal one.

### Eval harness

Types:
```ts
export interface GoldenScenario {
  id: string;
  description: string;
  question: string;
  sources: string[];
  expectedFacts: string[];   // facts the correct answer should contain
  falseFacts: string[];      // planted false facts that must NOT appear
  expectsRefusal: boolean;   // true if source doesn't contain the answer
  llmReply: string;          // scripted fake's answer for this scenario
}
```
The harness:
```ts
export interface EvalRun {
  scenario: GoldenScenario;
  answer: string;
  refused: boolean;
  helpful: number;  // 0..1
  faithful: number; // 0..1
  score: number;    // min
  failures: string[]; // human-readable reasons for score < 1
}
export class EvalHarness {
  constructor(private readonly client: LlmClient, private readonly service: GuideService) {}
  async run(scenarios: GoldenScenario[]): Promise<EvalRun[]>
}
```
Runner: for each scenario, a fake LLM returns `scenario.llmReply` (a scripted fake keyed on the question). The service produces an answer (with gate + redaction if needed). Then the judges score.

Judges:
- **FaithfulnessJudge**(answer, sources, question?) → number 0..1. Deterministic implementation: reuse the grounding logic! Faithfulness = fraction of the answer's sentences grounded in the sources (exactly the gate's per-sentence verdicts). Refusal: how to score? For a scenario where source doesn't contain the answer, the refusal is correct → should be faithful = 1 (refusing to make unsupported claims is maximally faithful). For a scenario where the answer IS in the source, a refusal is faithful (no false claims) but *not helpful* → caught by min. Nice separation: faithfulness = no unsupported claims (a refusal vacuously has none → 1.0); helpfulness = did we answer what was asked.

  But wait: a confident lie — the gate already strips ungrounded sentences, so the shipped answer is always faithful by construction... Then how does the "scripted confident-lie answer scores low" test work?! The eval must run the LLM's *raw* reply through the judges, not the gated answer! Re-reading: "A scripted confident-lie answer scores low" — the harness should score the model's answer (the raw generation) with the judges, demonstrating that a judge seeing the source gives the lie a low faithfulness. And the *pipeline* (gated) produces a safe output. Hmm, or does the harness score the pipeline output?

  Let me think. If the harness scores the gated output: a confident lie → gate drops everything → refusal → faithfulness 1.0 (vacuously), helpfulness: for a scenario where source HAS the answer (lie planted against a real answer scenario), refusal is unhelpful → min is low. For a scenario where source lacks the answer, the lie → refusal → correct → high. So the acceptance test "a scripted confident-lie answer scores low" needs a scenario where source contains the truth AND the model lies → gate refuses → helpfulness low → min low. This works! And "faithfulness judge sees the source" is satisfied (the judge takes a sources parameter) — but is the judge *actually* verifying content? If I define faithfulness = "no sentence in answer lacks grounding in source," and the answer is gated, it's trivially 1... The third failure described: "a judge scoring an answer without the source in front rates confidence and fluency" — the fix: judge receives the source. My faithfulness judge receives the source and computes per-sentence grounding coverage. To make it meaningful even on gated outputs, compute it on the *raw model reply*?

  Cleanest architecture: the harness scores **the model's raw reply** with the judges (that's what an eval measures — the model's quality on scenarios, and it proves that judges catch lies). The *service's* output (gated) is the production path. But the acceptance says "scripted confident-lie answer scores low; correct grounded answer scores high; refusal on missing source is scored as correct." These are all eval-harness outcomes on the raw reply:
  - Confident lie (source has the truth, model fabricates) → faithfulness low (sentences not in source) → min low. ✓
  - Correct grounded (source has the truth, model answers truthfully) → faithful high, helpful high (contains expected facts) → min high. ✓
  - Source lacks the answer, model refuses (or gate refuses) → helpfulness must be HIGH here (refusal is the correct output!). So helpfulness judge: if `expectsRefusal` AND answer is refusal (or non-committal), high; if answer contains fabricated facts, low.

  Hmm, but then what does the harness do with `answer(question, sources, mode)`? "Evaluation harness: golden scenarios ... helpfulness judge and faithfulness judge ... final score = min of both." The harness evaluates the *pipeline* — that's the product ("answer pipeline + eval harness"). The pipeline includes the gate. So the harness runs scenarios through the pipeline and scores the pipeline's output. But then the gate makes faithfulness trivial... unless the harness scores both: the raw model reply (model eval) and the pipeline output (system eval)?

  Re-reading the acceptance: "a scripted confident-lie answer scores low." Who generates the "confident-lie answer"? The scripted fake. And the harness scores it. If the harness scores the pipeline output, the "answer" being scored is the refusal (gate stripped the lie). Is a refusal from a confident-lie scenario "low score"? The spec: "a confident-but-useless refusal and a fluent lie should both score low, and averaging hides the latter." — a confident useless refusal (when source has the answer) scores low. Yes! So in a lie scenario where source has the truth: pipeline output = refusal → helpfulness low → score low. ✓ In a scenario where source lacks the answer: pipeline = refusal → helpfulness high (correct outcome) + faithfulness high → score high. ✓ And the *fluent lie* (raw reply) — the faithfulness judge seeing the source would rate it low. For that to be visible, the harness must also score the raw reply. Hmm, "a fluent lie should [score] low" — in a pipeline-scored harness, a fluent lie never ships...

  Resolution: the harness scores **the model's raw reply** (that's what the judges are for — model + prompt regression), AND the harness reports the pipeline output per scenario. Actually, let me structure: `EvalRun { scenario, rawReply, systemAnswer, refused, helpfulness, faithfulness, score }` where the judges run on **rawReply**. Then:
  - Lie scenario (source has truth): rawReply is lie → faithful low → min low. ✓ ("fluent lie scores low" directly — the judge sees the source and catches it.)
  - Grounded scenario: rawReply is truthful → faithful high; helpful: contains expectedFacts → high. ✓
  - Missing scenario: rawReply = "not covered by my sources" (the fake can refuse) → faithful: refusal → 1.0 (vacuous, or explicitly: a refusal contains no claims → fully faithful); helpful: expectsRefusal & refusal → 1.0. ✓ "scored as correct."
  - Quantity: rawReply says "5 shards" against source=4 → faithfulness low (the number is wrong). "Caught accurately" — the test asserts the faithfulness penalty specifically comes from the number mismatch, and the gate (pipeline side) drops that sentence. For "caught accurately" the test can also assert via `groundSentences` that the wrong-number sentence was flagged ungrounded.

  But hmm — is the faithfulness judge on the rawReply "the source in front"? Yes, signature `judgeFaithfulness(answer, sources)` — the acceptance: "the faithfulness judge's signature takes the source." ✓

  And the pipeline (gate) is tested separately: unit tests on `GuideService` prove the drop/refusal/redaction behavior including "5 shards" drop. The acceptance "5 shards against a source that says 4 → caught, accurately" — "caught" by both the gate (drops the sentence) and the faithfulness judge (scores it low). I'll write a test for both.

  Hmm, wait, one more consideration: should the harness also score the system's output? I can include a `systemScore` computed by the same judges on the gated answer. That's extra surface... The spec says "final score = min of both [judges]" — one final score per scenario. I'll keep: one score, judges on the raw reply, plus the run exposes the system's answer for inspection. Actually — hmm, let me reconsider once more. "Evaluation harness: golden scenarios (question, source, expected facts, planted false facts); helpfulness judge and faithfulness judge that receives the source; final score = min of both."

  "Planted false facts" — the scenarios carry `falseFacts` like "requires the Obsidian Chalice", "5 shards". The harness should assert/report whether the answer contains false facts. My judges: the faithfulness judge can be *specifically* structured as: (1) fraction of grounded sentences, (2) explicit check that no falseFact content appears → combine. A simpler deterministic design:

  **FaithfulnessJudge.judge(answer, sources)** → 0..1:
  - If answer is a refusal (exactly matches the refusal constant, or contains it?) → 1.0 (no claims made).
  - Else: groundedSentenceRatio = grounded / total; additionally: any number in the answer that isn't in the source → heavy penalty? The ratio already handles it (that sentence isn't grounded). "Caught accurately" — the test wants precision: e.g. a reply of 2 sentences, 1 with wrong number → faithfulness = 0.5, and the test asserts 0.5 exactly? "Caught accurately" might mean: the gate's per-sentence verdict pins down the exact sentence. I'll expose `sentenceVerdicts` from the grounding module: `assessAnswer(answer, sources, question) → { sentences: [{text, grounded, missing: string[]}] }`. Then tests can assert verdict[0].grounded === false with '5' in missing.

  **HelpfulnessJudge.judge(answer, scenario)** → 0..1:
  - If scenario.expectsRefusal: answer is refusal → 1.0; answer makes claims (non-refusal) → low (0.0 or penalty per falseFact found).
  - Else: base = fraction of expectedFacts present (semantic presence: check that key phrases/words appear — expectedFacts are written as canonical strings, and presence = all content words of the fact appear in the answer? Or the fact string itself appears? For determinism: a fact is "covered" if every content token of the fact (non-stopword, case-insensitive) appears in the answer. E.g. expectedFact "4 shards" → tokens {4, shards} ⊆ answer tokens. "collect four shards"? "4" vs "four" — I'll write expected facts to match the scripted reply's lexicon. Fine — the scenario data is mine.)
  - Minus penalty for falseFacts present (a falseFact covered = every content token appears): if a falseFact is present → helpfulness low. E.g. helpful = factCoverage * (1 - falseFactCoverage)? Let me define: helpful = 0 if any falseFact fully covered; else factCoverage? But a "confident useless refusal" (non-refusal scenario, model refuses) → factCoverage 0 → 0. ✓ "Both score low."
  
  A fluent lie with expected facts present (the lie includes the truth + fabrication) → factCoverage 1 but falseFact covered → 0. ✓ Good: "a fluent lie should [score] low" via min(faithful, helpful) anyway.

  Final score = min(helpful, faithful). Round to 3 decimals? Keep raw floats; test with toBeCloseTo or exact fraction (1/2 etc). I'll compute in fractions to make exact assertions possible.

Refusal detection: exact match with the constant, or... if the model's own refusal is "I don't know" — for rawReply scoring, the scenario's llmReply for missing scenarios is exactly the refusal constant (the fake refuses). I'll detect refusal as: trimmed answer === NOT_COVERED, or empty. In pipeline tests, the service returns `refused: boolean` — but the judges receive a plain string; define `isRefusal(text)`: empty OR equal (case-insensitive, punctuation-stripped) to "not covered by my sources". Good enough; document.

### Golden scenarios (fixtures)

Write 4-5 scenarios in `src/eval/scenarios.ts`:

1. **shards-correct** ("grounded-correct"):
   - Question: "How many ember shards do I need to light the Beacon Forge?"
   - Sources: page A: "The Beacon Forge can be lit by inserting 4 ember shards into the socket above the anvil. Ember shards are found in the Molten Keep." Page B: "Pyreth the Ashen guards the Molten Keep. The forge bellows only after four shards are placed."
   - expectedFacts: ["4 ember shards", "beacon forge", "ember shards are in the Molten Keep"]? Note — the expected fact "Molten Keep" — the FULL mode answer may include it; in hint mode it would be redacted! Hmm. The harness runs `mode` — which mode? The harness runs the pipeline in... The raw reply is what the fake returns (full answer). The judge scores the raw reply — which contains "Molten Keep" (truthful). Fine, expectedFacts can include it. The harness's *system* output (hint mode) would redact it — but the judges don't score the system output, so no contradiction. Hmm, wait — should the harness also score the system output? Let me finalize: **the harness scores the raw model reply.** The system output is reported per run for inspection (useful, cheap). Actually, you know what, let me include the system output in the run but only score the raw reply. I'll document: "the judges evaluate the model's raw generation; the pipeline's gated output is reported alongside."

   Wait a moment, but acceptance: "a correct grounded answer scores high" — the raw grounded reply scores high ✓. "Scripted confident lie scores low" ✓ raw lie. "Source doesn't contain the answer → refusal is scored as correct" — raw refusal (fake refuses) ✓. OK, consistent.

   Hmm, that said... is it weird that the "system" (gate) is never scored by the harness? The gate has its own unit tests (drop/refusal/quantity/redaction). The eval harness measures the model + judges. Together they cover the acceptance. I'm content. Actually — to tie the harness to the service (since the harness takes a service in the constructor?), I could have the harness also compute the system output via `service.answer(...)` and expose it, plus expose a convenience `systemScore` = min(judges(systemAnswer))? Extra complexity... The spec's final score is one number. I'll include a `systemAnswer` in the run (via the service) and a single score for the raw reply. Hmm, but then why does the harness need a service? It needs the service to produce the `systemAnswer`. OK — harness deps: `LlmClient` (scripted) + `GuideService` (built with the same client). Fine.

   Hmm wait, actually, let me simplify and reduce risk: the harness takes a `GuideService` and an `LlmClient`? The service already wraps the client. The harness needs the raw reply — but the service doesn't expose the raw reply. Options: have the service return `rawAnswer` in the result? Exposing the raw reply in the API response is bad (un-gated!). But an in-process `answer()` return could include it... The controller picks fields for the response. Hmm, exposing raw in the service return is a leak risk (someone returns the whole object). Alternative: the harness has its own scripted fake instance and calls `client.complete(buildPrompt(...))` to get the raw reply — but the prompt construction is inside the service. I can have the service export a `buildPrompt(question, sources)` helper. The harness: `raw = await client.complete(buildPrompt(q, sources))` then `system = await service.answer({q, sources, mode})`. Two completions? The service.answer calls the client again → the scripted fake returns the same reply (deterministic). OK! The fake is deterministic per scenario → both calls return `llmReply`. Clean: the harness = { service, client } → raw via client, system via service. The fake is deterministic so it's consistent.

   Even cleaner: the service's return type includes `refused`, `droppedSentences`; the harness uses the client for raw. Let me go with that.

2. **shards-quantity-lie** ("quantity-lie"): source says 4; the fake's reply: "You need 5 ember shards to light the Beacon Forge. Insert them into the socket above the anvil." → sentence 1 is ungrounded (5 ∉ sources∪question), sentence 2: "Insert them into the socket above the anvil" — tokens: insert, socket, anvil — source has "socket", "anvil", "inserting" (stem insert ⊆ inserting? My stemmer: source word "inserting" → strip "ing" → "insert" ✓). "them" stopword ✓. → grounded. So the system output keeps sentence 2 and drops sentence 1. The faithfulness judge on raw: 1/2 = 0.5 → min with helpful: expectedFacts ["4 ember shards"] coverage: raw has "5" and "shards" but not "4" → coverage 0 → helpful 0 → score 0. The test asserts: the gate drops exactly the "5" sentence (verdicts), and the eval score is low / faithfulness = 0.5 exactly. "Caught accurately" ✓.

3. **confident-lie** ("invented-item"): source is about the forge (no mention of the "Obsidian Chalice"); the fake's reply: "You must collect the Obsidian Chalice and pour it into the Beacon Forge. It requires 7 chalice fragments." → all sentences have words not in source (obsidian, chalice, pour, fragments) → gate drops all → system refuses. Eval: faithful = 0 (raw: 0/2 grounded), helpful = 0 (no expected facts, falseFact covered) → score 0. The test: confident lie scores low ✓.

4. **unanswered** ("missing-answer"): question "What does the lighthouse keeper collect in winter?" — sources (forge pages) have no answer; the fake's reply: the refusal constant. expectsRefusal: true. Eval: faithful 1.0, helpful 1.0 → score 1.0 "scored as correct" ✓. Also a variant: the fake confidently answers from thin air → helpful 0 (claims in a refusal scenario) → low. The acceptance only requires the former.

5. **hint-leak** scenario? The redaction is tested directly (unit test) — "feed a sentence containing a boss name, a location, and a number and assert all three disappear." A unit test on `redactForHint(sentence, question)` directly — cleaner than via the harness. I'll do that.

Scenario 1's llmReply (grounded truth): "You need 4 ember shards to light the Beacon Forge. The shards are found in the Molten Keep, and Pyreth the Ashen guards the entrance. Insert the shards into the socket above the anvil." Check each sentence against source (I'll craft source accordingly):
- "You need 4 ember shards to light the Beacon Forge." Tokens: need✓ (stopword), 4 ✓ (source "4"), ember ✓, shards ✓, light — source "can be lit" — "lit" vs "light": stem? My suffix strips: light → light; source has "lit" and "light"? I'll craft source to include the word "light": "You can light the Beacon Forge by inserting 4 ember shards into the socket above the anvil." Then all tokens match literally. beacon ✓ forge ✓.
- "The shards are found in the Molten Keep, and Pyreth the Ashen guards the entrance." — "found" — source "Ember shards are found in the Molten Keep" ✓; molten ✓ keep ✓ pyreth ✓ ashen ✓ guards ✓ entrance ✓.
- "Insert the shards into the socket above the anvil." insert ✓ (source "inserting" → stem insert) socket ✓ above ✓ anvil ✓.
expectedFacts: ["4 ember shards", "light the beacon forge", "shards are found in the molten keep"]. falseFacts: ["requires the obsidian chalice", "5 ember shards"]. The harness should also check that the correct answer doesn't contain falseFacts → it doesn't → helpfulness = factCoverage = 1.0, faithful 1.0, score 1.0 → "scores high" ✓ (assert > 0.8 or === 1).

Let me double-check the faithfulness judge on the correct reply: all 3 sentences grounded → 1.0 ✓.

Now let me lock down the grounding algorithm concretely.

```ts
// grounding.ts
const STOPWORDS = new Set(['a','an','the','and','or','but','if','then','else','of','to','in','on','at','by','for','with','without','from','into','onto','over','under','above','below','behind','before','after','near','through','during','while','is','are','was','were','be','been','being','am','do','does','did','have','has','had','will','would','can','could','should','shall','may','might','must','you','your','yours','i','we','they','he','she','it','its','our','us','them','him','her','this','that','these','those','here','there','where','when','how','what','which','who','whom','whose','not','no','so','as','just','also','only','too','very','all','any','each','every','more','most','some','such','than','too','up','out','off','down','again','further','once','because','until','against','between','among','about','again','again','themself','myself','itself','yourself','ourselves']));
```
Note: location markers like "in", "at", "behind" are stopwords for grounding (prepositions aren't claims) — but the location-redaction rule uses them as anchors. OK.

Tokenization: `text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ')` then split. Keep apostrophes? Strip: replace `'` with ''. Words: strip leading/trailing non-alphanum.

Spelled-out numbers map: {one:1,...,twenty:20}. Hmm "one": treat as a number? Decision: include, but in the GATE, a spelled-out number counts as a number token requiring presence in source ∪ question... Risk scenario: reply "The final trial awaits." — no numbers. OK, include one..twenty? Wait "twenty" — "twenty shards"? Fine.

Hmm, actually, let me reconsider including spelled-out numbers in the gate. Risk of false drop: reply "One of the shards glows." source has "shards" but no "one" → dropped → potentially wrong refusal. But our fake controls the reply. For robustness of the product, the false drop is fail-closed (safe). I'll include spelled-out 1..20 as numbers in both gate and redaction. And the gate allows question numbers — spelled-out numbers are compared by value: if the question has "three" and the answer has "3" → allowed.

Gate per sentence:
```ts
function assessSentence(sentence, sourcesNorm, questionNorm): { grounded: boolean; missing: string[] }
tokens = contentTokens(sentence)  // non-stopword, len>=2? (>=3?)
missing = tokens.filter(t => !supported(t, sourcesNorm, questionNorm))
grounded = missing.length === 0
```
Wait — what about a sentence of only stopwords ("You can.")? tokens = [] → grounded = true. Fine.

Threshold issue: should a sentence with 1 token missing among 10 be dropped? Strict: any missing → ungrounded. Spec: "sentences whose claims are not supported by the source are dropped" — strict is the faithful reading, and fail-closed. Strict. But a tiny paraphrase ("fragments" vs "shards") drops the whole sentence — accepted (documented).

Hmm, another one: proper nouns in the reply like "Pyreth" — require presence in source ✓ (it's in source). Fabricated "Chalice" — missing → drop ✓.

Number support: a number token (digit string or spelled-out) → allowed if its value ∈ sourceNumbers ∪ questionNumbers. sourceNumbers: all `\d+` in source + spelled-out values. Note: "socket above the anvil" — no numbers. Page B "four shards" → 4. Question "How many ember shards..." — no numbers. Reply "4" ✓.

Word support with stemming: normalize word → forms: [w, w minus suffixes]. Suffixes: 'ies'→'y'? (chilies/chili — rare), 'es', 's', 'ing', 'ed', 'er', 'est'? Risk: "shards"→"shard" and source "shard" ✓. "anvil" no suffix. "forging"→"forging","forg"?? "forg" is bad but only used for membership — source "forge" → forms {"forge"}; "forging" → {"forging","forg"} ∩ = ∅ → miss → drop. Hmm "forging" vs "forge" — add suffix stripping 'e' too? "forge" → {"forge","forg"}; "forging"→{"forging","forg"} ∩ ✓. So include 'e' stripping on both sides? "the" is stopword anyway. "shards"→"shard"+"shar"? Only strip one suffix: order: ies→y, else es, else s, else ing, else ed, else e? Take only the first applicable? "shards": ends in 's' (not 'es'? "shards" ends in "ds" not "es") → strip 's' → "shard". "boxes" ends in "es" → "box". "lighting"? 'ing' → "light". "anvils" → "anvil". Forms = {w, stripped}. Compare stripped(source) ∪ exact(source). Let me define: `keyset(text) = set of all words + all stripped(words)`. Token supported if `forms(token) ∩ keyset(sources)` non-empty, or `forms(token) ∩ keyset(question)` non-empty.

"4" as a word vs a number — handle numbers before words (tokens matching ^\d+$ → numeric check; spelled-out in map → numeric check; else word check).

Wait, careful: token "5" — digit → numeric: 5 ∈ sourceNumbers? Source has 4 (and 7? no) → false → missing "5" → sentence ungrounded ✓.

Apostrophes/contractions: "don't" → "don t"? Replace ' with '' → "dont" — stopword? Add "dont", "cannot"? Well, the fake won't use contractions. Fine.

Sentence splitting: `text.split(/(?<=[.!?])\s+/)` then trim, drop empties. Lookbehind supported in Node 20 ✓.

### Refusal constant
`export const REFUSAL = 'not covered by my sources';`

`GuideService.answer`:
```ts
async answer(input): Promise<GuideResult> {
  const raw = await this.llm.complete(buildPrompt(input.question, input.sources));
  const assessment = assessAnswer(raw, input.sources, input.question);
  const kept = assessment.sentences.filter(s => s.grounded).map(s => s.text);
  let answer: string;
  let refused = false;
  if (kept.length === 0) { answer = REFUSAL; refused = true; }
  else answer = kept.join(' ');
  if (input.mode === 'hint') answer = redactForHint(answer, input.question);
  return { answer, refused, mode: input.mode, droppedSentences: assessment.sentences.length - kept.length, totalSentences: assessment.sentences.length };
}
```
Note: if refused and mode is hint → redact(REFUSAL, q) — "not covered by my sources": tokens are lowercase, no title-case runs, no numbers, no location nouns → unchanged ✓.

buildPrompt:
```ts
export function buildPrompt(question, sources) {
  return `Player question: ${question}\n\nWiki pages:\n${sources.map((s,i)=>`--- Page ${i+1} ---\n${s}`).join('\n')}\n\nAnswer using only the wiki pages above...`;
}
```
Fine.

### Redaction details

```ts
export function redactForHint(answer: string, question: string): string
```
Steps:
1. questionNumbers = extractNumbers(question) → Set<number>.
2. **Proper-noun run redaction**: iterate word tokens (with indices) on the answer text. Word = /[A-Z][a-z'']*/ pattern. A run: start at a title-case word; extend while the next word is title-case or a lowercase function word in EMBEDDED = {the, of, and, de, la, le, du, van, von, at, for}? "Pyreth the Ashen" → include "the". Run qualifies if it contains a title-case word that is not a sentence-initial stopper... "The" at sentence start: is "The" in STOPWORD_CAPS = {The, A, An, I, To, In, On, At, It, Its, And, Or, But, If, You, Your, We, They, He, She, Is, Are, Was, Were, Can, Could, Would, Should, May, Might, Will, Must, Not, No, So, As, For, From, With, After, Before, Above, Below, Behind, Under, Over, Near, Then, When, Where, How, What, Which, Who, This, That, These, Those, Here, There, Just, Only, Also, Too, Very, All, Any, Each, Every, More, Most, Some, Such, Than, Up, Out, Off, Down, Once, Until, Against, Between, Among, About, Do, Does, Did, Have, Has, Had, Been, Being, Was? ...}. Hmm, "The Beacon Forge": "The" sentence-initial stopper → not a run start; "Beacon Forge" is a run ✓ → "[name]" with "The" retained: "The [name] can be lit..." Good.

   A single title-case word mid-sentence that's a stopper, e.g. "And Pyreth guards..." — "And" stopper, "Pyreth" run ✓.

   Edge: "Molten Keep behind the altar" — run "Molten Keep" stops at lowercase "behind" ✓.

   Implementation: tokenize with regex on the string, preserving the original. Use `Array.from(text.matchAll(/\S+/g))`? I need to know if it's title-case: /^([A-Z][a-z]*)$/ or /^([A-Z][a-z]*'[a-z]*)$/ (O'Brien). A word is stopper if lower ∈ STOPWORD_CAPS_SET (the big list). Run construction: i over words; if word[i] is title-case AND not (i==0 and stopper) → start run j=i; extend j: while word[j+1] is (title-case non-stopper) OR (lowercase AND lower ∈ EMBEDDED) → j++. Actually also allow sentence-initial title-case stopper start? "The" is a stopper → never a run start; but "The Molten" — "Molten" is non-stopper title-case mid-run start → run "Molten Keep" ✓. A run must contain ≥ 1 non-stopper title-case word (guaranteed by the start rule). Replace span (from word[i].start to word[j].end) with "[name]".

   Wait — single word too: "Pyreth" alone → run length 1 → "[name]" ✓.

   Edge: "A" as a title-case non-stopper? "A" ∈ stoppers ✓.

   False positive: title-case words that are legitimate non-entity: "I" (stopper), "Yes", "No", "Ok", "First", "Second"? "First" — if the source wiki uses "First gate"... "First" would get redacted → "[name] gate". Over-redaction, acceptable for a hint (safe side). OK.

3. **Location-noun redaction**: LOCATION_NOUNS = ['keep','vault','cavern','cathedral','dungeon','ruins','tower','sanctum','forge','chasm','grotto','hollow','hall','chapel','crypt','labyrinth','temple','shrine','altar','sanctuary','citadel','bunker','cellar','attic','gate','door'??] — "gate"/"door" are too generic (the player's question mentions "front gate"; the answer "past the gate" → redact "the gate" → "past [location]"? The player knows their own gate... but the rule is to hide locations not mentioned? Spec: "item locations" must not be revealed. If the player asks about the gate, is the answer "past the gate" a reveal? The location is what they're at — arguably OK, but keeping it simple: my list excludes "gate"/"door"/"room" (too generic). Include: keep, vault, cavern, cathedral, dungeon, ruins, tower, sanctum, forge, chasm, grotto, hollow, chapel, crypt, labyrinth, temple, shrine, altar, citadel, bunker, cellar, attic, courtyard, bridge, gate? — exclude gate. "forge" — note: "Beacon Forge" is a title-case run → already redacted as [name] by step 2 before step 3 (step 3 runs after on the modified text — "forge" is gone). Lowercase "forge" in "the forge bellows" → step 3: "the forge" → "[location]". OK.

   Phrase span: from the location noun, extend left up to 2 preceding non-stopword words (including stoppers in between): "the lower vault" → vault, then left: "lower" (non-stopword, take), "the" (stopper — but between the taken modifier and the noun... span = contiguous from leftmost taken to the noun). Algorithm: j = index of noun; left = j; k = j-1; taken=0; while k>=0 && taken<2 && word[k] is non-stopword (and not a location noun? whatever) && !isNumber: left=k; taken++; k--; BUT stoppers between the taken word and the noun get included in the span (contiguous). E.g. "in the lower vault": vault@i; k=i-1 "lower" non-stopword → left=i-1, taken=1; k=i-2 "the" stopword → stop (stopper not taken but is it between left and noun? left=i-1, noun=i — contiguous, "the" at i-2 excluded ✓). Span "lower vault" → "in [location]". "in the Molten Keep" — wait, "Molten Keep" is already "[name]" from step 2 → "keep" word is gone ✓ no double.

   Case: match the noun case-insensitively, but only lowercase/any? If title-case, it's inside a run already. Match words whose lowercase ∈ LOCATION_NOUNS and which are not already inside a placeholder (placeholders contain letters... "[name]" has no word tokens that match location nouns ✓).

   Should the location redaction require the noun to appear in the source? (So "forge" as a common noun isn't redacted when the source is about something else?) If the source has no "vault" and the answer says "vault" — the answer would be ungrounded at the gate anyway (vault missing → sentence dropped) — so by the time redaction sees it, the noun is in the source. No check needed.

4. **Number redaction**: replace digit runs: for each `\d+` match, if value ∉ questionNumbers → replace with "[quantity]". Spelled-out: for each word in SPOKEN, if its value ∉ questionNumbers AND the word is not... → replace with "[quantity]". Note: "one" as "one of the shards" → "[quantity] of the shards" — ugly but safe. Hmm — should "one" be redacted? "one" often isn't a secret quantity. But fail-safe: redact. Test uses 9. OK.

   Order: run redaction first, then locations, then numbers (numbers inside "[name]"? placeholders have no digits). Then collapse: `replace(/\s{2,}/g,' ')`, also fix " [name]" spacing (the replacement is in-place span so spacing is preserved: "the [name] guards" — original "Pyreth the Ashen" is replaced with "[name]" → "guards [name] behind" ✓ no double spaces since span replacement).

   Edge: "9 ember shards" → "[quantity] ember shards" ✓.

Redaction test (unit):
```ts
const out = redactForHint('Pyreth the Ashen guards the Molten Keep behind the altar, and you need 9 ember shards to enter.', 'How do I get past the front gate?');
expect(out).not.toMatch(/Pyreth|Ashen|Molten|Keep|altar|9/i);
expect(out).toContain('[name]').toContain('[quantity]').toContain('[location]');
```
Wait "behind the altar": "altar" is in LOCATION_NOUNS; span: left of "altar": "the" stopword → stop; span "altar" → "behind [location]" ✓. "Molten Keep" run → "[name]"; "Pyreth the Ashen" run → "[name]". Result: "[name] guards the [name] behind [location], and you need [quantity] ember shards to enter." — "guards" remains, fine. Assert "ember" remains? Not necessary.

Hmm wait, "the [name]" — "The" sentence-initial? The test sentence starts with "Pyreth" (non-stopper) → run starts at index 0 ✓ "[name] guards the [name]...".

Also test preservation of player-mentioned numbers: question "I have 2 shards. How many more?" answer "You have 2 shards and need 2 more." → redact: 2 ∈ questionNumbers → keep "2", "2". Assert output contains "2" and not "more"? Fine: assert /\b2\b/ present.

### Tests

`test/guide.spec.ts`:
1. **Gate: drops ungrounded sentences, keeps grounded ones.** Service + fake returning 2-sentence reply (one with a fabricated item) → result.answer contains the grounded sentence, doesn't contain the fabricated word; droppedSentences=1.
2. **Refusal when nothing survives.** Fake returns a fully fabricated reply → answer === REFUSAL, refused true.
3. **Quantity caught accurately.** Source "4 ember shards"; reply "You need 5 ember shards. The forge accepts them in the socket." → droppedSentences 1, answer has no "5"; and use `assessAnswer` to assert the "5" sentence's verdict has missing containing '5'. "Accurately" → assert kept sentence is the correct one, dropped is exactly the 5 sentence.
4. **Hint mode = redaction, single LLM call.** A fake with a call counter; call answer with mode 'hint'; assert call count 1; output redacted (no boss name, no location, no unmentioned numbers); assert output is a substring-ish transformation of the full answer? Key: derived from the grounded answer — call answer with full and hint with two fresh fakes (same script), and assert hint === redactForHint(fullAnswer)? Hmm, hint = redact(kept sentences), full = kept sentences → hint === redactForHint(full.answer, question) ✓ deterministic — assert that equality.
5. **Redaction unit test** (boss/location/number removal) + preservation of question numbers.
6. **The refusal string passes through redaction unchanged** (hint mode on a refusal) — nice-to-have, include.

`test/eval.spec.ts`:
1. **Confident lie scores low.** Run the harness on the scenarios (or just the lie scenario) → score < 0.5 (actually 0) and faithful < 0.5.
2. **Correct grounded scores high** → score ≥ 0.8 (=== 1).
3. **Refusal on missing source is scored as correct** → score ≥ 0.8 (=== 1).
4. **Quantity lie caught by the harness** → faithfulness judge on "5" reply vs source "4" → faithful === 0.5 exactly (1 of 2 grounded) and final score 0 (helpful 0 because expected fact "4 ember shards" is absent). "Caught accurately": assert faithful is 0.5, not 0 or 1, and that the gate's verdict pins down the specific sentence.
5. **The faithfulness judge's signature takes the source** — structurally true; a test that the same answer with a source that supports it scores high vs a source that doesn't scores low. E.g. judgeFaithfulness('You need 4 ember shards.', ['...4 ember shards...']) === 1 vs judgeFaithfulness('You need 4 ember shards.', ['unrelated page']) < 1. ✓ Proves the judge uses the source (fixes the "scoring style" failure).

Also test min-combination: "a fluent lie should score low even if it's fluent": a reply that contains the expected facts + a fabricated fact → helpful low (falseFact covered) and faithful low → score low. That's the lie scenario (my lie contains some real tokens too?). Let me make scenario 3's lie fluent: "You need 4 ember shards, plus the Obsidian Chalice, to light the Beacon Forge." — sentence 1: tokens 4✓ shards✓ obsidian✗ → ungrounded → faithful 0/1=0; helpful: expectedFact "4 ember shards" covered (4 and shards in answer) = 1 coverage, but falseFact "requires the obsidian chalice" covered (obsidian+chalice) → helpful 0 → min 0. And it's "fluent" (reads fine).

HelpfulnessJudge details:
```ts
judge(answer, scenario): number {
  if (isRefusal(answer)) {
    return scenario.expectsRefusal ? 1 : 0;  // confident useless refusal → 0 ✓; correct refusal → 1 ✓
  }
  const factCoverage = coveredFraction(answer, scenario.expectedFacts); // each fact: fraction? all-or-nothing per fact, then mean
  const falseCoverage = coveredFraction(answer, scenario.falseFacts);
  if (falseCoverage > 0) return 0;   // any planted falsehood appearing → zero helpfulness
  if (scenario.expectsRefusal) return 0; // claims when the answer isn't in the source → not helpful (and also not faithful — but the gate...)
  return factCoverage;
}
```
Hmm, a hard 0 for any false fact — "caught" and the min is 0 → low ✓. But what if a scenario has no falseFacts? coveredFraction with empty list = 1? Let me define: coveredFraction(answer, facts) = facts.length ? facts.filter(covered).length / facts.length : 1. falseCoverage>0 → 0. OK.

covered(answer, fact): every content token of the fact ∈ answer's keyset (with stemming + numeric-by-value). E.g. fact "4 ember shards": tokens: 4 (number → value 4 ∈ answerNumbers ✓), ember ✓, shards ✓.

FaithfulnessJudge:
```ts
judge(answer, sources): number {
  if (isRefusal(answer)) return 1;
  const a = assessAnswer(answer, sources, /* question */ '');
  return a.sentences.length === 0 ? 1 : grounded/total;
}
```
Wait — the question parameter: the gate allows question tokens; a faithfulness judge on a raw reply without the question → stricter (question words count as unsupported). Hmm: the raw reply echoes "as you asked" — "asked" isn't in source → ungrounded → false penalty! My scripted replies avoid question-echoing words. Pass the question to the faithfulness judge? The acceptance says "the faithfulness judge's signature takes the source" — question can be an optional third param, default ''. The harness passes the scenario's question (consistent with the pipeline). I'll keep signature `judgeFaithfulness(answer, sources, question = '')`. Good — the required contract (taking source) is met, and I document the question-echo allowance.

isRefusal(text): `const t = text.trim().toLowerCase().replace(/[.!?\s]+$/,''); return t === '' || t === 'not covered by my sources';`

Scenario data — let me write the sources (2 pages each, "2-3 fetched wiki pages"):

**S1 "beacon-forge" (correct grounded):**
- Q: "How do I light the Beacon Forge, and where are the shards?"
- p1: "The Beacon Forge can be lit by inserting 4 ember shards into the socket above the anvil. The forge bellows only after the shards are placed."
- p2: "Ember shards are found in the Molten Keep. Pyreth the Ashen guards the entrance to the Molten Keep."
- llmReply: "You need 4 ember shards to light the Beacon Forge. The shards are found in the Molten Keep, and Pyreth the Ashen guards its entrance. Insert the shards into the socket above the anvil."
  Verify sentence 2: "its" stopword ✓, "entrance" ✓ (p2), "guards" ✓. Sentence 3: insert (p1 "inserting"→insert ✓), socket ✓, above ✓, anvil ✓. ✓ all grounded.
  expectedFacts: ["4 ember shards", "light the beacon forge", "shards are found in the molten keep", "pyreth the ashen guards the entrance"]? Careful: "guards its entrance" — the fact "pyreth the ashen guards the entrance" tokens: pyreth✓ ashen✓ guards✓ entrance✓ → covered (its ≠ entrance; the fact's tokens: pyreth, ashen, guards, entrance — all in answer ✓; "the" is a stopword). ✓
  falseFacts: ["requires the obsidian chalice", "5 ember shards", "shards are found in the frozen spire"] → none present ✓.
  expectsRefusal: false.

**S2 "quantity-lie":**
- Same Q as S1? Different Q: "How many ember shards does the Beacon Forge need?"
- p1: same p1 ("...inserting 4 ember shards..."), p2: "The forge socket accepts exactly 4 shards. Fewer than 4 leaves the forge dark."
- llmReply: "You need 5 ember shards to light the Beacon Forge. Insert them into the socket above the anvil."
  Sentence 1: 5 ∉ {4} → ungrounded. Sentence 2: insert✓ socket✓ above✓ anvil✓ "them" stopword ✓ → grounded.
  expectedFacts: ["4 ember shards"]; falseFacts: ["5 ember shards"].
  Eval: faithful = 1/2 = 0.5 exactly; helpful: fact "4 ember shards" covered? Answer has "5" and "shards" — "4" ∉ answer → uncovered → coverage 0 → helpful 0 → score 0.
  Gate test: sentence 1 dropped with missing ["5"].

**S3 "invented-item-lie" (confident lie):**
- Q: "What do I need to light the Beacon Forge?"
- p1, p2: same forge pages (no mention of a chalice).
- llmReply: "You must gather the Obsidian Chalice and pour it into the Beacon Forge. The chalice needs 7 fragments of cold iron."
  Sentence 1: must stopword? "must" — should "must" be a stopword? It's a modal — yes, add "must" to STOPWORDS. gather✗ (not in source) obsidian✗ chalice✗ pour✗ → ungrounded. Sentence 2: chalice✗ fragments✗ cold✗ iron✗ → ungrounded. faithful 0. helpful: expectedFacts ["4 ember shards"] → uncovered → 0; falseFact ["requires the obsidian chalice"] covered? fact tokens: obsidian✓ chalice✓ in answer → covered → 0 anyway. score 0 ✓ "confident lie scores low".
  Gate: both dropped → system refuses.

**S4 "answer-not-in-sources" (missing):**
- Q: "What does the lighthouse keeper collect in winter?"
- p1/p2: the forge pages again (irrelevant).
- llmReply: REFUSAL ("not covered by my sources"). expectsRefusal: true.
  Eval: isRefusal → faithful 1; helpful: refusal & expectsRefusal → 1; score 1 ✓ "scored as correct".
- expectedFacts: []; falseFacts: ["the keeper collects 12 lanterns"] (a planted false fact that the refusal avoids).

**S5 "hint-leak-risk" for the pipeline hint test?** The redaction test covers it; do I need a scenario? Not required. Skip — 4 scenarios suffice (the spec says scenarios carry those fields; 4 golden scenarios including the refusal case ✓).

Wait — for S4, the fake must return REFUSAL for that question. Scripted fake: matches when `when` (substring) is in the prompt. The prompt contains the question → when: "lighthouse keeper" → reply REFUSAL. S2 when "how many ember" ... let me use unique substrings:
- S1 when: "where are the shards"
- S2 when: "how many ember shards"
- S3 when: "what do i need to light"
- S4 when: "lighthouse keeper"

S1 and S3 questions: S1 "How do I light the Beacon Forge, and where are the shards?" contains "where are the shards" ✓; S3 "What do I need to light the Beacon Forge?" — does it contain S1's when? "where are the shards" no ✓. S2 "How many ember shards does the Beacon Forge need?" contains "how many ember shards" ✓, does it also contain S3's when? no. S1's question also... "how many"? no. OK, unique.

ScriptedLlmClient matching: iterate entries in order, first `when` that is a substring of the prompt (case-insensitive) wins; else fallback. Default fallback: '' → gate → refusal. Also record `calls: string[]` for call-count assertions.

### Now, harness implementation

```ts
export class EvalHarness {
  constructor(private readonly service: GuideService, private readonly client: LlmClient) {}
  async run(scenarios: GoldenScenario[]): Promise<EvalReport> {
    const runs = [];
    for (const s of scenarios) {
      const prompt = buildPrompt(s.question, s.sources);
      const raw = await this.client.complete(prompt);
      const system = await this.service.answer({ question: s.question, sources: s.sources, mode: 'full' });
      const faithful = judgeFaithfulness(raw, s.sources, s.question);
      const helpful = judgeHelpfulness(raw, s);
      runs.push({ id: s.id, scenario, rawReply: raw, systemAnswer: system.answer, systemRefused: system.refused, helpful: round3(helpful), faithful: round3(faithful), score: round3(Math.min(helpful, faithful)) });
    }
    return { runs, overall: round3(mean of scores) };
  }
}
```
Hmm — the harness calls the client twice per scenario (once raw, once inside the service) — the fake is deterministic ✓. Alternatively, the harness only needs the service and the fake exposes the last reply... I'll keep the double-call; it's explicit.

Wait, the mode for system.answer — 'full' (the harness evaluates full; hint is a redaction and is tested separately). OK.

Rounding: keep exact values (0, 0.5, 1) — round to 3 decimals for cleanliness; 0.5 stays 0.5.

### File list (final)

- `package.json`
- `tsconfig.json`
- `src/main.ts`
- `src/app.module.ts`
- `src/guide/llm.client.ts` (LlmClient abstract + ScriptedLlmClient + buildPrompt + LlmScript type)
- `src/guide/grounding.ts` (tokenization, numbers, assessSentence, assessAnswer, REFUSAL? — REFUSAL goes in guide.service? Put REFUSAL in grounding? It's a service-level constant — I'll put it in `guide.service.ts`. Hmm, eval's isRefusal needs it too → import from guide.service. Eval imports from the guide feature — cross-feature import without a module export... Eval is a plain library (no Nest module), so it imports directly. Fine.)
- `src/guide/redaction.ts` (redactForHint + rules)
- `src/guide/guide.service.ts` (GuideService, GuideAnswerInput, GuideResult, REFUSAL)
- `src/guide/guide.controller.ts`
- `src/guide/guide.module.ts`
- `src/eval/types.ts` (GoldenScenario, EvalRun, EvalReport) — or fold into harness.ts. Reduce files: `src/eval/eval-harness.ts` (harness + types + run), `src/eval/judges.ts` (judgeFaithfulness, judgeHelpfulness, isRefusal, coveredFraction), `src/eval/golden-scenarios.ts` (scenarios + scripted fake construction? The fake is a guide thing; the scenarios just carry llmReply; the test builds the ScriptedLlmClient from scenarios).
- `test/guide.spec.ts`
- `test/eval.spec.ts`

14 files. Do I need `prisma/schema.prisma`? No persistence → no. The conventions list a layout but "every schema change ships with a migration" — no schema → none. DATABASE_URL is unused — fine, no secrets.

Hmm, wait — should I double-check that I'm not missing a requirement: "the eval harness: golden scenarios (question, source, expected facts, planted false facts such as a fabricated item requirement); a helpfulness judge and a faithfulness judge that receives the source; final score = min of both." ✓ all present.

"The hint mode must not reveal boss names, item locations, or numbers beyond what the player already mentioned" ✓ redaction rules: names (proper-noun runs), locations (runs + location nouns), numbers (digit + spelled-out, except question's).

"Item locations" — also item names with locations... "item locations" = the locations of items → location redaction covers it.

### package.json

```json
{
  "name": "guide-assistant",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "reflect-metadata": "^0.2.1",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```
Hmm — rxjs: Nest 10 requires rxjs as peer. Include. @types/express for platform-express? main.ts uses NestFactory — does it need express types? `NestFactory.create(AppModule).listen()` — the app type is inferred; @types/express may not be strictly needed. Skip @types/express to reduce risk? main.ts: `const app = await NestFactory.create(AppModule); await app.listen(3000);` — no explicit express type → skip. Actually `app.listen(3000)` fine. Skip.

Do tests import from @nestjs? My guide.service uses `@Injectable()` from '@nestjs/common' → vitest needs to resolve it → installed ✓ (it's a dep). reflect-metadata — @Injectable decorator works without importing reflect-metadata? The @Injectable decorator calls Reflect.defineMetadata — in Node 20, global Reflect.metadata? Actually Node 20 doesn't have Reflect.decorate etc. natively; `Reflect.defineMetadata` is provided by the reflect-metadata polyfill. Nest's `@Injectable()` implementation: `Reflect.defineMetadata('imports', [], target)`? Let me recall: @nestjs/common's Injectable:
```ts
export function Injectable(options?) {
  return (target) => {
    Reflect.defineMetadata(INJECTOR_TYPE_METADATA, 'customProvider', target); ...
  }
}
```
Hmm, in recent Nest (v9+), decorators use `Reflect.defineMetadata` which requires the reflect-metadata polyfill to be loaded, otherwise "Reflect.defineMetadata is not a function". So I must import 'reflect-metadata' — in main.ts (standard) AND in the tests (before the service import) — I'll add `import 'reflect-metadata';` at the top of the spec files. Alternatively, avoid decorators in the service entirely (plain class) — but the convention/Nest style expects @Injectable. I'll keep the decorator + the reflect-metadata import in main.ts and in the specs. Safe.

Vitest + decorators: esbuild with tsconfig experimentalDecorators: true → supported (esbuild implements TC39/legacy decorators when experimentalDecorators is on). @Injectable as a legacy-decorated class method/class — fine. emitDecoratorMetadata — esbuild ignores (doesn't emit); the tests don't rely on it ✓.

tsconfig:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```
moduleResolution Bundler → imports without extensions resolve in tsc; vitest resolves fine. noEmit → build script is just type-check: rename "build" to "typecheck": "tsc -p tsconfig.json". Since ESM+dist execution isn't a deliverable. Good.

### Controller

```ts
@Controller('guide')
export class GuideController {
  constructor(private readonly guide: GuideService) {}

  @Post('answers')
  async createAnswer(@Body() body: unknown): Promise<GuideResult> {
    const err = validateAnswerBody(body); // returns {code, message, details} | null
    if (err) throw new BadRequestException({ error: err });
    return this.guide.answer({ question, sources, mode });
  }
}
```
Validation: question is a string and trimmed non-empty; sources is an array of 1..3 non-empty strings? Decision: require non-empty array; each element a non-empty string. Cap at 3? "2-3 fetched wiki page texts" — I'll enforce max 3 (the pipeline is designed for 2-3; more pages dilute). Hmm — is rejecting 4 sources "exactly what the task asks"? The task says the input is 2-3 pages. Enforcing 1..3 is defensible; but should I reject 1? "2–3 fetched" → enforce min 1? The product fetches 2-3 pages; the API accepting 1 isn't harmful. Let me enforce: array length 1..3, non-empty strings. Details include the field. Codes: 'invalid_input'.

Also mode: optional, default 'full', must be 'full'|'hint' → else invalid_input with details {field:'mode'}.

Response shape: GuideResult { answer, refused, mode, totalSentences, droppedSentences }.

Envelope: for a 400, `{ error: { code, message, details } }` — throw `new BadRequestException({ error: {...} })` → Nest sets the body to that object ✓.

`@Body() body: unknown` then validate — controller validates input ✓ (zero business logic ✓).

Hmm — Nest validation for the controller: do it manually in the controller (no class-validator dep — fewer deps; manual validation is fine and keeps the envelope consistent).

### Module wiring

```ts
@Module({
  controllers: [GuideController],
  providers: [GuideService, { provide: LlmClient, useClass: ScriptedLlmClient }],
  exports: [GuideService],
})
export class GuideModule {}
```
ScriptedLlmClient's default constructor (no script) — DI instantiates without args ✓ (constructor param optional). Default reply: '' → everything refuses → a safe boot default.

`app.module.ts`: imports [GuideModule].

`main.ts`: standard bootstrap, port from env? "Configuration only from environment variables" — `const port = Number(process.env.PORT ?? 3000)`; fine (no hardcoded secret; a port default is OK? "no hardcoded connection strings" — a port default is fine).

### Grounding module code — let me write it carefully.

```ts
// src/guide/grounding.ts

const STOPWORDS = new Set<string>([
  'a','an','the','and','or','but','if','then','else','of','to','in','on','at','by','for','with','without','from','into','onto','over','under','above','below','behind','before','after','near','through','during','while','is','am','are','was','were','be','been','being','do','does','did','have','has','had','will','would','can','could','should','shall','may','might','must','you','your','yours','i','we','they','he','she','it','its','our','ours','us','them','him','her','his','this','that','these','those','here','there','where','when','how','what','which','who','whom','whose','not','no','so','as','just','also','only','too','very','all','any','each','every','more','most','some','such','than','up','out','off','down','again','further','once','because','until','against','between','among','about','let','lets'
]);

const SPOKEN_NUMBERS: Record<string, number> = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19, twenty:20 };

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ');
}

export function tokenize(text: string): string[] {
  return normalizeText(text).split(' ').filter(Boolean);
}

export function numberValues(text: string): number[] {
  const values = new Set<number>();
  for (const t of tokenize(text)) {
    if (/^\d+$/.test(t)) values.add(parseInt(t, 10));
    else if (t in SPOKEN_NUMBERS) values.add(SPOKEN_NUMBERS[t]);
  }
  return [...values];
}
```

Stemming:
```ts
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0,-3) + 'y';
  if (word.length > 3 && word.endsWith('es')) return word.slice(0,-2);
  if (word.length > 3 && word.endsWith('ing')) return word.slice(0,-3);
  if (word.length > 3 && word.endsWith('ed')) return word.slice(0,-2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0,-1);
  if (word.length > 4 && word.endsWith('e')) return word.slice(0,-1);
  return word;
}
function wordForms(w: string): Set<string> { return new Set([w, stem(w)]); }
```
Check "shards": len 6, ends 's' (not 'es'... 'shards' ends in 'ds' — endsWith('es')? "shards" last two chars 'ds' → no; endsWith('s') ✓ → "shard" ✓. "boxes" ends 'es' → "box" ✓. "forge" ends 'e' len 5 → "forg" ✓; "forging" ends 'ing' len 7 → "forg" ✓ match. "anvil" no match → "anvil". "anvils" → 's' → "anvil" ✓. "socket" → nothing... ends 't'. ok. "guard" vs "guards" ✓. "lit" len 3 → no stem (length guard) → "lit". "light" → no suffix ('t') → "light". "lit" vs "light" mismatch! My S1 source p1: "The Beacon Forge can be lit by inserting..." and the reply "You need 4 ember shards to light the Beacon Forge." — "light" ∉ source forms → sentence 1 ungrounded → dropped → S1's system output loses the key sentence, and the *eval* raw scoring: faithful = 2/3 → score min(helpful=1, faithful=0.667) = 0.667 < 0.8 → my "scores high" test fails!

Fix options: (a) craft source to contain "light": p1: "You can light the Beacon Forge by inserting 4 ember shards into the socket above the anvil." ✓ then "light" present. I control the fixture — do that. (b) add 'light'→'lit' morphological equivalence — overkill. I'll craft the source with "light".

Let me rewrite S1 p1: "The Beacon Forge lights when 4 ember shards are inserted into the socket above the anvil." — "lights" vs "light": stem("lights") = "light" ✓ reply "light" ✓.

But wait, the reply "You need 4 ember shards to light the Beacon Forge." — "need" stopword ✓, "4" ✓, ember✓ shards✓ light→forms{light}; source "lights"→{lights,light} ✓, beacon✓ forge✓. ✓ grounded.

Sentence 2 reply: "The shards are found in the Molten Keep, and Pyreth the Ashen guards its entrance." source p2: "Ember shards are found in the Molten Keep. Pyreth the Ashen guards the entrance to the Molten Keep." ✓ all present.

Sentence 3: "Insert the shards into the socket above the anvil." p1 has "inserted" → stem "insert" ✓ (len 8, ends 'ed' → "insert" ✓), socket✓ above✓ anvil✓. ✓.

S2 source p1 (reuse S1's p1), p2: "The forge socket accepts exactly 4 shards. Fewer than 4 leaves the forge dark." numbers {4}. Reply: "You need 5 ember shards to light the Beacon Forge. Insert them into the socket above the anvil." s1: 5 ∉ {4}∪question{} → missing [5] ✓. s2: "insert"✓ them(stopword)✓ socket✓ above✓ anvil✓ → grounded ✓.

S3: p1 = "The Beacon Forge lights when 4 ember shards are inserted into the socket above the anvil." p2 = "Ember shards are found in the Molten Keep. Pyreth the Ashen guards the entrance to the Molten Keep." Reply: "You must gather the Obsidian Chalice and pour it into the Beacon Forge. The chalice needs 7 fragments of cold iron to work."
s1 tokens (non-stopword): gather✗, obsidian✗, chalice✗, pour✗, beacon✓, forge✓ → missing non-empty → ungrounded ✓ (strict: any missing → drop).
s2: chalice✗ → drop ✓. "needs" → "need" stem... "need" is stopword? I put 'need' in STOPWORDS? "need" is a verb — a claim word? "needs" — add to stopwords (modal-ish auxiliary). "work" — source? no → missing anyway ✓. 7 ∉ source {4} ✓ missing.
faithful = 0/2 = 0 ✓.

Hmm wait — S3's helpful: expectedFacts ["4 ember shards"] → answer has "shards" ✓ "4"? no "4" in reply → uncovered → coverage 0 → helpful 0 ✓. falseFact ["requires the obsidian chalice"] tokens: obsidian✓ chalice✓ → covered → helpful 0 ✓. score 0 ✓.

S4: p1/p2 = forge pages; Q "What does the lighthouse keeper collect in winter?"; reply REFUSAL. expectsRefusal true. faithful 1 (refusal), helpful 1 → score 1 ✓.

Wait — does the harness run the service for S4? service.answer → raw = REFUSAL → assess: sentences = ["not covered by my sources"] → tokens: not(stop) covered✗? "covered" — in source? no → missing → ungrounded → dropped → kept 0 → refused, answer REFUSAL ✓ consistent.

Now — assessAnswer returns per-sentence missing list: missing tokens + numbers like "5". For "accurate" test: `verdicts[0].missing` contains '5'. Let me have missing entries be the original token strings ("5", "obsidian"). Numbers: push the token ("5"). ✓

Edge: sentence "The chalice needs 7 fragments of cold iron to work." — 'the' stop, 'chalice' missing, 'needs'→stem 'need'... 'need' in stopwords? If "need" is stopword, forms irrelevant. '7' number missing, 'fragments'→'fragment' missing, 'cold' missing, 'iron' missing, 'work' missing. Fine.

Now `assessAnswer(answer, sources, question)`:
```ts
export interface SentenceVerdict { text: string; grounded: boolean; missing: string[]; }
export interface AnswerAssessment { sentences: SentenceVerdict[]; groundedCount: number; }

export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 0);
}

export function assessSentence(sentence: string, sourceKeyset: Set<string>, sourceNumbers: Set<number>, questionNumbers: Set<number>, questionKeyset: Set<string>): SentenceVerdict {
  const missing: string[] = [];
  for (const token of tokenize(sentence)) {
    if (STOPWORDS.has(token)) continue;
    if (/^\d+$/.test(token)) {
      const v = parseInt(token, 10);
      if (!sourceNumbers.has(v) && !questionNumbers.has(v)) missing.push(token);
    } else if (token in SPOKEN_NUMBERS) {
      const v = SPOKEN_NUMBERS[token];
      if (!sourceNumbers.has(v) && !questionNumbers.has(v)) missing.push(token);
    } else {
      const forms = wordForms(token);
      if (![...forms].some(f => sourceKeyset.has(f) || questionKeyset.has(f))) missing.push(token);
    }
  }
  return { text: sentence, grounded: missing.length === 0, missing };
}
```
Wait — should the question keyset allow *words*? I decided earlier yes. Double-check the lie scenario isn't accidentally rescued by the question: S3 Q "What do I need to light the Beacon Forge?" question words: light, beacon, forge — the lie's missing tokens (obsidian, chalice...) are not in the question ✓.

But hmm — one concern: question-word allowance weakens "grounded in source only" (variant A: "output: an answer grounded only in those pages"). A sentence "You asked about the Beacon Forge" is grounded in the question, not the page... but it makes no new game claims. The variant's "grounded only in those pages" is about factual content. Restating the question is not fabrication. I'll allow it, document: "a claim that only restates the player's own words is not a fabrication; the gate checks *new* content against the source." Hmm... actually, wait. Let me reconsider — simpler and truer to the spec: source only, no question allowance for words. Numbers: allow question numbers? Variant A's hint mode cares about player-mentioned numbers; the gate spec (L2) says "check each sentence of the model's answer against the source text" and "numbers and quantities need to be checked accurately."

Risk of strict source-only: a truthful reply that echoes question nouns gets dropped. My scripted replies don't echo question-only words (I'll verify each). S1 Q: "How do I light the Beacon Forge, and where are the shards?" reply words ⊆ source ✓. S2 Q: "How many ember shards does the Beacon Forge need?" reply "You need 5 ember shards to light the Beacon Forge." — source has ember, shards, light(lights), beacon, forge ✓; "5" ∉ source ✓ dropped. "Insert them into the socket above the anvil." ✓ source. Fine — strict source-only for words works with my fixtures.

Decision: **Strict: words must be in the source. Numbers must be in the source, or in the player's question** (a number the player stated is known ground truth for the conversation; e.g. "I have 2 shards" → "you have 2" is safe). This is the most defensible mix: the gate prevents *new* ungrounded claims; a player-stated number is not a new claim. I'll document it. Hmm, but "grounded only in those pages" — the number "2" isn't in the page... The alternative (strict) drops the truthful "you already have 2" → hurts helpfulness. I'll keep the question-number allowance with a comment. Numbers from the question only (not words).

Hmm, wait — actually let me simplify the code surface: drop questionKeyset entirely; keep questionNumbers. Cleaner.

### Redaction code

```ts
const ENTITY_RUN_STOPWORDS = new Set(['the','a','an','of','and','or','de','la','le','du','van','von','at','for','to']);
```
Wait — embedded function words in a run: "Pyreth the Ashen" needs 'the'. But extending a run through 'the' is risky: "Beacon Forge the Second"? Fine. But "Forge the..."? Well, safe side (redact more).

But careful: after "Molten Keep" there's a lowercase 'behind' — not in the set → run stops ✓. "Molten Keep, and Pyreth" — 'and' is in the set!! "Molten Keep, and Pyreth the Ashen" → run would extend: Keep → next word "and" (lowercase in set) → extend → next "Pyreth" title-case → extend → "the" → "Ashen" → run = "Molten Keep, and Pyreth the Ashen" → single [name]. Over-redaction: "The shards are found in the [name] guards its entrance." Hmm — "and Pyreth the Ashen" gets swallowed → loses information, safe side but ugly. Exclude 'and','or' from embedded? "Pyreth the Ashen" only needs 'the'. Set: {the, of, de, la, le, du, van, von} — no 'and'/'or'. Then "Molten Keep, and Pyreth..." → run1 "Molten Keep" stops at "and" ✓; run2 "Pyreth the Ashen" ✓.

Title-case detection: /^([A-Z][a-z]*|[A-Z][a-z]*'[a-z]*)$/ — "Pyreth" ✓ "O'Brien" ✓. Acronyms "NPC"? not matched (N, P, C caps) — a missed entity; acceptable.

Sentence-initial stopper caps: I need a set of capitalized stopwords that don't start a run: {'The','A','An','I','To','In','On','At','By','For','With','From','Into','Over','Under','Above','Below','Behind','Before','After','Near','Through','During','While','Is','Are','Was','Were','Be','Been','Being','Am','Do','Does','Did','Have','Has','Had','Will','Would','Can','Could','Should','Shall','May','Might','Must','You','Your','Yours','We','They','He','She','It','Its','Our','Us','Them','This','That','These','Those','Here','There','Where','When','How','What','Which','Who','Not','No','So','As','Just','Also','Only','Too','Very','All','Any','Each','Every','More','Most','Some','Such','Than','Up','Out','Off','Down','Once','Because','Until','Against','Between','Among','About','And','Or','But','If','Then','Else','Let'}. Simpler: capitalize STOPWORDS + a few. Build: STOPPER_CAPS = new Set([...STOPWORDS, 'let','lets'].map(w => w[0].toUpperCase()+w.slice(1)))? 'the'→'The' ✓. But careful: 'i'→'I' ✓ good.

Run algorithm:
```ts
function redactEntityRuns(text: string): string {
  const words = Array.from(text.matchAll(/[\p{L}][\p{L}'-]*/gu, ...)) // hmm
}
```
Simpler: tokenize with indices: `const re = /\S+/gu; const words = [...text.matchAll(re)]` → each {index, 0}. isTitle(w) = /^[A-Z][a-z'’-]*$/.test(w). isStarterStopper = i===0 && STOPPER_CAPS.has(w) (or w is the first word of a sentence — after ". "? A mid-sentence "The" after a period: "[name]. The Molten Keep..." — the "The" after the period is sentence-initial. Detect: the immediately preceding non-space char is '.', '!', '?' or the start of the string. I'll implement a `sentenceStart(i)` check: scan backward for the last non-space char; if none or in '.!?', it's sentence-start.

Run:
```ts
let out = ''; let last = 0;
for (let i = 0; i < words.length; i++) {
  const w = words[i][0];
  if (!isTitle(w)) continue;
  if (isSentenceStart(words[i].index) && STOPPER_CAPS.has(w)) continue;
  // start a run at i
  let j = i;
  while (j + 1 < words.length) {
    const nw = words[j+1][0];
    if (isTitle(nw) && !(STOPPER_CAPS.has(nw) && !isSentenceStart?? )) ...
```
Hmm, embedded title-case stoppers mid-run: "The Ashen One" — 'One'? not in stopwords. Let me keep it simple: extension condition: next word is (title-case && not (sentence-start && stopper)) OR (lowercase && EMBEDDED.has(lower)). A title-case stopper mid-run ("The" in "Pyreth The Ashen"?) — rare; treat title-case stopper as a run-terminator unless... let me just extend on any title-case word (a title "The" mid-run is probably part of a name), and only skip start at sentence-initial stopper. Simpler and safe-side.

Then replace span [words[i].index, words[j].index + words[j][0].length) with '[name]'; continue loop from j+1 (set i = j). Build the output via slicing.

Wait, careful with non-alphabetic tokens: "\S+" includes "9," "socket." etc. isTitle is false → skipped ✓. Punctuation attached: "Keep," → isTitle("Keep,")? My regex ^[A-Z][a-z'’-]*$ — "Keep," has a comma → false!! Bug: "Pyreth the Ashen guards the Molten Keep, and you..." — "Keep," doesn't match → run is only "Molten" → "[name] Keep," → the "Keep" leaks! Fix: strip trailing/leading punctuation from the word for the classification but use the original span for replacement (replace only the letter part, or the whole token including punctuation? Replace "Keep," with "[name]" and lose the comma → "the [name] and you" — loses punctuation, acceptable? "[name], and you" would be better. Classification: `const core = w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g,'')` hmm but I need to keep the title-case rule. Let me define: a word is title-case if `^[A-Z][a-z'’-]*[,.!?;:]?$` — allow one trailing punctuation. And the replacement span = the full token; replace with '[name]' + trailing punctuation. Extract: `const m = w.match(/^([A-Z][a-z'’-]*)([,.!?;:]?)$/)` → group1 core, group2 punct. Run extension looks at the core. Replacement text = '[name]' + (punct ?? '').

"Pyreth" no punct ✓. "Molten" ✓ "Keep," → core Keep punct ',' → run "Molten Keep" → "[name]," ✓.

isSentenceStart: need the char before words[i].index — precompute? Scan backward in the string: `const before = text.slice(0, words[i].index).trimEnd(); const c = before.slice(-1); return c === '' || '.!?\u2026'.includes(c);`

Location pass:
```ts
const LOCATION_NOUNS = new Set(['keep','vault','cavern','cathedral','dungeon','ruins','tower','sanctum','forge','chasm','grotto','hollow','chapel','crypt','labyrinth','temple','shrine','altar','citadel','bunker','cellar','attic','courtyard','bridge','passage','gate'?? 'door'?]);
```
Exclude 'gate','door','room','bridge'? "bridge" can be an item... Keep the list moderate: keep, vault, cavern, cathedral, dungeon, ruins, tower, sanctum, forge, chasm, grotto, hollow, chapel, crypt, labyrinth, temple, shrine, altar, citadel, bunker, cellar, attic, courtyard, passage.

Pass implementation (on text after the run pass): tokenize with \S+ again (the placeholder "[name]" is a token — its core isn't a location noun ✓). For each token whose lowercased core ∈ LOCATION_NOUNS: find left boundary: from i-1 going down, include words while (count of non-stopword words included < 2): k = i-1; left = i; taken = 0; while (k >= 0 && taken < 2) { const coreK = lower(words[k][0]); if (STOPWORDS.has(coreK)) break; left = k; taken++; k--; } — wait, stopper in between: "in the lower vault": k at "lower": not stopword → left=k,taken=1,k--; now k at "the": stopword → break. Span "lower vault" ✓. "in a dark vault": k "dark" → left, taken 1; k "a" stopper → break → "dark vault" ✓. "in the vault": k "the" stopper → break → span "vault" ✓. "beyond the frozen vault": "frozen" taken, "the" stops → "frozen vault" ✓.
Replace span with '[location]'. Note: overlapping spans — process right-to-left, or collect spans and replace in reverse. Collect spans, sort by index desc, replace.

But careful: "Molten Keep" is already "[name]" → no 'keep' token remains ✓. Lowercase "the forge" in "the forge bellows" → span "forge" (k "the" stopper) → "the [location] bellows" hmm "the" remains: "the [location]" — fine.

Number pass:
```ts
function redactQuantities(text: string, allowed: Set<number>): string {
  let out = text.replace(/\d+/g, m => allowed.has(parseInt(m,10)) ? m : '[quantity]');
  out = out.replace(/\S+/g, token => { const core = token.replace(/^[^a-z]+|[^a-z]+$/gi,'').toLowerCase(); if (SPOKEN_NUMBERS[core] !== undefined && !allowed.has(SPOKEN_NUMBERS[core])) return '[quantity]' + (token.includes('.')?'.':''); ... });
```
Hmm, a simpler spelled-out: iterate \S+ tokens; if core ∈ SPOKEN_NUMBERS && value ∉ allowed → replace token with '[quantity]' (+ preserve trailing punctuation if any: token "four," → "[quantity],"). But "one" as "one of" → redacted — decided OK.

Wait — conflict: "one" is also a stopword? No, "one" isn't in my STOPWORDS (I excluded 'one' from the stopwords list above? Check list: I have 'one'? I listed 'some','such'... no 'one' ✓ good).

Also — the number pass should skip tokens inside "[name]"? "[name]" core = "name" — not a number ✓.

Collapse: `.replace(/ {2,}/g, ' ')`.

Final redaction function:
```ts
export function redactForHint(answer: string, question: string): string {
  const allowed = new Set<number>(numberValues(question));
  let out = redactEntityRuns(answer);
  out = redactLocations(out);
  out = redactQuantities(out, allowed);
  return out.replace(/ {2,}/g, ' ').trim();
}
```

Verify the unit test sentence: "Pyreth the Ashen guards the Molten Keep behind the altar, and you need 9 ember shards to enter." Q "How do I get past the front gate?" allowed = {} ("no numbers in question").
Run pass: words: Pyreth(title, sentence-start, non-stopper) → run: next "the" lowercase embedded ✓ extend; "Ashen" title ✓ extend; "guards" lowercase non-embedded → stop. Run = "Pyreth the Ashen" → "[name]". Then "Molten" → run "Molten Keep," (punct) → "[name],". Wait, the sequence: "guards the Molten Keep behind..." — "Molten" title, next "Keep" title (punct '') extend, next "behind" lowercase non-embedded → stop → "[name]"... The sentence: "[name] guards the [name] behind the altar, and you need 9 ember shards to enter."
Hmm wait — "Molten Keep" — but there's a "the" between "the" and "Molten"? "guards the Molten Keep" — 'the' before Molten is a stopper and non-embedded-context — fine, the run starts at "Molten" ✓.
Location pass: "altar," core "altar" ∈ set ✓ → k "the" stopper → span "altar," → "[location]," → "...behind [location], and...". "gate" not in the text. "forge" also not.
Number pass: "9" → "[quantity]".
Result: "[name] guards the [name] behind [location], and you need [quantity] ember shards to enter."
Assertions: no /pyreth|ashen|molten|keep|altar|\b9\b/i ✓; contains [name], [location], [quantity] ✓.

Test for player-mentioned number: Q "I have 2 shards. How many more do I need?" A "You already have 2 shards, and you need 2 more." → allowed {2} → "2" preserved; "more" fine. Assert output contains "2" twice? Assert /\b2\b/ and no "[quantity]". ✓

### Service

```ts
export const REFUSAL = 'not covered by my sources';

export interface GuideAnswerInput { question: string; sources: string[]; mode: 'full' | 'hint'; }
export interface GuideResult { answer: string; refused: boolean; mode: 'full'|'hint'; totalSentences: number; droppedSentences: number; }

@Injectable()
export class GuideService {
  constructor(@Inject(LlmClient) private readonly llm: LlmClient) {}
  async answer(input: GuideAnswerInput): Promise<GuideResult> {
    const raw = await this.llm.complete(buildPrompt(input.question, input.sources));
    const assessment = assessAnswer(raw, input.sources, input.question);
    const kept = assessment.sentences.filter(s => s.grounded).map(s => s.text);
    let refused = false;
    let answer = kept.length > 0 ? kept.join(' ') : REFUSAL;
    if (kept.length === 0) refused = true;
    if (input.mode === 'hint') answer = redactForHint(answer, input.question);
    return { answer, refused, mode: input.mode, totalSentences: assessment.sentences.length, droppedSentences: assessment.totalSentences - kept.length };
  }
}
```
`@Inject(LlmClient)` — with an abstract-class token, the default constructor injection works without @Inject (Nest uses the design:paramtypes metadata... which esbuild omits → but this code path is only at app-boot time, which the tests don't run). I'll add @Inject for explicitness (works without metadata).

assessAnswer:
```ts
export function assessAnswer(answer, sources, question): AnswerAssessment {
  const sourceKeyset = buildKeyset(sources.join(' '));
  const sourceNumbers = new Set(numberValues(sources.join(' ')));
  const questionNumbers = new Set(numberValues(question));
  const sentences = splitSentences(answer).map(s => assessSentence(s, sourceKeyset, sourceNumbers, questionNumbers));
  return { sentences, groundedCount: sentences.filter(s=>s.grounded).length };
}
```
buildKeyset: all word tokens + their stems:
```ts
function buildKeyset(text: string): Set<string> {
  const set = new Set<string>();
  for (const w of tokenize(text)) { set.add(w); set.add(stem(w)); }
  return set;
}
```
Should the keyset include spoken-number words? "four" as a word token: if the reply says "four" it's handled in the number path ✓; the source's "four" in the keyset is harmless.

Wait, one issue: source text contains "4" as a digit → tokenize keeps "4" in the keyset; a reply word token "4" is handled in the number path, not the word path ✓.

Now — a subtle gate bug: a reply sentence containing a *word* that's in source but the sentence asserts a *false relation* (e.g. source: "Pyreth guards the entrance"; reply: "Pyreth guards the forge") — all tokens grounded (pyreth, guards, forge all in source) → passes! Lexical gate can't catch misrelation. That's the known limitation; a real system would use an entailment judge. The eval's faithfulness judge has the same limitation. The planted false facts in the spec are fabricated items / wrong quantities / misattributed locations — "misattributed location": "the shards are in the Frozen Spire" — "frozen", "spire" not in source → caught ✓ (if the location words exist in source, e.g. "shards are in the Molten Keep" → wait that's the truth; misattribution "shards are in the Molten Keep" when truth is "found in the Molten Keep"... The S1 falseFact "shards are found in the frozen spire" ✓ caught). The quantity case ✓. So the planted false facts are all caught by the lexical gate. The misrelation limitation → a `// LIMITATION` comment? The instructions say to use `// ASSUMPTION:` markers for genuinely unresolved things. The lexical gate being a proxy is a design decision — I'll document it in a comment (not an ASSUMPTION marker). I might use one ASSUMPTION marker or two where I truly make a judgment call: (1) no persistence → no Prisma layer (the convention implies a DB stack); (2) question-number allowance? That's a design rule with a comment, not an assumption. Let me use ASSUMPTION markers sparingly: one in app.module or a README-ish comment? "Mark it with a single // ASSUMPTION: <what was unresolved> comment at the point it matters." I'll place:
- In `src/app.module.ts`: `// ASSUMPTION: the task has no persistence requirement, so this feature has no Prisma repository and no DATABASE_URL usage; the guide pipeline is stateless.`
- Maybe in llm.client.ts: `// ASSUMPTION: no live LLM provider is configured in this environment; the default provider is the scripted client, which returns an empty reply (the gate then refuses) until a real client is injected.`
Good, two markers, both at points that matter.

### Controller validation code

```ts
function validateAnswerBody(body: unknown): { code: string; message: string; details: Record<string, unknown> } | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return bad('the request body must be a JSON object', { field: 'body' });
  const { question, sources, mode } = body as { question?: unknown; sources?: unknown; mode?: unknown };
  if (typeof question !== 'string' || question.trim().length === 0) return bad('question is required and must be a non-empty string', { field: 'question' });
  if (!Array.isArray(sources) || sources.length === 0 || sources.length > 3 || sources.some(s => typeof s !== 'string' || s.trim().length === 0)) return bad('sources must be an array of 1-3 non-empty page strings', { field: 'sources' });
  if (mode !== undefined && mode !== 'full' && mode !== 'hint') return bad("mode must be 'full' or 'hint'", { field: 'mode' });
  return null;
}
```
And `throw new BadRequestException({ error: { code: 'invalid_input', message, details } })`.

### Eval code

```ts
// src/eval/judges.ts
import { assessAnswer, ... } from '../guide/grounding.js'? 
```
Extensionless imports (bundler resolution): `from '../guide/grounding'`. Vitest resolves ✓ tsc bundler ✓.

```ts
import { assessAnswer } from '../guide/grounding';
import { REFUSAL } from '../guide/guide.service';
import type { GoldenScenario } from './golden-scenarios'; // or types here

export function isRefusal(answer: string): boolean {
  const t = answer.trim().toLowerCase().replace(/[.!?\s]+$/, '');
  return t === '' || t === REFUSAL.toLowerCase().replace(/[.!?\s]+$/, '');
}

export function judgeFaithfulness(answer: string, sources: string[], question = ''): number {
  if (isRefusal(answer)) return 1;
  const a = assessAnswer(answer, sources, question);
  if (a.sentences.length === 0) return 1;
  return a.groundedCount / a.sentences.length;
}

function factTokensCovered(answer: string, fact: string): boolean {
  const answerKeyset = buildKeyset(answer); // export from grounding
  const answerNumbers = new Set(numberValues(answer));
  for (const token of tokenize(fact)) {
    if (STOPWORDS.has(token)) continue;  // need to export STOPWORDS or a isStopword helper
    if (/^\d+$/.test(token)) { if (!answerNumbers.has(parseInt(token,10))) return false; }
    else if (isSpokenNumber(token)) { if (!answerNumbers.has(SPOKEN_NUMBERS[token])) return false; }
    else { const forms = wordForms(token); if (![...forms].some(f => answerKeyset.has(f))) return false; }
  }
  return true;
}
```
→ I need to export from grounding: `tokenize`, `STOPWORDS` (or `isStopword`), `numberValues`, `buildKeyset`, `wordForms`? Let me export the small helpers: `isStopword(w)`, `spokenNumberValue(w): number | null`, `wordForms(w): string[]`, `buildKeyset(text): Set<string>`, `tokenize`, `numberValues`. Good.

```ts
export function judgeHelpfulness(answer: string, scenario: GoldenScenario): number {
  if (isRefusal(answer)) return scenario.expectsRefusal ? 1 : 0;
  if (scenario.expectsRefusal) return 0; // claiming an answer the source doesn't contain
  const expected = scenario.expectedFacts;
  const coverage = expected.length === 0 ? 1 : expected.filter(f => factCovered(answer, f)).length / expected.length;
  if (scenario.falseFacts.some(f => factCovered(answer, f))) return 0;
  return coverage;
}
```
Wait — falseFact check also applies in the !expectsRefusal case: yes, as written (return 0 if covered). But order: check falseFacts first, then coverage? Either way → 0. And a non-refusal in a expectsRefusal scenario → 0 ✓ (a claim that's not in the source = unhelpful/harmful).

Hmm — a refusal in a !expectsRefusal scenario → 0 ("confident useless refusal" ✓).

```ts
// harness
export interface EvalRun {
  scenarioId: string;
  rawReply: string;
  systemAnswer: string;
  systemRefused: boolean;
  helpful: number;
  faithful: number;
  score: number;
}
export interface EvalReport { runs: EvalRun[]; overall: number; }

export class EvalHarness {
  constructor(private readonly service: GuideService, private readonly llm: LlmClient) {}
  async run(scenarios: readonly GoldenScenario[]): Promise<EvalReport> {
    const runs: EvalRun[] = [];
    for (const s of scenarios) {
      const rawReply = await this.llm.complete(buildPrompt(s.question, s.sources));
      const system = await this.service.answer({ question: s.question, sources: s.sources, mode: 'full' });
      const faithful = judgeFaithfulness(s.rawReply?, ...);
```
Wait — the judge runs on the rawReply (the model's generation), and the harness also exposes the systemAnswer. Hmm, I waffled earlier; let me lock it in. Re-reading the acceptance: "a scripted confident-lie answer scores low." "A scripted confident-lie answer" = the fake's reply. For it to "score low" via the judges, the judges must see it → the judges run on the rawReply. Locked: judges on rawReply; systemAnswer reported alongside (via the service).

But — one more angle: does the harness need the service at all? It produces a systemAnswer for inspection. The spec deliverable "eval harness with golden scenarios and both judges" — the service isn't required for the harness. But tying the pipeline + eval together is the product story ("answer pipeline + eval harness"). Keep both; the double LLM call on the deterministic fake is harmless. Actually — a subtle issue: with a ScriptedLlmClient that counts calls, the harness's call count = 2×scenarios. Fine.

Hmm, alternatively, the harness could take only the service and derive the raw reply from...? No — keep the (service, llm) pair.

```ts
      const helpful = judgeHelpfulness(rawReply, s);
      const faithful = judgeFaithfulness(rawReply, s.sources, s.question);
      runs.push({ scenarioId: s.id, rawReply, systemAnswer: system.answer, systemRefused: system.refused, helpful: round(helpful), faithful: round(faithful), score: round(Math.min(helpful, faithful)) });
    }
    const overall = runs.length ? runs.reduce((a, r) => a + r.score, 0) / runs.length : 0;
    return { runs, overall: round(overall) };
  }
}
const round = (n: number) => Math.round(n * 1000) / 1000;
```

### Scenario type

```ts
export interface GoldenScenario {
  id: string;
  description: string;
  question: string;
  sources: string[];
  expectedFacts: readonly string[];
  falseFacts: readonly string[];
  expectsRefusal: boolean;
  llmReply: string;   // what the scripted fake returns for this scenario
  matchWhen?: string; // substring of the prompt that routes to llmReply
}
export const GOLDEN_SCENARIOS: readonly GoldenScenario[] = [ ... 4 scenarios ... ];
```
And a helper: `export function scriptedClientFor(scenarios): ScriptedLlmClient`? Put in the test file:
```ts
const client = new ScriptedLlmClient({ replies: GOLDEN_SCENARIOS.map(s => ({ when: s.matchWhen ?? s.id, reply: s.llmReply })), fallback: REFUSAL });
```
fallback REFUSAL? A fallback refusal is safe-side; but an empty fallback is more honest (empty → gate refuses → the same visible outcome). Either way the system output is the refusal. I'll use fallback: ''.

ScriptedLlmClient:
```ts
export interface LlmReply { when: string; reply: string; }
export interface LlmScript { replies: LlmReply[]; fallback?: string; }
export abstract class LlmClient { abstract complete(prompt: string): Promise<string>; }
export class ScriptedLlmClient implements LlmClient {
  readonly prompts: string[] = [];
  constructor(private readonly script: LlmScript = { replies: [] }) {}
  async complete(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    const p = prompt.toLowerCase();
    const hit = this.script.replies.find(r => p.includes(r.when.toLowerCase()));
    return (hit?.reply ?? this.script.fallback ?? '');
  }
}
export function buildPrompt(question: string, sources: string[]): string {
  const pages = sources.map((s, i) => `--- page ${i + 1} ---\n${s}`).join('\n\n');
  return `Answer the player's question using only the wiki pages below. If the pages do not contain the answer, reply exactly: ${REFUSAL}\n\nPlayer question: ${question}\n\nWiki pages:\n${pages}`;
}
```
Wait — the REFUSAL import in llm.client (from guide.service) — and guide.service imports buildPrompt from llm.client → circular import! ES modules handle circularity if usage is at runtime (function/const usage after both are initialized) — buildPrompt uses REFUSAL at call time (function body) ✓; GuideService uses REFUSAL at call time ✓; module-level const initialization order: guide.service.ts imports llm.client.ts → llm.client.ts imports guide.service.ts (circular) → REFUSAL const is in the TDZ at llm.client evaluation, but buildPrompt only references it when called ✓ works in ESM. A bit icky. Cleaner: put REFUSAL in a small shared spot — `src/guide/grounding.ts`? It's a product constant... or a dedicated `src/guide/constants.ts`? "Don't create files that aren't asked for" — one small file is fine, but I could put REFUSAL in `llm.client.ts` (the prompt tells the model to refuse with that phrase — actually that's a natural home!) and guide.service imports from llm.client. llm.client imports nothing from guide.service ✓ no cycle. REFUSAL in llm.client.ts: `export const REFUSAL = 'not covered by my sources';` — comment: the single refusal phrase used by the prompt, the gate, and the eval. Good.

buildPrompt references REFUSAL ✓ same file ✓.

### Now tests

`test/guide.spec.ts`:
```ts
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { GuideService } from '../src/guide/guide.service';
import { ScriptedLlmClient, LlmClient, REFUSAL, buildPrompt } from '../src/guide/llm.client';
import { redactForHint } from '../src/guide/redaction';
import { assessAnswer, splitSentences } from '../src/guide/grounding';

const FORGE_PAGE_1 = 'The Beacon Forge lights when 4 ember shards are inserted into the socket above the anvil.';
const FORGE_PAGE_2 = 'Ember shards are found in the Molten Keep. Pyreth the Ashen guards the entrance to the Molten Keep.';
```
Hmm — these duplicates the eval scenarios; better to import from `src/eval/golden-scenarios` (single source of truth). The guide spec tests are more unit-ish (custom replies) — I'll reuse the scenario pages for the shared parts. Let me write the guide tests with local fixtures (unit-level, focused) — some duplication is acceptable? "Don't restate..." that's about the repo files. Test fixtures being independent = good practice. But to avoid divergence, I'll import the pages from the scenario module where the same page is used. I'll import GOLDEN_SCENARIOS pages where convenient.

Tests:

1. `drops ungrounded sentences and keeps grounded ones`:
```ts
const client = new ScriptedLlmClient({ replies: [{ when: 'beacon forge', reply: 'You need 4 ember shards to light the Beacon Forge. You must also obtain the Obsidian Chalice from the Frozen Spire.' }] });
const svc = new GuideService(client);
const r = await svc.answer({ question: 'How do I light the Beacon Forge?', sources: [P1, P2], mode: 'full' });
expect(r.refused).toBe(false);
expect(r.answer).toContain('4 ember shards');
expect(r.answer).not.toMatch(/obsidian|chalice|frozen|spire/i);
expect(r.droppedSentences).toBe(1);
expect(r.totalSentences).toBe(2);
```
Verify s2: "You must also obtain the Obsidian Chalice from the Frozen Spire." tokens: must(stop) also(stop) obtain✗ obsidian✗ chalice✗ frozen✗ spire✗ → dropped ✓.
s1: "You need 4 ember shards to light the Beacon Forge." ✓ grounded (per earlier). ✓
Q "How do I light the Beacon Forge?" — no numbers ✓.

2. `refuses when nothing is grounded`:
reply: 'The Beacon Forge is a myth and the shards never existed.' → tokens: beacon✓ forge✓ is(stop) a(stop) myth✗ → dropped. → refused true, answer REFUSAL.

3. `quantity errors are caught exactly`:
```ts
const reply = 'You need 5 ember shards to light the Beacon Forge. Insert them into the socket above the anvil.';
const assessment = assessAnswer(reply, [P1, P2], 'How many ember shards does the Beacon Forge need?');
expect(assessment.sentences[0].grounded).toBe(false);
expect(assessment.sentences[0].missing).toEqual(['5']);
expect(assessment.sentences[1].grounded).toBe(true);
```
"Accurately" → missing is exactly ['5'] ✓ (s1 tokens: need(stop) 5✗ ember✓ shards✓ to(stop) light✓(lights stem) the(stop) beacon✓ forge✓ → missing ['5'] exactly ✓).
And the service: dropped 1, answer = 'Insert them into the socket above the anvil.'? Hmm — the kept sentence alone: "Insert them into the socket above the anvil." — "them" refers to nothing... acceptable (the gate is sentence-level). The test asserts r.answer === 'Insert them into the socket above the anvil.' and no "5". ✓

4. `hint mode is a redaction of the grounded answer with a single LLM call`:
```ts
const reply = 'You need 4 ember shards to light the Beacon Forge. The shards are found in the Molten Keep, and Pyreth the Ashen guards its entrance.';
const client = new ScriptedLlmClient({ replies: [{ when: 'beacon forge', reply }] });
const svc = new GuideService(client);
const full = await svc.answer({ question: 'How do I light the Beacon Forge?', sources: [P1, P2], mode: 'full' });
const hint = await svc.answer({ question: 'How do I light the Beacon Forge?', sources: [P1, P2], mode: 'hint' });
expect(client.prompts).toHaveLength(2); // one call per answer() — hmm, 2 calls total
```
Wait "no second LLM call" means hint mode doesn't re-prompt beyond the one for full. Two separate answer() calls → two prompts total, one each. To prove hint uses one call: fresh service+client, one hint call → prompts length 1 ✓. And `hint.answer === redactForHint(full.answer, question)` with a fresh pair (full answer is deterministic). Assert both: one call per hint; hint.answer === redactForHint(full.answer, q); and hint.answer doesn't match /pyreth|molten keep|4/... wait "4" — Q "How do I light the Beacon Forge?" has no number → "4" → "[quantity]" ✓; "Molten Keep" → "[name]" ✓; "Pyreth the Ashen" → "[name]" ✓.
Verify the reply sentences are grounded: s1 ✓; s2: the shards are found in the Molten Keep and Pyreth the Ashen guards its entrance → tokens: shards✓ found✓ molten✓ keep✓ pyreth✓ ashen✓ guards✓ its(stop) entrance✓ → ✓.
full.answer = both sentences joined ✓. hint.answer = redact(...) → "[quantity] ember shards" wait s1: "You need 4 ember shards to light the Beacon Forge." → "Beacon Forge" is a title run → "[name]": "You need [quantity] ember shards to light [name]." s2 → "The [name], and [name] guards its entrance." Wait "The" sentence-initial stopper kept; "Molten Keep" → [name]; "Pyreth the Ashen" → [name]. → "The [name], and [name] guards its entrance."
Joined: "You need [quantity] ember shards to light [name]. The [name], and [name] guards its entrance."
Assertions: no /pyreth|ashen|molten|keep|forge|beacon|\b4\b/i; contains '[name]' and '[quantity]'. ✓ ("forge" appears only inside "Beacon Forge" ✓ both redacted.)

5. `redaction removes a boss name, a location, and an unmentioned quantity` (the spec's direct test):
```ts
const out = redactForHint('Pyreth the Ashen guards the Molten Keep behind the altar, and you need 9 ember shards to enter.', 'How do I get past the front gate?');
expect(out).not.toMatch(/pyreth|ashen|molten|keep|altar|\b9\b/i);
expect(out).toContain('[name]').toContain('[location]').toContain('[quantity]');
```
✓ (verified above).

6. `redaction keeps quantities the player already mentioned`:
```ts
const out = redactForHint('You already have 2 shards and need 2 more to reach 4.', 'I have 2 shards. How many more do I need?');
expect(out).toContain('2');
expect(out).not.toContain('[quantity]');  // 4 → redacted? "reach 4" → 4 ∉ question {2} → [quantity]!!
```
Oops: "to reach 4" → 4 not in question → [quantity] → the assertion not.toContain('[quantity]') fails. Fix the answer: 'You already have 2 shards and need 2 more.' → all 2s allowed → no [quantity] ✓. Assert out contains '2' and no '[quantity]'. Also spelled-out: 'You have two shards and need two more.' Q 'I have two shards. How many more?' → allowed {2} → "two" preserved. Add: expect(out2).toContain('two') and no [quantity]. ✓

7. `hint mode of a refusal is the refusal itself`:
reply fully fabricated → hint → answer === REFUSAL (redaction of REFUSAL unchanged — verify: "not covered by my sources" — any title case? no. Location nouns? "sources"? not in the list ✓. Numbers? no. → unchanged ✓).
```ts
const r = await svc.answer({ ..., mode: 'hint' });
expect(r.refused).toBe(true); expect(r.answer).toBe(REFUSAL);
```

8. Maybe a `spelled-out quantity caught` test: reply 'You need five ember shards to light the Beacon Forge.' → missing ['five'] → dropped. Add to the quantity test? A separate small test:
```ts
const a = assessAnswer('You need five ember shards to light the Beacon Forge.', [P1,P2], 'How many shards do I need?');
expect(a.sentences[0].grounded).toBe(false);
expect(a.sentences[0].missing).toContain('five');
```
"Accurately" ✓. (five ∉ source numbers {4} ✓; other tokens ✓.)

`test/eval.spec.ts`:
```ts
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { GOLDEN_SCENARIOS } from '../src/eval/golden-scenarios';
import { EvalHarness } from '../src/eval/eval-harness';
import { judgeFaithfulness, judgeHelpfulness } from '../src/eval/judges';
import { GuideService } from '../src/guide/guide.service';
import { ScriptedLlmClient, REFUSAL } from '../src/guide/llm.client';

function makeHarness() {
  const client = new ScriptedLlmClient({ replies: GOLDEN_SCENARIOS.map(s => ({ when: s.matchWhen, reply: s.llmReply })), fallback: '' });
  const service = new GuideService(client);
  return { harness: new EvalHarness(service, client), client };
}

async function runById(id: string) { const { harness } = makeHarness(); const report = await harness.run(GOLDEN_SCENARIOS); return report.runs.find(r => r.scenarioId === id)!; }
```
Tests:
1. **Confident lie scores low**: `const lie = await runById('invented-item-requirement'); expect(lie.score).toBeLessThan(0.5); expect(lie.faithful).toBe(0); expect(lie.helpful).toBe(0); expect(lie.systemRefused).toBe(true);` (the gate also refuses the lie).
2. **Correct grounded answer scores high**: `const good = await runById('grounded-correct'); expect(good.score).toBe(1); expect(good.faithful).toBe(1); expect(good.helpful).toBe(1);`
3. **Refusal on missing source is scored as correct**: `const missing = await runById('answer-not-in-sources'); expect(missing.score).toBe(1); expect(missing.rawReply).toBe(REFUSAL);`
4. **Quantity lie caught accurately**:
```ts
const q = await runById('wrong-quantity');
expect(q.faithful).toBe(0.5); // exactly one of two sentences ungrounded
expect(q.score).toBe(0);
```
Plus the gate's accuracy (also in the guide spec).
5. **The faithfulness judge uses the source**:
```ts
const text = 'You need 4 ember shards to light the Beacon Forge.';
expect(judgeFaithfulness(text, ['The Beacon Forge lights when 4 ember shards are inserted.'], 'how do I light it?')).toBe(1);
expect(judgeFaithfulness(text, ['The lighthouse keeper polishes lanterns.'], 'how do I light it?')).toBe(0);
```
Verify the second: tokens: need(stop) 4 (source numbers: none → missing) ember✗ shards✗ light→source "polishes lanterns"... "lights"? no → missing → 0/1 = 0 ✓. First: source "The Beacon Forge lights when 4 ember shards are inserted." → light✓(lights) 4✓ ember✓ shards✓ beacon✓ forge✓ → 1.0 ✓. Question 'how do I light it?' — irrelevant ✓.
6. **min combination**: a fluent lie that contains the truth → helpful 0 / faithful low → score low; a confident useless refusal → helpful 0. Test:
```ts
const truthPlusLie = 'You need 4 ember shards, and the Obsidian Chalice, to light the Beacon Forge.';
// a scenario-like judge call:
expect(judgeFaithfulness(truthPlusLie, [P1, P2], 'how do I light the forge?')).toBe(0); // one sentence, ungrounded (obsidian, chalice)
expect(judgeHelpfulness(truthPlusLie, groundedScenario)).toBe(0); // false fact covered
```
Hmm, this is the same as scenario 3's reply. I could assert via the lie run that both judges are 0 → min is low. Test 1 covers it. An additional explicit test of min-combination semantics:
```ts
// a fluent lie scores low even if it's fluent: min of the judges
const lie = await runById('invented-item-requirement');
expect(lie.score).toBe(Math.min(lie.helpful, lie.faithful));
```
Weak. Better: test that a refusal in a non-refusal scenario → helpful 0 (a confident useless refusal scores low):
```ts
const s = GOLDEN_SCENARIOS.find(x => x.id === 'grounded-correct')!;
expect(judgeHelpfulness(REFUSAL, s)).toBe(0);
expect(judgeHelpfulness(REFUSAL, GOLDEN_SCENARIOS.find(x => x.expectsRefusal)!)).toBe(1);
```
✓ directly encodes "a confident useless refusal ... scores low" and "refusal on missing → correct."

7. Overall report sanity: `report.overall` = mean of [1, 0.5→? wait scores: grounded-correct 1, wrong-quantity 0 (helpful 0 → min 0), invented-item 0, not-in-sources 1] → overall 0.5. Assert report.runs.length === 4. Maybe assert the order? Skip.

Wait — the wrong-quantity run: faithful 0.5, helpful 0 → score 0 ✓.

Also double-check grounded-correct's helpfulness: expectedFacts coverage:
- "4 ember shards": tokens 4✓ (answer has "4"), ember✓, shards✓ → covered.
- "light the beacon forge": light✓ beacon✓ forge✓ → covered.
- "shards are found in the molten keep": shards✓ found✓ molten✓ keep✓ → covered.
- "pyreth the ashen guards the entrance": pyreth✓ ashen✓ guards✓ entrance✓ → covered.
→ 1.0 ✓. falseFacts: "requires the obsidian chalice" → obsidian∉answer ✓ not covered; "5 ember shards" → 5∉answer ✓; "shards are found in the frozen spire" → frozen✗ → not covered ✓ → helpful 1 ✓.

faithful 1 (all 3 sentences grounded — verified) → score 1 ✓.

Scenario ids: 'grounded-correct', 'wrong-quantity', 'invented-item-requirement', 'answer-not-in-sources'.

Now the scenario `matchWhen` values (unique substrings of each prompt; prompts contain the question + pages — the pages are the same forge text across scenarios 1-3! So `when` must match on the *question* part):
- grounded-correct Q: 'How do I light the Beacon Forge, and where do I find the shards?' when: 'where do i find the shards' — verify S2's Q doesn't contain it: S2 'How many ember shards does the Beacon Forge need?' no ✓. S3 Q 'What do I need to light the Beacon Forge?' — contains 'where do i find'? no ✓.
- wrong-quantity when: 'how many ember shards' ✓ unique.
- invented-item when: 'what do i need to light' ✓ unique.
- answer-not-in-sources Q: 'What does the lighthouse keeper collect in winter?' when: 'lighthouse keeper' ✓ unique.

Scenario source arrays: S1: [P1, P2]; S2: [P1, P3] where P3 = 'The forge socket accepts exactly 4 shards. Fewer than 4 leaves the forge dark.'; S3: [P1, P2]; S4: [P1, P2] (irrelevant pages). ✓ 2 pages each (within 2-3 ✓).

S2 check: reply 'You need 5 ember shards to light the Beacon Forge. Insert them into the socket above the anvil.' — s2 tokens: insert (P1 "inserted"→insert ✓) socket ✓ (P1 & P3) above ✓ anvil ✓ → grounded ✓. s1: 5 vs source numbers {4} (P1: 4; P3: 4,4) → missing ['5'] ✓. faithful = 0.5 ✓. expectedFacts: ['4 ember shards'] → answer has shards✓, 4? no → coverage 0 → helpful 0 → score 0 ✓. falseFacts: ['5 ember shards'] → covered in raw (5✓ shards✓) → 0 anyway ✓.

S3 reply: 'You must gather the Obsidian Chalice and pour it into the Beacon Forge. The chalice needs 7 fragments of cold iron to work.' — wait "needs" — 'need' stopword? I didn't list 'need'/'needs' in STOPWORDS above. Check: "needs" token → stem "need" — not in the keyset (source has no "need") → missing anyway (the sentence already has missing tokens) ✓ doesn't affect the verdict. But for cleanliness, should 'need' be a stopword? "need" is a claim verb... "you need 4 shards" — the claim is the quantity (checked via number) + "shards" (checked). Treating "need" as a required word would drop "You need the Obsidian Chalice" if the source lacks "need" — already dropped by chalice/obsidian. Either way. Add 'need','needs'? stems: token "needs"→stem "need"; if "need" ∈ STOPWORDS I need to check stopword before stemming — my assessSentence checks STOPWORDS.has(token) with the raw token → "needs" isn't in the set, "need" is → inconsistent. Skip 'need' from stopwords entirely (it's a content word; the source usually has it... P1 "lights when" no "need"... S1's reply has no "need" ✓; S3 has "needs" → extra missing token, harmless). Keep STOPWORDS as is (no 'need'). But I did list 'must' in the modal stopword list above — verify the final list contains 'must' ✓ (I listed 'might','must' ✓).

Also 'let'/'lets' — I included in an earlier draft; keep? Harmless. Let me finalize the STOPWORDS list carefully (single source, used for grounding + redaction + sentence-initial detection):

a an the and or but if then else of to in on at by for with without from into onto over under above below behind before after near through during while is am are was were be been being do does did have has had will would can could should shall may might must you your yours i we they he she it its our ours us them him her his this that these those here there where when how what which who whom whose not no so as just also only too very all any each every more most some such than up out off down again further once because until against between among about let lets

Hmm 'lets' is weird; drop. 'some','such' ✓. 'one' excluded ✓. 'two' excluded ✓.

STOPPER_CAPS for redaction: derive from STOPWORDS capitalized + extras? In redaction, sentence-initial "You" — 'you' ∈ STOPWORDS → 'You' ∈ STOPPER_CAPS ✓. "The" ✓. "Pyreth" ∉ → run starts ✓. Derive: `new Set([...STOPWORDS].map(w => w.charAt(0).toUpperCase() + w.slice(1)))`. 'i'→'I' ✓.

EMBEDDED (lowercase function words inside a run): the, of, de, la, le, du, van, von. ('the' is in STOPWORDS but that's fine.)

Now — the redaction run pass on the grounded-correct's hint: "You need 4 ember shards to light the Beacon Forge. The shards are found in the Molten Keep, and Pyreth the Ashen guards its entrance."
- "Beacon Forge" run → "[name]". Wait, "Beacon" title, "Forge" title → run ✓. "The" sentence-initial stopper skipped ✓. "Molten Keep," → run "Molten Keep" punct ',' → "[name],". "Pyreth the Ashen" → "[name]".
Result: "You need 4 ember shards to light [name]. The shards are found in [name], and [name] guards its entrance."
Location pass: any location nouns remaining? "forge" is gone (redacted). None. ✓
Number pass: "4" ∉ question numbers (Q 'How do I light the Beacon Forge, and where do I find the shards?' — no numbers) → "[quantity]".
Final: "You need [quantity] ember shards to light [name]. The shards are found in [name], and [name] guards its entrance."
No boss name ✓, no location ("Molten Keep" gone; "forge" gone) ✓, no unmentioned quantity (4→[quantity]) ✓.

Hmm — "The" remains — a sentence-initial stopper, fine.

### One more thing to verify — `splitSentences` on the joined kept sentences: the service joins kept sentences with ' ' — each sentence retains its trailing period ✓.

### assessAnswer's signature takes a question for numbers:
`assessAnswer(answer, sources, question)`. The faithfulness judge calls with the scenario's question ✓; the S4 refusal path is irrelevant.

### Edge: `assessSentence` for a sentence "The forge socket accepts exactly 4 shards."? Not used in the reply. Fine.

### GuideResult in the controller response — includes droppedSentences etc. ✓ fine.

### Now — `GuideModule` default LlmClient provider: `{ provide: LlmClient, useClass: ScriptedLlmClient }` — ScriptedLlmClient's constructor `script: LlmScript = {replies: []}` optional → Nest instantiates with no args ✓.

### main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}
void bootstrap();
```

### app.module.ts
```ts
import { Module } from '@nestjs/common';
import { GuideModule } from './guide/guide.module';

// ASSUMPTION: ...no persistence...
@Module({ imports: [GuideModule] })
export class AppModule {}
```

### Controller file
```ts
import { BadRequestException, Body, Controller, Injectable, Post } from '@nestjs/common';
import { GuideResult, GuideService } from './guide.service';
import type { GuideAnswerInput } from './guide.service';
```
Wait, GuideAnswerInput is an interface → `import { GuideService, type GuideAnswerInput }`? TS 5 inline type imports ✓ (verbatimModuleSyntax is off; either is fine). Let me use `import { GuideService } from './guide.service'; import type { GuideAnswerInput, GuideResult } from './guide.service';`

Validation function in the controller file (controller validates ✓).

```ts
@Controller('guide')
export class GuideController {
  constructor(private readonly guideService: GuideService) {}

  @Post('answers')
  createAnswer(@Body() body: unknown): Promise<GuideResult> {
    const problem = validateAnswerRequest(body);
    if (problem) throw new BadRequestException({ error: problem });
    const input = body as GuideAnswerInput;
    return this.guideService.answer({
      question: (input.question as string).trim(),
      sources: input.sources as string[],
      mode: (input.mode as 'full' | 'hint') ?? 'full',
    });
  }
}
```
Hmm `input.mode ?? 'full'` — mode undefined → 'full' ✓ (validated to be one of full/hint/undefined).

validateAnswerRequest returns `{ code: 'invalid_input'; message: string; details: Record<string, unknown> } | null`.

### redaction.ts details — write carefully.

```ts
import { STOPWORDS, isSpokenNumber? ... } 
```
Wait — what redaction needs: STOPWORDS, SPOKEN_NUMBERS, numberValues, tokenize? It works with \S+ tokens mostly on raw text. Let me export from grounding: `STOPWORDS`, `SPOKEN_NUMBERS` (or a `spokenNumberValue(word): number | null` helper), `numberValues(text)`. Let me finalize grounding's exports:

```ts
export const STOPWORDS: ReadonlySet<string>
export function tokenize(text: string): string[]
export function normalizeText(text: string): string
export function numberValues(text: string): number[]
export function spokenNumberValue(word: string): number | null   // null if not a spoken number
export function stem(word: string): string
export function wordForms(word: string): string[]
export function buildKeyset(text: string): Set<string>
export function isStopword(word: string): boolean
export function splitSentences(text: string): string[]
export interface SentenceVerdict { text: string; grounded: boolean; missing: string[] }
export interface AnswerAssessment { sentences: SentenceVerdict[]; groundedCount: number }
export function assessSentence(sentence: string, sourceKeyset: ReadonlySet<string>, sourceNumbers: ReadonlySet<number>, questionNumbers: ReadonlySet<number>): SentenceVerdict
export function assessAnswer(answer: string, sources: string[], question: string): AnswerAssessment
```

redactForHint in redaction.ts:

```ts
import { STOPWORDS, SPOKEN_NUMBERS?? } 
```
Let me just import `spokenNumberValue`, `numberValues`, `STOPWORDS`.

```ts
const EMBEDDED = new Set(['the','of','de','la','le','du','van','von']);
const STOPPER_CAPS = new Set<string>([...STOPWORDS].map(w => w.charAt(0).toUpperCase() + w.slice(1)));
const LOCATION_NOUNS = new Set([...]);

interface Token { index: number; text: string; }

function tokens(text: string): Token[] {
  return [...text.matchAll(/\S+/g)].map(m => ({ index: m.index!, text: m[0] }));
}
```
TS: m.index is number | undefined → `m.index!` with strict... matchAll with /g on a string — index is defined; use a non-null assertion or `?? 0`. I'll use `m.index ?? 0`.

coreOf(t): `t.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z]+$/, '')` — "Keep," → "Keep" ✓ "[name]" → "name" ✓.
punctOf(t): trailing `[,.!?;:]+` match: `const m = t.match(/([,.!?;:]+)$/); return m ? m[1] : '';`

isTitleCore(t): `^[A-Z][a-z'’-]*$`.test(coreOf(t)) — "Pyreth" ✓; "O'Brien" core "O'Brien" ✓ ('' included). "NPC" ✗.

sentenceStart(text, index):
```ts
function isSentenceStart(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n') continue;
    return c === '.' || c === '!' || c === '?' || c === '“' || c === '“'; // opening quote
  }
  return true;
}
```

redactEntityRuns:
```ts
function redactEntityRuns(text: string): string {
  const ts = tokens(text);
  let out = '';
  let cursor = 0;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (!isTitleCore(t.text)) continue;
    if (isSentenceStart(text, t.index) && STOPPER_CAPS.has(t.text)) continue; // hmm — t.text may have punct; "The," → STOPPER_CAPS.has("The,") false!
```
Fix: use the core for the stopper check: `STOPPER_CAPS.has(capOf(coreOf(t.text)))`? Simpler: `STOPPER_CAPS.has(t.text.replace(/[,.!?;:]$/, '').charAt(0).toUpperCase() + ...)` — I'll compute `const clean = t.text.replace(/^[^A-Za-z]+/, '')` (leading punct like "(The") — keep trailing? "The," → core "The" → cap "The" ∈ set ✓. Use coreOf for classification but replace the entire original token span (including trailing punct) with '[name]' + punct.

Wait — for the stopper check I only need the core capitalized: `const core = coreOf(t.text); const isStopperCap = STOPPER_CAPS.has(core.charAt(0).toUpperCase() + core.slice(1));`

Run extension:
```ts
    let j = i;
    while (j + 1 < ts.length) {
      const nx = ts[j + 1];
      const coreNx = coreOf(nx.text);
      const isTitleNx = isTitleCore(nx.text);
      if (isTitleNx) { j++; continue; }
      if (!isTitleNx && EMBEDDED.has(coreNx.toLowerCase())) { j++; continue; }
      break;
    }
    // span from t.index to ts[j].index + ts[j].text.length
    out += text.slice(cursor, t.index) + '[name]' + punctOf(ts[j].text);
    cursor = ts[j].index + ts[j].text.length;
    i = j; // the for-loop will i++ → next candidate
  }
  out += text.slice(cursor);
  return out;
}
```
Wait bug: a title-case word with a leading punct like "'Pyreth"? Rare. Also, an embedded word with punct "the," → coreOf "the" ∈ EMBEDDED ✓ extend.

Hmm — a run extending through a title-case stopper: "And Pyreth..." — "And" is sentence-initial? If "And" is sentence-start and ∈ STOPPER_CAPS → skipped as a start ✓; but as an extension (mid-run) it would extend — e.g. "Keep And..." unlikely. OK.

Another bug: the `continue` at `if (!isTitleCore(t.text)) continue;` — but a title-case word that's a sentence-initial stopper: `continue` (skip, not a run start) ✓. But a mid-sentence title-case stopper, e.g. "The Keep and the Vault"? "The" (mid-sentence after "and ") — sentenceStart false → not skipped → run start "The Keep and the Vault"?? EMBEDDED has 'the' but not 'and' → run "The Keep" → "[name]" — over-redacts "The Keep" (a generic "the keep"?). Over-redaction is safe-side. Acceptable.

Also — a run extending into an embedded word and then a lowercase non-embedded: "Molten Keep and Pyreth" — "and" not embedded → stops ✓.

redactLocations:
```ts
function redactLocations(text: string): string {
  const ts = tokens(text);
  const spans: Array<[number, number]> = [];
  for (let i = 0; i < ts.length; i++) {
    const core = coreOf(ts[i].text).toLowerCase();
    if (!LOCATION_NOUNS.has(core)) continue;
    let left = i;
    let taken = 0;
    let k = i - 1;
    while (k >= 0 && taken < 2) {
      const prevCore = coreOf(ts[k].text).toLowerCase();
      if (STOPWORDS.has(prevCore) || isTitleCore(ts[k].text)) break;
      left = k; taken++; k--;
    }
    spans.push([ts[left].index, ts[i].index + ts[i].text.length]);
  }
  spans.sort((a, b) => b[0] - a[0]);
  let out = ''; let cursor = 0;
  for (const [s, e] of spans) {
    out += text.slice(cursor, s) + '[location]' + punctOf(text.slice(e, e + 3)); hmm
  }
```
Punctuation: the span ends at the end of the noun token which includes its trailing punct (the token includes punct, e.g. "vault.") → the replacement '[location]' loses the '.'. Handle: `const punct = punctOf(ts[i].text);` replace with '[location]' + punct, span end = token end (including punct) → so the span e = ts[i].index + ts[i].text.length includes the punct; the replacement text '[location]' + punct ✓.
Overlapping spans (two location nouns within a 2-word window: "the keep and vault"? 'and' is a stopword → the leftward expansion stops at 'and' → span 2 is just "vault"; span 1 "the keep"? 'the' stopper → just "keep". No overlap. "vault keep"? taken: for keep: prev "vault" non-stopword non-title → left→vault, taken 1; prev "the" stopper stop → span "vault keep" — and vault's own span "vault" (prev "the" stopper) → overlap! Sort desc & skip overlaps: track lastStart; if s >= lastProcessedEnd? Let me do: filter spans where s >= next span's end... Standard: sort desc; iterate; keep if s >= keptEnd (the end of the last-kept span, which starts later). `let nextMin = Infinity; for (const [s,e] of sortedDesc) { if (e > nextMin) continue; nextMin = s; ... }` — since we go right-to-left, a span overlapping an already-kept (right) span is skipped ✓.

Also skip if the token is already a placeholder: core "location"/"name" not in LOCATION_NOUNS ✓.

Also — a title-case location noun: "Keep" alone mid-sentence is a title → already redacted by the run pass (single-word run "Keep" → [name]) — wait, single title-case word run: "The Keep" mid-sentence → "Keep" is a run start (non-stopper) → "[name]" → then the location pass sees nothing ✓. But a lowercase "keep" (generic) in "the keep" → location pass: "keep" → [location] ✓ good.

redactQuantities:
```ts
function redactQuantities(text: string, allowed: ReadonlySet<number>): string {
  let out = text.replace(/\d+/g, (m) => (allowed.has(Number(m)) ? m : '[quantity]'));
  const ts = tokens(out);
  let result = ''; let cursor = 0;
  for (const t of ts) {
    const core = coreOf(t.text).toLowerCase();
    const value = spokenNumberValue(core);
    if (value !== null && !allowed.has(value)) {
      result += out.slice(cursor, t.index) + '[quantity]' + punctOf(t.text);
      cursor = t.index + t.text.length;
    }
  }
  result += out.slice(cursor);
  return result;
}
```
Note: "one" → spokenNumberValue('one') = 1 → redacted if 1 ∉ allowed. OK.

Wait — a digit inside a placeholder? none. A digit in "[quantity]"? none.

`spokenNumberValue`:
```ts
const SPOKEN: Record<string, number> = { one:1,...,twenty:20 };
export function spokenNumberValue(word: string): number | null { return Object.prototype.hasOwnProperty.call(SPOKEN, word) ? SPOKEN[word] : null; }
```

numberValues:
```ts
export function numberValues(text: string): number[] {
  const values = new Set<number>();
  for (const t of tokenize(text)) {
    if (/^\d+$/.test(t)) values.add(parseInt(t, 10));
    else { const v = SPOKEN[t]; if (v !== undefined) values.add(v); }
  }
  return [...values];
}
```
Hmm "forty", "hundred"? Skip — document the limit to 1..20.

### Now — verify S4 pipeline: the service's raw = '' (fallback) or the REFUSAL string (the scenario's llmReply = REFUSAL, and matchWhen 'lighthouse keeper' routes ✓ raw = REFUSAL). assess: sentence "not covered by my sources" → tokens: not(stop) covered✗ my(stop?) — 'my'? Did I include 'my' in STOPWORDS? Check my list: 'my' — I listed 'i','we',... but did I list 'my'?? Scan: 'you','your','yours','i','we','they','he','she','it','its','our','ours','us','them','him','her','his' — I forgot 'my'! Add 'my'. Then "covered" ✗ → ungrounded → dropped → refused ✓ answer REFUSAL ✓.

The harness raw for S4 = REFUSAL → isRefusal → faithful 1, helpful 1 ✓.

### Verify the S1 (grounded-correct) harness raw scoring — the reply sentences all grounded against [P1, P2] with the question's numbers:
s1 "You need 4 ember shards to light the Beacon Forge." → all ✓ (need: not stopword! "need" — I decided to exclude it from stopwords. Is "need" in the source? P1: "The Beacon Forge lights when 4 ember shards are inserted into the socket above the anvil." — no "need"!! → missing ['need'] → s1 ungrounded → faithful 2/3 = 0.667 → score min(1, 0.667) = 0.667 ≠ 1 → the "scores high" test (toBe(1)) fails!

Fix options: (a) add 'need' to STOPWORDS (a modal-ish auxiliary — defensible: "need/needs/want" are speech-act verbs, not claims about the game world; the claims are the objects/numbers). Add 'need','needs','want','wants' to STOPWORDS. Hmm "want" — OK, add. This makes "need" not claim-checking. (b) craft the source to contain "need" — P1: "You need 4 ember shards to light the Beacon Forge."? That's the answer itself in the source — actually realistic (the wiki states the requirement). But then the gate is trivially satisfied by source-echo. My S1 P1: "The Beacon Forge lights when 4 ember shards are inserted into the socket above the anvil." — let me change P1 to contain "need": "The Beacon Forge needs 4 ember shards to light. Insert them into the socket above the anvil." Then tokens: needs→stem "need" in keyset ✓; "to light" → "light" — "light" in P1 ✓; "insert" ✓. And the reply s1: "You need 4 ember shards to light the Beacon Forge." → need→source "needs"→stem ✓ light✓ 4✓ ember✓ shards✓ beacon✓ forge✓ → grounded ✓.

Let me do both (add need/needs to stopwords AND keep P1 as "lights when"?). The simplest and most robust: add 'need','needs','want','wants','must'? — 'must' already. Add 'need','needs','want','wants'. And keep P1 as is. Then "need" is a stopword → s1 grounded even without the source ✓. I'll go with (a) — cleaner (the stopword list already contains modals; 'need' fits).

But careful — does adding 'need' weaken the planted lie? S3 "The chalice needs 7 fragments..." → still dropped via chalice/7/etc. ✓.

Also re-verify the S2 s2 "Insert them into the socket above the anvil." with the stopword 'need'? Irrelevant ✓.

Verify S1 s2: "The shards are found in the Molten Keep, and Pyreth the Ashen guards its entrance." → are(stop) found✓(P2 "found") in(stop) the(stop) molten✓ keep✓ pyreth✓ ashen✓ guards✓(P2) its(stop) entrance✓(P2) → ✓.

s3: "Insert the shards into the socket above the anvil." → insert✓(P1 inserted) socket✓ above✓ anvil✓ → ✓.

faithful 3/3 = 1 ✓.

Now let me check all my guide-spec test replies against the final stopword list — test 1 reply s1 "You need 4 ember shards to light the Beacon Forge." ✓ (need stop). s2 "You must also obtain the Obsidian Chalice from the Frozen Spire." → must(stop) also(stop) obtain✗... dropped ✓.

Test "refuses when nothing is grounded": 'The Beacon Forge is a myth and the shards never existed.' → beacon✓ forge✓ is(stop) a(stop) myth✗ → dropped ✓ → refused ✓.

### Spoken number test: 'You need five ember shards to light the Beacon Forge.' → need stop; five → number 5 ∉ {4} → missing ['five'] ✓; others ✓ → grounded false, missing exactly ['five'] ✓.

### Guide test 3 (service quantity): Q 'How many ember shards does the Beacon Forge need?' — the question's number: none (no digits... "how many" no number) ✓ source {4} → 5 missing ✓.

### One more consideration: `assessAnswer` joins the sources — the page boundaries are irrelevant ✓.

### Vitest ESM + decorators: esbuild needs `experimentalDecorators` from tsconfig ✓ set. Does esbuild also respect `emitDecoratorMetadata`? Not needed for the tests (no Nest DI boot). ✓

### Importing 'reflect-metadata' in the specs — needed because @Injectable() calls Reflect.defineMetadata at class-definition time (when the module is imported). Node 20: Reflect.defineMetadata undefined without the polyfill → the service import throws. So specs import 'reflect-metadata' first ✓. main.ts too ✓.

Hmm — does @nestjs/common's @Injectable actually call Reflect.defineMetadata? Nest 10:
```ts
export function Injectable(options?: InjectableOptions): ClassDecorator {
  return (target: Function) => {
    Reflect.defineMetadata(INJECTABLE_WATERMARK, true, target);
    ...
  };
}
```
Yes → the polyfill is required. ✓ planned.

Alternatively, skip the @Injectable decorator on GuideService (plain class) → no need for reflect-metadata in tests... but the convention Nest style + module providers expect it. Keep the decorator + the polyfill import. Safe.

### Does the controller need @Injectable? No.

### tsconfig "types": ["node"] — @types/node devDep ✓.

### package.json — add "packageManager": "pnpm@9.0.0"? Optional; I'll add for convention (pnpm). Fine.

### Also — a vitest.config.ts? Default include covers test/*.spec.ts ✓. No config file needed. Skip (fewer files). Hmm — vitest's default include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'] with node_modules excluded ✓.

### Double-check the `EvalHarness` import cycle: eval-harness imports GuideService (guide) + LlmClient/buildPrompt (guide) + judges (eval) + scenario types (eval). judges imports grounding + REFUSAL (llm.client) + scenario type (golden-scenarios) — golden-scenarios imports REFUSAL from llm.client (for the llmReply of the refusal scenario). No cycles ✓.

### Let me write the scenario descriptions in English ✓.

### Final check on the controller envelope shape: `new BadRequestException({ error: { code, message, details } })` → response body `{ error: {...} }` ✓ status 400 ✓. details is an object (never null) ✓ e.g. `{ field: 'sources' }`.

Codes: 'invalid_input'. snake_case ✓.

### File: test names follow `test/<feature>.spec.ts` → `test/guide.spec.ts`, `test/eval.spec.ts` ✓ matches the convention.

### Feature folder name: "guide" (repo is guide-assistant). Files: guide/llm.client.ts, guide/grounding.ts, guide/redaction.ts, guide/guide.service.ts, guide/guide.controller.ts, guide/guide.module.ts. Eval: eval/golden-scenarios.ts, eval/judges.ts, eval/eval-harness.ts. "eval" is fine as a folder name.

Hmm — kebab-case.file.role.ts convention: "guide.service.ts" ✓, "llm.client.ts" ✓ (multi-word is kebab ✓), "golden-scenarios.ts" ✓.

### Let me now write out the actual final code for each file.

**package.json**
```json
{
  "name": "guide-assistant",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.5.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.9",
    "@nestjs/core": "^10.3.9",
    "@nestjs/platform-express": "^10.3.9",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.5.3",
    "vitest": "^1.6.0"
  }
}
```

**tsconfig.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```
(noUncheckedIndexedAccess — strict only; I'll leave it at the strict default. My code does indexed access like ts[j].text — fine without noUncheckedIndexedAccess.)

Wait — `STOPPER_CAPS` build: `[...STOPWORDS]` — STOPWORDS is ReadonlySet<string> ✓ spreadable.

**src/main.ts** — as above.

**src/app.module.ts** — with the ASSUMPTION comment.

**src/guide/llm.client.ts**

```ts
/**
 * The LLM client is the only seam to the model. Production would inject a
 * provider-backed client; tests and the eval harness inject the scripted fake.
 */

export const REFUSAL = 'not covered by my sources';

export interface LlmReply {
  /** Case-insensitive substring of the prompt that routes to this reply. */
  when: string;
  reply: string;
}

export interface LlmScript {
  replies: LlmReply[];
  /** Returned when no reply matches. Defaults to '' which the gate turns into a refusal. */
  fallback?: string;
}

export abstract class LlmClient {
  abstract complete(prompt: string): Promise<string>;
}

// ASSUMPTION: no live model provider is reachable in this environment, so the
// module default is the scripted client with an empty reply (the grounding
// gate then refuses). A real client is injected where the API is deployed.
export class ScriptedLlmClient implements LlmClient {
  /** Every prompt received, in order. Lets tests prove how many LLM calls an answer cost. */
  readonly prompts: string[] = [];

  constructor(private readonly script: LlmScript = { replies: [] }) {}

  async complete(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    const haystack = prompt.toLowerCase();
    const hit = this.script.replies.find(r => haystack.includes(r.when.toLowerCase()));
    return hit ? hit.reply : (this.script.fallback ?? '');
  }
}

export function buildPrompt(question: string, sources: string[]): string {
  const pages = sources.map((page, i) => `--- page ${i + 1} ---\n${page}`).join('\n\n');
  return (
    `Answer the player's question using only the wiki pages below. ` +
    `If the pages do not contain the answer, reply exactly: ${REFUSAL}\n\n` +
    `Player question: ${question}\n\n` +
    `Wiki pages:\n${pages}`
  );
}
```

**src/guide/grounding.ts** — write in full:

```ts
/**
 * Sentence-level grounding gate.
 *
 * A sentence is grounded when every claim in it is supported by the fetched
 * wiki pages. Claims are lexical: each content word must occur in the source
 * text (light stemming), and each number must occur as the same value in the
 * source. Numbers the player already stated in the question are allowed,
 * because restating them is not a new claim.
 *
 * The check is intentionally strict and fail-closed: a paraphrase that the
 * pages do not literally support is treated as ungrounded, and the sentence
 * is dropped. Dropping (and eventually refusing) is the safe outcome.
 */

const STOPWORDS = new Set<string>([...]);

const SPOKEN_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20,
};

export function isStopword(word: string): boolean { return STOPWORDS.has(word); }

export function spokenNumberValue(word: string): number | null {
  const hit = SPOKEN_NUMBERS[word];
  return hit === undefined ? null : hit;
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ');
}

export function tokenize(text: string): string[] {
  return normalizeText(text).split(' ').filter(Boolean);
}

export function numberValues(text: string): number[] {
  const values = new Set<number>();
  for (const token of tokenize(text)) {
    if (/^\d+$/.test(token)) values.add(parseInt(token, 10));
    else { const v = SPOKEN_NUMBERS[token]; if (v !== undefined) values.add(v); }
  }
  return [...values];
}

export function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 3 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  if (word.length > 4 && word.endsWith('e')) return word.slice(0, -1);
  return word;
}

export function wordForms(word: string): string[] {
  return [word, stem(word)];
}

export function buildKeyset(text: string): Set<string> {
  const set = new Set<string>();
  for (const token of tokenize(text)) {
    set.add(token);
    set.add(stem(token));
  }
  return set;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 0);
}

export interface SentenceVerdict { text: string; grounded: boolean; missing: string[]; }
export interface AnswerAssessment { sentences: SentenceVerdict[]; groundedCount: number; }

export function assessSentence(
  sentence: string,
  sourceKeyset: ReadonlySet<string>,
  sourceNumbers: ReadonlySet<number>,
  questionNumbers: ReadonlySet<number>,
): SentenceVerdict {
  const missing: string[] = [];
  for (const token of tokenize(sentence)) {
    if (isStopword(token)) continue;
    if (/^\d+$/.test(token)) {
      const value = parseInt(token, 10);
      if (!sourceNumbers.has(value) && !questionNumbers.has(value)) missing.push(token);
    } else {
      const spoken = spokenNumberValue(token);
      if (spoken !== null) {
        if (!sourceNumbers.has(spoken) && !questionNumbers.has(spoken)) missing.push(token);
      } else {
        const supported = wordForms(token).some(form => sourceKeyset.has(form) || ...);
```
Wait — I decided words are source-only (no question keyset). `wordForms(token).some(form => sourceKeyset.has(form))`. ✓
```ts
        if (!supported) missing.push(token);
      }
    }
  }
  return { text: sentence, grounded: missing.length === 0, missing };
}

export function assessAnswer(answer: string, sources: string[], question: string): AnswerAssessment {
  const sourceKeyset = buildKeyset(sources.join(' \n '));
  const sourceNumbers = new Set<number>(numberValues(sources.join(' ')));
  const questionNumbers = new Set<number>(numberValues(question));
  const sentences = splitSentences(answer).map(sentence =>
    assessSentence(sentence, sourceKeyset, sourceNumbers, questionNumbers),
  );
  return { sentences, groundedCount: sentences.filter(s => s.grounded).length };
}
```

Final STOPWORDS list (I'll write it out):
'a','an','the','and','or','but','if','then','else','of','to','in','on','at','by','for','with','without','from','into','onto','over','under','above','below','behind','before','after','near','through','during','while','is','am','are','was','were','be','been','being','do','does','did','have','has','had','will','would','can','could','should','shall','may','might','must','need','needs','want','wants','you','your','yours','my','mine','i','we','they','he','she','it','its','our','ours','us','them','him','her','his','this','that','these','those','here','there','where','when','how','what','which','who','whom','whose','not','no','so','as','just','also','only','too','very','all','any','each','every','more','most','some','such','than','up','out','off','down','again','further','once','because','until','against','between','among','about','let'

Wait 'needs' — stemming: the token "needs" — isStopword checks the raw token: 'needs' in the list ✓ I added it. "wants" ✓ added. OK.

Hmm 'let' — keep? "let's" → normalize "let s"? "'t"? "let's" → lowercase, strip ' → "lets" → tokens "lets". Is 'lets' a stopword? Not in the list → a content word. The fake won't use it. Drop 'let' from the list? Harmless either way; I'll drop.

**src/guide/redaction.ts**

```ts
/**
 * Hint mode is a redaction of the grounded answer, never a second generation.
 *
 * Rules (all fail-closed, i.e. over-redact rather than leak):
 * 1. Proper-noun runs (boss names, entity names) -> [name]
 * 2. Location nouns (with up to 2 preceding modifiers) -> [location]
 * 3. Quantities the player did not already mention (digits and spoken 1-20) -> [quantity]
 */

import { STOPWORDS? no — import { isStopword, numberValues, spokenNumberValue } from './grounding';
```
I need STOPWORDS directly for the STOPPER_CAPS derivation → export STOPWORDS? I'll export `STOPWORDS` as a ReadonlySet from grounding and use it. Let me export it.

```ts
import { STOPWORDS, numberValues, spokenNumberValue } from './grounding';

const EMBEDDED_RUN_WORDS = new Set(['the', 'of', 'de', 'la', 'le', 'du', 'van', 'von']);
const STOPPER_CAPS = new Set<string>([...STOPWORDS].map(w => w.charAt(0).toUpperCase() + w.slice(1)));
const LOCATION_NOUNS = new Set(['keep','vault','cavern','cathedral','dungeon','ruins','tower','sanctum','forge','chasm','grotto','hollow','chapel','crypt','labyrinth','temple','shrine','altar','citadel','bunker','cellar','attic','courtyard','passage']);

interface Span { start: number; end: number; }

function tokens(text: string): Array<{ index: number; text: string }> {
  return [...text.matchAll(/\S+/g)].map(m => ({ index: m.index ?? 0, text: m[0] }));
}

function coreOf(token: string): string {
  return token.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z]+$/, '');
}

function punctOf(token: string): string {
  const m = token.match(/([,.!?;:]+)$/);
  return m ? m[1] : '';
}

function isTitleToken(token: string): boolean {
  return /^[A-Z][a-z'’-]*$/.test(coreOf(token));
}

function isSentenceStart(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n') continue;
    return c === '.' || c === '!' || c === '?' || c === '“';
  }
  return true;
}
```
Hmm, a trailing punct on a title token: coreOf("Keep,") = "Keep" → isTitleToken ✓. A stopper cap check: coreOf("The,") → "The" → cap form "The" ∈ STOPPER_CAPS ✓.

redactEntityRuns:
```ts
function redactEntityRuns(text: string): string {
  const ts = tokens(text);
  let out = '';
  let cursor = 0;
  for (let i = 0; i < ts.length; i++) {
    const token = ts[i];
    if (!isTitleToken(token.text)) continue;
    const capCore = coreOf(token.text);
    if (isSentenceStart(text, token.index) && STOPPER_CAPS.has(capCore)) continue;
    let j = i;
    while (j + 1 < ts.length) {
      const next = ts[j + 1].text;
      if (isTitleToken(next)) { j++; continue; }
      if (EMBEDDED_RUN_WORDS.has(coreOf(next).toLowerCase())) { j++; continue; }
      break;
    }
    const last = ts[j];
    out += text.slice(cursor, token.index) + '[name]' + punctOf(last.text);
    cursor = last.index + last.text.length;
    i = j;
  }
  return out + text.slice(cursor);
}
```
Wait — capCore is already capitalized? coreOf("the")... title tokens start uppercase, so capCore is already "The". ✓ STOPPER_CAPS.has(capCore).

Hmm — one problem: a title token with a leading digit? "9" isn't a title ✓.

redactLocations:
```ts
function redactLocations(text: string): string {
  const ts = tokens(text);
  const spans: Span[] = [];
  for (let i = 0; i < ts.length; i++) {
    const core = coreOf(ts[i].text).toLowerCase();
    if (!LOCATION_NOUNS.has(core)) continue;
    let left = i;
    let taken = 0;
    for (let k = i - 1; k >= 0 && taken < 2; k--) {
      const prevCore = coreOf(ts[k].text);
      if (isStopword(prevCore.toLowerCase()) || isTitleToken(ts[k].text)) break;
      left = k;
      taken++;
    }
    spans.push({ start: ts[left].index, end: ts[i].index + ts[i].text.length });
  }
  spans.sort((a, b) => b.start - a.start);
  let out = '';
  let cursor = 0;
  let nextMin = Infinity;
  for (const span of spans) {
    if (span.end > nextMin) continue; // overlaps a span already kept
    nextMin = span.start;
    out += text.slice(cursor, span.start) + '[location]' + punctOf(text.slice(span.start, span.end));
    cursor = span.end;
  }
  return out + text.slice(cursor);
}
```
punctOf on the slice "lower vault," → trailing ',' ✓. isStopword is imported from grounding ✓.

Wait — the punctOf of the slice: the span ends at the end of the noun token, including its trailing punct → the slice ends with that punct ✓.

redactQuantities:
```ts
function redactQuantities(text: string, allowed: ReadonlySet<number>): string {
  const withDigits = text.replace(/\d+/g, match => (allowed.has(Number(match)) ? match : '[quantity]'));
  const ts = tokens(withDigits);
  let out = '';
  let cursor = 0;
  for (const token of ts) {
    const value = spokenNumberValue(coreOf(token.text).toLowerCase());
    if (value !== null && !allowed.has(value)) {
      out += withDigits.slice(cursor, token.index) + '[quantity]' + punctOf(token.text);
      cursor = token.index + token.text.length;
    }
  }
  return out + withDigits.slice(cursor);
}
```

Main:
```ts
export function redactForHint(answer: string, question: string): string {
  const allowed = new Set<number>(numberValues(question));
  let out = redactEntityRuns(answer);
  out = redactLocations(out);
  out = redactQuantities(out, allowed);
  return out.replace(/ {2,}/g, ' ').trim();
}
```

Trace the unit test again with this exact code:
Text: 'Pyreth the Ashen guards the Molten Keep behind the altar, and you need 9 ember shards to enter.'
Tokens: Pyreth(0) the(7) Ashen(11) guards(17) the(24) Molten(28) Keep(35) behind(40) the(47) altar,(51) and(58) you(62) need(66) 9(71) ember(73) shards(79) to(86) enter.(92)
Run pass:
- i0 Pyreth title, sentence-start, not a stopper → run: next "the" lowercase, core "the" ∈ EMBEDDED → j=1; next "Ashen" title → j=2; next "guards" lowercase non-embedded → stop. last=ts[2]="Ashen" no punct. out = '' + text.slice(0,0) + '[name]' + '' = '[name]'; cursor=17; i=2 → loop i=3.
- i3 "guards" not title skip. i4 "the" not title. i5 "Molten" title; sentenceStart? the char before index 28: " " then "the" → the last non-space is 'e' → not sentence-start ✓ not skipped. Run: next "Keep" title → j=6; next "behind" lowercase non-embedded → stop. last "Keep" punct '' → out += text.slice(17,28) + '[name]' = " guards the " wait text.slice(17,28): indices 17..28 = " guards the " (17=' ' 18-23='guards' 24=' ' 25-27='the' 28? index 28 is 'M'). So slice(17,28) = " guards the " ✓ + '[name]'. cursor = 35+4=39. i=6 → i=7.
- i7 "behind" no. i8 "the" no. i9 "altar," core "altar" not title (lowercase) skip. ...
Result after run pass: "[name] guards the [name] behind the altar, and you need 9 ember shards to enter."
Wait — "Pyreth the Ashen" was replaced with "[name]" — the embedded "the" was consumed ✓ ("guards the [name]"? Let me re-read: original "Pyreth the Ashen guards the Molten Keep behind..." → "[name]" + " guards the " + "[name]" + " behind..." = "[name] guards the [name] behind the altar, and you need 9 ember shards to enter." ✓
Location pass: tokens include "altar," core "altar" ∈ LOCATION_NOUNS ✓. Leftward: k at "the" (before altar) → isStopword('the') → break. Span "altar," start..end includes the comma → replace with '[location],' ✓ → "[name] guards the [name] behind [location], and you need 9 ember shards to enter."
Number pass: "9" → not allowed → "[quantity]" → "[name] guards the [name] behind [location], and you need [quantity] ember shards to enter."
✓ matches my earlier expectation. No double spaces (the span replaced exactly). ✓

Test the "The" sentence-initial stopper: "The Beacon Forge lights when..." → "The" title, sentence-start, ∈ STOPPER_CAPS ('the'→'The') → skip ✓; "Beacon Forge" run ✓.

**guide.service.ts**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { assessAnswer } from './grounding';
import { buildPrompt, LlmClient, REFUSAL } from './llm.client';
import { redactForHint } from './redaction';

export type GuideMode = 'full' | 'hint';

export interface GuideAnswerInput {
  question: string;
  sources: string[];
  mode: GuideMode;
}

export interface GuideResult {
  /** The grounded answer, the refusal phrase, or (in hint mode) the redaction of either. */
  answer: string;
  refused: boolean;
  mode: GuideMode;
  totalSentences: number;
  droppedSentences: number;
}

/**
 * The production path: one LLM call, then a sentence-level grounding gate.
 * Ungrounded sentences are dropped; if none survive the service refuses.
 * Hint mode never re-prompts — it redacts the answer that passed the gate.
 */
@Injectable()
export class GuideService {
  constructor(@Inject(LlmClient) private readonly llm: LlmClient) {}

  async answer(input: GuideAnswerInput): Promise<GuideResult> {
    const raw = await this.llm.complete(buildPrompt(input.question, input.sources));
    const assessment = assessAnswer(raw, input.sources, input.question);
    const kept = assessment.sentences.filter(s => s.grounded).map(s => s.text);
    const refused = kept.length === 0;
    let answer = refused ? REFUSAL : kept.join(' ');
    if (input.mode === 'hint') answer = redactForHint(answer, input.question);
    return {
      answer,
      refused,
      mode: input.mode,
      totalSentences: assessment.sentences.length,
      droppedSentences: assessment.totalSentences - kept.length,
    };
  }
}
```
`assessment.totalSentences` — I named it `sentences.length`; I defined AnswerAssessment { sentences; groundedCount } → dropped = sentences.length - kept.length ✓.

`@Inject(LlmClient)` + `private readonly llm: LlmClient` — parameter property + decorator: fine.

**guide.controller.ts**

```ts
import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { GuideService } from './guide.service';
import type { GuideAnswerInput, GuideResult, GuideMode } from './guide.service';

interface InputProblem {
  code: 'invalid_input';
  message: string;
  details: Record<string, unknown>;
}

function validateAnswerBody(body: unknown): InputProblem | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { code: 'invalid_input', message: 'The request body must be a JSON object.', details: { field: 'body' } };
  }
  const { question, sources, mode } = body as Record<string, unknown>;
  if (typeof question !== 'string' || question.trim().length === 0) {
    return { code: 'invalid_input', message: 'question must be a non-empty string.', details: { field: 'question' } };
  }
  if (!Array.isArray(sources) || sources.length === 0 || sources.length > 3 || sources.some(s => typeof s !== 'string' || s.trim().length === 0)) {
    return { code: 'invalid_input', message: 'sources must be an array of 1 to 3 non-empty page strings.', details: { field: 'sources' } };
  }
  if (mode !== undefined && mode !== 'full' && mode !== 'hint') {
    return { code: 'invalid_input', message: "mode must be 'full' or 'hint'.", details: { field: 'mode' } };
  }
  return null;
}

@Controller('guide')
export class GuideController {
  constructor(private readonly guideService: GuideService) {}

  @Post('answers')
  createAnswer(@Body() body: unknown): Promise<GuideResult> {
    const problem = validateAnswerBody(body);
    if (problem) {
      throw new BadRequestException({ error: problem });
    }
    const input = body as { question: string; sources: string[]; mode?: GuideMode };
    return this.guideService.answer({
      question: input.question.trim(),
      sources: input.sources,
      mode: input.mode ?? 'full',
    } satisfies GuideAnswerInput);
  }
}
```
`satisfies` — TS 4.9+ ✓ TS 5.5 ✓.

**guide.module.ts**
```ts
import { Module } from '@nestjs/common';
import { GuideController } from './guide.controller';
import { LlmClient, ScriptedLlmClient } from './llm.client';
import { GuideService } from './guide.service';

@Module({
  controllers: [GuideController],
  providers: [GuideService, { provide: LlmClient, useClass: ScriptedLlmClient }],
  exports: [GuideService],
})
export class GuideModule {}
```

**eval/golden-scenarios.ts**

```ts
import { REFUSAL } from '../guide/llm.client';

export interface GoldenScenario {
  id: string;
  description: string;
  question: string;
  /** Fetched wiki pages the answer must be grounded in. */
  sources: string[];
  /** Facts a correct answer should contain (lexical, lowercase phrases). */
  expectedFacts: readonly string[];
  /** Planted false facts: these must never appear in a good answer. */
  falseFacts: readonly string[];
  /** True when the sources do not contain the answer and refusal is correct. */
  expectsRefusal: boolean;
  /** What the scripted fake LLM returns for this scenario. */
  llmReply: string;
  /** Case-insensitive substring of the prompt that routes the fake to llmReply. */
  matchWhen: string;
}

export const FORGE_PAGE_SOCKET = 'The Beacon Forge lights when 4 ember shards are inserted into the socket above the anvil.';
export const FORGE_PAGE_KEEP = 'Ember shards are found in the Molten Keep. Pyreth the Ashen guards the entrance to the Molten Keep.';
export const FORGE_PAGE_COUNT = 'The forge socket accepts exactly 4 shards. Fewer than 4 leaves the forge dark.';

export const GOLDEN_SCENARIOS: readonly GoldenScenario[] = [
  {
    id: 'grounded-correct',
    description: 'The model answers truthfully from the pages; both judges should score it high.',
    question: 'How do I light the Beacon Forge, and where do I find the shards?',
    sources: [FORGE_PAGE_SOCKET, FORGE_PAGE_KEEP],
    expectedFacts: ['4 ember shards', 'light the beacon forge', 'shards are found in the molten keep', 'pyreth the ashen guards the entrance'],
    falseFacts: ['requires the obsidian chalice', '5 ember shards', 'shards are found in the frozen spire'],
    expectsRefusal: false,
    matchWhen: 'where do i find the shards',
    llmReply:
      'You need 4 ember shards to light the Beacon Forge. The shards are found in the Molten Keep, and Pyreth the Ashen guards its entrance. Insert the shards into the socket above the anvil.',
  },
  {
    id: 'wrong-quantity',
    description: 'The model states 5 shards where the pages say 4; the gate and the faithfulness judge must catch it exactly.',
    question: 'How many ember shards does the Beacon Forge need?',
    sources: [FORGE_PAGE_SOCKET, FORGE_PAGE_COUNT],
    expectedFacts: ['4 ember shards'],
    falseFacts: ['5 ember shards'],
    expectsRefusal: false,
    matchWhen: 'how many ember shards',
    llmReply: 'You need 5 ember shards to light the Beacon Forge. Insert them into the socket above the anvil.',
  },
  {
    id: 'invented-item-requirement',
    description: 'A confident fluent lie about an item that does not exist in the pages; must score low and the pipeline must refuse.',
    question: 'What do I need to light the Beacon Forge?',
    sources: [FORGE_PAGE_SOCKET, FORGE_PAGE_KEEP],
    expectedFacts: ['4 ember shards'],
    falseFacts: ['requires the obsidian chalice', '7 fragments of cold iron'],
    expectsRefusal: false,
    matchWhen: 'what do i need to light',
    llmReply:
      'You must gather the Obsidian Chalice and pour it into the Beacon Forge. The chalice needs 7 fragments of cold iron to work.',
  },
  {
    id: 'answer-not-in-sources',
    description: 'The fetched pages contain no answer at all; refusal is the correct output and must score high.',
    question: 'What does the lighthouse keeper collect in winter?',
    sources: [FORGE_PAGE_SOCKET, FORGE_PAGE_KEEP],
    expectedFacts: [],
    falseFacts: ['the keeper collects 12 lanterns'],
    expectsRefusal: true,
    matchWhen: 'lighthouse keeper',
    llmReply: REFUSAL,
  },
];
```
Verify S2's falseFact "5 ember shards" — the raw reply contains "5" and "shards" → covered → helpful 0 ✓.
S3's falseFact "7 fragments of cold iron" → 7 ✓ fragments ✓ cold ✓ iron ✓ → covered ✓ (already 0).

Hmm wait — S3's expectedFacts '4 ember shards': raw has "shards"? no! S3's reply has no "shards" — "fragments". → coverage 0 ✓ helpful 0 ✓.

Verify S3's faithful: s1: "You must gather the Obsidian Chalice and pour it into the Beacon Forge." tokens: must(stop) gather✗ obsidian✗ chalice✗ pour✗ beacon✓ forge✓ → ungrounded ✓. s2: "The chalice needs 7 fragments of cold iron to work." → chalice✗ needs(stop) 7✗ fragments✗ cold✗ iron✗ work✗ → ungrounded ✓. faithful 0/2 = 0 ✓.

Verify S2's raw faithful: s1 "You need 5 ember shards to light the Beacon Forge." → need(stop) 5✗ → ungrounded. s2 "Insert them into the socket above the anvil." → insert✓ (P1 inserted; P2? P2 = FORGE_PAGE_COUNT "The forge socket accepts exactly 4 shards. Fewer than 4 leaves the forge dark." — source keyset: forge, socket, accepts, exactly, shards, fewer, leaves, dark + stems; "insert" — from P1 FORGE_PAGE_SOCKET "inserted"→stem "insert" ✓ (S2 sources = [SOCKET, COUNT] ✓). socket✓ above✓ anvil✓ → grounded ✓. faithful = 1/2 = 0.5 ✓ exactly.

S2 helpful: expected '4 ember shards' → '4' ∉ raw (raw has 5) → uncovered → 0 ✓. → score 0 ✓.

S1: verified faithful 1, helpful 1 ✓.

S4: raw = REFUSAL → faithful 1, helpful 1 ✓.

**eval/judges.ts**

```ts
import { assessAnswer, buildKeyset, isStopword, numberValues, spokenNumberValue, tokenize, wordForms } from '../guide/grounding';
import { REFUSAL } from '../guide/llm.client';
import type { GoldenScenario } from './golden-scenarios';

/** True when the text is the refusal (or empty): it asserts nothing. */
export function isRefusal(answer: string): boolean {
  const normalized = answer.trim().toLowerCase().replace(/[.!?\s]+$/, '');
  return normalized === '' || normalized === REFUSAL;
}
```
REFUSAL is already lowercase without punctuation ✓ ('not covered by my sources').

```ts
/**
 * Faithfulness: what fraction of the answer's sentences is supported by the
 * source pages? A refusal asserts nothing, so it is maximally faithful.
 * The judge receives the sources on purpose — without them it would be
 * scoring fluency, which is exactly what a hallucination has most of.
 */
export function judgeFaithfulness(answer: string, sources: string[], question = ''): number {
  if (isRefusal(answer)) return 1;
  const assessment = assessAnswer(answer, sources, question);
  if (assessment.sentences.length === 0) return 1;
  return assessment.groundedCount / assessment.sentences.length;
}

function factIsCovered(answer: string, fact: string): boolean {
  const keyset = buildKeyset(answer);
  const numbers = new Set<number>(numberValues(answer));
  for (const token of tokenize(fact)) {
    if (isStopword(token)) continue;
    if (/^\d+$/.test(token)) {
      if (!numbers.has(parseInt(token, 10))) return false;
      continue;
    }
    const spoken = spokenNumberValue(token);
    if (spoken !== null) {
      if (!numbers.has(spoken)) return false;
      continue;
    }
    if (!wordForms(token).some(form => keyset.has(form))) return false;
  }
  return true;
}

/**
 * Helpfulness: did the answer actually serve the question?
 * A refusal is helpful only when the sources do not contain the answer.
 * Any planted false fact appearing in the answer zeroes the score.
 */
export function judgeHelpfulness(answer: string, scenario: GoldenScenario): number {
  if (isRefusal(answer)) return scenario.expectsRefusal ? 1 : 0;
  if (scenario.expectsRefusal) return 0;
  if (scenario.falseFacts.some(fact => factIsCovered(answer, fact))) return 0;
  if (scenario.expectedFacts.length === 0) return 1;
  return scenario.expectedFacts.filter(fact => factIsCovered(answer, fact)).length / scenario.expectedFacts.length;
}
```

**eval/eval-harness.ts**

```ts
import { buildPrompt } from '../guide/llm.client';
import type { LlmClient } from '../guide/llm.client';
import { GuideService } from '../guide/guide.service';
import { judgeFaithfulness, judgeHelpfulness } from './judges';
import type { GoldenScenario } from './golden-scenarios';

export interface EvalRun {
  scenarioId: string;
  /** The model's raw generation, which the judges score. */
  rawReply: string;
  /** What the production path (gate + mode) would actually ship. */
  systemAnswer: string;
  systemRefused: boolean;
  helpful: number;
  faithful: number;
  /** Final score: min(helpful, faithful) — a fluent lie or a useless refusal cannot hide behind the other. */
  score: number;
}

export interface EvalReport {
  runs: EvalRun[];
  /** Mean of the scenario scores. */
  overall: number;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

export class EvalHarness {
  constructor(
    private readonly service: GuideService,
    private readonly llm: LlmClient,
  ) {}

  async run(scenarios: readonly GoldenScenario[]): Promise<EvalReport> {
    const runs: EvalRun[] = [];
    for (const scenario of scenarios) {
      const rawReply = await this.llm.complete(buildPrompt(scenario.question, scenario.sources));
      const system = await this.service.answer({
        question: scenario.question,
        sources: scenario.sources,
        mode: 'full',
      });
      const helpful = judgeHelpfulness(rawReply, scenario);
      const faithful = judgeFaithfulness(rawReply, scenario.sources, scenario.question);
      runs.push({
        scenarioId: scenario.id,
        rawReply,
        systemAnswer: system.answer,
        systemRefused: system.refused,
        helpful: round(helpful),
        faithful: round(faithful),
        score: round(Math.min(helpful, faithful)),
      });
    }
    const overall = runs.length === 0 ? 0 : runs.reduce((sum, run) => sum + run.score, 0) / runs.length;
    return { runs, overall: round(overall) };
  }
}
```

**test/guide.spec.ts** — write in full:

```ts
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { assessAnswer } from '../src/guide/grounding';
import { GuideService } from '../src/guide/guide.service';
import { REFUSAL, ScriptedLlmClient } from '../src/guide/llm.client';
import { redactForHint } from '../src/guide/redaction';
import { FORGE_PAGE_KEEP, FORGE_PAGE_SOCKET } from '../src/eval/golden-scenarios';

const SOURCES = [FORGE_PAGE_SOCKET, FORGE_PAGE_KEEP];

function serviceWith(reply: string): { service: GuideService; client: ScriptedLlmClient } {
  const client = new ScriptedLlmClient({ replies: [{ when: 'forge', reply }] });
  return { service: new GuideService(client), client };
}
```
Hmm 'when: forge' — the prompt contains "Beacon Forge" ✓ lowercase 'forge' ✓.

```ts
describe('GuideService.answer (full mode)', () => {
  it('keeps grounded sentences and drops ungrounded ones', async () => {
    const { service } = serviceWith(
      'You need 4 ember shards to light the Beacon Forge. You must also obtain the Obsidian Chalice from the Frozen Spire.',
    );
    const result = await service.answer({ question: 'How do I light the Beacon Forge?', sources: SOURCES, mode: 'full' });
    expect(result.refused).toBe(false);
    expect(result.totalSentences).toBe(2);
    expect(result.droppedSentences).toBe(1);
    expect(result.answer).toBe('You need 4 ember shards to light the Beacon Forge.');
    expect(result.answer).not.toMatch(/obsidian|chalice|frozen|spire/i);
  });

  it('refuses with the standard phrase when no sentence is grounded', async () => {
    const { service } = serviceWith('The Beacon Forge is a myth and the shards never existed.');
    const result = await service.answer({ question: 'How do I light the Beacon Forge?', sources: SOURCES, mode: 'full' });
    expect(result.refused).toBe(true);
    expect(result.answer).toBe(REFUSAL);
  });

  it('catches a quantity error exactly: "5 shards" against sources saying 4', async () => {
    const reply = 'You need 5 ember shards to light the Beacon Forge. Insert them into the socket above the anvil.';
    const assessment = assessAnswer(reply, SOURCES, 'How many ember shards does the Beacon Forge need?');
    expect(assessment.sentences).toHaveLength(2);
    expect(assessment.sentences[0].grounded).toBe(false);
    expect(assessment.sentences[0].missing).toEqual(['5']);
    expect(assessment.sentences[1].grounded).toBe(true);

    const { service } = serviceWith(reply);
    const result = await service.answer({ question: 'How many ember shards does the Beacon Forge need?', sources: SOURCES, mode: 'full' });
    expect(result.droppedSentences).toBe(1);
    expect(result.answer).not.toContain('5');
    expect(result.answer).toBe('Insert them into the socket above the anvil.');
  });

  it('catches a spoken quantity error the same way', async () => {
    const assessment = assessAnswer('You need five ember shards to light the Beacon Forge.', SOURCES, 'How many shards do I need?');
    expect(assessment.sentences[0].grounded).toBe(false);
    expect(assessment.sentences[0].missing).toContain('five');
  });

  it('accepts a number the player already mentioned in the question', async () => {
    const assessment = assessAnswer('You already have 2 shards.', SOURCES, 'I have 2 shards. How many more do I need?');
    expect(assessment.sentences[0].grounded).toBe(true);
  });
```
Wait — "You already have 2 shards." tokens: already✗!! "already" isn't a stopword and isn't in the source → missing → ungrounded! Damn. Fix: add 'already','still','now','yes','okay'? 'already' — a discourse adverb, add to STOPWORDS. Add 'already', 'still', 'now', 'then'(already), 'yes'. Also 'always'/'never'? "never" is a claim-ish word ("the shards never existed" — "never" in my refusal test... wait that test's reply is dropped via "myth" anyway; but if "never" is a content word and absent from source → extra missing, fine). Keep the list: add 'already','still','now','yes','yeah','okay'. Hmm 'yeah','okay' unnecessary; add 'already','still','now','yes'.

Re-verify the test reply: "You already have 2 shards." → you(stop) already(stop) have(stop) 2 ∈ questionNumbers {2} ✓ shards✓ → grounded ✓.

  it('hint mode redacts the grounded answer without a second LLM call', async () => {
    const reply = 'You need 4 ember shards to light the Beacon Forge. The shards are found in the Molten Keep, and Pyreth the Ashen guards its entrance.';
    const client = new ScriptedLlmClient({ replies: [{ when: 'forge', reply }] });
    const service = new GuideService(client);
    const input = { question: 'How do I light the Beacon Forge, and where do I find the shards?', sources: SOURCES };
    const full = await service.answer({ ...input, mode: 'full' });
    const hint = await service.answer({ ...input, mode: 'hint' });

    expect(client.prompts).toHaveLength(2); // exactly one LLM call per answer() — hint did not re-prompt
    expect(full.refused).toBe(false);
    expect(hint.refused).toBe(false);
    expect(hint.answer).toBe(redactForHint(full.answer, input.question));
    expect(hint.answer).not.toMatch(/pyreth|ashen|molten|keep|forge|beacon|\b4\b/i);
    expect(hint.answer).toContain('[name]');
    expect(hint.answer).toContain('[quantity]');
  });
```
Verify: full.answer = 'You need 4 ember shards to light the Beacon Forge. The shards are found in the Molten Keep, and Pyreth the Ashen guards its entrance.'
Both sentences grounded? s1 ✓ (verified), s2 ✓.
hint = redact(full.answer, q):
- runs: "Beacon Forge" → [name]; "Molten Keep" → [name]; "Pyreth the Ashen" → [name]. "The" sentence-initial stopper kept.
- locations: "forge" gone; none.
- quantities: "4" ∉ q numbers → [quantity].
hint.answer = 'You need [quantity] ember shards to light [name]. The [name], and [name] guards its entrance.'
Regex /forge|beacon/ — absent ✓. /\b4\b/ absent ✓. contains [name] ✓ [quantity] ✓.
And redactForHint(full.answer, q) is by construction equal to hint.answer ✓ (deterministic).
prompts length: 2 calls (full + hint) → each 1 call ✓. To assert "no second LLM call for hint," 2 total for 2 calls shows 1 each ✓.

  it('hint mode of a refusal is the refusal itself', async () => {
    const { service } = serviceWith('The forge is powered by a secret crystal that hums at dawn.');
    const result = await service.answer({ question: 'How do I light the Beacon Forge?', sources: SOURCES, mode: 'hint' });
    expect(result.refused).toBe(true);
    expect(result.answer).toBe(REFUSAL);
  });
```
Verify: "The forge is powered by a secret crystal that hums at dawn." → forge✓(source "forge") is stop a stop by stop that stop at stop → powered✗ secret✗ crystal✗ hums✗ dawn✗ → dropped ✓ → refused ✓ → redact(REFUSAL, q): REFUSAL has no title runs (all lowercase) ✓ no location nouns ✓ no numbers ✓ → unchanged ✓.
```
});

describe('redactForHint', () => {
  it('removes a boss name, a location, and an unmentioned quantity from one sentence', () => {
    const out = redactForHint(
      'Pyreth the Ashen guards the Molten Keep behind the altar, and you need 9 ember shards to enter.',
      'How do I get past the front gate?',
    );
    expect(out).not.toMatch(/pyreth|ashen|molten|keep|altar|\b9\b/i);
    expect(out).toContain('[name]');
    expect(out).toContain('[location]');
    expect(out).toContain('[quantity]');
    expect(out).toContain('ember shards');
  });

  it('keeps quantities the player already mentioned, in digits and words', () => {
    expect(redactForHint('You already have 2 shards and need 2 more.', 'I have 2 shards. How many more do I need?')).toBe('You already have 2 shards and need 2 more.');
    expect(redactForHint('You have two shards and need two more.', 'I have two shards. How many more do I need?')).toBe('You have two shards and need two more.');
  });
```
Verify the first: "You already have 2 shards and need 2 more." — no runs; no locations; numbers 2 ∈ q{2} kept; no double spaces; trim → identical ✓. 'more' fine.
Second: "two" spoken value 2 ∈ allowed → kept ✓ identical ✓.
Wait — redactForHint's trim: the input has no extra spaces → output identical ✓.
```
});
```

Wait — "need" in these redaction strings: 'need' — not relevant to redaction ✓.

Also re-verify the `expect(result.answer).toBe('You need 4 ember shards to light the Beacon Forge.')` test — the kept sentence retains the original casing/punctuation ✓ (the verdict's text = the original sentence text ✓).

**test/eval.spec.ts**

```ts
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { EvalHarness } from '../src/eval/eval-harness';
import { FORGE_PAGE_KEEP, FORGE_PAGE_SOCKET, GOLDEN_SCENARIOS } from '../src/eval/golden-scenarios';
import { judgeFaithfulness, judgeHelpfulness } from '../src/eval/judges';
import { GuideService } from '../src/guide/guide.service';
import { REFUSAL, ScriptedLlmClient } from '../src/guide/llm.client';

const SOURCES = [FORGE_PAGE_SOCKET, FORGE_PAGE_KEEP];

function makeHarness(): EvalHarness {
  const client = new ScriptedLlmClient({
    replies: GOLDEN_SCENARIOS.map(scenario => ({ when: scenario.matchWhen, reply: scenario.llmReply })),
    fallback: '',
  });
  return new EvalHarness(new GuideService(client), client);
}

async function runScenario(id: string) {
  const report = await makeHarness().run(GOLDEN_SCENARIOS);
  const run = report.runs.find(r => r.scenarioId === id);
  if (!run) throw new Error(`scenario ${id} missing from report`);
  return run;
}

describe('eval harness over golden scenarios', () => {
  it('scores a scripted confident lie low', async () => {
    const run = await runScenario('invented-item-requirement');
    expect(run.rawReply).toMatch(/obsidian chalice/i); // the lie really was planted and shipped to the judges
    expect(run.faithful).toBe(0);
    expect(run.helpful).toBe(0);
    expect(run.score).toBe(0);
    expect(run.systemRefused).toBe(true); // the gate refuses the lie on the production path
    expect(run.systemAnswer).toBe(REFUSAL);
  });

  it('scores a correct grounded answer high', async () => {
    const run = await runScenario('grounded-correct');
    expect(run.helpful).toBe(1);
    expect(run.faithful).toBe(1);
    expect(run.score).toBe(1);
  });

  it('scores refusal as correct when the sources lack the answer', async () => {
    const run = await runScenario('answer-not-in-sources');
    expect(run.rawReply).toBe(REFUSAL);
    expect(run.helpful).toBe(1);
    expect(run.faithful).toBe(1);
    expect(run.score).toBe(1);
  });

  it('catches a quantity error exactly: "5 shards" against sources saying 4', async () => {
    const run = await runScenario('wrong-quantity');
    expect(run.rawReply).toMatch(/5 ember shards/);
    expect(run.faithful).toBe(0.5); // exactly one of the two sentences is unsupported
    expect(run.helpful).toBe(0);
    expect(run.score).toBe(0);
    expect(run.systemAnswer).not.toContain('5'); // the gate dropped the wrong-quantity sentence
  });

  it('combines the judges as min(helpful, faithful)', async () => {
    const report = await makeHarness().run(GOLDEN_SCENARIOS);
    for (const run of report.runs) {
      expect(run.score).toBe(Math.min(run.helpful, run.faithful));
    }
    expect(report.runs).toHaveLength(GOLDEN_SCENARIOS.length);
    expect(report.overall).toBe(0.5); // (1 + 0 + 0 + 1) / 4
  });
});

describe('judges', () => {
  it('the faithfulness judge takes the sources and changes its verdict with them', () => {
    const answer = 'You need 4 ember shards to light the Beacon Forge.';
    expect(judgeFaithfulness(answer, SOURCES, 'how do I light the forge?')).toBe(1);
    expect(judgeFaithfulness(answer, ['The lighthouse keeper polishes the lanterns each dusk.'], 'how do I light the forge?')).toBe(0);
  });
```
Verify the second: source "The lighthouse keeper polishes the lanterns each dusk." keyset: lighthouse, keeper, polishes→polish, lanterns→lantern, each(stop? 'each' ∈ STOPWORDS ✓), dusk. numbers {}.
Answer tokens: you(stop) need(stop) 4 → ∉ {} → missing; ember✗; shards✗; to stop; light → "light" vs keyset {polish, dusk, lighthouse, keeper, lantern, polishes, lanterns, the, each} → ✗; the stop; beacon✗; forge✗ → 0/1 = 0 ✓.
First: SOURCES → 1.0 ✓ (verified).
```
  it('a confident useless refusal scores low on helpfulness, a correct refusal scores high', () => {
    const answered = GOLDEN_SCENARIOS.find(s => s.id === 'grounded-correct');
    const unanswerable = GOLDEN_SCENARIOS.find(s => s.id === 'answer-not-in-sources');
    if (!answered || !unanswerable) throw new Error('scenario fixture missing');
    expect(judgeHelpfulness(REFUSAL, answered)).toBe(0);
    expect(judgeHelpfulness(REFUSAL, unanswerable)).toBe(1);
  });

  it('a fluent lie that also states a planted false fact scores zero helpfulness', () => {
    const scenario = GOLDEN_SCENARIOS.find(s => s.id === 'grounded-correct');
    if (!scenario) throw new Error('scenario fixture missing');
    const fluentLie = 'You need 4 ember shards, plus the Obsidian Chalice, to light the Beacon Forge.';
    expect(judgeHelpfulness(fluentLie, scenario)).toBe(0);
    expect(judgeFaithfulness(fluentLie, SOURCES, 'how do I light the forge?')).toBe(0);
  });
```
Verify fluentLie helpful: not a refusal; expectsRefusal false; falseFact 'requires the obsidian chalice' → factIsCovered: tokens requires✗? "requires" — a stopword? no. In the answer? "plus" no "requires" → not covered! Hmm — the falseFact phrase "requires the obsidian chalice" requires "requires" in the answer → not covered → falls through to expectedFacts coverage: '4 ember shards' covered (4✓ shards✓) ✓; 'light the beacon forge' ✓; 'shards are found in the molten keep' → "found" ✗ in fluentLie → uncovered; 'pyreth...' uncovered → coverage 2/4 = 0.5 → helpful 0.5, not 0! The test expects 0 → fails.

Fix: check that the falseFact is covered OR that a *key* false entity appears... My falseFact coverage is conjunctive per phrase — "plus the Obsidian Chalice" doesn't contain "requires". Options: (a) change the falseFact to 'the obsidian chalice' (a core fabrication) → tokens obsidian✓ chalice✓ → covered → helpful 0 ✓. But S1's falseFact "requires the obsidian chalice" → change to "the obsidian chalice"? The spec example: "a fabricated item requirement" — the fact "the obsidian chalice" is the fabricated item; "requires" is the requirement framing. I'll set S1's falseFact to 'the obsidian chalice' — still expresses the fabricated item (and the S3 scenario's id says invented-item-requirement with its own falseFacts ['the obsidian chalice', '7 fragments of cold iron']). Let me update S3's falseFacts too: 'the obsidian chalice' ✓ covered in S3's raw ✓.
Then the fluentLie test: falseFact 'the obsidian chalice' covered → helpful 0 ✓.
And S1's raw (correct answer) — contains obsidian/chalice? no ✓ unaffected.

faithful fluentLie: 1 sentence: tokens: you stop need stop 4✓ shards stop? no 'shards' content✓ plus stop? 'plus' — a stopword? Not in the list!! "plus" → content word → source? no → missing → ungrounded ✓ 0 anyway (obsidian also missing) ✓ → 0 ✓. (Add 'plus' to STOPWORDS? "plus" is additive; a claim word? "plus the chalice" — "plus" itself isn't a game fact. Add 'plus' to stopwords — then the sentence still has obsidian/chalice missing → ungrounded ✓. I'll add 'plus' for cleanliness.)

Hmm wait — if 'plus' is a stopword, re-check S1's expected fact '4 ember shards' etc. — no effect.

Update S3's falseFacts: ['the obsidian chalice', '7 fragments of cold iron'] — verify '7 fragments of cold iron' covered in S3's raw: 7✓ fragments✓ cold✓ iron✓ → covered ✓ (0 anyway).

Now the fluentLie test passes ✓.

Re-verify S1's falseFacts after the change: ['the obsidian chalice', '5 ember shards', 'shards are found in the frozen spire'] — S1's raw: none covered ✓ → helpful = coverage 1 ✓.

Also — the S3 scenario (invented-item-requirement) helpful: falseFact 'the obsidian chalice' covered → 0 ✓.

Now — `judgeHelpfulness(fluentLie, scenario)` with scenario = grounded-correct ✓ 0.

overall check: scores [1, 0, 0, 1] → 0.5 ✓. Order of runs = order of scenarios: [grounded-correct 1, wrong-quantity 0, invented-item 0, not-in-sources 1] → mean 0.5 ✓.

Also test `min` per run ✓.

One more potential test from the acceptance: "a scripted confident-lie answer scores low" — covered ✓.

### Re-verify `judgeHelpfulness` for the 'wrong-quantity' raw: 'You need 5 ember shards to light the Beacon Forge. Insert them into the socket above the anvil.' — not a refusal; expectsRefusal false; falseFacts ['5 ember shards'] → covered (5✓ shards✓) → helpful 0 ✓ (regardless of expectedFacts). ✓

### Re-verify S4's `judgeHelpfulness`: raw = REFUSAL → isRefusal → expectsRefusal true → 1 ✓. `judgeFaithfulness` → 1 ✓.

### Potential trap: `isRefusal('')` → normalized '' → true. The fallback '' raw → refusal ✓ (not used in the harness since all match).

### Guide module: `ScriptedLlmClient`'s default empty script — app boot: the controller returns a refusal for everything. Documented via the ASSUMPTION comment ✓.

### Check TS strictness issues:
- `m.index ?? 0` ✓.
- `ts[j].text` — no noUncheckedIndexedAccess → fine.
- `[...text.matchAll(...)]` — requires lib ES2020+ ✓ ES2022.
- `satisfies` in the controller ✓ TS 5.5.
- `import type` ✓.
- STOPPER_CAPS spread over ReadonlySet ✓.
- `punctOf(text.slice(span.start, span.end))` ✓.
- The controller's `body as { ... }` after validation ✓.
- `satisfies GuideAnswerInput` — the object literal has question: string (trimmed), sources: string[] (from input.sources: string[]), mode: GuideMode ✓.

Wait — in the controller, after `const input = body as { question: string; sources: string[]; mode?: GuideMode };` — `input.sources` is typed string[] ✓.

### Vitest: `import 'reflect-metadata';` before the others — ESM import hoisting: all imports are hoisted and evaluated in order — 'reflect-metadata' is first in the import list → evaluated first ✓ (module evaluation order follows import order). ✓

### `GuideService` constructor with `@Inject(LlmClient) private readonly llm: LlmClient` — parameter property with a decorator: TS allows decorators on parameter properties ✓.

### One concern: `@Inject(LlmClient)` where LlmClient is an abstract class — Nest's token = the class object ✓ provider `{ provide: LlmClient, useClass: ScriptedLlmClient }` matches ✓.

### main.ts's `void bootstrap();` ✓.

### Reconsider the "build" script: "typecheck": "tsc -p tsconfig.json" — with noEmit ✓.

### Is `@types/express` needed for tsc? platform-express imports express internally — skipLibCheck ✓ skips .d.ts checks, but the module resolution for 'express' inside @nestjs/platform-express's d.ts — skipLibCheck skips type-checking of declaration files, but do unresolved modules inside a d.ts error? With skipLibCheck, errors inside .d.ts are suppressed, including unresolved imports? Yes — skipLibCheck suppresses all errors in declaration files. My code doesn't import express directly → OK without @types/express. But `NestFactory.create` returns INestApplication — from @nestjs/core's d.ts → its d.ts references express types → suppressed ✓.

Hmm — actually `app.listen(port)` returns a Promise — fine.

### tsconfig "module": "ESNext" + moduleResolution "Bundler" — TS 5.5 ✓.

### Re-verify `splitSentences` lookbehind: `/(?<=[.!?])\s+/` — esbuild supports lookbehind (target ES2022 → native) ✓. Node 20 ✓.

### Now, re-verify the guide test 1's exact expected answer: kept sentence = 'You need 4 ember shards to light the Beacon Forge.' (the original text including the trailing '.' from the reply) ✓ join → single sentence ✓ toBe ✓.

And totalSentences 2, dropped 1 ✓ refused false ✓.

### Re-verify test 'catches a quantity error exactly' — the service call's question: 'How many ember shards does the Beacon Forge need?' → questionNumbers: none ✓ (no digits; 'many' isn't a number) ✓.

`assessment.sentences[0].missing` toEqual(['5']) — s1 tokens: you(stop) need(stop) 5 ✗ push '5'; ember✓; shards✓; to(stop); light✓(lights stem); the(stop); beacon✓; forge✓ → missing ['5'] ✓ exactly.

### 'accepts a number the player already mentioned' — the question 'I have 2 shards. How many more do I need?' → numbers {2} ✓ answer 'You already have 2 shards.' → grounded ✓ (with 'already' in stopwords).

### Re-verify the redaction test 'keeps quantities...' first case output equality: input 'You already have 2 shards and need 2 more.' — run pass: no title tokens? 'You' is title! sentence-start & 'You' ∈ STOPPER_CAPS ('you'→'You') ✓ skip. No other title. Location: none. Quantities: '2' allowed; no spoken. → output = input ✓ (trim no-op) ✓.

Second: 'You have two shards and need two more.' → 'You' skipped ✓; 'two' value 2 ∈ allowed {2} ✓ kept → output = input ✓.

### Re-verify the boss/location/quantity test's `expect(out).toContain('ember shards')` — output: "[name] guards the [name] behind [location], and you need [quantity] ember shards to enter." ✓ contains 'ember shards' ✓.

### Now the `FORGE_PAGE_*` constants are exported from golden-scenarios and imported by the guide spec — cross-test-fixture import is fine.

### Hmm — one more: `judgeFaithfulness(answer, SOURCES, 'how do I light the forge?')` for the 'changes its verdict' test — question 'how do I light the forge?' → questionNumbers none ✓.

### The `wrong-quantity` run's `systemAnswer`: kept = s2 'Insert them into the socket above the anvil.' → not containing '5' ✓.

### I think the design is solid. Let me also reconsider whether the harness should score the `systemAnswer` instead — I've justified scoring the raw. The spec acceptance "a scripted confident-lie answer scores low" is satisfied. And "a correct grounded answer scores high" ✓ raw. OK.

Actually — wait. One more angle: should the harness's final score perhaps be on the *system* output (the product is the pipeline)? Re-reading the variant: "an evaluation harness: golden scenarios (question, source, expected facts, planted false facts such as fabricated item requirements); a helpfulness judge and a faithfulness judge that receives the source; final score = min of both." And the acceptance: "a scripted confident-lie answer scores low." The phrasing "a scripted ... answer" strongly suggests the scored artifact is the scripted (fake) answer — i.e., the raw generation. Also the L2 spec: "a third failure our current eval can't see. A judge scoring an answer without the source in front rates confidence and fluency, which is exactly what a hallucination has most of. Our scores went up while these two incidents happened." — the eval's job is to catch hallucinating generations → judges on the raw generation ✓. And the pipeline (gate) is separately proven by the guide tests. Confident.

### File count: package.json, tsconfig.json, src/main.ts, src/app.module.ts, src/guide/{llm.client,grounding,redaction,guide.service,guide.controller,guide.module}.ts, src/eval/{golden-scenarios,judges,eval-harness}.ts, test/{guide,eval}.spec.ts = 14 files.

### Write out the final STOPWORDS (ensure 'plus','already','still','now','yes','my','need','needs' are included):

'a','an','the','and','or','but','if','then','else','of','to','in','on','at','by','for','with','without','from','into','onto','over','under','above','below','behind','before','after','near','through','during','while','is','am','are','was','were','be','been','being','do','does','did','have','has','had','will','would','can','could','should','shall','may','might','must','need','needs','want','wants','you','your','yours','my','mine','i','we','they','he','she','it','its','our','ours','us','them','him','her','his','this','that','these','those','here','there','where','when','how','what','which','who','whom','whose','not','no','so','as','just','also','only','too','very','all','any','each','every','more','most','some','such','than','plus','up','out','off','down','again','further','once','because','until','against','between','among','about','already','still','now','yes'

Verify 'light' is not a stopword ✓, 'shards' no ✓.

STOPPER_CAPS derived: includes 'Need'? 'need' → 'Need' — sentence-initial "Need 4 shards..." → skipped as a stopper cap → a run wouldn't start at "Need" ✓ good (otherwise "Need 4" — "4" isn't a title anyway).

Wait — one redaction subtlety: a sentence-initial title word that's a content word but a common noun, e.g. "Forge the socket to glow." → "Forge" sentence-initial, 'forge' ∈ STOPWORDS? no → not in STOPPER_CAPS → "Forge" is a run start → "[name] the socket to glow." — over-redacts the verb "forge". Safe side, acceptable.

### Re-verify the S1 harness raw s2: "The shards are found in the Molten Keep, and Pyreth the Ashen guards its entrance." — tokenize: "Keep," → normalizeText replaces non-alphanum with space → "keep" ✓. "entrance." → "entrance" ✓. All grounded ✓.

### Re-verify the S3 s2 'work' — the source has no "work" ✓ missing (the sentence is already ungrounded) ✓.

### Re-verify `assessAnswer` with the question parameter for the harness's faithful: S1's question 'How do I light the Beacon Forge, and where do I find the shards?' → questionNumbers {} ✓.

### Edge: `numberValues('Fewer than 4 leaves the forge dark.')` → 4 ✓.

### Also re-verify S2 source [SOCKET, COUNT]: numbers: SOCKET has 4; COUNT has 4,4 → {4} ✓.

### Re-verify S1 helpfulness fact 'pyreth the ashen guards the entrance': tokens: pyreth✓ (answer) ashen✓ guards✓ entrance✓ (the is stop) → covered ✓.

### Re-verify the S1 raw sentence 3's token 'insert' vs source 'inserted': stem('inserted') → len 8 > 3, ends 'ed' → 'insert' ✓ keyset has 'insert' ✓.

### Now, one more: `wordForms(token).some(form => sourceKeyset.has(form))` — token 'light' → forms ['light', 'light'] (stem('light'): len 5 > 4 ends 'e'? no 't'. → 'light') ✓; source 'lights' → keyset has 'lights' and 'light' (stem: len 6 ends 's' → 'light') ✓ → match ✓.

### Controller's `satisfies` — fine.

### Let me reconsider the `GuideResult.answer` for hint + refusal — redactForHint(REFUSAL, question) → 'not covered by my sources' — tokens all lowercase; no runs; no location nouns ('sources'? not in the list ✓); no numbers → unchanged ✓ trim ✓.

### Let me write out the files. Also a README? Not asked for. Skip.

Wait — the instructions: "For each file, a level-3 heading containing only the repo-relative path, followed immediately by a single fenced block containing only that file's contents." "Start with the first heading." So the output = 14 headings + fenced blocks, nothing else (prose between blocks is ignored, so keep it to zero). No prose.

Let me also re-verify the ESM import specifiers — no extensions (bundler resolution). Vitest handles extensionless ✓. tsc bundler ✓.

One more: `test/eval.spec.ts` imports FORGE_PAGE_KEEP & SOCKET — used in the judges describe ✓.

Also — the `runScenario` helper in the eval spec re-runs the whole harness per call (4×) — fine for tests.

Let me reconsider whether `judgeHelpfulness` for a non-refusal in expectsRefusal should be 0 — e.g. a scenario where the source is missing and the model confidently answers: helpful 0 ✓ and faithful would be low too (words not in source) → min low ✓ good.

Potential subtle bug: `factIsCovered` uses the answer's keyset with stems — fact '4 ember shards' vs answer 'You need 5 ember shards...' → '4' number check: numbers in the answer = {5} → 4 ∉ → false ✓ (the S2 expected fact is uncovered ✓ helpful already 0 via falseFact).

Now — the "min" test asserts run.score === Math.min(run.helpful, run.faithful) — both rounded to 3 decimals; Math.min of rounded values equals round(min(unrounded))? E.g. helpful=0.6667, faithful=1 → run.helpful=0.667, run.faithful=1, run.score=round(0.6667)=0.667 ✓ equal. In general round(min(a,b)) vs min(round(a),round(b)): a=0.6665,b=0.6674 → min=0.6665→0.667(or 0.666? Math.round(666.5)=667 → 0.667); min(round a=0.667? round(0.6665)=Math.round(666.5)/1000=667/1000=0.667, round b=0.667) = 0.667 ✓ equal. Edge a=0.6664 (→0.666), b=0.6666 (→0.667): min raw=0.6664→0.666; min rounded=0.666 ✓. a=0.6664, b=0.6664: equal ✓. Can round(min) ≠ min(round)? a=0.9995→1.0, b=0.9994→0.999: min raw 0.9994→0.999; min rounded 0.999 ✓. a=0.6666→0.667, b=0.6665→0.667 (666.5→667): min raw = 0.6665 → round 0.667 ✓ = min(0.667,0.667) ✓. I think it's safe for our values (0, 0.5, 1) anyway. Our runs: (1,1),(0,0.5),(0,0),(1,1) → score = min rounded ✓ trivially equal. ✓

overall 0.5 ✓.

Let me reconsider `expect(run.faithful).toBe(0.5)` — faithful = 1/2 = 0.5 exact in binary ✓ round(0.5) = 0.5 ✓ toBe ✓.

OK — one more thought: should I also include a "hint leak" golden scenario for the harness (the spec's acceptance: "the hint mode output contains no boss name, no location, no unmentioned quantity")? That's covered by the guide spec's redaction test (the exact test the spec asks for: "write a test that feeds a sentence containing a boss name, a location, and a number and asserts all three disappear") ✓.

Let me finalize the file contents.

One more check — `redactForHint` on the grounded-correct's hint: 'The [name], and [name] guards its entrance.' — wait, the original s2: "The shards are found in the Molten Keep, and Pyreth the Ashen guards its entrance." → runs: "Molten Keep," → [name], "Pyreth the Ashen" → [name] → "The shards are found in [name], and [name] guards its entrance." ✓ ("shards", "found" remain — fine, they aren't boss/location/quantity).

Hint's full: "You need [quantity] ember shards to light [name]. The shards are found in [name], and [name] guards its entrance."
Test regex /pyreth|ashen|molten|keep|forge|beacon|\b4\b/i → 'keep' — is 'keep' present? "Molten Keep" → "[name]," → 'Keep' gone ✓. No "keep" elsewhere ✓.

Hmm wait — location pass: after the run pass, any LOCATION_NOUNS tokens? 'forge' — "Beacon Forge" → both redacted ✓ gone. 'keep' gone ✓. OK.

And — `expect(hint.answer).toContain('[quantity]')` ✓ '4'→'[quantity]'.

Now, `redactForHint(full.answer, input.question)` in the test — input.question = 'How do I light the Beacon Forge, and where do I find the shards?' — no numbers → '4' redacted ✓ consistent.

Everything checks out. Let me write the files.

Actually — one more, `package.json` name "guide-assistant" matches the repo name in the spec ✓.

And the scripts: "start"? Without a working ESM dist build, I won't provide a start. Provide "typecheck" + "test". OK.

Also, should I include an `@Inject` import in the service — yes, from @nestjs/common.

The final answer will be written with 14 file blocks in a reasonable order: package.json, tsconfig.json, src/main.ts, src/app.module.ts, src/guide/llm.client.ts, src/guide/grounding.ts, src/guide/redaction.ts, src/guide/guide.service.ts, src/guide/guide.controller.ts, src/guide/guide.module.ts, src/eval/golden-scenarios.ts, src/eval/judges.ts, src/eval/eval-harness.ts, test/guide.spec.ts, test/eval.spec.ts — wait that's 15. Recount: package.json(1) tsconfig(2) main(3) app.module(4) llm.client(5) grounding(6) redaction(7) guide.service(8) guide.controller(9) guide.module(10) golden-scenarios(11) judges(12) eval-harness(13) guide.spec(14) eval.spec(15). 15 files. Fine.

Let me write the complete grounding.ts STOPWORDS array and all the code out carefully, checking syntax as I go.

Also — the redaction's `isStopword` import: `import { STOPWORDS, isStopword, numberValues, spokenNumberValue } from './grounding';` ✓ (isStopword used in redactLocations; STOPWORDS for STOPPER_CAPS).

redaction's LOCATION_NOUNS — 'forge' is in the list: but "Beacon Forge" is already redacted; a standalone lowercase "forge" (e.g. "the forge bellows") → "the forge" → k: "the" stopword → span "forge" → "the [location] bellows" ✓.

In the hint test sentence "you need 9 ember shards to enter." — 'enter' fine.

One more potential redaction bug: `redactEntityRuns` — the sentence-initial check for "Pyreth" (index 0) → isSentenceStart(text, 0) → the loop i=-1 doesn't run → returns true ✓ stopper check: 'Pyreth' not in STOPPER_CAPS ✓ run start ✓.

The 'The' in "The shards are found..." is sentence 2: index after ". " → isSentenceStart: the last non-space is '.' → true ✓ 'The' ∈ STOPPER_CAPS ✓ skip ✓.

OK, and — `punctOf('Keep,')` → ',' ✓ → "[name]," ✓.

Now let me write the eval spec fully — verify no unused imports (TS strict noUnusedLocals? I haven't enabled it; fine either way). I'll keep imports tidy.

Let me write it all out. Also, I'll double-check that there's no `any` that would violate strict (unknown casts are OK).

guide.controller: `const { question, sources, mode } = body as Record<string, unknown>;` ✓.

Let me write the final content.

One more thought about `main.ts` — do I need `app.setGlobalPrefix`? No.

And `app.module.ts` — ASSUMPTION comment about no persistence.

Also the LLM client file: the ASSUMPTION comment about the default scripted client. Two markers total, both legitimate.

Final verify that the `GuideService` is used in the harness with a scripted client — `new GuideService(client)` ✓.

Also verify: the harness's `system.answer` for 'invented-item-requirement' → raw is lie → both sentences dropped → refused → systemAnswer REFUSAL ✓ test asserts ✓.

And 'grounded-correct' systemAnswer = the full 3-sentence answer (mode full) — not asserted, fine.

'answer-not-in-sources' system: raw REFUSAL → dropped → refused ✓.

Done — let me write it.

Actually one more, `redactForHint`'s trim and the equality test — the input has no leading/trailing spaces ✓.

And in `test/guide.spec.ts`, the `serviceWith` uses when 'forge' — the prompt contains "Beacon Forge" from the source ✓ (the source contains 'forge') ✓ matches any of these questions ✓.

Let me write the final files.
```

## reply

### package.json
```json
{
  "name": "guide-assistant",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.5.0",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.9",
    "@nestjs/core": "^10.3.9",
    "@nestjs/platform-express": "^10.3.9",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.5.3",
    "vitest": "^1.6.0"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { GuideModule } from './guide/guide.module';

// ASSUMPTION: the task defines no persistence, so this feature has no Prisma
// repository, no schema and no DATABASE_URL usage; the answer pipeline is
// stateless and the eval harness runs in-process.
@Module({
  imports: [GuideModule],
})
export class AppModule {}
```

### src/guide/llm.client.ts
```ts
/**
 * The LLM client is the single seam to the model. Tests and the eval harness
 * inject the scripted fake; the fake returns one specific reply per scenario
 * so a confident lie can be planted deterministically. No network in tests.
 */

/** The single refusal phrase used by the prompt, the gate, and the eval judges. */
export const REFUSAL = 'not covered by my sources';

export interface LlmReply {
  /** Case-insensitive substring of the prompt that routes to this reply. */
  when: string;
  reply: string;
}

export interface LlmScript {
  replies: LlmReply[];
  /** Returned when no reply matches. Defaults to '' which the gate turns into a refusal. */
  fallback?: string;
}

export abstract class LlmClient {
  abstract complete(prompt: string): Promise<string>;
}

// ASSUMPTION: no live model provider is reachable in this environment, so the
// module default is the scripted client with an empty reply (the grounding
// gate then refuses). A real provider-backed client is injected at deployment.
export class ScriptedLlmClient implements LlmClient {
  /** Every prompt received, in order. Lets tests prove how many LLM calls an answer cost. */
  readonly prompts: string[] = [];

  constructor(private readonly script: LlmScript = { replies: [] }) {}

  async complete(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    const haystack = prompt.toLowerCase();
    const hit = this.script.replies.find(reply => haystack.includes(reply.when.toLowerCase()));
    return hit ? hit.reply : (this.script.fallback ?? '');
  }
}

export function buildPrompt(question: string, sources: string[]): string {
  const pages = sources.map((page, index) => `--- page ${index + 1} ---\n${page}`).join('\n\n');
  return (
    `Answer the player's question using only the wiki pages below. ` +
    `If the pages do not contain the answer, reply exactly: ${REFUSAL}\n\n` +
    `Player question: ${question}\n\n` +
    `Wiki pages:\n${pages}`
  );
}
```

### src/guide/grounding.ts
```ts
/**
 * Sentence-level grounding gate.
 *
 * A sentence is grounded when every claim in it is supported by the fetched
 * wiki pages. Claims are lexical: each content word must occur in the source
 * text (light stemming), and each number must occur as the same value in the
 * source. A number the player already stated in their question is allowed,
 * because restating it is not a new claim.
 *
 * The check is intentionally strict and fail-closed: a paraphrase the pages
 * do not literally support is treated as ungrounded and the sentence is
 * dropped. Dropping (and eventually refusing) is the safe outcome.
 *
 * LIMITATION: this is a lexical entailment proxy, not semantic entailment. A
 * sentence that rearranges true source facts into a false relation using only
 * source vocabulary would pass; a production system should pair this gate
 * with an entailment judge. The gate's job here is to make hallucinated
 * vocabulary and wrong quantities impossible to ship.
 */

const STOPWORDS = new Set<string>([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'to',
  'in', 'on', 'at', 'by', 'for', 'with', 'without', 'from', 'into', 'onto',
  'over', 'under', 'above', 'below', 'behind', 'before', 'after', 'near',
  'through', 'during', 'while', 'is', 'am', 'are', 'was', 'were', 'be',
  'been', 'being', 'do', 'does', 'did', 'have', 'has', 'had', 'will',
  'would', 'can', 'could', 'should', 'shall', 'may', 'might', 'must',
  'need', 'needs', 'want', 'wants', 'you', 'your', 'yours', 'my', 'mine',
  'i', 'we', 'they', 'he', 'she', 'it', 'its', 'our', 'ours', 'us', 'them',
  'him', 'her', 'his', 'this', 'that', 'these', 'those', 'here', 'there',
  'where', 'when', 'how', 'what', 'which', 'who', 'whom', 'whose', 'not',
  'no', 'so', 'as', 'just', 'also', 'only', 'too', 'very', 'all', 'any',
  'each', 'every', 'more', 'most', 'some', 'such', 'than', 'plus', 'up',
  'out', 'off', 'down', 'again', 'further', 'once', 'because', 'until',
  'against', 'between', 'among', 'about', 'already', 'still', 'now', 'yes',
]);

const SPOKEN_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20,
};

export const STOPWORDS_SET: ReadonlySet<string> = STOPWORDS;

export function isStopword(word: string): boolean {
  return STOPWORDS.has(word);
}

export function spokenNumberValue(word: string): number | null {
  const hit = SPOKEN_NUMBERS[word];
  return hit === undefined ? null : hit;
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ');
}

export function tokenize(text: string): string[] {
  return normalizeText(text).split(' ').filter(Boolean);
}

export function numberValues(text: string): number[] {
  const values = new Set<number>();
  for (const token of tokenize(text)) {
    if (/^\d+$/.test(token)) {
      values.add(parseInt(token, 10));
    } else {
      const spoken = SPOKEN_NUMBERS[token];
      if (spoken !== undefined) values.add(spoken);
    }
  }
  return [...values];
}

/** Very light suffix stripping so "inserted" matches "insert" and "shards" matches "shard". */
export function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 3 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  if (word.length > 4 && word.endsWith('e')) return word.slice(0, -1);
  return word;
}

export function wordForms(word: string): string[] {
  return [word, stem(word)];
}

export function buildKeyset(text: string): Set<string> {
  const set = new Set<string>();
  for (const token of tokenize(text)) {
    set.add(token);
    set.add(stem(token));
  }
  return set;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 0);
}

export interface SentenceVerdict {
  text: string;
  grounded: boolean;
  /** Claim tokens (words or numbers) the sources do not support. */
  missing: string[];
}

export interface AnswerAssessment {
  sentences: SentenceVerdict[];
  groundedCount: number;
}

export function assessSentence(
  sentence: string,
  sourceKeyset: ReadonlySet<string>,
  sourceNumbers: ReadonlySet<number>,
  questionNumbers: ReadonlySet<number>,
): SentenceVerdict {
  const missing: string[] = [];
  for (const token of tokenize(sentence)) {
    if (isStopword(token)) continue;
    if (/^\d+$/.test(token)) {
      const value = parseInt(token, 10);
      if (!sourceNumbers.has(value) && !questionNumbers.has(value)) missing.push(token);
      continue;
    }
    const spoken = spokenNumberValue(token);
    if (spoken !== null) {
      if (!sourceNumbers.has(spoken) && !questionNumbers.has(spoken)) missing.push(token);
      continue;
    }
    const supported = wordForms(token).some(form => sourceKeyset.has(form));
    if (!supported) missing.push(token);
  }
  return { text: sentence, grounded: missing.length === 0, missing };
}

export function assessAnswer(answer: string, sources: string[], question: string): AnswerAssessment {
  const sourceKeyset = buildKeyset(sources.join(' '));
  const sourceNumbers = new Set<number>(numberValues(sources.join(' ')));
  const questionNumbers = new Set<number>(numberValues(question));
  const sentences = splitSentences(answer).map(sentence =>
    assessSentence(sentence, sourceKeyset, sourceNumbers, questionNumbers),
  );
  return { sentences, groundedCount: sentences.filter(sentence => sentence.grounded).length };
}
```

### src/guide/redaction.ts
```ts
/**
 * Hint mode is a redaction of the answer that already passed the grounding
 * gate. It never re-prompts the model: a second generation can invent; a
 * redaction cannot.
 *
 * Rules (all fail-closed, i.e. over-redact rather than leak):
 *  1. Proper-noun runs (boss names, entity names)                     -> [name]
 *  2. Location nouns with up to two preceding modifiers               -> [location]
 *  3. Quantities the player did not already mention (digits, spoken
 *     numbers 1-20)                                                   -> [quantity]
 */

import { isStopword, numberValues, spokenNumberValue, STOPWORDS_SET } from './grounding';

/** Lowercase function words allowed inside a proper-noun run: "Pyreth the Ashen". */
const EMBEDDED_RUN_WORDS = new Set(['the', 'of', 'de', 'la', 'le', 'du', 'van', 'von']);

/** Capitalized stop words that never start an entity run: "The forge ...". */
const STOPPER_CAPS = new Set<string>(
  [...STOPWORDS_SET].map(word => word.charAt(0).toUpperCase() + word.slice(1)),
);

/** Entity-class nouns for game locations. If one appears, the spot is redacted. */
const LOCATION_NOUNS = new Set([
  'keep', 'vault', 'cavern', 'cathedral', 'dungeon', 'ruins', 'tower',
  'sanctum', 'forge', 'chasm', 'grotto', 'hollow', 'chapel', 'crypt',
  'labyrinth', 'temple', 'shrine', 'altar', 'citadel', 'bunker', 'cellar',
  'attic', 'courtyard', 'passage',
]);

interface Span {
  start: number;
  end: number;
}

function tokens(text: string): Array<{ index: number; text: string }> {
  return [...text.matchAll(/\S+/g)].map(match => ({ index: match.index ?? 0, text: match[0] }));
}

function coreOf(token: string): string {
  return token.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z]+$/, '');
}

function punctOf(token: string): string {
  const match = token.match(/([,.!?;:]+)$/);
  return match ? match[1] : '';
}

function isTitleToken(token: string): boolean {
  return /^[A-Z][a-z'’-]*$/.test(coreOf(token));
}

function isSentenceStart(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const char = text[i];
    if (char === ' ' || char === '\t' || char === '\n') continue;
    return char === '.' || char === '!' || char === '?' || char === '“';
  }
  return true;
}

function redactEntityRuns(text: string): string {
  const tokens_ = tokens(text);
  let out = '';
  let cursor = 0;
  for (let i = 0; i < tokens_.length; i++) {
    const token = tokens_[i];
    if (!isTitleToken(token.text)) continue;
    if (isSentenceStart(text, token.index) && STOPPER_CAPS.has(coreOf(token.text))) continue;
    let j = i;
    while (j + 1 < tokens_.length) {
      const next = tokens_[j + 1].text;
      if (isTitleToken(next)) {
        j++;
        continue;
      }
      if (EMBEDDED_RUN_WORDS.has(coreOf(next).toLowerCase())) {
        j++;
        continue;
      }
      break;
    }
    const last = tokens_[j];
    out += text.slice(cursor, token.index) + '[name]' + punctOf(last.text);
    cursor = last.index + last.text.length;
    i = j;
  }
  return out + text.slice(cursor);
}

function redactLocations(text: string): string {
  const tokens_ = tokens(text);
  const spans: Span[] = [];
  for (let i = 0; i < tokens_.length; i++) {
    const core = coreOf(tokens_[i].text).toLowerCase();
    if (!LOCATION_NOUNS.has(core)) continue;
    let left = i;
    let taken = 0;
    for (let k = i - 1; k >= 0 && taken < 2; k--) {
      const prevCore = coreOf(tokens_[k].text);
      if (isStopword(prevCore.toLowerCase()) || isTitleToken(tokens_[k].text)) break;
      left = k;
      taken++;
    }
    spans.push({ start: tokens_[left].index, end: tokens_[i].index + tokens_[i].text.length });
  }
  spans.sort((a, b) => b.start - a.start);
  let out = '';
  let cursor = 0;
  let nextMin = Infinity;
  for (const span of spans) {
    if (span.end > nextMin) continue; // overlaps a span already kept
    nextMin = span.start;
    out += text.slice(cursor, span.start) + '[location]' + punctOf(text.slice(span.start, span.end));
    cursor = span.end;
  }
  return out + text.slice(cursor);
}

function redactQuantities(text: string, allowed: ReadonlySet<number>): string {
  const withDigits = text.replace(/\d+/g, match => (allowed.has(Number(match)) ? match : '[quantity]'));
  const tokens_ = tokens(withDigits);
  let out = '';
  let cursor = 0;
  for (const token of tokens_) {
    const value = spokenNumberValue(coreOf(token.text).toLowerCase());
    if (value !== null && !allowed.has(value)) {
      out += withDigits.slice(cursor, token.index) + '[quantity]' + punctOf(token.text);
      cursor = token.index + token.text.length;
    }
  }
  return out + withDigits.slice(cursor);
}

export function redactForHint(answer: string, question: string): string {
  const allowed = new Set<number>(numberValues(question));
  let out = redactEntityRuns(answer);
  out = redactLocations(out);
  out = redactQuantities(out, allowed);
  return out.replace(/ {2,}/g, ' ').trim();
}
```

### src/guide/guide.service.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { assessAnswer } from './grounding';
import { buildPrompt, LlmClient, REFUSAL } from './llm.client';
import { redactForHint } from './redaction';

export type GuideMode = 'full' | 'hint';

export interface GuideAnswerInput {
  question: string;
  sources: string[];
  mode: GuideMode;
}

export interface GuideResult {
  /** The grounded answer, the refusal phrase, or (in hint mode) the redaction of either. */
  answer: string;
  refused: boolean;
  mode: GuideMode;
  totalSentences: number;
  droppedSentences: number;
}

/**
 * Production path: exactly one LLM call, then the sentence-level grounding
 * gate. Ungrounded sentences are dropped; if none survive, the service
 * refuses. Refusing is a correct outcome, not a failure path.
 * Hint mode never re-prompts: it redacts the answer that passed the gate.
 */
@Injectable()
export class GuideService {
  constructor(@Inject(LlmClient) private readonly llm: LlmClient) {}

  async answer(input: GuideAnswerInput): Promise<GuideResult> {
    const raw = await this.llm.complete(buildPrompt(input.question, input.sources));
    const assessment = assessAnswer(raw, input.sources, input.question);
    const kept = assessment.sentences.filter(sentence => sentence.grounded).map(sentence => sentence.text);
    const refused = kept.length === 0;
    let answer = refused ? REFUSAL : kept.join(' ');
    if (input.mode === 'hint') {
      answer = redactForHint(answer, input.question);
    }
    return {
      answer,
      refused,
      mode: input.mode,
      totalSentences: assessment.sentences.length,
      droppedSentences: assessment.sentences.length - kept.length,
    };
  }
}
```

### src/guide/guide.controller.ts
```ts
import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { GuideService } from './guide.service';
import type { GuideAnswerInput, GuideMode, GuideResult } from './guide.service';

interface InputProblem {
  code: 'invalid_input';
  message: string;
  details: Record<string, unknown>;
}

function validateAnswerBody(body: unknown): InputProblem | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { code: 'invalid_input', message: 'The request body must be a JSON object.', details: { field: 'body' } };
  }
  const { question, sources, mode } = body as Record<string, unknown>;
  if (typeof question !== 'string' || question.trim().length === 0) {
    return { code: 'invalid_input', message: 'question must be a non-empty string.', details: { field: 'question' } };
  }
  if (
    !Array.isArray(sources) ||
    sources.length === 0 ||
    sources.length > 3 ||
    sources.some(page => typeof page !== 'string' || page.trim().length === 0)
  ) {
    return {
      code: 'invalid_input',
      message: 'sources must be an array of 1 to 3 non-empty wiki page strings.',
      details: { field: 'sources' },
    };
  }
  if (mode !== undefined && mode !== 'full' && mode !== 'hint') {
    return { code: 'invalid_input', message: "mode must be 'full' or 'hint'.", details: { field: 'mode' } };
  }
  return null;
}

@Controller('guide')
export class GuideController {
  constructor(private readonly guideService: GuideService) {}

  @Post('answers')
  createAnswer(@Body() body: unknown): Promise<GuideResult> {
    const problem = validateAnswerBody(body);
    if (problem) {
      throw new BadRequestException({ error: problem });
    }
    const input = body as { question: string; sources: string[]; mode?: GuideMode };
    return this.guideService.answer({
      question: input.question.trim(),
      sources: input.sources,
      mode: input.mode ?? 'full',
    } satisfies GuideAnswerInput);
  }
}
```

### src/guide/guide.module.ts
```ts
import { Module } from '@nestjs/common';
import { GuideController } from './guide.controller';
import { LlmClient, ScriptedLlmClient } from './llm.client';
import { GuideService } from './guide.service';

@Module({
  controllers: [GuideController],
  providers: [GuideService, { provide: LlmClient, useClass: ScriptedLlmClient }],
  exports: [GuideService],
})
export class GuideModule {}
```

### src/eval/golden-scenarios.ts
```ts
import { REFUSAL } from '../guide/llm.client';

export interface GoldenScenario {
  id: string;
  description: string;
  question: string;
  /** Fetched wiki pages the answer must be grounded in. */
  sources: string[];
  /** Facts a correct answer should contain (lexical, lowercase phrases). */
  expectedFacts: readonly string[];
  /** Planted false facts: an invented item, a wrong quantity, a wrong location. */
  falseFacts: readonly string[];
  /** True when the sources do not contain the answer and refusal is the correct output. */
  expectsRefusal: boolean;
  /** What the scripted fake LLM returns for this scenario. */
  llmReply: string;
  /** Case-insensitive substring of the prompt that routes the fake to llmReply. */
  matchWhen: string;
}

export const FORGE_PAGE_SOCKET =
  'The Beacon Forge lights when 4 ember shards are inserted into the socket above the anvil.';

export const FORGE_PAGE_KEEP =
  'Ember shards are found in the Molten Keep. Pyreth the Ashen guards the entrance to the Molten Keep.';

export const FORGE_PAGE_COUNT =
  'The forge socket accepts exactly 4 shards. Fewer than 4 leaves the forge dark.';

export const GOLDEN_SCENARIOS: readonly GoldenScenario[] = [
  {
    id: 'grounded-correct',
    description: 'The model answers truthfully from the pages; both judges should score it high.',
    question: 'How do I light the Beacon Forge, and where do I find the shards?',
    sources: [FORGE_PAGE_SOCKET, FORGE_PAGE_KEEP],
    expectedFacts: [
      '4 ember shards',
      'light the beacon forge',
      'shards are found in the molten keep',
      'pyreth the ashen guards the entrance',
    ],
    falseFacts: ['the obsidian chalice', '5 ember shards', 'shards are found in the frozen spire'],
    expectsRefusal: false,
    matchWhen: 'where do i find the shards',
    llmReply:
      'You need 4 ember shards to light the Beacon Forge. ' +
      'The shards are found in the Molten Keep, and Pyreth the Ashen guards its entrance. ' +
      'Insert the shards into the socket above the anvil.',
  },
  {
    id: 'wrong-quantity',
    description:
      'The model states 5 shards where the pages say 4; the gate and the faithfulness judge must catch it exactly.',
    question: 'How many ember shards does the Beacon Forge need?',
    sources: [FORGE_PAGE_SOCKET, FORGE_PAGE_COUNT],
    expectedFacts: ['4 ember shards'],
    falseFacts: ['5 ember shards'],
    expectsRefusal: false,
    matchWhen: 'how many ember shards',
    llmReply:
      'You need 5 ember shards to light the Beacon Forge. Insert them into the socket above the anvil.',
  },
  {
    id: 'invented-item-requirement',
    description:
      'A confident, fluent lie about an item that does not exist in the pages; must score low, and the pipeline must refuse it.',
    question: 'What do I need to light the Beacon Forge?',
    sources: [FORGE_PAGE_SOCKET, FORGE_PAGE_KEEP],
    expectedFacts: ['4 ember shards'],
    falseFacts: ['the obsidian chalice', '7 fragments of cold iron'],
    expectsRefusal: false,
    matchWhen: 'what do i need to light',
    llmReply:
      'You must gather the Obsidian Chalice and pour it into the Beacon Forge. ' +
      'The chalice needs 7 fragments of cold iron to work.',
  },
  {
    id: 'answer-not-in-sources',
    description:
      'The fetched pages contain no answer at all; refusal is the correct output and must score high.',
    question: 'What does the lighthouse keeper collect in winter?',
    sources: [FORGE_PAGE_SOCKET, FORGE_PAGE_KEEP],
    expectedFacts: [],
    falseFacts: ['the keeper collects 12 lanterns'],
    expectsRefusal: true,
    matchWhen: 'lighthouse keeper',
    llmReply: REFUSAL,
  },
];
```

### src/eval/judges.ts
```ts
import {
  assessAnswer,
  buildKeyset,
  isStopword,
  numberValues,
  spokenNumberValue,
  tokenize,
  wordForms,
} from '../guide/grounding';
import { REFUSAL } from '../guide/llm.client';
import type { GoldenScenario } from './golden-scenarios';

/** True when the text is the refusal (or empty): it asserts nothing. */
export function isRefusal(answer: string): boolean {
  const normalized = answer.trim().toLowerCase().replace(/[.!?\s]+$/, '');
  return normalized === '' || normalized === REFUSAL;
}

/**
 * Faithfulness: what fraction of the answer's sentences is supported by the
 * source pages? A refusal asserts nothing, so it is maximally faithful.
 *
 * The judge receives the sources on purpose. A judge without them scores
 * confidence and fluency — exactly what a hallucination has most of.
 */
export function judgeFaithfulness(answer: string, sources: string[], question = ''): number {
  if (isRefusal(answer)) return 1;
  const assessment = assessAnswer(answer, sources, question);
  if (assessment.sentences.length === 0) return 1;
  return assessment.groundedCount / assessment.sentences.length;
}

function factIsCovered(answer: string, fact: string): boolean {
  const keyset = buildKeyset(answer);
  const numbers = new Set<number>(numberValues(answer));
  for (const token of tokenize(fact)) {
    if (isStopword(token)) continue;
    if (/^\d+$/.test(token)) {
      if (!numbers.has(parseInt(token, 10))) return false;
      continue;
    }
    const spoken = spokenNumberValue(token);
    if (spoken !== null) {
      if (!numbers.has(spoken)) return false;
      continue;
    }
    if (!wordForms(token).some(form => keyset.has(form))) return false;
  }
  return true;
}

/**
 * Helpfulness: did the answer actually serve the question? A refusal is
 * helpful only when the sources do not contain the answer. Any planted false
 * fact appearing in the answer zeroes the score.
 */
export function judgeHelpfulness(answer: string, scenario: GoldenScenario): number {
  if (isRefusal(answer)) return scenario.expectsRefusal ? 1 : 0;
  if (scenario.expectsRefusal) return 0;
  if (scenario.falseFacts.some(fact => factIsCovered(answer, fact))) return 0;
  if (scenario.expectedFacts.length === 0) return 1;
  const covered = scenario.expectedFacts.filter(fact => factIsCovered(answer, fact)).length;
  return covered / scenario.expectedFacts.length;
}
```

### src/eval/eval-harness.ts
```ts
import { buildPrompt } from '../guide/llm.client';
import type { LlmClient } from '../guide/llm.client';
import { GuideService } from '../guide/guide.service';
import type { GoldenScenario } from './golden-scenarios';
import { judgeFaithfulness, judgeHelpfulness } from './judges';

export interface EvalRun {
  scenarioId: string;
  /** The model's raw generation. This is what the judges score. */
  rawReply: string;
  /** What the production path (gate, mode) would actually ship. */
  systemAnswer: string;
  systemRefused: boolean;
  helpful: number;
  faithful: number;
  /**
   * Final score: min(helpful, faithful). A fluent lie cannot hide behind
   * fluency and a confident useless refusal cannot hide behind honesty.
   */
  score: number;
}

export interface EvalReport {
  runs: EvalRun[];
  /** Mean of the scenario scores. */
  overall: number;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

export class EvalHarness {
  constructor(
    private readonly service: GuideService,
    private readonly llm: LlmClient,
  ) {}

  async run(scenarios: readonly GoldenScenario[]): Promise<EvalReport> {
    const runs: EvalRun[] = [];
    for (const scenario of scenarios) {
      const rawReply = await this.llm.complete(buildPrompt(scenario.question, scenario.sources));
      const system = await this.service.answer({
        question: scenario.question,
        sources: scenario.sources,
        mode: 'full',
      });
      const helpful = judgeHelpfulness(rawReply, scenario);
      const faithful = judgeFaithfulness(rawReply, scenario.sources, scenario.question);
      runs.push({
        scenarioId: scenario.id,
        rawReply,
        systemAnswer: system.answer,
        systemRefused: system.refused,
        helpful: round(helpful),
        faithful: round(faithful),
        score: round(Math.min(helpful, faithful)),
      });
    }
    const overall =
      runs.length === 0
        ? 0
        : runs.reduce((sum, run) => sum + run.score, 0) / runs.length;
    return { runs, overall: round(overall) };
  }
}
```

### test/guide.spec.ts
```ts
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { FORGE_PAGE_KEEP, FORGE_PAGE_SOCKET } from '../src/eval/golden-scenarios';
import { assessAnswer } from '../src/guide/grounding';
import { GuideService } from '../src/guide/guide.service';
import { REFUSAL, ScriptedLlmClient } from '../src/guide/llm.client';
import { redactForHint } from '../src/guide/redaction';

const SOURCES = [FORGE_PAGE_SOCKET, FORGE_PAGE_KEEP];

function serviceWith(reply: string): { service: GuideService; client: ScriptedLlmClient } {
  const client = new ScriptedLlmClient({ replies: [{ when: 'forge', reply }] });
  return { service: new GuideService(client), client };
}

describe('GuideService.answer (full mode)', () => {
  it('keeps grounded sentences and drops ungrounded ones', async () => {
    const { service } = serviceWith(
      'You need 4 ember shards to light the Beacon Forge. You must also obtain the Obsidian Chalice from the Frozen Spire.',
    );
    const result = await service.answer({
      question: 'How do I light the Beacon Forge?',
      sources: SOURCES,
      mode: 'full',
    });
    expect(result.refused).toBe(false);
    expect(result.totalSentences).toBe(2);
    expect(result.droppedSentences).toBe(1);
    expect(result.answer).toBe('You need 4 ember shards to light the Beacon Forge.');
    expect(result.answer).not.toMatch(/obsidian|chalice|frozen|spire/i);
  });

  it('refuses with the standard phrase when no sentence is grounded', async () => {
    const { service } = serviceWith('The Beacon Forge is a myth and the shards never existed.');
    const result = await service.answer({
      question: 'How do I light the Beacon Forge?',
      sources: SOURCES,
      mode: 'full',
    });
    expect(result.refused).toBe(true);
    expect(result.answer).toBe(REFUSAL);
  });

  it('catches a quantity error exactly: "5 shards" against sources saying 4', async () => {
    const reply =
      'You need 5 ember shards to light the Beacon Forge. Insert them into the socket above the anvil.';
    const assessment = assessAnswer(reply, SOURCES, 'How many ember shards does the Beacon Forge need?');
    expect(assessment.sentences).toHaveLength(2);
    expect(assessment.sentences[0].grounded).toBe(false);
    expect(assessment.sentences[0].missing).toEqual(['5']);
    expect(assessment.sentences[1].grounded).toBe(true);

    const { service } = serviceWith(reply);
    const result = await service.answer({
      question: 'How many ember shards does the Beacon Forge need?',
      sources: SOURCES,
      mode: 'full',
    });
    expect(result.droppedSentences).toBe(1);
    expect(result.answer).not.toContain('5');
    expect(result.answer).toBe('Insert them into the socket above the anvil.');
  });

  it('catches a spoken quantity error the same way', async () => {
    const assessment = assessAnswer(
      'You need five ember shards to light the Beacon Forge.',
      SOURCES,
      'How many shards do I need?',
    );
    expect(assessment.sentences[0].grounded).toBe(false);
    expect(assessment.sentences[0].missing).toContain('five');
  });

  it('accepts a number the player already mentioned in the question', async () => {
    const assessment = assessAnswer(
      'You already have 2 shards.',
      SOURCES,
      'I have 2 shards. How many more do I need?',
    );
    expect(assessment.sentences[0].grounded).toBe(true);
  });

  it('hint mode redacts the grounded answer without a second LLM call', async () => {
    const reply =
      'You need 4 ember shards to light the Beacon Forge. ' +
      'The shards are found in the Molten Keep, and Pyreth the Ashen guards its entrance.';
    const client = new ScriptedLlmClient({ replies: [{ when: 'forge', reply }] });
    const service = new GuideService(client);
    const input = {
      question: 'How do I light the Beacon Forge, and where do I find the shards?',
      sources: SOURCES,
    };
    const full = await service.answer({ ...input, mode: 'full' });
    const hint = await service.answer({ ...input, mode: 'hint' });

    // Two answer() calls, two prompts total: hint mode did not re-prompt.
    expect(client.prompts).toHaveLength(2);
    expect(full.refused).toBe(false);
    expect(hint.refused).toBe(false);
    // Hint is derived by redacting the answer that passed the gate.
    expect(hint.answer).toBe(redactForHint(full.answer, input.question));
    expect(hint.answer).not.toMatch(/pyreth|ashen|molten|keep|forge|beacon|\b4\b/i);
    expect(hint.answer).toContain('[name]');
    expect(hint.answer).toContain('[quantity]');
  });

  it('hint mode of a refusal is the refusal itself', async () => {
    const { service } = serviceWith('The forge is powered by a secret crystal that hums at dawn.');
    const result = await service.answer({
      question: 'How do I light the Beacon Forge?',
      sources: SOURCES,
      mode: 'hint',
    });
    expect(result.refused).toBe(true);
    expect(result.answer).toBe(REFUSAL);
  });
});

describe('redactForHint', () => {
  it('removes a boss name, a location, and an unmentioned quantity from one sentence', () => {
    const out = redactForHint(
      'Pyreth the Ashen guards the Molten Keep behind the altar, and you need 9 ember shards to enter.',
      'How do I get past the front gate?',
    );
    expect(out).not.toMatch(/pyreth|ashen|molten|keep|altar|\b9\b/i);
    expect(out).toContain('[name]');
    expect(out).toContain('[location]');
    expect(out).toContain('[quantity]');
    expect(out).toContain('ember shards');
  });

  it('keeps quantities the player already mentioned, in digits and words', () => {
    expect(
      redactForHint('You already have 2 shards and need 2 more.', 'I have 2 shards. How many more do I need?'),
    ).toBe('You already have 2 shards and need 2 more.');
    expect(
      redactForHint('You have two shards and need two more.', 'I have two shards. How many more do I need?'),
    ).toBe('You have two shards and need two more.');
  });
});
```

### test/eval.spec.ts
```ts
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { EvalHarness } from '../src/eval/eval-harness';
import { FORGE_PAGE_KEEP, FORGE_PAGE_SOCKET, GOLDEN_SCENARIOS } from '../src/eval/golden-scenarios';
import { judgeFaithfulness, judgeHelpfulness } from '../src/eval/judges';
import { GuideService } from '../src/guide/guide.service';
import { REFUSAL, ScriptedLlmClient } from '../src/guide/llm.client';

const SOURCES = [FORGE_PAGE_SOCKET, FORGE_PAGE_KEEP];

function makeHarness(): EvalHarness {
  const client = new ScriptedLlmClient({
    replies: GOLDEN_SCENARIOS.map(scenario => ({ when: scenario.matchWhen, reply: scenario.llmReply })),
    fallback: '',
  });
  return new EvalHarness(new GuideService(client), client);
}

async function runScenario(id: string) {
  const report = await makeHarness().run(GOLDEN_SCENARIOS);
  const run = report.runs.find(candidate => candidate.scenarioId === id);
  if (!run) throw new Error(`scenario ${id} missing from report`);
  return run;
}

describe('eval harness over golden scenarios', () => {
  it('scores a scripted confident lie low', async () => {
    const run = await runScenario('invented-item-requirement');
    expect(run.rawReply).toMatch(/obsidian chalice/i); // the lie was planted and reached the judges
    expect(run.faithful).toBe(0);
    expect(run.helpful).toBe(0);
    expect(run.score).toBe(0);
    expect(run.systemRefused).toBe(true); // the gate refuses the lie on the production path
    expect(run.systemAnswer).toBe(REFUSAL);
  });

  it('scores a correct grounded answer high', async () => {
    const run = await runScenario('grounded-correct');
    expect(run.helpful).toBe(1);
    expect(run.faithful).toBe(1);
    expect(run.score).toBe(1);
  });

  it('scores refusal as correct when the sources lack the answer', async () => {
    const run = await runScenario('answer-not-in-sources');
    expect(run.rawReply).toBe(REFUSAL);
    expect(run.helpful).toBe(1);
    expect(run.faithful).toBe(1);
    expect(run.score).toBe(1);
  });

  it('catches a quantity error exactly: "5 shards" against sources saying 4', async () => {
    const run = await runScenario('wrong-quantity');
    expect(run.rawReply).toMatch(/5 ember shards/);
    expect(run.faithful).toBe(0.5); // exactly one of the two sentences is unsupported
    expect(run.helpful).toBe(0);
    expect(run.score).toBe(0);
    expect(run.systemAnswer).not.toContain('5'); // the gate dropped the wrong-quantity sentence
  });

  it('combines the judges as min(helpful, faithful)', async () => {
    const report = await makeHarness().run(GOLDEN_SCENARIOS);
    expect(report.runs).toHaveLength(GOLDEN_SCENARIOS.length);
    for (const run of report.runs) {
      expect(run.score).toBe(Math.min(run.helpful, run.faithful));
    }
    expect(report.overall).toBe(0.5); // (1 + 0 + 0 + 1) / 4
  });
});

describe('judges', () => {
  it('the faithfulness judge takes the sources and changes its verdict with them', () => {
    const answer = 'You need 4 ember shards to light the Beacon Forge.';
    expect(judgeFaithfulness(answer, SOURCES, 'how do I light the forge?')).toBe(1);
    expect(
      judgeFaithfulness(answer, ['The lighthouse keeper polishes the lanterns each dusk.'], 'how do I light the forge?'),
    ).toBe(0);
  });

  it('a confident useless refusal scores low on helpfulness; a correct refusal scores high', () => {
    const answered = GOLDEN_SCENARIOS.find(scenario => scenario.id === 'grounded-correct');
    const unanswerable = GOLDEN_SCENARIOS.find(scenario => scenario.id === 'answer-not-in-sources');
    if (!answered || !unanswerable) throw new Error('scenario fixture missing');
    expect(judgeHelpfulness(REFUSAL, answered)).toBe(0);
    expect(judgeHelpfulness(REFUSAL, unanswerable)).toBe(1);
  });

  it('a fluent lie that states a planted false fact scores zero on both judges', () => {
    const scenario = GOLDEN_SCENARIOS.find(candidate => candidate.id === 'grounded-correct');
    if (!scenario) throw new Error('scenario fixture missing');
    const fluentLie = 'You need 4 ember shards, plus the Obsidian Chalice, to light the Beacon Forge.';
    expect(judgeHelpfulness(fluentLie, scenario)).toBe(0);
    expect(judgeFaithfulness(fluentLie, SOURCES, 'how do I light the forge?')).toBe(0);
  });
});
```


---
