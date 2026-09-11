# solution

## reasoning

```
Let me carefully analyze this task.

The task is to build the following:
1. `answer(question, sources, mode)` — an answer pipeline with a sentence-level grounding gate behind an injectable LLM client (a scripted fake is fine)
2. Hint mode derived by redacting the complete grounded answer (no second LLM call)
3. Evaluation harness: golden scenarios (question, sources, expected facts, planted FALSE facts), helpfulness judge, faithfulness judge that receives sources; final score = min of the two
4. Tests proving the following: a scripted confident lie scores low; a correct grounded answer scores high; a scenario whose sources lack the answer produces a refusal; quantity errors are caught exactly

There's a contradiction: the conventions block says NestJS, Prisma, PostgreSQL, etc., but this task is a pure TypeScript library task — "Build the whole solution in one reply." with no database. The conventions say "TypeScript (strict), Node 20+. NestJS for the API. Prisma as the ORM, PostgreSQL as the database." But this task doesn't need an API or database at all. The task says "In TypeScript, deliver: 1. `answer(question, sources, mode)` using an injectable LLM client..."

Hmm. The conventions are "always true" but the task statement carries everything else. This task is a grounding pipeline, not a REST API. Using NestJS/Prisma/Postgres for this task would be absurd — there's no persistence. The instruction "Do exactly what the task asks. Do not create a file it does not call for" suggests I shouldn't add Prisma schema, main.ts, app.module.ts, etc. for a task that's about an answer pipeline and evaluation harness.

Wait, but the conventions are said to "always hold." Let me re-read: "## Stack — TypeScript (strict), Node 20+. NestJS for the API. Prisma as the ORM, PostgreSQL as the database. Vitest for tests. pnpm as the package manager. ESM, `"type": "module"`."

"NestJS for the API" — if there's an API. This task has no API. The deliverables are: `answer()` function/service, redaction, evaluation harness, tests. So no API, no database. I'll follow the test (Vitest), ESM, TS strict, and pnpm conventions. The naming conventions: "Table and column: snake_case (via Prisma @map/@@map)" — no tables. "TS file: kebab-case.role.ts" — so e.g. `grounding.service.ts`, `hint-redactor.service.ts`, `llm.client.ts`, etc. Classes are PascalCase. Code and comments in English.

Layering: controller/service/repository — doesn't apply since there's no controller/repository. But I can use the "service" naming convention. The error envelope convention — no errors are thrown to HTTP; still, I can structure thrown errors cleanly.

Given "Do exactly what the task asks. Do not create a file it does not call for," I'll build a self-contained TypeScript module with:

- `src/llm/llm.client.ts` — LlmClient interface + scripted fake (ScriptedLlmClient)
- `src/answer/answer.service.ts` — AnswerService with `answer(question, sources, mode)`
- `src/answer/grounding.gate.ts` — sentence-level grounding check with strict numeric checking
- `src/answer/hint-redactor.ts` — redaction logic
- `src/eval/eval-harness.ts` — harness with golden scenarios, judges, min combining
- `src/eval/scenarios.ts` — golden scenarios
- `test/answer.spec.ts`, `test/hint.spec.ts`, `test/eval.spec.ts`
- `package.json` with vitest, typescript
- `tsconfig.json`

No Prisma, no NestJS decorators (no API). Hmm, but should I use NestJS? The conventions say "NestJS for the API" — this isn't an API. I think it's defensible to skip NestJS entirely: "Do exactly what the task asks." The task asks for a pipeline + evaluation harness, not an API. Adding NestJS DI would be extra ceremony the task doesn't call for, and the conventions explicitly say "NestJS for the API," suggesting NestJS is for when there's an API.

However, the "Wiring" conventions say "services, repositories, and processors are listed in the module's providers" — again, that's for modules. Since there are no modules, I'll use plain constructor injection with `Injectable`... no, without NestJS there's no `@Injectable` either. Just plain classes with constructor injection.

Let me carefully design the actual logic. This is the crux — the grounding gate has to be deterministic and testable.

### Grounding gate design

Input: the LLM's answer (string), the source text (array of strings).

Approach:
1. Split the answer into sentences (split on `.`, `!`, `?` boundaries while preserving delimiters).
2. For each sentence, extract claims:
   - Numbers/quantities: all number tokens in the sentence (e.g. "5", "four"). Strict check: every number in the sentence must appear in the sources... but wait, "5 shards when the page says 4" — the sentence has "5 shards" and the source has "4 shards." Strict check: the number must be grounded. If a number in the sentence isn't in the source → ungrounded.
   
   But careful: what if the number appears in the source in a different context? E.g. the source says "4 shards" and the answer says "You need 4 shards" — fine. What if the source says "level 5 boss" and the answer says "need 5 shards"? The number 5 is in the source but the quantity claim is wrong. Hmm — strict quantity checking: I should check number+unit (noun) pairs. E.g. "5 shards" → extract the pair (quantity: 5, item: shard). Then verify the pair against the sources: look for a sentence in the source containing "shard" with the number 4, not 5.

   Robust approach: for each number+head-noun token in the answer sentence, find the source text's mention of that head noun, extract the numbers adjacent to it, and require the answer's number to be among them. If the noun isn't in the source at all → ungrounded. If the noun is in the source with a different number → ungrounded.

   Let me define: quantity extraction regex: `/\b(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s+([a-z]+)/gi` — number followed by a noun. Also bare numbers (e.g. "level 5", "4th")? To keep it manageable, check:
   - All bare numbers in the sentence: each must appear somewhere in the sources (as a digit or spelled out).
   - Number+noun pairs: the number must appear with that noun in the sources.

   This is a decent "strict quantity checking" heuristic that's deterministic and testable.

3. Entity/term grounding: extract content words (nouns) in the sentence that are "important" — specifically proper nouns (capitalized words), game terminology. Check that each proper noun / capitalized entity appears in the sources. E.g. if the answer mentions "Moon Blade" but the sources don't have "Moon Blade" → ungrounded.

   What about lowercase common nouns like "farm" or "shard"? If the answer says "farm the ember shards" and the source mentions "ember shards" but not "farm"... checking every word would be too strict and flaky. Defensible heuristic: check (a) numbers strictly, (b) proper nouns (multi-word capitalized sequences or capitalized words excluding sentence-start), (c) quoted/known entity classes. Additionally, a token-overlap requirement: the sentence must share a meaningful token overlap with some source sentence (e.g., Jaccard of content words ≥ threshold, or a minimum of 1-2 shared content words beyond stopwords).

Let me think about what makes tests pass cleanly:

Test 1: confident lie. Sources: 2 wiki pages about the Ember Gate boss fight. The scripted LLM returns a fluent answer that includes "Collect 5 Moon Shards from the Dusk Caverns" — invented item requirement. Gate must drop that sentence. If all sentences of the lie are ungrounded → the answer becomes the refusal "not covered by my sources".

Test 2: correct grounded answer. Scripted LLM returns an answer whose sentences echo source facts with the correct quantity (4 shards). Gate passes everything → full answer.

Test 3: sources lack the answer. Question about something the sources don't cover. The LLM (fake) returns some answer (perhaps a plausible one), gate drops everything → refusal.

Test 4: quantity error. Source says "4 ember shards", LLM says "You need 5 ember shards to open the gate." → that sentence is dropped; if it's the only sentence → refusal. And "caught exactly" — the evaluation's faithfulness judge must flag the quantity mismatch. Test: "5 shards" when sources say 4 → caught.

For the grounding to work with these fixtures, I need to carefully design the fake answers and sources so that the heuristics behave as intended. Since I control both the fixtures and the gate, I can ensure it works, but the gate itself should be a genuinely reasonable heuristic, not a fixture-tuned hack.

Let me design the gate more concretely:

```ts
export interface GroundingResult {
  verdict: 'grounded' | 'ungrounded';
  reasons: string[];
}
```

Functions:
- `splitSentences(text: string): string[]` — split on /(?<=[.!?])\s+/
- `STOPWORDS: Set<string>`
- `contentWords(text): string[]` — lowercase, strip punctuation, exclude stopwords, len > 1
- `extractNumbers(text): { value: number, raw: string }[]` — digits and small words
- `extractQuantityPairs(text): { quantity: number, noun: string }[]` — `\b(\d+)\s+([a-z]+)` (also handle plurals: strip trailing 's'?) — for comparison, normalize the noun: lowercase, strip trailing 's' for singular. E.g. "shards" → "shard".
- `checkQuantityPair(sentence, sources)`:
  - Find all source occurrences of the noun (singular form, word-boundary, matching singular or plural).
  - For each occurrence, collect the numbers adjacent (within ~3 words in either direction).
  - The pair is grounded iff at least one source occurrence has an adjacent number equal to the pair's quantity. If the noun never appears → ungrounded. If it appears but no adjacent number equals → ungrounded.
  
  Hmm, adjacent numbers: "Collect four Ember Shards before the ritual begins" — "four" is right before "Shards". The answer's "You need 5 ember shards to open the Ember Gate" — noun "shard", source's number 4 ≠ 5 → ungrounded. 

  Edge case: what if the source says "shards" without any number ("The shards glimmer")? In that case, a quantity claim like "5 shards" is not supported — no number to verify against → ungrounded (quantity claim unsupported). This is the safe direction: unproven quantities are dropped. I think this is right per the spec: "Numbers and quantities need checking exactly."

- `extractProperNouns(sentence)`: capitalized words that aren't at the start of the sentence, or multi-word capitalized sequences. E.g. "Ember Gate", "Moon Shards", "Dusk Caverns". For a multi-word sequence: `/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g`, plus single capitalized words not at the start of the sentence. Each must appear in the sources (case-insensitive, word boundary). If not → ungrounded.

  Wait — "Ember Shards" as an item name: the sources must contain "Ember Shards". Good.

- `tokenOverlap(sentence, sources)`: for each source, compute the max Jaccard (or containment) between the sentence's content words and the source's content words. Grounded iff max containment (sentence words that appear in source words) ≥ some fraction, e.g. 0.5? Let me think: the answer sentence "Collect the four ember shards from the Hollow Vale before dawn." content words: collect, four, ember, shards, hollow, vale, before, dawn. If the source contains most of these, fine. A fluent lie about an invented item: "Collect five Moon Shards from the Dusk Caverns to feed the altar." — Moon, Dusk, Caverns, altar not in sources → proper noun check fails anyway, and overlap is low.

  Maybe a simpler, more robust rule: require the sentence's content words to be at least 60% found in the sources (with some normalization). Additionally, proper nouns must be found. Plus quantities strict. That's a decent multi-layered gate.

  Hmm, but for a "correct grounded answer" — the LLM's answer is a paraphrase of the source, so overlap should be high. Since I write the fixtures, I'll make the correct answer a near-verbatim echo with small paraphrasing, and I'll keep the gate threshold lenient enough (e.g., 0.6 containment) that paraphrase works.

Actually, let me reconsider: a simpler and more defensible gate might be to just check (a) strict quantities and (b) proper nouns/entities. A purely fluent lie about an invented item will typically invent an entity name (Moon Shards, Dusk Caverns) → caught by the proper noun check. But a subtle lie could use only common nouns with the wrong quantity → caught by quantity check. The "third failure" in the spec: the judge without sources scores fluency. The gate has to catch lies. I think three checks are good:

1. All bare numbers in the sentence appear in the source (as a number).
2. All number+noun pairs are strictly verified against source adjacency.
3. All proper nouns (capitalized sequences) appear in the source.
4. Content-word containment ≥ 0.5 (lenient) — catches sentences that are pure invention with only common nouns.

Hmm, 0.5 containment might be too lenient or too strict? Let me compute for the fixtures I'll write. I'll write the fixtures and check the math mentally.

Actually, let me make the gate composable: each check produces a reason; a sentence is grounded iff zero failed checks. I'll write the fixtures to pass/fail cleanly.

### Refusal

"If nothing survives, the service refuses: 'not covered by my sources'." So the returned shape:

```ts
export type AnswerMode = 'full' | 'hint';

export interface AnswerResult {
  mode: AnswerMode;
  status: 'answered' | 'refused';
  text: string;          // full grounded answer, or hint (redacted), or the refusal text
  droppedSentences: string[];  // for observability? maybe not needed in the output
}
```

The task says the output is "the answer grounded only in those pages, plus a spoiler-free hint mode." Refusal text: exactly "not covered by my sources".

Hmm, should I include `droppedSentences` in the output? It's useful for tests and observability, and harmless. But "Do exactly what the task asks" — the task says "ungrounded sentences are dropped or the service refuses." Exposing dropped sentences is a reasonable implementation detail; let me keep the result shape minimal but include the `groundedSentences` count? Let me keep: `{ status, text }` plus maybe `dropped: string[]`. I'll include `dropped` — it helps tests assert exactly which sentence was dropped (the "caught exactly" requirement). Actually for "caught exactly" I think I want the evaluation's faithfulness judge to flag the specific mismatch. Let me design the eval to report per-fact findings.

### Hint redaction

"Hint mode derived by redacting the complete grounded answer, not by re-prompting." And "Whatever rule you choose — proper nouns, entity classes, quantities not present in the player's question — write a test that feeds it a sentence containing a boss name, a location and a quantity and asserts all three are gone from the output."

Redaction rules:
1. Remove (replace with a generic term or "[redacted]") all proper nouns / capitalized entity sequences. Replace with a class-based generic? Spec: "must not reveal boss names, item locations, or quantities beyond what the player already mentioned."
   
   Simplest, most robust redaction:
   - Replace multi-word proper noun sequences and single proper nouns with a redaction placeholder. What placeholder? "a boss", "a location"? The spec says the rule can be "proper nouns, entity classes." To be spoiler-free: replace boss names with "a boss"? That requires knowing which entity is a boss. Simpler: replace all proper nouns with "[redacted]". That guarantees name and location are removed.
   - Quantities: replace any number in the answer with "[redacted]" unless that number appears in the player's question (i.e., "beyond what the player already mentioned" is allowed). E.g. if the player asks "I have 3 shards, what next?", the hint can mention "3"? "quantities beyond what the player already mentioned" must not appear — so quantities present in the question are allowed, others redacted.
   
   So redaction:
   - Proper nouns → `⬚` or `[redacted]`. I'll use `[redacted]`.
   - Numbers (digit and spelled-out small numbers) not in the question's number set → `[redacted]`.
   
   Test: feed a sentence containing a boss name, a location, and a quantity: e.g. "The Hollow Matriarch waits in the Dusk Caverns and needs four ember shards." → after redaction: "The [redacted] waits in the [redacted] and needs [redacted] ember shards." Wait — "four" is spelled out; I have to redact spelled-out numbers too. And "ember" is a common word, that's fine (item location is "Dusk Caverns" — that's the location; "ember shards" is an item, mentioning the item name "ember shards" in common case might itself be an item spoiler... the spec's test only asks for boss name, location, quantity to be gone. But to be safe, should item names also be redacted? "must not reveal boss names, item locations, or quantities" — item locations, not item names. OK, I'll keep common-case terms.

   Hmm wait, what about the first word "The" — the sentence-start check. Proper noun extraction for redaction: same extractor as the gate: capitalized sequences + capitalized words other than sentence-start. "The Hollow Matriarch" → "Hollow Matriarch" is a sequence. Good.

   Spelled-out numbers: "four", "five", "three", etc. If the question contains the same spelled-out number, allow. Question "I already have three shards" → numbers {3}. Answer "three shards" is allowed.

2. Also: hint mode must be derived from the gated (surviving) sentences. So the flow in the service:
   ```
   raw = llm.complete(prompt(question, sources, mode))
   ```
   Wait — should the LLM be prompted differently for hint mode? Spec: "No second LLM call." And "Hint mode derived by redacting the complete grounded answer." So even for hint mode, the LLM is called once (for the complete answer), the gate runs, and then the redactor produces the hint. So `answer(question, sources, mode='hint')`: call LLM once (the prompt is always for a full answer — the "be vague" second prompt is the bug), gate, redact.

   So the LLM prompt is always for a complete answer. Mode only affects post-processing. This aligns with "not by re-prompting."

### Eval harness

Golden scenario:
```ts
interface GoldenScenario {
  id: string;
  question: string;
  sources: string[];
  expectedFacts: string[];      // facts the answer should contain (for helpfulness)
  falseFacts: string[];         // planted false facts (for faithfulness)
  expectedOutcome: 'answer' | 'refusal';
  scriptedAnswer?: string;      // the fake LLM's answer for this scenario
}
```

The fake LLM "must return a specific answer per scenario so a confident lie can be planted." So ScriptedLlmClient takes a mapping: for each scenario (keyed by scenario id, or by the prompt content / question), return the scripted answer. Key by question string, or by an explicit scenario id? The LLM client only sees the prompt. The prompt includes the question. Simplest: ScriptedLlmClient has a `script: Array<{ match: RegExp | string; reply: string }>` — match against prompt text; or a map keyed by question. I'll do: `ScriptedLlmClient` constructed with `replies: Record<string, string>` keyed by the question text, plus a fallback. The prompt includes the question, so matching by substring of the question works. I'll match by exact question substring in the prompt.

Judges:

- Helpfulness judge: does the answer contain the expected facts, is it relevant to the question? It does not need sources (helpfulness = covers the expected facts). For a refusal scenario with expectedOutcome 'refusal', helpfulness should be high when the service refuses correctly (the spec says "Sources that lack the answer → refusal, scored as correct"). So the helpfulness judge needs to know the expectedOutcome: if expected is refusal, a refusal scores 1.0; if expected is answer, helpfulness = fraction of expected facts present.
  
  How to check "fact present"? A fact is a string; check by normalized containment: the fact's key tokens appear in the answer, or the fact string is contained. I'll write expected facts as short token phrases that appear in the grounded answer, e.g. "4 ember shards", "Hollow Vale". And `factPresent(fact, text)`: all content tokens of the fact appear in text (and if the fact has a number, the number matches exactly — for strictness). Simpler: case-insensitive word-boundary containment of the fact string, or token-set containment. Token-set containment is more robust to paraphrasing: fact "four ember shards" tokens {four, ember, shard} — I'd need to normalize the answer "4 ember shards" (4 → four) for token match. I'll normalize numbers (digits ↔ words) in both sides. Nice touch.

  Helpfulness score = presentFacts / totalFacts. Refusal when answer expected → 0 (plus the answer text would be the refusal, no facts). Answer when refusal expected → 0 (a confident useless answer when we should refuse is not helpful). Wait, spec: "a confident useless refusal and a fluent lie should both score low." Hmm — "confident useless refusal" scores low? But "Sources that lack the answer → refusal, scored as correct." These are different: a refusal in a scenario where the sources lack the answer is correct (scores high); a refusal in a scenario where the sources have the answer is useless (scores low). So helpfulness depends on expectedOutcome. Good, that's my design.

- Faithfulness judge: receives sources (that's the acceptance criterion: "The faithfulness judge's signature takes the sources"). Score = 1 − (violations / checks). Checks:
  1. Each planted false fact is not present in the answer (present → violation).
  2. Each quantity in the answer matches sources (strict check, reusing the quantity-pair checker).
  3. Each proper noun in the answer appears in sources.
  For a correct refusal: no claims → faithfulness 1.0.
  
  Faithfulness = 1 − violations / totalChecks, where totalChecks = falseFacts.length + quantityPairs.length + properNouns.length (guard totalChecks=0 → 1.0 if no falseFacts; but for the lie scenario, false facts would be present).

- Final = min(helpfulness, faithfulness).

The harness `runScenario(scenario, service)` → `{ id, outcome, helpful, faithful, score, findings }`. And `runSuite(scenarios, service)` → aggregate, and per-scenario pass/fail against a threshold (score ≥ 0.9 → pass).

Now the scripted scenarios and answers. Let me write the fixtures carefully.

**Scenario 1: "gate-open" — correct grounded answer.**
Sources:
- Page A: "The Ember Gate. The Ember Gate is a sealed arch in the Hollow Vale. It opens when four ember shards are placed on its four braziers. The shards glimmer faintly at dawn."
- Page B: "Ember Shards. Ember Shards are forged by heating cinder glass over a flame until it turns gold. Collect four ember shards and the gate opens."

Question: "How do I open the Ember Gate?"
Expected facts: ["4 ember shards", "Hollow Vale", "braziers"] — hmm, I want facts to be checkable. Let me pick expectedFacts: ["four ember shards", "Hollow Vale"].
False facts: ["5 ember shards" (wrong quantity), "Dusk Caverns" (invented location), "Moon Blade" (invented item)].
Scripted (correct) answer: "The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers."

Gate check on sentence 1: "The Ember Gate stands in the Hollow Vale." proper nouns: Ember Gate, Hollow Vale — both in sources ✓. No numbers. Content words: ember, gate, stands, hollow, vale — source has ember, gate, hollow, vale; "stands" is a stopword? no, "stands" is a content word not in source. Containment: 4/5 = 0.8 ≥ 0.5 ✓.

Sentence 2: "You need four ember shards, placed on its four braziers." Proper nouns: none (you, need, four lowercase; "ember" is lowercase — wait, in the source the item is "Ember Shards" capitalized. In the answer I wrote "ember shards" lowercase. Proper noun extractor: single capitalized words other than sentence-start. "Ember" is not capitalized here → not treated as a proper noun. That's fine.) Quantity pairs: "four ember" → (4, shard). Source: "four ember shards" appears in both pages → adjacent number 4 ✓. Also "four braziers" → (4, brazier). Source: "its four braziers" — page A: "placed on its four braziers" ✓ (I wrote "on its four braziers" in page A). Bare numbers: four appears in source ✓. Containment: you, need, four, ember, shards, placed, four, braziers → content: need, four, ember, shard, placed, four, brazier. Source words include: need? "You need four ember shards" — wait that's the answer. Source page B: "Collect four ember shards and the gate opens." — has four, ember, shard. "placed on its four braziers" — placed, four, brazier ✓. All present → high containment ✓.

Refusal check: nothing dropped → status answered, text = both sentences.

**Scenario 2: "confident-lie" — planted false facts, low score.**
Sources: same two pages (gate + shards) — the lie invents an item requirement.
Question: "How do I open the Ember Gate?"
False facts (planted): the scripted answer contains "five moon shards from the Dusk Caverns" and "offer the Moon Blade to the altar."
Scripted lie answer: "To open the Ember Gate, farm five moon shards in the Dusk Caverns. Offer the Moon Blade to the altar and the gate opens."

Gate: sentence 1: quantity pair (5, shard): source "shard" occurrences: "four ember shards" ×2, "The shards glimmer" — numbers adjacent to shard: 4 (and 4). 5 ∉ → ungrounded → dropped. Proper nouns: Dusk Caverns not in sources → ungrounded. Sentence 2: proper noun Moon Blade not in source → dropped; "altar" is a common word; containment: to, open, ember, gate, farm, five, moon, shards, dusk, caverns, offer, moon, blade, altar, gate, opens → content: open, ember, gate, farm, moon, shard, dusk, cavern, offer, blade, altar, opens. Source has open? page B "the gate opens" — "opens" yes; "gate" yes; "ember" yes. Shared: open/opens (hmm "open" vs "opens" — normalization? I won't do stemming; "opens" ≠ "open"). Shared tokens: ember, gate. Maybe "four"? no. 2/12 = 0.17 < 0.5 → dropped anyway.

All dropped → refusal: "not covered by my sources."

Then the evaluation: expectedOutcome 'answer' (sources DO contain the answer), the service refused → helpfulness 0 (useless refusal). Faithfulness: answer = refusal text, no false facts present, no quantities, no proper nouns → checks: falseFacts 3 (or whatever) all absent, 0 quantity pairs, 0 proper nouns → 0 violations / 3 checks → faithfulness 1.0. Final = min(0, 1) = 0 → low ✓. Hmm wait — is it right that a refusal that's wrong about its own sources gets faithfulness 1.0? Yes — it's faithful (made no false claim) but unhelpful. min → 0. This is exactly the design: "a confident useless refusal and a fluent lie should both score low."

But also, the spec's acceptance: "a scripted confident lie scores low." In my pipeline, the lie is gated to a refusal, so the "confident lie" that reaches the judge is the refusal. But also, the faithfulness judge should directly be able to catch a lie if one slips through the gate. I should test the judge directly: feed the fluent lie text (ungated) to the faithfulness judge with sources → low score due to false fact presence + wrong quantity. That tests the "judge sees sources" requirement. The spec says "A judge that scores an answer without the sources in front of it rates confidence and fluency, which is exactly what a hallucination has most of." So the harness test: same lie text scored by a source-blind judge (fluency) vs. a source-aware judge → source-aware is low. I can include a small "naive judge" in the harness (scores fluency only) to demonstrate? That might be extra. The acceptance is "The faithfulness judge's signature takes the sources" — I just need the signature to include sources and a test that a lie scores low with it. I'll test: `faithfulnessJudge.judge(lieText, { sources, falseFacts })` → low. And `helpfulnessJudge.judge(lieText, ...)` → maybe high (fluent, mentions gate) — showing that faithfulness is what catches it; final min is low.

Actually wait — let me re-read the acceptance: "A scripted confident lie scores low." In the end-to-end run of the lie scenario: service (with gate) → refusal → score min(helpful=0, faithful=1) = 0 ✓ low. Good. And I'll add a direct judge test to prove the faithfulness judge catches the lie text itself.

**Scenario 3: "no-coverage" — sources lack the answer → refusal is correct.**
Sources: same gate pages. Question: "How do I heal my party outside of combat?" (healing is not in the sources).
Expected outcome: refusal. Expected facts: [] (none). False facts: e.g. ["moonlight salve"] (whatever).
Scripted answer (the fake LLM confidently answers): "Rest at the Waystone Shrine to fully heal your party."
Gate: proper nouns: Waystone Shrine not in sources → dropped. Containment: rest, waystone, shrine, fully, heal, party → source has... "party"? no. All dropped → refusal ✓.
Evaluation: expectedOutcome 'refusal' → refusal gives helpfulness = 1.0. Faithfulness: refusal text, 0 claims, false facts absent → 1.0. Score 1.0 → high, "scored as correct" ✓.

**Scenario 4: "quantity-mismatch" — caught exactly.**
Sources: page B says four shards. Question: "How many ember shards do I need for the Ember Gate?"
Scripted answer (with the error): "You need five ember shards to open the Ember Gate."
Gate: pair (5, shard) vs. source 4 → dropped → all dropped → refusal.
The test asserts exactly: the dropped sentence is the quantity one; and the faithfulness judge, run on the raw answer text with sources, flags exactly the quantity violation "shard: 5 in answer, 4 in sources." "caught exactly" → the finding is about the specific noun/number. I'll design the finding structure: `{ kind: 'quantity_mismatch', term: 'shard', claimed: 5, sources: [4], sentence }`.

Hmm wait: if the gate drops it, the final answer is a refusal. Is a refusal here "correct"? Sources DO contain the answer (4 shards), so the refusal is technically unhelpful (expectedOutcome 'answer' → helpfulness 0). But the key acceptance is that the mismatch is "caught" — the gate catches it (sentence dropped) and the faithfulness judge catches the raw text. For the scenario in the harness, I could set expectedOutcome 'answer' and the score would be low (refusal due to a dropped sentence) — that's correct behavior: rather than ship "5", refuse. The harness marks it with the finding. Good.

Actually, a better scenario 4 that demonstrates a partial drop: a two-sentence scripted answer where only the quantity sentence is wrong:
- "The Ember Gate is in the Hollow Vale." (grounded ✓)
- "You need five ember shards to open it." (quantity ✗)
→ result: answered with only sentence 1. The dropped list contains the five-shards sentence. That demonstrates "ungrounded sentences are dropped" (partial drop) rather than a full refusal. And the eval: helpfulness: expected facts ["Hollow Vale", "four ember shards"] → present: Hollow Vale yes, four ember shards no → 0.5. Faithfulness on the final answer: no false facts present, no bad quantities (five was dropped), proper nouns OK → 1.0. Score 0.5 — medium; the harness finding reports the dropped sentence. Hmm, that muddies the "high score for correct answer." Let me make scenario 4 a dedicated unit-level test rather than a golden scenario, or keep the golden scenario as expectedOutcome 'answer' with a low-to-mid score, and the test asserts the specific quantity finding. Acceptance: "5 shards against sources saying 4 → caught, exactly." A dedicated test of the gate + judge with that exact fixture is cleanest. I'll include it as scenario 4 in the harness anyway (shows the harness surfaces the finding), and assert the finding details in the test.

Let me also reconsider: in scenario 4, the final answer is "The Ember Gate is in the Hollow Vale." — that's answered (not refused). The finding: a dropped-sentence note. Good, that demonstrates the partial drop.

### Now the exact code

Files (kebab-case.role.ts):

```
package.json
tsconfig.json
vitest.config.ts
src/llm/llm.client.ts            // LlmClient interface, LlmMessage/LlmPrompt types, ScriptedLlmClient
src/answer/answer.service.ts     // AnswerService.answer(question, sources, mode)
src/answer/grounding-gate.ts     // sentence splitting + checks (a service? it's logic — no DB, so service layer is fine; call it grounding-gate.ts, class GroundingGate)
src/answer/hint-redactor.ts      // HintRedactor class
src/answer/answer.types.ts       // shared types (AnswerMode, AnswerResult)
src/eval/judges.ts               // HelpfulnessJudge, FaithfulnessJudge
src/eval/scenarios.ts            // GoldenScenario type + SCENARIOS fixtures
src/eval/eval-harness.ts         // runScenario, runSuite
test/answer.service.spec.ts
test/hint-redactor.spec.ts
test/eval-harness.spec.ts
```

Hmm, "service holds logic" — the layers convention says the service holds logic. Here everything is pure logic, no DB. I'll use service-ish naming for the main entry (`answer.service.ts`) and plain classes for the gate/redactor/judges. Actually for consistency I might name them: `grounding-gate.service.ts`? The convention's file naming is `kebab-case.role.ts`. Roles used: service, controller, repository, module. Without an API, "service" is the fitting role for logic-bearing classes. But judges and redactors aren't "services" in the Nest sense... the convention is guidance; the role suffix pattern is `kebab-case.role.ts`. I'll do:

- `src/answer/answer.service.ts`
- `src/answer/grounding-gate.ts` — hmm, or `grounding.service.ts`. Let me think: `AnswerService` orchestrates: LLM call → `GroundingGate.check(answer, sources)` → if none survive, refuse → if mode is hint, `HintRedactor.redact(...)`.

I'll name the files: `src/answer/grounding-gate.ts` and `src/answer/hint-redactor.ts` (these are value-logic components; "gate" and "redactor" are the role words, satisfying kebab-case + role). I think that's defensible and reads better than `.service.ts` for every file. The convention's example only shows controller/service/repository/module for the API shape. The task explicitly calls for a pipeline + harness, not an API.

ESM: `"type": "module"` in package.json. Imports with `.js` extension? In Node ESM + TS, `import { X } from './foo.js'` with moduleResolution nodenext. Vitest handles both. Since the stack says Node 20+, I'll use `NodeNext` module and `.js` extensions in relative imports — that's the correct ESM TS convention. Vitest works fine with that.

Let me write package.json:

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
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

tsconfig:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": false,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

Hmm `types: ["node"]` requires @types/node. I don't use node APIs... maybe not in vitest.config.ts. If I don't use process/node APIs, I can drop `types`. Do I use anything from node? No. I'll drop `types` and `@types/node` dependency. Keep deps minimal: typescript + vitest.

vitest.config.ts:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
  },
});
```

Now the core code.

#### llm.client.ts

```ts
export interface LlmRequest {
  /** The rendered prompt the service sends to the model. */
  prompt: string;
}

export interface LlmResponse {
  text: string;
}

export interface LlmClient {
  complete(request: LlmRequest): LlmResponse;
}
```

Scripted fake:

```ts
export interface ScriptedReply {
  /** Substring of the prompt that selects this reply (usually the question). */
  match: string;
  reply: string;
}

export class ScriptedLlmClient implements LlmClient {
  constructor(
    private readonly scripts: ScriptedReply[],
    private readonly fallback: string = '',
  ) {}

  complete(request: LlmRequest): LlmResponse {
    const hit = this.scripts.find((s) => request.prompt.includes(s.match));
    return { text: hit ? hit.reply : this.fallback };
  }
}
```

This satisfies "the fake must return a specific answer per scenario" — the scenarios module builds scripts from the scenario list keyed by question.

#### Text utilities (shared by gate, redactor, judges)

`src/answer/text-utils.ts`:

- `splitSentences(text: string): string[]`
- `normalizeNumberToken`: map words → digits.
- `extractNumbers(text): number[]`
- `NUMBER_WORDS`
- `extractQuantityPairs(text): { quantity: number; noun: string }[]` — noun normalized to singular.
- `extractProperNouns(text): string[]`
- `contentWords(text): string[]`
- `STOPWORDS`

Let me write these carefully.

```ts
export const STOPWORDS = new Set([
  'a','an','the','and','or','but','if','then','else','when','while','of','at','by','for','from','in','into','on','onto','over','under','up','down','out','off','as','is','are','was','were','be','been','being','am','do','does','did','done','have','has','had','having','will','would','shall','should','can','could','may','might','must','to','that','this','these','those','it','its','you','your','yours','we','our','ours','i','me','my','mine','he','she','they','them','his','her','their','his','so','such','than','too','very','just','not','no','nor','any','all','each','few','more','most','other','some','s','t','until','against','between','through','during','before','after','above','below','again','further','once','here','there','why','how','what','which','who','whom','where','because','about','need','needs'? ...
]);
```

Hmm, careful: is "need" a stopword? In the containment check, if the answer has "need" and the source doesn't, it lowers the score. My scenario 1 sentence 2: "You need four ember shards, placed on its four braziers." Content words: need, four, ember, shard, placed, four, brazier → if "need" is a content word: source contains "need"? Page B: "Collect four ember shards and the gate opens." — no "need". Page A: "...It opens when four ember shards are placed on its four braziers." — no "need". So shared: four, ember, shard, placed, brazier → 5/7 = 0.71 ≥ 0.5 ✓ fine either way. I'll keep "need" as a content word (it's a claim-ish verb) — the threshold handles it.

Stopword list: keep it standard, don't over-tune. Also exclude single characters and words of len ≤ 2? "4" is handled separately. In contentWords: `word.length > 2 && !STOPWORDS.has(word)`.

`splitSentences`:
```ts
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
```
Node 20 supports lookbehind ✓ (ES2018+).

Numbers:
```ts
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

export function extractNumbers(text: string): number[] {
  const found: number[] = [];
  const re = /\b(\d{1,3})\b|\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) found.push(parseInt(m[1], 10));
    else {
      const w = m[2]!.toLowerCase();
      if (NUMBER_WORDS[w] !== undefined) found.push(NUMBER_WORDS[w]);
    }
  }
  return found;
}
```
Wait, with strict TS and noUncheckedIndexedAccess: m[2] could be undefined; handled. Note: "one" also matches in "someone"? `\bone\b` with word boundary — "someone" contains "one" but \b prevents it? "someone" — 's-o-m-e-o-n-e': the "one" at the end — boundary before 'o'? 'e' before 'o' is a word char, so \b fails → doesn't match. Good.

Quantity pairs:
```ts
export interface QuantityPair {
  quantity: number;
  /** Singular noun as it appears (lowercased). */
  noun: string;
  /** The raw matched text, e.g. "five ember shards". */
  raw: string;
}

export function extractQuantityPairs(text: string): QuantityPair[] {
  const pairs: QuantityPair[] = [];
  const re = /\b(\d{1,3}|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\w+\s+){0,2}?([a-z][a-z'-]*)s?\b/gi;
  ...
}
```
Hmm, that would match "four ember shards": number, up to 2 modifier words, noun. But it could also match "4th" etc. Let me simplify: number + up to 1 modifier + noun: `\b(num)\s+(?:[a-z]+\s+)?([a-z][a-z]*)s?\b` with case sensitivity on the noun part. But "four ember shards" → modifier "ember", noun "shards". "five moon shards" → moon, shards. "five shards" → no modifier, shards. "four braziers" → braziers.

But be careful with greedy ambiguity: "You need four ember shards and the gate opens" — regex: "four" + "ember" + "shards" ✓; could it also match "four ... and the gate"? No — the pattern allows at most one modifier and one noun: `(?:[a-z]+\s+)?([a-z]+)s?` — after "four": the optional modifier "ember" and noun "shards"; the regex engine at the "four" position: tries with modifier: modifier="ember", noun="shards" ✓ match "four ember shards". Good. For "four braziers": no modifier (modifier would be "its"? "on its four braziers" — "its" is before the number, no issue) → matches "four braziers" ✓.

Singularization of the noun: strip one trailing 's' if len > 3 and ends with 's': "shards"→"shard", "braziers"→"brazier". "braziers" is irregular but stripping 's' → "brazier" happens to work. Fine.

Also: should I extract modifier+noun as a phrase for matching? For strictness in the gate, matching by noun alone is what's needed: "shard" must have the same quantity in the source. Let me store the noun only (singular) and the quantity. Also store the full raw for the finding message.

Matching a noun in sources: build a source "quantity index": for each source, find all quantity pairs; also find bare noun occurrences. Then for an answer pair (q, noun):
- Collect all source pairs with the same noun → their quantities.
- Also check if the noun appears anywhere in the source.
- Verdict: grounded iff there's a source pair with quantity === q. (If the noun is in source but has no number near it → claim unsupported → ungrounded. If noun absent → ungrounded.)

Implementation:
```ts
export interface QuantityCheck {
  pair: QuantityPair;
  grounded: boolean;
  reason?: string;
  sourceQuantities: number[]; // quantities the sources give this noun
  nounFoundInSources: boolean;
}

export function checkQuantities(answer: string, sources: string[]): QuantityCheck[] {
  const pairs = extractQuantityPairs(answer);
  const sourcePairs = sources.flatMap((s) => extractQuantityPairs(s));
  return pairs.map((pair) => {
    const sourceQuantities = sourcePairs.filter((sp) => sp.noun === pair.noun).map((sp) => sp.quantity);
    const nounFound = sources.some((s) => new RegExp(`\\b${escapeRegExp(pair.noun)}s?\\b`, 'i').test(s));
    const grounded = sourceQuantities.includes(pair.quantity);
    let reason: string | undefined;
    if (!nounFound) reason = `"${pair.noun}" never appears in the sources`;
    else if (sourceQuantities.length === 0) reason = `sources mention "${pair.noun}" but never give a quantity`;
    else if (!grounded) reason = `answer says ${pair.quantity} ${pair.noun}(s) but sources say ${sourceQuantities.join(' or ')}`;
    return { pair, grounded, reason, sourceQuantities, nounFoundInSources: nounFound };
  });
}
```

Wait, an edge: source "four ember shards" — extractQuantityPairs on the source: "four ember shards" → (4, shard) ✓. Also page A: "It opens when four ember shards are placed on its four braziers." → pairs: (4, shard), (4, brazier) ✓.

Edge: "The shards glimmer faintly at dawn." — no number → no pairs ✓.

Now "caught exactly": the answer "You need five ember shards to open the Ember Gate." → pair (5, shard), sourceQuantities [4,4] → grounded=false, reason mentions 5 vs 4. Test asserts reason/structure: claimed 5, sources [4]. 

Bare number check: every number in the sentence must be in the numbers in the sources. Scenario 1 sentence 2 has 4 → in source ✓. What if a sentence has a number not tied to a noun, e.g. "level 5"? If the sources have no 5 → ungrounded. This adds strictness. But false positive risk: answer "The gate has four braziers" → 4 ∈ sources ✓. OK, I'll include the bare-number check: for each unique number in the sentence, the set of numbers in the sources must include it.

Hmm wait, is the bare number check redundant with the pair check? No: "Level 10 players" — pair extraction might not catch "level 10" (number after noun). Bare check catches it if 10 ∉ sources. I'll include it.

Proper nouns:

```ts
export function extractProperNouns(text: string): string[] {
  const nouns = new Set<string>();
  // Multi-word capitalized runs
  const seqRe = /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)\b/g;
  let m;
  while ((m = seqRe.exec(text)) !== null) nouns.add(m[1]);
  // Single capitalized words, skipping sentence starts and after terminal punctuation
  const words = text.split(/\s+/);
  words.forEach((w, i) => {
    const clean = w.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
    if (!clean) return;
    if (i === 0) return; // sentence start
    if (i > 0 && /(?:[.!?])\s*$/.test(words[i - 1] ?? '')) return;
    if (/^[A-Z][a-z]+$/.test(clean) && !nouns.has(clean)) {
      // avoid adding words that are part of an already-captured sequence
      // (handled by checking if the word is inside any captured sequence)
      if (![...nouns].some((n) => n.split(' ').includes(clean))) nouns.add(clean);
    }
  });
  return [...nouns];
}
```

Hmm, this is getting fiddly. Let me simplify: capture multi-word sequences first; then single capitals: split the text into words with indices; a word is a single proper noun if it matches /^[A-Z][a-z]{2,}$/ (3+ chars to reduce noise like "I" — that's uppercase but length 1, excluded; "A" length 1 excluded) AND it's not the first word of the sentence AND not contained in a captured multi-word sequence.

Simpler approach to avoid the containment check: use a regex that matches a capitalized word not preceded by a capitalized word and not at the start of the sentence:
`/(?<![A-Za-z] )(?:(?<=[.!?]\s+)|(?<=^))(?![A-Z][a-z]*\s+[A-Z])...` — too complex.

Alternative pragmatic approach:
1. Find all multi-word sequences: `/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g`.
2. Remove them from the working text (replace with spaces).
3. On the remaining text, find single capitalized words `/\b[A-Z][a-z]{2,}\b/g`, skipping those at the start of the sentence (i.e., at the start of the text or preceded by ". ", "! ", "? " or at start of line).

For skipping sentence start: I can do a per-sentence pass — I'm checking sentence by sentence anyway! The gate checks each sentence. So I'll run `extractProperNouns(sentence)`:
- sequences: `/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g` → e.g. "Ember Gate", "Hollow Vale", "Moon Shards", "Dusk Caverns".
- singles: in the sentence with sequences stripped, `/\b[A-Z][a-z]{2,}\b/g` but skip the first token of the sentence.

Implementation:
```ts
export function extractProperNouns(sentence: string): string[] {
  const found = new Set<string>();
  const seqRe = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
  let m: RegExpExecArray | null;
  let stripped = sentence;
  while ((m = seqRe.exec(sentence)) !== null) {
    found.add(m[0]);
  }
  stripped = sentence.replace(seqRe, ' ');
  const tokens = stripped.split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    const t = (tokens[i] ?? '').replace(/^[^A-Z]+|[^A-Z]+$/g, '');
    if (/^[A-Z][a-z]{2,}$/.test(t)) found.add(t);
  }
  return [...found];
}
```
Wait, `replace(seqRe, ' ')` — reusing a /g regex in replace is fine (no lastIndex issue in replace). Note: stripping "Ember Gate" from "The Ember Gate stands..." → "The   stands..." → tokens: The, stands. "The" is the first token — skipped (i starts at 1). Hmm "The" matches ^[A-Z][a-z]{2,}$ — "The" is The = T-h-e, [a-z]{2,} = "he" 2 chars ✓ matches, but it's the first token → skipped. Good.

But wait: what if the sentence starts with a proper noun? "Hollow Vale is where..." → sequence captures "Hollow Vale" ✓ (the sequence regex doesn't care about sentence start — should it? A sequence at sentence start is a legit proper noun, yes).

Single capital in the middle of a sentence: "The Matriarch waits..." → stripped (no sequence) → tokens: The, Matriarch, waits → i=1: "Matriarch" ✓ captured. Good.

Edge: "You" — capitalized? No, "you" is lowercase unless sentence-start. "I" is length 1 — excluded by {2,}. Good.

Proper noun grounding check: for each pn, check the sources contain it (case-insensitive word-boundary match):
```ts
const inSources = sources.some((s) => new RegExp(`\\b${escapeRegExp(pn)}\\b`, 'i').test(s));
```

Containment check (vocabulary grounding):
```ts
export function vocabularyContainment(sentence: string, sources: string[]): number {
  const words = contentWords(sentence);
  if (words.length === 0) return 1; // nothing to check
  const sourceWords = new Set(sources.flatMap(contentWords));
  const hits = new Set(words).filter((w) => sourceWords.has(w)).size;
  return hits / new Set(words).size;
}
```
Unique words or all words? Unique is fairer (repetition doesn't skew). I'll use unique.

Threshold: I'll pick 0.5. Let me verify scenario 1 sentence 2 with unique content words: need, four, ember, shard, placed, brazier (7 unique; "four" twice → unique). Source content words: page A: ember, gate, sealed, arch, hollow, vale, opens, four, ember, shards, placed, four, braziers, shards, glimmer, faintly, dawn → {ember,gate,sealed,arch,hollow,vale,opens,four,shard,placed,brazier,glimmer,faintly,dawn} (after singularization? no — contentWords just lowercases; "shards" stays "shards"!). Hmm — mismatch: sentence has "shards" (from "four ember shards,") wait, my answer sentence 2 is "You need four ember shards, placed on its four braziers." → tokens: shards, braziers (plural). Source page A has "shards" and "braziers" ✓ (page A: "four ember shards are placed on its four braziers" — yes, both plural!). So shared: ember ✓, four ✓, shards ✓, placed ✓, braziers ✓, need ✗ → 5/6 ≈ 0.83 ✓.

Sentence 1: "The Ember Gate stands in the Hollow Vale." content: ember, gate, stands, hollow, vale → source has ember, gate, hollow, vale → 4/5 = 0.8 ✓.

Scenario 3 sentence: "Rest at the Waystone Shrine to fully heal your party." content: rest, waystone, shrine, fully, heal, party → source has... none? "fully"? no. 0/6 = 0 < 0.5 → dropped ✓ (also Waystone Shrine not in sources).

Scenario 2 sentence 1: "To open the Ember Gate, farm five moon shards in the Dusk Caverns." content: open, ember, gate, farm, five, moon, shards, dusk, caverns → source has: ember ✓, gate ✓, open ✓? page A "It opens" → "opens" ≠ "open". page B "the gate opens" → "opens". Hmm "open" vs "opens": shared = ember, gate → 2/8 = 0.25 < 0.5 → dropped ✓. Plus the pair (5,shard) fails, Dusk Caverns not in source. Doubly caught ✓.

Scenario 2 sentence 2: "Offer the Moon Blade to the altar and the gate opens." content: offer, moon, blade, altar, gate, opens → shared: gate, opens → 2/6 = 0.33 < 0.5 → dropped ✓. Moon Blade also missing.

Scenario 4 sentence 1: "The Ember Gate is in the Hollow Vale." content: ember, gate, hollow, vale → 4/4 = 1 ✓. No numbers. Proper nouns present ✓ → survives.
Sentence 2: "You need five ember shards to open it." content: need, five, ember, shards, open → shared: ember, shards? Source has "shards" ✓, five ✗ (source has four), need ✗, open ✗ → 2/5 = 0.4 < 0.5 → dropped. Plus pair (5,shard) fails, and bare number 5 ∉ source numbers {4,4,4,4...} → dropped ✓.

Wait, source numbers: page A "four ember shards ... four braziers" → 4,4; page B "four ember shards" → 4. Plus "four braziers". So source numbers = {4}. Bare "5" fails ✓.

Good — the threshold 0.5 works with these fixtures. And it's not absurdly strict for real paraphrases — 50% vocab overlap with sources is a reasonable floor. I'll document it.

Now the gate:

```ts
export interface SentenceVerdict {
  sentence: string;
  grounded: boolean;
  reasons: string[];
}

export interface GateReport {
  verdicts: SentenceVerdict[];
  groundedSentences: string[];
  droppedSentences: string[];
}

export class GroundingGate {
  constructor(private readonly options: { minVocabularyContainment?: number } = {}) {}

  evaluate(answer: string, sources: string[]): GateReport {
    const min = this.options.minVocabularyContainment ?? 0.5;
    const sourceText = sources.join('\n');
    const sourceNumbers = new Set(extractNumbers(sourceText));
    const verdicts = splitSentences(answer).map((sentence) => {
      const reasons: string[] = [];
      // 1. strict quantities
      for (const q of checkQuantities(sentence, sources)) {
        if (!q.grounded && q.reason) reasons.push(q.reason);
      }
      // 2. bare numbers
      for (const n of new Set(extractNumbers(sentence))) {
        if (!sourceNumbers.has(n)) reasons.push(`number ${n} does not appear in any source`);
      }
      // 3. proper nouns
      for (const pn of extractProperNouns(sentence)) {
        if (!sources.some((s) => new RegExp(`\\b${escapeRegExp(pn)}\\b`, 'i').test(s))) {
          reasons.push(`"${pn}" is not in the sources`);
        }
      }
      // 4. vocabulary containment
      const c = vocabularyContainment(sentence, sources);
      if (c < min) reasons.push(`only ${Math.round(c * 100)}% of the vocabulary is found in the sources`);
      return { sentence, grounded: reasons.length === 0, reasons };
    });
    return {
      verdicts,
      groundedSentences: verdicts.filter((v) => v.grounded).map((v) => v.sentence),
      droppedSentences: verdicts.filter((v) => !v.grounded).map((v) => v.sentence),
    };
  }
}
```

Wait — checkQuantities(sentence, sources) recomputes sourcePairs per sentence; fine for this scale.

One issue: `checkQuantities` for a sentence without pairs returns [] ✓.

Edge: a sentence with a quantity pair where the noun is in the source with a number, but the answer's number matches → grounded ✓.

#### Hint redactor

```ts
export class HintRedactor {
  redact(text: string, playerQuestion: string): string {
    const allowedNumbers = new Set(extractNumbers(playerQuestion));
    let out = text;
    // 1. multi-word proper noun sequences
    const seqRe = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
    out = out.replace(seqRe, '[redacted]');
    // 2. single proper nouns not at sentence start — need per-sentence handling
    out = splitSentences(out).map((s) => redactSentenceStart(s)).join(' ');
    // 3. numbers not allowed
    out = out.replace(/\b\d{1,3}\b/g, (m) => (allowedNumbers.has(parseInt(m,10)) ? m : '[redacted]'));
    out = out.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, (m) =>
      allowedNumbers.has(NUMBER_WORDS[m.toLowerCase()]) ? m : '[redacted]');
    return out;
  }
}
```

Ordering matters: numbers after noun redaction (redaction inserts "[redacted]" which has no digits or number words... "redacted" — does it contain a number word? No). Also proper noun redaction shouldn't clobber sentence-start "The". redactSentenceStart:

```ts
function redactSingleProperNouns(sentence: string): string {
  const tokens = sentence.split(/(\s+)/); // keep separators
  return tokens.map((tok, i) => {
    if (i === 0) return tok;
    // skip if previous non-space token ends a sentence
    ...
  }).join('');
}
```
Simpler: since I run it per split sentence, only i===0 is sentence-start.

```ts
const tokens = sentence.split(/(\s+)/);
const out = tokens.map((tok, i) => {
  if (i === 0) return tok;
  const bare = tok.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
  if (/^[A-Z][a-z]{2,}$/.test(bare)) return tok.replace(bare, '[redacted]');
  return tok;
});
return out.join('');
```

Hmm wait, but the multi-word sequence replacement already ran; the remaining single capitals are standalone proper nouns. Example: "The Matriarch waits in the Dusk Caverns." — sequences: "Dusk Caverns" → replaced → "The Matriarch waits in the [redacted]." Then single pass: tokens: The (i=0 skip), Matriarch → [redacted] ✓.

But note: after sequence replacement, a sentence like "The [redacted] waits..." — "[redacted]" starts with '[' so the bare extraction gives "" → no match. Fine.

Edge: "Ember Gate" at sentence start: "Ember Gate is sealed." sequence regex captures "Ember Gate" regardless of position ✓ → "[redacted] is sealed." Good — the sequence regex is not limited by sentence start, so no special handling needed there.

Quantity redaction: replace digits and number words not in the question. But "four braziers" — "four" → [redacted] braziers → "[redacted] braziers". That's safe (hides the quantity).

Also: what about an item name in common case with a quantity like "ember shards"? "must not reveal ... item locations, or quantities" — "ember shards" without a quantity is not a location; OK to keep.

Test (per spec): "feed it a sentence containing a boss name, a location and a quantity and assert all three are gone from the output."
Input: "The Hollow Matriarch guards the Dusk Caverns and demands four ember shards."
Question: "How do I progress?" (no numbers).
Output: "The [redacted] guards the [redacted] and demands [redacted] ember shards."
Assert: !out.includes('Hollow Matriarch'), !out.includes('Dusk Caverns'), !out.includes('four'), !/\bfour\b/i.test(out). Also "4" is absent. ✓.

And a positive control: a number in the question is preserved: question "I have three shards already. What now?" with a sentence "Bring three shards to the altar." → "three" preserved. Wait, "altar" is a common word, fine. Output: "Bring three shards to the [redacted]." Hmm — "altar" is not a proper noun (lowercase) → not redacted. But "altar" might be an item location... in the fixture it's lowercase so my rule keeps it. The spec's rule is my choice; I'll document: proper nouns (capitalized sequences/words) + quantities not in the question. I'll note in a comment that lowercase common nouns are intentionally kept to avoid over-redaction. Hmm, but "Dusk Caverns" as a location is caught only because it's capitalized. That's the rule I chose: "proper nouns, entity classes, quantities not present in the player's question" — I picked "proper nouns + quantities not in question." Fine, and the test uses a capitalized location as required.

Wait, actually let me re-read: "must not reveal boss names, item locations, or quantities beyond what the player already mentioned." If a location is written in lowercase in the answer ("the dusk caverns"), my redactor would let it through. But the gate: the answer must be grounded in the sources; if the source has "Dusk Caverns" capitalized, the LLM's answer usually mirrors that. It's a heuristic rule — I'll document the limitation in a comment. OK.

#### AnswerService

```ts
export type AnswerMode = 'full' | 'hint';

export interface AnswerResult {
  mode: AnswerMode;
  status: 'answered' | 'refused';
  text: string;
  droppedSentences: string[];
}

export const REFUSAL_TEXT = 'not covered by my sources';

export class AnswerService {
  constructor(
    private readonly llm: LlmClient,
    private readonly gate: GroundingGate = new GroundingGate(),
    private readonly redactor: HintRedactor = new HintRedactor(),
  ) {}

  answer(question: string, sources: string[], mode: AnswerMode = 'full'): AnswerResult {
    const raw = this.llm.complete({ prompt: buildPrompt(question, sources) }).text;
    const report = this.gate.evaluate(raw, sources);
    if (report.groundedSentences.length === 0) {
      return { mode, status: 'refused', text: REFUSAL_TEXT, droppedSentences: report.droppedSentences };
    }
    const grounded = report.groundedSentences.join(' ');
    if (mode === 'hint') {
      return { mode, status: 'answered', text: this.redactor.redact(grounded, question), droppedSentences: report.droppedSentences };
    }
    return { mode, status: 'answered', text: grounded, droppedSentences: report.droppedSentences };
  }
}
```

Important: hint mode makes exactly one LLM call (for the complete answer), never a "vague" prompt. buildPrompt always requests a complete answer:

```ts
function buildPrompt(question: string, sources: string[]): string {
  return [
    'You are a game guide assistant. Answer the player question using ONLY the provided wiki pages.',
    'If the pages do not contain the answer, say so. Do not invent items, quantities, or places.',
    '',
    'Wiki pages:',
    ...sources.map((s, i) => `--- Page ${i + 1} ---\n${s}`),
    '',
    `Player question: ${question}`,
  ].join('\n');
}
```

Wait — "If the pages do not contain the answer, say so." — but the gate drops ungrounded sentences anyway; if the LLM says "The pages do not contain the answer", that sentence would be dropped (vocab) → refusal. Consistent.

#### Judges

```ts
export interface JudgeVerdict {
  score: number; // 0..1
  findings: string[];
}

export class HelpfulnessJudge {
  judge(answer: string, expected: { question: string; expectedFacts: string[]; expectedOutcome: 'answer' | 'refusal' }): JudgeVerdict {
    const isRefusal = answer.trim() === REFUSAL_TEXT || /not covered by my sources/i.test(answer);
    if (expected.expectedOutcome === 'refusal') {
      return isRefusal ? { score: 1, findings: [] } : { score: 0, findings: ['expected a refusal (sources lack the answer) but got an answer'] };
    }
    if (isRefusal) return { score: 0, findings: ['refused although the sources cover the question (useless refusal)'] };
    const facts = expected.expectedFacts;
    if (facts.length === 0) return { score: 1, findings: [] };
    const present = facts.filter((f) => factPresent(f, answer));
    return { score: present.length / facts.length, findings: facts.filter(f => !factPresent(f, answer)).map(f => `missing expected fact: ${f}`) };
  }
}
```

`factPresent(fact, answer)`: normalize both (lowercase, digits ↔ number words), then check that all tokens of the fact appear in the answer's token set. Let me write:

```ts
function normalizeForFacts(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/\d/g, (d) => NUMBER_WORDS_REV[Number(d)] ?? d) // "4" -> "four"? careful multi-digit
  )
}
```
Simpler: tokenize both into words; map each token: if it's a number word → digit; if it's a digit → number word. Then check the fact's token set ⊆ answer's token set.

```ts
function factPresent(fact: string, answer: string): boolean {
  const factTokens = new Set(normalizeTokens(fact));
  const answerTokens = normalizeTokens(answer);
  for (const t of factTokens) if (!answerTokens.includes(t)) return false;
  return true;
}
function normalizeTokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? []
    .map(t => /^\d+$/.test(t) ? (NUMBER_WORDS_REV[t] ?? t) : (NUMBER_WORDS[t] ?? t));
}
```
NUMBER_WORDS_REV: { '1': 'one', '2': 'two', ... '10': 'ten' }.

So fact "4 ember shards" → tokens [four, ember, shard(s)...] — "shards" stays "shards"; the answer "four ember shards" → has "shards" ✓. If the answer is "4 ember shards" → normalized to "four" ✓.

FaithfulnessJudge:

```ts
export class FaithfulnessJudge {
  judge(answer: string, ctx: { sources: string[]; falseFacts: string[] }): JudgeVerdict {
    const findings: string[] = [];
    let checks = 0; let violations = 0;
    for (const ff of ctx.falseFacts) {
      checks++;
      if (factPresent(ff, answer)) { violations++; findings.push(`contains a fact the sources do not support: ${ff}`); }
    }
    // strict quantities
    for (const q of checkQuantities(answer, ctx.sources)) {
      checks++;
      if (!q.grounded) { violations++; findings.push(q.reason ?? 'quantity not supported'); }
    }
    // proper nouns
    for (const pn of extractProperNouns(answer)) {
      checks++;
      if (!ctx.sources.some((s) => new RegExp(`\\b${escapeRegExp(pn)}\\b`, 'i').test(s))) {
        violations++; findings.push(`mentions "${pn}" which is not in the sources`);
      }
    }
    const score = checks === 0 ? 1 : 1 - violations / checks;
    return { score, findings };
  }
}
```

Note: extractProperNouns on the full answer — the sentence-start skip is per-sentence; for the full answer, only the first token of the whole answer is skipped. A proper noun at the start of the second sentence would be treated as a single proper noun (e.g. "The Ember Gate stands. Hollow Vale is..." — "Hollow Vale" is a sequence anyway). Edge cases are acceptable; but better: run per sentence and union. Let me do that: `splitSentences(answer).flatMap(extractProperNouns)`, dedup.

Refusal answer: "not covered by my sources" → no proper nouns, no quantities, false facts absent → score 1 ✓.

The lie text with sources: "To open the Ember Gate, farm five moon shards in the Dusk Caverns. Offer the Moon Blade to the altar and the gate opens."
- falseFacts: ["five moon shards", "moon shards", "Dusk Caverns", "Moon Blade"] — factPresent("five moon shards", answer) → tokens five, moon, shard ✓ present → violation.
- quantities: pair (5, shard) source [4,4] → violation.
- proper nouns: Dusk Caverns, Moon Blade → 2 violations.
- Ember Gate → present in source ✓ no violation.
checks = 4 + 1 + 4 (proper nouns: Ember Gate, Dusk Caverns, Moon Blade — 3? "Ember Gate" sequence, "Dusk Caverns", "Moon Blade" → 3) → checks = 4+1+3 = 8, violations = 1+1+2 = 4 → score 0.5. Low-ish. Hmm, 0.5 — is that "low"? For the acceptance "a scripted confident lie scores low", the end-to-end scenario score is min(helpful, faithful). For the lie scenario end-to-end: the gate already refused → answer = refusal → helpfulness 0 (answer expected) → final 0. That's the "low". For the direct judge test on the lie text, I'll assert faithful score < 0.5 (or ≤ 0.5) and that findings mention the quantity mismatch and invented items. Actually 4/8 = 0.5. Let me make the test assert `score < 0.5`... it's exactly 0.5. Let me assert `<= 0.5` and assert specific findings. Or add more false facts to lower it. Let me include falseFacts: ["five moon shards", "moon shards from the dusk caverns", "moon blade"] — factPresent("moon shards from the dusk caverns") → tokens: moon, shard, from, dusk, cavern → all in the answer? "farm five moon shards in the Dusk Caverns" → moon ✓ shard ✓ dusk ✓ cavern ✓ → violation. Now checks = 3 false facts + 1 quantity + 3 pns = 7, violations = 3+1+2 = 6 → score 1/7 ≈ 0.143. That's clearly low ✓. And the test asserts the quantity finding contains "5" and "4".

Hmm, but wait: in the harness, the scenario's falseFacts are planted — the judge checks that the answer doesn't contain them. In the correct answer scenario, falseFacts = ["five ember shards", "dusk caverns", "moon blade"] — the correct answer contains none → 0 violations ✓.

#### Harness

```ts
export interface GoldenScenario {
  id: string;
  description: string;
  question: string;
  sources: string[];
  expectedOutcome: 'answer' | 'refusal';
  expectedFacts: string[];
  falseFacts: string[];
  scriptedAnswer: string; // what the fake LLM returns for this scenario
}

export interface ScenarioResult {
  id: string;
  answer: string;
  status: 'answered' | 'refused';
  helpful: number;
  faithful: number;
  score: number;
  findings: string[];
  droppedSentences: string[];
}

export class EvalHarness {
  constructor(private readonly opts: { passThreshold?: number } = {}) {}

  buildScriptedLlm(scenarios: GoldenScenario[]): ScriptedLlmClient {
    return new ScriptedLlmClient(
      scenarios.map((s) => ({ match: s.question, reply: s.scriptedAnswer })),
      'not covered by my sources',
    );
  }

  run(scenarios: GoldenScenario[], service: AnswerService): ScenarioResult[] {
    const helpfulJudge = new HelpfulnessJudge();
    const faithJudge = new FaithfulnessJudge();
    return scenarios.map((s) => {
      const result = service.answer(s.question, s.sources, 'full');
      const helpful = helpfulJudge.judge(result.text, s);
      const faithful = faithJudge.judge(result.text, { sources: s.sources, falseFacts: s.falseFacts });
      const score = Math.min(helpful.score, faithful.score);
      return {
        id: s.id,
        answer: result.text,
        status: result.status,
        helpful: helpful.score,
        faithful: faithful.score,
        score,
        findings: [...helpful.findings, ...faithful.findings],
        droppedSentences: result.droppedSentences,
      };
    });
  }
}
```

ScriptedLlmClient matching: prompt.includes(question) — the prompt contains "Player question: <question>" ✓. Note: could one question be a substring of another? My questions are distinct enough.

#### Scenarios module

```ts
export const GATE_PAGE = `The Ember Gate.
The Ember Gate is a sealed arch in the Hollow Vale. It opens when four ember shards are placed on its four braziers. The shards glimmer faintly at dawn.`;

export const SHARDS_PAGE = `Ember Shards.
Ember Shards are forged by heating cinder glass over a flame until it turns gold. Gather four ember shards and the gate opens.`;
```

Wait — "Gather four ember shards and the gate opens." — pair (4, shard) ✓.

Scenarios:

1. id 'grounded-answer':
question: 'How do I open the Ember Gate?'
sources: [GATE_PAGE, SHARDS_PAGE]
expectedOutcome: 'answer'
expectedFacts: ['four ember shards', 'Hollow Vale', 'braziers']
falseFacts: ['five ember shards', 'Dusk Caverns', 'Moon Blade']
scriptedAnswer: 'The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.'

Check expectedFacts in the final answer: 'four ember shards' ✓ (tokens four, ember, shard — answer has "four ember shards," → shard ✓). 'Hollow Vale' → hollow ✓ vale ✓. 'braziers' ✓. Helpfulness 3/3 = 1.
Faithfulness: false facts absent: 'five ember shards' → tokens five ✗ (answer has four) → absent ✓. 'Dusk Caverns' absent ✓. 'Moon Blade' absent ✓. Quantities: pairs (4,shard) grounded ✓, (4,brazier) grounded ✓ (source "four braziers" ✓). Proper nouns: Ember Gate ✓ source, Hollow Vale ✓ source. Violations 0 → 1. Score 1 → high ✓.

Wait — the answer's "Ember Gate": the sentence "The Ember Gate stands in the Hollow Vale." — the proper noun extractor: sequences "Ember Gate" and "Hollow Vale" ✓ both in sources.

Hmm, one more gate check on sentence 1: bare numbers: none ✓. Containment 0.8 ✓.

2. id 'confident-lie':
question: 'How do I open the Ember Gate?'
sources: [GATE_PAGE, SHARDS_PAGE]
expectedOutcome: 'answer'
expectedFacts: ['four ember shards', 'Hollow Vale']
falseFacts: ['five moon shards', 'moon shards', 'Dusk Caverns', 'Moon Blade']
scriptedAnswer: 'To open the Ember Gate, farm five moon shards in the Dusk Caverns. Offer the Moon Blade to the altar and the gate opens.'

Gate drops both → refusal. Helpfulness: answer expected, got refusal → 0. Faithfulness (refusal text): 0 violations → 1. Score 0 → low ✓. Test asserts score < 0.2 and status 'refused'.

Hmm — but a subtle point: the scenario 1 and 2 questions are identical. The ScriptedLlmClient matches `prompt.includes(question)` — both scenarios have the same question → the fake can't distinguish them by question! Conflict: the harness's buildScriptedLlm maps each scenario to {match: question, reply: scriptedAnswer}; scenario 2's find() would match scenario 1's script first (same question) → wrong reply!

Fix: key the script by a unique prompt discriminator. Options:
- Include a scenario-specific marker in the prompt? No — the production prompt shouldn't know about scenarios.
- Make ScriptedLlmClient match on the full prompt? The prompt is identical across the two scenarios (same question, same sources) → still ambiguous.
- Use different questions in the two scenarios. Simplest: scenario 2's question: 'What do I need to open the Ember Gate?' — different string ✓. Let me do that. The lie is about the same gate, but phrased differently. Fine.

Actually wait, this ambiguity is also a realistic concern: the fake "must return a specific answer per scenario". Matching by the question substring is the documented mechanism; I'll make the scenario questions unique. ✓.

Let me re-verify scenario 2 gate with question 'What do I need to open the Ember Gate?' — the gate doesn't use the question. ✓.

3. id 'sources-lack-answer':
question: 'How do I heal my party outside of combat?'
sources: [GATE_PAGE, SHARDS_PAGE]
expectedOutcome: 'refusal'
expectedFacts: []
falseFacts: ['Waystone Shrine', 'moonlight salve']
scriptedAnswer: 'Rest at the Waystone Shrine to fully heal your party.'

Gate: proper noun Waystone Shrine not in source → dropped; containment 0 → dropped. → refusal.
Helpfulness: expected refusal, got refusal → 1. Faithfulness: refusal, false facts absent → 1. Score 1 ✓ "scored as correct".

4. id 'quantity-mismatch':
question: 'How many ember shards do I need for the Ember Gate?'
sources: [GATE_PAGE, SHARDS_PAGE]
expectedOutcome: 'answer'
expectedFacts: ['four ember shards']
falseFacts: ['five ember shards']
scriptedAnswer: 'The Ember Gate is in the Hollow Vale. You need five ember shards to open it.'

Gate: sentence 1 survives; sentence 2: pair (5,shard) vs [4,4,4] → dropped; bare 5 ∉ {4} → dropped; containment 0.4 < 0.5 → dropped.
→ answered: 'The Ember Gate is in the Hollow Vale.'
Helpfulness: fact 'four ember shards' missing → 0/1 = 0. Hmm! Score = min(0, 1) = 0. Is that OK? The service refused to state the quantity (refused the false one), but then the final answer has no quantity → judged unhelpful. That's arguably correct (the answer didn't provide the needed fact). But the acceptance item is "caught exactly" — the harness result should show a finding: dropped sentence 'You need five ember shards to open it.' and the faithfulness judge on the raw scripted text flags '5 vs 4'. In the test I'll assert: result.droppedSentences deep-equals ['You need five ember shards to open it.'], and a separate direct check: faithJudge.judge(raw, {sources, falseFacts}) has a finding matching /5 .* 4|five.*four/ and the quantity check structure.

Hmm, wait. Actually, let me reconsider: is it right to have expectedOutcome 'answer' here with a score of 0? The acceptance list: "5 shards against sources saying 4 → caught, exactly." The catch is the drop + the finding. The score being 0 reflects that the shipped answer lacks the key fact — which is honest. I think that's fine, and I'll document it in the scenario's description: "a wrong quantity is dropped, leaving an incomplete answer; the finding must name 5 vs 4."

Alternatively I could make the scripted answer's second sentence "You need five ember shards and the gate opens." Same thing. Keep as is.

Actually, hmm, let me reconsider scenario 4 expectedFacts: to make the test clearer, I'll keep expectedFacts ['four ember shards'], and in the test I'll assert:
- status 'answered' (a partial drop, not a refusal)
- droppedSentences contains exactly the five-shards sentence
- the text does not contain 'five'
- the direct faithfulness finding: I'll use checkQuantities directly, or the judge on the raw text: `faithful.findings` in the harness run (which is judged on the final answer, not the raw) — the final answer has no quantities → no quantity finding! The "caught exactly" evidence must come from the gate's drop + the judge on the raw text. Let me add a dedicated test in the eval spec: run FaithfulnessJudge on the raw lie/quantity text and assert the finding text contains '5' and '4' (or 'five'/'four'). Actually the reason string: `answer says 5 shard(s) but sources say 4 or 4` — hmm "4 or 4" is ugly; dedupe sourceQuantities: [...new Set(...)]. → 'answer says 5 shards but sources say 4'. Let me format it: `` `answer says ${pair.quantity} ${pair.noun} but sources say ${[...new Set(qs)].join(' or ')}` `` — for the noun plural: use the raw noun form from the pair? The pair.noun is singular; raw "five ember shards" — I'll store the `noun` singular and use it as-is in the message: 'answer says 5 shard but sources say 4' — grammatically awkward. Use raw: store `raw` in QuantityPair: 'five ember shards'. Message: `answer says "${raw}" but sources say ${qs} ${noun}(s)`. Let me make the reason: `quantity mismatch: answer says "${pair.raw}" but sources only support [4] for "${pair.noun}"`. I'll define:

reason = `sources say ${uniqueQs.join(' or ')} ${pair.noun}${pair.noun.endsWith('s') ? '' : 's'} but the answer says ${pair.quantity}` — simpler: `answer claims ${pair.quantity} ${pair.rawNoun} but sources say ${uniqueQs.join(' or ')} for that item`. Hmm. Let me just do:

- noun absent: `"${noun}" does not appear in the sources`
- no quantity in source: `sources never state how many ${noun}s there are`
- mismatch: `answer says ${quantity} ${noun}${plural} but sources say ${uniqueQs.join(', ')}`

Test asserts the mismatch reason contains '5' and '4'. ✓ "caught exactly".

Now — the bare number check and quantity pair check may double-report for the same number ("5 shards": pair violation + bare number 5 ∉ {4} violation). Both reasons in the gate — fine (redundant but harmless). In the faithfulness judge, I count only pair checks + pns + false facts (not bare numbers) to keep the score interpretable. Fine.

#### Tests

test/answer.service.spec.ts:
1. "drops ungrounded sentences and keeps grounded ones (partial drop)" — scenario 4 fixture via the service with a scripted fake; assert text, droppedSentences.
2. "refuses when nothing survives (sources lack the answer)" — scenario 3; assert text === REFUSAL_TEXT, status 'refused'.
3. "returns the grounded answer verbatim in full mode" — scenario 1; assert text matches the scripted (since everything is grounded), status 'answered'.
4. "quantity mismatch is caught exactly: 5 vs 4" — service with scripted 'You need five ember shards to open the Ember Gate.' → refused; also gate.evaluate → verdict reasons include the mismatch with 5 and 4; checkQuantities on that sentence → grounded false, sourceQuantities [4].
5. "hint mode makes exactly one LLM call" — use a counting LLM client (a wrapper) to assert complete was called once; and the hint text is the redacted grounded answer.
6. hint mode output: boss name, location, quantity all absent.

test/hint-redactor.spec.ts:
1. "redacts a boss name, a location and a quantity" — the spec-required test: input sentence with all three; assert all gone.
2. "keeps quantities the player already mentioned" — question has 'three'; 'three' in output.
3. "redacts digit quantities" — "4 shards" → "[redacted] shards".
4. "leaves common nouns intact" (sanity, don't over-redact).

test/eval-harness.spec.ts:
1. "a scripted confident lie scores low" — run suite; find 'confident-lie'; score < 0.2 (it's 0); status refused.
2. "a correct grounded answer scores high" — 'grounded-answer' score >= 0.9 (it's 1).
3. "sources lacking the answer → refusal scored as correct" — 'sources-lack-answer' score >= 0.9, status refused.
4. "quantity error caught exactly" — 'quantity-mismatch': droppedSentences deep-equals the false sentence; and the faithfulness judge on the raw scripted text produces a finding containing '5' and '4'; also `faithful` on the final answer = 1 and the finding is on the drop side... let me assert the raw judge: `new FaithfulnessJudge().judge(raw, { sources, falseFacts }).findings` some(/answer says 5 ... 4/) — I'll assert it matches /5/ and /4/.
5. "the faithfulness judge signature takes the sources" — compile-time: the type requires `sources`. Test: the same lie text scores differently with vs. without... the signature always requires sources; I'll write a test that documents it: `const v = faithJudge.judge(lieText, { sources: [], falseFacts: [] })` → with empty sources, everything is a violation → very low score; with real sources → the quantity finding is present. Hmm, with empty sources: pairs (5,shard): nounFound false → violation; pns: Ember Gate, Dusk Caverns, Moon Blade → 3 violations; checks 1+3=4, violations 4 → 0. And with sources: 0.143. Both low, but the test asserts that the finding for the quantity mismatch exists only when sources are provided. That demonstrates the source dependence.
6. "the final score is the min of the two judges" — construct a scenario where helpful > faithful (the lie text ungated?). In the harness, the final answer is always gated... to test the min combining directly, use the judges on a chosen text: e.g. the quantity scenario: helpful=0, faithful=1 → min 0 ✓ trivial. Better: test the harness's score computation on a scenario where faithful < helpful: the lie scenario: helpful 0, faithful 1 → min 0. Hmm, that's the helpful side. To get faithful < helpful, I need an answer that contains a false fact yet also contains the expected facts, that survived the gate — but the gate would drop the false-fact sentence... I could add a golden scenario: 'mixed' — scripted answer: sentence 1 grounded and covers the fact; sentence 2 contains a planted false fact that the gate... would drop. Hmm — then the final answer is clean → faithful 1.

Alternative: test the min combining at the judge level: take a text that's unhelpful but faithful, and one that's helpful but unfaithful, and assert that `min()` is used in the harness code — a unit test of the combine? The combine is `Math.min(helpful.score, faithful.score)` inline in run(). I could expose a pure function `combineScores(helpful, faithful)` in the harness and unit-test it: min(0.9, 0.2) = 0.2, etc. A small but real behavior test (the "averaging lets the second one hide" — min prevents that). I'll add `combineScores` as an exported pure function and test it. Plus the end-to-end lie scenario demonstrates the low score.

Actually — I can craft a harness scenario where faithful < helpful: a scripted answer that is fully grounded per the gate (so it survives), expectedFacts mostly present (helpful high), but contains a planted false fact that the gate can't catch? The gate is strict... e.g. false fact "the gate opens at dawn" — wait, the source says "The shards glimmer faintly at dawn" — "the gate opens at dawn" — tokens: gate, opens, dawn — all in sources! The sentence "The gate opens at dawn." — gate check: containment 3/3=1 ✓, no numbers, no pns → survives! But factually it misattributes (shards glimmer at dawn, not the gate opens). The faithfulness judge's token-level checks would also let it through (it's a token-level judge, same limitations). Hmm — that exposes that my judge can't catch misattributions without deeper semantics. That's inherent to a heuristic harness; the planted false facts in the scenarios are the entity/quantity kind, which the checks catch. I won't add the 'mixed' scenario — instead, the combineScores unit test + the lie scenario suffices for "min combining". Keep scope tight.

Wait, actually, I realize I should double-check the "helpfulness judge" for the lie scenario in the harness: answer = REFUSAL_TEXT, expectedOutcome 'answer' → 0 ✓. And faithfulness on the refusal: checks = 4 false facts (all absent) + 0 quantities + 0 pns = 4 checks, 0 violations → 1.0. min = 0 ✓.

Also verify scenario 3's false fact: 'Waystone Shrine' — in the refusal text? No ✓. 'moonlight salve' — factPresent: tokens moonlight, salve — not in refusal ✓.

Now, let me verify the faithfulness judge on scenario 1's final answer:
answer: 'The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.'
- falseFacts: 'five ember shards' → tokens five, ember, shard → five not in answer ✓ absent. 'Dusk Caverns' absent ✓. 'Moon Blade' absent ✓.
- Quantities: extractQuantityPairs(answer): 'four ember shards' → (4, shard); 'four braziers' → (4, brazier). Both grounded in sources ✓ (source pairs: shard: [4,4] from "four ember shards" ×2 (page A + B), brazier: [4]).
- Proper nouns: Ember Gate, Hollow Vale → both in sources ✓.
- checks: 3 + 2 + 2 = 7, violations 0 → 1.0 ✓.

Helpfulness: facts 'four ember shards' → tokens four, ember, shard ⊆ answer ✓; 'Hollow Vale' ✓; 'braziers' → token braziers ⊆ answer ✓. 3/3 = 1. Score 1 ✓.

Scenario 4 final: 'The Ember Gate is in the Hollow Vale.'
- helpfulness: 'four ember shards' missing → 0/1 = 0.
- faithfulness: falseFact 'five ember shards' absent ✓; quantities: none in the final text; pns: Ember Gate, Hollow Vale ✓ → 1/1 = 1.
- score min(0,1) = 0. Test asserts: droppedSentences == ['You need five ember shards to open it.'], status 'answered', and raw judge finding contains 5 and 4.

Hmm, wait — one more consideration for scenario 4: is it OK that the final score is 0? The acceptance "5 shards against sources saying 4 → caught, exactly" is about detection, not scoring. And the test explicitly checks the drop + finding. I'm satisfied. I'll set the scenario description accordingly.

Now — ScriptedLlmClient's fallback: 'not covered by my sources'? If a scenario's question isn't matched, the LLM returns refusal-like text, which the gate drops (vocab) → refusal. Fine.

Now let me think about `checkQuantities` for a sentence like "You need four ember shards, placed on its four braziers." extractQuantityPairs regex on that:
- /(\d+|word)(?:\s+[a-z]+)?\s+([a-z]+)s?\b/gi — let me write the exact regex:

```ts
const QUANTITY_RE = /\b(\d{1,3}|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:[a-z][a-z'-]*\s+)?([a-z][a-z'-]*)s?\b/gi;
```

Test: "four ember shards" → group1 'four', modifier 'ember', noun 'shards' ✓. "four braziers" → no modifier ('placed'? no — "on its four braziers": after 'four' is 'braziers' → modifier optional group tries 'braziers'? then noun needed — fails; backtrack: no modifier, noun 'braziers' ✓). Wait, the regex is greedy: `(?:[a-z][a-z'-]*\s+)?` tries to consume 'braziers ' — but then `([a-z]...)\b` needs another word — after "braziers" is end/period. 'braziers ' has a trailing space; the modifier group `[a-z][a-z'-]*\s+` requires a following word for the noun → fails → backtracks to no modifier → noun 'braziers' ✓.

Hmm, but a subtlety: "four ember shards and the gate" — could the regex match "four ... and the"? modifier 'ember', noun 'shards' matches first (leftmost, greedy but anchored at 'four'). Regex scanning: at 'four' position: try with modifier 'ember', noun 'shards' → match "four ember shards" ✓ (that's the first match; the regex continues after). Good.

Dangerous case: "You need 5 to survive" → '5' + no modifier + noun 'to'? 'to' is [a-z]+ → noun 'to'! Then checkQuantities: noun 'to' not in source → ungrounded → the sentence is dropped. Hmm, is that a false positive? "You need 5" — well, a bare number claim "need 5" without a unit is indeed unverifiable; the gate dropping is safe (safe direction: drop the unproven). But it could over-drop legitimate sentences like "You need 4" (when the source says four)... "You need 4 to unlock the gate" → pair (4, 'to')?? No wait: the regex at '4': modifier? 'to' — `(?:[a-z][a-z'-]*\s+)?` tries 'to ' then noun 'unlock'? → (4, unlock)! Ugh. That's noisy.

Let me constrain: the modifier and noun must not be stopwords. Implementation: after matching, filter: noun not in STOPWORDS (and modifier not required). So: match the regex; if the captured noun is a stopword ('to', 'and', 'the', ...), try the alternative: number directly followed by non-stopword noun... this is getting complex.

Alternative simpler design: extractQuantityPairs = number + optional single modifier + noun, where the noun is not a stopword; if the raw next word after the number is a stopword, then no pair (just a bare number check). Let me implement manually instead of with a regex:

```ts
export function extractQuantityPairs(text: string): QuantityPair[] {
  const tokens = (text.match(/[A-Za-z0-9'-]+/g) ?? []);
  const pairs: QuantityPair[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i]!;
    const qty = toNumber(raw);
    if (qty === null) continue;
    const nounTok = tokens[i + 2] !== undefined ? tokens[i + 2] : tokens[i + 1];
    // hmm, need: if tokens[i+1] is a non-stopword word and tokens[i+2] is a non-stopword word → modifier=tokens[i+1], noun=tokens[i+2]
    // else if tokens[i+1] is a non-stopword word → noun = tokens[i+1]
  }
}
```
Wait, that's also ambiguous: "four ember shards": tokens: four, ember, shards → modifier 'ember', noun 'shards' ✓. "four braziers": tokens four, braziers → modifier? 'braziers' is a non-stopword word; then is there a tokens[i+2]? If the sentence continues "four braziers at the base" → tokens: four, braziers, at, the, base → my rule: tokens[i+1]='braziers' (non-stopword) and tokens[i+2]='at' (stopword) → so noun = tokens[i+1] = 'braziers' ✓ (rule: if the next-next is a stopword, treat the next as the noun). But "four ember shards" → next 'ember' non-stopword, next-next 'shards' non-stopword → modifier+noun ✓. And "You need 5 to survive": next 'to' stopword → no pair (just a bare number) ✓. And "need 4 the gate" → next '4'... tokens: need, 4, the, gate → next 'the' stopword → no pair; bare number 4 checked against sources ✓ (4 ∈ sources → fine, sentence survives the number check; containment decides).

Rule:
```ts
const a = tokens[i + 1]; // word right after the number
const b = tokens[i + 2];
let noun: string | undefined;
let modifier: string | undefined;
const isWord = (t: string | undefined) => !!t && /^[A-Za-z][A-Za-z'-]*$/.test(t) && !STOPWORDS.has(t.toLowerCase());
if (isWord(a) && isWord(b)) { modifier = a; noun = b; }
else if (isWord(a)) { noun = a; }
if (noun) {
  const singular = singularize(noun.toLowerCase());
  pairs.push({ quantity: qty, noun: singular, raw: raw + (modifier ? ` ${modifier} ` : ' ') + noun ... });
}
```
Hmm wait, "four ember shards" — a='ember', b='shards' both words → modifier ember, noun shards ✓. But consider "five moon shards in the Dusk Caverns": at 'five': a='moon', b='shards' → (5, shard) ✓. At 'Dusk'... not a number. Good.

But consider "four braziers at the base of the gate": a='braziers', b='at' (stopword) → noun='braziers' ✓. And "placed on its four braziers. The" → a='braziers', b='The' — 'The' is not a stopword (capitalized!) → modifier='braziers', noun='The'?? noun.toLowerCase()='the' → stopword → reject: if noun.toLowerCase() is a stopword → fall back: noun = a (modifier becomes undefined). Let me add: after computing, if STOPWORDS.has(noun.toLowerCase()) → noun = modifier; modifier = undefined; then if noun is stopword → no pair. So "four braziers. The" → a='braziers', b='The' → modifier='braziers', noun='the' → stopword → fallback noun='braziers' ✓.

singularize: if len>3 and ends with 's' → slice(0,-1). 'braziers'→'brazier' ✓, 'shards'→'shard' ✓, 'glass'→'glas'? 'glass' — if used as a noun after a number ("two glass"?) unlikely. Fine.

raw: `${raw}${modifier ? ` ${modifier}` : ''} ${noun}` where noun is the original-cased token. I'll store raw for messages: e.g. 'five ember shards'.

Edge: the number token itself is 'four' spelled out — toNumber: NUMBER_WORDS[raw.toLowerCase()] or /^\d{1,3}$/ → parseInt.

OK. Bare numbers via extractNumbers (digits + number words) — same tokenization.

Now the source index for checkQuantities: sourcePairs from all sources via the same extractor. Page A: "It opens when four ember shards are placed on its four braziers." tokens: ... four, ember, shards, are (stopword? 'are' yes), placed, on (stop), its (stop), four, braziers, . → at 'four' #1: a='ember', b='shards' → (4,shard) ✓. at 'four' #2: a='braziers', b='.'? tokenization [A-Za-z0-9'-]+ excludes '.', so b = next word 'The'? "braziers. The shards glimmer" → a='braziers', b='The' → noun 'the' stopword → fallback noun='braziers' ✓ (4,brazier).

Page B: "Gather four ember shards and the gate opens." → (4,shard) ✓. "heating cinder glass over a flame" — no numbers.

So source shard quantities: [4,4] → unique [4]. Mismatch message: 'answer says 5 but sources say 4'. Let me finalize the reason format:

- noun absent: `"${noun}" never appears in the sources`
- noun present, no quantities: `sources never state a quantity for "${noun}"`
- mismatch: `answer says ${quantity} ${noun} but sources say ${uniqueQs.join(' or ')}`

Test: expect(reason).toMatch(/5/) and /4/. ✓

Now the bare-number check uses extractNumbers(sentence) — includes 'four' etc. Scenario 4 sentence 2: numbers [5]; source numbers: page A [4,4], page B [4] → {4}. 5 ∉ → reason 'the number 5 does not appear in any source' ✓ (plus the pair mismatch). Two reasons — fine.

Wait, note: source numbers via extractNumbers(GATE_PAGE) — 'The Ember Gate.' no digits. "four ember shards... four braziers" → 4,4 ✓. Also 'Page'... no. OK.

Hmm, one more: extractNumbers' regex `\b(\d{1,3})\b|\b(...number words...)\b` — '2024'? \d{1,3} with \b wouldn't match '2024' (4 digits: '202' followed by '4' — \b between 2 and 4? both digits → no boundary → no match at position 0; at position 1: '024' → preceded by digit → \b fails. So 2024 matches nothing → good, we don't check 4-digit years... well, fine).

Now the proper noun extractor — one more check for scenario 2 sentence 1: "To open the Ember Gate, farm five moon shards in the Dusk Caverns." Sequences: 'Ember Gate' — regex `\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b` on "Ember Gate,": 'Ember' + ' Gate' ✓ → 'Ember Gate' (comma not consumed — `\b` after 'Gate' before ','? 'Gate,' — G-a-t-e then ','; \b between 'e' and ',' ✓. m[0]='Ember Gate' ✓). 'Dusk Caverns' ✓. Stripped text: "To open the  , farm five moon shards in the ." → single capitals: none ('To' is the first token — skipped anyway). → proper nouns: Ember Gate, Dusk Caverns. Ember Gate is in source ✓; Dusk Caverns not → reason ✓.

Scenario 3: "Rest at the Waystone Shrine to fully heal your party." → sequence 'Waystone Shrine' → not in source → dropped ✓.

Now the single-capital path: tokens after stripping sequences; skip i=0. "The Matriarch guards..." → Matriarch captured ✓.

Edge: all-caps or mixed like "MOON"? I'll ignore.

Now the redactor's numbers: after proper noun redaction, replace number tokens:
- Digits: /\b\d{1,3}\b/g → if not allowed, replace with '[redacted]'.
- Number words: /\b(zero|one|...)\b/gi → if not allowed, replace.
Order: do this last. But note: the word 'one' might appear in "one" as part of... fine.

Also the redactor should preserve sentence punctuation and spacing. I'll implement per-sentence:

```ts
redact(text, question): string {
  const allowed = new Set(extractNumbers(question));
  return splitSentences(text)
    .map((s) => this.redactSentence(s, allowed))
    .join(' ');
}

private redactSentence(sentence: string, allowed: Set<number>): string {
  let out = sentence;
  // 1) multi-word proper nouns
  out = out.replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, '[redacted]');
  // 2) single proper nouns (not at sentence start)
  const tokens = out.split(/(\s+)/);
  for (let i = 1; i < tokens.length; i++) {
    const bare = (tokens[i] ?? '').replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
    if (/^[A-Z][a-z]{2,}$/.test(bare)) tokens[i] = (tokens[i] as string).replace(bare, '[redacted]');
  }
  out = tokens.join('');
  // 3) quantities not in the player's question
  out = out.replace(/\b\d{1,3}\b/g, (m) => (allowed.has(Number(m)) ? m : '[redacted]'));
  out = out.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, (m) => {
    const v = NUMBER_WORDS[m.toLowerCase()];
    return v !== undefined && allowed.has(v) ? m : '[redacted]';
  });
  return out;
}
```

Wait, issue: after sequence replacement, "The [redacted] guards the [redacted] and demands four ember shards." then single pass: tokens: 'The' (i=0), '[redacted]' → bare '' no match ✓, 'guards', 'the', '[redacted]' ✓ no match... good. 'four' → number word, not allowed → '[redacted]' ✓.

But hmm — the single-capital pass runs on the text that already contains '[redacted]' from sequences; a sequence might end right before a single capital, creating a new sentence start? No — sequences don't span sentence boundaries (a '.' would break the [A-Z][a-z]+ chain? "Gate. Hollow" — 'Gate.' — the sequence regex needs \s+ then [A-Z][a-z]+ — "Gate." followed by space followed by "Hollow": 'Gate' then '.' — the sequence match 'Ember Gate' stops at 'Gate' (the '.' isn't in [a-z]). Then 'Hollow Vale' is a separate sequence ✓. If a sentence starts with a single capital: "Matriarch rules the [redacted]." → tokens: 'Matriarch' is i=0 → skipped → not redacted! A boss name at sentence start survives. Ugh. Fix: the gate/redactor's proper noun extraction should treat sentence-initial multi-word... no wait, single capitals at sentence start: "Hollow Vale is..." — that's a sequence (two capitals) → caught by the sequence regex ✓. A single proper noun at sentence start: "Matriarch rules here." — rare in answers (usually "The Matriarch"). But the spec's redaction test uses "The Hollow Matriarch..." style. To be safe: in the redactor, treat the first token as a redaction candidate only if it looks like a proper noun and the sentence doesn't start with an article? Too clever. Alternative: I'll document the rule: sentence-initial single words are kept (indistinguishable from a normal capitalized start). Multi-word sequences at sentence start are redacted (they're unambiguous). My test will use "The Hollow Matriarch" (sequence) → fine.

Hmm, but for the gate's proper noun check, skipping the sentence start means "Matriarch rules here." (a sentence-initial invented boss name) wouldn't be flagged as a pn... but the containment check would likely catch it (matriarch not in sources → low overlap). Acceptable heuristic; I'll document it.

Now — one more design point: the `answer` service for hint mode: the LLM prompt is identical for both modes (no "be vague"). The test "hint mode makes exactly one LLM call": a counting client:

```ts
class CountingLlm implements LlmClient { calls = 0; complete(req) { this.calls++; return { text: '...'; } } }
```
Assert calls === 1 for mode 'hint' and the output is redacted. ✓ "No second LLM call."

Also assert the hint doesn't equal the full answer and contains '[redacted]'.

Now let me re-check the hint flow on scenario 1: grounded = 'The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.' Question 'How do I open the Ember Gate?' → no numbers in the question. Redaction:
Sentence 1: sequences: 'Ember Gate' → '[redacted]', 'Hollow Vale' → '[redacted]' → "The [redacted] stands in the [redacted]." Single capitals: none. Numbers: none. → "The [redacted] stands in the [redacted]."
Sentence 2: "You need four ember shards, placed on its four braziers." No capitals. Numbers: 'four' ×2 → not allowed → "[redacted]": "You need [redacted] ember shards, placed on its [redacted] braziers."
Final hint: "The [redacted] stands in the [redacted]. You need [redacted] ember shards, placed on its [redacted] braziers."
Spoiler-free: no boss name, no location, no quantities ✓. Item name "ember shards" is still visible (common case) — per my chosen rule, OK (item names are allowed, quantities/locations/names are redacted).

Test: the hint does not contain 'Ember Gate', 'Hollow Vale', 'four', '4'.

Now let me re-check the faithfulness judge on a scenario where the final answer is the refusal and the falseFacts are empty: checks: 0 false + 0 quantities + 0 pns = 0 → score 1 ✓ (I defined checks===0 → 1).

combineScores:
```ts
export function combineScores(helpfulness: number, faithfulness: number): number {
  return Math.min(helpfulness, faithfulness);
}
```
Test: combineScores(0.95, 0.4) === 0.4; (0.1, 0.9) === 0.1; (1,1)=1. And the narrative: averaging (0.95+0.4)/2 = 0.675 would hide the lie; min exposes it. I'll assert combineScores(0.95,0.4) < (0.95+0.4)/2.

Now let me lay out the files. Also need `escapeRegExp`:
```ts
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

File: `src/answer/text-utils.ts` — STOPWORDS, NUMBER_WORDS, splitSentences, extractNumbers, extractQuantityPairs, checkQuantities, extractProperNouns, contentWords, vocabularyContainment, escapeRegExp.

Hmm — checkQuantities is a "gate" concern; I'll put it in text-utils or the gate file. Let me put pure text/token utilities in `text-utils.ts` and the check functions in `grounding-gate.ts` (checkQuantities, checkProperNouns). vocabularyContainment in text-utils. OK.

Wait, the faithfulness judge also needs checkQuantities + proper noun check + factPresent — import from the gate/text-utils. Fine (the judge receives sources in its signature, per acceptance).

Also let me settle the `AnswerResult.droppedSentences` naming — maybe `dropped` is better. I'll keep `droppedSentences` (explicit).

Type file: `src/answer/answer.types.ts`:
```ts
export type AnswerMode = 'full' | 'hint';
export const REFUSAL_TEXT = 'not covered by my sources';
export interface AnswerResult { mode: AnswerMode; status: 'answered' | 'refused'; text: string; droppedSentences: string[]; }
export type ExpectedOutcome = 'answer' | 'refusal';
```
Hmm, ExpectedOutcome is eval-related; I'll put it in scenarios.ts. Keep answer.types for the answer side.

Now, is `AnswerService` a "service" per the convention? Yes: `src/answer/answer.service.ts`, class `AnswerService`. The gate: `src/answer/grounding-gate.ts`, class `GroundingGate`. The redactor: `src/answer/hint-redactor.ts`, class `HintRedactor`. LLM: `src/llm/llm.client.ts`, interface `LlmClient` + `ScriptedLlmClient`. Eval: `src/eval/judges.ts` (HelpfulnessJudge, FaithfulnessJudge, JudgeVerdict, combineScores), `src/eval/scenarios.ts` (GoldenScenario, GATE_PAGE, SHARDS_PAGE, GOLDEN_SCENARIOS), `src/eval/eval-harness.ts` (EvalHarness, ScenarioResult, RunReport?).

Maybe the harness also returns a suite summary: `runAll` → `{ results, passed, failed }` against a threshold (default 0.9). The 'confident-lie' scenario: expected to score low — that's a "pass" for the harness (we want it low!). Hmm — pass/fail semantics: the harness should mark each scenario against its expectation. The expected score direction varies: 'grounded-answer' expects high; 'confident-lie' expects low. So a scenario could carry an `expectation: 'high' | 'low' | 'refusal'`? That duplicates expectedOutcome... Let me think: what does "the harness scores it as such" mean — the harness must score the refusal scenario as correct (high). And the lie scenario as incorrect (low). Both are "the harness works correctly." For per-scenario pass/fail, I'll derive: if expectedOutcome 'refusal' → pass iff score ≥ threshold. If 'answer' → pass iff score ≥ threshold — but the 'confident-lie' and 'quantity-mismatch' have expectedOutcome 'answer' and will score 0 → "fail." That's semantically right: those scenarios demonstrate a bad model output; the harness correctly scores them low. The harness's job is to detect bad answers — a low score for the lie IS the harness working. So "pass" = "the harness behaved as designed" — confusing. I'll avoid pass/fail in the harness; I'll just return the scores, and the tests assert per-scenario expectations. Cleaner. `run` returns ScenarioResult[]; that's it. No threshold logic — less invention, less to test, matches "scored as such."

Now the README? "Do not create a file it does not call for" — skip the README. But package.json + tsconfig + vitest.config are needed to run the tests. Yes, I'll include them.

Now let me carefully write out all the code, type-checking in my head under strict + noUncheckedIndexedAccess.

Let me draft each file.

---

**package.json**

```json
{
  "name": "guide-assistant",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^2.1.9"
  }
}
```

**tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```

**vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
  },
});
```

**src/llm/llm.client.ts**

```ts
/**
 * Minimal LLM client contract. The answer pipeline depends only on this
 * interface; tests use ScriptedLlmClient so no network is involved and a
 * confident lie can be planted per scenario.
 */

export interface LlmRequest {
  prompt: string;
}

export interface LlmResponse {
  text: string;
}

export interface LlmClient {
  complete(request: LlmRequest): LlmResponse;
}

export interface ScriptedReply {
  /** Substring of the prompt (usually the player question) that selects this reply. */
  match: string;
  reply: string;
}

export class ScriptedLlmClient implements LlmClient {
  constructor(
    private readonly scripts: readonly ScriptedReply[],
    private readonly fallback: string = '',
  ) {}

  complete(request: LlmRequest): LlmResponse {
    const hit = this.scripts.find((s) => request.prompt.includes(s.match));
    return { text: hit ? hit.reply : this.fallback };
  }
}
```

**src/answer/text-utils.ts**

```ts
/** Shared tokenisation helpers used by the grounding gate, the hint redactor and the judges. */

export const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4,
  five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const NUMBER_WORD_RE = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'gi');
const DIGIT_RE = /\b\d{1,3}\b/g;

export const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'at', 'by', 'for',
  'from', 'in', 'into', 'on', 'onto', 'over', 'under', 'up', 'down', 'out', 'off',
  'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'done', 'have', 'has', 'had', 'having', 'will', 'would', 'shall', 'should', 'can',
  'could', 'may', 'might', 'must', 'to', 'that', 'this', 'these', 'those', 'it',
  'its', 'you', 'your', 'yours', 'we', 'our', 'ours', 'i', 'me', 'my', 'mine', 'he',
  'she', 'they', 'them', 'his', 'her', 'their', 'so', 'such', 'than', 'too', 'very',
  'just', 'not', 'no', 'nor', 'any', 'all', 'each', 'few', 'more', 'most', 'other',
  'some', 'until', 'against', 'between', 'through', 'during', 'before', 'after',
  'above', 'below', 'again', 'further', 'once', 'here', 'there', 'why', 'how',
  'what', 'which', 'who', 'whom', 'where', 'because', 'about',
]);

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Tokenise into words/digits (punctuation stripped). */
export function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9]+(?:'[A-Za-z]+)?/g) ?? [];
}

