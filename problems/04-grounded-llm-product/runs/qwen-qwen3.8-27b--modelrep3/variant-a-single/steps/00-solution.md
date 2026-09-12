# solution

## reasoning

```
Let me carefully analyze the task.

The task is variant A of the "Grounded LLM Product" problem: build an answer pipeline + evaluation harness for a gameplay assistant.

Requirements:
1. `answer(question, sources, mode)` using an injectable LLM client (a scripted fake is fine), with a sentence-level grounding gate: either drop ungrounded sentences, or the service refuses with "not covered by my sources".
2. Hint mode is derived by redacting the complete grounded answer, not by re-prompting.
3. Evaluation harness: golden scenarios (question, sources, expected facts, planted FALSE facts such as fabricated item requirements); helpfulness judge and faithfulness judge that receives sources; final score = min of the two.
4. Tests proving: scripted confident lie answer scores low; correct grounded answer scores high; scenario where sources lack the answer yields refusal; quantity errors (e.g., "5 shards" when source says 4) are caught accurately.

Language: TypeScript (strict), ESM, `"type": "module"`. Vitest for tests. The codebase conventions mention NestJS, Prisma, PostgreSQL, but this task doesn't require any DB at all — it's an answer pipeline with fixtures. The conventions say "NestJS for API", but the task asks for `answer(question, sources, mode)` service and an evaluation harness. The layout convention mentions `src/<feature>/<feature>.service.ts` etc.

Hmm — do I need NestJS? The conventions hold "always", but the task is self-contained: an answer pipeline + evaluation harness. Since there's no API, no database, no controllers needed, NestJS would be over-engineering. But the conventions are "always hold"... that said, the task says "do exactly what the task asks. Don't create files it doesn't ask for". The task asks for an answer pipeline + evaluation harness + tests. No API, no database, no Prisma. I think the cleanest, most justifiable interpretation is a plain TypeScript service (a class) with an injectable LLM client, an evaluation harness module, fixtures, and Vitest tests.

Actually, let me think. The conventions list the stack: NestJS for the API, Prisma, PostgreSQL. But this problem doesn't have an API — no mention of endpoints, no mention of DB. Introducing Prisma/Postgres would be fabricating work not asked for. The discipline rule: "Do exactly what the task asks. Don't create files it doesn't ask for, don't improve code you weren't asked to change."

So I'll build a pure TypeScript module:

File layout:
```
package.json
tsconfig.json
vitest.config.ts
src/guide/guide.types.ts        — shared types (Source, AnswerMode, Answer, LlmClient interface)
src/guide/guide.service.ts      — answer(question, sources, mode), grounding gate, hint redaction
src/guide/grounder.ts           — sentence-level grounding gate (maybe put in service file? better as a separate pure module)
src/guide/redactor.ts           — hint mode redaction
src/eval/eval.harness.ts        — golden scenarios, judges, final score
src/eval/judges.ts              — helpfulness judge, faithfulness judge
src/eval/scenarios.ts           — golden scenario fixtures
test/guide.spec.ts              — tests
```

Hmm, wait — the layout convention is `src/<feature>/<feature>.controller.ts`, `<feature>.service.ts`, `<feature>.repository.ts`. Since there's no DB, no repository. The service should be `<feature>.service.ts`. Tests go in `test/<feature>.spec.ts`.

Let me design the core logic.

### Types

```ts
export type AnswerMode = 'full' | 'hint';

export interface WikiSource {
  id: string;
  title: string;
  text: string;
}

export interface GuideAnswer {
  status: 'answered' | 'refused';
  mode: AnswerMode;
  text: string;                    // empty on refusal
  droppedSentences: string[];      // ungrounded sentences dropped by the gate
  refusalReason?: string;          // 'not covered by my sources'
  sourcesUsed: string[];           // source IDs that provided grounding
}