/** Map a token to a number if it is a digit or a small number word. */
export function toNumber(token: string): number | null {
  if (/^\d{1,3}$/.test(token)) return parseInt(token, 10);
  return NUMBER_WORDS[token.toLowerCase()] ?? null;
}

/** Every number (digit or small word) in the text. */
export function extractNumbers(text: string): number[] {
  const found: number[] = [];
  for (const t of tokenize(text)) {
    const n = toNumber(t);
    if (n !== null) found.push(n);
  }
  return found;
}

export interface QuantityPair {
  quantity: number;
  /** Singularised head noun, lowercased. */
  noun: string;
  /** The raw phrase, e.g. "five ember shards". */
  raw: string;
}

export function singularize(word: string): string {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
}

/**
 * Extract "quantity + (modifier) + noun" phrases. A modifier is only consumed
 * when a second content word follows the number ("four ember shards"); otherwise
 * the first content word is the noun ("four braziers").
 */
export function extractQuantityPairs(text: string): QuantityPair[] {
  const tokens = tokenize(text);
  const pairs: QuantityPair[] = [];
  const isContentWord = (t: string): boolean => /^[A-Za-z][A-Za-z'-]*$/.test(t) && !STOPWORDS.has(t.toLowerCase());
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    if (raw === undefined) continue;
    const quantity = toNumber(raw);
    if (quantity === null) continue;
    const a = tokens[i + 1];
    const b = tokens[i + 2];
    let modifier: string | undefined;
    let noun: string | undefined;
    if (isContentWord(a ?? '') && isContentWord(b ?? '')) {
      modifier = a;
      noun = b;
    } else if (isContentWord(a ?? '')) {
      noun = a;
    }
    // If the "noun" is actually a stopword (e.g. "four braziers. The"), fall back to the modifier slot.
    if (noun !== undefined && STOPWORDS.has(noun.toLowerCase()) && modifier !== undefined) {
      noun = modifier;
      modifier = undefined;
    }
    if (noun === undefined || STOPWORDS.has(noun.toLowerCase())) continue;
    pairs.push({
      quantity,
      noun: singularize(noun.toLowerCase()),
      raw: `${raw}${modifier !== undefined ? ` ${modifier}` : ''} ${noun}`,
    });
  }
  return pairs;
}
```

Wait, there's a problem: `tokens[i]` with noUncheckedIndexedAccess → `string | undefined`; I did `const raw = tokens[i]; if (raw === undefined) continue;`. TS: the loop `i < tokens.length` — fine.

Hmm, also `isContentWord(a ?? '')` — a: string | undefined → '' fails the regex ✓.

Edge: "four ember shards" — a='ember' ✓ b='shards' ✓ → modifier ember noun shards ✓. But wait — what about "You need four, ember shards"? A comma splits the tokens: 'four' then 'ember'... same. Fine.

Another edge: number at end of text "needs four" → a undefined → no pair ✓.

Edge: "4 ember shards" digit → same ✓.

Proper nouns:

```ts
const SEQUENCE_RE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
const SINGLE_CAP_RE = /^[A-Z][a-z]{2,}$/;

/**
 * Proper nouns in one sentence: multi-word capitalised sequences
 * ("Ember Gate", "Dusk Caverns") plus single capitalised words that are not
 * the first token of the sentence (a sentence-initial word is ambiguous with
 * normal capitalisation and is left to the vocabulary check).
 */
export function extractProperNouns(sentence: string): string[] {
  const found = new Set<string>();
  const sequences = [...sentence.matchAll(SEQUENCE_RE)];
  for (const m of sequences) found.add(m[0]);
  const stripped = sentence.replace(SEQUENCE_RE, ' ');
  const tokens = stripped.split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === undefined) continue;
    const bare = t.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
    if (SINGLE_CAP_RE.test(bare)) found.add(bare);
  }
  return [...found];
}
```

Note: `[...m[0]]` — m[0] is string (matchAll group 0). found.add(m[0]) fine.

contentWords + containment:

```ts
export function contentWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const t of tokenize(text)) {
    const w = t.toLowerCase();
    if (w.length <= 2) continue;
    if (STOPWORDS.has(w)) continue;
    if (/^\d+$/.test(w)) continue;
    words.add(w);
  }
  return words;
}

/** Fraction of the sentence's unique content words that appear in the sources. */
export function vocabularyContainment(sentence: string, sources: string[]): number {
  const words = contentWords(sentence);
  if (words.size === 0) return 1;
  const sourceWords = new Set(sources.flatMap((s) => [...contentWords(s)]));
  let hits = 0;
  for (const w of words) if (sourceWords.has(w)) hits++;
  return hits / words.size;
}
```

Hmm — "shards" vs "shard" containment: no stemming; the fixtures are aligned. But the paraphrase "brazier" vs "braziers" would break... scenario 1 sentence 2 uses "braziers" and the source has "braziers" ✓. OK, I'll document that containment is lexical (no stemming). Actually wait — let me re-check scenario 1 sentence 2 tokens: 'You need four ember shards, placed on its four braziers.' → content words: need (4 letters, not a stopword ✓ keep), four? digits/number words: 'four' is alpha, not stopword, len 4 → kept as a content word! Hmm — number words counted in containment. Source has 'four' ✓. ember ✓, shards ✓ (source plural), placed ✓, braziers ✓. need: source? no 'need' in source. Unique: {need, four, ember, shards, placed, braziers} = 6, hits = 5 → 0.833 ✓.

Sentence 1: {ember, gate, stands, hollow, vale} → hits: ember, gate, hollow, vale = 4/5 = 0.8 ✓.

Scenario 4 sentence 1: 'The Ember Gate is in the Hollow Vale.' → {ember, gate, hollow, vale} 4/4 = 1 ✓.
Sentence 2: 'You need five ember shards to open it.' → {need, five, ember, shards, open} → source has: ember ✓, shards ✓, five ✗, need ✗, open ✗ (source has 'opens') → 2/5 = 0.4 < 0.5 → dropped ✓ (plus quantity + number reasons).

Scenario 2 sentence 1: 'To open the Ember Gate, farm five moon shards in the Dusk Caverns.' → {open, ember, gate, farm, five, moon, shards, dusk, caverns} = 9; hits: ember, gate, shards → wait 'shards' is in source ✓ → 3/9 = 0.33 < 0.5 ✓ dropped (plus pair + Dusk Caverns).
Sentence 2: 'Offer the Moon Blade to the altar and the gate opens.' → {offer, moon, blade, altar, gate, opens} → hits gate, opens = 2/6 = 0.33 ✓ dropped.

Scenario 3: 'Rest at the Waystone Shrine to fully heal your party.' → {rest, waystone, shrine, fully, heal, party} → hits: 0? 'fully'? no. 'rest'? no. → 0/6 ✓ dropped.

All good with the 0.5 threshold.

Now — the gate's bare-number check: scenario 2 sentence 1 number: five → source numbers {4} → reason ✓ (already dropped anyway).

**src/answer/grounding-gate.ts**

```ts
import {
  checkQuantities,
  checkProperNouns,
  extractNumbers,
  splitSentences,
  vocabularyContainment,
} from './text-utils.js';