export interface LlmClient {
  complete(prompt: string): Promise<string>;
}
```

Actually, for the "injectable LLM client (scripted fake is fine)" — I'll define an `LlmClient` interface with `complete(prompt: string): Promise<string>` (or string synchronously?). Async is more realistic. Tests can use a scripted fake. Let's go with async — realistic and Vitest handles it.

### Grounding Gate

Sentence-level: split the LLM output into sentences. For each sentence, check whether it's "grounded" in the sources. How do I determine grounding in a testable, deterministic way without a real NLP model?

Defensible approach: a sentence is grounded if its key content (numbers, item names, proper nouns — the "facts") appear in the source text. A common pragmatic technique: extract "factual tokens" — numeric values, capitalized proper nouns, item names — from the sentence and verify each appears in the source text. Additionally, require that at least one substantive token appears (to prevent empty filler sentences from being "grounded").

Actually a stronger approach for "catching quantity errors accurately": numeric grounding. If the sentence contains "5 shards" and the source says "4 shards" — the number 5 near "shards" isn't grounded. The check "5 appears in source text" would pass if "5" appears elsewhere in the source (e.g., "level 5"). To catch quantity errors accurately, I should check *number + unit* pairs: extract (number, following noun) pairs from the sentence and verify that the source contains the same number adjacent to the same noun. That's a solid, defensible heuristic.

Let me design the grounding check:

1. Normalize text: lowercase for comparison, maybe keep the original for display.
2. Sentence split: split on /.?!\s/ boundaries, keep the sentence, and also strip quotes.
3. For each sentence, extract:
   - Quantity claims: regex `(\d+(?:\.\d+)?)\s+([a-z][a-z\-]*)` → pairs like (5, shards).
   - Proper nouns / item names: sequences of capitalized words (multi-word allowed) or all-lowercase known item names? Hmm, detecting "fabricated item requirements" — a planted FALSE fact like "requires Moonblade Shard" where the source never mentions "Moonblade". The proper noun check: a capitalized word (not at sentence start? tricky) should appear in source text (case-insensitive). But a fabricated item could be lowercase: "the moonblade". Hmm.

Alternative approach: grounded = every "fact token" (number, capitalized word, quoted phrase) appears in the source. If the LLM fabricates "the Duskfang", the capitalized "Duskfang" isn't in source → sentence ungrounded → drop. If it fabricates a lowercase name, that's harder — any heuristic will miss some. The tests I'll write will use capitalized fabricated items (realistic: game item names are capitalized). I'll mark an ASSUMPTION comment that grounding detection treats capitalized proper nouns, quantity+noun pairs, and numeric claims as the fact surface; purely lowercase fabrications are out of scope for the deterministic gate.

Let me be careful about "accurately catch" quantity errors. The test: source says "The Altar of Embers requires 4 ember shards." LLM confidently answers "You need 5 ember shards." Gate: quantity claim (5, "ember"? "shards"?). Regex: number followed by one or two lowercase words? "5 ember shards" — number then "ember" then "shards". I should extract the number and the next 1–2 words as the unit, and require that the source contains a sentence with the same number and those unit words in the same order (or at least the same number and same unit words nearby).

Simpler, more robust rule: a quantity claim is grounded if the source text contains the *same number* immediately (or near) the same *unit noun* (the word immediately after the number in the answer, or the last unit word in the phrase). Define: a quantity claim = number N followed by a phrase of 1–3 words ending in a noun, e.g., "5 ember shards" → N=5, unit words ["ember", "shards"]. Grounded if source has the pattern N + those unit words with each unit word within the next ~2 words after N. More simply: for each unit word u in the claim, source contains a substring where N is followed by u within 3 words. Hmm, let me not overcomplicate.

Practical rule (deterministic, testable):
- Extract claims: regex `/(\b\d+(?:\.\d+)?\b)\s+((?:[a-z][a-z\-]*\s+){0,2}[a-z][a-z\-]*)/g` → number + up to 3 words. Trim trailing stop words? Keep it simple: number + up to 3 words.
- A claim (N, words) is grounded in a source if there exists a match in the source for N followed by each word in `words` in order within 4 tokens of N.

Even simpler and more justifiable: grounded if the source contains a substring matching: `N` followed (within a window) by each word of the unit phrase in order. Let me implement:

```ts
function quantityClaimsGrounded(claim: QuantityClaim, sourceText: string): boolean {
  const re = new RegExp(`\\b${claim.number}\\b(?=\\s(?:[^\\d\\s]{1,20}\\s*){0,3}${escapeRegex(claim.unit)})`);
  return re.test(sourceText);
}
```

Hmm, `unit` might be multi-word. Let me do this: build a lookahead from the number to each unit word:

Actually simpler: take the first unit word and the last unit word, require that the source has a number N followed within 3 words by the last unit word, AND that all unit words appear within 4 words of N in order. Let me implement a token-window scan:

```ts
function sourceHasQuantity(sourceText: string, number: string, unit: string[]): boolean {
  const tokens = sourceText.toLowerCase().replace(/[^a-z0-9\s.]/g, ' ').split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== number) continue;
    // scan next up to 4 tokens for unit words in order
    let u = 0;
    for (let j = i + 1; j < Math.min(tokens.length, i + 5) && u < unit.length; j++) {
      if (tokens[j] === unit[u]) u++;
    }
    if (u === unit.length) return true;
  }
  return false;
}
```

Wait, the unit phrase "ember shards" — in the answer "5 ember shards", the words after the number are "ember" then "shards". In the source "requires 4 ember shards" — number 4, then "ember", "shards". So the claim (5, ["ember","shards"]) would not match source's 4. Good, caught accurately.

But note: in the answer, the quantity regex captures up to 3 words after the number. "5 ember shards" → unit ["ember", "shards"] (stops before punctuation/sentence end). Good.

Also numbers alone: "takes 45 minutes" → (45, ["minutes"]). No problem.

What about a number not followed by a lowercase word, e.g., "level 5" (number after a word)? My regex only captures N followed by words. "level 5" → N=5, no following word → unit []. Then grounded if source contains "5" somewhere? That's weak. But acceptable: bare numbers without units are checked as "number appears in source". Hmm, could cause a pass on fabricated "takes 7 tries" if 7 is elsewhere in the source. For the deterministic gate, acceptable; the tests will focus on the specified cases. Should I make a bare number (no unit words) ungrounded unless it appears in the source? Yes — a number appears in the source (anywhere). That's the fallback.

Also proper nouns: words that are capitalized inside a sentence (or the second+ word in the text). Extract tokens matching /[A-Z][a-z]+/ that aren't at sentence start... sentence-start capitalized words are ambiguous (could be common noun "You"). Rule: capitalized tokens that appear at non-sentence-start positions, or multi-word proper names, count as proper-noun claims. Each must appear (case-insensitive) in the source. Also, "You" at sentence start → skip (first token). What about acronyms or "The"? "The" at sentence start is skipped; capitalized "The" mid-sentence is rare. I'll skip a small stoplist: The, A, An, It, This, These, That, Those, If, When, You, They, We. Hmm, "You" is a common answer word. Let me have a small stoplist of capitalized words that are commonly sentence starters but aren't facts: The, A, An, It, This, That, These, Those, If, When, You, He, She, They, We, Yes, No, So, And, But, Or, To, Is, Are, Was, Were, Can, Should, Could, Would. Only tokens that are capitalized in the output AND at a non-sentence-start position? Hmm — if the LLM writes "The Duskfang guards the cave." — "The" is at sentence start (skip), "Duskfang" is mid-sentence capitalized → claim → must appear in source.

But what if the fabricated item is at sentence start: "Duskfang is required." Then "Duskfang" is at sentence start. My stoplist wouldn't include "Duskfang", and it's not a common word, so I'd need a way to know it's a proper noun. Heuristic: any capitalized word at sentence start that isn't in a "common sentence starter" whitelist counts as a proper-noun claim. Whitelist: The, A, An, It, This, These, That, Those, If, When, While, You, Your, He, She, They, We, I, Yes, No, So, And, But, Or, To, Is, Are, Was, Were, Do, Does, Did, Can, Could, Should, Would, May, Might, Note, Tip, Warning, Important, Remember, In, On, At, With, Without, After, Before, Once, Until.

That's a defensible whitelist. "Duskfang" isn't in it → claim → source check fails → drop sentence.

Also, what about common lowercase item names? E.g., source: "The ember shard melts frost gates." Answer: "You need the ember shard." "ember" and "shard" are lowercase in source; in answer, lowercase → not extracted as proper noun → sentence grounded via... hmm, what grounds it? The sentence "You need the ember shard." — no number, no capitalized proper nouns. My gate: a sentence with no fact claims — grounded or not? Two philosophies: (a) a sentence without detectable facts is "safe" and keep (since it can't contradict source); (b) it might be fabricated and ungroundable. The task says "sentence-level grounding gate: drop ungrounded sentences". For a sentence like "You need the ember shard." — the key content words "ember shard" appear in the source. I can add a content-overlap check: extract content words (lowercase, length ≥ 4, not in stopword list), and require that a certain fraction (e.g., at least 50%, or at least 1?) appears in the source. Hmm, that could wrongly drop legitimate paraphrases.

For the deterministic gate used in tests, let me keep it this way:
- Sentence is grounded if:
  - all extracted fact claims (quantity claims + proper noun claims) are found in source, AND
  - if the sentence has content words, at least one content word (from a filtered set) appears in the source? That might be too strict for generic advice sentences ("Tip: rest before the trial."). But such sentences are filler; dropping them is fine, and matches "grounded only in those pages" — a generic tip not in the page should be dropped.

Hmm wait, let me think what the tests need:
1. Confident lie scores low → gate drops the lie sentences → refusal or empty → low score in evaluation. The "lie" will contain fabricated proper nouns or wrong quantities → caught.
2. Correct grounded answer scores high → sentences must pass the gate. If I require content-word overlap, the grounded answer must share words with the source — in tests I'll write answers that reuse source vocabulary (which is what real grounded answers do). So the overlap check is fine, and actually strengthens "grounded only in those pages".
3. Sources lack answer → refusal → all sentences ungrounded → status refused with "not covered by my sources".
4. Quantity errors caught accurately → quantity claim check.

So my gate per sentence:
- Extract quantity claims (number + unit words). Each must be backed by source (number + unit words in window).
- Extract proper-noun claims (capitalized tokens per rules). Each must appear in source (case-insensitive word boundary).
- Content overlap: at least K content words (length ≥ 4, non-stopword) appear in source, where K = max(1, 40% of content words)? Let me think: "Tip: rest before the trial." Content words: tip? (length 3, excluded), rest (4), before (stopword? "before" is a stopword), trial (5). So content words: rest, trial → 2. If source contains "trial", 1/2 = 50% ≥ 40% → grounded. Hmm, "rest" might not be in source, but "trial" is. Well — that sentence is half-grounded; keep it? I want to drop it for a stricter test. 50% threshold → drop. Let me set threshold at 50%: grounded if half or more of content words appear in source AND at least one content word appears... wait if content words = 0, treat as grounded (purely structural sentences like "Yes." — well "Yes" is a stopword... content words = 0 → keep? "Yes." is a sentence with no facts; harmless. Keep.)

Hmm, but consider a correct grounded answer: "The Ember Altar demands 4 ember shards, found in the Mirefen." Content words: ember (5), altar (5), demands (7), ember (dup?), shards (6), found (5), mirefen (7). Let me dedupe. If source text contains "Ember Altar", "4 ember shards", "Mirefen" — all content words present → 100% → grounded. Good.

But paraphrases: "Collect four ember shards from the swamp." — "four" is a word number! I should handle word numbers: four, five... map to digits for the quantity check. That's extra complexity; test LLM scripts will use digits. Should I still handle word numbers 1–20? Hmm, "four ember shards" → claim (4, [ember, shards]) → not in source → drop. Good, that's a bonus correctness. I'll add a small word-number map for one through twenty. Actually, let me include it — it's just ~20 lines and prevents a hole. Well, discipline: only what the task needs. Word-number support is a judgment call; it makes the gate more accurate. Let me include a compact map (one through ten or so). Hmm. Let me include one through twenty — fine.

Actually, let me reconsider scope. The deliverable is a product pipeline + evaluation harness with tests. The grounding gate is the heart. I'll write it cleanly with pure functions and unit tests.

### Sentence splitting

Split by sentence-terminal punctuation: `.!?` followed by whitespace or end. Preserve original text of each sentence (strip quotes/commas?). For display and dropping. Use regex split: `text.split(/(?<=[.!?])\s+/)` — lookbehind is supported in Node 20. Also filter empty/whitespace-only.

Edge: abbreviation "e.g." will be mis-split; acceptable for this scope.

### Refusal logic

- `status: 'refused'`, message exactly "not covered by my sources" (task specifies refusal with that string).
- If after dropping ungrounded sentences, no sentences remain → refused.
- What if some remain? → answered with remaining sentences; record dropped ones. Task: "drop ungrounded sentences OR the service refuses" — both allowed; I'll drop and refuse only if nothing remains.

Refusal in hint mode? Hint mode = redaction of full grounded answer. If full is refused → hint also refuses with the same message.

### Hint Mode Redaction

"Hint mode is derived by redacting the complete grounded answer, not by re-prompting." So: compute the full-mode answer (run LLM with full mode? or mode-agnostic?). Design: `answer(question, sources, mode)`:
- Call LLM client (prompt includes question + sources; mode only affects post-processing, not the prompt — that's the point of "not by re-prompting").
- Ground all sentences.
- If mode === 'hint': redact the full text:
  - Boss names (proper nouns) → "a boss" / "a certain boss"? "must not reveal boss names, item locations, or quantities beyond what the player already mentioned."

Redaction rules:
  - Proper nouns (boss names, item names) → replace with a category placeholder. How do I know it's a "boss name" vs "item name"? Without a taxonomy... I can have a config: redaction replaces all proper-noun claims (capitalized multi-word/name-like tokens) with a generic placeholder: "a boss" if the noun co-occurs with boss-ish context? Simpler: replace each distinct proper name with "a nameless foe" (if the sentence mentions boss/defeat/fight) or "an item"? Hmm, overengineered.

Simplest, justifiable redactor:
  - Boss names, locations, item names → all proper nouns: replace with "a name" placeholder... but "must not reveal item locations" — a location is also a proper noun ("Mirefen") → redact to "somewhere"? Hmm, "a faraway place".

Let me define placeholder mapping by context keywords:
  - If the sentence (lowercased) contains any of [boss, fight, defeat, slay, kill, encounter, guardian, champion, guardian] → redact the proper noun to "a hidden boss".
  - If contains [location-ish: cave, temple, swamp, forest, room, area, region, dungeon, fen, keep, tower...] → too brittle.

Alternative: replace any proper noun in a hint with a single uniform placeholder "—"? Like "You need 4 shards from —." Ugly but safe. Better: two categories:
  - If the proper noun phrase appears in a sentence with a "place" context word (north, south, east, west, near, beyond, behind, inside, under, at, the, region...) → "a secret place".
  - Otherwise if with combat context → "a hidden boss".
  - Otherwise → "something"? Hmm.

Honestly, cleanest design: redactor takes the grounded full answer and applies:
1. Quantities: replace every number+unit claim with the quantity the player already mentioned, or with a placeholder "some" / "a number". "Quantities beyond what the player already mentioned" — so if the player said "I have 2 ember shards", a hint can reveal up to 2... beyond that, redact. Implementation: extract quantities the player mentioned (number + unit from the question). A quantity claim in the answer: if it equals or is less than a player-mentioned quantity for the same unit → keep? Hmm, "beyond what the player already mentioned" — if the player mentioned "2 shards" and the answer says "4 shards" → 4 > 2 → redact the number to "several". If the player mentioned nothing → redact all numbers in the hint to "a few" / "several"? Actually, revealing the number when the player mentioned nothing... "must not reveal ... quantities beyond what the player already mentioned" → if player mentioned 0 quantities, revealing any quantity is "beyond" → redact all quantities. So rule: for each quantity claim (N, unit) in the hint: if the player mentioned a quantity M for the same unit AND N ≤ M → keep N; otherwise replace N with "several" (or "a number of"). Hmm, "5" → "several" reads: "you need several ember shards". Good.

  What about numbers that aren't quantities (e.g., "level 5")? In the hint, redact every number not justified by the player: simpler — replace every number in the hint that isn't backed by a player-mentioned quantity with "several"? "Level 5" → "level several"? Odd. Let me say: bare numbers (no unit word) → replace with "some"? "level some" is weird. Alternative: keep bare numbers? A level isn't a quantity of an item. But "stage 7" could be a spoiler-ish... The requirement says "quantities" — I'll interpret as numeric quantities (number + noun). Bare ordinal-ish numbers: replace digits with "a number"? Hmm. Let me be strict and safe: in hint mode, replace any numeric claim whose value isn't already known to the player (by unit) with "several" for unit numbers and "a number" for bare numbers. "level a number" — awkward but safe. In tests I control the script, so I can avoid awkward cases. Hmm, wait — actually, I might not replace bare numbers, but... "the fifth seal" — "fifth" is an ordinal word number! Word numbers: "four" → player mentioned "two" → redact "four" → "several": "collect several ember shards" works. Word-number redaction: map word → "several" too. OK, let me handle word-numbers in redaction.

2. Names (bosses, items, places): replace each proper-noun phrase with a placeholder. Category selection:
   - If context contains combat words → "a hidden boss".
   - Else if context contains location words → "a secret place".
   - Else → "a name"? For items: "requires a name" is weird; "requires an unnamed item". Let me do: if context contains item words (item, requires, need, craft, key, shard, gear, weapon, armor...) → "an unnamed item". Default fallback → "a name"? Hmm.

   Let me define context buckets with small word lists:
   - Boss context: boss, guardian, foe, enemy, champion, warden, fight, defeat, slay, kill, battle, encounter, duel, guarded.
   - Place context: place, location, region, area, zone, cave, temple, swamp, forest, mountain, dungeon, keep, tower, fen, marsh, valley, ruins, north, south, east, west, near, beyond, behind, inside, under, above, past, through, door, gate, path, way.
   - Item context: item, shard, key, gem, potion, scroll, sword, weapon, armor, ring, amulet, relic, requires, needed, need, craft, material, ingredients, gear, tool, component.
   Order of checks: item? place? boss? Or priority... A sentence "Boss guards the temple" → both boss and place context → the boss name gets "a hidden boss", the place name gets "a secret place". I should classify per noun, but I only have sentence context. Better: classify per sentence, but assign placeholder based on the noun's syntactic position? Too deep.

   Practical: per sentence, determine the set of context buckets that are present. For each proper noun in the sentence: if the sentence has exactly one context bucket, use that bucket's placeholder. If multiple, use priority: boss > place > item? "Boss guards the temple" buckets = {boss, place}; boss name → "a hidden boss", temple is a common noun (lowercase "temple") → not redacted. Only capitalized nouns are redacted. In that sentence, only one capitalized noun (the boss name) → bucket {boss, place}... priority boss → "a hidden boss". Good.

   Edge: "The Mirefen holds the Ember Shard." Buckets: place (fen is in the list) + item (shard) → proper nouns: Mirefen, Ember, Shard? "Ember Shard" is a multi-word proper noun. Hmm, multi-word proper noun detection: consecutive capitalized words → one phrase ("Ember Shard"). Mirefen is single. Two different proper nouns with different intended placeholders but the sentence has both buckets. Priority is boss > place > item → both get "a secret place"? "The secret place holds the secret place." — no good.

   OK, cleaner: assign per-noun by nearest context word within a small window (say 4 words), or fallback to sentence priority. That's implementable: for proper noun at token index i, scan tokens in a window of ±5 for bucket words; take the first bucket found; if none, priority boss > place > item, and if nothing, "a name"? Fallback: "a name" is weird; let me use "a name" → "an unnamed name"? No. Let me use "a secret" as fallback? "The secret holds the secret." Ugh.

   Let me step back. Maybe simpler and more defensible: single placeholder "a secret" is too vague; the product asks to "must not reveal boss names, item locations, or quantities". A single uniform placeholder like "✱" or "___" is classic redaction: "Defeat the ___ to gain the ___. You need ___ shards." This is clearly a "redacted" hint and unambiguously satisfies all three constraints. And it's simple and testable. But a hint that's all underscores isn't helpful... The helpfulness judge scores it; a good hint preserves structure.

   Let me do: two placeholders — a named entity becomes "a hidden name"? Hmm.

   Let me look at typical "hint mode" for game guides: "You need to collect shards from somewhere in the swamp before facing the big fight." The redaction replaces specific names with a generic word of the same part of speech: boss name → "the boss" / "a boss"; place → "somewhere" / "a hidden place"; item → "an item" / "the item". My per-noun window approach can handle the "Mirefen holds the Ember Shard" case: Mirefen's window contains "holds" (neutral)... the fen itself is in the place bucket (the word "fen" is in the list — but wait, "Mirefen" contains "fen"; my bucket word matching should be exact-token match, not substring. "Mirefen" as a token isn't "fen". So the window around Mirefen: [The, Mirefen, holds, the, Ember] — no bucket words → fallback. Fallback = ... hmm.

   New idea: make the fallback the boss bucket? No — an item would get "a hidden boss".

   OK decision: I'll implement per-noun classification with per-sentence context, and a priority when ambiguous, and in tests I'll write scenarios where classification is unambiguous (realistic: sentences talk about one thing). In the ambiguous case, priority: place < item < boss? Let me think which error is worse... Honestly for the deliverable, I'll document the rule clearly in a comment and choose priority: if the sentence has boss context → boss names; else if place context → place names; else if item context → item names; else → default "a name". And I'll note in a comment that per-sentence classification is an approximation. Actually — let me do a hybrid: per-noun window scan (±5 tokens) for bucket words; if found, that bucket; else sentence-level priority; if none of those, "a name". Hmm wait, "a name" for an item in "requires a name" — acceptable? "Craft the sword from a name." — weird, but only in edge cases.

   Hmm, actually let me simplify to the defensible core: the three required redaction categories map to three placeholders: "a hidden boss", "a secret place", "an unnamed item". Default (no context): "an unnamed name"? I'll use "a name". Fine, I'll note in a comment. Actually, you know what? Let me make the fallback "a name" and not sweat it — the tests will cover the three required categories cleanly.

3. Redaction should apply only to the grounded full answer (mode hint = redact(groundedFull)). And must not re-prompt: in `answer()`, the LLM is called once with the same prompt regardless of mode; hint mode redacts the grounded full text. Implementation: `answer(q, s, 'hint')` → call llm once (prompt built with question + sources, no mode in prompt) → ground → if any sentences → redact the joined grounded sentences using the player-mentioned quantities extracted from the question → return mode 'hint' text. This satisfies "derived by redacting the complete grounded answer, not by re-prompting" — and I can even structure the code so `redactHint(fullAnswerText, question)` is a separate exported function and tests assert the hint equals the redaction of the full.

### Evaluation Harness

Golden scenario:
```ts
interface GoldenScenario {
  id: string;
  question: string;
  sources: WikiSource[];
  expectedFacts: string[];      // normalized facts the correct answer must contain
  plantedFalseFacts: string[];  // fabricated claims that must NOT appear
  scriptedAnswers?: ...         // per-scenario?
}
```

The harness needs to run: given a scenario + the service (with an LLM script), produce an Answer, run:
- Helpfulness judge: does the answer address the expected facts? Score 0..1 = fraction of expected facts present (normalized string containment, number-aware?).
- Faithfulness judge (receives sources): penalize planted false facts / unsupported claims. Score: 1 − (fraction of planted false facts that appear) − penalty for ungrounded residue? The faithfulness judge can reuse the grounder: score = grounded sentence ratio? But the service already gates... In the evaluation, the answer given to the judge is the service's final answer. The judge independently checks: fraction of the answer's sentences that are grounded in the sources (using the same grounding function — fine, it's a deterministic proxy) AND the absence of planted false facts.

Final score = min(helpfulness, faithfulness).

Test requirements:
- "Scripted confident lie answer scores low": script the LLM to answer with lies (fabricated item + wrong quantity), run the harness on the scenario, assert final score is below a threshold (e.g., < 0.4, or specifically: faithfulness low → min low).
- "Correct grounded answer scores high": script LLM with correct grounded answer → final score high (e.g., > 0.8).
- "Scenario where sources lack the answer yields refusal": sources that don't contain the answer → service refuses with "not covered by my sources" → evaluation records refusal (score 0? The harness should score refusal: helpfulness 0, and report refusal). Test asserts status is refused and message exact.
- "Quantity errors (e.g., '5 shards' when source says 4) are caught accurately": direct gate test: source says 4 ember shards, LLM says 5 → the sentence is dropped (droppedSentences contains it) → and in evaluation, faithfulness reflects the error (if not gated? hmm — the gate will drop it before evaluation. "Caught accurately" is about the gate: asserting that (5,shards) is flagged and (4,shards) passes. I'll write a focused test: the gate drops the "5 shards" sentence and keeps the "4 shards" sentence; and additionally the faithfulness judge independently flags "5 shards" as false (in case it slips through). Both layers = "caught accurately".)

Judges:
```ts
interface JudgeVerdict { score: number; findings: string[]; }
helpfulnessJudge(answer, scenario): verdict  // fraction of expectedFacts present
faithfulnessJudge(answer, scenario.sources, scenario.plantedFalseFacts): verdict
```

Helpfulness: for each expectedFact (a normalized phrase), check if the answer text contains it (case-insensitive, word-boundary). Score = hits / total. Refusal → 0 (with finding "refused").

Wait — expected facts: how do I write them? Normalized tokens/words? E.g., expectedFacts: ["4 ember shards", "Mirefen"]. Match with containment. The planted false fact "Moonblade" → check if absent.

Faithfulness:
- Base: ratio of the answer's sentences that are grounded (via the same sentenceGrounding function), weighted by sentence count.
- If a planted false fact appears in the answer → strong penalty: e.g., score *= 0 or subtract 1 per occurrence? Let me do: plantedViolation → score = min(score, 0.2)? Simpler: if any planted false fact is found → score = 0 (or 0.1)? The lie test needs low final score: lie answer = fabricated item "Moonblade" + wrong quantity → planted fact appears → faithfulness 0 → final 0 < 0.4. ✓.

But wait — in the lie scenario, the service's gate will drop the ungrounded lie sentences → the answer might be a refusal → final score = 0 anyway. The test says "scripted confident lie answer scores low" — either path gives low. But I want the evaluation to be meaningful even if the gate missed: the faithfulness judge is a second line of defense. In tests, I can assert both: the service drops the lie sentence AND the harness final score is low.

Hmm, but there's a subtlety: if the gate drops everything → refusal → "confident lie scores low" via refusal. Is that "scoring low" in the evaluation? The harness should give a refusal a score: helpfulness 0 → final 0. Yes, I'll define: refused → helpfulness 0, faithfulness = 1? No — min → 0. Let me define: refused answer → final score 0 with reason "refused". Actually, refusal is correct behavior when the sources lack the answer; but the evaluation harness evaluates *the pipeline's* behavior on a scenario — for a lie scenario (where the sources do contain the answer), the refusal is a failure of helpfulness → 0. For a lack-of-answer scenario, the correct behavior is refusal — that scenario's golden expectation is "refusal" and I test the service directly, not the harness score. I can include an `expect: 'answer' | 'refusal'` in the scenario? The task says the golden scenarios have (question, sources, expected facts, planted false facts) — refusal expectation for the lack scenario is a separate test. Keep harness score semantics: helpfulness counts refusal as 0 (findings: "refused"), final = min. In a lack scenario with expectedFacts, score 0 — but the correct behavior there IS refusal... I'll only run the harness on scenarios where an answer is expected, and test the lack scenario directly via the service. Clean.

Actually, let me include a third scenario for the harness: a "lure" scenario where sources have partial info? I'll stick to the required set: 2–3 scenarios for the harness + direct service tests.

### Fixtures

"2–3 wiki page texts provided as fixtures" — so I need fixture files: e.g., `src/eval/fixtures/wiki-pages.ts` with 3 wiki pages (Ember Altar, Mirefen region, boss "Duskfang Warden"). And a golden scenario file referencing them.

Let me write the world:
- Page 1 "Ember Altar": "The Ember Altar stands at the center of the Mirefen. It demands 4 ember shards before it can be kindled. The shards melt frost gates."
- Page 2 "Mirefen": "The Mirefen is a flooded valley south of Ashbridge. Ember shards grow on the pale reeds along the Mirefen's eastern bank. The Duskfang Warden patrols the Mirefen at night."
- Page 3 "Duskfang Warden": "The Duskfang Warden is a boss that guards the Ember Altar. It drops a warden sigil after defeat. The warden sigil opens the gate behind the altar."

Golden scenario 1:
- Question: "How do I kindle the Ember Altar?"
- Sources: all three.
- expectedFacts: ["4 ember shards", "ember shards", "kindled"?]. Let me define expectedFacts as phrases: ["4 ember shards"]. Also "the Ember Altar" maybe. PlantedFalseFacts: ["Moonblade", "5 ember shards", "requires 6 ember shards"?]. The planted false fact = what a lie would say: "requires a Moonblade", "5 ember shards".
- Scripted correct answer: "The Ember Altar demands 4 ember shards before it can be kindled."
  Check gate: quantity (4, [ember, shards]) → source 1 has "4 ember shards" ✓. Proper nouns: Ember? Mid-sentence capitalized? "The Ember Altar demands..." — "The" at sentence start (whitelist), "Ember" mid-sentence capitalized → claim → "ember" is in source ✓, "Altar" ✓. Content words: ember, altar, demands, kindled — "kindled" is in source ("before it can be kindled") ✓, all present → grounded ✓.
  Helpful: expectedFacts ["4 ember shards"] present ✓ → 1.0. Faithfulness: grounded sentence ratio 1.0, no planted facts → 1.0. Final 1.0 > 0.8 ✓.

- Scripted lie answer: "The Ember Altar requires 5 ember shards and a Moonblade."
  Gate: quantity (5, [ember, shards]) → source has only 4 → ✗ → sentence ungrounded → drop. Proper noun "Moonblade" not in source → ✗. So the whole sentence dropped → refusal. Harness: refusal → 0 → "scores low" ✓. Hmm — but "scripted confident lie answer scores low" — the evaluation should perhaps show faithfulness catching it. Let me have the harness also evaluate *what the LLM produced*? No — the harness evaluates the service output (that's the product). The test asserts final score < 0.4. Via refusal, that's 0. Good. But I also want the faithfulness judge to show it would catch the lie even ungated: I can add a test that runs faithfulnessJudge directly on the raw lie text with sources → score 0/low. That directly proves the judge catches it. And the quantity test runs the gate directly. Multiple layers proven.

Golden scenario 2 (hint-related):
- Question: "I found 2 ember shards so far. What's the way forward?" — player mentioned "2 ember shards".
- expectedFacts: ["ember shards", "Mirefen"]? Correct answer: "Ember shards grow on the pale reeds along the Mirefen's eastern bank. The Duskfang Warden guards the Ember Altar."
  Wait, source 3 says "guards the Ember Altar" — check: "The Duskfang Warden is a boss that guards the Ember Altar." ✓.
  Gate for sentence 1: "Ember shards grow on the pale reeds along the Mirefen's eastern bank." — proper nouns: Ember (mid? no — sentence start: "Ember shards..." — "Ember" at sentence start → whitelist? "Ember" isn't a common sentence starter → proper-noun claim → in source ✓. Mirefen ✓ (apostrophe in "Mirefen's" — I'll need to normalize apostrophes when matching: "Mirefen" appears in source too as "Mirefen's"? Source: "along the Mirefen's eastern bank" ✓ same token.) Content words: ember, shards, grow, pale, reeds, along (stopword?), mirefen, eastern, bank — source has all? Source 2: "Ember shards grow on the pale reeds along the Mirefen's eastern bank." ✓ 100%.
  Sentence 2: "The Duskfang Warden guards the Ember Altar." → Duskfang, Warden, Ember, Altar all in source ✓. Grounded ✓.
  Hint mode with player's "2 ember shards": redact → quantities: the answer has no numbers here... let me add a sentence with a number: correct answer includes "You need 4 ember shards in total." → hint: player mentioned 2 → 4 > 2 → redact "4" → "You need several ember shards in total." Names: "The Duskfang Warden guards the Ember Altar." → boss context (guards) → "a hidden boss guards the Ember Altar"? "Ember Altar" is an item/place name... bucket: sentence has boss context (guards) → all proper nouns → "a hidden boss"?? "a hidden boss guards a hidden boss" — bad. Ugh, per-sentence classification again.

  Let me reconsider: make the redaction context per-noun with a window. Sentence: "The Duskfang Warden guards the Ember Altar." Tokens: [The, Duskfang, Warden, guards, the, Ember, Altar]. For "Duskfang Warden" (phrase) at index 1-2: window ±5 → tokens include "guards" → boss bucket ✓ → "a hidden boss". For "Ember Altar" at index 5-6: window → [Warden, guards, the, Ember, Altar] — "Warden" is in the boss list! → "a hidden boss" again. Hmm. Add "altar" to place/item bucket? "altar" → item context? The altar is a structure — place. Add altar, shrine, pedestal, monument, gate to place bucket. Then Ember Altar's window: tokens [Duskfang, Warden, guards, the, Ember, Altar] → boss word (Warden) within window... scan order: scan outward from the noun; nearest context word decides. For Ember Altar: nearest left context word: "guards" (3 left? guards is at index 3, Ember at 5 → distance 2) and "altar" itself is a place word at distance 0! If the noun's own token contains a bucket word (altar → place), that's nearest → place ✓. For Duskfang Warden: "Warden" itself is a boss word at distance 0 → boss ✓.

  So the rule: for a proper-noun phrase, first check if any of its own tokens are in a bucket list; then outward window; then sentence-level priority; then fallback "a name". That handles this well. Let me define the bucket word lists:
  - Boss: boss, boss? (lowercase forms) guardian, warden, foe, enemy, champion, warden, fight, defeat, slay, kill, battle, duel, encounter, guarded, guards, guard, hound, specter, lich, dragon? (dragon is a specific creature... fine, boss-ish)
  - Place: place, location, region, area, zone, cave, temple, swamp, forest, mountain, dungeon, keep, tower, fen, marsh, valley, ruins, altar, shrine, gate, path, door, room, bank, shore, cliff, hill, north, south, east, west, beyond, near, behind, inside, under, above
  - Item: item, shard, key, gem, potion, scroll, sword, weapon, armor, ring, amulet, relic, sigil, material, ingredient, requires, needed, need, craft, tool, component, blade

  Wait, "requires" as an item context: "The Ember Altar requires..." — Ember Altar's window contains "requires" → item → "an unnamed item"?? But the altar is a place. Own-token check: "altar" is in place bucket → place wins (own-token priority). ✓. "Ember Shard" → own token "shard" → item ✓. "Mirefen" → no own token (fen? "Mirefen" as token ≠ "fen" — exact token match only)... window: "The Mirefen is a flooded valley..." → "valley" is place ✓. Good.

  Hmm, but "Warden" appears as a boss word; "Duskfang Warden" own token Warden → boss ✓.

  Fallback if nothing: priority boss > place > item > "a name"? Let me use: if the sentence contains any bucket word at all, use sentence priority (boss > place > item); else "a name".

  OK, that's implementable. About 80 lines. Worth it — the hint mode is an explicit requirement.

  Wait, also "item locations": "Ember shards grow on the pale reeds along the Mirefen's eastern bank." In the hint: Mirefen → own token? "Mirefen" no; window ±5: [Ember? let me lay out: [Ember, shards, grow, on, the, pale, reeds, along, the, Mirefen's, eastern, bank]] — Mirefen's at index 9; window tokens include "bank" (place, index 11, distance 2) → "a secret place" ✓. "eastern bank" lowercase stays. Hint: "Ember shards grow on the pale reeds along a secret place's eastern bank." — hmm "a secret place's" — possessive! The redacted token is "Mirefen's" with an apostrophe-s. I'll need to redact the stem and keep the "'s". Handling: match proper noun followed by optional "'s" → placeholder + "'s". ✓ (Note: proper-noun extraction for the gate must also handle "Mirefen's" → strip the "'s" before source matching; source contains "Mirefen's" so either way works.)

  Also, redaction should lowercase the placeholder's article agreement? "the Duskfang Warden" → "the a hidden boss" — bad! Need to handle the preceding article: "the X" → "the hidden boss" (strip "a" from placeholder after "the"). Rule: if the token immediately before the name is "the" → use placeholder without article: "hidden boss", "secret place", "unnamed item"; if before is "a"/"an" → replace the whole "a X" with the placeholder (with article); else use the placeholder with article ("a hidden boss"). Placeholders:
  - Boss: "a hidden boss" / bare "hidden boss"
  - Place: "a secret place" / "secret place"
  - Item: "an unnamed item" / "unnamed item"
  "a Duskfang Warden" → "a hidden boss" (consume the article). "the Duskfang Warden" → "the hidden boss". No article: "Duskfang Warden guards..." → "a hidden boss guards...". ✓

### LLM Client & Prompt

```ts
export interface LlmClient {
  complete(prompt: LlmPrompt): Promise<string>;
}
```
Prompt = { system: string; question: string; sources: WikiSource[] }? Or just a string. Let me make it a structured prompt: `LlmPrompt { role: 'assistant-guide'; question: string; sources: WikiSource[] }`. The real client would serialize; the fake script matches on question content. Scripted fake:

```ts
class ScriptedLlmClient implements LlmClient {
  constructor(private script: { match: RegExp | string; reply: string }[]) {}
  async complete(prompt) { find first match on question → return reply; else throw or return "I cannot answer that." }
}
```
If no match → throw Error('scripted client: no scripted reply') — fail loudly in tests. Or return a default lie? I'll throw.

Where does ScriptedLlmClient live? It's a test double, but the task says "injectable LLM client (scripted fake is fine)" — I'll put it in src (a module `src/guide/scripted-llm-client.ts`) so the evaluation harness examples / demos can use it, and tests import it too. That's justifiable — the task explicitly sanctions a scripted fake as the client. I could also have a tiny `src/guide/llm-client.ts` with the interface + prompt builder, and the service imports the interface.

Actually, let me consolidate the interface in the guide module types file.

### Service

```ts
export class GuideService {
  constructor(private readonly llm: LlmClient) {}
  async answer(question: string, sources: WikiSource[], mode: AnswerMode = 'full'): Promise<GuideAnswer> {
    if (sources.length < 1) → refuse? "not covered by my sources" (zero sources → nothing grounded). Yes, refuse.
    const prompt = buildPrompt(question, sources);
    const raw = await this.llm.complete(prompt);
    const sentences = splitSentences(raw);
    const kept: {text, sourcesUsed[]}[] = [];
    const dropped: string[] = [];
    for (const s of sentences) {
      const verdict = gradeSentence(s, sources);
      if (verdict.grounded) kept.push(...); else dropped.push(s);
    }
    if (kept.length === 0) return { status:'refused', mode, text:'', refusalReason:'not covered by my sources', droppedSentences: dropped, sourcesUsed: [] };
    const fullText = kept.map(k=>k.text).join(' ');
    if (mode === 'full') return { status:'answered', mode:'full', text: fullText, ... };
    const hintText = redactToHint(fullText, question);
    return { status:'answered', mode:'hint', text: hintText, ... };
  }
}
```

"Hint mode is derived by redacting the complete grounded answer" ✓ — redact on the grounded full text (kept sentences), single LLM call.

### Grounding Functions (pure, exported for reuse in evaluation)

`src/guide/grounder.ts`:
- `splitSentences(text): string[]`
- `isSentenceGrounded(sentence, sources): GroundingVerdict { grounded: boolean; reasons: string[] }`
- Helpers: `extractQuantityClaims(sentence)`, `extractProperNounClaims(sentence)`, `extractContentWords(sentence)`.

Normalization: lowercase for matching; strip punctuation like apostrophes? For word matching, tokenize with /[a-z0-9']+/i keeping internal apostrophes/hyphens. For source matching, build a normalized source string (lowercased). Proper noun "Duskfang" → source contains "duskfang" ✓ (source is lowercased).

Quantity claim extraction details:
- Word numbers: map {one:1,...,twenty:20} — for the check, normalize the claim number to a digit string; but the source might use the word "four" or the digit "4"! Source: "demands 4 ember shards" uses a digit. But what if the source says "four"? Normalize the source too: replace word numbers with digits before tokenizing? Let me normalize both sides: a function `normalizeForMatching(text)` → lowercase, replace word numbers (one through twenty, standalone words) with their digit string, keep. Then token comparison. "5" vs "4" differ → claim fails. ✓

Proper noun extraction:
- Tokens of the sentence with positions. Capitalized = /^[A-Z][a-zA-Z'-]+$/.
- Group consecutive capitalized tokens into phrases (e.g., "Duskfang Warden").
- First token of the sentence: if in COMMON_STARTERS → skip (and don't start a phrase). Else → claim.
- Non-first token: if in STOP_CAPS (like "The") → skip. Else claim.
- Also handle possessive: "Mirefen's" → strip "'s" for the claim.

Hmm wait, what about a capitalized word that's a common noun mid-sentence that appears in the source anyway (e.g., "Altar" if the source also capitalizes it)? The source match handles it: if the source text has the word (in any case) → grounded. The source text is wiki-like with proper nouns capitalized; lowercased matching → fine. A common capitalized mid-sentence word like "Monday" would fail if not in the source — acceptable strictness.

Content overlap:
- Content words: tokens length ≥ 4, lowercase (after normalization), not in STOP_WORDS (a big list: the, and, that, this, with, from, your, you, need, needs, have, has, are, was, can, will, about, before, after, here, there, what, when, where, how, way, also, most, other, than, then, them, they, your, yours, etc.). Note: "need" should be a stopword (it's generic). "shard" (5) is content ✓. "four"→"4" is a digit, not content (length/digit filter: only letters).
- Threshold: grounded if (matching content words / total content words) ≥ 0.5 AND total content words ≥ 1... and if total = 0 → grounded (no detectable content). Hmm, what about "Defeat it to proceed."? Content words: defeat (6), proceed (7) → if source has "defeat" → 1/2 = 0.5 → pass. OK.

Edge: a sentence that's all proper nouns: "The Mirefen." → content words: mirefen (7) → in source ✓.

Let me also think about: the refusal test "scenario where sources lack the answer yields refusal". LLM scripted with a confident-sounding answer, but the sources don't support it. E.g., question "How do I defeat the Duskfang Warden?" with sources = only Ember Altar page (no Warden page). Scripted answer: "The Duskfang Warden falls to 3 frost arrows." → proper nouns Duskfang, Warden not in the single source; quantity (3, [frost, arrows]) absent; content overlap: defeat? (stopword? no, "defeat" isn't in stopword... let me add "defeat"? No — defeat is a verb, content-ish. In the Ember Altar page, no "defeat" → overlap 0 → ungrounded → drop. Second sentence maybe "It weakens at dawn." → content: weakens, dawn → not in source → drop. → refusal with "not covered by my sources" ✓.

Also "2–3 wiki page texts provided as fixtures" — the fixtures module provides the 3 pages; scenarios use 2–3 of them.

### Evaluation Harness Details

`src/eval/eval-harness.ts`:

```ts
export interface JudgeVerdict {
  score: number;            // 0..1
  findings: string[];
}
export interface ScenarioReport {
  scenarioId: string;
  answer: GuideAnswer;
  helpfulness: JudgeVerdict;
  faithfulness: JudgeVerdict;
  finalScore: number;       // min
  pass: boolean;            // finalScore >= PASS_THRESHOLD
}
export async function runScenario(service, scenario, mode='full'): Promise<ScenarioReport>
export async function runSuite(service, scenarios, mode): Promise<ScenarioReport[]>
```

Judges (`src/eval/judges.ts`):
- `helpfulnessJudge(answer: GuideAnswer, scenario): JudgeVerdict`
  - If refused → { score: 0, findings: ['refused: not covered by my sources'] }.
  - For each expectedFact: normalize, check containment in answer.text (lowercased). Score = matched/total; findings list missing.
- `faithfulnessJudge(answer: GuideAnswer, scenario): JudgeVerdict`
  - If refused → score 1? Hmm. Faithfulness of a refusal = nothing said → fully faithful. min(help=0, faith=1) = 0 → still low. That's semantically correct: a lie scenario where the service refuses: helpfulness 0 → final 0. And the faithfulness of 1 is truthful. OK: refused → { score: 1, findings: ['no claims made (refusal)'] }.
  - Otherwise:
    - sentenceRatio: split answer.text into sentences, ratio of grounded (using grounder).
    - planted: any plantedFalseFact contained in the text → violation.
    - score = sentenceRatio * (planted violations ? 0 : 1)? If a planted fact appears → 0 (harsh but "planted FALSE fact detected → fail"). Or subtract: score = max(0, sentenceRatio - 0.5 * violationsCount)? For "scores low" test, the lie is gated to refusal anyway; direct judge test: run faithfulnessJudge on a manual answered GuideAnswer (status answered, text = lie) → planted found → score 0 → good, "scores low" ✓. Let me do: plantedFound → score 0 with finding. Clean contract.
    - Actually let me combine: score = groundedRatio; if planted violations > 0 → score = 0.
- Final = min(helpfulness.score, faithfulness.score).

Wait — should faithfulnessJudge be a pure function over (text, sources, plantedFacts)? The task: "faithfulness judge that receives sources" ✓. I'll make its signature `faithfulnessJudge(answerText: string, sources: WikiSource[], plantedFalseFacts: string[]): JudgeVerdict` and helpfulnessJudge `helpfulnessJudge(answerText: string, expectedFacts: string[]): JudgeVerdict` — and the harness handles refusal (empty text → both judges receive '' → helpfulness 0; faithfulness of '' → 1 (no claims)). Then the harness: if refused → findings note. This makes the judges testable in isolation (needed for "the judge catches the lie even ungated" test).

Normalization for expectedFact / plantedFalseFact matching: lowercase; for facts containing numbers, the fact must appear verbatim (word boundary). "4 ember shards" appears in "demands 4 ember shards before" → substring ✓. The lie "5 ember shards" in "requires 5 ember shards and a Moonblade" ✓ substring → violation found.

But watch out: expectedFact "4 ember shards" and lie text "5 ember shards" — different, good. And the planted "5 ember shards" — if the correct answer says "4 ember shards", does "5 ember shards" substring-match? No ✓.

Word-boundary matching to avoid "shards" matching "shardsmore"? Use a simple substring after lowercasing — sufficient; but "a Moonblade" as planted fact — substring "moonblade" ✓.

Let me have a helper `containsFact(text, fact)` with regex escape + word-ish boundaries: `new RegExp(`(?:^|[^a-z0-9])${escape(factLower)}(?:[^a-z0-9]|$)`)`. OK.

### Test Plan (test/guide.spec.ts + maybe test/eval-harness.spec.ts)

The layout convention is `test/<feature>.spec.ts`. I'll have:
- `test/guide.service.spec.ts`? The convention is `test/<feature>.spec.ts` — the feature is "guide" → `test/guide.spec.ts` and `test/eval.spec.ts`. Two features (guide + eval). Good.

Tests for `test/guide.spec.ts`:
1. Grounded answer passes through: full mode, correct scripted answer → status answered, text equals the grounded text, droppedSentences empty.
2. Ungrounded sentence is dropped, grounded is kept: script an answer with one grounded + one fabricated sentence (fabricated item "Moonblade") → answered, text contains only the grounded sentence, droppedSentences includes the fabricated.
3. All ungrounded → refusal with exact message "not covered by my sources" (the lack scenario: Warden question with only Altar page).
4. Quantity error caught accurately: source says "4 ember shards"; script "You need 5 ember shards." → dropped; and "You need 4 ember shards." → kept. Also bare: gate function test: isSentenceGrounded("The altar demands 5 ember shards.", sources) is false; "4" is true.
5. Hint mode:
   - Hint = redaction of the full grounded answer (no re-prompt): assert llm.complete called exactly once even in hint mode, and hint text equals redactToHint(fullText, question) — I can assert via the expected redacted string: e.g., full "The Duskfang Warden guards the Ember Altar." → hint "The hidden boss guards a secret place."? Wait — Ember Altar: own token "altar" → place → "a secret place"; preceded by "the" → "the secret place". So: "The hidden boss guards the secret place." ✓
   - Quantity redaction: player's question "I have 2 ember shards. How many more?" Answer "You need 4 ember shards in total." → hint "You need several ember shards in total." (4 > 2). And if player says "I have 4..."? 4 ≤ 4 → keep? "must not reveal quantities beyond what the player already mentioned" — revealing 4 when the player said 4 is not beyond → keep. Test: question mentions 4 → hint keeps "4". Edge equality.
   - Hint must not reveal boss names: assert hint doesn't contain "Duskfang" ✓ (covered by exact-match test).
6. Zero sources → refusal.

Tests for `test/eval.spec.ts`:
1. Correct grounded answer scores high: run the harness on scenario 1 with the correct script → finalScore ≥ 0.9 (assert > 0.8), pass true.
2. Scripted confident lie scores low: same scenario, lie script ("requires 5 ember shards and a Moonblade") → finalScore < 0.4 (refusal → 0). Assert < 0.4.
3. Lack scenario → service refusal (maybe in guide spec; but the harness too? keep in guide spec).
4. Quantity error caught accurately: (a) gate level (in guide spec), (b) faithfulness judge level: build an answered GuideAnswer-like input: faithfulnessJudge("The altar needs 5 ember shards.", sources, ["5 ember shards"]) → score 0, finding mentions the planted fact. And helpfulnessJudge with expectedFacts...
5. Final = min: craft a scenario where helpfulness < faithfulness? E.g., an answer that's grounded but misses expected facts → helpfulness 0.5, faithfulness 1 → final 0.5. Test: script an answer "The altar is in the Mirefen." (grounded: quantity? none; proper nouns: altar (mid-sentence capitalized) in source ✓, Mirefen ✓; content: altar, mirefen ✓ → grounded). expectedFacts ["4 ember shards"] missing → helpfulness 0 → final 0. Hmm that's 0. Let me make expectedFacts two: ["the mirefen", "4 ember shards"] → helpfulness 0.5, faithfulness 1 → final 0.5 → assert finalScore === 0.5 (approx) and < faithfulness. ✓ Proves the min semantics.

Also test the harness suite: runSuite returns a report per scenario, finalScore = min — partially covered.

Now — expectedFacts "the mirefen" — normalize and strip "the"? containsFact on "the mirefen" in "the altar is in the Mirefen." lowercased: "the mirefen" substring ✓.

### Fixtures / Scenario Contents

`src/eval/fixtures.ts` (or `src/guide/fixtures.ts`? The sources are "provided as fixtures" for the product; the evaluation consumes them. Put wiki page fixtures in `src/eval/fixtures/wiki-pages.ts` and scenarios in `src/eval/scenarios.ts`. The guide service tests can import the wiki pages from the evaluation fixtures — that's fine, they're shared fixtures. Hmm, or put wiki pages in `src/guide/fixtures.ts` and evaluation imports from guide. Product owns fixtures; evaluation uses them. Let me do `src/guide/fixtures.ts` exporting `WIKI_PAGES` (3 pages) and `src/eval/scenarios.ts` composing them. Clean dependency direction: eval → guide.

Wiki pages (I'll finalize text — keeping sentences clean, with period-separated sentences):

Page ember-altar:
```
The Ember Altar stands at the heart of the Mirefen.
It demands 4 ember shards before it can be kindled.
Kindled, it burns cold and lights the way out of the swamp.
The altar was sealed long before the last survey.
```
Note: "Kindled, it burns..." — starts with a capitalized "Kindled" — fine.

Page mirefen:
```
The Mirefen is a flooded valley south of Ashbridge.
Ember shards grow on the pale reeds along the eastern bank.
The water is ankle-deep by day and deep by night.
Frost gates stand across the only path out.
```
Hmm "the Mirefen's eastern bank" — I dropped the possessive here; let me keep it as "along the Mirefen's eastern bank" so that redaction of the possessive is exercised. OK: "Ember shards grow on the pale reeds along the Mirefen's eastern bank."

Page duskfang:
```
The Duskfang Warden is a boss that guards the Ember Altar.
It drops a warden sigil after a clean defeat.
The warden sigil opens the gate behind the altar.
It patrols the reed beds after nightfall.
```

Now gate checks on candidate correct answers:

Scenario 1: q "How do I kindle the Ember Altar?"
Correct script: "The Ember Altar demands 4 ember shards before it can be kindled."
- Quantity (4, [ember, shards]): source ember-altar "demands 4 ember shards" → token window: 4, ember, shards ✓.
- Proper nouns: Ember, Altar (mid-sentence capitalized) → in source ✓.
- Content words: altar (5), demands (7), kindled (7) → all in source ✓ (100%).
✓ Grounded.

expectedFacts: ["4 ember shards"]. Planted: ["5 ember shards", "Moonblade"].
Lure script: "The Ember Altar requires 5 ember shards and a Moonblade to kindle."
- Quantity (5,[ember,shards]) ✗ → ungrounded. Proper "Moonblade" ✗. → drop → refusal → harness final 0.

Scenario 2 (hint): q "I have 2 ember shards so far. What do I do next?"
Correct script: "Ember shards grow on the pale reeds along the Mirefen's eastern bank. The Duskfang Warden guards the Ember Altar. You need 4 ember shards in total."
- Sentence 1: quantity? none. Proper: Ember (sentence start, not in COMMON_STARTERS → claim ✓ in source), Mirefen's → "Mirefen" ✓. Content: ember, shards, grow, pale, reeds, mirefen, eastern, bank → source has all ✓.
- Sentence 2: proper Duskfang, Warden, Ember, Altar ✓. Content: guards (6), duskfang? (8, in source ✓), warden ✓, altar ✓ → ✓.
- Sentence 3: quantity (4, [ember, shards]) ✓. Content: need (stopword), total (5) → "total" in source? Hmm! "in total" — "total" doesn't appear in any page. Content words: total (1) → 0/1 = 0% < 50% → ungrounded → drop!! Bad — my own correct script gets truncated. Fix: "You need 4 ember shards in all." — "all" (3 letters, <4 → not content) → content words: none → grounded ✓. Or make it "The altar needs all 4 ember shards." — "all 4": quantity regex: number 4 followed by word "shards" ✓ (4 shards). Content: altar, needs, shards, all? "all" is 3 letters → skip. All in source ✓. Let me use: "The altar needs all 4 ember shards." Wait "needs" vs source "demands" — "needs" (5) is a content word, in source? No! Source uses "demands". Content: altar ✓, needs ✗, shards ✓ → 2/3 = 67% ≥ 50% → pass ✓. OK but I prefer clean: "You need all 4 ember shards." → content words: (need is stopword, all is 3 letters) → none → grounded ✓ (no content words → pass; quantity ✓; no proper nouns).

  Hint redaction for scenario 2 with player's "2 ember shards":
  - Text: "Ember shards grow on the pale reeds along the Mirefen's eastern bank. The Duskfang Warden guards the Ember Altar. You need all 4 ember shards."
  - Names: Ember (in sentence 1 "Ember shards..." — "Ember" is part of the item name "Ember Shard"... my own-token rule: "ember" — is "ember" in a bucket list? Item list has "shard" but not "ember". Window: sentence 1 tokens [Ember, shards, grow, on, the, pale, reeds, along, the, Mirefen's, eastern, bank] — Ember at 0: window includes "shards" (item, distance 1) → "an unnamed item"?! But "Ember shards" is a quantity-ish name... redacting "Ember" → "an unnamed item shards grow on..." — bad. Hmm! Multi-word proper noun grouping: consecutive capitalized → "Ember shards"? "shards" is lowercase → group = just "Ember".

  Problem: lowercase item names. "ember shards" — the item name is effectively lowercase in the source. My redactor only redacts capitalized proper nouns → "Ember shards" keeps "Ember" (not redacted, because... wait, I just said the window makes it "an unnamed item"). Inconsistent. Let me reconsider.

  Option: redact only capitalized proper-noun phrases (names), don't redact lowercase content words. "ember shards" → "Ember shards" stays. Is revealing "ember shards" a spoiler? It's an item name... "must not reveal boss names, item locations, or quantities" — item locations yes, but item names themselves? The requirement lists boss names, item locations, quantities. Item names per se aren't forbidden! "must not reveal boss names, item locations, or quantities beyond what the player already mentioned." So: boss names (names of bosses), locations where items are, quantities. Item names OK.

  So the redaction: (a) boss names → hidden boss; (b) place names → secret place; (c) quantities → as noted. Item names can stay. That simplifies! The buckets: boss context → "a hidden boss"; place context → "a secret place"; else (item-ish or unknown) → don't redact (keep the name). Because item names aren't forbidden.

  Then "Ember shards" stays ✓. "Mirefen" → place → "a secret place" ✓. "Duskfang Warden" → boss → "hidden boss" ✓. "Ember Altar" — the altar is a place/structure; is revealing the altar a location spoiler? "item locations" — the altar is where... it's a place. In the hint: "The Duskfang Warden guards the Ember Altar." → if Ember Altar is kept: the player learns the boss guards the altar — location of the boss, not of an item... The requirement only forbids: boss names, item locations, quantities. The Ember Altar is neither a boss name nor an item location (it's the goal). Keep it — but wait, sentence context: "guards" (boss bucket) — with my per-noun own-token rule, "altar" is in the place list... if I keep item/neutral names (no redaction) and only redact boss/place, then Ember Altar → place? "altar" is in my place list → "a secret place": "The hidden boss guards a secret place." — spoiler-wise safe (hides altar name). Either way works. Let me keep "altar" in the place list → redact. Result: "The hidden boss guards a secret place." — nice hint.

  And "The warden sigil opens the gate behind the altar." — "sigil"? Capitalized "warden sigil" in source is lowercase — in an answer "The warden sigil opens the gate behind the altar." → no capitalized proper noun (The is start, rest lowercase) → no redaction → reveals "warden sigil" (item name — allowed) and "the gate behind the altar" (location-ish, but lowercase common noun — can't redact). Acceptable: the deterministic redactor targets names (capitalized) + quantities. I'll note the limitation in a comment. Fine.

  Redaction quantity: sentence 3 "You need all 4 ember shards." Player mentioned (2, [ember, shards]). Claim (4, [ember, shards]): 4 > 2 → replace "4" with "several": "You need all several ember shards." — "all several" is bad! The word "all" in front is... my script choice; let me make it "You need 4 ember shards in all." → hint: "You need several ember shards in all." ✓ reads fine.

  Verify grounded for "You need 4 ember shards in all.": quantity (4,[ember,shards]) ✓; content words: in? (2, no), all (3, no) → none → grounded ✓.

  So expected hint text for scenario 2:
  "Ember shards grow on the pale reeds along a secret place's eastern bank. The hidden boss guards a secret place. You need several ember shards in all."

  Wait, sentence 1: "Ember" — capitalized, own token not in bucket, window: nearest bucket word: "shards"? Is "shards" in the place list? No. Item list — but item bucket doesn't trigger redaction now. Place bucket words in sentence 1: "bank" (yes, place list), "eastern"? (I had east in the list; "eastern" — exact token match only: "eastern" ≠ "east" — should I include "eastern"? Let me include eastern/western/southern/northern in the place list). For "Ember" at index 0: window ±5: [shards, grow, on, the, pale, reeds] — no place word within 5. Sentence-level fallback: does the sentence contain a place word? bank (index 11) → yes → sentence priority → Ember → "a secret place"?? "a secret place shards grow on the pale reeds along a secret place's eastern bank." — double redaction, and "Ember shards" is an item name (allowed to reveal!) — wrong to redact.

  Hmm. So "Ember" as a capitalized first word of an item name is getting caught by the fallback. Fix: the fallback (sentence-level) should only apply if... hmm. Maybe the fallback should be "don't redact" (keep the name) — the safe direction for item names (allowed to reveal), but risky for boss names without a context word. Compromise: fallback = don't redact, but if the sentence contains a boss context word AND the name is a phrase that looks name-like...? Too clever.

  Simpler: drop the sentence-level fallback; classification = own-token bucket OR window (±5) bucket; if neither → keep (no redaction). For Ember in scenario 2 sentence 1: window ±5 → no place word (bank at distance 11) → keep "Ember" ✓. Mirefen's: window includes "bank" at distance 2 → place ✓. Duskfang Warden: own token "warden" → boss ✓. Ember Altar (sentence 2): own token "altar" → place ✓ → "a secret place" (preceded by "the" → "the secret place").

  Result hint: "Ember shards grow on the pale reeds along a secret place's eastern bank. The hidden boss guards a secret place. You need several ember shards in all."

  Check constraint: boss name hidden ✓, location hidden ✓ (Mirefen gone, "eastern bank" is generic), quantity: player knew 2; hint reveals "several" (not the total 4) ✓.

  Also, hint must be derived from the grounded full answer — the test can assert that hintText === redactToHint(fullText, question) using the exported redactToHint and the llm called once.

  Also verify "several" substitution: the word "4" in "4 ember shards" → replace with "several". Also handle word numbers: "four" → "several".

  Edge: "You need 4 ember shards in all." — player mentioned "2 ember shards" in the question. My player-quantity extraction from the question: "I have 2 ember shards so far. What do I do next?" → claim (2, [ember, shards]) ✓.

  Rule: for claim (N, unit): if player has a claim (M, unit') with the same unit (unit words match? or share a unit noun) AND N ≤ M → keep; else replace N with "several" (digits) / "several" (word-number → "several").
  Unit match: unit arrays equal? (4,[ember,shards]) vs (2,[ember,shards]) ✓. If unit differs (e.g., player said "2 sigils") → different resource → reveal is "beyond what they mentioned" → redact. So require unit match (word sets, order-agnostic? keep it simple: exact array equality after normalization). Hmm "2 ember shards" from question: my quantity regex captures number + up to 3 words: "2 ember shards so far" → captures (2, [ember, shards, so])?? Ugh — "so" is a stopword! I need to trim trailing stopword/grammar words from the unit: filter the captured words by a small STOP list (so, far, the, a, in, of, for, to, and, more, left, remaining...). Let me trim: keep words until one is in {so, far, and, or, of, the, a, an, in, on, at, to, for, with, my, your, more, left, yet, already, total, all}? Hmm "all 4 ember shards" — "all" comes before the number, fine. After "shards": stop. Let me trim the unit at the first word in the trim list [the, a, an, of, in, on, at, to, for, with, and, or, so, far, more, left, yet, your, my, you, i, is, are, was, were, be, been, need, needs, needed, have, has, had]. "2 ember shards so" → trim at "so" → [ember, shards] ✓. "5 ember shards and a Moonblade" → unit [ember, shards] ✓ (trim at "and").

  But careful with the source window matching: source "demands 4 ember shards before it can be kindled" — unit [ember, shards] found after 4 ✓.

  Bare numbers (no unit words): claim (N, []) → grounded if N appears in source (after normalization). In the hint: bare number → always redact? "quantities beyond what the player mentioned" — a bare number like "level 5"... if the player mentioned "level 5" in the question → keep. Rule: bare claim (N,[]): if player mentioned bare (N,[]) → keep; else replace with "a number"? "level a number" is weird but rare; let me use "several" for bare too? "level several"? Hmm. Let me replace bare numbers with "some" → "level some"? Also weird. Honestly, bare numbers in my scenarios: none in the answer. I'll implement: bare number → redact to "a number" and note. Well, whatever, fine. Actually wait — safer to not overthink: in the hint, replace bare numbers with "a number". OK.

  Word numbers in answers: "four ember shards" → claim (4, [ember, shards]) after normalization → redact "four" → "several" ✓. I'll implement word-number replacement in redaction: find word-number tokens and apply the same rule (convert to digit to compare).

### Refusal Edge: "2–3 wiki pages" — the service accepts 1+ sources; fixtures provide 3. Fine.

### Prompt Builder

```ts
export interface LlmPrompt {
  question: string;
  sources: WikiSource[];
}
```
The service builds the prompt; the scripted fake matches on prompt.question. Real client would serialize into a string. To make the fake realistic, maybe `complete(prompt: LlmPrompt): Promise<string>`.

ScriptedLlmClient:
```ts
export interface ScriptEntry { match: RegExp | string; reply: string; }
export class ScriptedLlmClient implements LlmClient {
  private calls: LlmPrompt[] = [];
  constructor(private readonly script: ScriptEntry[]) {}
  async complete(prompt: LlmPrompt): Promise<string> {
    this.calls.push(prompt);
    for (const e of this.script) {
      const m = typeof e.match === 'string' ? prompt.question.includes(e.match) : e.match.test(prompt.question);
      if (m) return e.reply;
    }
    throw new Error(`ScriptedLlmClient: no scripted reply for question: ${prompt.question}`);
  }
  get callCount() { return this.calls.length; }
}
```
The callCount assertion proves "no re-prompting" for hint mode ✓ (callCount === 1).

### Package Setup Files

- `package.json`: name "grounded-guide" or similar; type module; scripts: test (vitest run), typecheck (tsc --noEmit); devDeps: typescript, vitest, @types/node. Versions: typescript ^5.5, vitest ^2.x, @types/node ^20. Keep minimal.
- `tsconfig.json`: strict, module NodeNext, target ES2022, moduleResolution NodeNext, outDir dist, rootDir ., include src, test. ESM + NodeNext → relative imports need `.js` extension! Ugh. `"type": "module"` + NodeNext → imports like `./guide.service.js`. Vitest handles `.js` → `.ts` resolution fine (vite-node). Yes, Vitest supports this pattern (standard in ESM TS). I'll use `.js` extensions in relative imports.
- `vitest.config.ts`: define a test environment node, include test/**/*.spec.ts. Minimal:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.spec.ts'] } });
```
- No NestJS/Prisma — the task has no API/DB. The conventions mention them as the stack, but "do exactly what the task asks" + no API surface in the task → plain TS. I'm comfortable; the conventions' layout for `src/<feature>` and test paths I'll still follow.

Wait — should I double-check whether the convention forces NestJS DI? "NestJS for the API" — there is no API in this task (no mention of endpoints). The answer pipeline is a library + evaluation harness. Forcing NestJS (modules, controllers with no route) would be fabricating files. The discipline rule wins. Also, "service" as a plain class with constructor injection satisfies "injectable LLM client".

Hmm, one more consideration: the convention is `src/<feature>/<feature>.service.ts` — I'll name files: `src/guide/guide.service.ts`, `src/guide/grounder.ts` (hmm — the naming convention says `kebab-case.role.ts`; the role: service, repository, controller... grounder/redactor aren't enumerated roles; "TS file: kebab-case.role.ts" — is `grounding.ts` OK? The pattern suggests role suffix. Let me name: `guide.service.ts`, `guide.types.ts`, `guide.grounder.ts`? Not a standard role but kebab + role-ish. Alternatively, put the grounder inside the service file — but the evaluation needs to import the grounding check → separate module is cleaner. Let me do:
- `src/guide/guide.types.ts`
- `src/guide/grounder.ts` — hmm. I think I'll keep `grounder.ts` and `redactor.ts`; the convention examples enumerate controller/service/repository, not an exhaustive closed set ("Layers — no exceptions" is about the layering rule; the naming line says TS file: kebab-case.role.ts — grounder is arguably a role). To be safe, I can do `grounding.grounder.ts`? Ugly. I'll keep `src/guide/grounder.ts` and `src/guide/redactor.ts` — kebab-case, role noun. Justifiable.

Actually, the convention example pattern `<feature>.role.ts` implies the prefix = feature. Files: `guide.service.ts`, `guide.types.ts`, `guide.fixture.ts` (fixtures), `guide.llm-client.ts` (interface + scripted client)? Hmm, the scripted client is a test double... but sanctioned by the task as the fake client. I'll put the `LlmClient` interface in guide.types.ts, and the ScriptedLlmClient in `src/guide/scripted-llm-client.ts`.

Evaluation feature:
- `src/eval/eval.types.ts`? Or `scenario.ts`, `judges.ts`, `eval-harness.ts`. The feature is "eval" → `eval.scenario.ts`? Hmm "eval" as a directory: `src/eval/scenarios.ts`, `src/eval/judges.ts`, `src/eval/harness.ts`. Kebab + role-ish. OK:
  - `src/eval/harness.ts` (runScenario/runSuite)
  - `src/eval/judges.ts` (helpfulnessJudge, faithfulnessJudge)
  - `src/eval/scenarios.ts` (golden scenarios)