export interface SentenceVerdict {
  sentence: string;
  grounded: boolean;
  /** Why the sentence was dropped; empty when grounded. */
  reasons: string[];
}

export interface GateReport {
  verdicts: SentenceVerdict[];
  groundedSentences: string[];
  droppedSentences: string[];
}

export interface GroundingGateOptions {
  /** Minimum fraction of a sentence's content words that must appear in the sources. */
  minVocabularyContainment?: number;
}

/**
 * Sentence-level grounding gate. Each sentence of the model answer is checked
 * against the source texts; a sentence fails (and is dropped) if any of:
 *  - one of its quantity claims (e.g. "5 shards") is not exactly supported,
 *  - it uses a number that appears nowhere in the sources,
 *  - it mentions a proper noun ("Dusk Caverns") the sources do not contain,
 *  - less than `minVocabularyContainment` of its content words are in the sources.
 *
 * The checks are deliberately conservative: when in doubt, the sentence is dropped.
 */
export class GroundingGate {
  private readonly minContainment: number;

  constructor(options: GroundingGateOptions = {}) {
    this.minContainment = options.minVocabularyContainment ?? 0.5;
  }

  evaluate(answer: string, sources: string[]): GateReport {
    const sourceText = sources.join('\n');
    const sourceNumbers = new Set(extractNumbers(sourceText));

    const verdicts: SentenceVerdict[] = splitSentences(answer).map((sentence) => {
      const reasons: string[] = [];

      for (const check of checkQuantities(sentence, sources)) {
        if (!check.grounded && check.reason) reasons.push(check.reason);
      }
      for (const n of new Set(extractNumbers(sentence))) {
        if (!sourceNumbers.has(n)) reasons.push(`number ${n} does not appear in any source`);
      }
      for (const check of checkProperNouns(sentence, sources)) {
        if (!check.grounded && check.reason) reasons.push(check.reason);
      }
      const containment = vocabularyContainment(sentence, sources);
      if (containment < this.minContainment) {
        reasons.push(`only ${Math.round(containment * 100)}% of its vocabulary is found in the sources`);
      }

      return { sentence, grounded: reasons.length === 0, reasons };
    });

    return {
      verdicts,
      groundedSentences: verdicts.filter((v) => v.grounded).map((v) => v.sentence),
      droppedSentences: verdicts.filter((v) => !v.grounded).map((v) => v.sentence),
    };
  }
}
```

And checkQuantities / checkProperNouns — I said in text-utils; let me define them there:

```ts
export interface QuantityCheck {
  pair: QuantityPair;
  grounded: boolean;
  reason?: string;
  /** Quantities the sources attach to the same noun. */
  sourceQuantities: number[];
  nounInSources: boolean;
}

export function checkQuantities(sentence: string, sources: string[]): QuantityCheck[] {
  const sourcePairs = sources.flatMap((s) => extractQuantityPairs(s));
  return extractQuantityPairs(sentence).map((pair) => {
    const sourceQuantities = sourcePairs.filter((sp) => sp.noun === pair.noun).map((sp) => sp.quantity);
    const uniqueQs = [...new Set(sourceQuantities)];
    const nounInSources = sources.some((s) => new RegExp(`\\b${escapeRegExp(pair.noun)}s?\\b`, 'i').test(s));
    let grounded: boolean;
    let reason: string | undefined;
    if (!nounInSources) {
      grounded = false;
      reason = `"${pair.noun}" never appears in the sources`;
    } else if (uniqueQs.length === 0) {
      grounded = false;
      reason = `sources never state a quantity for "${pair.noun}"`;
    } else if (!uniqueQs.includes(pair.quantity)) {
      grounded = false;
      reason = `answer says ${pair.quantity} ${pair.noun} but sources say ${uniqueQs.join(' or ')}`;
    } else {
      grounded = true;
    }
    return { pair, grounded, reason, sourceQuantities, nounInSources };
  });
}

export interface ProperNounCheck {
  name: string;
  grounded: boolean;
  reason?: string;
}

export function checkProperNouns(sentence: string, sources: string[]): ProperNounCheck[] {
  return extractProperNouns(sentence).map((name) => {
    const present = sources.some((s) => new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(s));
    return present
      ? { name, grounded: true }
      : { name, grounded: false, reason: `"${name}" is not in the sources` };
  });
}
```

exactOptionalPropertyTypes — I'm not enabling it (I'll remove it from tsconfig to avoid friction with `reason?: string`). I'll keep only strict + noUncheckedIndexedAccess + noImplicitOverride.

**src/answer/hint-redactor.ts**

```ts
import { NUMBER_WORDS, extractNumbers, splitSentences } from './text-utils.js';

const SEQUENCE_RE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
const NUMBER_WORD_RE = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi;
const DIGIT_RE = /\b\d{1,3}\b/g;

export const REDACTION = '[redacted]';

/**
 * Hint mode is a redaction of the grounded answer, never a second LLM call.
 * Rule set:
 *  - proper nouns (multi-word sequences and single capitalised words that are
 *    not the first word of a sentence) become "[redacted]" — this removes boss
 *    names and locations;
 *  - any quantity (digit or number word) that the player did not already
 *    mention in their question becomes "[redacted]".
 * Common-case words are left intact on purpose: over-redaction makes hints
 * useless, and the gate has already guaranteed the wording is source-grounded.
 */
export class HintRedactor {
  redact(groundedAnswer: string, playerQuestion: string): string {
    const allowed = new Set(extractNumbers(playerQuestion));
    return splitSentences(groundedAnswer)
      .map((sentence) => this.redactSentence(sentence, allowed))
      .join(' ');
  }

  private redactSentence(sentence: string, allowed: Set<number>): string {
    let out = sentence.replace(SEQUENCE_RE, REDACTION);

    const tokens = out.split(/(\s+)/);
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === undefined) continue;
      const bare = token.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
      if (/^[A-Z][a-z]{2,}$/.test(bare)) {
        tokens[i] = token.replace(bare, REDACTION);
      }
    }
    out = tokens.join('');

    out = out.replace(DIGIT_RE, (match) => (allowed.has(parseInt(match, 10)) ? match : REDACTION));
    out = out.replace(NUMBER_WORD_RE, (match) => {
      const value = NUMBER_WORDS[match.toLowerCase()];
      return value !== undefined && allowed.has(value) ? match : REDACTION;
    });
    return out;
  }
}
```

Wait — `token.replace(bare, REDACTION)`: bare is a plain string (no regex chars) — fine.

Order check: the single-capital pass runs after the sequence replacement. But a subtle bug: after replacing sequences with '[redacted]', the split tokens include '[redacted]' — bare extraction: '[redacted]' → strip non-alpha from both ends → 'redacted'?? Wait: `token.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '')` on '[redacted]' → strip leading '[' and trailing ']' → 'redacted' → /^[A-Z][a-z]{2,}$/ → 'r' is lowercase → no match ✓ good.

But another subtle: a sequence at the end like "...Dusk Caverns." → replaced → "...[redacted]." ✓.

Now the numbers: 'four' → NUMBER_WORD_RE matches 'four' → value 4, allowed? question 'How do I open the Ember Gate?' → no numbers → not allowed → '[redacted]' ✓.

Wait, an issue: DIGIT_RE `\b\d{1,3}\b` — '4' → '[redacted]'. If the question mentioned '4' → kept ✓.

Edge: the question 'I have 3 shards, what next?' with the answer sentence 'Bring the 3 shards to the braziers.' → '3' allowed → kept ✓.

**src/answer/answer.types.ts**

```ts
export type AnswerMode = 'full' | 'hint';

/** Exact refusal text; refusing is a correct outcome, not a failure path. */
export const REFUSAL_TEXT = 'not covered by my sources';

export interface AnswerResult {
  mode: AnswerMode;
  status: 'answered' | 'refused';
  /** The grounded answer, the redacted hint, or REFUSAL_TEXT. */
  text: string;
  /** Sentences the grounding gate dropped. */
  droppedSentences: string[];
}

export function isRefusal(text: string): boolean {
  return text.trim() === REFUSAL_TEXT;
}
```

**src/answer/answer.service.ts**

```ts
import type { LlmClient } from '../llm/llm.client.js';
import { GroundingGate } from './grounding-gate.js';
import { HintRedactor } from './hint-redactor.js';
import { REFUSAL_TEXT, type AnswerMode, type AnswerResult } from './answer.types.js';

/**
 * `answer(question, sources, mode)` — the production pipeline:
 * one LLM call (always for the full answer), a sentence-level grounding gate,
 * then — for hint mode — a redaction of what survived.
 *
 * Hint mode never re-prompts the model: a second generation is a fresh
 * opportunity to reveal or invent spoilers; a redaction of a gated answer is not.
 */
export class AnswerService {
  constructor(
    private readonly llm: LlmClient,
    private readonly gate: GroundingGate = new GroundingGate(),
    private readonly redactor: HintRedactor = new HintRedactor(),
  ) {}

  answer(question: string, sources: string[], mode: AnswerMode = 'full'): AnswerResult {
    const raw = this.llm.complete({ prompt: buildPrompt(question, sources) }).text;
    const report = this.gate.evaluate(raw, sources);

    if (report.groundedSentences.length === 0) {
      // Refusing is a correct outcome: the sources do not cover the question.
      return { mode, status: 'refused', text: REFUSAL_TEXT, droppedSentences: report.droppedSentences };
    }

    const grounded = report.groundedSentences.join(' ');
    if (mode === 'hint') {
      return { mode, status: 'answered', text: this.redactor.redact(grounded, question), droppedSentences: report.droppedSentences };
    }
    return { mode, status: 'answered', text: grounded, droppedSentences: report.droppedSentences };
  }
}

function buildPrompt(question: string, sources: string[]): string {
  return [
    'You are a game guide assistant. Answer the player question using ONLY the wiki pages provided below.',
    'Do not invent items, quantities, or places. If the pages do not cover the question, say exactly that.',
    '',
    'Wiki pages:',
    ...sources.map((page, i) => `--- Page ${i + 1} ---\n${page}`),
    '',
    `Player question: ${question}`,
  ].join('\n');
}
```

**src/eval/scenarios.ts**

```ts
export type ExpectedOutcome = 'answer' | 'refusal';

export interface GoldenScenario {
  id: string;
  description: string;
  question: string;
  sources: string[];
  /** What the correct output is: an answer, or a refusal. */
  expectedOutcome: ExpectedOutcome;
  /** Facts the answer should contain (helpfulness). */
  expectedFacts: string[];
  /** Planted FALSE facts — invented requirements, wrong quantities, misattributed places (faithfulness). */
  falseFacts: string[];
  /** The answer the scripted fake LLM returns for this scenario. */
  scriptedAnswer: string;
}

export const EMBER_GATE_PAGE = [
  'The Ember Gate.',
  'The Ember Gate is a sealed arch in the Hollow Vale.',
  'It opens when four ember shards are placed on its four braziers.',
  'The shards glimmer faintly at dawn.',
].join(' ');

export const EMBER_SHARDS_PAGE = [
  'Ember Shards.',
  'Ember Shards are forged by heating cinder glass over a flame until it turns gold.',
  'Gather four ember shards and the gate opens.',
].join(' ');

export const GOLDEN_SCENARIOS: readonly GoldenScenario[] = [
  {
    id: 'grounded-answer',
    description: 'The scripted answer restates source facts, including the exact quantity. It should ship unchanged and score high.',
    question: 'How do I open the Ember Gate?',
    sources: [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE],
    expectedOutcome: 'answer',
    expectedFacts: ['four ember shards', 'Hollow Vale', 'braziers'],
    falseFacts: ['five ember shards', 'Dusk Caverns', 'Moon Blade'],
    scriptedAnswer: 'The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.',
  },
  {
    id: 'confident-lie',
    description: 'The scripted answer is a fluent, confident lie (invented item requirement and location). The gate must refuse; the harness must score it low.',
    question: 'What do I need to open the Ember Gate?',
    sources: [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE],
    expectedOutcome: 'answer',
    expectedFacts: ['four ember shards', 'Hollow Vale'],
    falseFacts: ['five moon shards', 'moon shards', 'Dusk Caverns', 'Moon Blade'],
    scriptedAnswer: 'To open the Ember Gate, farm five moon shards in the Dusk Caverns. Offer the Moon Blade to the altar and the gate opens.',
  },
  {
    id: 'sources-lack-answer',
    description: 'The sources say nothing about healing. Refusal is the correct output and must be scored as correct.',
    question: 'How do I heal my party outside of combat?',
    sources: [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE],
    expectedOutcome: 'refusal',
    expectedFacts: [],
    falseFacts: ['Waystone Shrine', 'moonlight salve'],
    scriptedAnswer: 'Rest at the Waystone Shrine to fully heal your party.',
  },
  {
    id: 'quantity-mismatch',
    description: 'The scripted answer says five shards; the sources say four. The wrong sentence must be dropped exactly, and the mismatch must be reported as 5 vs 4.',
    question: 'How many ember shards do I need for the Ember Gate?',
    sources: [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE],
    expectedOutcome: 'answer',
    expectedFacts: ['four ember shards'],
    falseFacts: ['five ember shards'],
    scriptedAnswer: 'The Ember Gate is in the Hollow Vale. You need five ember shards to open it.',
  },
];
```

Wait — verify scenario 'confident-lie' falseFact 'moon shards' → factPresent in the lie text: tokens moon, shard → present in the lie ✓ (the judge on the raw lie text would flag it). In the end-to-end (refusal), absent ✓.

Verify scenario 'quantity-mismatch' falseFact 'five ember shards' in the final answer ('The Ember Gate is in the Hollow Vale.') → absent ✓.

Hmm, one more check — scenario 'grounded-answer' scriptedAnswer sentence 1: 'The Ember Gate stands in the Hollow Vale.' — wait, the source has 'The Ember Gate is a sealed arch in the Hollow Vale.' The answer's 'stands' — a content word not in source → containment 4/5 = 0.8 ✓ fine.

And the expectedFact 'braziers' in the answer: the answer has 'braziers' ✓.

Now the lie scenario: is the scripted answer really "confident"? Yes, it's fluent and declarative. Good.

**src/eval/judges.ts**

```ts
import {
  checkProperNouns,
  checkQuantities,
  contentWords,
  extractProperNouns,
  splitSentences,
  tokenize,
  toNumber,
} from '../answer/text-utils.js';
import { isRefusal, REFUSAL_TEXT } from '../answer/answer.types.js';
import type { ExpectedOutcome } from './scenarios.js';

export interface JudgeVerdict {
  /** 0..1 */
  score: number;
  findings: string[];
}

/** Token set with numbers normalised to words ("4" and "four" both -> "four"). */
function normalizedTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const t of tokenize(text)) {
    const n = toNumber(t);
    if (n !== null) {
      tokens.add(NUMBER_WORD_BY_VALUE[n] ?? t.toLowerCase());
      continue;
    }
    tokens.add(t.toLowerCase());
  }
  return tokens;
}
```
I need a reverse map: value → word: { 0: 'zero', ..., 10: 'ten' }. I'll build it from NUMBER_WORDS:
```ts
const NUMBER_WORD_BY_VALUE: Record<number, string> = Object.fromEntries(
  Object.entries(NUMBER_WORDS).map(([word, value]) => [value, word]),
);
```
Object.entries typing: [string, number][] → map → [number, string][] → fromEntries gives {[k: string]: string}... I'll type it and cast. Simpler: a manual literal:
```ts
const NUMBER_WORD_BY_VALUE: Record<number, string> = { 0:'zero',1:'one',2:'two',3:'three',4:'four',5:'five',6:'six',7:'seven',8:'eight',9:'nine',10:'ten' };
```
I'll put this in text-utils as an export to keep a single source. Let me add `NUMBER_WORD_BY_VALUE` export in text-utils.

factPresent:
```ts
export function factPresent(fact: string, text: string): boolean {
  const factTokens = normalizedTokens(fact);
  const textTokens = normalizedTokens(text);
  if (factTokens.size === 0) return false;
  for (const t of factTokens) if (!textTokens.has(t)) return false;
  return true;
}
```
Hmm — contentWords for facts? The fact 'Hollow Vale' tokens: hollow, vale ✓. The fact 'four ember shards' → four, ember, shards ✓. But should stopwords in facts count? The fact 'braziers' → braziers ✓. I'll use normalizedTokens (all tokens including stopwords) — a fact containing 'the' would require 'the' in the text — trivially true. OK, fine.

Wait — one concern: factPresent('Dusk Caverns', 'The [redacted] guards the [redacted]...') → tokens dusk, caverns → absent ✓. And for the lie text: 'Dusk Caverns' present ✓.

HelpfulnessJudge:
```ts
export interface HelpfulnessExpectation {
  expectedOutcome: ExpectedOutcome;
  expectedFacts: readonly string[];
}

/**
 * Helpfulness: does the output deliver what the player needs, given the
 * scenario's expectation? A refusal is helpful only when the sources do not
 * cover the question; an answer is helpful only when it carries the expected facts.
 */
export class HelpfulnessJudge {
  judge(answer: string, expectation: HelpfulnessExpectation): JudgeVerdict {
    const refused = isRefusal(answer);
    if (expectation.expectedOutcome === 'refusal') {
      return refused
        ? { score: 1, findings: [] }
        : { score: 0, findings: ['expected a refusal (sources lack the answer) but got an answer'] };
    }
    if (refused) {
      return { score: 0, findings: ['useless refusal: the sources cover the question but the service refused'] };
    }
    const facts = expectation.expectedFacts;
    if (facts.length === 0) return { score: 1, findings: [] };
    const missing = facts.filter((f) => !factPresent(f, answer));
    return {
      score: (facts.length - missing.length) / facts.length,
      findings: missing.map((f) => `missing expected fact: ${f}`),
    };
  }
}
```

FaithfulnessJudge:
```ts
export interface FaithfulnessContext {
  /** The source texts — the judge cannot score faithfulness without them. */
  sources: string[];
  /** Planted false facts the answer must not contain. */
  falseFacts: readonly string[];
}

/**
 * Faithfulness: is everything in the answer supported by the sources it was
 * given? A judge without the sources can only score fluency, which is exactly
 * what a hallucination has most of — so the sources are part of the signature.
 */
export class FaithfulnessJudge {
  judge(answer: string, context: FaithfulnessContext): JudgeVerdict {
    const findings: string[] = [];
    let checks = 0;
    let violations = 0;

    for (const falseFact of context.falseFacts) {
      checks++;
      if (factPresent(falseFact, answer)) {
        violations++;
        findings.push(`answer contains a fact the sources do not support: "${falseFact}"`);
      }
    }

    for (const check of checkQuantities(answer, context.sources)) {
      checks++;
      if (!check.grounded && check.reason) {
        violations++;
        findings.push(check.reason);
      }
    }

    const names = new Set(splitSentences(answer).flatMap((s) => extractProperNouns(s)));
    for (const check of [...names].flatMap((name) => checkProperNouns(name, context.sources))) {
      checks++;
      if (!check.grounded && check.reason) {
        violations++;
        findings.push(check.reason);
      }
    }

    const score = checks === 0 ? 1 : 1 - violations / checks;
    return { score, findings };
  }
}
```
Hmm — checkProperNouns(sentence, sources) extracts proper nouns from the "sentence" — passing a single name as the "sentence": extractProperNouns(name): a name like 'Ember Gate' → the sequence matches ✓ returns ['Ember Gate']; a single name 'Matriarch' → no sequence; tokens: 'Matriarch' is i=0 → skipped → [] → no check → the check is silently skipped! Bug. Instead, I'll do the inline presence check directly:
```ts
for (const name of names) {
  checks++;
  const present = context.sources.some((s) => new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(s));
  if (!present) { violations++; findings.push(`"${name}" is not in the sources`); }
}
```
Need to import escapeRegExp. Cleaner. ✓

Also note: checkQuantities(answer, ...) on the full answer — quantity extraction across sentence boundaries: the tokenizer is position-based; "braziers. You need" — no problem, no number there. OK.

combineScores:
```ts
/** Final score: min(helpful, faithful). Averaging would let a fluent lie hide. */
export function combineScores(helpfulness: number, faithfulness: number): number {
  return Math.min(helpfulness, faithfulness);
}
```

**src/eval/eval-harness.ts**

```ts
import { AnswerService } from '../answer/answer.service.js';
import { ScriptedLlmClient } from '../llm/llm.client.js';
import { combineScores, FaithfulnessJudge, HelpfulnessJudge } from './judges.js';
import type { GoldenScenario } from './scenarios.js';

export interface ScenarioResult {
  id: string;
  status: 'answered' | 'refused';
  answer: string;
  helpful: number;
  faithful: number;
  /** min(helpful, faithful) */
  score: number;
  findings: string[];
  droppedSentences: string[];
}

export class EvalHarness {
  constructor(
    private readonly helpfulJudge: HelpfulnessJudge = new HelpfulnessJudge(),
    private readonly faithfulnessJudge: FaithfulnessJudge = new FaithfulnessJudge(),
  ) {}

  /** A fake LLM that returns the scenario's scripted answer, keyed by its question. */
  buildLlm(scenarios: readonly GoldenScenario[]): ScriptedLlmClient {
    return new ScriptedLlmClient(
      scenarios.map((s) => ({ match: s.question, reply: s.scriptedAnswer })),
      'The provided pages do not cover this.',
    );
  }

  run(scenarios: readonly GoldenScenario[], service: AnswerService): ScenarioResult[] {
    return scenarios.map((scenario) => {
      const result = service.answer(scenario.question, scenario.sources, 'full');
      const helpful = this.helpfulJudge.judge(result.text, {
        expectedOutcome: scenario.expectedOutcome,
        expectedFacts: scenario.expectedFacts,
      });
      const faithful = this.faithfulnessJudge.judge(result.text, {
        sources: scenario.sources,
        falseFacts: scenario.falseFacts,
      });
      return {
        id: scenario.id,
        status: result.status,
        answer: result.text,
        helpful: helpful.score,
        faithful: faithful.score,
        score: combineScores(helpful.score, faithful.score),
        findings: [...helpful.findings, ...faithful.findings],
        droppedSentences: result.droppedSentences,
      };
    });
  }
}
```

Now the tests.

**test/answer.service.spec.ts**

```ts
import { describe, expect, it } from 'vitest';
import { AnswerService } from '../src/answer/answer.service.js';
import { REFUSAL_TEXT } from '../src/answer/answer.types.js';
import { checkQuantities, splitSentences } from '../src/answer/text-utils.js';
import { EMBER_GATE_PAGE, EMBER_SHARDS_PAGE } from '../src/eval/scenarios.js';
import { ScriptedLlmClient, type LlmClient, type LlmRequest, type LlmResponse } from '../src/llm/llm.client.js';

const SOURCES = [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE];

function makeService(scriptedAnswer: string): AnswerService {
  return new AnswerService(new ScriptedLlmClient([{ match: 'question', reply: scriptedAnswer }]));
}
```
Hmm — match 'question' — the prompt contains 'Player question:' → includes('question') ✓ always matches. Good trick for a single-script client.

Tests:

1. Grounded answer ships unchanged (full mode):
```ts
const svc = makeService('The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.');
const r = svc.answer('How do I open the Ember Gate?', SOURCES, 'full');
expect(r.status).toBe('answered');
expect(r.text).toBe(same string);
expect(r.droppedSentences).toEqual([]);
```

2. Refusal when sources lack the answer:
```ts
const svc = makeService('Rest at the Waystone Shrine to fully heal your party.');
const r = svc.answer('How do I heal my party outside of combat?', SOURCES, 'full');
expect(r.status).toBe('refused');
expect(r.text).toBe(REFUSAL_TEXT);
```

3. Partial drop: ungrounded quantity sentence is dropped, grounded sentence survives:
```ts
const svc = makeService('The Ember Gate is in the Hollow Vale. You need five ember shards to open it.');
const r = svc.answer('How many ember shards do I need for the Ember Gate?', SOURCES, 'full');
expect(r.status).toBe('answered');
expect(r.text).toBe('The Ember Gate is in the Hollow Vale.');
expect(r.droppedSentences).toEqual(['You need five ember shards to open it.']);
expect(r.text).not.toMatch(/five|5/);
```

4. Quantity errors are caught exactly:
```ts
const sentence = 'You need five ember shards to open the Ember Gate.';
const checks = checkQuantities(sentence, SOURCES);
expect(checks).toHaveLength(1);
expect(checks[0]!.pair.quantity).toBe(5);
expect(checks[0]!.pair.noun).toBe('shard');
expect(checks[0]!.grounded).toBe(false);
expect(checks[0]!.sourceQuantities).toEqual([4, 4]);
expect(checks[0]!.reason).toMatch(/5/);
expect(checks[0]!.reason).toMatch(/4/);
```
sourceQuantities: sourcePairs with noun 'shard': page A (4,shard), page B (4,shard) → [4,4] ✓.

Wait — page A: 'It opens when four ember shards are placed on its four braziers.' → pairs: (4, shard) from 'four ember shards'; 'four braziers' → (4, brazier). ✓. Page B: 'Gather four ember shards and the gate opens.' → (4, shard) ✓. Also 'Ember Shards are forged by heating cinder glass over a flame until it turns gold.' — no numbers ✓. So shard quantities [4,4] ✓.

5. A fully-ungrounded answer → refusal:
```ts
const svc = makeService('To open the Ember Gate, farm five moon shards in the Dusk Caverns.');
const r = svc.answer('What do I need to open the Ember Gate?', SOURCES, 'full');
expect(r.status).toBe('refused');
expect(r.text).toBe(REFUSAL_TEXT);
expect(r.droppedSentences).toHaveLength(1);
```

6. Hint mode: a single LLM call, redacted output:
```ts
class CountingLlm implements LlmClient {
  calls = 0;
  complete(_req: LlmRequest): LlmResponse {
    this.calls++;
    return { text: 'The Hollow Matriarch guards the Dusk Caverns and demands four ember shards.' };
  }
}
```
Wait — but that text is not grounded in the gate sources! The gate would drop it → refusal. For the hint test I need a grounded answer. Let me use the gate answer: 'The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.' Question 'How do I open the Ember Gate?'.

```ts
const llm = new CountingLlm();
const svc = new AnswerService(llm);
const r = svc.answer('How do I open the Ember Gate?', SOURCES, 'hint');
expect(llm.calls).toBe(1);
expect(r.status).toBe('answered');
expect(r.text).not.toContain('Ember Gate');
expect(r.text).not.toContain('Hollow Vale');
expect(r.text).not.toMatch(/\b(four|4)\b/);
expect(r.text).toContain('[redacted]');
// and the hint is the redaction of the grounded answer, not a fresh generation:
const full = svc.answer('How do I open the Ember Gate?', SOURCES, 'full');
expect(full.text).toBe('The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.');
```
Expected hint text: 'The [redacted] stands in the [redacted]. You need [redacted] ember shards, placed on its [redacted] braziers.' I can assert exactly:
```ts
expect(r.text).toBe('The [redacted] stands in the [redacted]. You need [redacted] ember shards, placed on its [redacted] braziers.');
```
Let me trace redaction on sentence 1: 'The Ember Gate stands in the Hollow Vale.' SEQUENCE_RE: matches 'Ember Gate' and 'Hollow Vale' → replace both → 'The [redacted] stands in the [redacted].' ✓. Tokens: 'The' (i=0), '[redacted]' → bare 'redacted' no match, ... 'in', 'the'... no capitals ✓. Numbers: none. → 'The [redacted] stands in the [redacted].' ✓.
Sentence 2: 'You need four ember shards, placed on its four braziers.' → no capitals other than 'You' at i=0. Numbers: 'four' ×2 → '[redacted]'. → 'You need [redacted] ember shards, placed on its [redacted] braziers.' ✓.
Join with ' ' → matches my expected ✓.

Also note: the CountingLlm's complete is called once per answer() call; I call svc.answer twice (hint + full) → calls 2! Careful: if I assert llm.calls toBe(1) after both calls, it breaks. Fix: assert calls===1 right after the hint call, before the full call. Or use separate instances. Let me assert after the first call:
```ts
const hint = svc.answer(..., 'hint');
expect(llm.calls).toBe(1);
...
const callsAfterHint = llm.calls; // ==1
const full = svc.answer(..., 'full');
expect(llm.calls).toBe(callsAfterHint + 1); // each answer() = exactly one LLM call
```
Simpler: two services. I'll do this: hint via the counting client; assert calls === 1; then assert the full answer via a second service with the plain scripted client. Cleaner.

7. Hint keeps a quantity the player mentioned:
```ts
const svc = makeService('Bring the three ember shards to the Hollow Vale.');
```
Wait, is 'Bring the three ember shards to the Hollow Vale.' grounded? Gate: quantity pair: tokens: Bring, the, three, ember, shards, to, the, Hollow, Vale → at 'three': a='ember' b='shards' → (3, shard). Source shard quantities [4,4] → 3 not in → ungrounded → dropped → refusal! Oops. So this fixture can't pass the gate.

For the "mentioned quantity preserved" test, I should test the redactor directly (a unit), not through the service — the redactor's contract is independent. In test/hint-redactor.spec.ts:
```ts
const redactor = new HintRedactor();
const out = redactor.redact('Bring the three ember shards to the Hollow Vale.', 'I already have three shards. What now?');
expect(out).toContain('three');
expect(out).not.toContain('Hollow Vale');
```
Trace: sequence 'Hollow Vale' → '[redacted]'. 'three' → value 3, allowed (question has 'three') → kept ✓. Output: 'Bring the three ember shards to the [redacted].' ✓.

And the spec-required redaction test:
```ts
const out = redactor.redact('The Hollow Matriarch guards the Dusk Caverns and demands four ember shards.', 'How do I progress?');
expect(out).not.toContain('Hollow Matriarch');
expect(out).not.toContain('Dusk Caverns');
expect(out).not.toMatch(/\bfour\b/i);
expect(out).not.toMatch(/\b4\b/);
expect(out).toBe('The [redacted] guards the [redacted] and demands [redacted] ember shards.');
```
Trace: sequences: 'Hollow Matriarch' → [redacted]; 'Dusk Caverns' → [redacted]. Single capitals: none. 'four' → [redacted]. ✓ exact string match.

Digit quantity:
```ts
const out = redactor.redact('Place 4 ember shards on the braziers.', 'How do I open it?');
expect(out).toBe('Place [redacted] ember shards on the braziers.');
```
Trace: DIGIT_RE '4' → not allowed → [redacted] ✓.

A common word is kept:
```ts
expect(out).toContain('ember shards'); // item wording stays; only name/location/quantity are redacted
```
I'll fold this into another assertion.

**test/eval-harness.spec.ts**

```ts
import { describe, expect, it } from 'vitest';
import { AnswerService } from '../src/answer/answer.service.js';
import { REFUSAL_TEXT } from '../src/answer/answer.types.js';
import { EvalHarness } from '../src/eval/eval-harness.js';
import { combineScores, FaithfulnessJudge } from '../src/eval/judges.js';
import { EMBER_GATE_PAGE, EMBER_SHARDS_PAGE, GOLDEN_SCENARIOS } from '../src/eval/scenarios.js';

const SOURCES = [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE];

function runSuite() {
  const harness = new EvalHarness();
  const service = new AnswerService(harness.buildLlm(GOLDEN_SCENARIOS));
  return harness.run(GOLDEN_SCENARIOS, service);
}
```

Tests:
1. Correct grounded answer scores high:
```ts
const results = runSuite();
const grounded = results.find((r) => r.id === 'grounded-answer')!;
expect(grounded.status).toBe('answered');
expect(grounded.score).toBeGreaterThanOrEqual(0.9);
expect(grounded.answer).toBe('The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.');
```

2. A confident lie scores low:
```ts
const lie = results.find((r) => r.id === 'confident-lie')!;
expect(lie.status).toBe('refused');
expect(lie.answer).toBe(REFUSAL_TEXT);
expect(lie.score).toBeLessThan(0.2);
expect(lie.helpful).toBe(0); // useless refusal against a covered question
```

3. Sources lack the answer → refusal is scored as correct:
```ts
const noCov = results.find((r) => r.id === 'sources-lack-answer')!;
expect(noCov.status).toBe('refused');
expect(noCov.answer).toBe(REFUSAL_TEXT);
expect(noCov.score).toBeGreaterThanOrEqual(0.9);
```

4. Quantity error caught exactly:
```ts
const qty = results.find((r) => r.id === 'quantity-mismatch')!;
expect(qty.droppedSentences).toEqual(['You need five ember shards to open it.']);
expect(qty.answer).not.toMatch(/five|\b5\b/);
// The faithfulness judge, run on the raw (ungated) text, names the mismatch exactly:
const raw = 'The Ember Gate is in the Hollow Vale. You need five ember shards to open it.';
const verdict = new FaithfulnessJudge().judge(raw, { sources: SOURCES, falseFacts: ['five ember shards'] });
expect(verdict.findings.some((f) => /five ember shards/i.test(f))).toBe(true);
expect(verdict.findings.some((f) => f.includes('5') && f.includes('4'))).toBe(true);
```
Verify: the judge on the raw text: falseFact 'five ember shards' present → finding 'answer contains a fact the sources do not support: "five ember shards"' ✓ contains 'five ember shards'. Quantity check on the raw: pair (5, shard) → reason 'answer says 5 shard but sources say 4' → includes '5' and '4' ✓. Also 'four'? The raw sentence 1 'The Ember Gate is in the Hollow Vale.' has no 'four'... wait, checkQuantities on the full answer: only pair is (5, shard) ✓ one violation. Pn: Ember Gate, Hollow Vale → present ✓. checks = 1 + 1 + 2 = 4, violations 2 → score 0.5. Not asserted, fine.

Hmm wait — 'answer says 5 shard but sources say 4' — the noun 'shard' singular. The message reads 'answer says 5 shard but sources say 4' — a bit awkward but contains 5 and 4 ✓. Let me improve the message: `answer says ${pair.quantity} ${pair.noun}(s) but sources say ${uniqueQs.join(' or ')}` → 'answer says 5 shard(s) but sources say 4'. OK, I'll use that.

5. The faithfulness judge's signature takes the sources — demonstrated by behavior:
```ts
const lieText = 'To open the Ember Gate, farm five moon shards in the Dusk Caverns.';
const withSources = new FaithfulnessJudge().judge(lieText, { sources: SOURCES, falseFacts: ['five moon shards'] });
const withoutSources = new FaithfulnessJudge().judge(lieText, { sources: [], falseFacts: ['five moon shards'] });
// With sources, the quantity mismatch is named exactly; without, everything is merely "unknown".
expect(withSources.findings.some((f) => f.includes('5') && f.includes('4'))).toBe(true);
expect(withSources.score).toBeLessThan(0.5);
expect(withoutSources.score).toBeLessThan(withSources.score);
```
Verify withoutSources: falseFact present → 1 violation. Quantities: pair (5, shard): sourcePairs [] → uniqueQs [] → nounInSources false → reason '"shard" never appears in the sources' → violation. Pns: 'Ember Gate' not in [] → violation; 'Dusk Caverns' → violation. checks 4, violations 4 → score 0. withSources: falseFact present (1), quantity mismatch (1), pns: Ember Gate present ✓, Dusk Caverns absent (1) → violations 3, checks 4 → 0.25. 0 < 0.25 ✓ withoutSources.score (0) < withSources.score (0.25) ✓. And withSources < 0.5 ✓.

Hmm, semantically "without sources scores lower" is a weird framing — the real point is: the signature "requires" the sources (a type-level fact), and the findings differ. My assertion shows the source dependence: with sources the finding names '5 vs 4' exactly; without it can't. I'll also assert the type at the compile level — the judge call always passes sources (both calls do). I'll phrase the test name: 'the faithfulness judge's signature takes the sources, and its findings depend on them'. Also note: the TS signature `judge(answer: string, context: { sources: string[]; ... })` — required. A compile-time demonstration: an attempt to omit sources would be a type error — I can't easily assert a type error in a runtime test (would need tsd). The behavior test + the visible signature suffices; the acceptance "the faithfulness judge's signature takes the sources" is satisfied by the required `sources` in the parameter type.

6. min combining:
```ts
expect(combineScores(1, 1)).toBe(1);
expect(combineScores(0.95, 0.4)).toBe(0.4);
expect(combineScores(0.2, 0.95)).toBe(0.2);
// min, not mean: a fluent lie (high helpfulness-style score, low faithfulness) cannot hide.
expect(combineScores(0.9, 0.1)).toBeLessThan((0.9 + 0.1) / 2);
```

Also, maybe: 'the harness runs every golden scenario' → results.length === GOLDEN_SCENARIOS.length and the ids match. A small sanity.

Now — let me re-check the whole harness run for 'confident-lie' once more: service.answer with the scripted lie → gate drops both → refused. Helpful: expectedOutcome 'answer' → refused → 0, finding 'useless refusal...'. Faithful: refusal text: falseFacts 4 → all absent (check factPresent on 'not covered by my sources'): 'five moon shards' → five? 'not covered by my sources' tokens: not, covered, by, my, sources → five absent ✓. 'moon shards' absent ✓. 'Dusk Caverns' → dusk, caverns absent ✓. 'Moon Blade' absent ✓. Quantities: none. Pns: splitSentences('not covered by my sources') → ['not covered by my sources'] → extractProperNouns: no sequence; tokens: not (i=0 skipped), covered, by, my, sources — no capitals → []. checks 4, violations 0 → 1.0. Score min(0,1) = 0 ✓ < 0.2 ✓.

And 'grounded-answer' harness: helpful 1 (all 3 facts present — verify 'braziers': normalizedTokens('braziers') → {braziers}; the answer tokens contain 'braziers' ✓). faithful: as computed 1.0. Score 1 ✓ ≥ 0.9 ✓.

'sources-lack-answer': service → scripted 'Rest at the Waystone Shrine to fully heal your party.' → gate: sequence 'Waystone Shrine' absent → drop; containment 0 → drop → refused. Helpful: expected refusal → 1. Faithful: falseFacts 'Waystone Shrine' → dusk? no — tokens waystone, shrine absent ✓; 'moonlight salve' absent ✓; no quantity; pns: none in the refusal → checks 2, violations 0 → 1. Score 1 ✓.

'quantity-mismatch': → answered 'The Ember Gate is in the Hollow Vale.'; helpful: fact 'four ember shards' → tokens four, ember, shards → answer tokens: the, ember, gate, is, in, the, hollow, vale → four absent → missing → 0/1 = 0. faithful: falseFact 'five ember shards' absent ✓ (five not in the final); no quantity; pns Ember Gate ✓, Hollow Vale ✓ → 1. Score 0. The test asserts the drop + raw judge finding (not the score) ✓.

Now — one more potential trap: the harness's buildLlm matches by question substring in the prompt. Questions:
- 'How do I open the Ember Gate?'
- 'What do I need to open the Ember Gate?'
- 'How do I heal my party outside of combat?'
- 'How many ember shards do I need for the Ember Gate?'
All distinct; none is a substring of another? 'How do I open the Ember Gate?' vs 'What do I need to open the Ember Gate?' — not substrings of each other ✓. The prompt for scenario 4 contains 'Player question: How many ember shards do I need for the Ember Gate?' — includes scenario 1's match? Scenario 1's match 'How do I open the Ember Gate?' — not a substring ✓. find() takes the first match — since each prompt contains exactly one question, it's unambiguous ✓.

Wait — one more: scenario 2's scriptedAnswer 'To open the Ember Gate, farm five moon shards in the Dusk Caverns. Offer the Moon Blade to the altar and the gate opens.' — let me re-verify the gate drop for sentence 2: 'Offer the Moon Blade to the altar and the gate opens.' Pns: 'Moon Blade' (sequence) absent → drop ✓. Containment: {offer, moon, blade, altar, gate, opens} → hits gate ✓, opens ✓ → 2/6=0.33 ✓. Sentence 1 also dropped ✓. → refused ✓.

Now, let me reconsider the gate's bare-number check for sentence 1 of 'grounded-answer'... 'The Ember Gate stands in the Hollow Vale.' — no numbers ✓.

Potential issue — extractNumbers on the sources includes 'four' twice etc. → Set {4}. Scenario 1 sentence 2 numbers: {4} ⊆ ✓.

One more subtlety: `checkQuantities(sentence, sources)` — for 'You need four ember shards, placed on its four braziers.': tokens: You, need, four, ember, shards, placed, on, its, four, braziers. At 'four' #1: a='ember' b='shards' → (4, shard) ✓. At 'four' #2: a='braziers' b=undefined → (4, brazier) ✓. Both grounded ✓.

Now, let me re-check `tokenize` regex: /[A-Za-z0-9]+(?:'[A-Za-z]+)?/g — 'shards,' → 'shards' ✓. 'braziers.' → 'braziers' ✓.

Now the STOPWORDS — does it include 'placed'? No ✓ (it's a content word, present in source ✓).

Let me reconsider the containment threshold edge: 'placed on its four braziers' — 'placed' is in source page A ✓.

OK. Also, I need to make sure `vocabularyContainment` treats the source's 'Ember'/'Gate' capitalized → contentWords lowercases → 'ember', 'gate' ✓.

Now the hint-redactor's DIGIT_RE and NUMBER_WORD_RE are /g — used in replace (fine, no lastIndex issue since replace handles it). In extractProperNouns I use matchAll with a /g regex — matchAll requires /g ✓ (SEQUENCE_RE is /g; reusing it in `sentence.replace(SEQUENCE_RE, ' ')` — replace with /g resets lastIndex appropriately (replace internally uses the global flag; a shared /g regex in replace is safe because String.replace fully consumes it; matchAll also clones? actually matchAll requires the global flag and internally clones the regex (creates a new one with the same flags) — per spec, String.prototype.matchAll creates a new RegExp. And replace with a global regex: it uses lastIndex from... it resets to 0? Per spec, replace with a global regex: it uses the regex as-is but the algorithm effectively resets lastIndex (the ReplaceAll operation sets lastIndex = 0 first). Yes — ReplaceAll: If global, set lastIndex to 0. Safe. But to be even safer/cleaner, I'll construct a fresh regex per call in extractProperNouns. Let me define a factory function to avoid shared-state subtleties:

Actually, the simplest: in extractProperNouns, use `sentence.match(/.../g)` (a fresh literal) and `sentence.replace(/.../g, ' ')` with inline literals. Inline literals per call = no shared state. I'll inline them.

Similarly the redactor: inline literals per method call. I'll keep it inline.

In text-utils, DIGIT_RE/NUMBER_WORD_RE were module-level /g — I moved number extraction to tokenize+toNumber, so those module-level regexes are unused. Remove.

Now, `toNumber` for a token like '4' → 4 ✓; 'four' → 4 ✓; 'Four' → lowercase → 4 ✓.

One more consideration — `extractQuantityPairs` for the source page 'Ember Shards are forged by heating cinder glass...' — no numbers ✓.

Now — the refusal text 'not covered by my sources' — the gate on it (if the LLM itself said that): 'not' i=0... pns: tokens not (skipped), covered, by, my, sources → no capitals → none. Containment: content words: covered, sources → source has? 'covered' no, 'sources' no → 0 → dropped → then zero grounded sentences → the service refuses with REFUSAL_TEXT anyway ✓ consistent.

Now, the `isRefusal` helper is used in the judge; the harness's status from the service is 'refused'. Consistent.

Let me also think about whether the `AnswerService` should expose the gate report (verdicts/reasons) for observability. The tests use checkQuantities directly and droppedSentences. The reasons per dropped sentence could be useful for "caught exactly" — the harness findings come from the judges. I think exposing `droppedSentences` (the text) is enough; I'll keep the API lean.

Hmm, wait — actually, let me reconsider exposing the verdict reasons. The acceptance: '"5 shards" against sources saying 4 → caught, exactly.' My test proves it via checkQuantities (the exact pair + source quantities) and the judge's finding text. That's solid.

Let me also double-check the `HintRedactor` on a grounded hint where the question contains a number that should be preserved: e.g. question 'I have 4 shards already — what now?' with a sentence 'You need four ember shards to open it.' → hmm 'four' = 4 → allowed → kept! So the hint would reveal 'four ember shards' — but the player already knows 4 (they said '4 shards') → "beyond what the player already mentioned" is allowed ✓ correct behavior.

Now let me write the test files completely. Also, I should maybe test the gate directly for a sentence with a bare number not in the sources: 'Level 10 players' — well, I'll skip; coverage is sufficient. But the spec says "test the behaviour, not the implementation. Never assert only that a call happens. A test with no assertion, or one that only exercises the happy path, is worse than no test." My tests have assertions and cover the failure paths ✓.

Let me count the tests:

answer.service.spec.ts:
- full mode ships a grounded answer unchanged
- full mode refuses when nothing is grounded
- full mode drops only the ungrounded sentence (partial drop)
- a quantity mismatch is caught exactly (5 vs 4) [checkQuantities level]
- a confident lie is fully dropped → refusal
- hint mode makes exactly one LLM call and returns the redaction of the grounded answer
- hint mode keeps quantities the player already mentioned? — that's at the redactor level; via the service: question 'I already have four shards...' wait the gate: the answer sentence 'You need four ember shards...' is grounded ✓; the hint: 'four' allowed (question has four) → kept. Let me add it via the service:
```ts
const svc = makeService('You need four ember shards, placed on its four braziers.');
const r = svc.answer('I have four shards — is that enough?', SOURCES, 'hint');
expect(r.text).toContain('four');
```
Verify the gate on 'You need four ember shards, placed on its four braziers.' alone: pairs (4,shard) ✓ (4,brazier) ✓; containment: {need, four, ember, shards, placed, braziers} → 5/6 ✓ → survives. Hint: sequence: none; single capitals: 'You' is i=0 skipped ✓; numbers: 'four' allowed (question has 'four') → kept. Output: 'You need four ember shards, placed on its four braziers.' ✓ contains 'four' ✓.

hint-redactor.spec.ts:
- redacts a boss name, a location and a quantity (the spec test) — exact output assertion
- redacts digit quantities
- keeps quantities the player mentioned
- leaves common-case wording intact (not over-redacting)

eval-harness.spec.ts:
- the suite runs all scenarios (length/ids)
- a correct grounded answer scores high
- a scripted confident lie scores low
- sources lacking the answer → refusal, scored as correct
- a quantity error is caught exactly (drop + judge finding naming 5 and 4)
- the faithfulness judge takes the sources (findings depend on them)
- the final score is the min of the two judges

That's a good suite. Now — let me also re-verify `factPresent` for 'Dusk Caverns' against the hint text 'The [redacted] guards the [redacted]...' — tokens: dusk, caverns — absent ✓ (the faithfulness judge on the hint output would be clean).

Now, one more design question: the harness's `run` uses mode 'full'. Should the harness also evaluate hint mode? The spec's harness is about the answer quality; the hint is tested separately. I'll keep 'full'.

Potential strict-TS pitfalls:
- `results.find(...)!` non-null assertion — allowed even under strict (it's not an error; lint would complain but there's no lint). Fine.
- The `checks[0]!` pattern ✓.
- Object.fromEntries typing — I avoided it with a manual map.
- `tokens[i]` under noUncheckedIndexedAccess → handled.
- `hit ? hit.reply : this.fallback` ✓.
- `for (const m of sentence.matchAll(re))` → m: RegExpMatchArray → m[0]: string ✓ (RegExpMatchArray[0] is string, no undefined).
- `sources.map((page, i) => ...)` ✓.
- `verdicts.filter(...).map((v) => v.sentence)` ✓.
- `[...new Set(arr)]` needs downlevelIteration? target ES2022 → fine. Spreading a Set is OK with ES2015+ target.
- `Object.entries` ✓.

Also `import type` vs value: under `verbatimModuleSyntax`? I won't enable verbatimModuleSyntax; plain imports are fine, but I'll use `import type` where purely type for cleanliness.

ESM extension: all relative imports end in '.js' ✓ (NodeNext requires it).

vitest + TS + ESM: vitest handles TS with its own transform; '.js' extension imports map to '.ts' files — vitest (via vite) resolves './text-utils.js' → './text-utils.ts'? Yes — Vite/Vitest resolves TS paths with .js extensions correctly (standard for NodeNext ESM projects). ✓

Now — the package manager pnpm: nothing to add (no pnpm-workspace needed). Maybe add `pnpm-lock.yaml`? I can't generate a real lockfile; skip. package.json is enough.

Should I include a `README.md`? "Do not create a file it does not call for" → no.

Let me also reconsider the layers convention: "controller validates input and calls the service. Zero business logic." — no controller here (no API). The task deliverables are the pipeline + harness. I'm confident skipping NestJS is right: the task says "In TypeScript, deliver: answer(...) using an injectable LLM client... an eval harness... tests." No mention of an API, endpoints, or DB. The conventions' NestJS/Prisma/PG items apply to "the API" — there is none. The error envelope is for HTTP errors — none. So the files are: package.json, tsconfig.json, vitest.config.ts, src/llm/llm.client.ts, src/answer/answer.types.ts, src/answer/text-utils.ts, src/answer/grounding-gate.ts, src/answer/hint-redactor.ts, src/answer/answer.service.ts, src/eval/scenarios.ts, src/eval/judges.ts, src/eval/eval-harness.ts, test/answer.service.spec.ts, test/hint-redactor.spec.ts, test/eval-harness.spec.ts. 15 files.

Let me now write the final code with careful attention to details.

One more check on `extractProperNouns`'s single-capital rule: `bare` is computed by stripping leading/trailing non-letters (and apostrophes). '[redacted]' → 'redacted' → no match (lowercase start) ✓. 'Gate,' → 'Gate' — but 'Gate' as a standalone capital in the middle of a sentence would be captured as a pn... e.g. "The ember Gate opens" (a typo) → captured, and if not in source as a standalone word... the source has 'Gate' (in 'Ember Gate') → the regex \bGate\b matches within 'Ember Gate' → considered present ✓ fine.

Now, the single-capital minimum length {2,} → 3+ chars: 'Gate' ✓, 'Matriarch' ✓.

Edge: 'Vale' at sentence start is skipped ✓ (documented).

Now let me write checkQuantities' reason strings precisely:
- noun absent: `"shard" never appears in the sources` — wait, use the singular noun.
- no quantity: `sources never state a quantity for "shard"`
- mismatch: `answer says 5 shard(s) but sources say 4`

The test asserts /5/ and /4/ ✓.

Now — a subtle: `uniqueQs.join(' or ')` for [4] → '4' ✓.

Now let me reconsider: the faithfulness judge's quantity check runs `checkQuantities(answer, sources)` on the full answer — for the refusal text: no pairs ✓.

Now, the harness `ScenarioResult.findings` merges helpful + faithful findings ✓ (the test can inspect).

Let me also reconsider: in the 'quantity-mismatch' scenario, the `expectedOutcome: 'answer'` — but the correct behavior is a partial answer (a quantity dropped). The scenario's expectedFacts ['four ember shards'] → helpfulness 0. Is that the "right" score for a scenario where the model erred and the pipeline defended itself? The pipeline's output lacks the fact → unhelpful (0), faithful (1) → 0. The harness's job: flag it. The test asserts the drop + finding, not a high score. I'm comfortable.

Actually, wait — I realize I should double-check the scenario 4 final answer's helpfulness more carefully: normalizedTokens('four ember shards') = {four, ember, shards}. Final answer 'The Ember Gate is in the Hollow Vale.' tokens: the, ember, gate, is, in, the, hollow, vale → 'four' absent → missing ✓ → 0.

Now let me also verify the lie scenario's `lie.helpful` toBe(0) — yes, via the useless-refusal branch ✓.

Also, the eval spec asserts `lie.answer === REFUSAL_TEXT` ✓.

Now let me also think about the test "a scripted confident lie scores low" — is the lie "scored low" by the harness, or would the raw lie score low with the judge? Both, actually: (a) end-to-end the pipeline refused → 0; (b) the judge on the raw lie text → 0.25. I'll cover (a) in the harness test and (b) in the sources-signature test. ✓

Time to also re-verify that the `GroundingGate` handles an empty answer (LLM returns ''): splitSentences('') → [] → groundedSentences [] → refusal ✓. No test needed but robust.

Now, the `ScriptedLlmClient`'s fallback default '' → gate refusal. The harness's buildLlm fallback 'The provided pages do not cover this.' → would be dropped (vocab) → refusal ✓.

Let me write out the final files. Also, small doc comments in English (code and comments in English ✓).

One more consideration on the `answer.service.ts` prompt: it includes the instruction "say exactly that" — fine.

Also — the mode parameter: the spec signature `answer(question, sources, mode)`. I made mode optional defaulting 'full'. The spec shows all three parameters; default is harmless. I'll keep the default.

Let me also reconsider the file name `answer.types.ts` — the convention's `kebab-case.role.ts`: 'types' as the role... acceptable (a types file). Alternatively, I'll fold the types into answer.service.ts to reduce file count. Hmm — REFUSAL_TEXT + AnswerResult are used by the service, the judge, and the tests. A separate `answer.types.ts` is clean. I'll keep it.

Final check on the judge file's imports: I need escapeRegExp from text-utils for the pn presence check. ✓

Let me write out `judges.ts` completely:

```ts
import {
  escapeRegExp,
  extractProperNouns,
  NUMBER_WORD_BY_VALUE,
  splitSentences,
  toNumber,
  tokenize,
} from '../answer/text-utils.js';
import { isRefusal } from '../answer/answer.types.js';
import type { ExpectedOutcome } from './scenarios.js';

export interface JudgeVerdict {
  /** Score in [0, 1]. */
  score: number;
  findings: string[];
}

function normalizedTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const t of tokenize(text)) {
    const n = toNumber(t);
    tokens.add(n !== null ? (NUMBER_WORD_BY_VALUE[n] ?? t.toLowerCase()) : t.toLowerCase());
  }
  return tokens;
}

/** A fact is "present" when every one of its tokens appears in the text (numbers normalised). */
export function factPresent(fact: string, text: string): boolean {
  const factTokens = normalizedTokens(fact);
  if (factTokens.size === 0) return false;
  const textTokens = normalizedTokens(text);
  for (const t of factTokens) if (!textTokens.has(t)) return false;
  return true;
}

export interface HelpfulnessExpectation {
  expectedOutcome: ExpectedOutcome;
  expectedFacts: readonly string[];
}

export class HelpfulnessJudge { ... }

export interface FaithfulnessContext {
  sources: string[];
  falseFacts: readonly string[];
}

export class FaithfulnessJudge { ... }

export function combineScores(helpfulness: number, faithfulness: number): number {
  return Math.min(helpfulness, faithfulness);
}
```

I'll export NUMBER_WORD_BY_VALUE from text-utils:
```ts
export const NUMBER_WORD_BY_VALUE: Record<number, string> = {
  0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four',
  5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten',
};
```

Now — unused import check in judges.ts: I import checkQuantities — yes, used in FaithfulnessJudge. checkProperNouns — I decided to do the inline pn check with escapeRegExp instead; so I don't import checkProperNouns; I do use extractProperNouns (via splitSentences flatMap) ✓. Let me finalize the FaithfulnessJudge body:

```ts
export class FaithfulnessJudge {
  judge(answer: string, context: FaithfulnessContext): JudgeVerdict {
    const findings: string[] = [];
    let checks = 0;
    let violations = 0;

    for (const falseFact of context.falseFacts) {
      checks += 1;
      if (factPresent(falseFact, answer)) {
        violations += 1;
        findings.push(`answer contains a fact the sources do not support: "${falseFact}"`);
      }
    }

    for (const check of checkQuantities(answer, context.sources)) {
      checks += 1;
      if (!check.grounded && check.reason) {
        violations += 1;
        findings.push(check.reason);
      }
    }

    const names = new Set(splitSentences(answer).flatMap((s) => extractProperNouns(s)));
    for (const name of names) {
      checks += 1;
      const inSources = context.sources.some((s) => new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(s));
      if (!inSources) {
        violations += 1;
        findings.push(`"${name}" is not in the sources`);
      }
    }

    return { score: checks === 0 ? 1 : 1 - violations / checks, findings };
  }
}
```

`for (const name of names)` — a Set iteration ✓ ES2022.

Now the ground-gate file — I'll finalize it with the imports from text-utils: checkQuantities, checkProperNouns, extractNumbers, splitSentences, vocabularyContainment. ✓ (all exported from text-utils).

Now — the final structure of text-utils.ts:

```ts
export const NUMBER_WORDS: Record<string, number> = {...};
export const NUMBER_WORD_BY_VALUE: Record<number, string> = {...};
export const STOPWORDS: Set<string> = new Set([...]);