Tests: `test/guide.spec.ts`, `test/eval.spec.ts`.

### Let me now write the actual code, carefully, checking each regex and logic path.

#### guide.types.ts

```ts
export type AnswerMode = 'full' | 'hint';

export interface WikiSource {
  id: string;
  title: string;
  text: string;
}

export type AnswerStatus = 'answered' | 'refused';

export interface GuideAnswer {
  status: AnswerStatus;
  mode: AnswerMode;
  text: string;
  /** Exact refusal phrase; present only when status is 'refused'. */
  refusalReason: string | null;
  /** Sentences the grounding gate dropped. */
  droppedSentences: string[];
  /** IDs of sources that grounded at least one kept sentence. */
  sourcesUsed: string[];
}

export interface LlmPrompt {
  question: string;
  sources: WikiSource[];
}

export interface LlmClient {
  complete(prompt: LlmPrompt): Promise<string>;
}

export const REFUSAL_MESSAGE = 'not covered by my sources';
```

#### grounder.ts

Let me write this carefully.

```ts
import type { WikiSource } from './guide.types.js';

export interface GroundingVerdict {
  grounded: boolean;
  /** Human-readable reasons the sentence was not grounded (empty when grounded). */
  reasons: string[];
}

const WORD_NUMBERS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13',
  fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18',
  nineteen: '19', twenty: '20',
};

const CONTENT_STOP_WORDS = new Set([...long list...]);

const COMMON_SENTENCE_STARTERS = new Set(['The','A','An','It','This','These','That','Those','If','When','While','You','Your','He','She','They','We','I','Yes','No','So','And','But','Or','To','Is','Are','Was','Were','Do','Does','Did','Can','Could','Should','Would','May','Might','Note','Tip','Remember','In','On','At','With','Without','After','Before','Once','Until','Kindled']);
```

Hmm "Kindled" in my page text is a sentence start in the source, but in an answer? If the LLM says "Kindled, the altar burns..." — "Kindled" as a starter → not in the whitelist → treated as a proper-noun claim → "kindled" in source ✓ grounded anyway. If it's not in source → drop (probably correct). Should I add "Kindled" to the whitelist? Not needed — it's a real word that will be in source if legitimate. Leave it out of the whitelist (it'll be checked against source — which is actually desirable).

Tokenization:

```ts
function tokenize(text: string): string[] {
  return text.split(/[^A-Za-z0-9''-]+/).filter(Boolean);
}
```
Keep apostrophes and hyphens inside tokens. Lowercase with .toLowerCase().

Normalization for matching:

```ts
function normalize(text: string): string {
  return text.toLowerCase();
}
```
Plus word-number substitution in a token stream:

```ts
function numberizeToken(t: string): string {
  const lower = t.toLowerCase();
  return WORD_NUMBERS[lower] ?? lower;
}
```

Source matching: build a normalized source token array (numberized) and a normalized source string (lowercased) for word-boundary containment of proper nouns:

Actually for proper nouns: a claim "Mirefen" should match "Mirefen's" in the source: I'll strip trailing "'s" from tokens everywhere before comparing. Token "mirefen's" → strip "'s" → "mirefen" ✓. So a token-normalization function:

```ts
function cleanToken(t: string): string {
  let s = t.toLowerCase();
  if (s.endsWith("'s") || s.endsWith("’s")) s = s.slice(0, -2);
  s = WORD_NUMBERS[s] ?? s;  // hmm order: strip ’s first, then word number
  return s;
}
```
Wait "shards'" (plural possessive)? Doesn't exist. Plurals: "shards" vs claim "shard"? Quantity units come from the same phrase, so consistent. Proper nouns: singular forms. OK.

Build a per-source lookup:
```ts
interface SourceIndex {
  tokens: string[];      // cleaned tokens, in order
  set: Set<string>;      // cleaned token set
}
function indexSources(sources: WikiSource[]): SourceIndex[] {
  return sources.map(s => {
    const tokens = tokenize(s.text).map(cleanToken);
    return { tokens, set: new Set(tokens) };
  });
}
```

Proper noun extraction:

```ts
export interface ProperNounClaim { phrase: string; words: string[]; }

function extractProperNouns(sentence: string): ProperNounClaim[] {
  const rawTokens = tokenize(sentence); // keep case
  // positions: first-token flag
  const claims: ProperNounClaim[] = [];
  let i = 0;
  while (i < rawTokens.length) {
    const t = rawTokens[i];
    if (!/^[A-Z][A-Za-z''-]*$/.test(t)) { i++; continue; }
    // group consecutive capitalized
    let j = i;
    const words: string[] = [];
    while (j < rawTokens.length && /^[A-Z][A-Za-z''-]*$/.test(rawTokens[j])) {
      words.push(rawTokens[j]); j++;
    }
    const isFirst = i === 0;
    // filter words: drop leading common starters if first token
    const filtered = words.filter((w, k) => {
      if (k === 0 && isFirst && COMMON_SENTENCE_STARTERS.has(w)) return false;
      if (k > 0 && COMMON_SENTENCE_STARTERS.has(w)) return false; // e.g., "Warden The"? rare
      return true;
    });
    if (filtered.length > 0) {
      claims.push({ phrase: filtered.join(' '), words: filtered });
    }
    i = j;
  }
  return claims;
}
```

Wait, edge: sentence "The Duskfang Warden guards..." → token 0 "The" is capitalized → group = [The] (next "Duskfang"? "The" followed by "Duskfang" — both capitalized → group = ["The", "Duskfang", "Warden"]!! Consecutive! i=0: t="The" is capitalized; the group consumes The, Duskfang, Warden. isFirst → filtered drops k=0 "The" (in starters) → words ["Duskfang","Warden"] ✓ good. But what if the sentence starts "Ashbridge is..."? Group [Ashbridge] → claim ✓.

Sentence start "Ember shards grow..." → "Ember" is capitalized, next "shards" is lowercase → group [Ember] → claim ✓ (Ember is in source).

Mid-sentence "a Moonblade to kindle" → "Moonblade" capitalized mid-sentence → claim → not in source → ungrounded ✓.

What about "You need 4 ember shards." — no capitalized ✓.

What about all-caps "I"? "I" is in starters; mid-sentence "I" → filtered by k>0 rule → skipped ✓.

Edge: possessive at the head of a group "Mirefen's" — regex /^[A-Z][A-Za-z''-]*$/ matches "Mirefen's" ✓ (apostrophe allowed). Claim word "Mirefen's" → cleanToken → "mirefen" ✓.

Quantity claims:

```ts
export interface QuantityClaim {
  raw: string;       // e.g. "5 ember shards" (original text, for display)
  number: string;    // normalized digit string, e.g. "5"
  numberRaw: string; // original token, e.g. "five"
  unit: string[];    // cleaned unit words, e.g. ["ember","shards"]
}

const UNIT_TRIM = new Set(['the','a','an','of','in','on','at','to','for','with','and','or','so','far','more','left','yet','your','my','you','i','is','are','was','were','be','been','need','needs','needed','have','has','had','its','it','this','that','them','then','all','about','around','over','under']);
```
Hmm "all" — "4 ember shards all"? Doesn't exist. But note: "all 4" — "all" is before the number. Trimming only affects after. OK, but let me remove "all" from the trim to be safe? "shards all around" → "all" trimmed is fine (stop-ish). Keep.

```ts
const QTY_RE = /(?<![\w.'])([0-9]+(?:\.[0-9]+)?|[a-z]{2,8})(\s+(?:[a-z][a-z'-]*)){0,3}(?!\S)/gi;
```
Hmm, lookbehind + variable groups is getting hairy. Let me do it manually on tokens instead — more robust:

```ts
function extractQuantities(sentence: string): QuantityClaim[] {
  const rawTokens = tokenize(sentence);
  const claims: QuantityClaim[] = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const t = rawTokens[i];
    let number: string | null = null;
    if (/^[0-9]+(\.[0-9]+)?$/.test(t)) number = t;
    else if (WORD_NUMBERS[t.toLowerCase()]) number = WORD_NUMBERS[t.toLowerCase()];
    else continue;
    const unit: string[] = [];
    for (let k = 1; k <= 3; k++) {
      const u = rawTokens[i + k];
      if (!u || !/^[a-z][a-z'-]*$/i.test(u)) break;   // stop at non-word or capitalized? hmm capitalized unit? "5 Ember Shards"? unlikely; allow capitalized? stop.
      const cu = cleanToken(u);
      if (UNIT_TRIM.has(cu)) break;
      unit.push(cu);
    }
    claims.push({ raw: rawTokens.slice(i, i + 1 + unit.length).join(' '), number, numberRaw: t, unit });
  }
  return claims;
}
```
Wait `/^[a-z][a-z'-]*$/i` — the i flag makes it match capitalized too; I said I stop at capitalized. Let me use without i: /^[a-z][a-z'-]*$/ → lowercase only. But tokens keep original case; "4 ember shards" is fine. If the answer says "4 Ember Shards" (capitalized item) → unit [] → bare number claim → grounded only if "4" appears in source... weak but OK. Hmm, actually let me allow capitalized unit words too (a game item "Ember Shards") — capture and clean. Risk: "You need 5 Duskfang" → unit [duskfang] → check if "duskfang" is in a window of "5" in source — no → ungrounded ✓ (good, catches that). If the source really says "5 Duskfang" (odd), it would pass. Let me allow: /^[A-Za-z][A-Za-z'-]*$/.

Grounding of a quantity claim in a source index:

```ts
function quantityInSource(claim: QuantityClaim, idx: SourceIndex): boolean {
  if (claim.unit.length === 0) {
    return idx.set.has(claim.number);
  }
  for (let i = 0; i < idx.tokens.length; i++) {
    if (idx.tokens[i] !== claim.number) continue;
    let u = 0;
    const end = Math.min(idx.tokens.length, i + 1 + claim.unit.length + 2);
    for (let j = i + 1; j < end && u < claim.unit.length; j++) {
      if (idx.tokens[j] === claim.unit[u]) u++;
    }
    if (u === claim.unit.length) return true;
  }
  return false;
}
```
Window: allow up to 2 interleaved tokens? The inner loop `end = i+1+unit.length+2` allows a few extras. "4 ember shards" source: i at "4", j: "ember" ✓ u1, "shards" ✓ u2 → true ✓. Lie "5 ember shards": source only has "4" → no i → false ✓.

Proper noun grounding: all cleaned words in the set:
```ts
function properNounInSource(claim: ProperNounClaim, idx: SourceIndex): boolean {
  return claim.words.every(w => idx.set.has(cleanToken(w)));
}
```
Hmm multi-word: "Duskfang Warden" → both words in set. OK. (A phrase might be partially in the source... fine.)

Content words:

```ts
function contentWords(sentence: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokenize(sentence)) {
    const c = cleanToken(t);
    if (c.length < 4) continue;
    if (!/^[a-z]+$/.test(c)) continue;   // digits / hyphens / apostrophes → not content
    if (CONTENT_STOP_WORDS.has(c)) continue;
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}
```

isSentenceGrounded:

```ts
export function isSentenceGrounded(sentence: string, sources: WikiSource[]): GroundingVerdict {
  const indices = indexSources(sources);
  const reasons: string[] = [];
  if (sentence.trim().length === 0) return { grounded: true, reasons: [] };

  for (const q of extractQuantities(sentence)) {
    if (!indices.some(idx => quantityInSource(q, idx))) {
      reasons.push(`quantity "${q.raw}" is not stated in the sources`);
    }
  }
  for (const p of extractProperNouns(sentence)) {
    if (!indices.some(idx => properNounInSource(p, idx))) {
      reasons.push(`name "${p.phrase}" does not appear in the sources`);
    }
  }
  const cw = contentWords(sentence);
  if (cw.length > 0) {
    const pool = new Set<string>();
    for (const idx of indices) for (const t of idx.set) pool.add(t);
    const hits = cw.filter(w => pool.has(w));
    if (hits.length / cw.length < 0.5) {
      reasons.push('majority of its content words are absent from the sources');
    }
  }
  return { grounded: reasons.length === 0, reasons };
}
```

Wait — a subtlety: a proper noun like "Kindled" (a sentence-start in my page). In an answer "Kindled, the altar glows." → claim "Kindled" → "kindled" in source ✓ (page 1 has "before it can be kindled" ✓).

CONTENT_STOP_WORDS — needed: the, and, that, this, these, those, with, from, your, yours, you, have, has, had, are, was, were, been, being, can, could, would, should, will, shall, may, might, must, need, needs, needed, do, does, did, about, before, after, above, below, under, over, then, than, when, where, what, which, who, whom, how, why, here, there, out, off, up, down, in, on, at, to, for, of, a, an, it, its, they, them, their, he, she, his, her, our, us, we, i, if, but, or, nor, so, not, no, yes, all, any, both, each, few, more, most, other, some, such, only, own, same, too, very, just, also, way, one? (one is a word number — after cleanToken, "one" → "1" → not /^[a-z]+$/ → excluded ✓), kind? "the kind of..." rare. Let me also add: make, makes, made, take, takes, taken, get, gets, got, going, come, comes, back, first, last, new, old, long, short, little, big, many, much, still, even, ever, never, always, often, once, every, every? (every → covered by length 5). OK, I'll write a solid list.

Wait, "way" — "lights the way out of the swamp" — "way" is in the page and in an answer → either way, fine.

One more: "glows"/"glow" vs source "lights" — paraphrase verb: "the altar glows" → content: altar ✓, glows ✗ → 1/2 = 0.5 ≥ 0.5 pass ✓. Good, threshold 0.5 is lenient enough.

Sentence split:

```ts
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}
```
Lookbehind is OK in Node 20. Also handle text that already ends with a period — fine.

Hmm, one issue: abbreviations like "e.g." don't exist in my content. OK.

#### guide.service.ts

```ts
import { REFUSAL_MESSAGE, type AnswerMode, type GuideAnswer, type LlmClient, type LlmPrompt, type WikiSource } from './guide.types.js';
import { isSentenceGrounded, splitSentences } from './grounder.js';
import { redactToHint } from './redactor.js';

export class GuideService {
  constructor(private readonly llm: LlmClient) {}

  async answer(question: string, sources: WikiSource[], mode: AnswerMode = 'full'): Promise<GuideAnswer> {
    // A single LLM call regardless of mode; hint mode is post-processing (no re-prompt).
    const prompt: LlmPrompt = { question, sources };
    const raw = await this.llm.complete(prompt);
    const sentences = splitSentences(raw);

    const kept: string[] = [];
    const dropped: string[] = [];
    const sourcesUsed = new Set<string>();

    if (sources.length > 0) {
      for (const sentence of sentences) {
        const verdict = isSentenceGrounded(sentence, sources);
        if (verdict.grounded) {
          kept.push(sentence);
          for (const s of sources) sourcesUsed.add(s.id);  // hmm — I want the sources that actually grounded it
        } else {
          dropped.push(sentence);
        }
      }
    }
    ...
  }
}
```

sourcesUsed: I claimed "sources that grounded at least one kept sentence" — to do it precisely, I'd need per-source grounding info. Let me have isSentenceGrounded return the supporting source IDs? The sources are passed as a list with IDs. Let me extend the verdict: `supportingSourceIds: string[]` — computed: for each claim, record which source index satisfied it; the sentence is grounded by any source that supports... hmm, a simpler semantics: for each source individually, check if the sentence is fully grounded against that source alone; sourcesUsed = those where the sentence would be grounded. That's n evaluations (n = 2–3) — fine.

```ts
for (const source of sources) {
  const v = isSentenceGrounded(sentence, [source]);
  if (v.grounded) sourcesUsed.add(source.id);
}
```
And the overall check against all sources (a sentence could combine facts from two pages — "The Warden guards the Ember Altar." spans page 3 (warden) + page 1 (altar)... actually page 3 has both. But in general, union grounding is right). So: groundedOverall = isSentenceGrounded(sentence, sources). Kept if groundedOverall. sourcesUsed = per-source check.

Zero sources → all dropped → refused ✓. Also guard: if sources.length === 0 → skip to refusal, but I still call the LLM? No sources, why call? But the contract answer(question, sources, mode) — calling the LLM with no sources and then refusing is fine and simple; or short-circuit refusal without calling the LLM. Which is better? "Grounded only in those pages" — no pages → can't ground → refuse; calling the LLM is wasteful, and the scripted fake would throw "no scripted reply" in tests. Let me short-circuit: if sources.length === 0 → return refused immediately (no LLM call). Test: zero sources → refused, and fake isn't called (no throw). But the fake needs a script... I'd pass a ScriptedLlmClient with a dummy script; the call never happens → no throw ✓.

Hmm wait, but should the LLM be called first and then refusal? The product flow: ask the LLM, gate the output. Without sources, the gate can't ground anything. Short-circuiting is defensible and testable. Let me do that with a comment.

Refusal object:
```ts
if (kept.length === 0) {
  return {
    status: 'refused',
    mode,
    text: '',
    refusalReason: REFUSAL_MESSAGE,
    droppedSentences: dropped,
    sourcesUsed: [],
  };
}
const fullText = kept.join(' ');
const text = mode === 'hint' ? redactToHint(fullText, question) : fullText;
return { status: 'answered', mode, text, refusalReason: null, droppedSentences: dropped, sourcesUsed: [...sourcesUsed] };
```

#### redactor.ts

```ts
import type { AnswerMode } from './guide.types.js';  // maybe unused
import { ... } from './grounder.js';  // need extractQuantities, extractProperNouns, tokenize...
```

I'll need from the grounder: tokenize? (private), extractProperNouns (private?), extractQuantities, cleanToken... Let me export what's needed from the grounder: `extractProperNounClaims`, `extractQuantityClaims`, `splitSentences`, plus maybe internal `tokenize`. I'll export: `splitSentences`, `isSentenceGrounded`, `extractQuantityClaims`, `extractProperNounClaims`, and the claim types.

Redactor design:

```ts
const BOSS_HINT = 'a hidden boss';
const PLACE_HINT = 'a secret place';
const ITEM_HINT = 'an unnamed item';  // do I redact item names? Decided: item names aren't forbidden → don't redact item bucket.
```
So buckets: boss + place only.

```ts
const BOSS_WORDS = new Set(['boss','guardian','warden','foe','enemy','champion','fight','defeat','slay','slain','kill','killed','battle','duel','encounter','guard','guards','guarded','patrols','patrol','hound','specter','lich','beast','brute','sentinel','golem']);
const PLACE_WORDS = new Set(['place','location','region','area','zone','cave','temple','swamp','forest','mountain','dungeon','keep','tower','fen','marsh','valley','ruins','altar','shrine','gate','path','door','room','bank','shore','cliff','hill','north','south','east','west','eastern','western','southern','northern','beyond','near','behind','inside','under','above','valley','reeds'? no]);
```
"reeds"? A generic word, skip.

Redaction algorithm:
1. Split the text into sentences (we have them; but redactToHint takes the full text + question — I'll split again; fine).
2. For each sentence:
   a. Quantity redaction (string-level): for each claim from extractQuantityClaims(sentence) → decide keep/redact based on player quantities → replace in the sentence string. To do the replacement, I need to know the original span. extractQuantityClaims should return the raw token sequence; I'll do the replacement on a token array, not regex on the string! Better: work with tokens: tokenize(sentence) → transform tokens → rejoin. But rejoining tokens loses original spacing/punctuation (commas, colons, apostrophes are stripped by the tokenizer!). Rejoining from tokens would drop punctuation. No good for a display text.

   Alternative: operate on the string with careful replacement, using the raw claim substring. Claim.raw is the original token sequence joined with single spaces — but the original might have different spacing; I'll assume single spaces (I control the scripts; real LLM output is single-spaced). Safer: do a sequential regex replacement with a word-boundary pattern built from the raw number + unit words, replacing only the number token, left to right, with a used-mark to avoid double-replacement.

   Let me implement quantity redaction string-based:
   ```ts
   function redactQuantities(sentence: string, playerClaims: QuantityClaim[]): string {
     let out = sentence;
     for (const claim of extractQuantityClaims(sentence)) {
       const keep = playerClaims.some(p => sameUnit(p.unit, claim.unit) && Number(p.number) <= Number(claim.number));
       // bare number: unit empty → keep only if player mentioned the same bare number? sameUnit([],[]) true → Number(p.number) <= claim.number — player bare "5" ≤ claim "4"? 5≤4 false → redact. Player "3" claim "4" → 3≤4 keep → reveals 4 beyond 3?? Bare numbers: "I'm on level 3" and the answer "level 4" — revealing 4 is beyond what they mentioned → should redact. So bare-number rule: keep only if equal? N === M. Hmm, but for units: player has 2 shards, needs 4 → revealing "4" is beyond → redact. Wait wait — the direction is reversed!
   ```

   Hold on. Let me re-derive: "must not reveal quantities beyond what the player already mentioned." The player mentioned M. The answer reveals N. If N > M → reveal goes beyond what they know → redact. If N ≤ M → the player already knows at least N of them → revealing N is not beyond → keep. Yes, that's what I wrote: keep if M ≥ N. "I have 2 shards" (M=2), answer "4 shards" (N=4): 2 ≥ 4? No → redact ✓. "I have 4 shards", answer "4 shards" → 4 ≥ 4 keep ✓. "I have 4", answer "3 shards in one pile"? 4≥3 keep — fine.

   Bare numbers: player "level 3" (bare M=3), answer "level 5": 3≥5 no → redact ✓. Answer "level 3": 3≥3 keep ✓. So the same rule works for bare, as long as sameUnit([],[]) → true. But danger: player bare "2" (from "2 days?") vs answer quantity "4 shards" — units: [] vs [ember, shards] → not same → redact ✓ good.

   And player claim from the question "I have 2 ember shards so far" → (2,[ember,shards]) ✓ trim "so" ✓.

   sameUnit: arrays equal element-wise (already cleaned)? (ember,shards) vs (ember,shards) ✓.

   Replacement: the token of the number in the sentence: numberRaw (e.g., "4" or "four"). Replace the first occurrence of numberRaw as a word... but multiple claims could share a number ("4 ... and 4 ..."). Handle sequentially: for each claim in extraction order, find the claim's raw substring in `out`, replace its number part with "several", then continue searching after that index? Claims don't overlap; sequential replace of `out.replace(new RegExp(`\\b${escape(numberRaw)}\\b`, 'i'), replacement)` — the first occurrence. If two identical claims "4 shards ... 4 shards" and one should keep (player has 4) → both keep, no replace ✓. If both redact → first replace, then second: the second claim's raw contains "4" — after first replace, "4" appears once more → replace the first remaining ✓. Since we process in extraction order, the order holds. OK.

   Replacement word: digit → "several"; word number → "several" too (reads: "several ember shards") ✓. But "You need all several..." — I fixed the script to avoid.

   Also — should I reveal a *reduced* quantity? No, just "several".

   b. Name redaction: extractProperNounClaims(sentence) → for each claim (phrase, words, and position?), classify → build a replacement string; replace the phrase in the sentence with an article-aware placeholder.

   Classification: I need token positions to do a window scan. Let me have extractProperNounClaims return tokens + indices:
   ```ts
   export interface ProperNounClaim {
     phrase: string;   // "Duskfang Warden"
     words: string[];  // cleaned ["duskfang","warden"]
     rawWords: string[]; // original casing ["Duskfang","Warden"]
     start: number;    // index in raw tokens
     end: number;      // exclusive
   }
   ```
   tokenizeRaw(sentence) → tokens (with case). Claim start/end are token indices.

   Classification:
   ```ts
   function classify(claim, rawTokens): 'boss' | 'place' | null {
     // 1) own tokens
     for (const w of claim.words) {
       if (BOSS_WORDS.has(w)) return 'boss';
       if (PLACE_WORDS.has(w)) return 'place';
     }
     // 2) window ±5 tokens
     const from = Math.max(0, claim.start - 5);
     const to = Math.min(rawTokens.length, claim.end + 5);
     for (let i = from; i < to; i++) {
       if (i >= claim.start && i < claim.end) continue;
       const w = cleanToken(rawTokens[i]);
       if (BOSS_WORDS.has(w)) return 'boss';
       if (PLACE_WORDS.has(w)) return 'place';
     }
     return null; // keep name (item names and neutral names are allowed in hints)
   }
   ```
   Wait — the order of own-token checks: "Warden" is boss; but consider "Gate Warden"? boss anyway ✓. A name that's both boss and place word? Unlikely; boss checked first.

   Hmm — a problem: window scan could misclassify: "The Duskfang Warden guards the Ember Altar." For "Ember Altar": own tokens: ember (no), altar (place!) → 'place' ✓ (own-token short-circuit). For "Duskfang Warden": own: duskfang no, warden boss → 'boss' ✓.

   "Ember shards grow on the pale reeds along the Mirefen's eastern bank." — claims: "Ember" (start 0) and "Mirefen" (from "Mirefen's", cleaned). Ember: own no; window ±5: tokens [shards, grow, on, the, pale, reeds] cleaned: shards? not in bucket (shards not in boss/place — I removed the item bucket) → grow no, on no, the no, pale no, reeds no → null → keep ✓. Mirefen: own no; window: [reeds, along, the, eastern, bank] → "eastern" place ✓ (within left 5? Mirefen's index: let me count tokens: [Ember0, shards1, grow2, on3, the4, pale5, reeds6, along7, the8, Mirefen's9, eastern10, bank11]. Mirefen start 9 end 10. Window from 4 to 15 → includes eastern10 ✓ bank11 ✓ → 'place' ✓.)

   Replacement with article: I need the preceding token: rawTokens[claim.start - 1].
   ```ts
   function placeholderFor(kind, preceding): { search: string; replace: string } {
     const withArticle = kind === 'boss' ? 'a hidden boss' : 'a secret place';
     const bare = kind === 'boss' ? 'hidden boss' : 'secret place';
     const prev = preceding ? preceding.toLowerCase() : '';
     if (prev === 'a' || prev === 'an') {
       // replace "a Duskfang Warden" → "a hidden boss"
       return { search: `${prev} ${claim.phrase}`, replace: withArticle };
     }
     if (prev === 'the') {
       return { search: claim.phrase, replace: bare };
     }
     return { search: claim.phrase, replace: withArticle };
   }
   ```
   Wait, possessive: "Mirefen's" — the claim's phrase is built from rawWords: I need to include "'s" in the phrase for replacement. My proper noun extraction groups raw tokens: "Mirefen's" is one raw token. If I build phrase from rawWords → "Mirefen's" ✓. words (cleaned) → ["mirefen"] ✓. So phrase = rawWords.join(' ') = "Mirefen's". Replace "Mirefen's" with "a secret place" → "along a secret place eastern bank"?? No — "'s" belongs: "the Mirefen's eastern bank" → should become "a secret place's eastern bank"! Handle: if phrase ends with "'s" → replace with placeholder + "'s". And the article logic: "the Mirefen's" → "the secret place's". ✓ Let me handle: possessive suffix = phrase.endsWith("'s") ? "'s" : ''; base phrase without "'s".

   Order of replacements within a sentence: process claims in descending order of position? If I do string replace sequentially, "the Duskfang Warden guards the Ember Altar" — replace "the Duskfang Warden" (search includes "the ") first — indices shift, but I do a sequential string replace (left to right, and phrases don't overlap) so it's fine. But danger: phrase "Ember" (a single word) — `out.replace('Ember', ...)` with a plain string would replace the first "Ember" — if the earlier claim already replaced its own... In the scenario 2 sentence 1, the "Ember" claim is classified null (kept) → no replace ✓. In a sentence with "Ember Altar" — the grouping: "Ember Altar" are consecutive capitals → one claim [Ember, Altar] ✓ not two. Good — the grouping prevents partial collisions.

   But a single-word "Ember" claim elsewhere (e.g., "Ember shards...") — if it were classified place (it isn't) — the string replace of "Ember" would also hit "Ember" in "Ember Altar"... I replace in extraction order and only classified ones; to be safe, use a word-boundary regex and only replace the first occurrence. OK.

   Use `out = out.replace(new RegExp('(^|[^A-Za-z])' + escapeRe(phrase), ...)` — hmm, capture group. Simpler: `out.replace(escapeRe(searchPhrase), replace)` — replace the first occurrence of the exact phrase (with preceding "the "/"a " if applicable). Since I process claims in document order and each claim's phrase text at that position hasn't been modified yet (earlier replacements are at earlier positions), the first occurrence = the claim's position ✓ (as long as no earlier replacement introduced a phrase string — it introduces lowercase placeholders so it doesn't).

   Edge: "the" prefix — sentence "The Duskfang Warden..." at sentence start: preceding token "The" (capitalized, at index 0 — wait "The" is index 0, claim is index 1). prev.toLowerCase() === 'the' ✓ → replace "Duskfang Warden" with "hidden boss" → "The hidden boss guards..." ✓ (preserves the original "The" capitalization).

   c. Rejoin the sentence.

3. Return the joined text.

redactToHint signature: `redactToHint(groundedFullText: string, question: string): string`.
Player claims: extractQuantityClaims(question) — note the question may have word numbers "two" ✓ handled.

Wait — one more constraint: "must not reveal ... item locations". My place redaction covers place names. What about directional clues that aren't names: "eastern bank" — "eastern" is a common adjective... "along a secret place's eastern bank" still tells them "eastern bank" — is that "item location" revealed? The location (Mirefen) is hidden; "eastern bank" is a generic feature. The deterministic gate can't catch generic spatial words without semantics. I'll note in a comment that the redactor targets named entities + quantities; generic spatial language passes. That's a justifiable scope note (marked as a limitation, not an ASSUMPTION — an ASSUMPTION is for "a symbol you need is truly absent from the task". A limitation note in a comment is fine; I'll keep it brief).

Hmm, actually, let me reconsider redacting "eastern bank" — no, I'll stop. The requirements are about names/locations/quantities; a named-location redaction is the defensible reading. I'll add a one-line comment.

#### Scripted client

```ts
import type { LlmClient, LlmPrompt } from './guide.types.js';

export interface ScriptEntry {
  /** Matches against the prompt's question. */
  match: RegExp | string;
  reply: string;
}

export class ScriptedLlmClient implements LlmClient {
  private readonly prompts: LlmPrompt[] = [];

  constructor(private readonly script: ScriptEntry[]) {}

  async complete(prompt: LlmPrompt): Promise<string> {
    this.prompts.push(prompt);
    const entry = this.script.find(e =>
      typeof e.match === 'string' ? prompt.question.toLowerCase().includes(e.match.toLowerCase()) : e.match.test(prompt.question),
    );
    if (!entry) throw new Error(`ScriptedLlmClient: no scripted reply matches question "${prompt.question}"`);
    return entry.reply;
  }

  get callCount(): number { return this.prompts.length; }
  get lastPrompt(): LlmPrompt | undefined { return this.prompts[this.prompts.length - 1]; }
}
```

#### Fixtures (src/guide/fixtures.ts)

```ts
import type { WikiSource } from './guide.types.js';

export const EMBER_ALTAR_PAGE: WikiSource = {
  id: 'ember-altar',
  title: 'Ember Altar',
  text: 'The Ember Altar stands at the heart of the Mirefen. It demands 4 ember shards before it can be kindled. Kindled, it burns cold and lights the way out of the swamp. The altar was sealed long before the last survey.',
};

export const MIREFEN_PAGE: WikiSource = {
  id: 'mirefen',
  title: 'Mirefen',
  text: 'The Mirefen is a flooded valley south of Ashbridge. Ember shards grow on the pale reeds along the Mirefen\'s eastern bank. The water is ankle-deep by day and deep by night. Frost gates stand across the only path out.',
};

export const DUSKFANG_PAGE: WikiSource = {
  id: 'duskfang-warden',
  title: 'Duskfang Warden',
  text: 'The Duskfang Warden is a boss that guards the Ember Altar. It drops a warden sigil after a clean defeat. The warden sigil opens the gate behind the altar. It patrols the reed beds after nightfall.',
};

export const ALL_WIKI_PAGES: WikiSource[] = [EMBER_ALTAR_PAGE, MIREFEN_PAGE, DUSKFANG_PAGE];
```

Verify grounding for a full-scenario 2 answer against ALL pages:
Sentence 1 "Ember shards grow on the pale reeds along the Mirefen's eastern bank." — all words from MIREFEN_PAGE ✓. Quantity none. Proper nouns: Ember ✓ (source "Ember shards"), Mirefen ✓. Content: ember, shards, grow, pale, reeds, mirefen, eastern, bank — all in mirefen page ✓.
Sentence 2 "The Duskfang Warden guards the Ember Altar." — Duskfang ✓, Warden ✓, guards: in duskfang page "guards the Ember Altar" ✓ (also "guard"? source has "guards" ✓). Content: duskfang ✓, warden ✓, guards ✓, altar ✓ (altar in page 1 and 3 ✓). Grounded ✓.
Sentence 3 "You need 4 ember shards in all." — quantity (4,[ember,shards]) ✓ page 1. Content: (need is stopword, in no, all 3 letters) → none → ✓.

Scenario 1 correct: "The Ember Altar demands 4 ember shards before it can be kindled." — content: ember ✓, altar ✓, demands ✓, kindled ✓ (page 1 "can be kindled") ✓.

Lure: "The Ember Altar requires 5 ember shards and a Moonblade to kindle." — quantity (5,[ember,shards]) ✗ all sources. Proper: Moonblade ✗. → drop → refused ✓.

Lack scenario: q "How do I defeat the Duskfang Warden?" sources = [EMBER_ALTAR_PAGE] only. Scripted answer: "The Duskfang Warden falls to 3 frost arrows. It weakens at dawn."
- Sentence 1: quantity (3,[frost,arrows]) ✗; proper Duskfang ✗, Warden ✗; content: duskfang ✗, warden ✗, falls ✗, frost ✗, arrows ✗ → 0% ✗. Drop.
- Sentence 2: content: weakens ✗, dawn ✗ → 0% → drop.
→ Refused ✓ with the exact message.

But wait — the scripted fake: the scenario scripts an answer for this question; the fake returns it; the service drops everything → refused ✓.

#### Evaluation module

scenarios.ts:

```ts
import { ALL_WIKI_PAGES, EMBER_ALTAR_PAGE } from '../guide/fixtures.js';
import type { WikiSource } from '../guide/guide.types.js';

export interface GoldenScenario {
  id: string;
  name: string;
  question: string;
  sources: WikiSource[];
  /** Phrases a correct answer must contain (normalized containment). */
  expectedFacts: string[];
  /** Fabricated claims the answer must not contain. */
  plantedFalseFacts: string[];
  /** Scripted replies per question keyword, used to drive the fake LLM. */
  scripts: ScriptEntry[];   // hmm — scenarios need a script: correct and lie
}
```

Hmm — should the scenario include the scripts? The harness needs an LLM; the tests supply the ScriptedLlmClient with the right reply. Let me keep the scenario data (question, sources, expectedFacts, plantedFalseFacts) and let the tests pass the script to the client. But the harness is "golden scenarios (question, sources, expected facts, planted false facts...)" — exactly those four. So the scenario = those four. The scripts live in the tests. But then a standalone harness run needs scripts — the tests are the consumers. OK: keep the scenario pure data; tests build the ScriptedLlmClient.

But I also want the harness to be runnable end-to-end (the demo entrypoint?). Not asked. I'll skip the demo entrypoint (discipline: don't create files not asked for). The tests exercise it.

Let me define scenarios:

```ts
export interface GoldenScenario {
  id: string;
  question: string;
  sources: WikiSource[];
  expectedFacts: string[];
  plantedFalseFacts: string[];
}

export const KINDLE_ALTAR: GoldenScenario = {
  id: 'kindle-altar',
  question: 'How do I kindle the Ember Altar?',
  sources: ALL_WIKI_PAGES,
  expectedFacts: ['4 ember shards'],
  plantedFalseFacts: ['5 ember shards', 'Moonblade'],
};

export const SHARD_HUNT: GoldenScenario = {
  id: 'shard-hunt',
  question: 'I have 2 ember shards so far. What do I do next?',
  sources: [MIREFEN_PAGE, DUSKFANG_PAGE, EMBER_ALTAR_PAGE],
  expectedFacts: ["the Mirefen's eastern bank"? hmm...],
  plantedFalseFacts: ['5 ember shards', 'Moonblade', 'Ashbridge'? no Ashbridge is real...],
};
```
Expected facts for SHARD_HUNT (full mode): ["ember shards", "Duskfang Warden"]? The correct answer has those. Let me set expectedFacts: ['Duskfang Warden', 'ember shards'] and planted: ['5 ember shards', 'Moonblade'].

Wait — the harness also runs in hint mode? The tests will use full mode for the score tests; hint correctness is tested in the guide spec. Should I run the harness with mode parameter default 'full'? I'll add an optional mode to runSuite. In hint mode, helpfulness checks expectedFacts in the redacted text — "Duskfang Warden" is redacted → helpfulness 0 — that's semantically odd (the hint isn't expected to name the boss). The evaluation harness is about the full answer; I'll keep the harness mode='full' only and keep the signature fixed. Hmm, runScenario(service, scenario) — no mode parameter. Hint behavior tested separately. Simpler, and honest.

Third scenario for "min of the two" test? I'll reuse SHARD_HUNT with a partial answer script: "The Duskfang Warden guards the Ember Altar." → helpfulness: expected ['Duskfang Warden' ✓, 'ember shards' ✗] → 0.5; faithfulness 1.0 → final 0.5. Wait — is that sentence grounded against SHARD_HUNT sources? Duskfang, Warden, guards, altar — the altar is in EMBER_ALTAR_PAGE ✓ (sources include all three) ✓.

Also the "lie" scenario: use KINDLE_ALTAR with the lie script → refused → final 0.

judges.ts:

```ts
import type { GoldenScenario } from './scenarios.js';
import { isSentenceGrounded, splitSentences } from '../guide/grounder.js';

export interface JudgeVerdict {
  score: number; // 0..1
  findings: string[];
}

function containsFact(text: string, fact: string): boolean {
  const t = text.toLowerCase();
  const f = fact.toLowerCase();
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(f)}(?:[^a-z0-9]|$)`);
  return re.test(t);
}

export function helpfulnessJudge(answerText: string, expectedFacts: string[]): JudgeVerdict {
  if (answerText.trim() === '') {
    return { score: 0, findings: ['answer is empty (refusal)'] };
  }
  const findings: string[] = [];
  const hits = expectedFacts.filter(f => {
    const ok = containsFact(answerText, f);
    if (!ok) findings.push(`missing expected fact: "${f}"`);
    return ok;
  });
  const score = expectedFacts.length === 0 ? 1 : hits.length / expectedFacts.length;
  return { score, findings };
}
```
Wait — the boundary regex for fact "the Mirefen's eastern bank" — apostrophe in the fact: after lowercasing, the text is "the mirefen's eastern bank"; the boundary class [^a-z0-9] — apostrophe is in the boundary class, fine; internal apostrophes in the fact are literal ✓.

```ts
export function faithfulnessJudge(answerText: string, sources: WikiSource[], plantedFalseFacts: string[]): JudgeVerdict {
  if (answerText.trim() === '') {
    return { score: 1, findings: ['no claims made (refusal)'] };
  }
  const findings: string[] = [];
  const sentences = splitSentences(answerText);
  const grounded = sentences.filter(s => isSentenceGrounded(s, sources).grounded).length;
  const sentenceRatio = sentences.length === 0 ? 1 : grounded / sentences.length;
  if (sentenceRatio < 1) findings.push(`${sentences.length - grounded} of ${sentences.length} sentences are not supported by the sources`);

  const plantedHits = plantedFalseFacts.filter(f => {
    const hit = containsFact(answerText, f);
    if (hit) findings.push(`planted false fact present: "${f}"`);
    return hit;
  });
  if (plantedHits.length > 0) {
    return { score: 0, findings };
  }
  return { score: sentenceRatio, findings };
}
```

harness.ts:

```ts
import type { GuideService } from '../guide/guide.service.js';
import { faithfulnessJudge, helpfulnessJudge, type JudgeVerdict } from './judges.js';
import type { GoldenScenario } from './scenarios.js';
import type { GuideAnswer } from '../guide/guide.types.js';

export const PASS_THRESHOLD = 0.8;

export interface ScenarioReport {
  scenarioId: string;
  answer: GuideAnswer;
  helpfulness: JudgeVerdict;
  faithfulness: JudgeVerdict;
  finalScore: number;
  pass: boolean;
}

export async function runScenario(service: GuideService, scenario: GoldenScenario): Promise<ScenarioReport> {
  const answer = await service.answer(scenario.question, scenario.sources, 'full');
  const helpfulness = helpfulnessJudge(answer.text, scenario.expectedFacts);
  const faithfulness = faithfulnessJudge(answer.text, scenario.sources, scenario.plantedFalseFacts);
  const finalScore = Math.min(helpfulness.score, faithfulness.score);
  return { scenarioId: scenario.id, answer, helpfulness, faithfulness, finalScore, pass: finalScore >= PASS_THRESHOLD };
}

export async function runSuite(service: GuideService, scenarios: GoldenScenario[]): Promise<ScenarioReport[]> {
  return Promise.all(scenarios.map(s => runScenario(service, s)));
}
```

#### Tests

test/guide.spec.ts:

```ts
import { describe, expect, it } from 'vitest';
import { GuideService } from '../src/guide/guide.service.js';
import { ScriptedLlmClient } from '../src/guide/scripted-llm-client.js';
import { isSentenceGrounded } from '../src/guide/grounder.js';
import { redactToHint } from '../src/guide/redactor.js';
import { ALL_WIKI_PAGES, EMBER_ALTAR_PAGE, MIREFEN_PAGE, DUSKFANG_PAGE } from '../src/guide/fixtures.js';
import { REFUSAL_MESSAGE } from '../src/guide/guide.types.js';
```

Import path: from test/ to src: '../src/guide/...' with .js extension ✓ (NodeNext). Vitest resolves .js → .ts ✓.

Test 1: passes a fully grounded answer through.
```ts
const llm = new ScriptedLlmClient([{ match: 'kindle', reply: 'The Ember Altar demands 4 ember shards before it can be kindled.' }]);
const service = new GuideService(llm);
const res = await service.answer('How do I kindle the Ember Altar?', ALL_WIKI_PAGES, 'full');
expect(res.status).toBe('answered');
expect(res.text).toBe('The Ember Altar demands 4 ember shards before it can be kindled.');
expect(res.droppedSentences).toEqual([]);
expect(res.sourcesUsed).toContain('ember-altar');
```

Test 2: drops ungrounded, keeps grounded.
Reply: "The Ember Altar demands 4 ember shards before it can be kindled. A Moonblade is also required."
Sentence 2: proper Moonblade ✗ → drop. Content: moonblade? (proper noun already flagged), required (8) — "required" in source? No → content 1/... words: moonblade, required → 0% → drop ✓.
expect(res.text).toBe(sent1). dropped contains the Moonblade sentence.

Test 3: lack of answer → refusal:
```ts
const llm = new ScriptedLlmClient([{ match: 'defeat', reply: 'The Duskfang Warden falls to 3 frost arrows. It weakens at dawn.' }]);
const res = await service.answer('How do I defeat the Duskfang Warden?', [EMBER_ALTAR_PAGE], 'full');
expect(res.status).toBe('refused');
expect(res.refusalReason).toBe('not covered by my sources');
expect(res.text).toBe('');
expect(res.droppedSentences).toHaveLength(2);
```
Verify sentence 2 "It weakens at dawn." — content: weakens, dawn → not in the altar page ✓ drop. ✓
Verify sentence 1 against the altar page: quantity (3,[frost,arrows]): the altar page has "4" but not 3+... → ✗ ✓.

Test 4: quantity error caught accurately:
```ts
it('flags 5 shards as ungrounded when the sources say 4', () => {
  expect(isSentenceGrounded('You need 5 ember shards.', [EMBER_ALTAR_PAGE, MIREFEN_PAGE]).grounded).toBe(false);
  expect(isSentenceGrounded('You need 4 ember shards.', [EMBER_ALTAR_PAGE, MIREFEN_PAGE]).grounded).toBe(true);
});
```
Verify "You need 4 ember shards.": quantity (4,[ember,shards]) ✓ page 1. Proper: none. Content: need (stopword), shards ✓, all? "You need 4 ember shards." words: you, need, 4, ember, shards → content: shards ✓ (need is stopword) → 1/1 ✓ → grounded ✓.
And the service level: a reply with only "You need 5 ember shards." → refused (dropped). Add:
```ts
const res = await service.answer('How do I kindle the Ember Altar?', ALL_WIKI_PAGES, 'full'); // script: 'You need 5 ember shards.'
expect(res.status).toBe('refused');
```
Also, "caught accurately" — verify the verdict's reasons mention quantity:
```ts
const v = isSentenceGrounded('You need 5 ember shards.', [EMBER_ALTAR_PAGE]);
expect(v.reasons.join(' ')).toMatch(/quantity/);
```

Test 5: hint mode:
```ts
const reply = "Ember shards grow on the pale reeds along the Mirefen's eastern bank. The Duskfang Warden guards the Ember Altar. You need 4 ember shards in all.";
const llm = new ScriptedLlmClient([{ match: 'do next', reply }]);
const res = await service.answer('I have 2 ember shards so far. What do I do next?', ALL_WIKI_PAGES, 'hint');
expect(res.mode).toBe('hint');
expect(res.status).toBe('answered');
expect(res.text).toBe("Ember shards grow on the pale reeds along a secret place's eastern bank. The hidden boss guards a secret place. You need several ember shards in all.");
expect(res.text).not.toContain('Mirefen');
expect(res.text).not.toContain('Duskfang');
expect(res.text).not.toContain('4 ember shards');
expect(llm.callCount).toBe(1); // no re-prompting
```
And derived-by-redaction:
```ts
const full = await new GuideService(sameLlm).answer(q, sources, 'full');
expect(redactToHint(full.text, q)).toBe(res.text);
```
I can reuse the same llm instance across two services (callCount 2 — fine, or use a separate instance).

Wait — let me verify the hint redaction step by step for sentence 1:
"Ember shards grow on the pale reeds along the Mirefen's eastern bank."
Tokens: [Ember, shards, grow, on, the, pale, reeds, along, the, Mirefen's, eastern, bank]
Proper noun claims: group at 0: "Ember" (next "shards" lowercase) → claim {rawWords:['Ember'], words:['ember'], start 0 end 1}. i=1..8 lowercase. i=9 "Mirefen's" is capitalized → claim {rawWords:["Mirefen's"], words:['mirefen'], start 9 end 10}. i=10 eastern lowercase, 11 bank lowercase.
Classification of Ember: own 'ember' — boss? no. place? no. Window from max(0,-5)=0 to min(12,1+5)=6 → tokens 0..5: Ember (skip own), shards, grow, on, the, pale → cleaned: shards, grow, on, the, pale → none in boss/place → null → keep ✓.
Classification of Mirefen: own 'mirefen' no. Window from 4 to min(12,10+5)=12 → tokens 4..11: the, pale, reeds, along, the, (skip 9), eastern, bank → 'eastern' ∈ PLACE ✓ → 'place'.
Replacement: preceding token for Mirefen: tokens[8] = "the" → prev 'the' → replace phrase "Mirefen's" → possessive: base "Mirefen" suffix "'s" → search "Mirefen" replace "secret place" + "'s" → "the secret place's". Result: "Ember shards grow on the pale reeds along the secret place's eastern bank."

Hmm — I wrote "a secret place's" in the earlier expected — but prev is "the" → "the secret place's". Fix the expected string: "along the secret place's eastern bank." ✓ reads fine.

Sentence 2: "The Duskfang Warden guards the Ember Altar."
Tokens: [The, Duskfang, Warden, guards, the, Ember, Altar]
Claims: i=0 "The" is capitalized, group: The, Duskfang, Warden (all caps consecutive) → filtered drops "The" (first token, in starters) → claim {rawWords:['Duskfang','Warden'] (post-filter), words:['duskfang','warden'], start 1, end 3}. i=3 guards. i=4 the. i=5 Ember, Altar caps → claim {rawWords:['Ember','Altar'], start 5, end 7}.
Wait — the claim's start/end must reflect the filtered span! If I drop "The" from the phrase, the span for replacement = "Duskfang Warden" at start 1. ✓ Let me make sure the extraction sets start/end to the filtered span.
Classification of Duskfang Warden: own: duskfang no; warden ∈ BOSS ✓ → 'boss'. Preceding token tokens[0] = "The" → prev 'the' → replace "Duskfang Warden" → "hidden boss" → "The hidden boss guards the Ember Altar."
Classification of Ember Altar: own: ember no; altar ∈ PLACE ✓ → 'place'. Preceding tokens[4] = "the" → replace "Ember Altar" → "secret place" → "The hidden boss guards the secret place." ✓
Quantity: none.
Result sentence 2 ✓.

Sentence 3: "You need 4 ember shards in all."
Quantities: (4, [ember, shards]) raw "4 ember shards". Player claims from question "I have 2 ember shards so far. What do I do next?": tokens: I, have, 2, ember, shards, so, far, What, do, I, do, next → claim (2, [ember, shards]) — unit trim: after "shards": "so" ∈ UNIT_TRIM ✓ stop → [ember, shards] ✓. Second sentence "What do I do next?" no numbers.
Keep? sameUnit([ember,shards],[ember,shards]) ✓ && 2 >= 4? No → redact → replace "4" → "several" → "You need several ember shards in all." ✓
Proper: none (You is a starter; nothing else capitalized).
✓.

Final hint: "Ember shards grow on the pale reeds along the secret place's eastern bank. The hidden boss guards the secret place. You need several ember shards in all." ✓

Verify the full text is grounded (so it's not truncated before redaction) — verified above ✓.

Also, test: hint quantity kept when the player already knows it: question "I have 4 ember shards. What do I do next?" → claim (4,[ember,shards]) → answer "You need 4 ember shards in all." → 4>=4 keep → hint contains "4 ember shards". Add as a small test ✓ (nice boundary).

Test 6: zero sources → refused, no LLM call:
```ts
const llm = new ScriptedLlmClient([{ match: 'anything', reply: 'Sure, do the thing.' }]);
const res = await service.answer('Hi', [], 'full');
expect(res.status).toBe('refused');
expect(res.refusalReason).toBe(REFUSAL_MESSAGE);
expect(llm.callCount).toBe(0);
```
Note: script match 'anything' — the call doesn't happen anyway.

Also, an unknown question → the fake throws: service should propagate? That's client behavior; skip the test? I'll add: the fake throws on unscripted questions (documented) — maybe test: await expect(...).rejects.toThrow(/no scripted reply/) — proves the fail-loud design. Optional; I'll include it briefly.

test/eval.spec.ts:

```ts
import { describe, expect, it } from 'vitest';
import { GuideService } from '../src/guide/guide.service.js';
import { ScriptedLlmClient } from '../src/guide/scripted-llm-client.js';
import { runScenario, runSuite } from '../src/eval/harness.js';
import { KINDLE_ALTAR, SHARD_HUNT, GOLDEN_SCENARIOS } from '../src/eval/scenarios.js';
import { helpfulnessJudge, faithfulnessJudge } from '../src/eval/judges.js';
import { ALL_WIKI_PAGES } from '../src/guide/fixtures.js';

const CORRECT = 'The Ember Altar demands 4 ember shards before it can be kindled.';
const LIE = 'The Ember Altar requires 5 ember shards and a Moonblade to kindle.';

describe('eval harness', () => {
  it('scores a correct grounded answer high', async () => {
    const service = new GuideService(new ScriptedLlmClient([{ match: 'kindle', reply: CORRECT }]));
    const report = await runScenario(service, KINDLE_ALTAR);
    expect(report.helpfulness.score).toBe(1);
    expect(report.faithfulness.score).toBe(1);
    expect(report.finalScore).toBeGreaterThan(0.8);
    expect(report.pass).toBe(true);
  });

  it('scores a scripted confident lie low', async () => {
    const service = new GuideService(new ScriptedLlmClient([{ match: 'kindle', reply: LIE }]));
    const report = await runScenario(service, KINDLE_ALTAR);
    expect(report.finalScore).toBeLessThan(0.4);
    expect(report.pass).toBe(false);
  });

  it('min of the two judges is the final score', async () => {
    const service = new GuideService(new ScriptedLlmClient([{ match: 'do next', reply: 'The Duskfang Warden guards the Ember Altar.' }]));
    const report = await runScenario(service, SHARD_HUNT);
    expect(report.faithfulness.score).toBe(1);
    expect(report.helpfulness.score).toBeCloseTo(0.5);
    expect(report.finalScore).toBeCloseTo(0.5);
    expect(report.finalScore).toBe(Math.min(report.helpfulness.score, report.faithfulness.score));
  });
```
Wait SHARD_HUNT expectedFacts: let me set ['Duskfang Warden', 'ember shards']. Partial answer "The Duskfang Warden guards the Ember Altar." → "Duskfang Warden" ✓ contains; "ember shards"? The text has "Ember Altar" not "ember shards" → ✗ → 0.5 ✓. Faithfulness: sentence grounded ✓ (verified) → 1 ✓.

Hmm wait — verify "The Duskfang Warden guards the Ember Altar." grounded against SHARD_HUNT sources (all three): ✓ as before.

```ts
  it('faithfulness judge catches a planted quantity error even if ungated', () => {
    const v = faithfulnessJudge('The altar requires 5 ember shards.', ALL_WIKI_PAGES, ['5 ember shards']);
    expect(v.score).toBe(0);
    expect(v.findings.join(' ')).toMatch(/5 ember shards/);
  });
```
Wait — the judge also computes the sentenceRatio: "The altar requires 5 ember shards." — quantity 5 ✗ ungrounded → ratio 0; planted found → score 0 ✓ findings include the planted note ✓.

```ts
  it('helpfulness judge scores partial coverage proportionally', () => {
    const v = helpfulnessJudge('The altar is in the Mirefen.', ['4 ember shards', 'the Mirefen']);
    expect(v.score).toBeCloseTo(0.5);
  });

  it('runs the full suite and reports one final score per scenario', async () => {
    const service = new GuideService(new ScriptedLlmClient([
      { match: 'kindle', reply: CORRECT },
      { match: 'do next', reply: SHARD_HUNT_REPLY },
    ]));
    const reports = await runSuite(service, GOLDEN_SCENARIOS);
    expect(reports).toHaveLength(GOLDEN_SCENARIOS.length);
    expect(reports.every(r => r.finalScore === Math.min(r.helpfulness.score, r.faithfulness.score))).toBe(true);
    expect(reports.every(r => r.pass)).toBe(true);
  });
});
```
SHARD_HUNT_REPLY = correct full answer for scenario 2: "Ember shards grow on the pale reeds along the Mirefen's eastern bank. The Duskfang Warden guards the Ember Altar. You need 4 ember shards in all."
Verify helpfulness against ['Duskfang Warden', 'ember shards']: "ember shards" — the text has "Ember shards grow" → lowercased "ember shards" ✓ boundary: preceding space ✓. → 1.0. Faithfulness: all 3 sentences grounded ✓ → 1 → pass ✓.

Wait — the "kindle" match vs the question "How do I kindle the Ember Altar?" contains "kindle" ✓. The SHARD_HUNT question "I have 2 ember shards so far. What do I do next?" contains "do next" ✓. But the script order: the fake finds the first match; 'kindle' is tested against the shard question — no "kindle" ✓ no cross-match.

Also the lack scenario (refusal) is tested in the guide spec; I could also run the harness on it — skip, covered.

Also — a "golden scenarios" fixture should include a refusal case? The task lists the scenario fields (question, sources, expected facts, planted false facts). The refusal test uses the service directly — fine.

Now — the planted false fact "Moonblade": the LIE contains "a Moonblade to kindle" — containsFact("...moonblade to kindle", "Moonblade") → lowercased "moonblade" boundary ✓ → planted hit (in the ungated judge test). In the harness LIE test, the service refuses → the judges get '' → helpfulness 0, faithfulness 1 → final 0 ✓ < 0.4 ✓.

Hmm — one concern: in "scores a scripted confident lie low", the refusal makes the lie score 0 — the test's wording is "confident lie answer scores low" — that's satisfied (0 < 0.4). Plus the direct judge test shows the lie text itself scores 0 on faithfulness.

#### Now let me re-verify all the tricky mechanics once more.

**cleanToken ordering**: strip possessive → word number:
```ts
function cleanToken(token: string): string {
  let t = token.toLowerCase();
  if (t.endsWith("'s")) t = t.slice(0, -2);
  return WORD_NUMBERS[t] ?? t;
}
```
"mirefen's" → "mirefen" ✓. "four" → "4" ✓. "shards'" (trailing apostrophe, no s)? Doesn't exist.

**tokenize**: `text.split(/[^A-Za-z0-9''-]+/)` — the character class contains an apostrophe; note: `''` inside a class is just an apostrophe. Also em dash "—"? The class excludes → split ✓. Let me write the class: /[^A-Za-z0-9'’-]+/. Include the curly apostrophe too. Hyphen at the end of the class = literal ✓.

**Quantity extraction** with allowed units /^[A-Za-z][A-Za-z'-]*$/ (allowing capitals): "5 ember shards" ✓. "45 minutes" ✓. Number tokens: "4" ✓; "4.5"? /.../ handled.

Wait, issue: after "in all." there's a period — tokens are clean.

Number detection: token "2024"? A year → quantity claim (2024, [unit...]) → probably not in source → drop. Fine (an edge).

**UNIT_TRIM** check on the cleaned token: "so" ✓ trimmed.

Edge: "all 4 ember shards" — "all" precedes; the quantity regex scans token "4" → unit [ember, shards] ✓ ("all" is ignored). In the hint: "all several ember shards"? My script uses "in all" → "You need 4 ember shards in all." → "You need several ember shards in all." ✓.

**Proper noun group edge**: "Duskfang's sigil" — tokens Duskfang's → group [Duskfang's] → claim word duskfang ✓.

**COMMON_SENTENCE_STARTERS** — needed for "The", "You", "It", "When", etc. Also "Ember"? No! "Ember" is a real name → must be a claim (it'll pass via source match). ✓ leave out of the list.

But danger: an answer sentence starts with "The" and the next word is a real name: "The Duskfang Warden..." handled ✓. An answer starts with "A Moonblade is required." → "A" dropped, "Moonblade" is k>0 in the group? Group at i=0: [A, Moonblade]? "A" is capitalized, "Moonblade" capitalized → group [A, Moonblade] → filtered: k=0 "A" dropped (starter), k=1 "Moonblade" — my filter: `if (k > 0 && COMMON_SENTENCE_STARTERS.has(w)) return false;` — Moonblade not a starter → kept ✓ claim "Moonblade" ✓.

**Content word check for "A Moonblade is required."**: content: moonblade (proper noun, lowercase "moonblade" length 8 ✓ content), required (8) → 0 in source → 0% ✗ drop ✓ (also proper noun flag).

**Threshold 0.5**: "hits.length / cw.length < 0.5" → ungrounded. Exactly 0.5 passes.

**isSentenceGrounded with multiple sources**: claim grounded if it's in any source (some) ✓. Content pool = union of all source token sets ✓.

**sourcesUsed per source**: isSentenceGrounded(sentence, [source]).grounded → add source.id. In scenario 1: the sentence is grounded by EMBER_ALTAR_PAGE alone (4 shards + kindled + altar) ✓ → sourcesUsed ['ember-altar'] (mirefen alone? content: demands ✓ (mirefen? no "demands" is in page 1 only) → no; duskfang? "kindled" no → no) → ['ember-altar'] ✓ my test asserts toContain('ember-altar') ✓.

**splitSentences lookbehind** `/(?<=[.!?])\s+/` — "bank. The" → split ✓. Trailing "all." no space after → not split, kept as a whole ✓. Multiple spaces? Fine.

**Refusal exact string**: 'not covered by my sources' ✓ constant REFUSAL_MESSAGE; the task's string matches exactly (lowercase, no period).

**min score**: Math.min ✓.

**PASS_THRESHOLD** 0.8 — "scores high" > 0.8: final 1.0 ✓ pass true.

Now — tsconfig:

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
    "esModuleInterop": true,
    "declaration": false,
    "sourceMap": false,
    "outDir": "dist",
    "types": ["node"],
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```
noUncheckedIndexedAccess — I must be careful with index accesses (tokens[i] → string | undefined). My loops: `rawTokens[i]` in extractQuantities — I check `if (!u ...) break` with u = rawTokens[i+k] → type string|undefined ✓ handled. In quantityInSource: `idx.tokens[i] !== claim.number` — tokens[i] is string|undefined; undefined !== claim.number is true → continue ✓ OK. `claim.unit[u]` is string|undefined; `idx.tokens[j] === claim.unit[u]` — undefined === undefined?? if j is out of range? j is bounded by end ≤ tokens.length ✓ tokens[j] is defined; unit[u] is defined for u < unit.length ✓ (checked by loop condition). But TS strict would flag? `idx.tokens[j] === claim.unit[u]` — both could be undefined per type; comparison is allowed (both string|undefined) ✓ compiles.

exactOptionalPropertyTypes — GuideAnswer.refusalReason: string | null (not optional) → fine.

verbatimModuleSyntax → I must use `import type` for type-only imports ✓ I'll be careful.

Hmm, `useDefineForClassFields`? With ES2022 target, default true — the `private readonly llm` in the constructor is fine.

package.json:

```json
{
  "name": "grounded-game-guide",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Grounded gameplay assistant: answer pipeline, hint redaction, eval harness.",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

vitest.config.ts:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
});
```

Now, file list:
1. package.json
2. tsconfig.json
3. vitest.config.ts
4. src/guide/guide.types.ts
5. src/guide/grounder.ts
6. src/guide/redactor.ts
7. src/guide/guide.service.ts
8. src/guide/scripted-llm-client.ts
9. src/guide/fixtures.ts
10. src/eval/scenarios.ts
11. src/eval/judges.ts
12. src/eval/harness.ts
13. test/guide.spec.ts
14. test/eval.spec.ts

Let me now write out each file fully and carefully, double-checking TS strictness and logic.

Let me write grounder.ts in full:

```ts
import type { WikiSource } from './guide.types.js';

/**
 * Sentence-level grounding gate.
 *
 * A sentence is considered grounded only if every detectable factual claim in it
 * is present in the provided wiki pages:
 *  - quantity claims ("5 ember shards") must match number + unit in a source,
 *  - proper-noun claims ("Duskfang Warden") must appear in a source,
 *  - at least half of the sentence's content words must appear in a source.
 *
 * The gate is a deterministic heuristic, not an NLP model: it catches fabricated
 * names and wrong quantities exactly, and filters out sentences whose vocabulary
 * has no overlap with the sources.
 */

export interface GroundingVerdict {
  grounded: boolean;
  /** Reasons the sentence failed the gate; empty when grounded. */
  reasons: string[];
}

export interface QuantityClaim {
  /** Original text of the claim, e.g. "5 ember shards". */
  raw: string;
  /** Normalized numeric value, e.g. "5" (word numbers are normalized). */
  number: string;
  /** Original numeric token, e.g. "five". */
  numberRaw: string;
  /** Unit words following the number, cleaned, e.g. ["ember", "shards"]. */
  unit: string[];
}

export interface ProperNounClaim {
  /** Original phrase, e.g. "Duskfang Warden". */
  phrase: string;
  /** Cleaned words, e.g. ["duskfang", "warden"]. */
  words: string[];
  /** Token span in the raw token array (end exclusive). */
  start: number;
  end: number;
}

const WORD_NUMBERS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13',
  fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18',
  nineteen: '19', twenty: '20',
};

const TOKEN_RE = /[^A-Za-z0-9'\u2019-]+/;
const CAPITAL_RE = /^[A-Z][A-Za-z'\u2019-]*$/;
const UNIT_WORD_RE = /^[A-Za-z][A-Za-z'\u2019-]*$/;
const BARE_NUMBER_RE = /^[0-9]+(\.[0-9]+)?$/;

const CONTENT_STOP_WORDS = new Set([
  'the','and','that','this','these','those','with','from','your','yours','you','have','has','had','are','was','were','been','being','can','could','would','should','will','shall','may','might','must','need','needs','needed','do','does','did','about','before','after','above','below','under','over','then','than','when','where','what','which','who','whom','how','why','here','there','out','off','up','down','into','onto','onto','in','on','at','to','for','of','a','an','it','its','they','them','their','he','she','his','her','our','us','we','if','but','or','nor','so','not','no','yes','all','any','both','each','few','more','most','other','some','such','only','own','same','too','very','just','also','way','make','makes','made','take','takes','taken','get','gets','got','coming','come','comes','back','first','last','new','old','long','short','little','big','many','much','still','even','ever','never','always','often','once','every','clean'?
]);
```
"clean" — from "a clean defeat" — "clean" is a content-ish word; it's in source anyway. Drop "clean" from stopwords (irrelevant). Remove the 'onto' duplicate.

COMMON_SENTENCE_STARTERS:
```ts
const COMMON_SENTENCE_STARTERS = new Set([
  'The','A','An','It','This','These','That','Those','If','When','While','You','Your','He','She','They','We','I','Yes','No','So','And','But','Or','To','Is','Are','Was','Were','Do','Does','Did','Can','Could','Should','Would','May','Might','Note','Tip','Remember','In','On','At','With','Without','After','Before','Once','Until','Note','Kindled'?
]);
```
No Kindled (I decided). Note duplicate.

UNIT_TRIM:
```ts
const UNIT_TRIM = new Set([
  'the','a','an','of','in','on','at','to','for','with','and','or','so','far','more','left','yet','your','my','you','i','is','are','was','were','be','been','need','needs','needed','have','has','had','its','it','this','that','them','then','all','about','around','over','under','across','along'?
]);
```
Wait "along" — "4 ember shards along the bank"? The unit should stop at "shards" anyway... only if "along" comes right after the unit: "4 shards along" — hmm the unit words should stop at "shards"; "along" isn't part of the unit → trim ✓ add 'along'. Note: trim stops the unit capture at the first trim word — but the source window matching requires consecutive unit words after the number; the unit [ember, shards] is fine.

Hmm wait, one more: "You need 4 ember shards in all." — after "shards" → "in" trim ✓ unit [ember,shards] ✓.

Functions:

```ts
export function tokenize(text: string): string[] {
  return text.split(TOKEN_RE).filter((t) => t.length > 0);
}

function cleanToken(token: string): string {
  let t = token.toLowerCase();
  if (t.endsWith("'s")) t = t.slice(0, -2);
  return WORD_NUMBERS[t] ?? t;
}

interface SourceIndex {
  tokens: string[];
  set: Set<string>;
}

function indexSource(source: WikiSource): SourceIndex {
  const tokens = tokenize(source.text).map(cleanToken);
  return { tokens, set: new Set(tokens) };
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function extractQuantityClaims(sentence: string): QuantityClaim[] {
  const tokens = tokenize(sentence);
  const claims: QuantityClaim[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? '';
    let number: string | null = null;
    if (BARE_NUMBER_RE.test(t)) {
      number = t;
    } else if (WORD_NUMBERS[t.toLowerCase()]) {
      number = WORD_NUMBERS[t.toLowerCase()];
    }
    if (number === null) continue;

    const unit: string[] = [];
    for (let k = 1; k <= 3; k++) {
      const u = tokens[i + k];
      if (u === undefined || !UNIT_WORD_RE.test(u)) break;
      const cu = cleanToken(u);
      if (UNIT_TRIM.has(cu)) break;
      unit.push(cu);
    }
    const rawTokens = unit.length > 0 ? [t, ...unit.map((_, idx) => tokens[i + 1 + idx] ?? '')] : [t];
    claims.push({ raw: rawTokens.join(' '), number, numberRaw: t, unit });
  }
  return claims;
}
```
Hmm raw: better to use the original unit tokens (they should equal the cleaned ones except for word numbers/possessives — edge). raw is for display in reasons: I'll use the original token at positions i+1..: fine.

Wait — the WORD_NUMBERS[t.toLowerCase()] lookup returns string|undefined; under noUncheckedIndexedAccess, indexing Record<string,string> → string | undefined ✓ handled with a truthy check.

```ts
export function extractProperNounClaims(sentence: string): ProperNounClaim[] {
  const tokens = tokenize(sentence);
  const claims: ProperNounClaim[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i] ?? '';
    if (!CAPITAL_RE.test(t)) { i++; continue; }
    let j = i;
    while (j < tokens.length && CAPITAL_RE.test(tokens[j] ?? '')) j++;
    // raw span i..j; drop leading common sentence starters (only when at sentence start)
    let start = i;
    if (i === 0 && COMMON_SENTENCE_STARTERS.has(t)) start = i + 1;
    // also drop any other starter word inside the group (rare: "Warden The")
    let end = j;
    const phrase: string[] = [];
    for (let k = start; k < end; k++) {
      const w = tokens[k] ?? '';
      if (k > start && COMMON_SENTENCE_STARTERS.has(w)) continue;  // hmm this shifts the span
      phrase.push(w);
    }
    ...
  }
}
```
Getting messy with span management when interior words are dropped. Simplify: interior starter words are super rare ("The Duskfang" pattern handled at start). Let me only handle the leading starter case:

```ts
export function extractProperNounClaims(sentence: string): ProperNounClaim[] {
  const tokens = tokenize(sentence);
  const claims: ProperNounClaim[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i] ?? '';
    if (!CAPITAL_RE.test(t)) { i += 1; continue; }
    let j = i + 1;
    while (j < tokens.length && CAPITAL_RE.test(tokens[j] ?? '')) j += 1;
    let start = i;
    if (i === 0 && COMMON_SENTENCE_STARTERS.has(t)) start = i + 1;
    const rawWords: string[] = [];
    for (let k = start; k < j; k++) rawWords.push(tokens[k] ?? '');
    if (rawWords.length > 0) {
      claims.push({
        phrase: rawWords.join(' '),
        words: rawWords.map(cleanToken),
        start,
        end: j,
      });
    }
    i = j;
  }
  return claims;
}
```
Wait: if i===0 and "The" is dropped, start=1, rawWords = Duskfang, Warden ✓ span 1..3 ✓.

Edge: sentence "The." alone? rawWords [] → no claim ✓.

Grounding of a quantity in a source:
```ts
function quantityInSource(claim: QuantityClaim, index: SourceIndex): boolean {
  if (claim.unit.length === 0) {
    return index.set.has(claim.number);
  }
  for (let i = 0; i < index.tokens.length; i++) {
    if ((index.tokens[i] ?? '') !== claim.number) continue;
    let u = 0;
    const end = Math.min(index.tokens.length, i + 1 + claim.unit.length + 2);
    for (let j = i + 1; j < end && u < claim.unit.length; j++) {
      if ((index.tokens[j] ?? '') === (claim.unit[u] ?? '')) u += 1;
    }
    if (u === claim.unit.length) return true;
  }
  return false;
}
```
claim.unit[u] ?? '' — fine.

Proper noun:
```ts
function properNounInSource(claim: ProperNounClaim, index: SourceIndex): boolean {
  return claim.words.every((w) => index.set.has(w));
}
```

Content words:
```ts
function contentWords(sentence: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const t of tokenize(sentence)) {
    const c = cleanToken(t);
    if (c.length < 4) continue;
    if (!/^[a-z]+$/.test(c)) continue;
    if (CONTENT_STOP_WORDS.has(c)) continue;
    if (seen.has(c)) continue;
    seen.add(c);
    words.push(c);
  }
  return words;
}
```
Note: cleanToken maps "four" → "4" → fails /^[a-z]+$/ → excluded ✓. Hyphenated "ankle-deep" → "ankle-deep" fails [a-z]+ → excluded. OK.

Main:
```ts
export function isSentenceGrounded(sentence: string, sources: WikiSource[]): GroundingVerdict {
  const trimmed = sentence.trim();
  if (trimmed.length === 0) return { grounded: true, reasons: [] };
  const indices = sources.map(indexSource);
  const reasons: string[] = [];

  for (const claim of extractQuantityClaims(trimmed)) {
    if (!indices.some((idx) => quantityInSource(claim, idx))) {
      reasons.push(`quantity "${claim.raw}" is not stated in any source`);
    }
  }
  for (const claim of extractProperNounClaims(trimmed)) {
    if (!indices.some((idx) => properNounInSource(claim, idx))) {
      reasons.push(`name "${claim.phrase}" does not appear in any source`);
    }
  }
  const words = contentWords(trimmed);
  if (words.length > 0) {
    const pool = new Set<string>();
    for (const idx of indices) for (const t of idx.set) pool.add(t);
    const hits = words.filter((w) => pool.has(w)).length;
    if (hits / words.length < 0.5) {
      reasons.push(`${words.length - hits} of ${words.length} content words are absent from the sources`);
    }
  }
  return { grounded: reasons.length === 0, reasons };
}
```
If sources is empty → indices [] → every claim: some() on empty = false → if any claims, reasons non-empty; if no claims and no content words → would return grounded true on empty sources!! But the service short-circuits empty sources before calling. Still, guard: if (indices.length === 0) return { grounded: false, reasons: ['no sources provided'] }. ✓ add.

Let me re-verify the test-2 fabricated sentence: "A Moonblade is also required."
- Tokens: A, Moonblade, is, also, required.
- Quantities: none.
- Proper nouns: i=0 "A" is caps; j: "A" caps, "Moonblade" caps → j=2; i===0 && starters.has("A") → start=1; rawWords [Moonblade]; claim ✓. i=2..: is, also, required lowercase.
- Proper noun check: "moonblade" in any source? No → reason ✓.
- Content words: moonblade (8, a-z ✓ not stopword), required (8 ✓) → hits 0/2 → reason ✓.
→ dropped ✓.

Test-1 correct sentence content words: "The Ember Altar demands 4 ember shards before it can be kindled."
Tokens: The, Ember, Altar, demands, 4, ember, shards, before, it, can, be, kindled.
Proper nouns: i=0 "The" caps; group The, Ember, Altar (Ember caps, Altar caps, demands lowercase) j=3; i===0 starter → start=1 → claim [Ember, Altar] words [ember, altar] ✓ in page 1 ✓.
Quantities: token "4" → unit: next "ember" ✓, "shards" ✓, then "before" — "before" ∈ UNIT_TRIM? Did I include it? Let me check my UNIT_TRIM list: I don't see 'before'! Add: 'before','after' — "4 ember shards before it can be kindled" → unit would capture [ember, shards, before]!!! Then quantityInSource: number 4, unit [ember,shards,before]: source page 1: "demands 4 ember shards before it can be kindled" → tokens: demands,4,ember,shards,before,it,can,be,kindled → after 4: ember✓ shards✓ before✓ → u=3 = unit.length ✓ grounded! Ha — works because the source has "before" right after. But that's luck; if the source said "4 ember shards are needed" → unit [ember,shards,before] vs source [ember,shards,are] → fail → false negative!! I must add 'before' to UNIT_TRIM. Let me add: 'before','after','that','it','can','be','is'... actually a robust fix: the unit should stop at function words: add 'before','after','that','it','can','could','will','are','is','was','were','are','been','being','get','got','make','makes','made','take','takes','taken','have','has','had','need','needs'. Let me expand UNIT_TRIM generously — it's a stopword list.

Redo the list:
```ts
const UNIT_TRIM = new Set([
  'the','a','an','of','in','on','at','to','for','with','and','or','so','far','more','left','yet','your','my','you','i','is','are','was','were','be','been','being','need','needs','needed','have','has','had','its','it','this','that','them','then','all','about','around','over','under','across','along','before','after','can','could','will','would','should','may','might','must','make','makes','made','take','takes','taken','get','gets','got','do','does','did','not','no','yes','if','when','where','while','which','who','how','why','as','but','also','only','very','too','just','such','each','few','many','much','most','other','some','any','both','own','same','way','long','short','little','big','clean','pale'?
]);
```
"pale" — "4 pale shards"?? The unit could be "pale shards" (an adjective) — the source "pale reeds"... hmm "4 pale shards" — if the source says "4 ember shards", the unit [pale, shards] wouldn't match. But such phrasing is unlikely. Keep the list focused; don't add adjectives. Drop 'clean','pale'.

OK, "You need 4 ember shards in all.": after shards → "in" trim ✓ [ember, shards] ✓.

Re-verify test-3 sentence 1 "The Duskfang Warden falls to 3 frost arrows." against EMBER_ALTAR_PAGE:
Quantities: "3" unit: "frost" ✓, "arrows" ✓, stop (end). unit [frost, arrows]. Altar page tokens: the, ember, altar, stands, at, the, heart, of, the, mirefen, it, demands, 4, ember, shards, before, it, can, be, kindled, kindled, it, burns, cold, and, lights, the, way, out, of, the, swamp, the, altar, was, sealed, long, before, the, last, survey. "3" not present → ✗ ✓.
Proper nouns: group from i=0: The, Duskfang, Warden → drop The → claim [Duskfang, Warden] → duskfang ✗ → reason ✓.
Content: duskfang, warden, falls, frost, arrows → 0/5 → reason ✓. Dropped ✓.

Sentence 2 "It weakens at dawn." — proper nouns: "It" at start is a starter → no claim. Content: weakens (7), dawn (4) → not in page → 0/2 → dropped ✓.

Now — the hint test's redactor details — I need the redactor to import from the grounder: extractProperNounClaims, extractQuantityClaims, tokenize, splitSentences, and the claim types. All exported ✓. Also need cleanToken? For the window classification, I need cleaned tokens: either I export cleanToken or I provide `cleanedTokens(text): string[]` from the grounder. Let me export a helper `tokenStream(text): { raw: string[]; clean: string[] }`? Simpler: export tokenize and cleanToken. I'll export cleanToken (with a comment that it's internal-ish).

redactor.ts:

```ts
import {
  cleanToken,
  extractProperNounClaims,
  extractQuantityClaims,
  splitSentences,
  tokenize,
} from './grounder.js';

/**
 * Hint mode is derived from the full grounded answer, never by re-prompting.
 * Redactions:
 *  - quantities above what the player already mentioned in the question → "several",
 *  - boss names → "a hidden boss",
 *  - place names → "a secret place".
 * Item names are intentionally left in: the spoiler contract forbids boss names,
 * item locations and quantities, not item names.
 * // ASSUMPTION: the spoiler contract forbids boss names, item locations and quantities, not item names.
 */

const BOSS_WORDS = new Set([
  'boss','guardian','warden','foe','enemy','champion','sentinel','fight','defeat','defeated','slay','slain','kill','killed','battle','duel','encounter','guard','guards','guarded','patrol','patrols','patrolled','hound','beast','brute','specter','lich','golem',
]);

const PLACE_WORDS = new Set([
  'place','location','region','area','zone','cave','temple','swamp','forest','mountain','dungeon','keep','tower','fen','marsh','valley','ruin','ruins','altar','shrine','gate','path','door','room','bank','shore','cliff','hill','north','south','east','west','eastern','western','southern','northern','beyond','near','behind','inside','under','above','across','through',
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface PlayerQuantity { number: number; unit: string[]; }

function playerQuantities(question: string): PlayerQuantity[] {
  return extractQuantityClaims(question).map((c) => ({ number: Number(c.number), unit: c.unit }));
}

function sameUnit(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((w, i) => w === (b[i] ?? ''));
}

function redactQuantities(sentence: string, known: PlayerQuantity[]): string {
  let out = sentence;
  for (const claim of extractQuantityClaims(sentence)) {
    const n = Number(claim.number);
    const knownEnough = claim.unit.length === 0
      ? known.some((k) => k.unit.length === 0 && k.number === n)
      : known.some((k) => sameUnit(k.unit, claim.unit) && k.number >= n);
    if (knownEnough) continue;
    const re = new RegExp(`\\b${escapeRegExp(claim.numberRaw)}\\b`, 'i');
    out = out.replace(re, 'several');
  }
  return out;
}
```
Hmm bare number: "known.some(k => k.unit.length===0 && k.number === n)" — keep only if the player mentioned the exact bare number. Otherwise redact → "several": "level several"? I said "a number" earlier... "several" is simpler; a bare number redacted to "several" — e.g., "stage 7" → "stage several". Ugh. Rare; acceptable, I'll comment. Actually — a bare number that's not a quantity ("level 5") — redacting it might be wrong ("quantities" is about item counts). But safer to redact; I'll comment that bare numbers are redacted unless the player mentioned the same number.

Wait, there's a subtlety with the word-boundary replace for numberRaw "4" — it would match "4" in "4 ember shards" ✓ the first occurrence. But what if the sentence has an earlier unrelated "4"? The claim's raw includes the unit — a better approach: replace the whole claim's raw string, keeping the unit:
```ts
const claimRe = new RegExp(`\\b${escapeRegExp(claim.raw)}\\b`);
out = out.replace(claimRe, `several ${claim.unit.join(' ')}`.trim());
```
claim.raw = "4 ember shards" (original tokens) → replace with "several ember shards" ✓ more precise, avoids cross-claim collisions. But claim.raw's spacing assumption (single spaces) — the tokens are joined with ' ' — matches typical text ✓. Word-number raw "four ember shards" → raw "four ember shards" ✓ → "several ember shards" ✓.

Edge: two identical claims in one sentence "4 ember shards and 4 ember shards" → first replace fixes the first; second claim's raw still "4 ember shards" → the remaining first occurrence = the second ✓ sequential works.

redactNames:
```ts
function classify(claim: ProperNounClaim, clean: string[]): NameKind | null {
  for (const w of claim.words) {
    if (BOSS_WORDS.has(w)) return 'boss';
    if (PLACE_WORDS.has(w)) return 'place';
  }
  const from = Math.max(0, claim.start - 5);
  const to = Math.min(clean.length, claim.end + 5);
  for (let i = from; i < to; i++) {
    if (i >= claim.start && i < claim.end) continue;
    const w = clean[i] ?? '';
    if (BOSS_WORDS.has(w)) return 'boss';
    if (PLACE_WORDS.has(w)) return 'place';
  }
  return null;
}
```
Wait — clean tokens: the claim's span indices are in the raw token array; the clean array is aligned (1:1) ✓.

Hmm — danger: the window scan for a boss name could hit a place word: "The Duskfang Warden guards the Ember Altar." — Duskfang Warden's own token warden → boss ✓ short-circuit before window ✓. Ember Altar's own altar → place ✓. Good.

But the "Mirefen" window: from=4 to=15 (length 12 → to=12): i=4 'the'? wait the clean tokens: [ember, shards, grow, on, the, pale, reeds, along, the, mirefen, eastern, bank]. Mirefen claim start 9 end 10. from=4, to=12. i=4 'the' no, 5 'pale' no, 6 'reeds' no, 7 'along' — 'along' ∈ PLACE? I removed 'across','through'... 'along' — I had it in PLACE? I listed 'across','through' but not 'along'. 8 'the' no, 10 'eastern' ✓ → place ✓.

Replace:
```ts
function redactNames(sentence: string): string {
  let out = sentence;
  const claims = extractProperNounClaims(sentence);
  const rawTokens = tokenize(sentence);
  const cleanTokens = rawTokens.map(cleanToken);
  for (const claim of claims) {
    const kind = classify(claim, cleanTokens);
    if (kind === null) continue;
    const withArticle = kind === 'boss' ? 'a hidden boss' : 'a secret place';
    const bare = kind === 'boss' ? 'hidden boss' : 'secret place';
    let base = claim.phrase;
    let suffix = '';
    if (base.endsWith("'s") || base.endsWith('\u2019s')) {
      suffix = base.endsWith('\u2019s') ? '\u2019s' : "'s";
      base = base.slice(0, -2);
    }
    const prev = (rawTokens[claim.start - 1] ?? '').toLowerCase();
    let search: string;
    let replace: string;
    if (prev === 'a' || prev === 'an') {
      search = `${prev} ${base}`;
      replace = withArticle + suffix;
    } else if (prev === 'the') {
      search = base;
      replace = bare + suffix;
    } else {
      search = base;
      replace = withArticle + suffix;
    }
    out = out.replace(new RegExp(`\\b${escapeRegExp(search)}\\b`), replace);
  }
  return out;
}
```
Wait — the \b boundary after "Mirefen" and before the "'s" suffix... the base "Mirefen" is followed in the text by "'s" — \b between n and ' ✓ (n is a word char, ' is non-word) ✓.

Article consumption: "a Duskfang Warden" → search "a Duskfang Warden" → replace "a hidden boss" ✓. But the prev token is "a" only when the article is immediately preceding; the sentence "a certain Duskfang"? prev "certain" → default with article → "certain a hidden boss" — bad but rare; acceptable.

Hmm wait — for a claim with prev === 'the' — but if the phrase itself starts with a dropped "The"?? No: the claim's phrase never includes the leading "The" (dropped), the span starts at Duskfang, prev = "The" → prev.toLowerCase() = 'the' ✓.

Possessive + the: "the Mirefen's eastern bank": claim phrase "Mirefen's", base "Mirefen", suffix "'s", prev "the" → search "Mirefen" → replace "secret place's" → "the secret place's eastern bank" ✓.

Now, replace ordering: claims in document order; the first occurrence of each search is the claim position (as long as earlier replacements don't create/collide) ✓. One more: two different claims, the second claim's phrase text appears inside the first claim's span? Not possible (spans are disjoint, phrases are distinct).

But one real collision risk: the single-word claim "Ember" (sentence 1) is classified null → skipped ✓. In other scenarios where "Ember" is classified place (window) and "Ember Altar" also exists in the same sentence — the grouping merges consecutive capitals into one claim, so "Ember Altar" is a single claim; a standalone "Ember" claim would be elsewhere in the sentence; the replace of "Ember" (word boundary) first occurrence — if the "Ember Altar" claim (earlier in the sentence) is already replaced to "secret place", the remaining first "Ember" is the standalone one ✓ order works (document order).

redactToHint:
```ts
export function redactToHint(groundedFullText: string, question: string): string {
  const known = playerQuantities(question);
  return splitSentences(groundedFullText)
    .map((s) => redactNames(redactQuantities(s, known)))
    .join(' ');
}
```
Order: quantities first (their raw text is intact), then names (name phrases don't contain numbers) ✓.

Now — verify scenario 2 hint sentence 1's quantities: no numbers ✓ no change. Names: Ember null, Mirefen's place → "Ember shards grow on the pale reeds along the secret place's eastern bank." ✓.

Wait — verify redactQuantities for "You need 4 ember shards in all." with known [(2,[ember,shards])]: claim (4,[ember,shards]) raw "4 ember shards" → knownEnough? sameUnit ✓, 2 >= 4? No → replace → "several ember shards" → "You need several ember shards in all." ✓.

guide.service.ts — let me write it out:

```ts
import { REFUSAL_MESSAGE } from './guide.types.js';
import type { AnswerMode, GuideAnswer, LlmClient, WikiSource } from './guide.types.js';
import { isSentenceGrounded, splitSentences } from './grounder.js';
import { redactToHint } from './redactor.js';

export class GuideService {
  constructor(private readonly llm: LlmClient) {}

  async answer(question: string, sources: WikiSource[], mode: AnswerMode = 'full'): Promise<GuideAnswer> {
    if (sources.length === 0) {
      // No pages, no ground truth: refuse without consulting the model.
      return { status: 'refused', mode, text: '', refusalReason: REFUSAL_MESSAGE, droppedSentences: [], sourcesUsed: [] };
    }

    // Exactly one model call per answer, in both modes: hint mode is a
    // redaction of the grounded full answer, never a re-prompt.
    const raw = await this.llm.complete({ question, sources });
    const sentences = splitSentences(raw);

    const kept: string[] = [];
    const dropped: string[] = [];
    const sourcesUsed = new Set<string>();

    for (const sentence of sentences) {
      const verdict = isSentenceGrounded(sentence, sources);
      if (verdict.grounded) {
        kept.push(sentence);
        for (const source of sources) {
          if (isSentenceGrounded(sentence, [source]).grounded) sourcesUsed.add(source.id);
        }
      } else {
        dropped.push(sentence);
      }
    }

    if (kept.length === 0) {
      return { status: 'refused', mode, text: '', refusalReason: REFUSAL_MESSAGE, droppedSentences: dropped, sourcesUsed: [] };
    }

    const fullText = kept.join(' ');
    return {
      status: 'answered',
      mode,
      text: mode === 'hint' ? redactToHint(fullText, question) : fullText,
      refusalReason: null,
      droppedSentences: dropped,
      sourcesUsed: [...sourcesUsed],
    };
  }
}
```

Hmm — `isSentenceGrounded(sentence, [source])` re-indexes per source per sentence — fine at this scale.

scenarios.ts:

```ts
import { ALL_WIKI_PAGES } from '../guide/fixtures.js';
import type { WikiSource } from '../guide/guide.types.js';

export interface GoldenScenario {
  id: string;
  question: string;
  sources: WikiSource[];
  /** Phrases a correct answer must contain (case-insensitive, word-bounded). */
  expectedFacts: string[];
  /** Fabricated claims that must not appear in the answer. */
  plantedFalseFacts: string[];
}

export const KINDLE_ALTAR: GoldenScenario = {
  id: 'kindle-altar',
  question: 'How do I kindle the Ember Altar?',
  sources: ALL_WIKI_PAGES,
  expectedFacts: ['4 ember shards'],
  plantedFalseFacts: ['5 ember shards', 'Moonblade'],
};

export const SHARD_HUNT: GoldenScenario = {
  id: 'shard-hunt',
  question: 'I have 2 ember shards so far. What do I do next?',
  sources: ALL_WIKI_PAGES,
  expectedFacts: ['Duskfang Warden', 'ember shards'],
  plantedFalseFacts: ['5 ember shards', 'Moonblade'],
};

export const GOLDEN_SCENARIOS: GoldenScenario[] = [KINDLE_ALTAR, SHARD_HUNT];
```

judges.ts and harness.ts as drafted. Let me finalize the helpfulness boundary regex:
```ts
function containsFact(text: string, fact: string): boolean {
  const t = text.toLowerCase();
  const f = fact.toLowerCase().trim();
  if (f.length === 0) return true;
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(f)}(?:[^a-z0-9]|$)`);
  return re.test(t);
}
```
Fact "4 ember shards": in "demands 4 ember shards before" → before is space ✓ after is space ✓ ✓.
Fact "Duskfang Warden" in "The Duskfang Warden guards" ✓.
Fact "Moonblade" in "a Moonblade to" ✓.
Fact "5 ember shards" in "requires 5 ember shards and" ✓.

escapeRegExp in judges and redactor — duplicate a small helper in each file (or export from the grounder). I'll export `escapeRegExp` from the grounder? It's a text util... fine, I'll put it in the grounder and import. Or duplicate 4 lines in the two files — a small duplication is acceptable; exporting from the grounder is cleaner. I'll export from the grounder.

Now the full test file.

test/guide.spec.ts:

```ts
import { describe, expect, it } from 'vitest';
import { ALL_WIKI_PAGES, DUSKFANG_PAGE, EMBER_ALTAR_PAGE, MIREFEN_PAGE } from '../src/guide/fixtures.js';
import { isSentenceGrounded } from '../src/guide/grounder.js';
import { GuideService } from '../src/guide/guide.service.js';
import { redactToHint } from '../src/guide/redactor.js';
import { ScriptedLlmClient } from '../src/guide/scripted-llm-client.js';
import { REFUSAL_MESSAGE } from '../src/guide/guide.types.js';

const KINDLE_QUESTION = 'How do I kindle the Ember Altar?';
const CORRECT_KINDLE = 'The Ember Altar demands 4 ember shards before it can be kindled.';
const FAKE_ITEM_SENTENCE = 'A Moonblade is also required.';
const NEXT_QUESTION = "I have 2 ember shards so far. What do I do next?";
const NEXT_REPLY =
  "Ember shards grow on the pale reeds along the Mirefen's eastern bank. " +
  'The Duskfang Warden guards the Ember Altar. ' +
  'You need 4 ember shards in all.';

function serviceWith(replies: Array<{ match: RegExp | string; reply: string }>): { service: GuideService; llm: ScriptedLlmClient } {
  const llm = new ScriptedLlmClient(replies);
  return { service: new GuideService(llm), llm };
}

describe('GuideService.answer (full mode)', () => {
  it('returns the model answer untouched when every sentence is grounded', async () => {
    const { service } = serviceWith([{ match: 'kindle', reply: CORRECT_KINDLE }]);
    const res = await service.answer(KINDLE_QUESTION, ALL_WIKI_PAGES, 'full');
    expect(res.status).toBe('answered');
    expect(res.mode).toBe('full');
    expect(res.text).toBe(CORRECT_KINDLE);
    expect(res.droppedSentences).toEqual([]);
    expect(res.refusalReason).toBeNull();
    expect(res.sourcesUsed).toContain('ember-altar');
  });

  it('drops ungrounded sentences and keeps the grounded ones', async () => {
    const { service } = serviceWith([{ match: 'kindle', reply: `${CORRECT_KINDLE} ${FAKE_ITEM_SENTENCE}` }]);
    const res = await service.answer(KINDLE_QUESTION, ALL_WIKI_PAGES, 'full');
    expect(res.status).toBe('answered');
    expect(res.text).toBe(CORRECT_KINDLE);
    expect(res.droppedSentences).toEqual([FAKE_ITEM_SENTENCE]);
  });

  it('refuses with the exact phrase when the sources lack the answer', async () => {
    const { service } = serviceWith([
      { match: 'defeat', reply: 'The Duskfang Warden falls to 3 frost arrows. It weakens at dawn.' },
    ]);
    const res = await service.answer('How do I defeat the Duskfang Warden?', [EMBER_ALTAR_PAGE], 'full');
    expect(res.status).toBe('refused');
    expect(res.refusalReason).toBe(REFUSAL_MESSAGE);
    expect(res.refusalReason).toBe('not covered by my sources');
    expect(res.text).toBe('');
    expect(res.droppedSentences).toHaveLength(2);
  });

  it('refuses immediately without calling the model when no sources are given', async () => {
    const { service, llm } = serviceWith([{ match: '.', reply: 'Sure, do the thing.' }]);
    const res = await service.answer('Anything', [], 'full');
    expect(res.status).toBe('refused');
    expect(res.refusalReason).toBe(REFUSAL_MESSAGE);
    expect(llm.callCount).toBe(0);
  });

  it('fails loudly when the scripted model has no reply for the question', async () => {
    const { service } = serviceWith([{ match: 'kindle', reply: CORRECT_KINDLE }]);
    await expect(service.answer('What is the weather?', ALL_WIKI_PAGES)).rejects.toThrow(/no scripted reply/);
  });
});

describe('grounding gate', () => {
  it('catches a quantity error exactly: 5 shards fails when the sources say 4', () => {
    const lie = isSentenceGrounded('You need 5 ember shards.', [EMBER_ALTAR_PAGE, MIREFEN_PAGE]);
    expect(lie.grounded).toBe(false);
    expect(lie.reasons.join(' ')).toMatch(/quantity "5 ember shards"/);
  });

  it('accepts the quantity the sources actually state', () => {
    const truth = isSentenceGrounded('You need 4 ember shards.', [EMBER_ALTAR_PAGE, MIREFEN_PAGE]);
    expect(truth.grounded).toBe(true);
    expect(truth.reasons).toEqual([]);
  });

  it('rejects invented item names even when the sentence is fluent', () => {
    const v = isSentenceGrounded(FAKE_ITEM_SENTENCE, ALL_WIKI_PAGES);
    expect(v.grounded).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/Moonblade/);
  });

  it('refuses end-to-end when the only reply carries the wrong quantity', async () => {
    const { service } = serviceWith([{ match: 'kindle', reply: 'You need 5 ember shards.' }]);
    const res = await service.answer(KINDLE_QUESTION, ALL_WIKI_PAGES, 'full');
    expect(res.status).toBe('refused');
    expect(res.droppedSentences).toEqual(['You need 5 ember shards.']);
  });
});
```
Verify "You need 4 ember shards." fully: quantity ✓ (page 1). Proper nouns: none ("You" is a starter). Content: shards (need is stopword) → shards in source ✓ 1/1 → grounded, reasons [] ✓.
Verify "You need 5 ember shards." reasons: quantity "5 ember shards" ✓ reason string: `quantity "5 ember shards" is not stated in any source` → toMatch(/quantity "5 ember shards"/) ✓.

Hint tests:

```ts
describe('hint mode', () => {
  it('redacts boss names, place names and unknown quantities from the grounded answer', async () => {
    const { service } = serviceWith([{ match: 'do next', reply: NEXT_REPLY }]);
    const res = await service.answer(NEXT_QUESTION, ALL_WIKI_PAGES, 'hint');
    expect(res.status).toBe('answered');
    expect(res.mode).toBe('hint');
    expect(res.text).toBe(
      "Ember shards grow on the pale reeds along the secret place's eastern bank. " +
      'The hidden boss guards the secret place. ' +
      'You need several ember shards in all.',
    );
    expect(res.text).not.toContain('Mirefen');
    expect(res.text).not.toContain('Duskfang');
    expect(res.text).not.toContain('4 ember shards');
  });

  it('is derived from the full answer by redaction, with a single model call (no re-prompt)', async () => {
    const { service, llm } = serviceWith([{ match: 'do next', reply: NEXT_REPLY }]);
    const full = await service.answer(NEXT_QUESTION, ALL_WIKI_PAGES, 'full');
    const hint = await service.answer(NEXT_QUESTION, ALL_WIKI_PAGES, 'hint');
    expect(llm.callCount).toBe(2);
    expect(redactToHint(full.text, NEXT_QUESTION)).toBe(hint.text);
    expect(hint.text).not.toBe(full.text);
  });

  it('keeps a quantity the player already mentioned', async () => {
    const question = 'I have 4 ember shards. What do I do next?';
    const { service } = serviceWith([{ match: 'do next', reply: 'You need 4 ember shards in all.' }]);
    const res = await service.answer(question, ALL_WIKI_PAGES, 'hint');
    expect(res.status).toBe('answered');
    expect(res.text).toBe('You need 4 ember shards in all.');
  });
});
```
Verify "keeps a quantity the player already mentioned": grounded? "You need 4 ember shards in all." ✓ (quantity 4 ✓, content shards ✓). Hint: player (4,[ember,shards]) → 4>=4 keep ✓. Names: none. → identical text ✓.

Verify the "derived" test: full.text = NEXT_REPLY (all grounded ✓ as verified earlier). redactToHint(full.text, question) === hint.text by construction ✓ (both call the same function on the same input — well that's tautological; the real proof is the exact expected string in the previous test + callCount 2 showing one call per answer and the prompt being mode-agnostic). Hmm — the prompt: should I assert that the prompt is mode-agnostic? The LlmPrompt has no mode field → structural proof ✓. callCount: two answer() calls → 2 completions, one each → no re-prompting within a single hint answer ✓.

Also verify NEXT_REPLY sentence 1 hint: earlier derived "along the secret place's eastern bank" ✓ (prev "the").

test/eval.spec.ts:

```ts
import { describe, expect, it } from 'vitest';
import { GOLDEN_SCENARIOS, KINDLE_ALTAR, SHARD_HUNT } from '../src/eval/scenarios.js';
import { runScenario, runSuite, PASS_THRESHOLD } from '../src/eval/harness.js';
import { faithfulnessJudge, helpfulnessJudge } from '../src/eval/judges.js';
import { ALL_WIKI_PAGES } from '../src/guide/fixtures.js';
import { GuideService } from '../src/guide/guide.service.js';
import { ScriptedLlmClient } from '../src/guide/scripted-llm-client.js';