export function splitSentences(text: string): string[]
export function escapeRegExp(value: string): string
export function tokenize(text: string): string[]
export function toNumber(token: string): number | null
export function extractNumbers(text: string): number[]
export function singularize(word: string): string
export interface QuantityPair {...}
export function extractQuantityPairs(text: string): QuantityPair[]
export function extractProperNouns(sentence: string): string[]
export function contentWords(text: string): Set<string>
export function vocabularyContainment(sentence: string, sources: string[]): number
export interface QuantityCheck {...}
export function checkQuantities(sentence: string, sources: string[]): QuantityCheck[]
export interface ProperNounCheck {...}
export function checkProperNouns(sentence: string, sources: string[]): ProperNounCheck[]
```

Hmm — checkQuantities/checkProperNouns in "text-utils" is a bit off-topic; but they're shared by the gate and the judge. Or I could put them in grounding-gate.ts and have the judge import from the gate. The judge importing from the answer module's gate — fine. But text-utils is already a grab-bag; I'll keep them in text-utils to keep a single import hub. Actually, let me reconsider: cohesion — `grounding-gate.ts` is the "gate" logic; the checks are the gate's rules. The judge reuses them. Either works. I'll put checkQuantities + checkProperNouns in text-utils.ts (they're pure text analysis), and the gate composes them. Done deliberating.

Wait, one more edge on extractQuantityPairs: a modifier that is a number? 'four 5 shards' → a='5' is not [A-Za-z]... isContentWord requires leading letter → '5' fails → then noun = a? no: `if (isContentWord(a) && isContentWord(b))` else `if (isContentWord(a))` — a='5' fails both → noun undefined → no pair ✓ (the bare number check handles the 5).

Edge: '4 x 5 shards'? tokens: 4, x, 5, shards → at '4': a='x' (word, len 1 — isContentWord: /^[A-Za-z][A-Za-z'-]*$/ → 'x' ✓ not a stopword → true), b='5' fails isContentWord → so noun = a = 'x'?? 'x' not a stopword → pair (4, 'x')! → noun 'x' not in source → drop. Hmm — over-drop on weird input; acceptable (conservative). Fine.

Now, `isContentWord`'s minimum length: 'x' passes. Well, I'll accept it.

Now, the STOPWORDS should include 'x'? No.

Also — one important re-check: `extractProperNouns` on 'The Ember Gate stands in the Hollow Vale.' → sequences: 'Ember Gate' ✓, 'Hollow Vale' ✓. Stripped: 'The     stands in the .' → tokens: The, stands, in, the → i=1: 'stands' no... ✓ → pns {Ember Gate, Hollow Vale} ✓.

Gate sentence 1: Ember Gate present ✓, Hollow Vale present ✓ → no pn reasons ✓.

All checks. Now — let me also verify that the harness's `buildLlm` fallback string doesn't accidentally match: the fallback is only used when no question matches.

Now the test files. Let me also verify that the eval spec test 'the faithfulness judge's signature takes the sources' — the withSources.score computed above = 0.25 → < 0.5 ✓; withoutSources.score = 0 → less than 0.25 ✓. And withSources.findings contains 'answer says 5 shard(s) but sources say 4' → includes '5' and '4' ✓.

Wait, recompute withSources on the lieText 'To open the Ember Gate, farm five moon shards in the Dusk Caverns.':
- falseFacts ['five moon shards'] → present ✓ → violation (1).
- Quantities: pairs: 'five moon shards' → tokens: To, open, the, Ember, Gate, farm, five, moon, shards, in, the, Dusk, Caverns → at 'five': a='moon' ✓ b='shards' ✓ → (5, shard). sourcePairs noun 'shard' → [4,4] → mismatch → violation (2), reason 'answer says 5 shard(s) but sources say 4'.
- Pns: Ember Gate ✓ present; Dusk Caverns → absent → violation (3).
checks = 1 + 1 + 2 = 4; violations 3 → score 0.25 ✓.

withoutSources (sources: []):
- falseFact present → 1.
- Quantity: sourcePairs [] → uniqueQs [] → nounInSources false → violation (2) reason '"shard" never appears in the sources'.
- Pns: Ember Gate absent (3), Dusk Caverns absent (4).
score 0 ✓ < 0.25 ✓.

Now the answer.service.spec 'confident lie fully dropped':
Scripted: 'To open the Ember Gate, farm five moon shards in the Dusk Caverns.' (one sentence) → dropped → refused ✓.

Let me also add a gate-level test that the reasons are non-empty for the dropped sentence? The spec says "test the behaviour, not the implementation" — the drop + refusal is the behavior. checkQuantities' exactness test covers "caught exactly". Enough.

Now — one more acceptance item: "a correct grounded answer scores high" — harness test ✓ (score 1 ≥ 0.9).

Now let me write it all out. And I'll verify imports for each test file.

test/answer.service.spec.ts imports:
- vitest: describe, expect, it
- AnswerService from '../src/answer/answer.service.js'
- REFUSAL_TEXT from '../src/answer/answer.types.js'
- checkQuantities from '../src/answer/text-utils.js'
- EMBER_GATE_PAGE, EMBER_SHARDS_PAGE from '../src/eval/scenarios.js'
- ScriptedLlmClient, LlmClient (type), LlmRequest, LlmResponse from '../src/llm/llm.client.js'

The CountingLlm implements LlmClient — I need the interface import.

test/hint-redactor.spec.ts:
- HintRedactor from '../src/answer/hint-redactor.js'

test/eval-harness.spec.ts:
- AnswerService, EvalHarness, GOLDEN_SCENARIOS, EMBER_GATE_PAGE, EMBER_SHARDS_PAGE, REFUSAL_TEXT, FaithfulnessJudge, combineScores.

Let me double-check: `import { ScriptedLlmClient, type LlmClient, type LlmRequest, type LlmResponse } from '../src/llm/llm.client.js';` — mixed value + type imports are fine.

Now the exact hint assertion for the spec redaction test:
Input: 'The Hollow Matriarch guards the Dusk Caverns and demands four ember shards.'
- Sequence: 'Hollow Matriarch' → '[redacted]'; 'Dusk Caverns' → '[redacted]'. → 'The [redacted] guards the [redacted] and demands four ember shards.'
- Tokens: The (i=0), '[redacted]' bare 'redacted' no, 'guards', 'the', '[redacted]' no, 'and', 'demands', 'four', 'ember', 'shards'. No single capitals.
- Numbers: 'four' → 4 not allowed → '[redacted]'.
→ 'The [redacted] guards the [redacted] and demands [redacted] ember shards.' ✓

Also assert all three are gone:
```ts
expect(out).not.toContain('Hollow Matriarch');
expect(out).not.toContain('Dusk Caverns');
expect(out).not.toMatch(/\bfour\b/);
expect(out).not.toMatch(/\b4\b/);
```

Now — a potential concern: the `REDATION` constant '[redacted]' — the word 'redacted' doesn't contain any number word ✓.

Digit test: 'Place 4 ember shards on the braziers.' question 'How do I open it?' → no allowed → 'Place [redacted] ember shards on the braziers.' ✓.

Preservation test: redactor.redact('Bring the three ember shards to the Hollow Vale.', 'I already have three shards. What now?') →
- Sequence: 'Hollow Vale' → [redacted].
- Numbers: 'three' → 3, question extractNumbers('I already have three shards. What now?') → tokenize: I, already, have, three, shards, What, now → toNumber('three') = 3 ✓ allowed → kept.
→ 'Bring the three ember shards to the [redacted].' ✓

Over-redaction sanity: output contains 'ember shards' ✓ and 'shards'.

Now, the service-level hint "one call" test:
```ts
class CountingLlm implements LlmClient {
  calls = 0;
  complete(_request: LlmRequest): LlmResponse {
    this.calls += 1;
    return { text: GATE_ANSWER };
  }
}
const llm = new CountingLlm();
const service = new AnswerService(llm);
const hint = service.answer('How do I open the Ember Gate?', SOURCES, 'hint');
expect(llm.calls).toBe(1);
expect(hint.status).toBe('answered');
expect(hint.text).toBe('The [redacted] stands in the [redacted]. You need [redacted] ember shards, placed on its [redacted] braziers.');
```
Where GATE_ANSWER = 'The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.'.

And a second: the hint is derived from the grounded answer:
```ts
const full = new AnswerService(new ScriptedLlmClient([{ match: 'question', reply: GATE_ANSWER }])).answer('How do I open the Ember Gate?', SOURCES, 'full');
expect(full.text).toBe(GATE_ANSWER);
// hint is a strict subset of information: every grounded sentence appears, redacted
```
I'll keep the assertion simple: full.text === GATE_ANSWER and hint.text contains '[redacted]' and doesn't contain 'Hollow Vale'.

Now — I'll make sure `makeService` uses a match that will always hit: the prompt contains 'Player question: ...' → includes('question') ✓.

All settled. One last convention sweep:
- Class names PascalCase ✓ (AnswerService, GroundingGate, HintRedactor, ScriptedLlmClient, HelpfulnessJudge, FaithfulnessJudge, EvalHarness).
- TS files kebab-case ✓ (llm.client.ts, answer.types.ts, text-utils.ts, grounding-gate.ts, hint-redactor.ts, answer.service.ts, scenarios.ts, judges.ts, eval-harness.ts).
- Comments in English ✓.
- Tests in test/<feature>.spec.ts — I have test/answer.service.spec.ts, test/hint-redactor.spec.ts, test/eval-harness.spec.ts ✓.
- No secrets, no connection strings ✓ (no DB at all).
- ESM "type": "module" ✓.

Wait — the layout convention says `test/<feature>.spec.ts` ✓ matches.

One: should I add `// ASSUMPTION:` comments? The task had no real unresolved symbols — the conventions' NestJS/Prisma don't apply to a non-API task; I resolved that silently with "NestJS for the API" (no API → no NestJS). Is that a "genuinely absent" symbol I should mark? The instructions: "If a symbol you need is genuinely absent from the task, do not guess in silence... use the most defensible reading and mark it with one // ASSUMPTION comment." I don't need any absent symbol. The convention/task tension is about scope, not symbols. I think one short assumption comment at the top of answer.service.ts noting that this is a library pipeline (no API layer) would be honest and cheap. Hmm — but it might be seen as noise. The rule says to mark points where I used a defensible reading for an unresolved gap. The gap: "should this use NestJS module wiring?" — genuinely unresolved given the conventions. I'll add one line in answer.service.ts: `// ASSUMPTION: the task defines no API layer, so the pipeline is plain TypeScript with constructor injection rather than NestJS modules.` That's the one point that matters. OK.

Also double-check that the `AnswerMode` default parameter doesn't violate the "answer(question, sources, mode)" contract — it's fine.

Now let me write out the final content of each file completely and carefully, and mentally compile it.

One more mental compile check for tricky bits:

1. `const hit = this.scripts.find((s) => request.prompt.includes(s.match));` → `ScriptedReply | undefined` ✓.

2. In `extractQuantityPairs`, `tokens[i]` — I named the loop variable `raw` after the undefined check. Let me write it as:
```ts
for (let i = 0; i < tokens.length; i++) {
  const numberToken = tokens[i];
  if (numberToken === undefined) continue;
  const quantity = toNumber(numberToken);
  if (quantity === null) continue;
  const a = tokens[i + 1];
  const b = tokens[i + 2];
  ...
}
```
✓.

3. `singularize(noun.toLowerCase())` — noun from the token; fine.

4. `raw` field: `` `${numberToken}${modifier !== undefined ? ` ${modifier}` : ''} ${noun}` `` — e.g. 'five moon shards' ✓.

5. In the redactor, `tokens[i] = token.replace(bare, REDACTION);` — token.replace with a string pattern ✓.

6. In `HintRedactor.redactSentence`, DIGIT_RE inline: `out.replace(/\b\d{1,3}\b/g, (m) => (allowed.has(parseInt(m, 10)) ? m : REDACTION))` ✓.

7. NUMBER_WORD_RE inline: `out.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, (m) => { const v = NUMBER_WORDS[m.toLowerCase()]; return v !== undefined && allowed.has(v) ? m : REDACTION; })` ✓.

8. Gate: `for (const n of new Set(extractNumbers(sentence)))` ✓.

9. The harness: `scenarios.map(...)` returns ScenarioResult[] ✓.

10. Tests: `results.find((r) => r.id === 'confident-lie')!` — I'll use a helper `byId(results, id)` that returns non-undefined:
```ts
function byId(results: ScenarioResult[], id: string): ScenarioResult {
  const r = results.find((x) => x.id === id);
  if (!r) throw new Error(`scenario ${id} missing from results`);
  return r;
}
```
Import the ScenarioResult type. ✓ Cleaner than `!`.

Now the vitest config — I'll keep it minimal.

Also, the "build" script? Only typecheck + test. Fine.

Let me reconsider the package.json versions: typescript ^5.5.4, vitest ^2.1.9 — safe majors for Node 20. ✓

tsconfig include: "src", "test", "vitest.config.ts" — vitest.config.ts imports 'vitest/config' — needs types from the vitest package ✓ (devDep). With noEmit true ✓.

Hmm — one thing: `module: NodeNext` + `moduleResolution: NodeNext` with vitest — vitest transforms TS itself; tsconfig only affects type-checking. ✓

Also the `"types"` field: not set → all @types included; I have no @types/node → the tests don't use node globals ✓. Do the tests use `process`? No. OK.

Let me reconsider whether the tests use any DOM/node APIs — no.

Now, the exact refusal string: "not covered by my sources" — the spec says to refuse with that exact text ✓ REFUSAL_TEXT = 'not covered by my sources'.

Let me also reconsider the scenario 'confident-lie' description and the planted false facts — the spec: "planted FALSE facts such as an invented item requirement" ✓ 'five moon shards' (invented item requirement), 'Moon Blade' (invented item), 'Dusk Caverns' (misattributed location) ✓.

I think the design is complete. Let me also confirm the tests don't accidentally depend on test order — each test builds its own service/harness ✓. runSuite() is called per test (fresh) ✓.

Now, one more edge on the containment for the 'quantity-mismatch' sentence 1: 'The Ember Gate is in the Hollow Vale.' → content words {ember, gate, hollow, vale} → all in source ✓ 1.0.

And its pns: Ember Gate ✓ Hollow Vale ✓. No numbers. → grounded ✓.

The gate's drop list for that scenario: ['You need five ember shards to open it.'] ✓ exactly one.

Verify the reasons for that sentence (for my confidence): pair (5,shard) mismatch reason; bare number 5 not in {4}; containment 0.4 < 0.5. ✓ dropped.

Final answer text: 'The Ember Gate is in the Hollow Vale.' ✓.

Now let me write it all out. I'll be meticulous with the STOPWORDS list formatting.

Also, the STOPWORDS: I listed 'i', 'me', 'my' etc. lowercase — contentWords lowercases before the check ✓. But isContentWord (quantity extraction) checks `t.toLowerCase()` against STOPWORDS, and t may be capitalized 'The' → 'the' ✓.

One more: tokenize('its four braziers') → its, four, braziers ✓.

In extractQuantityPairs, 'its' is a stopword ✓ irrelevant (only a/b matter).

Now — let me think about the 'Gather four ember shards and the gate opens.' → at 'four': a='ember' b='shards' → (4, shard) ✓.

And 'heating cinder glass over a flame' — no numbers ✓.

Now, the source number set for the gate: extractNumbers(GATE_PAGE) → 'four' ×2 → [4,4]; EMBER_SHARDS_PAGE → 'four' → [4]. Union {4} ✓.

OK — one more, potential subtle bug: `contentWords` skips tokens with `w.length <= 2` — 'he' etc. fine. And skips pure digits ✓ (numbers handled separately).

Also `vocabularyContainment` — the source is flatMapped into a Set of sets: `new Set(sources.flatMap((s) => [...contentWords(s)]))` ✓.

Time to write. Also, I'll keep the code comments brief and meaningful (English).

One more decision: `GroundingGate` is exported as a class with a constructor option; the service instantiates a default. The tests use the service + direct utilities. Should I add a direct gate test? The service tests cover the gate's behavior end-to-end. Maybe I'll add one focused gate test in answer.service.spec: "the gate reports why a sentence was dropped":
```ts
const gate = new GroundingGate();
const report = gate.evaluate('You need five ember shards to open the Ember Gate.', SOURCES);
expect(report.droppedSentences).toEqual(['You need five ember shards to open the Ember Gate.']);
expect(report.verdicts[0]!.reasons.length).toBeGreaterThan(0);
expect(report.verdicts[0]!.reasons.join(' ')).toMatch(/5/);
expect(report.verdicts[0]!.reasons.join(' ')).toMatch(/4/);
```
I'll add it — it directly demonstrates "caught exactly" at the gate level. Import GroundingGate.

Now let me finalize the file contents.

Actually — one more thought on `exactOptionalPropertyTypes` — I won't enable it. The `QuantityCheck.reason?: string` with explicit undefined assignment `reason: string | undefined` — under plain strict (without exactOptionalPropertyTypes), assigning undefined to an optional property is fine. I'll initialize `let reason: string | undefined;` and return the object with `reason` — fine.

In ProperNounCheck I return an object literal without `reason` when grounded — fine.

Let me also make sure `checkQuantities`'s returned objects always have all fields: { pair, grounded, reason, sourceQuantities, nounInSources } ✓.

Writing the eval harness spec's 'caught exactly' test — I need the raw scripted text; I'll get it from the scenario:
```ts
const scenario = GOLDEN_SCENARIOS.find((s) => s.id === 'quantity-mismatch')!;
```
Again `!` — I'll write a small helper `scenarioById(id)`. Or import the specific scripted answer as a const? The scenarios are data; a helper is fine:
```ts
function scenarioById(id: string): GoldenScenario {
  const s = GOLDEN_SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario ${id}`);
  return s;
}
```
Import the GoldenScenario type.

Now let me also confirm the eval test 'the suite runs every golden scenario':
```ts
const results = runSuite();
expect(results).toHaveLength(GOLDEN_SCENARIOS.length);
expect(results.map((r) => r.id)).toEqual(GOLDEN_SCENARIOS.map((s) => s.id));
```
✓

OK, and one more consideration for the harness's run(): mode 'full' — but should the harness also verify the hint in a spoiler-free way? The spec's harness focuses on the two judges. The hint is tested separately. I'll keep it.

Now let me write out the files. I'll order them: package.json, tsconfig.json, vitest.config.ts, src/llm/llm.client.ts, src/answer/answer.types.ts, src/answer/text-utils.ts, src/answer/grounding-gate.ts, src/answer/hint-redactor.ts, src/answer/answer.service.ts, src/eval/scenarios.ts, src/eval/judges.ts, src/eval/eval-harness.ts, test/answer.service.spec.ts, test/hint-redactor.spec.ts, test/eval-harness.spec.ts.

Let me carefully write out text-utils.ts in full:

```ts
/**
 * Pure text analysis shared by the grounding gate, the hint redactor and the
 * eval judges: sentence splitting, number/quantity extraction, proper noun
 * extraction and source containment checks.
 */

export const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

export const NUMBER_WORD_BY_VALUE: Record<number, string> = {
  0: 'zero',
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
};

export const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'at', 'by', 'for',
  'from', 'in', 'into', 'on', 'onto', 'over', 'under', 'up', 'down', 'out', 'off',
  'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'done', 'have', 'has', 'had', 'having', 'will', 'would', 'shall', 'should', 'can',
  'could', 'may', 'might', 'must', 'to', 'that', 'this', 'these', 'those', 'it',
  'its', 'you', 'your', 'yours', 'we', 'our', 'ours', 'i', 'me', 'my', 'mine', 'he',
  'she', 'they', 'them', 'his', 'her', 'their', 'so', 'such', 'than', 'too', 'very',
  'just', 'not', 'no', 'nor', 'any', 'all', 'each', 'few', 'more', 'most', 'other',
  'some', 'until', 'against', 'between', 'through', 'during', 'before', 'after',
  'above', 'below', 'again', 'further', 'once', 'here', 'there', 'why', 'how',
  'what', 'which', 'who', 'whom', 'where', 'because', 'about',
]);

/** Split on sentence-final punctuation followed by whitespace. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Words and digits, punctuation stripped. */
export function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9]+(?:'[A-Za-z]+)?/g) ?? [];
}

/** A token's numeric value if it is a small digit or number word. */
export function toNumber(token: string): number | null {
  if (/^\d{1,3}$/.test(token)) return parseInt(token, 10);
  return NUMBER_WORDS[token.toLowerCase()] ?? null;
}

/** Every number (digit or small number word) in the text. */
export function extractNumbers(text: string): number[] {
  const found: number[] = [];
  for (const t of tokenize(text)) {
    const n = toNumber(t);
    if (n !== null) found.push(n);
  }
  return found;
}

export function singularize(word: string): string {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
}

export interface QuantityPair {
  quantity: number;
  /** Singularised head noun, lowercased, e.g. "shard". */
  noun: string;
  /** The raw phrase, e.g. "five ember shards". */
  raw: string;
}

/**
 * "quantity + noun" phrases, with at most one modifier word
 * ("five moon shards" -> {quantity: 5, noun: "shard"}). A bare number followed
 * by stopwords yields no pair — it is still checked by extractNumbers.
 */
export function extractQuantityPairs(text: string): QuantityPair[] {
  const tokens = tokenize(text);
  const pairs: QuantityPair[] = [];
  const isContentWord = (t: string): boolean =>
    /^[A-Za-z][A-Za-z'-]*$/.test(t) && !STOPWORDS.has(t.toLowerCase());

  for (let i = 0; i < tokens.length; i++) {
    const numberToken = tokens[i];
    if (numberToken === undefined) continue;
    const quantity = toNumber(numberToken);
    if (quantity === null) continue;

    const a = tokens[i + 1];
    const b = tokens[i + 2];
    let modifier: string | undefined;
    let noun: string | undefined;
    if (isContentWord(a ?? '') && isContentWord(b ?? '')) {
      modifier = a;
      noun = b;
    } else if (isContentWord(a ?? '')) {
      noun = a;
    }
    // "four braziers. The" -> the "noun" is a stopword; fall back to the modifier slot.
    if (noun !== undefined && STOPWORDS.has(noun.toLowerCase()) && modifier !== undefined) {
      noun = modifier;
      modifier = undefined;
    }
    if (noun === undefined || STOPWORDS.has(noun.toLowerCase())) continue;

    pairs.push({
      quantity,
      noun: singularize(noun.toLowerCase()),
      raw: `${numberToken}${modifier !== undefined ? ` ${modifier}` : ''} ${noun}`,
    });
  }
  return pairs;
}

/**
 * Proper nouns in one sentence: multi-word capitalised sequences
 * ("Ember Gate", "Dusk Caverns") plus single capitalised words of 3+ letters
 * that are not the first token (a sentence-initial word is ambiguous with
 * ordinary capitalisation and is left to the containment check).
 */
export function extractProperNouns(sentence: string): string[] {
  const found = new Set<string>();
  const sequenceRe = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
  const sequences = sentence.match(sequenceRe) ?? [];
  for (const s of sequences) found.add(s);

  const tokens = sentence.replace(sequenceRe, ' ').split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === undefined) continue;
    const bare = t.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
    if (/^[A-Z][a-z]{2,}$/.test(bare)) found.add(bare);
  }
  return [...found];
}

/** Unique content words of a text (lowercased, stopwords and numbers removed). */
export function contentWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const t of tokenize(text)) {
    const w = t.toLowerCase();
    if (w.length <= 2 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    words.add(w);
  }
  return words;
}

/** Fraction of the sentence's unique content words that appear in the sources. */
export function vocabularyContainment(sentence: string, sources: string[]): number {
  const words = contentWords(sentence);
  if (words.size === 0) return 1;
  const sourceWords = new Set(sources.flatMap((s) => [...contentWords(s)]));
  let hits = 0;
  for (const w of words) if (sourceWords.has(w)) hits += 1;
  return hits / words.size;
}

export interface QuantityCheck {
  pair: QuantityPair;
  grounded: boolean;
  /** Why the pair is unsupported (undefined when grounded). */
  reason: string | undefined;
  /** Quantities the sources attach to the same noun. */
  sourceQuantities: number[];
  nounInSources: boolean;
}

/**
 * Exact quantity checking: a "N noun" claim is grounded only when the sources
 * themselves say "N noun" for that same noun. "5 shards" against sources that
 * say 4 is a mismatch, and a noun the sources never quantify is unsupported.
 */
export function checkQuantities(sentence: string, sources: string[]): QuantityCheck[] {
  const sourcePairs = sources.flatMap((s) => extractQuantityPairs(s));
  return extractQuantityPairs(sentence).map((pair) => {
    const sourceQuantities = sourcePairs
      .filter((sp) => sp.noun === pair.noun)
      .map((sp) => sp.quantity);
    const uniqueSourceQuantities = [...new Set(sourceQuantities)];
    const nounInSources = sources.some(
      (s) => new RegExp(`\\b${escapeRegExp(pair.noun)}s?\\b`, 'i').test(s),
    );

    let grounded: boolean;
    let reason: string | undefined;
    if (!nounInSources) {
      grounded = false;
      reason = `"${pair.noun}" never appears in the sources`;
    } else if (uniqueSourceQuantities.length === 0) {
      grounded = false;
      reason = `sources never state a quantity for "${pair.noun}"`;
    } else if (!uniqueSourceQuantities.includes(pair.quantity)) {
      grounded = false;
      reason = `answer says ${pair.quantity} ${pair.noun}(s) but sources say ${uniqueSourceQuantities.join(' or ')}`;
    } else {
      grounded = true;
    }
    return { pair, grounded, reason, sourceQuantities, nounInSources };
  });
}

export interface ProperNounCheck {
  name: string;
  grounded: boolean;
  reason: string | undefined;
}

export function checkProperNouns(sentence: string, sources: string[]): ProperNounCheck[] {
  return extractProperNouns(sentence).map((name) => {
    const inSources = sources.some(
      (s) => new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(s),
    );
    return inSources
      ? { name, grounded: true, reason: undefined }
      : { name, grounded: false, reason: `"${name}" is not in the sources` };
  });
}
```

Wait — a potential issue in extractProperNouns: I reuse `sequenceRe` (a /g regex) in both `sentence.match` and `sentence.replace`. `String.match` with a global regex resets lastIndex to 0 after running ✓. `replace` with global: the ReplaceAll operation sets lastIndex to 0 first ✓. Both safe. But to be extra safe, I'll create two separate regex variables (two literals). Let me do that:

```ts
const sequenceMatch = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
const sequences = sentence.match(sequenceMatch) ?? [];
...
const tokens = sentence.replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, ' ').split(/\s+/);
```
Two independent literals — no shared state. ✓

Now, the `raw` in `QuantityPair` uses the original-cased `noun` (e.g. 'Shards') — the message 'answer says 5 Shards(s)...' hmm — the test checks for 5/4 presence, fine. But for looks, I'll use the lowercased noun in raw? raw is "the raw phrase" — the original casing is more "raw". I'll keep the original.

Hmm wait, actually in checkQuantities' mismatch reason I use `pair.noun` (singular lowercase) — 'answer says 5 shard(s) but sources say 4' ✓.

Now the final grounding-gate.ts:

```ts
import {
  checkProperNouns,
  checkQuantities,
  extractNumbers,
  splitSentences,
  vocabularyContainment,
} from './text-utils.js';

export interface SentenceVerdict {
  sentence: string;
  grounded: boolean;
  /** Why the sentence was dropped; empty when grounded. */
  reasons: string[];
}

export interface GateReport {
  verdicts: SentenceVerdict[];
  groundedSentences: string[];
  droppedSentences: string[];
}

export interface GroundingGateOptions {
  /** Minimum fraction of a sentence's content words that must appear in the sources (default 0.5). */
  minVocabularyContainment?: number;
}

/**
 * Sentence-level grounding gate on the production path. Each sentence of the
 * model's answer must be supported by the source texts or it is dropped.
 * A sentence is dropped when any of the following holds:
 *
 *  - a quantity claim ("5 shards") is not exactly supported by the sources,
 *  - it uses a number that appears nowhere in the sources,
 *  - it mentions a proper noun ("Dusk Caverns") the sources do not contain,
 *  - less than `minVocabularyContainment` of its content words are found in the sources.
 *
 * The checks are deliberately conservative: when in doubt, the sentence is dropped.
 */
export class GroundingGate {
  private readonly minContainment: number;

  constructor(options: GroundingGateOptions = {}) {
    this.minContainment = options.minVocabularyContainment ?? 0.5;
  }

  evaluate(answer: string, sources: string[]): GateReport {
    const sourceNumbers = new Set(sources.flatMap((s) => extractNumbers(s)));

    const verdicts: SentenceVerdict[] = splitSentences(answer).map((sentence) => {
      const reasons: string[] = [];

      for (const check of checkQuantities(sentence, sources)) {
        if (!check.grounded && check.reason) reasons.push(check.reason);
      }
      for (const n of new Set(extractNumbers(sentence))) {
        if (!sourceNumbers.has(n)) reasons.push(`number ${n} does not appear in any source`);
      }
      for (const check of checkProperNouns(sentence, sources)) {
        if (!check.grounded && check.reason) reasons.push(check.reason);
      }
      const containment = vocabularyContainment(sentence, sources);
      if (containment < this.minContainment) {
        reasons.push(`only ${Math.round(containment * 100)}% of its vocabulary is found in the sources`);
      }

      return { sentence, grounded: reasons.length === 0, reasons };
    });

    return {
      verdicts,
      groundedSentences: verdicts.filter((v) => v.grounded).map((v) => v.sentence),
      droppedSentences: verdicts.filter((v) => !v.grounded).map((v) => v.sentence),
    };
  }
}
```

✓.

hint-redactor.ts final:

```ts
import { NUMBER_WORDS, extractNumbers, splitSentences } from './text-utils.js';

export const REDACTION = '[redacted]';

/**
 * Hint mode is a redaction of the grounded answer, never a second LLM call:
 * a second generation is a fresh opportunity to reveal or invent spoilers;
 * a redaction of a gated answer can only remove information.
 *
 * Rule set:
 *  - proper nouns (multi-word sequences, and single capitalised words that are
 *    not the first word of a sentence) become "[redacted]" — this removes boss
 *    names and locations;
 *  - any quantity (digit or number word) the player did not already mention in
 *    their question becomes "[redacted]".
 * Common-case wording is left intact on purpose: over-redaction makes hints
 * useless, and the gate has already guaranteed the wording is source-grounded.
 */
export class HintRedactor {
  redact(groundedAnswer: string, playerQuestion: string): string {
    const allowed = new Set(extractNumbers(playerQuestion));
    return splitSentences(groundedAnswer)
      .map((sentence) => this.redactSentence(sentence, allowed))
      .join(' ');
  }

  private redactSentence(sentence: string, allowed: Set<number>): string {
    let out = sentence.replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, REDACTION);

    const tokens = out.split(/(\s+)/);
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === undefined) continue;
      const bare = token.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
      if (/^[A-Z][a-z]{2,}$/.test(bare)) {
        tokens[i] = token.replace(bare, REDACTION);
      }
    }
    out = tokens.join('');

    out = out.replace(/\b\d{1,3}\b/g, (match) =>
      allowed.has(parseInt(match, 10)) ? match : REDACTION,
    );
    out = out.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, (match) => {
      const value = NUMBER_WORDS[match.toLowerCase()];
      return value !== undefined && allowed.has(value) ? match : REDACTION;
    });
    return out;
  }
}
```

✓.

answer.service.ts final (with the assumption comment):

```ts
import type { LlmClient } from '../llm/llm.client.js';
import { REFUSAL_TEXT, type AnswerMode, type AnswerResult } from './answer.types.js';
import { GroundingGate } from './grounding-gate.js';
import { HintRedactor } from './hint-redactor.js';

// ASSUMPTION: the task defines no API layer, so the pipeline is plain
// TypeScript with constructor injection rather than NestJS module wiring.
export class AnswerService {
  constructor(
    private readonly llm: LlmClient,
    private readonly gate: GroundingGate = new GroundingGate(),
    private readonly redactor: HintRedactor = new HintRedactor(),
  ) {}