const CORRECT_KINDLE = 'The Ember Altar demands 4 ember shards before it can be kindled.';
const CONFIDENT_LIE = 'The Ember Altar requires 5 ember shards and a Moonblade to kindle.';

describe('eval harness', () => {
  it('scores a correct grounded answer high (helpfulness and faithfulness both 1)', async () => {
    const service = new GuideService(new ScriptedLlmClient([{ match: 'kindle', reply: CORRECT_KINDLE }]));
    const report = await runScenario(service, KINDLE_ALTAR);
    expect(report.answer.status).toBe('answered');
    expect(report.helpfulness.score).toBe(1);
    expect(report.faithfulness.score).toBe(1);
    expect(report.finalScore).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    expect(report.pass).toBe(true);
  });

  it('scores a scripted confident lie low', async () => {
    const service = new GuideService(new ScriptedLlmClient([{ match: 'kindle', reply: CONFIDENT_LIE }]);
    const report = await runScenario(service, KINDLE_ALTAR);
    expect(report.finalScore).toBeLessThan(0.4);
    expect(report.pass).toBe(false);
  });
```
Typo watch: closing paren.

Wait — let me verify the lie is fully dropped: "The Ember Altar requires 5 ember shards and a Moonblade to kindle."
- Quantities: "5" unit: ember ✓, shards ✓, then "and" trim ✓ → (5,[ember,shards]) → ✗ all sources (only 4) → reason.
- Proper nouns: group from i=0: The, Ember, Altar → drop The → claim [Ember,Altar] ✓ in source (ember, altar both in page 1 ✓). "Moonblade" mid-sentence → claim ✗ not in source → reason.
- Content: ember ✓, altar ✓, requires ✗, shards ✓, moonblade ✗, kindled? "kindle" (6) — the source has "kindled" not "kindle" → ✗. Hits: ember, altar, shards = 3/6 = 0.5 → passes the content check (0.5 is not < 0.5). But quantity + name reasons → ungrounded → dropped ✓.
→ refusal → helpfulness 0 (empty), faithfulness 1 (no claims) → final 0 ✓ < 0.4 ✓ pass false ✓.

```ts
  it('uses the min of the two judges as the final score', async () => {
    const service = new GuideService(new ScriptedLlmClient([
      { match: 'do next', reply: 'The Duskfang Warden guards the Ember Altar.' },
    ]));
    const report = await runScenario(service, SHARD_HUNT);
    expect(report.faithfulness.score).toBe(1);
    expect(report.helpfulness.score).toBeCloseTo(0.5);
    expect(report.finalScore).toBeCloseTo(0.5);
    expect(report.finalScore).toBe(Math.min(report.helpfulness.score, report.faithfulness.score));
    expect(report.pass).toBe(false); // 0.5 < 0.8
  });
```
Verify SHARD_HUNT expectedFacts ['Duskfang Warden','ember shards'] against "The Duskfang Warden guards the Ember Altar.": Duskfang Warden ✓; "ember shards"? The text contains "Ember Altar" → "ember shards" absent ✓ → 0.5 ✓. Faithfulness: sentence grounded against ALL_WIKI_PAGES ✓ 1.0 ✓.

```ts
  it('faithfulness judge catches a planted quantity error on ungated text', () => {
    const verdict = faithfulnessJudge('The altar requires 5 ember shards.', ALL_WIKI_PAGES, ['5 ember shards']);
    expect(verdict.score).toBe(0);
    expect(verdict.findings.join(' ')).toMatch(/planted false fact present: "5 ember shards"/);
  });

  it('faithfulness judge rewards fully supported text', () => {
    const verdict = faithfulnessJudge(CORRECT_KINDLE, ALL_WIKI_PAGES, ['5 ember shards', 'Moonblade']);
    expect(verdict.score).toBe(1);
    expect(verdict.findings).toEqual([]);
  });

  it('helpfulness judge scores partial fact coverage proportionally', () => {
    const verdict = helpfulnessJudge('The altar is in the Mirefen.', ['4 ember shards', 'the Mirefen']);
    expect(verdict.score).toBeCloseTo(0.5);
    expect(verdict.findings.join(' ')).toMatch(/4 ember shards/);
  });

  it('helpfulness judge gives 0 to a refusal', () => {
    const verdict = helpfulnessJudge('', ['4 ember shards']);
    expect(verdict.score).toBe(0);
  });

  it('runs the whole suite and every report obeys finalScore = min(judges)', async () => {
    const service = new GuideService(new ScriptedLlmClient([
      { match: 'kindle', reply: CORRECT_KINDLE },
      { match: 'do next', reply: 'Ember shards grow on the pale reeds along the Mirefen\'s eastern bank. The Duskfang Warden guards the Ember Altar. You need 4 ember shards in all.' },
    ]));
    const reports = await runSuite(service, GOLDEN_SCENARIOS);
    expect(reports.map((r) => r.scenarioId)).toEqual(['kindle-altar', 'shard-hunt']);
    for (const r of reports) {
      expect(r.finalScore).toBe(Math.min(r.helpfulness.score, r.faithfulness.score));
      expect(r.pass).toBe(r.finalScore >= PASS_THRESHOLD);
    }
    expect(reports.every((r) => r.pass)).toBe(true);
  });
```
Verify shard-hunt correct full: expectedFacts ['Duskfang Warden' ✓, 'ember shards' ✓ (in "Ember shards grow")] → helpfulness 1 ✓. Faithfulness 1 ✓ → pass ✓.

Verify "The altar is in the Mirefen." — helpfulness: "4 ember shards" ✗, "the Mirefen" ✓ (text "in the Mirefen." → "the mirefen" boundary: before is space, after is "." ✓) → 0.5 ✓.

Now — faithfulness "rewards fully supported text": CORRECT_KINDLE grounded ✓ (verified) → sentenceRatio 1, no planted → findings [] → score 1 ✓.

Wait, the findings in that test: sentenceRatio 1 → no finding; planted none → findings [] ✓.

One more — the harness refusal-faithfulness: the lie scenario → answer.text '' → faithfulness {score 1, findings ['no claims made (refusal)']} → final min(0,1)=0 ✓.

Let me verify the harness file imports: GuideService type — `import type { GuideService }` ✓ (class used only as a type).

Now let me re-scan strict TS issues:

1. `WORD_NUMBERS[t.toLowerCase()]` — Record<string,string> with noUncheckedIndexedAccess → string|undefined ✓ I use truthy.
2. `tokens[i] ?? ''` pattern everywhere ✓.
3. In extractQuantityClaims: `unit.map((_, idx) => tokens[i + 1 + idx] ?? '')` — `_` unused param → noUnusedParameters? I didn't enable it in tsconfig — but I could; let me not enable noUnusedLocals/Parameters to reduce risk? strict doesn't include those. I'll leave them off. Fine.
4. verbatimModuleSyntax: all type-only imports use `import type` ✓ check each file.
5. Classes: `private readonly llm: LlmClient` parameter property ✓.
6. `Number(claim.number)` — "4" → 4 ✓.

The redactor's classify uses claim.words (cleaned) — BOSS_WORDS/PLACE_WORDS are lowercase ✓.

One concern — the redactor's `tokenize` import is used for rawTokens ✓; `cleanToken` is used for cleanTokens ✓.

In the grounder, do I export escapeRegExp? Let me define it in the grounder and export; the judges + redactor import it.

Now — the apostrophe in MIREFEN_PAGE text: I'll use a double-quoted string or an escaped single quote. I'll write the text with double quotes: text: "The Mirefen is a flooded valley south of Ashbridge. Ember shards grow on the pale reeds along the Mirefen's eastern bank. The water is ankle-deep by day and deep by night. Frost gates stand across the only path out." — double quotes with an internal ' ✓.

Wait — "Frost gates stand across the only path out." — "Frost" is capitalized mid-sentence! If an answer quotes this: "Frost gates stand across the only path out." → proper noun claim "Frost" → in source ✓ (frost in page 2) → fine.

And DUSKFANG: "It drops a warden sigil after a clean defeat." — "defeat" is in BOSS_WORDS ✓ (for the window classification if "warden sigil" is a name... it's lowercase, not a claim — irrelevant).

Let me re-verify the full grounding of SHARD reply sentence 2 against ALL pages: "The Duskfang Warden guards the Ember Altar." — content words: duskfang ✓ (page 3), warden ✓, guards ✓ (page 3 "guards the Ember Altar"), altar ✓ → all ✓.

And sentence 1 content: ember ✓, shards ✓, grow ✓, pale ✓, reeds ✓, mirefen ✓, eastern ✓, bank ✓ — all in page 2 ✓ (8/8).

Proper nouns in sentence 1: "Ember" (claim — in source ✓), "Mirefen's" → mirefen ✓.

Quantities in sentence 1: none ✓.

Good.

Now, one more potential pitfall: **the lookbehind in splitSentences** — "bank. The" ✓. In NEXT_REPLY, the sentences are joined with " " — split ✓ 3 sentences.

**The ScriptedLlmClient's match 'do next'** — question "I have 2 ember shards so far. What do I do next?" — contains "do next"? "do I do next" — the substring "do next" — "do I do next" — "do next" is not contiguous! "do I do next" → "do next" is absent (there's "I" in between)!! Bug. Let me change the match to 'do I do next'? Or use a RegExp /do next/ — same problem. Use match: 'What do' ✓ present. Or 'so far'. Let me use `match: 'so far'` for the NEXT question, and 'kindle' for kindle. And for the "I have 4 ember shards. What do I do next?" test — 'so far' absent!! That question: "I have 4 ember shards. What do I do next?" — match 'What do' ✓ present in both. Let me use 'What do' for both. Kindling: 'kindle' ✓ distinct.

Check the suite test: same scripts ✓.

And the lie/correct test uses 'kindle' ✓.

The guide hint test also uses 'What do' — I'll update.

Also the defeat question: 'defeat' ✓.

The "no sources" test: the script match 'anything' isn't used (callCount 0) ✓.

Now — **the exact expected hint string**: let me re-derive with the article logic:
Sentence 1: "...along the Mirefen's eastern bank." → claim Mirefen's, prev token = "the" (token at index 8) → search "Mirefen", replace "secret place's" → "along the secret place's eastern bank" ✓.
Sentence 2: "The Duskfang Warden guards the Ember Altar." → Duskfang Warden prev "The"→'the' → "The hidden boss guards the Ember Altar." then Ember Altar prev "the" → "The hidden boss guards the secret place." ✓.
Sentence 3: "You need 4 ember shards in all." → quantities → "You need several ember shards in all." Names: none.
Final: "Ember shards grow on the pale reeds along the secret place's eastern bank. The hidden boss guards the secret place. You need several ember shards in all." ✓ matches the test.

**Verify redactNames replacement order in sentence 2**: claims in order: [Duskfang Warden (start1), Ember Altar (start5)]. First: out.replace(/\bDuskfang Warden\b/, 'hidden boss') → "The hidden boss guards the Ember Altar." ✓. Second: prev token from the original rawTokens (computed once before the loop) — rawTokens[5-1]=rawTokens[4]="the" ✓ → replace "Ember Altar" → "secret place" ✓. (I use the original token array for prev — since the spans are fixed from the original sentence ✓.)

Wait — in my redactNames, prev is computed from the original rawTokens array (computed once before the loop) — ✓ correct even after replacements.

**Verify the \b boundary in "Duskfang Warden"**: "The Duskfang Warden guards" → \bDuskfang Warden\b ✓.

Now the **grounder's content check for a sentence with zero content words but with a proper noun not in the source** — e.g., "Moonblade." → proper noun claim ✗ → ungrounded ✓ (the content check is an additional layer, not the only one).

**A pure-filler sentence "Yes."** → no claims, no content (yes is 3 letters) → grounded → kept. Acceptable ("Yes." is harmless).

Now **the tsconfig `types: ["node"]`** — do I need node types? I don't use process/Buffer in src... not needed. I'll drop "types" (vitest's globals aren't used; I import from 'vitest'). Without "types", tsc includes all @types — @types/node is installed anyway. Let me drop the types field.

**package.json engines**: add `"engines": { "node": ">=20" }`? Optional; the convention is Node 20+. I'll add it, harmless.

**pnpm** — the convention says pnpm as the package manager; I won't create a pnpm-lock.yaml (I can't compute hashes). The package.json is pnpm-compatible. Fine.

Now, let me reconsider: does anything need NestJS? "Wiring" conventions (module providers/exports) apply "if" you're using NestJS. The task has no API surface (no endpoints, no mention of DB). I'm confident the plain TS reading is right; the layering spirit (service holds logic, client is injected) is preserved. I won't add an ASSUMPTION comment about this — it's a scope judgment, and the format allows one ASSUMPTION comment only where a symbol is unresolved. Actually — the instructions: "If a symbol you need is truly absent from the task, don't guess in silence... mark it with one // ASSUMPTION". Nothing is truly absent; the stack question is a design choice, not an unresolved symbol. I'll add minimal ASSUMPTION markers only where genuinely needed:

- In redactor: the decision to leave item names unredacted — that's a contract interpretation: "must not reveal boss names, item locations, or quantities beyond what the player already mentioned" — one could read "item locations" as requiring item names hidden too? No — it says locations. I'll add one ASSUMPTION comment in the redactor: `// ASSUMPTION: the spoiler contract forbids boss names, item locations and quantities, not item names.` That's a genuinely interpretive point — good.
- In the hint quantity rule: "beyond what the player already mentioned" — I interpret it as: reveal N only if the player's stated M ≥ N. That's also an interpretation: `// ASSUMPTION: a quantity N may be revealed only when the player already mentioned at least N of the same resource.` Good, one more.

The instructions say to mark with one ASSUMPTION comment "at the point it matters" — per unresolved point. Two small ones is fine.

Now let me finalize the file contents.

Let me double-check `extractQuantityClaims` for the question "I have 2 ember shards so far. What do I do next?":
Tokens: I, have, 2, ember, shards, so, far, What, do, I, do, next.
i=2 "2" → number "2"; unit: k=1 "ember" ✓ push; k=2 "shards" ✓ push; k=3 "so" → UNIT_TRIM ✓ break. unit [ember, shards] ✓.
No other numbers ✓.

playerQuantities → [{number:2, unit:[ember,shards]}] ✓.

**One more edge in redactQuantities**: claim.raw is built from the original tokens: tokens[i]='2'? In the answer "You need 4 ember shards in all." raw = "4 ember shards" ✓.

Also — a word-number claim raw: "four ember shards" → replace with "several ember shards" ✓.

Now the harness's `runScenario` — the answer mode is 'full' ✓ (the harness evaluates the full answer; hint is covered separately).

Let me also think about whether `helpfulnessJudge` should treat refusal specially — empty text → 0 ✓ already.

**Faithfulness of a partial grounded answer where the gate already dropped bad sentences** — the answer text contains only grounded sentences → sentenceRatio 1 → the judge is 1.0, except planted-fact containment. Note: a planted false fact like "5 ember shards" can't appear in gated text (it would have been dropped)... except if the lie was *coherent* with the source yet still "false" per the planted list? The planted facts are by construction not in the source, so the gate would drop sentences containing them. The judge's planted check is a belt-and-suspenders (e.g., if the gate's heuristic misses). Fine — the test proves the judge layer works in isolation.

Now let me write the CONTENT_STOP_WORDS list carefully (dedup, no trailing comma issues — TS is fine with trailing commas).

Final list:
'the','and','that','this','these','those','with','from','your','yours','you','have','has','had','are','was','were','been','being','can','could','would','should','will','shall','may','might','must','need','needs','needed','do','does','did','about','before','after','above','below','under','over','then','than','when','where','what','which','who','whom','how','why','here','there','out','off','up','down','into','onto','in','on','at','to','for','of','a','an','it','its','they','them','their','he','she','his','her','our','us','we','if','but','or','nor','so','not','no','yes','all','any','both','each','few','more','most','other','some','such','only','own','same','too','very','just','also','way','make','makes','made','take','takes','taken','get','gets','got','come','comes','back','first','last','new','old','long','short','little','big','many','much','still','even','ever','never','always','often','once','every'

Note: 'way' — "lights the way out" — way is in source anyway; as a stopword it's excluded from content — fine.

COMMON_SENTENCE_STARTERS:
'The','A','An','It','This','These','That','Those','If','When','While','You','Your','He','She','They','We','I','Yes','No','So','And','But','Or','To','Is','Are','Was','Were','Do','Does','Did','Can','Could','Should','Would','May','Might','Note','Tip','Remember','In','On','At','With','Without','After','Before','Once','Until'

UNIT_TRIM:
'the','a','an','of','in','on','at','to','for','with','and','or','so','far','more','left','yet','your','my','you','i','is','are','was','were','be','been','being','need','needs','needed','have','has','had','its','it','this','that','them','then','all','about','around','over','under','across','along','before','after','can','could','will','would','should','may','might','must','make','makes','made','take','takes','taken','get','gets','got','do','does','did','not','no','yes','if','when','where','while','which','who','how','why','as','but','also','only','very','too','just','such','each','few','many','much','most','other','some','any','both','own','same','way','long','short','little','big'

Check: "You need 4 ember shards in all." — after shards: "in" ✓ trim.
"demands 4 ember shards before it can be kindled" — after shards: "before" ✓ trim → unit [ember, shards] ✓ (source matching: 4, ember, shards ✓).

Now — the **quantityInSource window `+2` slack**: source "4 ember shards" exactly — no slack needed ✓.

Let me also sanity-check **the "You need 5 ember shards." gate test reasons** — reasons[0] = `quantity "5 ember shards" is not stated in any source` — my toMatch(/quantity "5 ember shards"/) ✓ (regex with quotes — fine).

Now, the **service refusal test** asserts `res.droppedSentences` toHaveLength(2) ✓.

Let me also confirm the **exact string of REFUSAL_MESSAGE**: 'not covered by my sources' ✓ (the task's phrasing).

Now, one more requirement scan of the task:

1. ✅ `answer(question, sources, mode)` — the method signature matches; an injectable LLM client via constructor (ScriptedLlmClient provided).
2. ✅ Sentence-level grounding gate — drop ungrounded; refuse with "not covered by my sources" when nothing remains.
3. ✅ Hint mode is a redaction of the complete grounded answer, no re-prompt (single call; tests assert).
   - ✅ Must not reveal boss names (Duskfang Warden → hidden boss), item locations (Mirefen → secret place), quantities beyond player-mentioned (4 → several given 2).
4. ✅ Evaluation harness: golden scenarios with question, sources, expected facts, planted false facts (Moonblade, 5 shards); helpfulness judge + faithfulness judge receiving sources; final = min.
5. ✅ Tests: lie scores low; correct scores high; lack → refusal; quantity 5 vs 4 caught accurately (gate + judge + end-to-end).

"2–3 fetched wiki page texts (provided as fixtures)" — fixtures provide 3 pages ✓; scenarios use them ✓.

Layout: follows src/<feature>/..., test/<feature>.spec.ts ✓. Kebab-case files, PascalCase classes, snake_case... no DB so no @map. Endpoints — none (no API). Error envelope — no API errors; the refusal carries the exact message; no JSON API, so the envelope N/A. I think that's consistent: the conventions apply "to what's built".

Wait — should the refusal message be "developer-facing English" per the error conventions? The task explicitly specifies the refusal string "not covered by my sources" — the task wins.

Now, file header comments — keep them concise, English.

Let me also confirm no unused imports per file (TS won't error without noUnusedLocals, but I'll keep it clean):

- guide.types.ts: no imports.
- grounder.ts: import type WikiSource ✓ used.
- redactor.ts: imports cleanToken, extractProperNounClaims, extractQuantityClaims, splitSentences, tokenize, escapeRegExp, type ProperNounClaim? classify takes claim: ProperNounClaim — need the type import ✓. NameKind type is local.
- guide.service.ts: REFUSAL_MESSAGE, types, grounder functions, redactToHint ✓.
- scripted-llm-client.ts: types ✓.
- fixtures.ts: WikiSource ✓.
- scenarios.ts: ALL_WIKI_PAGES, WikiSource type ✓.
- judges.ts: WikiSource type, GoldenScenario? — my judges take primitives (answerText, sources, facts) — no need for the scenario import. escapeRegExp, isSentenceGrounded, splitSentences ✓.
- harness.ts: GuideService type, JudgeVerdict + judges, GoldenScenario, GuideAnswer type ✓.

The GuideAnswer type in harness: used in the ScenarioReport interface ✓.

Let me write out the harness:

```ts
import type { GuideService } from '../guide/guide.service.js';
import type { GuideAnswer } from '../guide/guide.types.js';
import { faithfulnessJudge, helpfulnessJudge } from './judges.js';
import type { JudgeVerdict } from './judges.js';
import type { GoldenScenario } from './scenarios.js';

/** A scenario passes when the final score reaches this bar. */
export const PASS_THRESHOLD = 0.8;

export interface ScenarioReport {
  scenarioId: string;
  answer: GuideAnswer;
  helpfulness: JudgeVerdict;
  faithfulness: JudgeVerdict;
  /** min(helpfulness, faithfulness) — one weak judge sinks the scenario. */
  finalScore: number;
  pass: boolean;
}

export async function runScenario(service: GuideService, scenario: GoldenScenario): Promise<ScenarioReport> {
  const answer = await service.answer(scenario.question, scenario.sources, 'full');
  const helpfulness = helpfulnessJudge(answer.text, scenario.expectedFacts);
  const faithfulness = faithfulnessJudge(answer.text, scenario.sources, scenario.plantedFalseFacts);
  const finalScore = Math.min(helpfulness.score, faithfulness.score);
  return {
    scenarioId: scenario.id,
    answer,
    helpfulness,
    faithfulness,
    finalScore,
    pass: finalScore >= PASS_THRESHOLD,
  };
}

export async function runSuite(service: GuideService, scenarios: GoldenScenario[]): Promise<ScenarioReport[]> {
  const reports: ScenarioReport[] = [];
  for (const scenario of scenarios) {
    reports.push(await runScenario(service, scenario));
  }
  return reports;
}
```

judges.ts:

```ts
import type { WikiSource } from '../guide/guide.types.js';
import { escapeRegExp, isSentenceGrounded, splitSentences } from '../guide/grounder.js';

export interface JudgeVerdict {
  /** 0..1 */
  score: number;
  findings: string[];
}

function containsFact(text: string, fact: string): boolean {
  const t = text.toLowerCase();
  const f = fact.toLowerCase().trim();
  if (f.length === 0) return true;
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(f)}(?:[^a-z0-9]|$)`).test(t);
}

/**
 * Helpful = covers the expected facts. A refusal covers nothing.
 */
export function helpfulnessJudge(answerText: string, expectedFacts: string[]): JudgeVerdict {
  if (answerText.trim().length === 0) {
    return { score: 0, findings: ['answer is empty (refusal) — no expected fact can be covered'] };
  }
  const findings: string[] = [];
  let hits = 0;
  for (const fact of expectedFacts) {
    if (containsFact(answerText, fact)) hits += 1;
    else findings.push(`missing expected fact: "${fact}"`);
  }
  return { score: expectedFacts.length === 0 ? 1 : hits / expectedFacts.length, findings };
}

/**
 * Faithful = every sentence is supported by the sources and no planted
 * false fact slips through. Receives the sources, not the scenario.
 */
export function faithfulnessJudge(answerText: string, sources: WikiSource[], plantedFalseFacts: string[]): JudgeVerdict {
  if (answerText.trim().length === 0) {
    return { score: 1, findings: ['no claims made (refusal)'] };
  }
  const findings: string[] = [];
  const sentences = splitSentences(answerText);
  const supported = sentences.filter((s) => isSentenceGrounded(s, sources).grounded).length;
  const sentenceRatio = sentences.length === 0 ? 1 : supported / sentences.length;
  if (sentenceRatio < 1) {
    findings.push(`${sentences.length - supported} of ${sentences.length} sentences are not supported by the sources`);
  }
  for (const fact of plantedFalseFacts) {
    if (containsFact(answerText, fact)) findings.push(`planted false fact present: "${fact}"`);
  }
  if (findings.some((f) => f.startsWith('planted false fact'))) {
    return { score: 0, findings };
  }
  return { score: sentenceRatio, findings };
}
```

Check the lie-ungated test: "The altar requires 5 ember shards." → sentences [1]; supported: quantity 5 ✗ → 0 → finding "1 of 1 ..."; planted "5 ember shards" ✓ finding; → score 0, findings join contains `planted false fact present: "5 ember shards"` ✓ toMatch(/planted false fact present: "5 ember shards"/) ✓.

Now the grounder's escapeRegExp export:
```ts
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

The redactor imports it ✓.

Now let me assemble the complete grounder.ts:

```ts
import type { WikiSource } from './guide.types.js';

/**
 * Sentence-level grounding gate for the gameplay assistant.
 *
 * A sentence is grounded only if every detectable factual claim in it is
 * present in the provided wiki pages:
 *   1. quantity claims ("5 ember shards") must match number + unit words in a source,
 *   2. proper-noun claims ("Duskfang Warden") must appear in a source,
 *   3. at least half of the sentence's content words must appear in a source.
 *
 * The gate is a deterministic heuristic rather than an NLP model: it catches
 * invented names and wrong quantities exactly, and filters out sentences whose
 * vocabulary has no overlap with the sources.
 */

export interface GroundingVerdict {
  grounded: boolean;
  /** Why the sentence failed the gate; empty when grounded. */
  reasons: string[];
}

export interface QuantityClaim {
  /** Original claim text, e.g. "5 ember shards". */
  raw: string;
  /** Normalized value, e.g. "5" (word numbers normalized to digits). */
  number: string;
  /** Original numeric token, e.g. "five". */
  numberRaw: string;
  /** Unit words after the number, cleaned, e.g. ["ember", "shards"]. */
  unit: string[];
}

export interface ProperNounClaim {
  /** Original phrase, e.g. "Duskfang Warden". */
  phrase: string;
  /** Cleaned words, e.g. ["duskfang", "warden"]. */
  words: string[];
  /** Token span in the sentence (end exclusive). */
  start: number;
  end: number;
}

const WORD_NUMBERS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13',
  fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18',
  nineteen: '19', twenty: '20',
};

const TOKEN_SPLIT = /[^A-Za-z0-9'\u2019-]+/;
const CAPITAL_TOKEN = /^[A-Z][A-Za-z'\u2019-]*$/;
const WORD_TOKEN = /^[A-Za-z][A-Za-z'\u2019-]*$/;
const BARE_NUMBER = /^[0-9]+(?:\.[0-9]+)?$/;

/** Lowercase, drop possessive 's, normalize word numbers to digits. */
export function cleanToken(token: string): string {
  let t = token.toLowerCase();
  if (t.endsWith("'s")) t = t.slice(0, -2);
  return WORD_NUMBERS[t] ?? t;
}

export function tokenize(text: string): string[] {
  return text.split(TOKEN_SPLIT).filter((t) => t.length > 0);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Splits on terminal punctuation; the unit of the grounding gate. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const CONTENT_STOP_WORDS = new Set([...]);
const COMMON_SENTENCE_STARTERS = new Set([...]);
const UNIT_TRIM = new Set([...]);

interface SourceIndex {
  tokens: string[];
  set: Set<string>;
}

function indexSource(source: WikiSource): SourceIndex {
  const tokens = tokenize(source.text).map(cleanToken);
  return { tokens, set: new Set(tokens) };
}

export function extractQuantityClaims(sentence: string): QuantityClaim[] {
  const tokens = tokenize(sentence);
  const claims: QuantityClaim[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? '';
    let number: string | null = null;
    if (BARE_NUMBER.test(t)) {
      number = t;
    } else {
      number = WORD_NUMBERS[t.toLowerCase()] ?? null;
    }
    if (number === null) continue;

    const unit: string[] = [];
    for (let k = 1; k <= 3; k++) {
      const u = tokens[i + k];
      if (u === undefined || !WORD_TOKEN.test(u)) break;
      const cu = cleanToken(u);
      if (UNIT_TRIM.has(cu)) break;
      unit.push(cu);
    }

    claims.push({
      raw: [t, ...unit.map((_, offset) => tokens[i + 1 + offset] ?? '')].join(' '),
      number,
      numberRaw: t,
      unit,
    });
  }
  return claims;
}
```
Hmm — raw uses the cleaned unit words, not the originals; for a word-number unit "four pale reeds"? The unit is cleaned (lowercased) — raw "four pale reeds" is the same anyway (the lowercase original). If the original had capitals "4 Ember Shards" → the cleaned unit would be lowercase → raw "4 ember shards" ≠ the original "4 Ember Shards" → the redactor's replace regex wouldn't match the original text!! The redactor's claim.raw is used for string replacement. Fix: keep the original unit tokens in the claim too:
```ts
export interface QuantityClaim {
  raw: string;
  number: string;
  numberRaw: string;
  unit: string[];        // cleaned
  unitRaw: string[];     // original casing
}
```
raw = [t, ...unitRaw].join(' ') ✓. The redactor uses claim.raw for replacement, and `several ${unitRaw.join(' ')}` for the replacement — preserving the original casing of the unit: "4 Ember Shards" → "several Ember Shards" ✓ nice.

quantityInSource uses the cleaned unit ✓.

Let me continue the grounder:

```ts
export function extractProperNounClaims(sentence: string): ProperNounClaim[] {
  const tokens = tokenize(sentence);
  const claims: ProperNounClaim[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i] ?? '';
    if (!CAPITAL_TOKEN.test(t)) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < tokens.length && CAPITAL_TOKEN.test(tokens[j] ?? '')) j += 1;
    // A leading generic starter ("The Duskfang Warden") is not part of the name.
    const start = i === 0 && COMMON_SENTENCE_STARTERS.has(t) ? i + 1 : i;
    if (start >= j) {
      i = j;
      continue;
    }
    const rawWords: string[] = [];
    for (let k = start; k < j; k++) rawWords.push(tokens[k] ?? '');
    claims.push({
      phrase: rawWords.join(' '),
      words: rawWords.map(cleanToken),
      start,
      end: j,
    });
    i = j;
  }
  return claims;
}
```

Quantity + name checks and the main function as drafted.

Now — a subtle bug check for extractProperNounClaims: a sentence starting with two starters "The The..."? Doesn't exist.

A capitalized word with a digit "Level5"? CAPITAL_TOKEN requires the first char A-Z then letters — "Level5" ends with a digit → doesn't match → skipped. Fine.

Now the redactor in full:

```ts
import {
  cleanToken,
  escapeRegExp,
  extractProperNounClaims,
  extractQuantityClaims,
  splitSentences,
  tokenize,
} from './grounder.js';
import type { ProperNounClaim } from './grounder.js';

/**
 * Hint mode redaction, applied to the full grounded answer (never a re-prompt).
 *
 * The spoiler contract hides:
 *   - boss names          -> "a hidden boss"
 *   - place names         -> "a secret place"
 *   - quantities the player has not already mentioned -> "several"
 * // ASSUMPTION: the spoiler contract forbids boss names, item locations and
 * // quantities, not item names, so item names are left visible in hints.
 * // ASSUMPTION: a quantity N may be revealed only if the player already
 * // mentioned at least N of the same resource in the question.
 *
 * Names are classified by their own tokens first, then by nearby context
 * words; a name with no recognizable context is left as-is. Generic spatial
 * language ("eastern bank") is out of scope: the redactor targets names and
 * quantities, which is what the contract enumerates.
 */

type NameKind = 'boss' | 'place';

const BOSS_WORDS = new Set([
  'boss','guardian','warden','foe','enemy','champion','sentinel','fight','fighting','defeat','defeated','slay','slain','kill','killed','battle','duel','encounter','guard','guards','guarded','patrol','patrols','patrolled','hound','beast','brute','specter','lich','golem','falls','fall'?
]);
```
Hmm "falls" — "The Warden falls to frost" — "falls" as a boss context? It's a verb; if I add it, a sentence "The Ember falls" → ember classified boss?? "Ember falls..." — unlikely. Skip 'falls'. Keep the list conservative.

PLACE_WORDS as listed.

```ts
function escape... (imported)

function classifyName(claim: ProperNounClaim, cleanTokens: string[]): NameKind | null {
  for (const w of claim.words) {
    if (BOSS_WORDS.has(w)) return 'boss';
    if (PLACE_WORDS.has(w)) return 'place';
  }
  const from = Math.max(0, claim.start - 5);
  const to = Math.min(cleanTokens.length, claim.end + 5);
  for (let i = from; i < to; i++) {
    if (i >= claim.start && i < claim.end) continue;
    const w = cleanTokens[i] ?? '';
    if (BOSS_WORDS.has(w)) return 'boss';
    if (PLACE_WORDS.has(w)) return 'place';
  }
  return null;
}

interface KnownQuantity { value: number; unit: string[]; }

function knownQuantities(question: string): KnownQuantity[] {
  return extractQuantityClaims(question).map((c) => ({ value: Number(c.number), unit: c.unit }));
}

function sameUnit(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((w, i) => w === (b[i] ?? ''));
}

function redactQuantities(sentence: string, known: KnownQuantity[]): string {
  let out = sentence;
  for (const claim of extractQuantityClaims(sentence)) {
    const value = Number(claim.number);
    const alreadyKnown = claim.unit.length === 0
      ? known.some((k) => k.unit.length === 0 && k.value === value)
      : known.some((k) => sameUnit(k.unit, claim.unit) && k.value >= value);
    if (alreadyKnown) continue;
    const re = new RegExp(`\\b${escapeRegExp(claim.raw)}\\b`);
    out = out.replace(re, `several ${claim.unitRaw.join(' ')}`.trim());
  }
  return out;
}
```
Wait — `several ${unit}` — if unitRaw is empty → "several" ✓ trim handles it. But the boundary: \b before the first char of raw (a digit or a letter ✓), and \b after the last unit word ✓.

Hmm — one issue: claim.raw could contain a word number "four" and another claim "four" elsewhere — the sequential replacement is OK per the earlier reasoning.

```ts
function redactNames(sentence: string): string {
  const claims = extractProperNounClaims(sentence);
  if (claims.length === 0) return sentence;
  const rawTokens = tokenize(sentence);
  const cleanTokens = rawTokens.map(cleanToken);
  let out = sentence;
  for (const claim of claims) {
    const kind = classifyName(claim, cleanTokens);
    if (kind === null) continue;
    const withArticle = kind === 'boss' ? 'a hidden boss' : 'a secret place';
    const bare = kind === 'boss' ? 'hidden boss' : 'secret place';
    let base = claim.phrase;
    let suffix = '';
    if (base.endsWith("'s")) {
      suffix = "'s";
      base = base.slice(0, -2);
    } else if (base.endsWith('\u2019s')) {
      suffix = '\u2019s';
      base = base.slice(0, -2);
    }
    const prev = (rawTokens[claim.start - 1] ?? '').toLowerCase();
    let search: string;
    let replacement: string;
    if (prev === 'a' || prev === 'an') {
      search = `${prev} ${base}`;
      replacement = withArticle + suffix;
    } else if (prev === 'the') {
      search = base;
      replacement = bare + suffix;
    } else {
      search = base;
      replacement = withArticle + suffix;
    }
    out = out.replace(new RegExp(`\\b${escapeRegExp(search)}\\b`), replacement);
  }
  return out;
}

export function redactToHint(groundedFullText: string, question: string): string {
  const known = knownQuantities(question);
  return splitSentences(groundedFullText)
    .map((s) => redactNames(redactQuantities(s, known)))
    .join(' ');
}
```
The \b after "Mirefen" and the suffix "'s" — the search is "Mirefen" with \b after n → before the apostrophe ✓.

Wait — for a claim with prev === 'a' — search "a Mirefen" — but if the original text has "a Mirefen's" — base "Mirefen" ✓ fine.

Edge: a single-word claim "The" dropped → start>=j → skip ✓.

Now — **verify the "a" case in a test?** I don't have a test with "a <name>". The lie test has "a Moonblade" but that's gated out. Should I add a hint test with "a Duskfang Warden"? Let me keep the existing coverage; the article logic 'the' is covered. OK.

Now the GuideAnswer type — `refusalReason: string | null` ✓.

Also let me think about the `GuideAnswer.droppedSentences` on the answered case — the service returns dropped ✓ (test asserts exact).

Now the scripted-llm-client:

```ts
import type { LlmClient, LlmPrompt } from './guide.types.js';

export interface ScriptEntry {
  /** Matched against the prompt's question (substring or regex). */
  match: RegExp | string;
  /** The exact text the fake model "generates". */
  reply: string;
}

/**
 * Deterministic stand-in for a real LLM: returns the first scripted reply
 * whose match hits the question, and fails loudly otherwise. Records every
 * prompt so tests can assert how many times the model was called.
 */
export class ScriptedLlmClient implements LlmClient {
  private readonly prompts: LlmPrompt[] = [];

  constructor(private readonly script: ScriptEntry[]) {}

  async complete(prompt: LlmPrompt): Promise<string> {
    this.prompts.push(prompt);
    const entry = this.script.find((e) =>
      typeof e.match === 'string'
        ? prompt.question.toLowerCase().includes(e.match.toLowerCase())
        : e.match.test(prompt.question),
    );
    if (!entry) {
      throw new Error(`ScriptedLlmClient: no scripted reply for question "${prompt.question}"`);
    }
    return entry.reply;
  }

  get callCount(): number {
    return this.prompts.length;
  }
}
```

fixtures.ts — as drafted, with double-quoted strings where there are apostrophes.

guide.types.ts:

```ts
export type AnswerMode = 'full' | 'hint';

export interface WikiSource {
  id: string;
  title: string;
  text: string;
}

export type AnswerStatus = 'answered' | 'refused';

export interface GuideAnswer {
  status: AnswerStatus;
  mode: AnswerMode;
  /** Final answer text; empty when the status is 'refused'. */
  text: string;
  /** The exact refusal phrase; null when the status is 'answered'. */
  refusalReason: string | null;
  /** Sentences the grounding gate dropped. */
  droppedSentences: string[];
  /** IDs of the sources that grounded at least one kept sentence. */
  sourcesUsed: string[];
}

export const REFUSAL_MESSAGE = 'not covered by my sources';

export interface LlmPrompt {
  question: string;
  sources: WikiSource[];
}

export interface LlmClient {
  complete(prompt: LlmPrompt): Promise<string>;
}
```

Now let me reconsider once more: is there any scenario where a *correct* answer gets falsely dropped by my gate? My tests' correct answers reuse source vocabulary — realistic. I'll note in the grounder header that the gate is strict by design (a false negative drops the sentence rather than risk an ungrounded one). Good.

Also — "sourcesUsed" is computed only for kept sentences ✓.

Let me re-verify test 'returns the model answer untouched': sourcesUsed toContain 'ember-altar' — is the sentence grounded by EMBER_ALTAR_PAGE alone? Sentence: "The Ember Altar demands 4 ember shards before it can be kindled."
Page 1 tokens: the, ember, altar, stands, at, the, heart, of, the, mirefen, it, demands, 4, ember, shards, before, it, can, be, kindled, kindled, it, burns, cold, and, lights, the, way, out, of, the, swamp, the, altar, was, sealed, long, before, the, last, survey.
- Quantity (4,[ember,shards]): "4" at idx 12; next: 13 ember ✓, 14 shards ✓ → ✓.
- Proper nouns [Ember, Altar]: ember ✓ altar ✓.
- Content: ember ✓, altar ✓, demands ✓, kindled ✓ → 100% ✓.
→ grounded by page 1 ✓ → sourcesUsed includes 'ember-altar' ✓. (mirefen alone? demands ✗ → no. duskfang alone? demands ✗ → no.)

Now the **eval 'correct scores high'** — helpfulness: expectedFacts ['4 ember shards'] in CORRECT_KINDLE ✓ 1. Faithfulness: sentence grounded ✓ 1; planted ['5 ember shards','Moonblade'] absent ✓ → 1. Final 1 ≥ 0.8 ✓ pass ✓.

Everything checks out. Also, the harness test `reports.map(r => r.scenarioId)` order is preserved (sequential loop) ✓ ['kindle-altar','shard-hunt'] ✓.

Now — the **vitest + NodeNext .js import** resolution: Vitest (Vite) handles `.js` → `.ts` for relative imports in ESM TS projects ✓ standard.

**tsconfig include** vitest.config.ts — it imports 'vitest/config' ✓ typed.

Now, `exactOptionalPropertyTypes` — I don't use optional properties, but... ScriptEntry? All required ✓. JudgeVerdict is fine. I'll keep exactOptionalPropertyTypes on (strict-plus) — no optional fields anywhere ✓. Actually wait — I don't have any `?` anywhere. ✓.

`noUncheckedIndexedAccess: true` — I've handled all index accesses with ?? or checks. Let me scan:
- extractQuantityClaims: tokens[i] ?? '' ✓; tokens[i + k] → u checked undefined ✓; raw: tokens[i + 1 + offset] ?? '' ✓.
- quantityInSource: index.tokens[i] ?? '' ✓; claim.unit[u] ?? '' ✓.
- extractProperNounClaims: tokens[i] ?? '' ✓; tokens[j] ?? '' ✓; tokens[k] ?? '' ✓.
- redactor: rawTokens[claim.start - 1] ?? '' ✓; cleanTokens[i] ?? '' ✓; sameUnit b[i] ?? '' ✓.
- SCRIPTED: fine.
- WORD_NUMBERS[t.toLowerCase()] ?? null ✓.
✓.

One more: `private readonly script: ScriptEntry[]` — parameter property with verbatimModuleSyntax is fine.

The harness `for...of` push ✓.

Now — I'll write the final test files with exact strings. Let me also re-verify the apostrophe in `NEXT_REPLY` in the test: I'll use a single-quoted string containing Mirefen's → I need a double-quoted string or escaping. In the test, I'll build with double quotes:

```ts
const NEXT_REPLY =
  "Ember shards grow on the pale reeds along the Mirefen's eastern bank. " +
  'The Duskfang Warden guards the Ember Altar. ' +
  'You need 4 ember shards in all.';
```
✓.

Expected hint string:
```ts
const EXPECTED_HINT =
  "Ember shards grow on the pale reeds along the secret place's eastern bank. " +
  'The hidden boss guards the secret place. ' +
  'You need several ember shards in all.';
```
✓.

Now — the suite reply in eval.spec contains Mirefen's → I'll use a double-quoted string there too.

Also in the eval spec, the 'min of the two' test question 'do next' match → I changed to 'What do'. Question: "I have 2 ember shards so far. What do I do next?" contains "What do" ✓.

But wait — the KINDLE question "How do I kindle the Ember Altar?" — does it contain "What do"? No ✓. Does the NEXT question contain "kindle"? No ✓. Good, no cross-match.

The "keeps a quantity" test question "I have 4 ember shards. What do I do next?" → match 'What do' ✓.

Now, one potential trap: the **guide.spec hint test** uses `serviceWith([{ match: 'What do', reply: NEXT_REPLY }])` and then `service.answer(NEXT_QUESTION, ...)` ✓.

Also the "derived" test: two answers with the same service → llm.callCount === 2 ✓ and redactToHint(full.text, NEXT_QUESTION) === hint.text ✓ (full.text = NEXT_REPLY since all grounded — verify sentence 3 "You need 4 ember shards in all." grounded ✓ as earlier).

Now — let me reconsider **whether the gate accepts "You need 4 ember shards in all."**: content words: "need" is a stopword ✓, "in" no (2), "all" (3 <4) no → content [] → passes (no content requirement). Quantity ✓. Proper nouns: "You" is a starter → none. → grounded ✓.

And in the hint "keeps a quantity" test: redaction keeps 4 ✓ names: none ✓ → text equals the reply ✓.

Let me also confirm the **refusal immediate** test: sources [] → refused, droppedSentences [] — I didn't assert that; fine.

Now, the file order in the reply. I'll do:
1. package.json
2. tsconfig.json
3. vitest.config.ts
4. src/guide/guide.types.ts
5. src/guide/grounder.ts
6. src/guide/redactor.ts
7. src/guide/guide.service.ts
8. src/guide/scripted-llm-client.ts
9. src/guide/fixtures.ts
10. src/eval/scenarios.ts
11. src/eval/judges.ts
12. src/eval/harness.ts
13. test/guide.spec.ts
14. test/eval.spec.ts

Let me now write the complete, final code text, carefully.

Complete grounder.ts:

```ts
import type { WikiSource } from './guide.types.js';

/**
 * Sentence-level grounding gate for the gameplay assistant.
 *
 * A sentence is grounded only if every detectable factual claim in it is
 * present in the provided wiki pages:
 *   1. quantity claims ("5 ember shards") must match number + unit words in a source,
 *   2. proper-noun claims ("Duskfang Warden") must appear in a source,
 *   3. at least half of the sentence's content words must appear in a source.
 *
 * The gate is a deterministic heuristic rather than an NLP model: it catches
 * invented names and wrong quantities exactly, and filters out sentences whose
 * vocabulary has no overlap with the sources. It errs on the strict side: a
 * sentence that cannot be verified is dropped, never kept.
 */

export interface GroundingVerdict {
  grounded: boolean;
  /** Why the sentence failed the gate; empty when grounded. */
  reasons: string[];
}

export interface QuantityClaim {
  /** Original claim text, e.g. "5 ember shards". */
  raw: string;
  /** Normalized value, e.g. "5" (word numbers normalized to digits). */
  number: string;
  /** Original numeric token, e.g. "five". */
  numberRaw: string;
  /** Unit words after the number, cleaned, e.g. ["ember", "shards"]. */
  unit: string[];
  /** Same unit words in original casing, used for redaction display. */
  unitRaw: string[];
}

export interface ProperNounClaim {
  /** Original phrase, e.g. "Duskfang Warden". */
  phrase: string;
  /** Cleaned words, e.g. ["duskfang", "warden"]. */
  words: string[];
  /** Token span in the sentence (end exclusive). */
  start: number;
  end: number;
}

const WORD_NUMBERS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13',
  fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18',
  nineteen: '19', twenty: '20',
};

const TOKEN_SPLIT = /[^A-Za-z0-9'\u2019-]+/;
const CAPITAL_TOKEN = /^[A-Z][A-Za-z'\u2019-]*$/;
const WORD_TOKEN = /^[A-Za-z][A-Za-z'\u2019-]*$/;
const BARE_NUMBER = /^[0-9]+(?:\.[0-9]+)?$/;

/** Lowercase, strip possessive 's, normalize word numbers to digits. */
export function cleanToken(token: string): string {
  let t = token.toLowerCase();
  if (t.endsWith("'s")) t = t.slice(0, -2);
  return WORD_NUMBERS[t] ?? t;
}

export function tokenize(text: string): string[] {
  return text.split(TOKEN_SPLIT).filter((t) => t.length > 0);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Splits on terminal punctuation; the sentence is the unit of the gate. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const CONTENT_STOP_WORDS = new Set([
  'the','and','that','this','these','those','with','from','your','yours','you','have','has','had','are','was','were','been','being','can','could','would','should','will','shall','may','might','must','need','needs','needed','do','does','did','about','before','after','above','below','under','over','then','than','when','where','what','which','who','whom','how','why','here','there','out','off','up','down','into','onto','in','on','at','to','for','of','a','an','it','its','they','them','their','he','she','his','her','our','us','we','if','but','or','nor','so','not','no','yes','all','any','both','each','few','more','most','other','some','such','only','own','same','too','very','just','also','way','make','makes','made','take','takes','taken','get','gets','got','come','comes','back','first','last','new','old','long','short','little','big','many','much','still','even','ever','never','always','often','once','every',
]);

/** Capitalized words that commonly start a sentence but are not names. */
const COMMON_SENTENCE_STARTERS = new Set([
  'The','A','An','It','This','These','That','Those','If','When','While','You','Your','He','She','They','We','I','Yes','No','So','And','But','Or','To','Is','Are','Was','Were','Do','Does','Did','Can','Could','Should','Would','May','Might','Note','Tip','Remember','In','On','At','With','Without','After','Before','Once','Until',
]);

/** Words that terminate a quantity's unit phrase ("4 shards and ..." -> unit [shards]). */
const UNIT_TRIM = new Set([
  'the','a','an','of','in','on','at','to','for','with','and','or','so','far','more','left','yet','your','my','you','i','is','are','was','were','be','been','being','need','needs','needed','have','has','had','its','it','this','that','them','then','all','about','around','over','under','across','along','before','after','can','could','will','would','should','may','might','must','make','makes','made','take','takes','taken','get','gets','got','do','does','did','not','no','yes','if','when','where','while','which','who','how','why','as','but','also','only','very','too','just','such','each','few','many','much','most','other','some','any','both','own','same','way','long','short','little','big',
]);

interface SourceIndex {
  tokens: string[];
  set: Set<string>;
}

function indexSource(source: WikiSource): SourceIndex {
  const tokens = tokenize(source.text).map(cleanToken);
  return { tokens, set: new Set(tokens) };
}

export function extractQuantityClaims(sentence: string): QuantityClaim[] {
  const tokens = tokenize(sentence);
  const claims: QuantityClaim[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? '';
    let number: string | null;
    if (BARE_NUMBER.test(t)) {
      number = t;
    } else {
      number = WORD_NUMBERS[t.toLowerCase()] ?? null;
    }
    if (number === null) continue;

    const unit: string[] = [];
    const unitRaw: string[] = [];
    for (let k = 1; k <= 3; k++) {
      const u = tokens[i + k];
      if (u === undefined || !WORD_TOKEN.test(u)) break;
      const cu = cleanToken(u);
      if (UNIT_TRIM.has(cu)) break;
      unit.push(cu);
      unitRaw.push(u);
    }

    claims.push({
      raw: [t, ...unitRaw].join(' '),
      number,
      numberRaw: t,
      unit,
      unitRaw,
    });
  }
  return claims;
}

export function extractProperNounClaims(sentence: string): ProperNounClaim[] {
  const tokens = tokenize(sentence);
  const claims: ProperNounClaim[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i] ?? '';
    if (!CAPITAL_TOKEN.test(t)) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < tokens.length && CAPITAL_TOKEN.test(tokens[j] ?? '')) j += 1;
    // A leading generic starter ("The Duskfang Warden ...") is not part of the name.
    const start = i === 0 && COMMON_SENTENCE_STARTERS.has(t) ? i + 1 : i;
    if (start < j) {
      const rawWords: string[] = [];
      for (let k = start; k < j; k++) rawWords.push(tokens[k] ?? '');
      claims.push({
        phrase: rawWords.join(' '),
        words: rawWords.map(cleanToken),
        start,
        end: j,
      });
    }
    i = j;
  }
  return claims;
}

function quantityInSource(claim: QuantityClaim, index: SourceIndex): boolean {
  if (claim.unit.length === 0) {
    return index.set.has(claim.number);
  }
  for (let i = 0; i < index.tokens.length; i++) {
    if ((index.tokens[i] ?? '') !== claim.number) continue;
    let u = 0;
    const end = Math.min(index.tokens.length, i + 1 + claim.unit.length + 2);
    for (let j = i + 1; j < end && u < claim.unit.length; j++) {
      if ((index.tokens[j] ?? '') === (claim.unit[u] ?? '')) u += 1;
    }
    if (u === claim.unit.length) return true;
  }
  return false;
}

function properNounInSource(claim: ProperNounClaim, index: SourceIndex): boolean {
  return claim.words.length > 0 && claim.words.every((w) => index.set.has(w));
}

function contentWords(sentence: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const t of tokenize(sentence)) {
    const c = cleanToken(t);
    if (c.length < 4) continue;
    if (!/^[a-z]+$/.test(c)) continue;
    if (CONTENT_STOP_WORDS.has(c)) continue;
    if (seen.has(c)) continue;
    seen.add(c);
    words.push(c);
  }
  return words;
}

export function isSentenceGrounded(sentence: string, sources: WikiSource[]): GroundingVerdict {
  const trimmed = sentence.trim();
  if (trimmed.length === 0) return { grounded: true, reasons: [] };
  if (sources.length === 0) return { grounded: false, reasons: ['no sources provided'] };

  const indices = sources.map(indexSource);
  const reasons: string[] = [];

  for (const claim of extractQuantityClaims(trimmed)) {
    if (!indices.some((idx) => quantityInSource(claim, idx))) {
      reasons.push(`quantity "${claim.raw}" is not stated in any source`);
    }
  }
  for (const claim of extractProperNounClaims(trimmed)) {
    if (!indices.some((idx) => properNounInSource(claim, idx))) {
      reasons.push(`name "${claim.phrase}" does not appear in any source`);
    }
  }
  const words = contentWords(trimmed);
  if (words.length > 0) {
    const pool = new Set<string>();
    for (const idx of indices) for (const t of idx.set) pool.add(t);
    const hits = words.filter((w) => pool.has(w)).length;
    if (hits / words.length < 0.5) {
      reasons.push(`${words.length - hits} of ${words.length} content words are absent from the sources`);
    }
  }

  return { grounded: reasons.length === 0, reasons };
}
```

Wait — `let number: string | null;` then assign in both branches; TS strict definite assignment: assigned in both branches of if/else ✓.

Also note — `BARE_NUMBER.test('4')` ✓. Token "0"? A claim (0, ...) fine.

One issue: `UNIT_WORD` WORD_TOKEN allows capitals — "5 Moonblade" → unit [moonblade] → quantityInSource looks for 5+moonblade → none → reason ✓ good (catches "5 Moonblades").

Hmm — the claim raw "5 Moonblade" etc. fine.

Now — **one more check of the lie's content ratio** — earlier computed 3/6=0.5 passes content, but the other reasons drop it ✓. But wait — "requires" — is it a stopword? No. "kindle" — not a stopword ✓ counted. Let me recount the lie's content words: tokens: The, Ember, Altar, requires, 5, ember, shards, and, a, Moonblade, to, kindle.
Content (≥4, a-z, non-stopword, dedup):
- the (3) no
- ember (5) ✓
- altar (5) ✓
- requires (8) ✓
- 5 → digit no
- shards (6) ✓
- and no, a no
- moonblade (9) ✓
- to no
- kindle (6) ✓
→ words: ember, altar, requires, shards, moonblade, kindle = 6. Pool (all 3 pages): ember ✓ altar ✓ requires ✗ shards ✓ moonblade ✗ kindle ✗ (source has "kindled" not "kindle") → hits 3 → 0.5 → not < 0.5 → no content reason. OK as computed ✓ (dropped by quantity + name anyway).

**Verify CORRECT_KINDLE content**: words: ember, altar, demands, kindled → pool page 1: all ✓ → 100% ✓.

Now — **the SHARD reply sentence 1** — proper noun "Ember": in source ✓. Wait — "Ember" is at sentence start and isn't a starter → claim ✓ in source ✓.

All verified. Also — **the "It weakens at dawn." sentence**: "It" is a starter ✓ no claim. Content: weakens (7) ✓ word, dawn (4) ✓ word → 0/2 → drop ✓.

Now — the **guide spec 'fails loudly'** test: question 'What is the weather?' — the script has only 'kindle' → throws /no scripted reply/ ✓. The regex in toThrow: the message contains `no scripted reply for question` ✓.

Now — **package.json**: should I include "main"? No need.

**tsconfig**: "module": "NodeNext" requires package type module ✓.

Also — the vitest config file imports from 'vitest/config' — needs vitest installed ✓ devDep.

Potential issue: **`"types": []`**? Not set → all @types packages are included — only @types/node ✓ fine.

**Node 20 + lookbehind** ✓.

Now — one more consideration re **the discipline rule "don't create files the task doesn't ask for"**: package.json/tsconfig/vitest.config are required to run the tests (the task mandates Vitest + TS). Fixtures are explicitly asked ("provided as fixtures"). The scripted fake client is asked. So the file set is justified.

Should the tests go in one file or two? The convention is `test/<feature>.spec.ts` — the features: guide + eval → two files ✓.

Let me re-read the task once more: "3. An evaluation harness: golden scenarios (question, sources, expected facts, planted FALSE facts such as fabricated item requirements); a helpfulness judge and a faithfulness judge that receives sources; final score = min of the two."

✓ scenarios.ts has all four fields. The faithfulness judge receives sources ✓ (parameter). Final = min ✓.

"4. Tests proving: a scripted confident lie answer scores low" ✓ (harness: 0 < 0.4). "a correct grounded answer scores high" ✓ (1 ≥ 0.8). "a scenario where sources lack the answer yields refusal" ✓ (guide spec). "quantity errors (e.g., '5 shards' when the source says 4) are caught accurately" ✓ (grounder test + end-to-end + judge).

"1. answer(question, sources, mode) with an injectable LLM client (a scripted fake is fine), with a sentence-level grounding gate: ungrounded sentences are dropped or the service refuses with 'not covered by my sources'." ✓ both behaviors.

"2. Hint mode derived by redacting the complete grounded answer, not by re-prompting." ✓ + proof test.

Now, a final check on the redactor: `redactQuantities` — the claim.raw "4 ember shards" — the sentence "You need 4 ember shards in all." → the regex \b4\ ember\ shards\b — wait, escapeRegExp(raw) → "4\ ember\ shards" no — escapeRegExp escapes only regex special chars; spaces stay literal spaces ✓. \b before "4" ✓, \b after "shards" (before the space) ✓ → replace with "several ember shards" ✓.

Word-number: "four ember shards" raw → ✓.

One more subtle: **two quantity claims where the first is a prefix of the second**: "4 shards 4 ember shards"? Doesn't exist.

Now, **the harness import in eval.spec**: PASS_THRESHOLD is exported ✓ used.

Let me also confirm **no circular imports**: redactor → grounder ✓; service → grounder, redactor, types ✓; eval → guide modules ✓. No cycles.

**ESM + vitest**: the spec files import '../src/guide/guide.service.js' — Vite resolves .js→.ts ✓.

I think I'm ready to write the final answer. Let me also add a brief top comment to each file (English) — keep it concise.

One more style point: the convention is code and comments in English ✓.

The final check of the expected hint: "You need several ember shards in all." — hmm "in all" is a bit odd English but fine.

And the full-mode SHARD text in the suite test — I must make sure it's identical to NEXT_REPLY (the one with the apostrophe in Mirefen's) — I'll write it as a double-quoted string in eval.spec.

Also — in the eval spec, the reply for 'What do' in the min test: 'The Duskfang Warden guards the Ember Altar.' ✓.

Let me also confirm the **SHARD_HUNT planted facts** don't accidentally appear in the correct answer: '5 ember shards' — the correct has "4 ember shards" → containsFact("...need 4 ember shards in all", "5 ember shards")? The text has "4 ember shards" not "5..." ✓ absent. 'Moonblade' ✓ absent.

And **KINDLE's expected fact** '4 ember shards' — the lie text "requires 5 ember shards" doesn't contain it ✓ (not relevant, the lie is refused anyway).

Edge — the helpfulness of the lie scenario: answer.text '' → 0 ✓ findings note ✓.

Now, `runSuite` is sequential — deterministic order ✓.

Final file contents — let me also decide the package name: "grounded-game-guide". Description. Version 0.1.0.

Vitest version ^2.1.0, typescript ^5.5.4, @types/node ^20.14.15 — reasonable pins.

Scripts: "test": "vitest run", "typecheck": "tsc --noEmit", "build": "tsc". Keep all three? build + typecheck + test — fine, minimal.

tsconfig "noEmit": true? If I have a build script that emits... I'll set "noEmit": true and drop build (the library isn't shipped as compiled). Keep "typecheck" only. Actually, with noEmit true and outDir unused — let me remove outDir.

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
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

vitest.config.ts:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
});
```

Now let me write out the test files fully.

test/guide.spec.ts:

```ts
import { describe, expect, it } from 'vitest';
import { ALL_WIKI_PAGES, EMBER_ALTAR_PAGE, MIREFEN_PAGE } from '../src/guide/fixtures.js';
import { isSentenceGrounded } from '../src/guide/grounder.js';
import { GuideService } from '../src/guide/guide.service.js';
import { redactToHint } from '../src/guide/redactor.js';
import { ScriptedLlmClient } from '../src/guide/scripted-llm-client.js';
import type { ScriptEntry } from '../src/guide/scripted-llm-client.js';
import { REFUSAL_MESSAGE } from '../src/guide/guide.types.js';