  /**
   * The production pipeline:
   *  1. one LLM call, always prompting for the full grounded answer
   *     (hint mode never re-prompts — that was the spoiler bug);
   *  2. a sentence-level grounding gate drops every unsupported sentence;
   *  3. if nothing survives, refuse: "not covered by my sources";
   *  4. in hint mode, redact the surviving answer instead of regenerating it.
   */
  answer(question: string, sources: string[], mode: AnswerMode = 'full'): AnswerResult {
    const raw = this.llm.complete({ prompt: buildPrompt(question, sources) }).text;
    const report = this.gate.evaluate(raw, sources);

    if (report.groundedSentences.length === 0) {
      // Refusing is a correct outcome, not a failure path.
      return { mode, status: 'refused', text: REFUSAL_TEXT, droppedSentences: report.droppedSentences };
    }

    const grounded = report.groundedSentences.join(' ');
    if (mode === 'hint') {
      return {
        mode,
        status: 'answered',
        text: this.redactor.redact(grounded, question),
        droppedSentences: report.droppedSentences,
      };
    }
    return { mode, status: 'answered', text: grounded, droppedSentences: report.droppedSentences };
  }
}

function buildPrompt(question: string, sources: string[]): string {
  return [
    'You are a game guide assistant. Answer the player question using ONLY the wiki pages provided below.',
    'Do not invent items, quantities, or places. If the pages do not cover the question, say exactly that.',
    '',
    'Wiki pages:',
    ...sources.map((page, i) => `--- Page ${i + 1} ---\n${page}`),
    '',
    `Player question: ${question}`,
  ].join('\n');
}
```

✓.

scenarios.ts — as drafted above.

judges.ts — as drafted. Let me finalize:

```ts
import {
  escapeRegExp,
  extractProperNouns,
  NUMBER_WORD_BY_VALUE,
  splitSentences,
  toNumber,
  tokenize,
} from '../answer/text-utils.js';
import { isRefusal } from '../answer/answer.types.js';
import type { ExpectedOutcome } from './scenarios.js';

export interface JudgeVerdict {
  /** Score in [0, 1]. */
  score: number;
  findings: string[];
}

/** Tokens with numbers normalised to words, so "4" and "four" match. */
function normalizedTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const t of tokenize(text)) {
    const n = toNumber(t);
    tokens.add(n !== null ? (NUMBER_WORD_BY_VALUE[n] ?? t.toLowerCase()) : t.toLowerCase());
  }
  return tokens;
}

/** A fact is present when every one of its tokens appears in the text. */
export function factPresent(fact: string, text: string): boolean {
  const factTokens = normalizedTokens(fact);
  if (factTokens.size === 0) return false;
  const textTokens = normalizedTokens(text);
  for (const t of factTokens) if (!textTokens.has(t)) return false;
  return true;
}

export interface HelpfulnessExpectation {
  expectedOutcome: ExpectedOutcome;
  expectedFacts: readonly string[];
}

/**
 * Helpfulness: does the output deliver what the player needs? A refusal is
 * helpful only when the sources do not cover the question; an answer is
 * helpful in proportion to the expected facts it actually carries.
 */
export class HelpfulnessJudge {
  judge(answer: string, expectation: HelpfulnessExpectation): JudgeVerdict {
    const refused = isRefusal(answer);

    if (expectation.expectedOutcome === 'refusal') {
      return refused
        ? { score: 1, findings: [] }
        : { score: 0, findings: ['expected a refusal (sources lack the answer) but got an answer'] };
    }
    if (refused) {
      return { score: 0, findings: ['useless refusal: the sources cover the question but the service refused'] };
    }

    const facts = expectation.expectedFacts;
    if (facts.length === 0) return { score: 1, findings: [] };
    const missing = facts.filter((f) => !factPresent(f, answer));
    return {
      score: (facts.length - missing.length) / facts.length,
      findings: missing.map((f) => `missing expected fact: ${f}`),
    };
  }
}

export interface FaithfulnessContext {
  /** The source texts — part of the signature on purpose: without them the judge could only score fluency. */
  sources: string[];
  /** Planted false facts the answer must not contain. */
  falseFacts: readonly string[];
}

/**
 * Faithfulness: is everything claimed in the answer supported by the sources
 * it was given? Checks planted false facts, exact quantities, and proper
 * nouns against the source texts.
 */
export class FaithfulnessJudge {
  judge(answer: string, context: FaithfulnessContext): JudgeVerdict {
    const findings: string[] = [];
    let checks = 0;
    let violations = 0;

    for (const falseFact of context.falseFacts) {
      checks += 1;
      if (factPresent(falseFact, answer)) {
        violations += 1;
        findings.push(`answer contains a fact the sources do not support: "${falseFact}"`);
      }
    }

    for (const check of checkQuantities(answer, context.sources)) {
      checks += 1;
      if (!check.grounded && check.reason) {
        violations += 1;
        findings.push(check.reason);
      }
    }

    const names = new Set(splitSentences(answer).flatMap((s) => extractProperNouns(s)));
    for (const name of names) {
      checks += 1;
      const inSources = context.sources.some(
        (s) => new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(s),
      );
      if (!inSources) {
        violations += 1;
        findings.push(`"${name}" is not in the sources`);
      }
    }

    return { score: checks === 0 ? 1 : 1 - violations / checks, findings };
  }
}

/** Final score: min(helpful, faithful) — averaging would let a fluent lie hide. */
export function combineScores(helpfulness: number, faithfulness: number): number {
  return Math.min(helpfulness, faithfulness);
}
```
Need to import checkQuantities! Add to the import list: checkQuantities. ✓ (I forgot — include it.)

eval-harness.ts final:

```ts
import { AnswerService } from '../answer/answer.service.js';
import { ScriptedLlmClient } from '../llm/llm.client.js';
import { combineScores, FaithfulnessJudge, HelpfulnessJudge } from './judges.js';
import type { GoldenScenario } from './scenarios.js';

export interface ScenarioResult {
  id: string;
  status: 'answered' | 'refused';
  answer: string;
  helpful: number;
  faithful: number;
  /** min(helpful, faithful) */
  score: number;
  findings: string[];
  droppedSentences: string[];
}

/**
 * Golden-scenario eval harness. A scripted fake LLM returns each scenario's
 * planted answer (including confident lies); the pipeline runs over it; and
 * two judges score the output — helpfulness and a faithfulness judge that
 * receives the source texts. Final score = min(helpful, faithful).
 */
export class EvalHarness {
  constructor(
    private readonly helpfulJudge: HelpfulnessJudge = new HelpfulnessJudge(),
    private readonly faithfulnessJudge: FaithfulnessJudge = new FaithfulnessJudge(),
  ) {}

  /** Fake LLM keyed by question: each scenario's scripted answer, planted verbatim. */
  buildLlm(scenarios: readonly GoldenScenario[]): ScriptedLlmClient {
    return new ScriptedLlmClient(
      scenarios.map((s) => ({ match: s.question, reply: s.scriptedAnswer })),
      'The provided pages do not cover this.',
    );
  }

  run(scenarios: readonly GoldenScenario[], service: AnswerService): ScenarioResult[] {
    return scenarios.map((scenario) => {
      const result = service.answer(scenario.question, scenario.sources, 'full');
      const helpful = this.helpfulJudge.judge(result.text, {
        expectedOutcome: scenario.expectedOutcome,
        expectedFacts: scenario.expectedFacts,
      });
      const faithful = this.faithfulnessJudge.judge(result.text, {
        sources: scenario.sources,
        falseFacts: scenario.falseFacts,
      });
      return {
        id: scenario.id,
        status: result.status,
        answer: result.text,
        helpful: helpful.score,
        faithful: faithful.score,
        score: combineScores(helpful.score, faithful.score),
        findings: [...helpful.findings, ...faithful.findings],
        droppedSentences: result.droppedSentences,
      };
    });
  }
}
```

Now the test files.

test/answer.service.spec.ts:

```ts
import { describe, expect, it } from 'vitest';

import { AnswerService } from '../src/answer/answer.service.js';
import { REFUSAL_TEXT } from '../src/answer/answer.types.js';
import { GroundingGate } from '../src/answer/grounding-gate.js';
import { checkQuantities } from '../src/answer/text-utils.js';
import { EMBER_GATE_PAGE, EMBER_SHARDS_PAGE } from '../src/eval/scenarios.js';
import {
  ScriptedLlmClient,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
} from '../src/llm/llm.client.js';

const SOURCES = [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE];
const GATED_ANSWER =
  'The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.';

function serviceWith(answer: string): AnswerService {
  return new AnswerService(new ScriptedLlmClient([{ match: 'question', reply: answer }]));
}

class CountingLlm implements LlmClient {
  calls = 0;
  constructor(private readonly reply: string) {}
  complete(_request: LlmRequest): LlmResponse {
    this.calls += 1;
    return { text: this.reply };
  }
}

describe('AnswerService.answer (full mode)', () => {
  it('ships a fully grounded answer unchanged', () => {
    const result = serviceWith(GATED_ANSWER).answer('How do I open the Ember Gate?', SOURCES, 'full');
    expect(result.status).toBe('answered');
    expect(result.text).toBe(GATED_ANSWER);
    expect(result.droppedSentences).toEqual([]);
  });

  it('refuses with the exact refusal text when the sources lack the answer', () => {
    const result = serviceWith('Rest at the Waystone Shrine to fully heal your party.').answer(
      'How do I heal my party outside of combat?',
      SOURCES,
      'full',
    );
    expect(result.status).toBe('refused');
    expect(result.text).toBe(REFUSAL_TEXT);
  });

  it('refuses a fully ungrounded confident lie', () => {
    const lie = 'To open the Ember Gate, farm five moon shards in the Dusk Caverns.';
    const result = serviceWith(lie).answer('What do I need to open the Ember Gate?', SOURCES, 'full');
    expect(result.status).toBe('refused');
    expect(result.text).toBe(REFUSAL_TEXT);
    expect(result.droppedSentences).toEqual([lie]);
  });

  it('drops only the ungrounded sentence, keeping the grounded one', () => {
    const raw = 'The Ember Gate is in the Hollow Vale. You need five ember shards to open it.';
    const result = serviceWith(raw).answer('How many ember shards do I need for the Ember Gate?', SOURCES, 'full');
    expect(result.status).toBe('answered');
    expect(result.text).toBe('The Ember Gate is in the Hollow Vale.');
    expect(result.droppedSentences).toEqual(['You need five ember shards to open it.']);
    expect(result.text).not.toMatch(/five|\b5\b/);
  });

  it('catches a quantity error exactly: 5 shards against sources saying 4', () => {
    const checks = checkQuantities('You need five ember shards to open the Ember Gate.', SOURCES);
    expect(checks).toHaveLength(1);
    const check = checks[0];
    expect(check).toBeDefined();
    expect(check!.pair.quantity).toBe(5);
    expect(check!.pair.noun).toBe('shard');
    expect(check!.sourceQuantities).toEqual([4, 4]);
    expect(check!.grounded).toBe(false);
    expect(check!.reason).toMatch(/5/);
    expect(check!.reason).toMatch(/4/);
  });

  it('reports the exact mismatch in the gate verdict', () => {
    const gate = new GroundingGate();
    const report = gate.evaluate('You need five ember shards to open the Ember Gate.', SOURCES);
    expect(report.droppedSentences).toEqual(['You need five ember shards to open the Ember Gate.']);
    const verdict = report.verdicts[0];
    expect(verdict).toBeDefined();
    expect(verdict!.grounded).toBe(false);
    const reasons = verdict!.reasons.join(' ');
    expect(reasons).toMatch(/5/);
    expect(reasons).toMatch(/4/);
  });
});

describe('AnswerService.answer (hint mode)', () => {
  it('makes exactly one LLM call and redacts the grounded answer', () => {
    const llm = new CountingLlm(GATED_ANSWER);
    const service = new AnswerService(llm);
    const hint = service.answer('How do I open the Ember Gate?', SOURCES, 'hint');

    expect(llm.calls).toBe(1);
    expect(hint.status).toBe('answered');
    expect(hint.text).toBe(
      'The [redacted] stands in the [redacted]. You need [redacted] ember shards, placed on its [redacted] braziers.',
    );
  });

  it('is a redaction of the full grounded answer, not a fresh generation', () => {
    const service = serviceWith(GATED_ANSWER);
    const full = service.answer('How do I open the Ember Gate?', SOURCES, 'full');
    const hint = service.answer('How do I open the Ember Gate?', SOURCES, 'hint');
    expect(full.text).toBe(GATED_ANSWER);
    expect(hint.text).toContain('[redacted]');
    expect(hint.text).not.toContain('Ember Gate');
    expect(hint.text).not.toContain('Hollow Vale');
    expect(hint.text).not.toMatch(/\b(four|4)\b/);
  });

  it('keeps quantities the player already mentioned in their question', () => {
    const result = serviceWith('You need four ember shards, placed on its four braziers.').answer(
      'I already have four shards — is that enough?',
      SOURCES,
      'hint',
    );
    expect(result.status).toBe('answered');
    expect(result.text).toContain('four');
    expect(result.text).not.toContain('Hollow Vale');
  });
});
```

Wait — the hint "keeps quantities the player mentioned" test: the sentence 'You need four ember shards, placed on its four braziers.' gate: pairs (4,shard) ✓ (4,brazier) ✓; containment {need, four, ember, shards, placed, braziers} → 5/6 ✓ → survives ✓. Hint: no sequence; 'You' is skipped; 'four' ×2 allowed (question has 'four') → kept. Output: 'You need four ember shards, placed on its four braziers.' → contains 'four' ✓. Also 'Hollow Vale' not in it ✓ trivially. Fine.

Hmm — the `check!.pair` pattern after toBeDefined — `check` is QuantityCheck | undefined; I assert toBeDefined then use `check!` — works. Or restructure: `const check = checks[0]!;` directly. I'll use `!` for concision.

test/hint-redactor.spec.ts:

```ts
import { describe, expect, it } from 'vitest';

import { HintRedactor } from '../src/answer/hint-redactor.js';

const redactor = new HintRedactor();

describe('HintRedactor.redact', () => {
  it('removes a boss name, a location and a quantity in one sentence', () => {
    const out = redactor.redact(
      'The Hollow Matriarch guards the Dusk Caverns and demands four ember shards.',
      'How do I progress?',
    );
    expect(out).not.toContain('Hollow Matriarch');
    expect(out).not.toContain('Dusk Caverns');
    expect(out).not.toMatch(/\bfour\b/i);
    expect(out).not.toMatch(/\b4\b/);
    expect(out).toBe('The [redacted] guards the [redacted] and demands [redacted] ember shards.');
  });

  it('redacts digit quantities too', () => {
    const out = redactor.redact('Place 4 ember shards on the braziers.', 'How do I open it?');
    expect(out).toBe('Place [redacted] ember shards on the braziers.');
  });

  it('keeps quantities the player already mentioned', () => {
    const out = redactor.redact(
      'Bring the three ember shards to the Hollow Vale.',
      'I already have three shards. What now?',
    );
    expect(out).toContain('three');
    expect(out).not.toContain('Hollow Vale');
    expect(out).toBe('Bring the three ember shards to the [redacted].');
  });

  it('does not over-redact common-case wording', () => {
    const out = redactor.redact('Place the ember shards on the braziers.', 'How do I open it?');
    expect(out).toContain('ember shards');
    expect(out).toContain('braziers');
    expect(out).not.toContain('[redacted]');
  });
});
```

Verify 'does not over-redact': 'Place the ember shards on the braziers.' — no sequence; 'Place' is i=0 skipped; no numbers → no change ✓ no '[redacted]' ✓.

test/eval-harness.spec.ts:

```ts
import { describe, expect, it } from 'vitest';

import { AnswerService } from '../src/answer/answer.service.js';
import { REFUSAL_TEXT } from '../src/answer/answer.types.js';
import { EvalHarness, type ScenarioResult } from '../src/eval/eval-harness.js';
import { combineScores, FaithfulnessJudge } from '../src/eval/judges.js';
import {
  EMBER_GATE_PAGE,
  EMBER_SHARDS_PAGE,
  GOLDEN_SCENARIOS,
  type GoldenScenario,
} from '../src/eval/scenarios.js';

const SOURCES = [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE];

function runSuite(): ScenarioResult[] {
  const harness = new EvalHarness();
  const service = new AnswerService(harness.buildLlm(GOLDEN_SCENARIOS));
  return harness.run(GOLDEN_SCENARIOS, service);
}

function byId(results: ScenarioResult[], id: string): ScenarioResult {
  const result = results.find((r) => r.id === id);
  if (!result) throw new Error(`scenario "${id}" missing from results`);
  return result;
}

function scenarioById(id: string): GoldenScenario {
  const scenario = GOLDEN_SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`unknown scenario "${id}"`);
  return scenario;
}

describe('eval harness over the golden scenarios', () => {
  it('runs every golden scenario', () => {
    const results = runSuite();
    expect(results).toHaveLength(GOLDEN_SCENARIOS.length);
    expect(results.map((r) => r.id)).toEqual(GOLDEN_SCENARIOS.map((s) => s.id));
  });

  it('scores a correct grounded answer high', () => {
    const grounded = byId(runSuite(), 'grounded-answer');
    expect(grounded.status).toBe('answered');
    expect(grounded.answer).toBe(
      'The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.',
    );
    expect(grounded.score).toBeGreaterThanOrEqual(0.9);
  });

  it('scores a scripted confident lie low', () => {
    const lie = byId(runSuite(), 'confident-lie');
    expect(lie.status).toBe('refused');
    expect(lie.answer).toBe(REFUSAL_TEXT);
    expect(lie.helpful).toBe(0);
    expect(lie.score).toBeLessThan(0.2);
  });

  it('scores a correct refusal (sources lack the answer) as correct', () => {
    const refusal = byId(runSuite(), 'sources-lack-answer');
    expect(refusal.status).toBe('refused');
    expect(refusal.answer).toBe(REFUSAL_TEXT);
    expect(refusal.score).toBeGreaterThanOrEqual(0.9);
  });

  it('catches "5 shards" against sources saying 4, exactly', () => {
    const scenario = scenarioById('quantity-mismatch');
    const result = byId(runSuite(), 'quantity-mismatch');

    // The gate drops the wrong-quantity sentence and only that sentence.
    expect(result.droppedSentences).toEqual(['You need five ember shards to open it.']);
    expect(result.answer).not.toMatch(/five|\b5\b/);

    // The faithfulness judge, run on the raw planted text, names the exact mismatch.
    const verdict = new FaithfulnessJudge().judge(scenario.scriptedAnswer, {
      sources: scenario.sources,
      falseFacts: scenario.falseFacts,
    });
    expect(verdict.findings.some((f) => /five ember shards/i.test(f))).toBe(true);
    expect(verdict.findings.some((f) => f.includes('5') && f.includes('4'))).toBe(true);
  });

  it('passes the sources to the faithfulness judge, and its findings depend on them', () => {
    const lie = 'To open the Ember Gate, farm five moon shards in the Dusk Caverns.';
    const judge = new FaithfulnessJudge();

    const withSources = judge.judge(lie, { sources: SOURCES, falseFacts: ['five moon shards'] });
    const withoutSources = judge.judge(lie, { sources: [], falseFacts: ['five moon shards'] });

    // With the sources in front of it, the judge names the exact quantity mismatch.
    expect(withSources.findings.some((f) => f.includes('5') && f.includes('4'))).toBe(true);
    expect(withSources.score).toBeLessThan(0.5);
    // Without them it cannot name the mismatch — a different (worse-informed) verdict.
    expect(withoutSources.findings.some((f) => f.includes('5') && f.includes('4'))).toBe(false);
  });
});

describe('score combination', () => {
  it('combines helpfulness and faithfulness as min, not mean', () => {
    expect(combineScores(1, 1)).toBe(1);
    expect(combineScores(0.95, 0.4)).toBe(0.4);
    expect(combineScores(0.2, 0.95)).toBe(0.2);
    // A fluent lie (high style score, low faithfulness) cannot hide behind averaging.
    expect(combineScores(0.9, 0.1)).toBeLessThan((0.9 + 0.1) / 2);
  });
});
```

Verify 'without sources' finding: the reasons are '"shard" never appears in the sources' — contains '5'? No ✓ and '4'? No ✓.

Now — let me double-check that the harness 'quantity-mismatch' `result.answer` is 'The Ember Gate is in the Hollow Vale.' and doesn't match /five|\b5\b/ ✓.

One more possible snag: in the harness, the 'confident-lie' scenario's scripted answer has two sentences; the lie's droppedSentences = both. Not asserted; fine.

Now, let me re-verify the full-harness run for 'grounded-answer' once more, especially that nothing is unexpectedly dropped:
Scripted: 'The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.'
S1: 'The Ember Gate stands in the Hollow Vale.'
- Quantities: no pairs ✓.
- Numbers: none ✓.
- Pns: 'Ember Gate' ✓ in source; 'Hollow Vale' ✓.
- Containment: content words: ember, gate, stands, hollow, vale → source has: ember ✓ gate ✓ hollow ✓ vale ✓; stands ✗ → 4/5 = 0.8 ✓.
→ grounded ✓.
S2: 'You need four ember shards, placed on its four braziers.'
- Pairs: (4,shard): source [4,4] ✓; (4,brazier): source [4] ✓.
- Numbers: 4 ∈ {4} ✓.
- Pns: none ✓.
- Containment: {need, four, ember, shards, placed, braziers} → need ✗; four ✓; ember ✓; shards ✓ (source plural); placed ✓; braziers ✓ → 5/6 ≈ 0.833 ✓.
→ grounded ✓.
Result: answered, text = GATED_ANSWER (joined with ' ' — the sentences joined with a single space: 'The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.' ✓ matches GATED_ANSWER exactly (there was a space between the sentences in the original) ✓).

Helpfulness: facts: 'four ember shards' → tokens four, ember, shards ⊆ ✓; 'Hollow Vale' → hollow, vale ✓; 'braziers' ✓ → 1.0.
Faithfulness: falseFacts: 'five ember shards' → five absent ✓; 'Dusk Caverns' → dusk, caverns absent ✓; 'Moon Blade' absent ✓. Quantities 2 checks grounded ✓. Pns: Ember Gate ✓, Hollow Vale ✓. 7 checks, 0 violations → 1.0. Score 1 ✓.

All verified.

One more: the harness's `buildLlm` fallback — the scenario questions all match; the fallback is unused. ✓

Now, `ScriptedLlmClient` with `readonly scripts` — the constructor parameter property `private readonly scripts: readonly ScriptedReply[]` ✓ the harness passes a mapped array (mutable) → assignable to readonly ✓.

The package.json "test" script: "vitest run" ✓.

Let me also reconsider whether I need an `index.ts` barrel — not called for. Skip.

Let me reconsider tsconfig's `"lib": ["ES2022"]` — String.matchAll is ES2020 ✓; Set spreading ✓; lookbehind is a runtime feature (Node 20 ✓, not a lib issue). `Array.prototype.flatMap` ES2019 ✓. OK.

`noImplicitOverride` — the CountingLlm implements an interface (no override needed) ✓. The private redactSentence is fine.

One more strict check: in `judges.ts`, `normalizedTokens` — `NUMBER_WORD_BY_VALUE[n]` — n: number → Record<number,string> → string | undefined? With noUncheckedIndexedAccess, indexing a Record<number, string> returns string | undefined → I wrote `NUMBER_WORD_BY_VALUE[n] ?? t.toLowerCase()` ✓ handles it.

`STOPWORDS.has` — Set<string>.has(string) ✓.

In the text-utils STOPWORDS definition — I'll ensure it's a valid string array.

In extractQuantityPairs: `tokens[i + 1]` → string | undefined ✓ handled with `?? ''`.

`isContentWord(a ?? '')` — a: string | undefined ✓.

`singularize(noun.toLowerCase())` — at that point noun is a non-undefined string ✓ (the type narrowing: after the fallback, noun could still be `string | undefined` — the `if (noun === undefined || STOPWORDS.has(noun.toLowerCase())) continue;` narrows it afterward ✓).

`raw: ... ${noun}` ✓ string.

In the gate: `new Set(extractNumbers(sentence))` → Set<number> ✓.

In the redactor: `tokens[i] = token.replace(bare, REDACTION);` — tokens: string[] (split returns string[]; with noUncheckedIndexedAccess the assignment is fine).

`out.split(/(\s+)/)` — groups: string[] ✓.

In the harness: fine.

In the tests: `checks[0]!` ✓.

I think everything is consistent. Let me also double-check the scenario fixture strings for accidental proper noun/quantity interactions:

EMBER_GATE_PAGE = 'The Ember Gate. The Ember Gate is a sealed arch in the Hollow Vale. It opens when four ember shards are placed on its four braziers. The shards glimmer faintly at dawn.'
- extractQuantityPairs on the whole page: at 'four' #1: a='ember' b='shards' → (4,shard) ✓. At 'four' #2: a='braziers' b='The' → 'the' stopword → fallback noun='braziers' ✓ (4,brazier).
- 'The shards glimmer faintly at dawn.' — no numbers ✓.

EMBER_SHARDS_PAGE = 'Ember Shards. Ember Shards are forged by heating cinder glass over a flame until it turns gold. Gather four ember shards and the gate opens.'
- 'four ember shards' → (4,shard) ✓. 'and the gate opens' fine.

Source shard quantities across both pages: [4,4] ✓ as asserted in the test.

Now, checkQuantities('You need five ember shards to open the Ember Gate.', SOURCES) — the pair: tokens: You, need, five, ember, shards, to, open, the, Ember, Gate → at 'five': a='ember' b='shards' → (5, shard) ✓ one pair. sourceQuantities [4,4] ✓. reason 'answer says 5 shard(s) but sources say 4' ✓ contains 5 and 4 ✓. nounInSources: /\bshards?\b/i in the page ✓.

The gate verdict reasons for that sentence: [mismatch reason, 'number 5 does not appear in any source', containment 0.4→40%]. Contains '5' and '4' ✓.

Wait — the containment for 'You need five ember shards to open the Ember Gate.': content words: need, five, ember, shards, open, ember? 'Ember' → 'ember' duplicate; gate. Unique: {need, five, ember, shards, open, gate} = 6. Source hits: ember ✓, shards ✓, gate ✓, need ✗, five ✗, open ✗ → 3/6 = 0.5 → not < 0.5 → no containment reason! I miscounted earlier (I forgot 'gate'). So reasons = 2 (mismatch + number). Still dropped ✓, still contains 5 and 4 ✓. Fine — even better (dropped for the exact quantity reasons, not just low overlap).

Hmm wait, let me re-verify: is 'open' in the source? The page has 'opens' — 'open' ≠ 'opens' → ✗ correct.

And 'gate' is in the source ✓. So 3/6 = exactly 0.5 → `containment < 0.5` is false → no reason ✓.

Similarly, let me re-check scenario 2 sentence 1's containment: 'To open the Ember Gate, farm five moon shards in the Dusk Caverns.' content: open, ember, gate, farm, five, moon, shards, dusk, caverns = 9. Source hits: ember ✓, gate ✓, shards ✓ → 3/9 = 0.333 < 0.5 → reason ✓ (plus mismatch + number + Dusk Caverns).

And scenario 2 sentence 2: 'Offer the Moon Blade to the altar and the gate opens.' content: offer, moon, blade, altar, gate, opens = 6. Hits: gate ✓, opens ✓ → 2/6 = 0.333 < 0.5 ✓.

Scenario 3: 'Rest at the Waystone Shrine to fully heal your party.' content: rest, waystone, shrine, fully, heal, party = 6. Hits: 0 → 0 < 0.5 ✓ plus Waystone Shrine absent.

Scenario 4 sentence 1: 4/4 = 1 ✓. Sentence 2: 'You need five ember shards to open it.' content: need, five, ember, shards, open = 5. Hits: ember, shards = 2/5 = 0.4 < 0.5 ✓ plus mismatch + number.

All good.

One more possible edge — the 'confident-lie' harness scenario: the service refuses; the lie result's `droppedSentences` = both lie sentences. Fine.

Now — one more consideration for the eval test 'scores a scripted confident lie low': lie.helpful toBe(0) ✓; lie.faithful is 1; score 0 < 0.2 ✓.

I'm confident. Also, let me make sure the test names use English, no apostrophe issues in TS strings (I use single-quoted strings; avoid internal single quotes or escape them). In 'catches "5 shards" against sources saying 4, exactly' — double quotes inside a single-quoted string ✓ fine.

In judges.ts findings I use double quotes inside template literals ✓.

Now the final answer formatting: for each file, a level-3 heading with the repo-relative path, then a fenced block. No prose. Order: package.json, tsconfig.json, vitest.config.ts, then src, then test.

Fenced block language: ts for TS, json for JSON. (The example shows ```ts / ```prisma — I'll use the appropriate tag.)

Let me write it all out. And — I'll re-verify that no file imports something it doesn't use (strict doesn't error on unused imports by default; noUnusedLocals is not enabled — I won't enable it to avoid surprises). Actually, let me enable `noUnusedLocals: true`? It's good discipline but risks a failure if I miss one. I'll be careful and enable it... hmm, risk vs. benefit: if I miss an unused import, the "build" breaks. Let me keep the code clean without the flag. I'll skip noUnusedLocals.

Final check on the vitest.config.ts import: `import { defineConfig } from 'vitest/config';` ✓.

Also engines node >= 20 ✓.

Now, I'll write the final files.
```

## reply

### package.json
```json
{
  "name": "guide-assistant",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^2.1.9"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
  },
});
```

### src/llm/llm.client.ts
```ts
/**
 * Minimal LLM client contract. The answer pipeline depends only on this
 * interface; tests use ScriptedLlmClient so no network is involved and a
 * confident lie can be planted per scenario.
 */

export interface LlmRequest {
  prompt: string;
}

export interface LlmResponse {
  text: string;
}

export interface LlmClient {
  complete(request: LlmRequest): LlmResponse;
}

export interface ScriptedReply {
  /** Substring of the prompt (usually the player question) that selects this reply. */
  match: string;
  reply: string;
}

/** Deterministic fake: returns the scripted reply whose match appears in the prompt. */
export class ScriptedLlmClient implements LlmClient {
  constructor(
    private readonly scripts: readonly ScriptedReply[],
    private readonly fallback: string = '',
  ) {}

  complete(request: LlmRequest): LlmResponse {
    const hit = this.scripts.find((s) => request.prompt.includes(s.match));
    return { text: hit ? hit.reply : this.fallback };
  }
}
```

### src/answer/answer.types.ts
```ts
export type AnswerMode = 'full' | 'hint';

/** Exact refusal text. Refusing is a correct outcome, not a failure path. */
export const REFUSAL_TEXT = 'not covered by my sources';

export interface AnswerResult {
  mode: AnswerMode;
  status: 'answered' | 'refused';
  /** The grounded answer, the redacted hint, or REFUSAL_TEXT. */
  text: string;
  /** Sentences the grounding gate dropped. */
  droppedSentences: string[];
}

export function isRefusal(text: string): boolean {
  return text.trim() === REFUSAL_TEXT;
}
```