const KINDLE_QUESTION = 'How do I kindle the Ember Altar?';
const CORRECT_KINDLE = 'The Ember Altar demands 4 ember shards before it can be kindled.';
const FAKE_ITEM_SENTENCE = 'A Moonblade is also required.';
const NEXT_QUESTION = 'I have 2 ember shards so far. What do I do next?';
const NEXT_REPLY =
  "Ember shards grow on the pale reeds along the Mirefen's eastern bank. " +
  'The Duskfang Warden guards the Ember Altar. ' +
  'You need 4 ember shards in all.';
const EXPECTED_HINT =
  "Ember shards grow on the pale reeds along the secret place's eastern bank. " +
  'The hidden boss guards the secret place. ' +
  'You need several ember shards in all.';

function build(entries: ScriptEntry[]): { service: GuideService; llm: ScriptedLlmClient } {
  const llm = new ScriptedLlmClient(entries);
  return { service: new GuideService(llm), llm };
}

describe('GuideService.answer - full mode', () => {
  it('returns the model answer untouched when every sentence is grounded', async () => {
    const { service } = build([{ match: 'kindle', reply: CORRECT_KINDLE }]);
    const res = await service.answer(KINDLE_QUESTION, ALL_WIKI_PAGES, 'full');

    expect(res.status).toBe('answered');
    expect(res.mode).toBe('full');
    expect(res.text).toBe(CORRECT_KINDLE);
    expect(res.droppedSentences).toEqual([]);
    expect(res.refusalReason).toBeNull();
    expect(res.sourcesUsed).toContain('ember-altar');
  });

  it('drops the ungrounded sentence and keeps the grounded one', async () => {
    const { service } = build([{ match: 'kindle', reply: `${CORRECT_KINDLE} ${FAKE_ITEM_SENTENCE}` }]);
    const res = await service.answer(KINDLE_QUESTION, ALL_WIKI_PAGES, 'full');

    expect(res.status).toBe('answered');
    expect(res.text).toBe(CORRECT_KINDLE);
    expect(res.droppedSentences).toEqual([FAKE_ITEM_SENTENCE]);
  });

  it('refuses with the exact phrase when the sources lack the answer', async () => {
    const { service } = build([
      { match: 'defeat', reply: 'The Duskfang Warden falls to 3 frost arrows. It weakens at dawn.' },
    ]);
    const res = await service.answer('How do I defeat the Duskfang Warden?', [EMBER_ALTAR_PAGE], 'full');

    expect(res.status).toBe('refused');
    expect(res.refusalReason).toBe(REFUSAL_MESSAGE);
    expect(res.refusalReason).toBe('not covered by my sources');
    expect(res.text).toBe('');
    expect(res.droppedSentences).toHaveLength(2);
  });

  it('refuses without calling the model when there are no sources', async () => {
    const { service, llm } = build([{ match: 'anything', reply: 'Sure, do the thing.' }]);
    const res = await service.answer('Anything at all', [], 'full');

    expect(res.status).toBe('refused');
    expect(res.refusalReason).toBe(REFUSAL_MESSAGE);
    expect(llm.callCount).toBe(0);
  });

  it('fails loudly when the scripted model has no reply for the question', async () => {
    const { service } = build([{ match: 'kindle', reply: CORRECT_KINDLE }]);

    await expect(service.answer('What is the weather like?', ALL_WIKI_PAGES)).rejects.toThrow(/no scripted reply/);
  });
});

describe('grounding gate', () => {
  it('catches a quantity error exactly: 5 shards fails when the sources say 4', () => {
    const verdict = isSentenceGrounded('You need 5 ember shards.', [EMBER_ALTAR_PAGE, MIREFEN_PAGE]);

    expect(verdict.grounded).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/quantity "5 ember shards" is not stated in any source/);
  });

  it('accepts the quantity the sources actually state', () => {
    const verdict = isSentenceGrounded('You need 4 ember shards.', [EMBER_ALTAR_PAGE, MIREFEN_PAGE]);

    expect(verdict.grounded).toBe(true);
    expect(verdict.reasons).toEqual([]);
  });

  it('rejects invented item names even in a fluent sentence', () => {
    const verdict = isSentenceGrounded(FAKE_ITEM_SENTENCE, ALL_WIKI_PAGES);

    expect(verdict.grounded).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/name "Moonblade" does not appear in any source/);
  });

  it('refuses end to end when the only reply carries the wrong quantity', async () => {
    const { service } = build([{ match: 'kindle', reply: 'You need 5 ember shards.' }]);
    const res = await service.answer(KINDLE_QUESTION, ALL_WIKI_PAGES, 'full');

    expect(res.status).toBe('refused');
    expect(res.droppedSentences).toEqual(['You need 5 ember shards.']);
  });
});

describe('hint mode', () => {
  it('redacts boss names, place names and unknown quantities from the grounded answer', async () => {
    const { service } = build([{ match: 'What do', reply: NEXT_REPLY }]);
    const res = await service.answer(NEXT_QUESTION, ALL_WIKI_PAGES, 'hint');

    expect(res.status).toBe('answered');
    expect(res.mode).toBe('hint');
    expect(res.text).toBe(EXPECTED_HINT);
    expect(res.text).not.toContain('Mirefen');
    expect(res.text).not.toContain('Duskfang');
    expect(res.text).not.toContain('4 ember shards');
  });

  it('is derived from the full answer by redaction, with one model call per answer', async () => {
    const { service, llm } = build([{ match: 'What do', reply: NEXT_REPLY }]);
    const full = await service.answer(NEXT_QUESTION, ALL_WIKI_PAGES, 'full');
    const hint = await service.answer(NEXT_QUESTION, ALL_WIKI_PAGES, 'hint');

    expect(llm.callCount).toBe(2);
    expect(full.text).toBe(NEXT_REPLY);
    expect(redactToHint(full.text, NEXT_QUESTION)).toBe(hint.text);
    expect(hint.text).not.toBe(full.text);
  });

  it('keeps a quantity the player already mentioned', async () => {
    const question = 'I have 4 ember shards. What do I do next?';
    const { service } = build([{ match: 'What do', reply: 'You need 4 ember shards in all.' }]);
    const res = await service.answer(question, ALL_WIKI_PAGES, 'hint');

    expect(res.status).toBe('answered');
    expect(res.text).toBe('You need 4 ember shards in all.');
  });
});
```

Verify the "rejects invented item names" reason: the proper noun claim phrase is "Moonblade" (the "A" starter dropped) ✓ the reason string `name "Moonblade" does not appear in any source` ✓.

test/eval.spec.ts:

```ts
import { describe, expect, it } from 'vitest';
import { PASS_THRESHOLD, runScenario, runSuite } from '../src/eval/harness.js';
import { faithfulnessJudge, helpfulnessJudge } from '../src/eval/judges.js';
import { GOLDEN_SCENARIOS, KINDLE_ALTAR, SHARD_HUNT } from '../src/eval/scenarios.js';
import { ALL_WIKI_PAGES } from '../src/guide/fixtures.js';
import { GuideService } from '../src/guide/guide.service.js';
import { ScriptedLlmClient } from '../src/guide/scripted-llm-client.js';

const CORRECT_KINDLE = 'The Ember Altar demands 4 ember shards before it can be kindled.';
const CONFIDENT_LIE = 'The Ember Altar requires 5 ember shards and a Moonblade to kindle.';
const CORRECT_NEXT =
  "Ember shards grow on the pale reeds along the Mirefen's eastern bank. " +
  'The Duskfang Warden guards the Ember Altar. ' +
  'You need 4 ember shards in all.';

describe('eval harness', () => {
  it('scores a correct grounded answer high', async () => {
    const service = new GuideService(new ScriptedLlmClient([{ match: 'kindle', reply: CORRECT_KINDLE }]));
    const report = await runScenario(service, KINDLE_ALTAR);

    expect(report.answer.status).toBe('answered');
    expect(report.helpfulness.score).toBe(1);
    expect(report.faithfulness.score).toBe(1);
    expect(report.finalScore).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    expect(report.pass).toBe(true);
  });

  it('scores a scripted confident lie low', async () => {
    const service = new GuideService(new ScriptedLlmClient([{ match: 'kindle', reply: CONFIDENT_LIE }]));
    const report = await runScenario(service, KINDLE_ALTAR);

    expect(report.finalScore).toBeLessThan(0.4);
    expect(report.pass).toBe(false);
  });

  it('uses the min of the two judges as the final score', async () => {
    const service = new GuideService(new ScriptedLlmClient([
      { match: 'What do', reply: 'The Duskfang Warden guards the Ember Altar.' },
    ]));
    const report = await runScenario(service, SHARD_HUNT);

    expect(report.faithfulness.score).toBe(1);
    expect(report.helpfulness.score).toBeCloseTo(0.5);
    expect(report.finalScore).toBeCloseTo(0.5);
    expect(report.finalScore).toBe(Math.min(report.helpfulness.score, report.faithfulness.score));
    expect(report.pass).toBe(false);
  });

  it('runs the whole golden suite and every report obeys finalScore = min(judges)', async () => {
    const service = new GuideService(new ScriptedLlmClient([
      { match: 'kindle', reply: CORRECT_KINDLE },
      { match: 'What do', reply: CORRECT_NEXT },
    ]));
    const reports = await runSuite(service, GOLDEN_SCENARIOS);

    expect(reports.map((r) => r.scenarioId)).toEqual(['kindle-altar', 'shard-hunt']);
    for (const report of reports) {
      expect(report.finalScore).toBe(Math.min(report.helpfulness.score, report.faithfulness.score));
      expect(report.pass).toBe(report.finalScore >= PASS_THRESHOLD);
    }
    expect(reports.every((r) => r.pass)).toBe(true);
  });
});

describe('judges', () => {
  it('faithfulness catches a planted quantity error on ungated text', () => {
    const verdict = faithfulnessJudge('The altar requires 5 ember shards.', ALL_WIKI_PAGES, ['5 ember shards']);

    expect(verdict.score).toBe(0);
    expect(verdict.findings.join(' ')).toMatch(/planted false fact present: "5 ember shards"/);
  });

  it('faithfulness rewards fully source-supported text', () => {
    const verdict = faithfulnessJudge(CORRECT_KINDLE, ALL_WIKI_PAGES, ['5 ember shards', 'Moonblade']);

    expect(verdict.score).toBe(1);
    expect(verdict.findings).toEqual([]);
  });

  it('helpfulness scores partial fact coverage proportionally', () => {
    const verdict = helpfulnessJudge('The altar is in the Mirefen.', ['4 ember shards', 'the Mirefen']);

    expect(verdict.score).toBeCloseTo(0.5);
    expect(verdict.findings.join(' ')).toMatch(/missing expected fact: "4 ember shards"/);
  });

  it('helpfulness gives zero to a refusal', () => {
    const verdict = helpfulnessJudge('', ['4 ember shards']);

    expect(verdict.score).toBe(0);
  });
});
```

Verify 'The altar is in the Mirefen.' — does it contain "the Mirefen"? ✓. And "4 ember shards"? ✗ → 0.5 ✓.

Verify the faithfulness "rewards" test: CORRECT_KINDLE grounded ✓, planted absent ✓ → score 1 findings [] ✓.

Now — wait, in the lie harness test, let me confirm the lie is really fully dropped → refused. Verified above ✓ → helpfulness 0, faithfulness 1, final 0 ✓ < 0.4 ✓.

Also — the 'min of the two' test: SHARD_HUNT sources ALL_WIKI_PAGES; sentence "The Duskfang Warden guards the Ember Altar." grounded ✓ → faithfulness 1 ✓.

Now — the scenarios file uses ALL_WIKI_PAGES for both ✓ (2–3 pages: 3 ✓).

Also — hmm, the task says "2–3 fetched wiki page texts" — maybe one scenario should use 2 pages to show that? The lack scenario uses 1 page (that's the point of the test). I could make SHARD_HUNT use 2 pages [MIREFEN, DUSKFANG]? But its correct answer's sentence 3 "You need 4 ember shards in all." needs the EMBER_ALTAR page (4 shards) for grounding!! With 2 pages [mirefen, duskfang]: quantity 4 — mirefen page: no "4". duskfang: no. → sentence 3 ungrounded → dropped → the hint/full text differs → the test breaks. So SHARD_HUNT needs all 3 pages. Fine — "2–3" is satisfied across the fixtures (the lack scenario uses 1 as a deliberate adversarial input; that's a test choice, not a violation). Actually — to be safe on "2–3", the lack scenario could use 2 pages (altar + mirefen) — the Warden answer still ungrounded ✓ (warden/duskfang/frost/arrows not in either; quantity 3 frost arrows ✗). Let me use 2 pages there: [EMBER_ALTAR_PAGE, MIREFEN_PAGE]. Verify "The Duskfang Warden falls to 3 frost arrows." against both: proper nouns Duskfang/Warden ✗ (not in either) ✓ drop. "It weakens at dawn." content ✗ ✓ drop. Refusal ✓. Good — uses 2 pages, aligns better with the spec. I'll import MIREFEN_PAGE in the guide spec (already imported for the quantity test ✓).

Now — a final scan of **the redactor's imports**: I use cleanToken, escapeRegExp, extractProperNounClaims, extractQuantityClaims, splitSentences, tokenize, and the ProperNounClaim type ✓ all exported from the grounder ✓.

The **service's imports**: REFUSAL_MESSAGE (value) + types AnswerMode, GuideAnswer, LlmClient, WikiSource (type) + isSentenceGrounded, splitSentences (value) + redactToHint (value). With verbatimModuleSyntax: `import { REFUSAL_MESSAGE } from './guide.types.js'; import type { AnswerMode, GuideAnswer, LlmClient, WikiSource } from './guide.types.js';` ✓.

**The scripted client**: `import type { LlmClient, LlmPrompt } from './guide.types.js';` ✓.

**The fixtures**: `import type { WikiSource } from './guide.types.js';` ✓.

**scenarios**: `import { ALL_WIKI_PAGES } from '../guide/fixtures.js'; import type { WikiSource } from '../guide/guide.types.js';` ✓.

**judges**: `import type { WikiSource } from '../guide/guide.types.js'; import { escapeRegExp, isSentenceGrounded, splitSentences } from '../guide/grounder.js';` ✓.

**harness**: `import type { GuideService } from '../guide/guide.service.js'; import type { GuideAnswer } from '../guide/guide.types.js'; import { faithfulnessJudge, helpfulnessJudge } from './judges.js'; import type { JudgeVerdict } from './judges.js'; import type { GoldenScenario } from './scenarios.js';` ✓.

Now — one more design double-check: the task says the service "refuses with 'not covered by my sources'" — our refusalReason is exactly that, and text is empty. Should text itself be the message? "the service refuses with 'not covered by my sources'" — I'll carry the phrase in refusalReason; text is empty. The test asserts the exact phrase ✓. Defensible.

Also — the envelope convention { error: { code, message, details } } is for API errors; there's no API here. Skip.

I'm confident. Let me write the final answer with 14 file blocks. No prose outside the blocks (the format says prose is ignored but keep it to nothing — I'll output only the blocks).

Wait — one more check about **`exactOptionalPropertyTypes` + `GuideAnswer.refusalReason: string | null`** — provided explicitly in all returns ✓.

And the **ScriptedLlmClient constructor parameter property** `private readonly script: ScriptEntry[]` ✓.

**The unused DUSKFANG_PAGE import?** In the guide spec, I import ALL_WIKI_PAGES, EMBER_ALTAR_PAGE, MIREFEN_PAGE — DUSKFANG_PAGE not needed (the lack scenario uses 2 pages). Don't import it. In fixtures, all three are exported + ALL ✓.

In the eval spec: only ALL_WIKI_PAGES ✓.

Let me also confirm that the **guide spec 'refuses with the exact phrase'** uses [EMBER_ALTAR_PAGE, MIREFEN_PAGE] — verify sentence 1 against mirefen too: "3" — mirefen page has no "3" ✓. duskfang absent ✓. Refusal ✓.

Now — the **hint test's llm prompt assertion**: I only assert callCount 2. The LlmPrompt has no mode field → structurally mode-agnostic ✓ (I'll add a comment to that effect).

Let me write it all out.

Also — small point: in the redactor's header comment, I'll mention the single model call. And the `// ASSUMPTION` lines — I'll keep exactly two.

One more: **the redactQuantities replacement when unitRaw is empty** — `several ${claim.unitRaw.join(' ')}`.trim() → "several" ✓.

And **the redactor for a sentence where the quantity's raw spans a punctuation**: "4, ember shards"? The tokenizer splits on commas → the tokens are 4, ember, shards — the raw join "4 ember shards" doesn't match the text "4, ember shards" → no replacement → the number stays → a quantity leak in a hint?! Edge: "You need 4, ember shards," — unrealistic phrasing. Accept it; the tests control the scripts. I could note it but... I won't add noise.

Also — **the apostrophe in "Mirefen's" in the tokenizer**: TOKEN_SPLIT excludes ' and ’ → "Mirefen's" stays one token ✓. In the source text, "Mirefen's" ✓ cleanToken → "mirefen" ✓.

Final: I'll write the answer.

Actually — wait, let me re-check the `extractProperNounClaims` grouping for "The Ember Altar demands..." once more: tokens [The, Ember, Altar, demands, ...] — i=0 "The" is caps → j advances: The (0) caps, Ember (1) caps, Altar (2) caps, demands (3) not → j=3. start = 1 (The is a starter). rawWords = [Ember, Altar] ✓ claim span 1..3 ✓. i=3 → demands... skip lowercase. ✓.

And "Ember shards grow on the pale reeds along the Mirefen's eastern bank." — i=0 "Ember" caps, j: shards (1) lowercase → j=1. start=0 (Ember isn't a starter) → claim [Ember] span 0..1 ✓. i=1..8 lowercase (the "the" at 4, 8 are lowercase) ✓. i=9 "Mirefen's" caps → j=10 (eastern lowercase) → claim span 9..10 ✓.

Classification of Ember (span 0..1): own 'ember' — BOSS? no. PLACE? no. Window from 0 to 6: i=0 skipped (in span), i=1 'shards' — BOSS/PLACE? no. i=2 'grow' no. i=3 'on' no. i=4 'the' no. i=5 'pale' no → null → keep ✓.

Mirefen span 9..10: window from 4 to 12: i=4 the, 5 pale, 6 reeds, 7 along, 8 the, (9 skip), 10 'eastern' ∈ PLACE ✓ → 'place' ✓.

All verified. Also the **PLACE list has 'eastern'** ✓ I included it.

And — **BOSS 'warden'** ✓ included; the own-token check for "Warden" → boss ✓.

**The 'altar' in PLACE** ✓ included.

Done — I'll write the final output.

One more formatting requirement: "For each file, a level-3 heading containing only the repo-relative path, immediately followed by a single fenced block containing only that file's content." I'll follow that precisely, and start with the first heading.
```

## reply

### package.json
```json
{
  "name": "grounded-game-guide",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Grounded gameplay assistant: answer pipeline, spoiler-free hint redaction, eval harness.",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^20.14.15",
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
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
});
```

### src/guide/guide.types.ts
```ts
export type AnswerMode = 'full' | 'hint';

export interface WikiSource {
  id: string;
  title: string;
  text: string;
}

export type AnswerStatus = 'answered' | 'refused';

export interface GuideAnswer {
  status: AnswerStatus;
  mode: AnswerMode;
  /** Final answer text; empty when status is 'refused'. */
  text: string;
  /** Exact refusal phrase; null when status is 'answered'. */
  refusalReason: string | null;
  /** Sentences the grounding gate dropped. */
  droppedSentences: string[];
  /** IDs of sources that grounded at least one kept sentence. */
  sourcesUsed: string[];
}

export const REFUSAL_MESSAGE = 'not covered by my sources';

/**
 * What the service hands to the model. Note there is no mode field on purpose:
 * hint mode must never change the prompt (no re-prompting).
 */
export interface LlmPrompt {
  question: string;
  sources: WikiSource[];
}

export interface LlmClient {
  complete(prompt: LlmPrompt): Promise<string>;
}
```

### src/guide/grounder.ts
```ts
import type { WikiSource } from './guide.types.js';

/**
 * Sentence-level grounding gate for the gameplay assistant.
 *
 * A sentence is grounded only if every detectable factual claim in it is
 * present in the provided wiki pages:
 *   1. quantity claims ("5 ember shards") must match number + unit words in a source,
 *   2. proper-noun claims ("Duskfang Warden") must appear in a source,
 *   3. at least half of the sentence's content words must appear in a source.
 *
 * The gate is a deterministic heuristic, not an NLP model: it catches invented
 * names and wrong quantities exactly, and filters sentences whose vocabulary
 * has no overlap with the sources. It is deliberately strict: a sentence that
 * cannot be verified is dropped, never kept.
 */