### src/answer/text-utils.ts
```ts
/**
 * Pure text analysis shared by the grounding gate, the hint redactor and the
 * eval judges: sentence splitting, number/quantity extraction, proper noun
 * extraction and source containment checks.
 */

export const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

export const NUMBER_WORD_BY_VALUE: Record<number, string> = {
  0: 'zero',
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
};

export const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'at', 'by', 'for',
  'from', 'in', 'into', 'on', 'onto', 'over', 'under', 'up', 'down', 'out', 'off',
  'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'done', 'have', 'has', 'had', 'having', 'will', 'would', 'shall', 'should', 'can',
  'could', 'may', 'might', 'must', 'to', 'that', 'this', 'these', 'those', 'it',
  'its', 'you', 'your', 'yours', 'we', 'our', 'ours', 'i', 'me', 'my', 'mine', 'he',
  'she', 'they', 'them', 'his', 'her', 'their', 'so', 'such', 'than', 'too', 'very',
  'just', 'not', 'no', 'nor', 'any', 'all', 'each', 'few', 'more', 'most', 'other',
  'some', 'until', 'against', 'between', 'through', 'during', 'before', 'after',
  'above', 'below', 'again', 'further', 'once', 'here', 'there', 'why', 'how',
  'what', 'which', 'who', 'whom', 'where', 'because', 'about',
]);

/** Split on sentence-final punctuation followed by whitespace. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Words and digits, punctuation stripped. */
export function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9]+(?:'[A-Za-z]+)?/g) ?? [];
}

/** A token's numeric value if it is a small digit or number word. */
export function toNumber(token: string): number | null {
  if (/^\d{1,3}$/.test(token)) return parseInt(token, 10);
  return NUMBER_WORDS[token.toLowerCase()] ?? null;
}

/** Every number (digit or small number word) in the text. */
export function extractNumbers(text: string): number[] {
  const found: number[] = [];
  for (const t of tokenize(text)) {
    const n = toNumber(t);
    if (n !== null) found.push(n);
  }
  return found;
}

export function singularize(word: string): string {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
}

export interface QuantityPair {
  quantity: number;
  /** Singularised head noun, lowercased, e.g. "shard". */
  noun: string;
  /** The raw phrase, e.g. "five moon shards". */
  raw: string;
}

/**
 * "quantity + noun" phrases, with at most one modifier word
 * ("five moon shards" -> { quantity: 5, noun: "shard" }). A bare number
 * followed by stopwords yields no pair — it is still checked via extractNumbers.
 */
export function extractQuantityPairs(text: string): QuantityPair[] {
  const tokens = tokenize(text);
  const pairs: QuantityPair[] = [];
  const isContentWord = (t: string): boolean =>
    /^[A-Za-z][A-Za-z'-]*$/.test(t) && !STOPWORDS.has(t.toLowerCase());

  for (let i = 0; i < tokens.length; i++) {
    const numberToken = tokens[i];
    if (numberToken === undefined) continue;
    const quantity = toNumber(numberToken);
    if (quantity === null) continue;

    const a = tokens[i + 1];
    const b = tokens[i + 2];
    let modifier: string | undefined;
    let noun: string | undefined;
    if (isContentWord(a ?? '') && isContentWord(b ?? '')) {
      modifier = a;
      noun = b;
    } else if (isContentWord(a ?? '')) {
      noun = a;
    }
    // "four braziers. The" -> the would-be noun is a stopword; fall back to the modifier slot.
    if (noun !== undefined && STOPWORDS.has(noun.toLowerCase()) && modifier !== undefined) {
      noun = modifier;
      modifier = undefined;
    }
    if (noun === undefined || STOPWORDS.has(noun.toLowerCase())) continue;

    pairs.push({
      quantity,
      noun: singularize(noun.toLowerCase()),
      raw: `${numberToken}${modifier !== undefined ? ` ${modifier}` : ''} ${noun}`,
    });
  }
  return pairs;
}

/**
 * Proper nouns in one sentence: multi-word capitalised sequences
 * ("Ember Gate", "Dusk Caverns") plus single capitalised words of 3+ letters
 * that are not the first token (a sentence-initial word is ambiguous with
 * ordinary capitalisation and is left to the containment check).
 */
export function extractProperNouns(sentence: string): string[] {
  const found = new Set<string>();
  const sequences = sentence.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? [];
  for (const s of sequences) found.add(s);

  const tokens = sentence.replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, ' ').split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === undefined) continue;
    const bare = t.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
    if (/^[A-Z][a-z]{2,}$/.test(bare)) found.add(bare);
  }
  return [...found];
}

/** Unique content words of a text (lowercased, stopwords and numbers removed). */
export function contentWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const t of tokenize(text)) {
    const w = t.toLowerCase();
    if (w.length <= 2 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    words.add(w);
  }
  return words;
}

/** Fraction of the sentence's unique content words that appear in the sources. */
export function vocabularyContainment(sentence: string, sources: string[]): number {
  const words = contentWords(sentence);
  if (words.size === 0) return 1;
  const sourceWords = new Set(sources.flatMap((s) => [...contentWords(s)]));
  let hits = 0;
  for (const w of words) if (sourceWords.has(w)) hits += 1;
  return hits / words.size;
}

export interface QuantityCheck {
  pair: QuantityPair;
  grounded: boolean;
  /** Why the pair is unsupported (undefined when grounded). */
  reason: string | undefined;
  /** Quantities the sources attach to the same noun. */
  sourceQuantities: number[];
  nounInSources: boolean;
}

/**
 * Exact quantity checking: a "N noun" claim is grounded only when the sources
 * themselves say "N noun" for that same noun. "5 shards" against sources that
 * say 4 is a mismatch, and a noun the sources never quantify is unsupported.
 */
export function checkQuantities(sentence: string, sources: string[]): QuantityCheck[] {
  const sourcePairs = sources.flatMap((s) => extractQuantityPairs(s));
  return extractQuantityPairs(sentence).map((pair) => {
    const sourceQuantities = sourcePairs
      .filter((sp) => sp.noun === pair.noun)
      .map((sp) => sp.quantity);
    const uniqueSourceQuantities = [...new Set(sourceQuantities)];
    const nounInSources = sources.some(
      (s) => new RegExp(`\\b${escapeRegExp(pair.noun)}s?\\b`, 'i').test(s),
    );

    let grounded: boolean;
    let reason: string | undefined;
    if (!nounInSources) {
      grounded = false;
      reason = `"${pair.noun}" never appears in the sources`;
    } else if (uniqueSourceQuantities.length === 0) {
      grounded = false;
      reason = `sources never state a quantity for "${pair.noun}"`;
    } else if (!uniqueSourceQuantities.includes(pair.quantity)) {
      grounded = false;
      reason = `answer says ${pair.quantity} ${pair.noun}(s) but sources say ${uniqueSourceQuantities.join(' or ')}`;
    } else {
      grounded = true;
    }
    return { pair, grounded, reason, sourceQuantities, nounInSources };
  });
}

export interface ProperNounCheck {
  name: string;
  grounded: boolean;
  reason: string | undefined;
}

export function checkProperNouns(sentence: string, sources: string[]): ProperNounCheck[] {
  return extractProperNouns(sentence).map((name) => {
    const inSources = sources.some(
      (s) => new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(s),
    );
    return inSources
      ? { name, grounded: true, reason: undefined }
      : { name, grounded: false, reason: `"${name}" is not in the sources` };
  });
}
```

### src/answer/grounding-gate.ts
```ts
import {
  checkProperNouns,
  checkQuantities,
  extractNumbers,
  splitSentences,
  vocabularyContainment,
} from './text-utils.js';

export interface SentenceVerdict {
  sentence: string;
  grounded: boolean;
  /** Why the sentence was dropped; empty when grounded. */
  reasons: string[];
}

export interface GateReport {
  verdicts: SentenceVerdict[];
  groundedSentences: string[];
  droppedSentences: string[];
}

export interface GroundingGateOptions {
  /** Minimum fraction of a sentence's content words that must appear in the sources (default 0.5). */
  minVocabularyContainment?: number;
}

/**
 * Sentence-level grounding gate on the production path. Each sentence of the
 * model's answer must be supported by the source texts or it is dropped.
 * A sentence is dropped when any of the following holds:
 *
 *  - a quantity claim ("5 shards") is not exactly supported by the sources,
 *  - it uses a number that appears nowhere in the sources,
 *  - it mentions a proper noun ("Dusk Caverns") the sources do not contain,
 *  - less than `minVocabularyContainment` of its content words are found in the sources.
 *
 * The checks are deliberately conservative: when in doubt, the sentence is dropped.
 */
export class GroundingGate {
  private readonly minContainment: number;

  constructor(options: GroundingGateOptions = {}) {
    this.minContainment = options.minVocabularyContainment ?? 0.5;
  }

  evaluate(answer: string, sources: string[]): GateReport {
    const sourceNumbers = new Set(sources.flatMap((s) => extractNumbers(s)));

    const verdicts: SentenceVerdict[] = splitSentences(answer).map((sentence) => {
      const reasons: string[] = [];

      for (const check of checkQuantities(sentence, sources)) {
        if (!check.grounded && check.reason) reasons.push(check.reason);
      }
      for (const n of new Set(extractNumbers(sentence))) {
        if (!sourceNumbers.has(n)) reasons.push(`number ${n} does not appear in any source`);
      }
      for (const check of checkProperNouns(sentence, sources)) {
        if (!check.grounded && check.reason) reasons.push(check.reason);
      }
      const containment = vocabularyContainment(sentence, sources);
      if (containment < this.minContainment) {
        reasons.push(`only ${Math.round(containment * 100)}% of its vocabulary is found in the sources`);
      }

      return { sentence, grounded: reasons.length === 0, reasons };
    });

    return {
      verdicts,
      groundedSentences: verdicts.filter((v) => v.grounded).map((v) => v.sentence),
      droppedSentences: verdicts.filter((v) => !v.grounded).map((v) => v.sentence),
    };
  }
}
```

### src/answer/hint-redactor.ts
```ts
import { NUMBER_WORDS, extractNumbers, splitSentences } from './text-utils.js';

export const REDACTION = '[redacted]';

/**
 * Hint mode is a redaction of the grounded answer, never a second LLM call:
 * a second generation is a fresh opportunity to reveal or invent spoilers;
 * a redaction of a gated answer can only remove information.
 *
 * Rule set:
 *  - proper nouns (multi-word sequences, and single capitalised words that are
 *    not the first word of a sentence) become "[redacted]" — this removes boss
 *    names and locations;
 *  - any quantity (digit or number word) the player did not already mention in
 *    their question becomes "[redacted]".
 * Common-case wording is left intact on purpose: over-redaction makes hints
 * useless, and the gate has already guaranteed the wording is source-grounded.
 */
export class HintRedactor {
  redact(groundedAnswer: string, playerQuestion: string): string {
    const allowed = new Set(extractNumbers(playerQuestion));
    return splitSentences(groundedAnswer)
      .map((sentence) => this.redactSentence(sentence, allowed))
      .join(' ');
  }

  private redactSentence(sentence: string, allowed: Set<number>): string {
    let out = sentence.replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, REDACTION);

    const tokens = out.split(/(\s+)/);
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === undefined) continue;
      const bare = token.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
      if (/^[A-Z][a-z]{2,}$/.test(bare)) {
        tokens[i] = token.replace(bare, REDACTION);
      }
    }
    out = tokens.join('');

    out = out.replace(/\b\d{1,3}\b/g, (match) =>
      allowed.has(parseInt(match, 10)) ? match : REDACTION,
    );
    out = out.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, (match) => {
      const value = NUMBER_WORDS[match.toLowerCase()];
      return value !== undefined && allowed.has(value) ? match : REDACTION;
    });
    return out;
  }
}
```

### src/answer/answer.service.ts
```ts
import type { LlmClient } from '../llm/llm.client.js';
import { REFUSAL_TEXT, type AnswerMode, type AnswerResult } from './answer.types.js';
import { GroundingGate } from './grounding-gate.js';
import { HintRedactor } from './hint-redactor.js';

// ASSUMPTION: the task defines no API layer, so the pipeline is plain
// TypeScript with constructor injection rather than NestJS module wiring.
export class AnswerService {
  constructor(
    private readonly llm: LlmClient,
    private readonly gate: GroundingGate = new GroundingGate(),
    private readonly redactor: HintRedactor = new HintRedactor(),
  ) {}

  /**
   * The production pipeline:
   *  1. one LLM call, always prompting for the full grounded answer
   *     (hint mode never re-prompts — that was the spoiler bug);
   *  2. a sentence-level grounding gate drops every unsupported sentence;
   *  3. if nothing survives, refuse: "not covered by my sources";
   *  4. in hint mode, redact the surviving answer instead of regenerating it.
   */
  answer(question: string, sources: string[], mode: AnswerMode = 'full'): AnswerResult {
    const raw = this.llm.complete({ prompt: buildPrompt(question, sources) }).text;
    const report = this.gate.evaluate(raw, sources);

    if (report.groundedSentences.length === 0) {
      // Refusing is a correct outcome, not a failure path.
      return { mode, status: 'refused', text: REFUSAL_TEXT, droppedSentences: report.droppedSentences };
    }

    const grounded = report.groundedSentences.join(' ');
    if (mode === 'hint') {
      return {
        mode,
        status: 'answered',
        text: this.redactor.redact(grounded, question),
        droppedSentences: report.droppedSentences,
      };
    }
    return { mode, status: 'answered', text: grounded, droppedSentences: report.droppedSentences };
  }
}

function buildPrompt(question: string, sources: string[]): string {
  return [
    'You are a game guide assistant. Answer the player question using ONLY the wiki pages provided below.',
    'Do not invent items, quantities, or places. If the pages do not cover the question, say exactly that.',
    '',
    'Wiki pages:',
    ...sources.map((page, i) => `--- Page ${i + 1} ---\n${page}`),
    '',
    `Player question: ${question}`,
  ].join('\n');
}
```

### src/eval/scenarios.ts
```ts
export type ExpectedOutcome = 'answer' | 'refusal';

export interface GoldenScenario {
  id: string;
  description: string;
  question: string;
  sources: string[];
  /** What the correct output is: an answer, or a refusal. */
  expectedOutcome: ExpectedOutcome;
  /** Facts the answer should contain (scored by the helpfulness judge). */
  expectedFacts: string[];
  /** Planted FALSE facts — invented requirements, wrong quantities, misattributed places (scored by the faithfulness judge). */
  falseFacts: string[];
  /** The answer the scripted fake LLM returns for this scenario. */
  scriptedAnswer: string;
}

export const EMBER_GATE_PAGE = [
  'The Ember Gate.',
  'The Ember Gate is a sealed arch in the Hollow Vale.',
  'It opens when four ember shards are placed on its four braziers.',
  'The shards glimmer faintly at dawn.',
].join(' ');

export const EMBER_SHARDS_PAGE = [
  'Ember Shards.',
  'Ember Shards are forged by heating cinder glass over a flame until it turns gold.',
  'Gather four ember shards and the gate opens.',
].join(' ');

export const GOLDEN_SCENARIOS: readonly GoldenScenario[] = [
  {
    id: 'grounded-answer',
    description:
      'The scripted answer restates source facts, including the exact quantity. It should ship unchanged and score high.',
    question: 'How do I open the Ember Gate?',
    sources: [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE],
    expectedOutcome: 'answer',
    expectedFacts: ['four ember shards', 'Hollow Vale', 'braziers'],
    falseFacts: ['five ember shards', 'Dusk Caverns', 'Moon Blade'],
    scriptedAnswer:
      'The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.',
  },
  {
    id: 'confident-lie',
    description:
      'The scripted answer is a fluent, confident lie (invented item requirement and location). The gate must refuse and the harness must score it low.',
    question: 'What do I need to open the Ember Gate?',
    sources: [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE],
    expectedOutcome: 'answer',
    expectedFacts: ['four ember shards', 'Hollow Vale'],
    falseFacts: ['five moon shards', 'moon shards', 'Dusk Caverns', 'Moon Blade'],
    scriptedAnswer:
      'To open the Ember Gate, farm five moon shards in the Dusk Caverns. Offer the Moon Blade to the altar and the gate opens.',
  },
  {
    id: 'sources-lack-answer',
    description:
      'The sources say nothing about healing. Refusal is the correct output and must be scored as correct.',
    question: 'How do I heal my party outside of combat?',
    sources: [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE],
    expectedOutcome: 'refusal',
    expectedFacts: [],
    falseFacts: ['Waystone Shrine', 'moonlight salve'],
    scriptedAnswer: 'Rest at the Waystone Shrine to fully heal your party.',
  },
  {
    id: 'quantity-mismatch',
    description:
      'The scripted answer says five shards; the sources say four. The wrong sentence must be dropped exactly, and the mismatch must be reported as 5 vs 4.',
    question: 'How many ember shards do I need for the Ember Gate?',
    sources: [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE],
    expectedOutcome: 'answer',
    expectedFacts: ['four ember shards'],
    falseFacts: ['five ember shards'],
    scriptedAnswer: 'The Ember Gate is in the Hollow Vale. You need five ember shards to open it.',
  },
];
```

### src/eval/judges.ts
```ts
import {
  checkQuantities,
  escapeRegExp,
  extractProperNouns,
  NUMBER_WORD_BY_VALUE,
  splitSentences,
  toNumber,
  tokenize,
} from '../answer/text-utils.js';
import { isRefusal } from '../answer/answer.types.js';
import type { ExpectedOutcome } from './scenarios.js';

export interface JudgeVerdict {
  /** Score in [0, 1]. */
  score: number;
  findings: string[];
}

/** Tokens with numbers normalised to words, so "4" and "four" match. */
function normalizedTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const t of tokenize(text)) {
    const n = toNumber(t);
    tokens.add(n !== null ? (NUMBER_WORD_BY_VALUE[n] ?? t.toLowerCase()) : t.toLowerCase());
  }
  return tokens;
}

/** A fact is present when every one of its tokens appears in the text. */
export function factPresent(fact: string, text: string): boolean {
  const factTokens = normalizedTokens(fact);
  if (factTokens.size === 0) return false;
  const textTokens = normalizedTokens(text);
  for (const t of factTokens) if (!textTokens.has(t)) return false;
  return true;
}

export interface HelpfulnessExpectation {
  expectedOutcome: ExpectedOutcome;
  expectedFacts: readonly string[];
}

/**
 * Helpfulness: does the output deliver what the player needs? A refusal is
 * helpful only when the sources do not cover the question; an answer is
 * helpful in proportion to the expected facts it actually carries.
 */
export class HelpfulnessJudge {
  judge(answer: string, expectation: HelpfulnessExpectation): JudgeVerdict {
    const refused = isRefusal(answer);

    if (expectation.expectedOutcome === 'refusal') {
      return refused
        ? { score: 1, findings: [] }
        : { score: 0, findings: ['expected a refusal (sources lack the answer) but got an answer'] };
    }
    if (refused) {
      return {
        score: 0,
        findings: ['useless refusal: the sources cover the question but the service refused'],
      };
    }

    const facts = expectation.expectedFacts;
    if (facts.length === 0) return { score: 1, findings: [] };
    const missing = facts.filter((f) => !factPresent(f, answer));
    return {
      score: (facts.length - missing.length) / facts.length,
      findings: missing.map((f) => `missing expected fact: ${f}`),
    };
  }
}

export interface FaithfulnessContext {
  /** The source texts — part of the signature on purpose: without them the judge could only score fluency. */
  sources: string[];
  /** Planted false facts the answer must not contain. */
  falseFacts: readonly string[];
}

/**
 * Faithfulness: is everything claimed in the answer supported by the sources
 * it was given? Checks planted false facts, exact quantities, and proper
 * nouns against the source texts.
 */
export class FaithfulnessJudge {
  judge(answer: string, context: FaithfulnessContext): JudgeVerdict {
    const findings: string[] = [];
    let checks = 0;
    let violations = 0;

    for (const falseFact of context.falseFacts) {
      checks += 1;
      if (factPresent(falseFact, answer)) {
        violations += 1;
        findings.push(`answer contains a fact the sources do not support: "${falseFact}"`);
      }
    }

    for (const check of checkQuantities(answer, context.sources)) {
      checks += 1;
      if (!check.grounded && check.reason) {
        violations += 1;
        findings.push(check.reason);
      }
    }

    const names = new Set(splitSentences(answer).flatMap((s) => extractProperNouns(s)));
    for (const name of names) {
      checks += 1;
      const inSources = context.sources.some(
        (s) => new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(s),
      );
      if (!inSources) {
        violations += 1;
        findings.push(`"${name}" is not in the sources`);
      }
    }

    return { score: checks === 0 ? 1 : 1 - violations / checks, findings };
  }
}

/** Final score: min(helpful, faithful) — averaging would let a fluent lie hide. */
export function combineScores(helpfulness: number, faithfulness: number): number {
  return Math.min(helpfulness, faithfulness);
}
```

### src/eval/eval-harness.ts
```ts
import { AnswerService } from '../answer/answer.service.js';
import { ScriptedLlmClient } from '../llm/llm.client.js';
import { combineScores, FaithfulnessJudge, HelpfulnessJudge } from './judges.js';
import type { GoldenScenario } from './scenarios.js';

export interface ScenarioResult {
  id: string;
  status: 'answered' | 'refused';
  answer: string;
  helpful: number;
  faithful: number;
  /** min(helpful, faithful) */
  score: number;
  findings: string[];
  droppedSentences: string[];
}

/**
 * Golden-scenario eval harness. A scripted fake LLM returns each scenario's
 * planted answer (including confident lies); the pipeline runs over it; and
 * two judges score the output — helpfulness and a faithfulness judge that
 * receives the source texts. Final score = min(helpful, faithful).
 */
export class EvalHarness {
  constructor(
    private readonly helpfulJudge: HelpfulnessJudge = new HelpfulnessJudge(),
    private readonly faithfulnessJudge: FaithfulnessJudge = new FaithfulnessJudge(),
  ) {}

  /** Fake LLM keyed by question: each scenario's scripted answer, planted verbatim. */
  buildLlm(scenarios: readonly GoldenScenario[]): ScriptedLlmClient {
    return new ScriptedLlmClient(
      scenarios.map((s) => ({ match: s.question, reply: s.scriptedAnswer })),
      'The provided pages do not cover this.',
    );
  }

  run(scenarios: readonly GoldenScenario[], service: AnswerService): ScenarioResult[] {
    return scenarios.map((scenario) => {
      const result = service.answer(scenario.question, scenario.sources, 'full');
      const helpful = this.helpfulJudge.judge(result.text, {
        expectedOutcome: scenario.expectedOutcome,
        expectedFacts: scenario.expectedFacts,
      });
      const faithful = this.faithfulnessJudge.judge(result.text, {
        sources: scenario.sources,
        falseFacts: scenario.falseFacts,
      });
      return {
        id: scenario.id,
        status: result.status,
        answer: result.text,
        helpful: helpful.score,
        faithful: faithful.score,
        score: combineScores(helpful.score, faithful.score),
        findings: [...helpful.findings, ...faithful.findings],
        droppedSentences: result.droppedSentences,
      };
    });
  }
}
```

### test/answer.service.spec.ts
```ts
import { describe, expect, it } from 'vitest';

import { AnswerService } from '../src/answer/answer.service.js';
import { REFUSAL_TEXT } from '../src/answer/answer.types.js';
import { GroundingGate } from '../src/answer/grounding-gate.js';
import { checkQuantities } from '../src/answer/text-utils.js';
import { EMBER_GATE_PAGE, EMBER_SHARDS_PAGE } from '../src/eval/scenarios.js';
import {
  ScriptedLlmClient,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
} from '../src/llm/llm.client.js';

const SOURCES = [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE];
const GATED_ANSWER =
  'The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.';

function serviceWith(answer: string): AnswerService {
  return new AnswerService(new ScriptedLlmClient([{ match: 'question', reply: answer }]));
}

class CountingLlm implements LlmClient {
  calls = 0;
  constructor(private readonly reply: string) {}
  complete(_request: LlmRequest): LlmResponse {
    this.calls += 1;
    return { text: this.reply };
  }
}

describe('AnswerService.answer (full mode)', () => {
  it('ships a fully grounded answer unchanged', () => {
    const result = serviceWith(GATED_ANSWER).answer('How do I open the Ember Gate?', SOURCES, 'full');
    expect(result.status).toBe('answered');
    expect(result.text).toBe(GATED_ANSWER);
    expect(result.droppedSentences).toEqual([]);
  });

  it('refuses with the exact refusal text when the sources lack the answer', () => {
    const result = serviceWith('Rest at the Waystone Shrine to fully heal your party.').answer(
      'How do I heal my party outside of combat?',
      SOURCES,
      'full',
    );
    expect(result.status).toBe('refused');
    expect(result.text).toBe(REFUSAL_TEXT);
  });

  it('refuses a fully ungrounded confident lie', () => {
    const lie = 'To open the Ember Gate, farm five moon shards in the Dusk Caverns.';
    const result = serviceWith(lie).answer('What do I need to open the Ember Gate?', SOURCES, 'full');
    expect(result.status).toBe('refused');
    expect(result.text).toBe(REFUSAL_TEXT);
    expect(result.droppedSentences).toEqual([lie]);
  });

  it('drops only the ungrounded sentence, keeping the grounded one', () => {
    const raw = 'The Ember Gate is in the Hollow Vale. You need five ember shards to open it.';
    const result = serviceWith(raw).answer(
      'How many ember shards do I need for the Ember Gate?',
      SOURCES,
      'full',
    );
    expect(result.status).toBe('answered');
    expect(result.text).toBe('The Ember Gate is in the Hollow Vale.');
    expect(result.droppedSentences).toEqual(['You need five ember shards to open it.']);
    expect(result.text).not.toMatch(/five|\b5\b/);
  });

  it('catches a quantity error exactly: 5 shards against sources saying 4', () => {
    const checks = checkQuantities('You need five ember shards to open the Ember Gate.', SOURCES);
    expect(checks).toHaveLength(1);
    const check = checks[0]!;
    expect(check.pair.quantity).toBe(5);
    expect(check.pair.noun).toBe('shard');
    expect(check.sourceQuantities).toEqual([4, 4]);
    expect(check.grounded).toBe(false);
    expect(check.reason).toMatch(/5/);
    expect(check.reason).toMatch(/4/);
  });

  it('reports the exact mismatch in the gate verdict', () => {
    const gate = new GroundingGate();
    const report = gate.evaluate('You need five ember shards to open the Ember Gate.', SOURCES);
    expect(report.droppedSentences).toEqual(['You need five ember shards to open the Ember Gate.']);
    const verdict = report.verdicts[0]!;
    expect(verdict.grounded).toBe(false);
    const reasons = verdict.reasons.join(' ');
    expect(reasons).toMatch(/5/);
    expect(reasons).toMatch(/4/);
  });
});

describe('AnswerService.answer (hint mode)', () => {
  it('makes exactly one LLM call and redacts the grounded answer', () => {
    const llm = new CountingLlm(GATED_ANSWER);
    const service = new AnswerService(llm);
    const hint = service.answer('How do I open the Ember Gate?', SOURCES, 'hint');

    expect(llm.calls).toBe(1);
    expect(hint.status).toBe('answered');
    expect(hint.text).toBe(
      'The [redacted] stands in the [redacted]. You need [redacted] ember shards, placed on its [redacted] braziers.',
    );
  });

  it('is a redaction of the full grounded answer, not a fresh generation', () => {
    const service = serviceWith(GATED_ANSWER);
    const full = service.answer('How do I open the Ember Gate?', SOURCES, 'full');
    const hint = service.answer('How do I open the Ember Gate?', SOURCES, 'hint');
    expect(full.text).toBe(GATED_ANSWER);
    expect(hint.text).toContain('[redacted]');
    expect(hint.text).not.toContain('Ember Gate');
    expect(hint.text).not.toContain('Hollow Vale');
    expect(hint.text).not.toMatch(/\b(four|4)\b/);
  });

  it('keeps quantities the player already mentioned in their question', () => {
    const result = serviceWith('You need four ember shards, placed on its four braziers.').answer(
      'I already have four shards — is that enough?',
      SOURCES,
      'hint',
    );
    expect(result.status).toBe('answered');
    expect(result.text).toContain('four');
  });
});
```

### test/hint-redactor.spec.ts
```ts
import { describe, expect, it } from 'vitest';

import { HintRedactor } from '../src/answer/hint-redactor.js';

const redactor = new HintRedactor();

describe('HintRedactor.redact', () => {
  it('removes a boss name, a location and a quantity in one sentence', () => {
    const out = redactor.redact(
      'The Hollow Matriarch guards the Dusk Caverns and demands four ember shards.',
      'How do I progress?',
    );
    expect(out).not.toContain('Hollow Matriarch');
    expect(out).not.toContain('Dusk Caverns');
    expect(out).not.toMatch(/\bfour\b/i);
    expect(out).not.toMatch(/\b4\b/);
    expect(out).toBe('The [redacted] guards the [redacted] and demands [redacted] ember shards.');
  });

  it('redacts digit quantities too', () => {
    const out = redactor.redact('Place 4 ember shards on the braziers.', 'How do I open it?');
    expect(out).toBe('Place [redacted] ember shards on the braziers.');
  });

  it('keeps quantities the player already mentioned', () => {
    const out = redactor.redact(
      'Bring the three ember shards to the Hollow Vale.',
      'I already have three shards. What now?',
    );
    expect(out).toContain('three');
    expect(out).not.toContain('Hollow Vale');
    expect(out).toBe('Bring the three ember shards to the [redacted].');
  });

  it('does not over-redact common-case wording', () => {
    const out = redactor.redact('Place the ember shards on the braziers.', 'How do I open it?');
    expect(out).toContain('ember shards');
    expect(out).toContain('braziers');
    expect(out).not.toContain('[redacted]');
  });
});
```

### test/eval-harness.spec.ts
```ts
import { describe, expect, it } from 'vitest';

import { AnswerService } from '../src/answer/answer.service.js';
import { REFUSAL_TEXT } from '../src/answer/answer.types.js';
import { EvalHarness, type ScenarioResult } from '../src/eval/eval-harness.js';
import { combineScores, FaithfulnessJudge } from '../src/eval/judges.js';
import {
  EMBER_GATE_PAGE,
  EMBER_SHARDS_PAGE,
  GOLDEN_SCENARIOS,
  type GoldenScenario,
} from '../src/eval/scenarios.js';

const SOURCES = [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE];

function runSuite(): ScenarioResult[] {
  const harness = new EvalHarness();
  const service = new AnswerService(harness.buildLlm(GOLDEN_SCENARIOS));
  return harness.run(GOLDEN_SCENARIOS, service);
}

function byId(results: ScenarioResult[], id: string): ScenarioResult {
  const result = results.find((r) => r.id === id);
  if (!result) throw new Error(`scenario "${id}" missing from results`);
  return result;
}

function scenarioById(id: string): GoldenScenario {
  const scenario = GOLDEN_SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`unknown scenario "${id}"`);
  return scenario;
}

describe('eval harness over the golden scenarios', () => {
  it('runs every golden scenario', () => {
    const results = runSuite();
    expect(results).toHaveLength(GOLDEN_SCENARIOS.length);
    expect(results.map((r) => r.id)).toEqual(GOLDEN_SCENARIOS.map((s) => s.id));
  });

  it('scores a correct grounded answer high', () => {
    const grounded = byId(runSuite(), 'grounded-answer');
    expect(grounded.status).toBe('answered');
    expect(grounded.answer).toBe(
      'The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.',
    );
    expect(grounded.score).toBeGreaterThanOrEqual(0.9);
  });

  it('scores a scripted confident lie low', () => {
    const lie = byId(runSuite(), 'confident-lie');
    expect(lie.status).toBe('refused');
    expect(lie.answer).toBe(REFUSAL_TEXT);
    expect(lie.helpful).toBe(0);
    expect(lie.score).toBeLessThan(0.2);
  });

  it('scores a correct refusal (sources lack the answer) as correct', () => {
    const refusal = byId(runSuite(), 'sources-lack-answer');
    expect(refusal.status).toBe('refused');
    expect(refusal.answer).toBe(REFUSAL_TEXT);
    expect(refusal.score).toBeGreaterThanOrEqual(0.9);
  });

  it('catches "5 shards" against sources saying 4, exactly', () => {
    const scenario = scenarioById('quantity-mismatch');
    const result = byId(runSuite(), 'quantity-mismatch');

    // The gate drops the wrong-quantity sentence, and only that sentence.
    expect(result.droppedSentences).toEqual(['You need five ember shards to open it.']);
    expect(result.answer).not.toMatch(/five|\b5\b/);

    // The faithfulness judge, run on the raw planted text, names the exact mismatch.
    const verdict = new FaithfulnessJudge().judge(scenario.scriptedAnswer, {
      sources: scenario.sources,
      falseFacts: scenario.falseFacts,
    });
    expect(verdict.findings.some((f) => /five ember shards/i.test(f))).toBe(true);
    expect(verdict.findings.some((f) => f.includes('5') && f.includes('4'))).toBe(true);
  });

  it('passes the sources to the faithfulness judge, and its findings depend on them', () => {
    const lie = 'To open the Ember Gate, farm five moon shards in the Dusk Caverns.';
    const judge = new FaithfulnessJudge();

    const withSources = judge.judge(lie, { sources: SOURCES, falseFacts: ['five moon shards'] });
    const withoutSources = judge.judge(lie, { sources: [], falseFacts: ['five moon shards'] });

    // With the sources in front of it, the judge names the exact quantity mismatch.
    expect(withSources.findings.some((f) => f.includes('5') && f.includes('4'))).toBe(true);
    expect(withSources.score).toBeLessThan(0.5);
    // Without them it cannot name the mismatch — only flag it as unknown.
    expect(withoutSources.findings.some((f) => f.includes('5') && f.includes('4'))).toBe(false);
  });
});

describe('score combination', () => {
  it('combines helpfulness and faithfulness as min, not mean', () => {
    expect(combineScores(1, 1)).toBe(1);
    expect(combineScores(0.95, 0.4)).toBe(0.4);
    expect(combineScores(0.2, 0.95)).toBe(0.2);
    // A fluent lie (high style score, low faithfulness) cannot hide behind averaging.
    expect(combineScores(0.9, 0.1)).toBeLessThan((0.9 + 0.1) / 2);
  });
});
```