export interface GroundingVerdict {
  grounded: boolean;
  /** Why the sentence failed the gate; empty when grounded. */
  reasons: string[];
}

export interface QuantityClaim {
  /** Original claim text, e.g. "5 ember shards". */
  raw: string;
  /** Normalized value, e.g. "5" (word numbers normalized to digits). */
  number: string;
  /** Original numeric token, e.g. "five". */
  numberRaw: string;
  /** Unit words after the number, cleaned, e.g. ["ember", "shards"]. */
  unit: string[];
  /** Same unit words in original casing, used for redaction display. */
  unitRaw: string[];
}

export interface ProperNounClaim {
  /** Original phrase, e.g. "Duskfang Warden". */
  phrase: string;
  /** Cleaned words, e.g. ["duskfang", "warden"]. */
  words: string[];
  /** Token span in the sentence (end exclusive). */
  start: number;
  end: number;
}

const WORD_NUMBERS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13',
  fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18',
  nineteen: '19', twenty: '20',
};

const TOKEN_SPLIT = /[^A-Za-z0-9'\u2019-]+/;
const CAPITAL_TOKEN = /^[A-Z][A-Za-z'\u2019-]*$/;
const WORD_TOKEN = /^[A-Za-z][A-Za-z'\u2019-]*$/;
const BARE_NUMBER = /^[0-9]+(?:\.[0-9]+)?$/;

/** Lowercase, strip possessive 's, normalize word numbers to digits. */
export function cleanToken(token: string): string {
  let t = token.toLowerCase();
  if (t.endsWith("'s")) t = t.slice(0, -2);
  return WORD_NUMBERS[t] ?? t;
}

export function tokenize(text: string): string[] {
  return text.split(TOKEN_SPLIT).filter((t) => t.length > 0);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Splits on terminal punctuation; the sentence is the unit of the gate. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const CONTENT_STOP_WORDS = new Set([
  'the', 'and', 'that', 'this', 'these', 'those', 'with', 'from', 'your', 'yours', 'you',
  'have', 'has', 'had', 'are', 'was', 'were', 'been', 'being', 'can', 'could', 'would',
  'should', 'will', 'shall', 'may', 'might', 'must', 'need', 'needs', 'needed', 'do',
  'does', 'did', 'about', 'before', 'after', 'above', 'below', 'under', 'over', 'then',
  'than', 'when', 'where', 'what', 'which', 'who', 'whom', 'how', 'why', 'here', 'there',
  'out', 'off', 'up', 'down', 'into', 'onto', 'in', 'on', 'at', 'to', 'for', 'of', 'a',
  'an', 'it', 'its', 'they', 'them', 'their', 'he', 'she', 'his', 'her', 'our', 'us',
  'we', 'if', 'but', 'or', 'nor', 'so', 'not', 'no', 'yes', 'all', 'any', 'both', 'each',
  'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'too', 'very',
  'just', 'also', 'way', 'make', 'makes', 'made', 'take', 'takes', 'taken', 'get', 'gets',
  'got', 'come', 'comes', 'back', 'first', 'last', 'new', 'old', 'long', 'short',
  'little', 'big', 'many', 'much', 'still', 'even', 'ever', 'never', 'always', 'often',
  'once', 'every',
]);

/** Capitalized words that commonly start a sentence but are not names. */
const COMMON_SENTENCE_STARTERS = new Set([
  'The', 'A', 'An', 'It', 'This', 'These', 'That', 'Those', 'If', 'When', 'While', 'You',
  'Your', 'He', 'She', 'They', 'We', 'I', 'Yes', 'No', 'So', 'And', 'But', 'Or', 'To',
  'Is', 'Are', 'Was', 'Were', 'Do', 'Does', 'Did', 'Can', 'Could', 'Should', 'Would',
  'May', 'Might', 'Note', 'Tip', 'Remember', 'In', 'On', 'At', 'With', 'Without',
  'After', 'Before', 'Once', 'Until',
]);

/** Words that end a quantity's unit phrase ("4 shards and ..." -> unit [shards]). */
const UNIT_TRIM = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'and', 'or', 'so', 'far',
  'more', 'left', 'yet', 'your', 'my', 'you', 'i', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'need', 'needs', 'needed', 'have', 'has', 'had', 'its', 'it', 'this',
  'that', 'them', 'then', 'all', 'about', 'around', 'over', 'under', 'across', 'along',
  'before', 'after', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must',
  'make', 'makes', 'made', 'take', 'takes', 'taken', 'get', 'gets', 'got', 'do', 'does',
  'did', 'not', 'no', 'yes', 'if', 'when', 'where', 'while', 'which', 'who', 'how', 'why',
  'as', 'but', 'also', 'only', 'very', 'too', 'just', 'such', 'each', 'few', 'many',
  'much', 'most', 'other', 'some', 'any', 'both', 'own', 'same', 'way', 'long', 'short',
  'little', 'big',
]);

interface SourceIndex {
  tokens: string[];
  set: Set<string>;
}

function indexSource(source: WikiSource): SourceIndex {
  const tokens = tokenize(source.text).map(cleanToken);
  return { tokens, set: new Set(tokens) };
}

export function extractQuantityClaims(sentence: string): QuantityClaim[] {
  const tokens = tokenize(sentence);
  const claims: QuantityClaim[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? '';
    let number: string | null;
    if (BARE_NUMBER.test(t)) {
      number = t;
    } else {
      number = WORD_NUMBERS[t.toLowerCase()] ?? null;
    }
    if (number === null) continue;

    const unit: string[] = [];
    const unitRaw: string[] = [];
    for (let k = 1; k <= 3; k++) {
      const u = tokens[i + k];
      if (u === undefined || !WORD_TOKEN.test(u)) break;
      const cu = cleanToken(u);
      if (UNIT_TRIM.has(cu)) break;
      unit.push(cu);
      unitRaw.push(u);
    }

    claims.push({
      raw: [t, ...unitRaw].join(' '),
      number,
      numberRaw: t,
      unit,
      unitRaw,
    });
  }
  return claims;
}

export function extractProperNounClaims(sentence: string): ProperNounClaim[] {
  const tokens = tokenize(sentence);
  const claims: ProperNounClaim[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i] ?? '';
    if (!CAPITAL_TOKEN.test(t)) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < tokens.length && CAPITAL_TOKEN.test(tokens[j] ?? '')) j += 1;
    // A leading generic starter ("The Duskfang Warden ...") is not part of the name.
    const start = i === 0 && COMMON_SENTENCE_STARTERS.has(t) ? i + 1 : i;
    if (start < j) {
      const rawWords: string[] = [];
      for (let k = start; k < j; k++) rawWords.push(tokens[k] ?? '');
      claims.push({
        phrase: rawWords.join(' '),
        words: rawWords.map(cleanToken),
        start,
        end: j,
      });
    }
    i = j;
  }
  return claims;
}

function quantityInSource(claim: QuantityClaim, index: SourceIndex): boolean {
  if (claim.unit.length === 0) {
    return index.set.has(claim.number);
  }
  for (let i = 0; i < index.tokens.length; i++) {
    if ((index.tokens[i] ?? '') !== claim.number) continue;
    let u = 0;
    const end = Math.min(index.tokens.length, i + 1 + claim.unit.length + 2);
    for (let j = i + 1; j < end && u < claim.unit.length; j++) {
      if ((index.tokens[j] ?? '') === (claim.unit[u] ?? '')) u += 1;
    }
    if (u === claim.unit.length) return true;
  }
  return false;
}

function properNounInSource(claim: ProperNounClaim, index: SourceIndex): boolean {
  return claim.words.length > 0 && claim.words.every((w) => index.set.has(w));
}

function contentWords(sentence: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const t of tokenize(sentence)) {
    const c = cleanToken(t);
    if (c.length < 4) continue;
    if (!/^[a-z]+$/.test(c)) continue;
    if (CONTENT_STOP_WORDS.has(c)) continue;
    if (seen.has(c)) continue;
    seen.add(c);
    words.push(c);
  }
  return words;
}

export function isSentenceGrounded(sentence: string, sources: WikiSource[]): GroundingVerdict {
  const trimmed = sentence.trim();
  if (trimmed.length === 0) return { grounded: true, reasons: [] };
  if (sources.length === 0) return { grounded: false, reasons: ['no sources provided'] };

  const indices = sources.map(indexSource);
  const reasons: string[] = [];

  for (const claim of extractQuantityClaims(trimmed)) {
    if (!indices.some((idx) => quantityInSource(claim, idx))) {
      reasons.push(`quantity "${claim.raw}" is not stated in any source`);
    }
  }
  for (const claim of extractProperNounClaims(trimmed)) {
    if (!indices.some((idx) => properNounInSource(claim, idx))) {
      reasons.push(`name "${claim.phrase}" does not appear in any source`);
    }
  }
  const words = contentWords(trimmed);
  if (words.length > 0) {
    const pool = new Set<string>();
    for (const idx of indices) for (const t of idx.set) pool.add(t);
    const hits = words.filter((w) => pool.has(w)).length;
    if (hits / words.length < 0.5) {
      reasons.push(`${words.length - hits} of ${words.length} content words are absent from the sources`);
    }
  }

  return { grounded: reasons.length === 0, reasons };
}
```

### src/guide/redactor.ts
```ts
import {
  cleanToken,
  escapeRegExp,
  extractProperNounClaims,
  extractQuantityClaims,
  splitSentences,
  tokenize,
} from './grounder.js';
import type { ProperNounClaim } from './grounder.js';

/**
 * Hint-mode redaction, applied to the full grounded answer (never a re-prompt).
 *
 * The spoiler contract hides:
 *   - boss names   -> "a hidden boss"
 *   - place names  -> "a secret place"
 *   - quantities the player has not already mentioned -> "several"
 *
 * // ASSUMPTION: the spoiler contract forbids boss names, item locations and
 * // quantities, not item names, so item names stay visible in hints.
 * // ASSUMPTION: a quantity N may be revealed only when the player already
 * // mentioned at least N of the same resource in the question.
 *
 * Names are classified by their own tokens first, then by nearby context
 * words; a name with no recognizable context is left as-is. Generic spatial
 * language ("eastern bank") is out of scope: the redactor targets the named
 * entities and quantities the contract enumerates.
 */

type NameKind = 'boss' | 'place';

const BOSS_WORDS = new Set([
  'boss', 'guardian', 'warden', 'foe', 'enemy', 'champion', 'sentinel', 'fight',
  'fighting', 'defeat', 'defeated', 'slay', 'slain', 'kill', 'killed', 'battle',
  'duel', 'encounter', 'guard', 'guards', 'guarded', 'patrol', 'patrols',
  'patrolled', 'hound', 'beast', 'brute', 'specter', 'lich', 'golem',
]);

const PLACE_WORDS = new Set([
  'place', 'location', 'region', 'area', 'zone', 'cave', 'temple', 'swamp',
  'forest', 'mountain', 'dungeon', 'keep', 'tower', 'fen', 'marsh', 'valley',
  'ruin', 'ruins', 'altar', 'shrine', 'gate', 'path', 'door', 'room', 'bank',
  'shore', 'cliff', 'hill', 'north', 'south', 'east', 'west', 'eastern',
  'western', 'southern', 'northern', 'beyond', 'near', 'behind', 'inside',
  'under', 'above', 'across', 'through',
]);

interface KnownQuantity {
  value: number;
  unit: string[];
}

function knownQuantities(question: string): KnownQuantity[] {
  return extractQuantityClaims(question).map((c) => ({ value: Number(c.number), unit: c.unit }));
}

function sameUnit(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((w, i) => w === (b[i] ?? ''));
}

function redactQuantities(sentence: string, known: KnownQuantity[]): string {
  let out = sentence;
  for (const claim of extractQuantityClaims(sentence)) {
    const value = Number(claim.number);
    const alreadyKnown = claim.unit.length === 0
      ? known.some((k) => k.unit.length === 0 && k.value === value)
      : known.some((k) => sameUnit(k.unit, claim.unit) && k.value >= value);
    if (alreadyKnown) continue;
    const re = new RegExp(`\\b${escapeRegExp(claim.raw)}\\b`);
    out = out.replace(re, `several ${claim.unitRaw.join(' ')}`.trim());
  }
  return out;
}

function classifyName(claim: ProperNounClaim, cleanTokens: string[]): NameKind | null {
  for (const w of claim.words) {
    if (BOSS_WORDS.has(w)) return 'boss';
    if (PLACE_WORDS.has(w)) return 'place';
  }
  const from = Math.max(0, claim.start - 5);
  const to = Math.min(cleanTokens.length, claim.end + 5);
  for (let i = from; i < to; i++) {
    if (i >= claim.start && i < claim.end) continue;
    const w = cleanTokens[i] ?? '';
    if (BOSS_WORDS.has(w)) return 'boss';
    if (PLACE_WORDS.has(w)) return 'place';
  }
  return null;
}

function redactNames(sentence: string): string {
  const claims = extractProperNounClaims(sentence);
  if (claims.length === 0) return sentence;
  const rawTokens = tokenize(sentence);
  const cleanTokens = rawTokens.map(cleanToken);
  let out = sentence;
  for (const claim of claims) {
    const kind = classifyName(claim, cleanTokens);
    if (kind === null) continue;
    const withArticle = kind === 'boss' ? 'a hidden boss' : 'a secret place';
    const bare = kind === 'boss' ? 'hidden boss' : 'secret place';
    let base = claim.phrase;
    let suffix = '';
    if (base.endsWith("'s")) {
      suffix = "'s";
      base = base.slice(0, -2);
    } else if (base.endsWith('\u2019s')) {
      suffix = '\u2019s';
      base = base.slice(0, -2);
    }
    const prev = (rawTokens[claim.start - 1] ?? '').toLowerCase();
    let search: string;
    let replacement: string;
    if (prev === 'a' || prev === 'an') {
      // "a Duskfang Warden" -> "a hidden boss" (the article is consumed).
      search = `${prev} ${base}`;
      replacement = withArticle + suffix;
    } else if (prev === 'the') {
      // "the Duskfang Warden" -> "the hidden boss" (keep the existing article).
      search = base;
      replacement = bare + suffix;
    } else {
      search = base;
      replacement = withArticle + suffix;
    }
    out = out.replace(new RegExp(`\\b${escapeRegExp(search)}\\b`), replacement);
  }
  return out;
}

/** Redacts a full grounded answer into its spoiler-free hint form. */
export function redactToHint(groundedFullText: string, question: string): string {
  const known = knownQuantities(question);
  return splitSentences(groundedFullText)
    .map((s) => redactNames(redactQuantities(s, known)))
    .join(' ');
}
```

### src/guide/guide.service.ts
```ts
import { REFUSAL_MESSAGE } from './guide.types.js';
import type { AnswerMode, GuideAnswer, LlmClient, WikiSource } from './guide.types.js';
import { isSentenceGrounded, splitSentences } from './grounder.js';
import { redactToHint } from './redactor.js';

/**
 * Answer pipeline: one LLM call, sentence-level grounding gate, optional
 * spoiler-free redaction for hint mode. All business logic lives here; the
 * LLM client is injected and only produces raw text.
 */
export class GuideService {
  constructor(private readonly llm: LlmClient) {}

  async answer(question: string, sources: WikiSource[], mode: AnswerMode = 'full'): Promise<GuideAnswer> {
    if (sources.length === 0) {
      // No pages, no ground truth: refuse without consulting the model.
      return {
        status: 'refused',
        mode,
        text: '',
        refusalReason: REFUSAL_MESSAGE,
        droppedSentences: [],
        sourcesUsed: [],
      };
    }

    // Exactly one model call per answer, in both modes: the prompt carries no
    // mode, and hint mode is post-processing, never a re-prompt.
    const raw = await this.llm.complete({ question, sources });
    const sentences = splitSentences(raw);

    const kept: string[] = [];
    const dropped: string[] = [];
    const sourcesUsed = new Set<string>();

    for (const sentence of sentences) {
      const verdict = isSentenceGrounded(sentence, sources);
      if (verdict.grounded) {
        kept.push(sentence);
        for (const source of sources) {
          if (isSentenceGrounded(sentence, [source]).grounded) sourcesUsed.add(source.id);
        }
      } else {
        dropped.push(sentence);
      }
    }

    if (kept.length === 0) {
      return {
        status: 'refused',
        mode,
        text: '',
        refusalReason: REFUSAL_MESSAGE,
        droppedSentences: dropped,
        sourcesUsed: [],
      };
    }

    const fullText = kept.join(' ');
    return {
      status: 'answered',
      mode,
      text: mode === 'hint' ? redactToHint(fullText, question) : fullText,
      refusalReason: null,
      droppedSentences: dropped,
      sourcesUsed: [...sourcesUsed],
    };
  }
}
```

### src/guide/scripted-llm-client.ts
```ts
import type { LlmClient, LlmPrompt } from './guide.types.js';

export interface ScriptEntry {
  /** Matched against the prompt's question (substring or regex). */
  match: RegExp | string;
  /** The exact text the fake model "generates". */
  reply: string;
}

/**
 * Deterministic stand-in for a real LLM: returns the first scripted reply
 * whose match hits the question and fails loudly otherwise. Records every
 * prompt so tests can assert how many times the model was actually called.
 */
export class ScriptedLlmClient implements LlmClient {
  private readonly prompts: LlmPrompt[] = [];

  constructor(private readonly script: ScriptEntry[]) {}

  async complete(prompt: LlmPrompt): Promise<string> {
    this.prompts.push(prompt);
    const entry = this.script.find((e) =>
      typeof e.match === 'string'
        ? prompt.question.toLowerCase().includes(e.match.toLowerCase())
        : e.match.test(prompt.question),
    );
    if (!entry) {
      throw new Error(`ScriptedLlmClient: no scripted reply for question "${prompt.question}"`);
    }
    return entry.reply;
  }

  get callCount(): number {
    return this.prompts.length;
  }
}
```

### src/guide/fixtures.ts
```ts
import type { WikiSource } from './guide.types.js';

/**
 * The fetched wiki pages, provided as fixtures. Scenarios answer only from
 * these texts; the grounding gate can see nothing else.
 */

export const EMBER_ALTAR_PAGE: WikiSource = {
  id: 'ember-altar',
  title: 'Ember Altar',
  text:
    'The Ember Altar stands at the heart of the Mirefen. ' +
    'It demands 4 ember shards before it can be kindled. ' +
    'Kindled, it burns cold and lights the way out of the swamp. ' +
    'The altar was sealed long before the last survey.',
};

export const MIREFEN_PAGE: WikiSource = {
  id: 'mirefen',
  title: 'Mirefen',
  text:
    'The Mirefen is a flooded valley south of Ashbridge. ' +
    "Ember shards grow on the pale reeds along the Mirefen's eastern bank. " +
    'The water is ankle-deep by day and deep by night. ' +
    'Frost gates stand across the only path out.',
};

export const DUSKFANG_PAGE: WikiSource = {
  id: 'duskfang-warden',
  title: 'Duskfang Warden',
  text:
    'The Duskfang Warden is a boss that guards the Ember Altar. ' +
    'It drops a warden sigil after a clean defeat. ' +
    'The warden sigil opens the gate behind the altar. ' +
    'It patrols the reed beds after nightfall.',
};

export const ALL_WIKI_PAGES: WikiSource[] = [EMBER_ALTAR_PAGE, MIREFEN_PAGE, DUSKFANG_PAGE];
```

### src/eval/scenarios.ts
```ts
import { ALL_WIKI_PAGES } from '../guide/fixtures.js';
import type { WikiSource } from '../guide/guide.types.js';

/**
 * A golden scenario for the eval harness: the question, the exact sources the
 * assistant may use, the facts a correct answer must contain, and planted
 * FALSE facts (invented requirements) that must never appear.
 */
export interface GoldenScenario {
  id: string;
  question: string;
  sources: WikiSource[];
  /** Phrases a correct answer must contain (case-insensitive, word-bounded). */
  expectedFacts: string[];
  /** Planted false claims the answer must not contain. */
  plantedFalseFacts: string[];
}

export const KINDLE_ALTAR: GoldenScenario = {
  id: 'kindle-altar',
  question: 'How do I kindle the Ember Altar?',
  sources: ALL_WIKI_PAGES,
  expectedFacts: ['4 ember shards'],
  plantedFalseFacts: ['5 ember shards', 'Moonblade'],
};

export const SHARD_HUNT: GoldenScenario = {
  id: 'shard-hunt',
  question: 'I have 2 ember shards so far. What do I do next?',
  sources: ALL_WIKI_PAGES,
  expectedFacts: ['Duskfang Warden', 'ember shards'],
  plantedFalseFacts: ['5 ember shards', 'Moonblade'],
};

export const GOLDEN_SCENARIOS: GoldenScenario[] = [KINDLE_ALTAR, SHARD_HUNT];
```

### src/eval/judges.ts
```ts
import type { WikiSource } from '../guide/guide.types.js';
import { escapeRegExp, isSentenceGrounded, splitSentences } from '../guide/grounder.js';

export interface JudgeVerdict {
  /** 0..1 */
  score: number;
  findings: string[];
}

function containsFact(text: string, fact: string): boolean {
  const t = text.toLowerCase();
  const f = fact.toLowerCase().trim();
  if (f.length === 0) return true;
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(f)}(?:[^a-z0-9]|$)`).test(t);
}

/** Helpful = covers the expected facts. A refusal covers nothing. */
export function helpfulnessJudge(answerText: string, expectedFacts: string[]): JudgeVerdict {
  if (answerText.trim().length === 0) {
    return { score: 0, findings: ['answer is empty (refusal) - no expected fact can be covered'] };
  }
  const findings: string[] = [];
  let hits = 0;
  for (const fact of expectedFacts) {
    if (containsFact(answerText, fact)) {
      hits += 1;
    } else {
      findings.push(`missing expected fact: "${fact}"`);
    }
  }
  return {
    score: expectedFacts.length === 0 ? 1 : hits / expectedFacts.length,
    findings,
  };
}

/**
 * Faithful = every sentence is supported by the sources (the judge receives
 * the sources, not the scenario) and no planted false fact slips through.
 * A single planted false fact sinks the score to 0.
 */
export function faithfulnessJudge(
  answerText: string,
  sources: WikiSource[],
  plantedFalseFacts: string[],
): JudgeVerdict {
  if (answerText.trim().length === 0) {
    return { score: 1, findings: ['no claims made (refusal)'] };
  }
  const findings: string[] = [];
  const sentences = splitSentences(answerText);
  const supported = sentences.filter((s) => isSentenceGrounded(s, sources).grounded).length;
  const sentenceRatio = sentences.length === 0 ? 1 : supported / sentences.length;
  if (sentenceRatio < 1) {
    findings.push(`${sentences.length - supported} of ${sentences.length} sentences are not supported by the sources`);
  }
  for (const fact of plantedFalseFacts) {
    if (containsFact(answerText, fact)) {
      findings.push(`planted false fact present: "${fact}"`);
    }
  }
  if (findings.some((f) => f.startsWith('planted false fact'))) {
    return { score: 0, findings };
  }
  return { score: sentenceRatio, findings };
}
```

### src/eval/harness.ts
```ts
import type { GuideService } from '../guide/guide.service.js';
import type { GuideAnswer } from '../guide/guide.types.js';
import { faithfulnessJudge, helpfulnessJudge } from './judges.js';
import type { JudgeVerdict } from './judges.js';
import type { GoldenScenario } from './scenarios.js';

/** A scenario passes when its final score reaches this bar. */
export const PASS_THRESHOLD = 0.8;

export interface ScenarioReport {
  scenarioId: string;
  answer: GuideAnswer;
  helpfulness: JudgeVerdict;
  faithfulness: JudgeVerdict;
  /** min(helpfulness, faithfulness): one weak judge sinks the scenario. */
  finalScore: number;
  pass: boolean;
}

export async function runScenario(service: GuideService, scenario: GoldenScenario): Promise<ScenarioReport> {
  const answer = await service.answer(scenario.question, scenario.sources, 'full');
  const helpfulness = helpfulnessJudge(answer.text, scenario.expectedFacts);
  const faithfulness = faithfulnessJudge(answer.text, scenario.sources, scenario.plantedFalseFacts);
  const finalScore = Math.min(helpfulness.score, faithfulness.score);
  return {
    scenarioId: scenario.id,
    answer,
    helpfulness,
    faithfulness,
    finalScore,
    pass: finalScore >= PASS_THRESHOLD,
  };
}

export async function runSuite(service: GuideService, scenarios: GoldenScenario[]): Promise<ScenarioReport[]> {
  const reports: ScenarioReport[] = [];
  for (const scenario of scenarios) {
    reports.push(await runScenario(service, scenario));
  }
  return reports;
}
```

### test/guide.spec.ts
```ts
import { describe, expect, it } from 'vitest';
import { ALL_WIKI_PAGES, EMBER_ALTAR_PAGE, MIREFEN_PAGE } from '../src/guide/fixtures.js';
import { isSentenceGrounded } from '../src/guide/grounder.js';
import { GuideService } from '../src/guide/guide.service.js';
import { redactToHint } from '../src/guide/redactor.js';
import { ScriptedLlmClient } from '../src/guide/scripted-llm-client.js';
import type { ScriptEntry } from '../src/guide/scripted-llm-client.js';
import { REFUSAL_MESSAGE } from '../src/guide/guide.types.js';

const KINDLE_QUESTION = 'How do I kindle the Ember Altar?';
const CORRECT_KINDLE = 'The Ember Altar demands 4 ember shards before it can be kindled.';
const FAKE_ITEM_SENTENCE = 'A Moonblade is also required.';
const NEXT_QUESTION = 'I have 2 ember shards so far. What do I do next?';
const NEXT_REPLY =
  "Ember shards grow on the pale reeds along the Mirefen's eastern bank. " +
  'The Duskfang Warden guards the Ember Altar. ' +
  'You need 4 ember shards in all.';
const EXPECTED_HINT =
  "Ember shards grow on the pale reeds along the secret place's eastern bank. " +
  'The hidden boss guards the secret place. ' +
  'You need several ember shards in all.';

function build(entries: ScriptEntry[]): { service: GuideService; llm: ScriptedLlmClient } {
  const llm = new ScriptedLlmClient(entries);
  return { service: new GuideService(llm), llm };
}

describe('GuideService.answer - full mode', () => {
  it('returns the model answer untouched when every sentence is grounded', async () => {
    const { service } = build([{ match: 'kindle', reply: CORRECT_KINDLE }]);
    const res = await service.answer(KINDLE_QUESTION, ALL_WIKI_PAGES, 'full');

    expect(res.status).toBe('answered');
    expect(res.mode).toBe('full');
    expect(res.text).toBe(CORRECT_KINDLE);
    expect(res.droppedSentences).toEqual([]);
    expect(res.refusalReason).toBeNull();
    expect(res.sourcesUsed).toContain('ember-altar');
  });

  it('drops the ungrounded sentence and keeps the grounded one', async () => {
    const { service } = build([{ match: 'kindle', reply: `${CORRECT_KINDLE} ${FAKE_ITEM_SENTENCE}` }]);
    const res = await service.answer(KINDLE_QUESTION, ALL_WIKI_PAGES, 'full');

    expect(res.status).toBe('answered');
    expect(res.text).toBe(CORRECT_KINDLE);
    expect(res.droppedSentences).toEqual([FAKE_ITEM_SENTENCE]);
  });

  it('refuses with the exact phrase when the sources lack the answer', async () => {
    const { service } = build([
      { match: 'defeat', reply: 'The Duskfang Warden falls to 3 frost arrows. It weakens at dawn.' },
    ]);
    const res = await service.answer('How do I defeat the Duskfang Warden?', [EMBER_ALTAR_PAGE, MIREFEN_PAGE], 'full');

    expect(res.status).toBe('refused');
    expect(res.refusalReason).toBe(REFUSAL_MESSAGE);
    expect(res.refusalReason).toBe('not covered by my sources');
    expect(res.text).toBe('');
    expect(res.droppedSentences).toHaveLength(2);
  });

  it('refuses without calling the model when there are no sources', async () => {
    const { service, llm } = build([{ match: 'anything', reply: 'Sure, do the thing.' }]);
    const res = await service.answer('Anything at all', [], 'full');

    expect(res.status).toBe('refused');
    expect(res.refusalReason).toBe(REFUSAL_MESSAGE);
    expect(llm.callCount).toBe(0);
  });

  it('fails loudly when the scripted model has no reply for the question', async () => {
    const { service } = build([{ match: 'kindle', reply: CORRECT_KINDLE }]);

    await expect(service.answer('What is the weather like?', ALL_WIKI_PAGES)).rejects.toThrow(/no scripted reply/);
  });
});

describe('grounding gate', () => {
  it('catches a quantity error exactly: 5 shards fails when the sources say 4', () => {
    const verdict = isSentenceGrounded('You need 5 ember shards.', [EMBER_ALTAR_PAGE, MIREFEN_PAGE]);

    expect(verdict.grounded).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/quantity "5 ember shards" is not stated in any source/);
  });

  it('accepts the quantity the sources actually state', () => {
    const verdict = isSentenceGrounded('You need 4 ember shards.', [EMBER_ALTAR_PAGE, MIREFEN_PAGE]);

    expect(verdict.grounded).toBe(true);
    expect(verdict.reasons).toEqual([]);
  });

  it('rejects invented item names even in a fluent sentence', () => {
    const verdict = isSentenceGrounded(FAKE_ITEM_SENTENCE, ALL_WIKI_PAGES);

    expect(verdict.grounded).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/name "Moonblade" does not appear in any source/);
  });

  it('refuses end to end when the only reply carries the wrong quantity', async () => {
    const { service } = build([{ match: 'kindle', reply: 'You need 5 ember shards.' }]);
    const res = await service.answer(KINDLE_QUESTION, ALL_WIKI_PAGES, 'full');

    expect(res.status).toBe('refused');
    expect(res.droppedSentences).toEqual(['You need 5 ember shards.']);
  });
});

describe('hint mode', () => {
  it('redacts boss names, place names and unknown quantities from the grounded answer', async () => {
    const { service } = build([{ match: 'What do', reply: NEXT_REPLY }]);
    const res = await service.answer(NEXT_QUESTION, ALL_WIKI_PAGES, 'hint');

    expect(res.status).toBe('answered');
    expect(res.mode).toBe('hint');
    expect(res.text).toBe(EXPECTED_HINT);
    expect(res.text).not.toContain('Mirefen');
    expect(res.text).not.toContain('Duskfang');
    expect(res.text).not.toContain('4 ember shards');
  });

  it('is derived from the full answer by redaction, with one model call per answer', async () => {
    const { service, llm } = build([{ match: 'What do', reply: NEXT_REPLY }]);
    const full = await service.answer(NEXT_QUESTION, ALL_WIKI_PAGES, 'full');
    const hint = await service.answer(NEXT_QUESTION, ALL_WIKI_PAGES, 'hint');

    expect(llm.callCount).toBe(2);
    expect(full.text).toBe(NEXT_REPLY);
    expect(redactToHint(full.text, NEXT_QUESTION)).toBe(hint.text);
    expect(hint.text).not.toBe(full.text);
  });

  it('keeps a quantity the player already mentioned', async () => {
    const question = 'I have 4 ember shards. What do I do next?';
    const { service } = build([{ match: 'What do', reply: 'You need 4 ember shards in all.' }]);
    const res = await service.answer(question, ALL_WIKI_PAGES, 'hint');

    expect(res.status).toBe('answered');
    expect(res.text).toBe('You need 4 ember shards in all.');
  });
});
```

### test/eval.spec.ts
```ts
import { describe, expect, it } from 'vitest';
import { PASS_THRESHOLD, runScenario, runSuite } from '../src/eval/harness.js';
import { faithfulnessJudge, helpfulnessJudge } from '../src/eval/judges.js';
import { GOLDEN_SCENARIOS, KINDLE_ALTAR, SHARD_HUNT } from '../src/eval/scenarios.js';
import { ALL_WIKI_PAGES } from '../src/guide/fixtures.js';
import { GuideService } from '../src/guide/guide.service.js';
import { ScriptedLlmClient } from '../src/guide/scripted-llm-client.js';

const CORRECT_KINDLE = 'The Ember Altar demands 4 ember shards before it can be kindled.';
const CONFIDENT_LIE = 'The Ember Altar requires 5 ember shards and a Moonblade to kindle.';
const CORRECT_NEXT =
  "Ember shards grow on the pale reeds along the Mirefen's eastern bank. " +
  'The Duskfang Warden guards the Ember Altar. ' +
  'You need 4 ember shards in all.';

describe('eval harness', () => {
  it('scores a correct grounded answer high', async () => {
    const service = new GuideService(new ScriptedLlmClient([{ match: 'kindle', reply: CORRECT_KINDLE }]));
    const report = await runScenario(service, KINDLE_ALTAR);

    expect(report.answer.status).toBe('answered');
    expect(report.helpfulness.score).toBe(1);
    expect(report.faithfulness.score).toBe(1);
    expect(report.finalScore).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    expect(report.pass).toBe(true);
  });

  it('scores a scripted confident lie low', async () => {
    const service = new GuideService(new ScriptedLlmClient([{ match: 'kindle', reply: CONFIDENT_LIE }]));
    const report = await runScenario(service, KINDLE_ALTAR);

    expect(report.finalScore).toBeLessThan(0.4);
    expect(report.pass).toBe(false);
  });

  it('uses the min of the two judges as the final score', async () => {
    const service = new GuideService(new ScriptedLlmClient([
      { match: 'What do', reply: 'The Duskfang Warden guards the Ember Altar.' },
    ]));
    const report = await runScenario(service, SHARD_HUNT);

    expect(report.faithfulness.score).toBe(1);
    expect(report.helpfulness.score).toBeCloseTo(0.5);
    expect(report.finalScore).toBeCloseTo(0.5);
    expect(report.finalScore).toBe(Math.min(report.helpfulness.score, report.faithfulness.score));
    expect(report.pass).toBe(false);
  });

  it('runs the whole golden suite and every report obeys finalScore = min(judges)', async () => {
    const service = new GuideService(new ScriptedLlmClient([
      { match: 'kindle', reply: CORRECT_KINDLE },
      { match: 'What do', reply: CORRECT_NEXT },
    ]));
    const reports = await runSuite(service, GOLDEN_SCENARIOS);

    expect(reports.map((r) => r.scenarioId)).toEqual(['kindle-altar', 'shard-hunt']);
    for (const report of reports) {
      expect(report.finalScore).toBe(Math.min(report.helpfulness.score, report.faithfulness.score));
      expect(report.pass).toBe(report.finalScore >= PASS_THRESHOLD);
    }
    expect(reports.every((r) => r.pass)).toBe(true);
  });
});

describe('judges', () => {
  it('faithfulness catches a planted quantity error on ungated text', () => {
    const verdict = faithfulnessJudge('The altar requires 5 ember shards.', ALL_WIKI_PAGES, ['5 ember shards']);

    expect(verdict.score).toBe(0);
    expect(verdict.findings.join(' ')).toMatch(/planted false fact present: "5 ember shards"/);
  });

  it('faithfulness rewards fully source-supported text', () => {
    const verdict = faithfulnessJudge(CORRECT_KINDLE, ALL_WIKI_PAGES, ['5 ember shards', 'Moonblade']);

    expect(verdict.score).toBe(1);
    expect(verdict.findings).toEqual([]);
  });

  it('helpfulness scores partial fact coverage proportionally', () => {
    const verdict = helpfulnessJudge('The altar is in the Mirefen.', ['4 ember shards', 'the Mirefen']);

    expect(verdict.score).toBeCloseTo(0.5);
    expect(verdict.findings.join(' ')).toMatch(/missing expected fact: "4 ember shards"/);
  });

  it('helpfulness gives zero to a refusal', () => {
    const verdict = helpfulnessJudge('', ['4 ember shards']);

    expect(verdict.score).toBe(0);
  });
});
```
