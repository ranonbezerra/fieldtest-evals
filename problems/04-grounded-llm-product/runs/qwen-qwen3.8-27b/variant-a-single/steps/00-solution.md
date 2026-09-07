# solution

## reasoning

```
This is a completely self-contained, non-API task. The "conventions" header mentions NestJS/Prisma/PostgreSQL, but the task is a standalone answer pipeline + eval harness in TypeScript with an injectable LLM client (a scripted fake is fine). No database is needed. The task explicitly states: deliver `answer(question, sources, mode)` with an injectable LLM client (scripted fake is fine), hint mode via redaction of grounded answer, eval harness with golden scenarios, helpfulness judge + faithfulness judge (which receives sources), final score = min of both. Tests proving: scripted confident lie scores low, correct grounded answer scores high, missing answer in sources leads to refusal, quantity errors caught exactly.

Since there's no DB and no HTTP endpoint, NestJS/Prisma conventions don't really apply here — the layout section says "decide file layout yourself." Deliver a plain TypeScript module with Vitest tests. Keep it minimal but complete. Use a pnpm-style package.json? The instructions say "deliver all files the solution needs, from first line to last line." A minimal package.json and tsconfig are probably needed to run the tests. But "don't create files the task doesn't call for." Hmm. The task calls for tests; to run tests you need a package.json with vitest. I think it's reasonable to include a package.json and tsconfig.json, since "complete, first line to last line" means a runnable solution. But discipline says don't create files that aren't called for. The format says deliver all files the solution needs. package.json is needed to run vitest. Include package.json and tsconfig.json — defensible. Actually, let me think: does the solution "need" them? Tests are called for; vitest is the test runner per conventions; pnpm package manager. Without package.json, `pnpm test` won't work. I'll include them, plus vitest config? Vitest works without a config file if vitest is a devDependency and you run `npx vitest`. ESM with "type": "module" convention. I'll include a small package.json with type: module and a test script.

Now let me design the solution.

Core components:

1. `src/answer/llm-client.ts` — interface `LlmClient { complete(request: LlmRequest): Promise<LlmCompletion> }` and `LlmRequest = { system: string; user: string }`. Plus a `ScriptedLlmClient` fake that can be scripted per test/scenario: given a prompt, returns a pre-canned response. Scripting: a map or a function. For golden scenarios in eval, the harness needs a scripted client whose response matches the scenario (e.g., a "confident lie" scenario returns a response containing false facts; a "grounded" scenario returns a response grounded in sources).

2. `src/answer/answer.service.ts` — `answer(question, sources, mode, llm?)`:
   - Build a prompt asking the LLM to answer only using the given sources, marking sentences it can't ground, or returning a special refusal token like `NOT_COVERED`.
   - Get raw answer text.
   - Sentence-level grounding gate: split raw answer into sentences; for each sentence, check whether it's "grounded" in the sources using the gate. How to implement a grounding gate without an LLM? Deterministic check: extract "claims" (facts) from the sentence — entities, quantities, names — and check whether they appear in sources. A defensible deterministic approach: for a sentence to pass, all of its "factual atoms" (capitalized proper nouns, numbers/quantities with units, key content words) must be present in the sources' text. Numbers must appear with the same associated unit/noun. E.g., "5 shards" vs source "4 shards" → number mismatch → ungrounded.
   - Simpler, more robust approach: define `GroundingGate` as an injectable interface `gate(sentence, sources): GroundingVerdict` with default `LexicalGroundingGate` (deterministic):
     - Tokenize sentence, extract:
       - Proper nouns (capitalized sequences not at sentence start, or known names?) — hmm, sentence-start capitals are ambiguous. Alternative: extract all non-stopword "content tokens" and numbers, and require each to appear in the union of sources (case-insensitive), except for stopwords and common verbs. That's too strict — grounded answers will paraphrase ("defeat" vs "kill"). Paraphrasing would fail lexical grounding.
     - Better: focus gate on *factual load*: proper nouns (names), numbers+units, quantities, item names. In the eval, planted false facts are an invented item requirement (e.g., "requires Moonlight Shard" when sources never mention it) and quantity errors ("5 shards" vs 4). So gate should catch: (a) mentions of entities/names not in sources; (b) number mismatches for a given unit.
   
   Defensible design:
   - `extractFacts(sentence)` returns list of `FactualAtom`: `{ kind: 'entity', value }` (runs of capitalized words, excluding leading capitalized token unless it's a multi-word entity), `{ kind: 'quantity', number, unit }` (regex for number + optional word unit, e.g., /\b(\d+)\s*([a-z]+)/i), plus bare numbers maybe.
   - Grounded check:
     - Entity: normalized (lowercased) form must appear in normalized sources text. Also handle plural/suffix: "shards" vs "shard" — normalize by stripping trailing 's'? Simple stemming: check value, value+'s', value.slice(0,-1). Keep it simple.
     - Quantity: for unit u, collect all numbers associated with u in sources (regex on sources for `(\d+)\s*u\b`). The sentence's number must be in that set. If unit not in sources at all → ungrounded. If sentence has a number with no unit... e.g., "It takes 3" — check bare number against all numbers in sources? Hmm, bare number: check whether that number appears anywhere in sources? That might pass "5" even if source has 5 for something else. But the test requirement is catching "5 shards" vs "4 shards" exactly, so number+unit check covers it. Bare number: treat as grounded only if the number appears in sources (weak but acceptable; or treat bare numbers as a risky atom requiring appearance in source). I'll treat bare numbers as atoms requiring appearance in source text.
   - Also, sentences without factual atoms (pure connective/hedge sentences like "Let's think step by step.") — decision: treat as ungrounded filler and drop? The spec says "drop ungrounded sentences or refuse." If a sentence has no factual atoms, it has no claim; dropping it is safe. Actually, sentences like "You need the shards" have an entity atom "shards". Filler like "Based on the sources," — no atoms → dropped. Good.
   
   - After gating: If raw answer had any sentences with factual atoms and all dropped... Spec: "drop ungrounded sentences OR the service refuses with 'not covered by my sources'." I'll implement: if the raw answer contains at least one sentence with factual atoms and all are dropped → refuse with the exact message "not covered by my sources". Also if the LLM explicitly says "NOT_COVERED" or "I don't have information" → refuse. Hmm, better to define: if all sentences with factual atoms are dropped → refuse. If some sentences remain → return joined sentences. If zero sentences have factual atoms at all (pure hedge) → refuse (nothing grounded). That's clean: zero grounded atoms → refuse; else → drop the ungrounded ones and return what's grounded. But wait — the "confident lie" scenario: LLM answer is entirely invented, e.g., "The door opens with a Moonlight Shard. You need 5 shards." All atoms ungrounded → refuse. Then in eval: does a refused answer score low on helpfulness? Yes — the refusal is not helpful for a question that actually has an answer in sources. The faithful judge sees the sources and... a refusal is vacuously faithful. min(helpful, faithful) → low helpfulness → low final score. Good.
   
   But also: if some sentences grounded and some ungrounded (mixed lie) — drop the ungrounded, return the grounded part. That's the "drop" behavior. Both allowed by spec.

   - Mode: 'answer' | 'hint'. For hint: first produce the full grounded answer (same pipeline), then redact: `redact(answer, sources, question)`:
     - Redact boss names, item locations, quantities beyond what the player already mentioned.
     - Definition of "boss names", "item locations": entities (proper nouns / multi-word capitalized names) present in sources, and location words? "Item locations" — places where items are, e.g., "the cellar", "north room". How to determine what's a location? Deterministic approach: redact all proper-noun entities (names) and named places, plus all quantities (numbers with units) not mentioned by player in the question (i.e., redact the number but keep the unit? e.g., "4 shards" → "several shards"? or just drop the number: "shards"). "Quantities beyond what the player already mentioned" — if player says "I have 2 shards", the quantity 2 is already known, so it's allowed to appear? Actually "must not reveal quantities beyond what the player already mentioned" means the hint cannot state a quantity the player hasn't stated. E.g., "You need 4 shards" reveals quantity 4 → must redact → "You need more shards"? Deterministic redaction: replace number+unit with just the unit ("shards") or "some shards". I'll replace `N unit` with `some unit` (if unit exists), and standalone numbers with "some". But if the player mentioned that exact quantity+unit in the question (e.g., "I have 2 shards"), keep it? "Beyond what the player already mentioned" → quantities the player mentioned are okay. So: if (number, unit) pair appears in the question, keep it; else redact.
     - Names: redact proper noun entities → "the boss", or just mask with "the hidden name"? Deterministic: replace each entity (multi-word or single capitalized non-start word... tricky) with a generic placeholder. Hmm, redacting single capitalized words not at start of sentence is doable: pattern `\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b` matched outside sentence-start position. But items like "Moonlight Shard" are capitalized. "shards" lowercase common item — is that a name? In the scenario, sources mention items. Redaction should target *names* (proper nouns) and locations. Lowercase item mentions like "shards" — is that a location? No. Item name in lowercase... the hint must not reveal "item locations" (places), not item names themselves? Rereading: "must not reveal boss names, item locations, or quantities beyond what the player already mentioned." So three things: (1) boss names, (2) item locations (where items are), (3) quantities beyond player-mentioned. Item names themselves (e.g., "shards") are probably okay to mention? Hmm, but knowing which item to collect is somewhat spoiler-y, but the spec explicitly lists only three things. I'll redact: proper-noun names (bosses and named items), place names/locations (proper-noun places, and also phrase patterns "in the X" / "at X" with lowercase X? too aggressive). Defensible deterministic approach: redact all proper-noun entities (names of any kind — boss names, named items, named places), plus quantities not in the question. And treat "item locations" as locations — but how do I know an entity is a location vs item? Can't do it deterministically without an NER. Mark ASSUMPTION: treat all proper-noun entities as redactable secrets, replacing with a generic placeholder ("the creature" for boss? we can't tell). Simpler: replace with a masked form like `■■■`? Better UX: replace with category-less placeholder "the name-withheld". Hmm.

     Cleanest: `redact(text, question)`:
       1. For each proper-noun entity (multi-word capitalized or single capitalized word not at sentence start), replace with `REDACTED`? But "hint" should be useful: "Defeat the boss in the REDACTED area"? Hmm, replacing "Moonlight Shard" with "a key item"? Can't classify.
     
     Let me decide: replace proper noun entities with "a hidden name" if at start... no. Use a neutral token: replace with "…"? For tests, assertion: hint does not contain "Moonlight", not "Shard"? Wait, "Shard" is capitalized as named item "Moonlight Shard" — replacing the full entity "Moonlight Shard" → placeholder "a hidden item"? I'll use a single placeholder string constant: `REDACTED`? A hint with "Defeat the [REDACTED]" is a reasonable hint. Tests assert `hint` does not contain the boss name and does not contain quantities.
     
     Hmm wait, but lowercase location words ("in the cellar") — my deterministic redaction won't catch them. To honor "item locations," also redact the objects of location prepositions: pattern `\b(?:in|at|on|under|behind|inside)\s+((?:the|a|an)\s+)?[a-z]+\b` — redact that noun? That could destroy the hint ("defeat the boss in the ___"). Actually that's what a spoiler-free hint should do: "defeat the boss in a certain area"? That's useless. But the spec's point: hint must not reveal locations. I think redacting location phrase objects is right: "in the CELLAR" → "in a hidden area"? I'll implement: replace location-phrase objects with "a hidden place" when the object noun isn't trivial (like "here", "outside"?). Keep a small stoplist of non-secret location nouns: here, there, outside, inside? hmm inside+X.

     Let me be pragmatic: redactions:
       - Proper-noun entities → "the boss"? No — can't tell if boss. Use a generic: "a key name"? I'll use `[REDACTED]`-style: constant `MASK = "▓▓▓"`? ASCII-safe: "[REDACTED]". Hint: "Defeat [REDACTED] with the right item." Useful enough.
       - Location phrase objects (in/at/under/behind/inside + the + noun) → "a hidden place".
       - Quantities: number+unit → if (number+unit) appears in the question (case-insensitive), keep, else "several unit"? If unit, "several shards"; standalone number → "a few". Hmm "4 shards" → "several shards" reveals it's plural shards but not count — okay.
     
     That's a defensible deterministic redaction. The eval's faithfulness judge also validates the hint? Hint is derived from grounded answer by redaction, so groundedness holds (redaction only removes info). Helpful judge for hint: checks it contains directional/strategic content? The golden scenario can have `expectedHints`? Keep eval generic.

3. Eval harness `src/eval/eval-harness.ts`:
   - Types: `GoldenScenario { id, question, sources, mode, llmScript: string (the fake LLM returns this), expectedFacts: string[], plantedFalseFacts: string[], description? }`
   - `FaithfulnessJudge`: receives (answer, sources) — "faithfulness judge that receives sources". Deterministic implementation: use the same fact extraction: for each factual atom in the answer, check support in sources; return 0..1 = fraction supported, plus explicit check for planted false facts: if any plantedFalseFacts string (normalized) appears in the answer → cap at low score (e.g., 0)? Spec says "planted false facts like invented item requirement" — planted in the *LLM script* (the fake confident lie) — the judge must catch it. Deterministic: planted false fact appears in answer AND not in sources → faithfulness 0. Actually, general atom check will catch "Moonlight Shard" not in sources → fraction drops. With all-atom fraction, one ungrounded atom among many → 0.75, might not be "low enough". To make "confident lie scores low" robust: if any atom contradicts a quantity in sources (5 vs 4 shards) OR any proper noun not in sources → hard fail (0.0)? Or threshold: score < 0.5? Let me define faithfulness judge scoring:
     - If answer is refusal: faithful = 1.0 (nothing false claimed).
     - Else compute atoms; each atom: supported (1) / contradicted (0, e.g., quantity mismatch or name absent) / neutral? I'll treat all ungrounded as contradictions for strictness. score = supported/total. Additionally: if any plantedFalseFact (normalized) is found in the answer → score = 0.0 (explicit contract). Hmm, plantedFalseFact appears in scenario because we planted it in the LLM script; the judge receiving sources can detect it's not supported. The explicit list is a double safety: assert planted false is not present. I'll implement: faithfulness = (fraction of supported atoms) * (plantedFalseFacts present in answer ? 0 : 1). Actually simpler: if any plantedFalseFact string is found in answer → 0. Else fraction of supported atoms.
     - Refusal handling: if answer is the refusal message, helpfulness should be 0 (for a question where sources actually have answer), faithfulness 1.
   - `HelpfulnessJudge`: golden scenario gives `expectedFacts: string[]` — the answer must include all expected facts (normalized substring match, or fact-level: each expected fact's key content present). helpfulness = matched/total? For high score on correct answer: all expected facts present → 1.0. For refusal on answerable question: 0. For "sources missing answer leads to refusal" scenario: what is expected? Expected behavior = refusal; helpfulness there should reflect "did the service do the right thing" — hmm, helpfulness judge is about answer quality; the golden scenario for missing-answer would have expectedFacts empty and an `expectRefusal: true` flag. I'll add optional `expectRefusal?: boolean` to scenario. If expectRefusal: helpfulness = isRefusal ? 1 : 0. Else helpfulness = fraction of expected facts present (and if answer is refusal → 0).
   - `runEval(scenarios, llmClientFactory)` → per-scenario: `{ id, mode, answer, helpfulness, faithfulness, finalScore: min(helpfulness, faithfulness), pass: finalScore >= threshold (0.75?) }`. Tests assert specific numbers.

4. LLM fake: `ScriptedLlmClient implements LlmClient` — constructor takes a `script: (request) => string` or a queue. For eval: each scenario provides `llmReply` (the fake's output). `ScriptedLlmClient.fromReplies(map)`? Simplest: `new ScriptedLlmClient({ reply: (req: LlmRequest) => string })`. In harness, wrap scenario.llmReply in a client. Also a `CannedLlmClient` that just returns a fixed string.

Let me settle the file layout (kebab-case by convention):

```
package.json
tsconfig.json
src/answer/llm-client.ts          (LlmClient interface, LlmRequest, ScriptedLlmClient)
src/answer/text-utils.ts          (sentence split, normalization, fact extraction) — or keep in grounding-gate
src/answer/grounding-gate.ts      (FactualAtom, extractAtoms, LexicalGroundingGate, GroundingGate)
src/answer/answer.service.ts      (AnswerService with answer(question, sources, mode), redact for hint, refusal message)
src/eval/judges.ts                 (FaithfulnessJudge, HelpfulnessJudge)
src/eval/eval-harness.ts           (GoldenScenario, runEval, EvalReport)
test/answer.spec.ts                (pipeline tests: lie low, grounded high, missing→refusal, quantity exactly caught)
test/hint.spec.ts                  (redaction tests: boss names, quantities, player-mentioned quantities kept, no re-prompt: assert llm.complete called once for hint mode)
test/eval.spec.ts                  (harness end-to-end scoring)
```

Convention naming: TS files `kebab-case.role.ts` — e.g., `answer.service.ts` (service role), `eval-harness.ts` has no role suffix... The convention says `src/<feature>/<feature>.controller.ts` etc. for NestJS features. This isn't a NestJS API (no DB, no endpoint). Roles: service, repository... `answer.service.ts` ✓. For the others: `llm-client.ts`, `grounding-gate.ts`, `judges.ts`, `eval-harness.ts` — fine as kebab-case modules. Tests `test/<feature>.spec.ts` → `test/answer.spec.ts`, `test/eval-harness.spec.ts`, `test/hint.spec.ts`? Convention: `test/<feature>.spec.ts` — I'll use `test/answer.service.spec.ts`? The layout says `test/<feature>.spec.ts`. I'll do `test/answer.spec.ts` and `test/eval.spec.ts`, plus `test/hint.spec.ts`. Three spec files under test/.

Should I use NestJS (@Injectable, modules)? Task says "answer(question, sources, mode) using an injectable LLM client (a scripted fake is fine)". "Injectable" = dependency injection; in a non-API product, constructor injection suffices. Using @nestjs/common just for @Injectable adds dep for nothing — the layout/conventions target API features; this task is a library + harness. I'll go with plain classes with constructor DI (still "injectable"). Mark as ASSUMPTION? The task itself says "scripted fake is fine," implying non-Nest is acceptable. I'll skip NestJS; that's the most defensible reading given no endpoint/DB requirement. No Prisma, no Postgres — nothing to persist. I won't create a prisma schema (task doesn't call for it; discipline: don't create files not called for).

Now, let me write the code carefully.

### text utilities / fact extraction

Normalization: lowercase, collapse whitespace, strip punctuation? For matching names like "Moonlight Shard" vs sources "Moonlight shard"? Case-insensitive match. Keep simple: normalize = lowercase + trim + collapse whitespace.

Sentence split: split on /(?<=[.!?])\s+/ — lookbehind supported in Node 20. Handle multi-sentence too. Fine.

Fact atom extraction from a sentence:

```ts
export type FactualAtom =
  | { kind: 'entity'; value: string }          // normalized proper noun phrase
  | { kind: 'quantity'; number: number; unit: string | null }
  | { kind: 'number'; number: number };         // standalone number (no unit)
```

Entity extraction: regex `\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\b` finds capitalized phrases, then exclude if the match is at the start of the sentence (first word) — unless it's part of a longer capitalized phrase starting at position 0? E.g., "Moonlight Shard lies in the cellar." — "Moonlight Shard" is at start → it's a name, not sentence-start artifact. Ugh. Ambiguity: "The tower holds the answer." "The" is capitalized due to sentence start — exclude. But "Moonlight Shard" at start is a name. Heuristic: single capitalized word at start of sentence → likely sentence-start (unless followed by another capitalized word as part of phrase, or is in a known set). Multi-word capitalized phrases always names. So:
- Multi-word match (2+ words all capitalized) → entity regardless of position.
- Single-word match: only entity if not at start of sentence (i.e., preceded by non-start char) OR if next word is also... no, if it's at start AND single-word → treat as potential artifact → but "Moonlight" alone as start: "Moonlight Shard..." captured as multi-word "Moonlight Shard". A single "Moonlight" alone at start would be a false exclusion but rare in our scenarios. To be safer: single-word at start → include only if also appears mid-sentence? Overkill. Decision: at start, single-word capitalized → skip (mark as potential artifact). ASSUMPTION comment about sentence-start ambiguity. Hmm but in planted lie "The Moonlight Shard opens the gate." — "The" at start is skipped, "Moonlight Shard" is multi-word → caught. Good. In the grounded answer "Moonlight Shard is a key item." start — "Moonlight Shard" multi-word → entity. Good.

But wait — sources are plain prose that may use lowercase items ("shard"). Then entity "shard" wouldn't be extracted as atom at all (not capitalized), so the gate wouldn't catch an invented lowercase item name like "glimmer key" if the LLM invents it lowercase. Planted false facts in scenarios — I'll design scenarios with capitalized invented item names so the gate catches, and I'll also have plantedFalseFacts explicit list check in judge as backstop. In the gate, to catch invented lowercase phrases... can't do deterministically without a dictionary. Note as ASSUMPTION/limitation in a comment? Task asks tests to prove quantity errors caught exactly and lie scores low — my design achieves both with capitalization + explicit planted list. Also I can add: a sentence-level "content word overlap" heuristic? Let me add a second gate check: *novel content word* — any content (non-stopword) word in the sentence not found in sources... grounded answers will paraphrase verbs ("defeat" vs "kill") → false positive. But I can limit to noun-like: too fragile. Skip; keep entity+quantity gate, document as limitation. Actually — another strong deterministic signal: *quantity context*: "5 shards" — if "shards" appears in sources but number 5 doesn't co-occur → caught. "Moonlight Shard" not in sources → caught. Invented lowercase "glimmer key" — I'll rely on plantedFalseFacts for that. But that's judge, not gate. For the gate, the confident lie test will use entities/quantities → gate refuses → score low via helpfulness. Fine.

Quantity extraction: regex `/\b(\d+(?:\.\d+)?)\s+([a-z]+)/gi` → number + unit (lowercased). Also standalone number without trailing lowercase word: `/\b\d+(?:\.\d+)?\b/` minus those already matched as unit pairs. "4 shards" → quantity {4, 'shard'?} — unit "shards" plural; normalize unit by stripping trailing 's'. Source "4 shards" → same normalization → unit 'shard', number 4. "5 shards" → number 5, unit 'shard' → check sources: set of numbers with unit 'shard' = {4} → 5 ∉ {4} → contradicted → ungrounded. "Exactly" caught: any mismatch is drop/refuse, no fuzzy tolerance.

Also "two shards"? Number spelled out — my scenarios use digits; note as assumption? Add a small spell-out map for one..ten? I'll add a small map for common spell-outs (one–ten) so "five shards" also caught. Cheap. OK: expand spell-outs first? Simpler: regex alternation `(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(unit)`, and map spell-out to number. Careful: "five" is also a normal word ("five keys" is legit). OK, include.

Source-side extraction: same function over the whole source text (treat entire source as one block; entity capitalization still applies; quantity: all number+unit pairs found in sources → map unit → set(numbers). Also bare number → set.

Entity support check: normalized entity value (lowercased) appears as substring of normalized sources? E.g., "Moonlight Shard" → "moonlight shard" in sources ✓. Invented "Blood Moon Amulet" → not in sources → ungrounded. Singular/plural: "Shard" vs "shards": substring "shard" in "shards" ✓. OK.

Also for multi-word entity, substring match works.

Edge: entity equal to "The"? Filter with stopword list (single word, and stopword capitalized at start is already filtered by position; but "The Moonlight..." — "The Moonlight"? regex `[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*` on "The Moonlight Shard opens..." would match "The Moonlight Shard" as one phrase! Because The and Moonlight and Shard are all capitalized. Ugh. Strip leading stopword from match: while first word of match is in STOPWORDS (the, a, an, this, that, these, those, you, your, i, we, it, he, she, they, is, are, was, were) → drop first word. "The Moonlight Shard" → "Moonlight Shard". "The Tower of Ashes" → "Tower of Ashes"? "of" is lowercase so match = "The Tower", then "of", then "Ashes" — the regex only joins runs of capitalized words: "The Tower" + "of" (lowercase, stops run) + "Ashes" separate → entity "Tower" (after stopword strip) and "Ashes" → normalize "ashes" — appears in sources "tower of ashes" ✓. Substring check per word... "tower" in sources ✓, "ashes" ✓. Well, works with substring. But better: strip stopwords from the middle too? Let me keep: strip leading/trailing stopword tokens from the phrase, and also filter single-word stopwords. "Tower of Ashes" → entities "Tower", "Ashes", both substrings ✓.

Sentence has no atoms → treat as filler, drop in answer mode (no claim). Hmm — but a grounded answer like "Defeat the boss in the hidden cellar." Atoms: "boss" lowercase, "cellar" lowercase — no capital, no number → zero atoms → the whole sentence drops → refusal! Bad. Hmm. That breaks the core grounded case. Need better.

Reconsider: zero-atom sentence — can't verify but not necessarily false. Options: (a) keep zero-atom sentences (can't be disproved) — but then a confident lie "You should rush in and attack" (no atoms) passes — but such a sentence also has no facts; eval helpfulness judges by expected facts. (b) drop → false refusal on legit answers.

Better: treat zero-atom sentences as *weakly grounded*: keep them if the raw answer contains at least one fully grounded sentence (answer has signal), drop them if the entire raw answer is atomless (nothing to ground on → refuse). Hmm, but "drop ungrounded sentences OR refuse" — the spec allows dropping ungrounded ones; keeping unverifiable ones is a design choice. For robustness of the required tests:
- Correct grounded answer: e.g., "Defeat the Gravel Wretch in the cellar. Bring 4 shards." — "Gravel Wretch" entity grounded in source ✓; "4 shards" grounded ✓ → answer returned. Refusal won't trigger.
- Sources missing answer: LLM script returns "Climb the north spire at dawn." Atoms: "north spire"? lowercase "north" not capitalized... "North Spire" would be capitalized. Sources don't mention it → ungrounded → refuse ✓. If LLM says something atomless "I suggest you wait." → zero atoms across answer → refuse (my rule (b)) ✓. Good: refusal when "no grounded content at all" aligns with "not covered by my sources."
- Confident lie: planted with false names/quantities → all atoms ungrounded → refuse → helpfulness 0 → low score ✓. Or mixed: drop lies, keep grounded → the planted false fact absent → faithfulness fine, helpfulness = expectedFacts match... The test "scripted confident-lie answer scores low": script returns full lie with false facts; expect refusal or dropped; final score low. My pipeline refuses when nothing is grounded → helpfulness 0 → final 0.

So the gating decision:
```
groundedSentences = sentences.filter(s => s has at least one grounded atom? no...)
```
Let me define per-sentence: `atoms = extractAtoms(sentence)`; if atoms.length > 0: grounded = atoms.every(a => supported(a)); else grounded = null (verifiable). Sentence with atoms and any atom unsupported → drop (ungrounded sentence containing false claims — safer to drop than to keep half-true sentences? A sentence "Bring 4 shards or 5 runes" — one atom fine, one bad → drop the sentence. Fine).
Final: `verifiableGrounded = sentences with atoms all supported`; `droppable = atomless sentences`;
- If verifiableGrounded.length === 0 → refuse with REFUSAL_MESSAGE.
- Else result = [...verifiableGrounded, ...droppable?] — include atomless? If we include, order: keep original order, filter out ungrounded. Let me do: keep sentence if (atoms empty) OR (atoms all supported); drop if (atoms nonempty && any unsupported). Then if kept sentences have zero atoms total → refuse. This matches: pure filler/hedge answer → refuse; mixed → grounded+filler kept.

Hmm wait, one more: refusal message exact: "not covered by my sources". Spec says refuse with "not covered by my sources" — use exactly that string as the answer text (maybe full sentence "Sorry — not covered by my sources."? "Refuse with 'not covered by my sources'" — I'll return exactly `not covered by my sources` as the answer string; tests assert equality/contains. Keep the constant `NOT_COVERED_MESSAGE = 'not covered by my sources'`.

Return type: `{ answer: string; mode: 'answer' | 'hint'; grounded: boolean; droppedSentences?: string[] }`? Keep: `AnswerResult { text, refusal: boolean, mode }`. Include `dropped` list for transparency (useful for tests). OK.

LLM prompt: system: "You are a game guide. Answer ONLY using the provided wiki pages. If the pages do not contain the answer, reply exactly: NOT_COVERED." user: question + sources numbered. The service also checks if LLM replies "NOT_COVERED" → refuse directly (LLM says not covered). And gate handles the rest.

### Hint redaction

`redactHint(fullAnswer, question)`:
1. Proper-noun entities (using same extractor over full answer text; but we need positional replacement, not just set). I'll write a function `redactEntities(text, allowedNames?: string[])`: find entity matches (using same phrase regex + stopword stripping), replace each with a placeholder. Placeholder: "the boss"? Use a generic category-less: `REDACTED_NAME`? For human hint, maybe "a hidden foe"? I'll go with a constant: `NAME_PLACEHOLDER = '[redacted name]'`. Hmm, hint readability: "Defeat [redacted name] in the cellar." Wait — "cellar" lowercase location: location redaction: pattern for place: `/\b(?:in|at|on|under|behind|inside|beyond)\s+(?:the|a|an)?\s+([a-z][a-z-]*)/gi` → replace captured noun with "a hidden place"? "in the cellar" → "in a hidden place". "behind the altar" → "behind a hidden place"? "behind" already indicates direction — that's a partial location reveal... but the object is redacted, so fine.

   Beware false positives: "in the way", "at the cost of", "in the end", "at the end", "on the ground" (ground = location?), "in the game". Add a stoplist of non-secret location nouns: {end, way, game, hand, place, room? no room is a location but generic}... Keep stoplist small: end, way, game, time, end, mind, fact, short. "at the end of the corridor" — redacting "end" is bad → stoplist 'end' ✓. "on the ground" — ground is generic, not a secret location → add 'ground'. "in the air" → 'air'. OK stoplist: {end, way, game, air, ground, time, place, position}.

   But wait: hint usefulness — redact location noun entirely: "in a hidden place"? Replacement string: "a hidden place" when article present, "a hidden place" otherwise? "behind the altar" → "behind a hidden place" a bit awkward but fine. Or just replace the noun word: "in the ___" → "in the hidden area"? I'll replace the entire "in the cellar" span with "in a hidden place" (consume the article): regex `/(?:in|at|on|under|behind|inside|beyond
```

## reply

)\s+(?:(?:the|a|an)\s+)?([a-z-]+)/gi` → if captured in stoplist, leave alone; else replace full match with `<prep> a hidden place`. "in a hidden place" OK. "at a hidden place" OK.

2. Quantities: `/\b(\d+|one|two|...|ten)\s+([a-z]+)/gi` → normalize number; if question contains same (number, unit) pair (check with normalized question: search for number (digit or spell-out) + unit) → keep; else replace with "several " + unit? If unit is null (bare number) → replace with "a few"? Bare number replacement: "3" → "a few"? "wait 3 minutes" → "wait a few minutes" ✓. Unit: "4 shards" → "several shards". But "several" implies 3+... okay, not a quantity. Edge: "the 4th shard" — "4th"? My regex requires word after number; "4th" has 'th' attached — `\d+` matches "4" then `\s+` fails on "th" → not matched as unit pair; standalone number → "a fewth"?? Broken. Exclude ordinals: don't match if number followed by non-space (i.e., \b then 'th'). I'll use negative lookahead `(?![a-z])`... hmm "4 shards": after "4" is space ✓. "4th": after "4" is 't' → skip with `(?!\s*\d)(?![a-z])`... Simpler: match `/\b(\d{1,3}(?:st|nd|rd|th)?)(?:\s+([a-z]+))?\b/gi` and handle: if ordinal suffix → skip redaction? "the 4th shard" — 4th is arguably a quantity-ish detail... Skip ordinals (ASSUMPTION note? trivial). Actually simplest and robust: only redact `number + space + unit` and standalone digit tokens not followed by letter/digit. "4th" left alone — acceptable, note in a comment.
   
   Also, spell-out quantities: "five shards" → "several shards". Spell-outs in question: "I have two shards" → (two, shard) allowed → keep "two shards" in hint? Hint derived from answer may say "you have 2 shards"? Answer unlikely to echo player's count. I'll implement the pair-keep check in normalized form (both digit and spell-out forms).

3. Also, redaction must not reveal quantities — the redacted hint itself must not contain any number+unit not in question. After redaction, we can verify with the same extractor in tests.

Hint pipeline (derived, no re-prompt):
```
async answer(q, sources, mode):
  raw = await llm.complete(prompt)
  if raw includes NOT_COVERED → refuse
  gated = gate(raw, sources)
  if refused → return { text: NOT_COVERED, refusal: true }
  if mode === 'answer' → return { text: gated }
  hint = redact(gated, question)
  return { text: hint, refusal: false, derivedFrom: gated? }
```
Include `fullAnswer` in result when hint mode (for eval/debug? eval wants to score the hint against expected? I'll include `fullAnswer?: string` in result when mode is hint — useful, and tests can assert redaction used it). OK.

### Judges

`FaithfulnessJudge { judge(answer: string, sources: string[], opts?: { plantedFalseFacts?: string[] }): number }`
- If answer is refusal (=== NOT_COVERED or startsWith?) → 1.0.
- plantedFalseFacts: normalized substring in normalized answer → 0.0.
- Atoms in answer: if zero atoms → 1.0? An atomless answer claims nothing → faithful. But "You should rush in" is harmless → 1.0 ✓ (min with helpfulness governs).
- Else supported/total where supported = grounded per gate logic. Contradiction (quantity in unit set? present in source) → supported. So score ∈ {0..1} fractions. For "5 shards" when source has 4: atoms: "5 shards" ungrounded; other atoms maybe grounded → e.g., answer "Bring 5 shards to the gate." Atoms: quantity 5/shard (no), entity? none → 0/1 → 0.0 → low ✓.

Hmm, the gate drops ungrounded sentences, so the *returned* answer shouldn't contain ungrounded atoms... unless atomless... So how does the eval ever see a bad answer? Because: (a) refusal case; (b) mixed sentences where ungrounded sentence was dropped — then answer is fine, lie is dropped → score reflects what was returned; the test "confident lie scores low" uses a fully ungrounded script → refusal → helpfulness 0.0 → final 0.0 ✓. The quantity test: "quantity errors (e.g., '5 shards' when sources say 4) caught exactly" — caught = gate drops/refuses AND faithfulness judge gives 0 for such an answer. I'll test both: (i) pipeline with script saying 5 shards → result refuses (or drops sentence); (ii) faithfulness judge directly on "Bring 5 shards to the gate." with source "4 shards" → 0. "Caught exactly" = not fuzzy: 5 ≠ 4 is fail; also 4 would pass (judge → 1.0 on that sentence). I'll assert both.

But wait — is the judge also used on dropped answers? The harness scores the *final* answer the service returned. In a mixed lie scenario (script: "The door needs the Moonlight Shard. Bring 4 shards."), the gate drops the first sentence, returns "Bring 4 shards." → helpfulness: expectedFacts ["4 shards"] → 1; faithfulness 1 → high. Planted false fact absent from final answer → planted check passes. And a separate direct judge test shows the lie sentence itself scores 0. OK.

`HelpfulnessJudge { judge(answer: string, scenario: { expectedFacts: string[]; expectRefusal?: boolean }): number }`
- If expectRefusal: isRefusal(answer) ? 1.0 : 0.0.
- Else if isRefusal: 0.0.
- Else matched = expectedFacts.filter(f => normalizedAnswer.includes(normalized f)).length; total ? matched/total : (answer nonempty ? 1.0? hmm, if no expected facts defined, helpfulness = 0.5? Let me require expectedFacts nonempty in non-refusal scenarios, otherwise 0.0 for safety? I'll do: total===0 → 0.0 (no evidence of helpfulness).)
- Also penalize if answer contains planted false fact? That's faithfulness's job (min). Keep separation.

`runEval(scenarios: GoldenScenario[], makeLlm: (s) => LlmClient)` — each scenario includes its own `llmReply: string` (scripted fake reply) so harness is self-contained: `const llm = new ScriptedLlmClient(() => s.llmReply)`.

Wait — hint mode in eval: hint is derived; scenario for hint: expectedFacts = things the hint should contain (e.g., "several shards"? or "boss"?). I'll include one hint scenario in the tests with expectedFacts like "shards" (word survives) and redaction checks done in tests directly.

`EvalScenarioReport { id, mode, text, refusal, helpfulness, faithfulness, finalScore, pass }`, `pass = finalScore >= 0.75`? Threshold constant PASS_THRESHOLD = 0.75, overridable. `EvalReport { reports, overall: average of finalScore? passAll }`. Keep: `{ scenarios: reports, passed: boolean, average: number }`.

### Golden scenarios (in test file, or in `src/eval/golden-scenarios.ts`?)
Task: "eval harness: golden scenarios (question, sources, expected facts, planted false facts...)". The scenarios themselves are eval fixtures — put in a data file `src/eval/golden-scenarios.ts` exporting `GOLDEN_SCENARIOS: GoldenScenario[]`? Or keep in tests? Harness = mechanism; golden scenarios = data used by tests. The task lists golden scenarios as part of the harness deliverable. I'll make `src/eval/golden-scenarios.ts` exporting the array. Test file imports and runs the harness, plus adds targeted tests. Good.

Scenario data (design carefully so everything is consistent):

Common source text for main scenarios (fictional game):
```
source A: "The Gravel Wretch is the guardian of the cellar. It can only be weakened by a shard of glass. Four shards are required to seal the cellar door."
source B: "The cellar lies behind the bakery. The door has no keyhole. Shards of glass can be found in broken windows."
```
Hmm "Four shards are required" — digit vs spell-out: my quantity extraction handles spell-out "four" → 4, unit "shard" (from "shards"). And "Four" is at sentence start and capitalized — the entity regex would also capture "Four" as single-word at start → filtered by position rule ✓ (single word at start is skipped). But note: "Four shards are required" — the spell-out quantity regex must match "Four" — my regex `\b(five|four|...)\s+([a-z]+)` with /i flag will match "Four shards" case-insensitively ✓. But entity extraction: "Four" at start of sentence → single word at start → skip ✓.

Question: "How do I get past the cellar door?"
Grounded LLM reply (script): "Weaken the Gravel Wretch with a shard of glass. Four shards are required to seal the cellar door."
- Sentence 1 atoms: entity "Gravel Wretch" ✓ (in source), quantity "1 shard"? "a shard" — "a" not digit/spell-out → no quantity atom. Entity? "shard of glass" lowercase. OK atoms: [Gravel Wretch] grounded ✓.
- Sentence 2 atoms: quantity (4, shard): sources numbers for unit shard: from "Four shards" → {4}; "a shard of glass" → no number. So {4} ∋ 4 ✓ grounded. Entity: "Four" at start single word → skipped ✓. So kept.
- Hint redaction of "Weaken the Gravel Wretch with a shard of glass. Four shards are required to seal the cellar door.":
  - Entity "Gravel Wretch" → [redacted name]: "Weaken the [redacted name] with a shard of glass."
  - "shard of glass" lowercase — not redacted (item name in lowercase is allowed? "item locations" not names — OK).
  - Quantity "Four shards": question "How do I get past the cellar door?" — player did not mention any quantity → redact → "several shards".
  - Result: "Weaken the [redacted name] with a shard of glass. Several shards are required to seal the cellar door."
  
  Hmm "Several shards are required" — reveals plural + that shards are required but not the count 4. Acceptable per spec (quantity beyond player-mentioned → redact ✓).
  Wait, "a shard" — article + noun, not a quantity ✓ keep.
  - Location: "in the cellar"? Answer doesn't mention location. Source B has "behind the bakery" — the grounded answer doesn't include it, fine. Add sentence to LLM script that includes location for hint redaction test? Grounded script can be: "The cellar lies behind the bakery. Weaken the Gravel Wretch with a shard of glass. Four shards are required to seal the cellar door." — Check sentence 1: atoms: "The cellar lies behind the bakery." — entities: "The" at start single → skipped; no other capitals; no numbers → zero atoms → atomless → kept (answer has other grounded sentences) → included in answer. Good — that also exercises the "keep atomless" rule... hmm, do we want to keep atomless sentences? "The cellar lies behind the bakery." is true and in source; lexical gate can't verify (all lowercase). Keeping is a design choice that helps helpfulness. Risk: confident lie with all-lowercase sentences would pass gate if any other sentence grounded... but fully-lowercase confident lie: zero atoms → refuse (no grounded content) ✓. Mixed: grounded sentence + lowercase lie sentence → lie kept (unverifiable). Deterministic lexical gate's limitation; note in a comment (ASSUMPTION about lexical gate scope: catches names and quantities, which are the spoiler/false-fact classes we gate).
  
  Then hint: "The cellar lies behind a hidden place. Weaken the [redacted name] with a shard of glass. Several shards are required to seal the cellar door."
  - "behind the bakery" → "behind a hidden place" ✓ location redacted.
  
  expectedFacts for this scenario (answer mode): ["Gravel Wretch", "Four shards are required"?] — expectedFacts as strings checked with normalized substring: use ["the gravel wretch", "four shards are required", "behind the bakery"]. The LLM script must contain exactly these. ✓.

- plantedFalseFacts for lie scenarios: ["moonlight shard"].

Lie scenario (confident):
- Same question/sources. Script: "The cellar door opens with a Moonlight Shard. You need five shards and the Rusted Key to proceed."
  Wait — planted false facts: "moonlight shard" (invented item), "five shards" (quantity wrong), "rusted key" (invented).
  - S1: "The cellar door opens with a Moonlight Shard." Atoms: "Moonlight Shard" → not in sources → ungrounded → drop.
  - S2: "You need five shards and the Rusted Key to proceed." Atoms: quantity (5, shard) ∉ {4} → ungrounded; entity "Rusted Key" → not in sources → ungrounded. Drop.
  - No grounded content → refuse: "not covered by my sources."
  - Eval: expectRefusal? No — sources DO cover the answer; the refusal here is a *false refusal* → helpfulness: expectedFacts = [gravel wretch etc] → answer is refusal → 0.0. Faithfulness: refusal → 1.0. Final = 0.0 → low ✓. Test asserts finalScore < 0.25 or === 0.

  Hmm — is refusal the right behavior vs "drop ungrounded sentences"? Both allowed. With all dropped → refusal ✓.

- Missing answer scenario:
  - Question: "What does the Moonlight Shrine do?" Sources: (same cellar texts — no mention of shrine).
  - Script (LLM hallucinates): "The Moonlight Shrine restores health. It glows when a Rusted Key is near."
  - Atoms: "Moonlight Shrine" not in sources → drop; "Rusted Key" not in sources → drop → refuse ✓.
  - eval: expectRefusal: true, expectedFacts: []. Helpful = 1.0 (refused as expected), faithful = 1.0 → final 1.0 → pass. This tests "scenario where sources miss the answer leads to refusal." ✓
  
  Hmm wait — in that scenario, LLM is hallucinating (a bad LLM), and the gate catches it. The scenario name: "hallucination caught → refusal." If LLM had replied "NOT_COVERED", service also refuses. Either way, refusal. I'll use the hallucinating script to prove the *gate* catches it (stronger test). ✓

- Quantity exact test:
  - Direct: judge faithfulness on "Bring five shards to seal the door." with sources ["...Four shards are required..."] → 0.0. And "Bring four shards to seal the door." → atoms: quantity (4, shard) ∈ {4} ✓ → 1.0. "Caught exactly" ✓ (5 fails, 4 passes).
  - Pipeline: script "Four shards are required. Actually five shards will do." → S1 grounded keep; S2 ungrounded drop → answer "Four shards are required." — tests gate drops the wrong-quantity sentence while keeping the correct one. ✓ Nice test.

- Hint redaction test (hint.spec.ts):
  - Run service with mode 'hint', grounded script (3 sentences above). Assert:
    - text does NOT contain "Gravel Wretch", does NOT contain "bakery", does NOT contain "Four"/"four shards"/"5"? (5 not in answer to begin with) — assert no "four", no digit + shard? The "Several shards" — "shard" itself appears; spec says don't reveal quantity, item word OK.
    - Assert contains "several shards".
    - Player-mentioned quantity preserved: second case — question "I already have four shards. What now?" Hmm, then grounded answer is same; hint should keep "four shards"? Redaction rule: (four, shard) pair in question → keep. Script answer "Four shards are required to seal the door." → hint keeps "Four shards are required" ✓. Test that.
      Wait: question "I already have four shards" — quantity pair (4, shard) in question. Redaction of "Four shards are required" → keep → hint contains "Four shards" ✓ per spec ("beyond what the player already mentioned" is the violation; mentioned quantities are OK).
    - Assert llm client called exactly once in hint mode (no re-prompting): ScriptedLlmClient counts calls. "Hint mode derived from full grounded answer by redaction, not re-prompting" — test: in mode 'hint', `client.calls === 1` and result.fullAnswer equals mode-'answer' text for same script. ✓
  - Also assert hint still grounded? (Redaction only removes) — skip, judge faithfulness on hint ≥ 0.9? "several shards" — "several" not a digit → no quantity atom → faithful. Entities redacted → placeholder "[redacted name]" — capital R? "Redacted" is capitalized single word mid-sentence → entity atom "Redacted" → not in sources → if we run faithfulness judge on hint, that sentence would be ungrounded! Ha. My placeholder would fail faithfulness. Fix: placeholder lowercase? "the hidden name" — "hidden name" lowercase, no atom ✓. Let me use `NAME_PLACEHOLDER = 'a hidden name'`? "Weaken a hidden name with a shard of glass." Slightly awkward but fine. Or "the hidden boss"? "boss" is lowercase, fine — "Weaken the hidden boss" — but what if the entity was an item ("Moonlight Shard" in hint context)? Placeholder "a hidden name" works for both: "opens with a hidden name". I'll use `a hidden name` — but replacement of "Gravel Wretch" with "a hidden name" in "Weaken the Gravel Wretch" → "Weaken the a hidden name" — double article! Handle: replace "the Gravel Wretch" (with preceding article) → "the hidden name"? Rule: replace entity with "hidden name", and if immediately preceded by a/the/an → drop the article → "Weaken the hidden name." ✓; without article → "a hidden name". Implementation: regex `(?:\b(?:the|a|an)\s+)?Gravel Wretch` → replace with (articlePresent ? 'the hidden name' : 'a hidden name').
  - Location placeholder: "in a hidden place" already includes article ✓.

  So hint for the main scenario: "The cellar lies behind a hidden place. Weaken the hidden name with a shard of glass. Several shards are required to seal the cellar door."
  Faithfulness of this hint: atoms: "cellar" lowercase... no capitals, quantities: "Several" — spell-out? "several" not in spell-out list ✓ no atom → zero atoms → 1.0 ✓.
  Helpful for hint: expectedFacts (hint version) e.g., ["several shards", "hidden place"]? For scenario data, I'll define a separate hint scenario in golden-scenarios with expectedFacts ["several shards are required", "hidden place"]. But golden scenario shares the same service; mode per scenario ✓.

Now ScriptedLlmClient:
```ts
export interface LlmRequest { system: string; prompt: string }
export interface LlmCompletion { text: string }
export interface LlmClient { complete(req: LlmRequest): Promise<LlmCompletion> }
export class ScriptedLlmClient implements LlmClient {
  readonly calls: LlmRequest[] = [];
  constructor(private readonly reply: (req: LlmRequest) => string) {}
  async complete(req) { this.calls.push(req); return { text: this.reply(req) }; }
  static fromText(text: string) { return new ScriptedLlmClient(() => text); }
}
```

AnswerService:
```ts
export type AnswerMode = 'answer' | 'hint';
export interface AnswerInput { question: string; sources: string[]; mode: AnswerMode }
export interface AnswerResult { mode; text; refusal: boolean; dropped: string[]; fullAnswer?: string }
export class AnswerService {
  constructor(private readonly llm: LlmClient, private readonly gate: GroundingGate = new LexicalGroundingGate()) {}
  async answer(question, sources, mode): Promise<AnswerResult> {
    const raw = (await this.llm.complete(this.buildPrompt(question, sources))).text;
    if (this.llmSaidNotCovered(raw)) return refusal result;
    const { kept, dropped } = gate.filterSentences(raw, sources);
    if (noAtoms(kept)) refusal;
    const full = kept.join(' ');
    if (mode === 'answer') return {...};
    return { text: redactHint(full, question), fullAnswer: full, ... };
  }
}
```
Signature: task says `answer(question, sources, mode)` — I'll make method `answer(question: string, sources: string[], mode: AnswerMode)`. Service constructed with injected llm (injectable ✓).

Refusal text: exactly "not covered by my sources". I'll export const NOT_COVERED = 'not covered by my sources'. LLM sentinel: "NOT_COVERED" — check /not\s+covered/i in raw? If raw is just "NOT_COVERED" or contains "not covered by my sources"? Check `raw.trim() === 'NOT_COVERED'` or /i not covered/. Keep: trimmed equals 'NOT_COVERED' or /not covered/i.test(raw) → treat as LLM refusal → service refuses. Note: raw "I'm not covered"? edge, fine.

Gate implementation details:

```ts
export type FactualAtom =
  | { kind: 'entity'; value: string }
  | { kind: 'quantity'; number: number; unit: string };
  | { kind: 'number'; number: number };

export interface GateVerdict { grounded: boolean; atoms: FactualAtom[] }
export interface GroundingGate {
  assess(sentence: string, sources: string[]): GateVerdict;
}
```
LexicalGroundingGate.assess:
- atoms = extractAtoms(sentence)
- sourceBlob = normalized join of sources
- entity: supported if normalized sourceBlob contains value (value is already lowercased and stored normalized).
- quantity: sourceQuantities = extract from blob: Map<unit, Set<number>>; supported if set has number.
- number (bare): supported if any of sourceNumbers set has the number.
- grounded = atoms.every(supported). If atoms.length===0 → grounded = true? For sentence filtering: I want to keep atomless sentences (unverifiable). I'll define verdict.grounded = atoms.every(...) which for empty set is true (vacuous) — then filter keeps them. Refusal condition: kept sentences have zero atoms total → refuse. ✓

extractAtoms(text, { isFullText? }) — for source blob, I extract quantities from blob with same regexes. Entities from blob not needed (substring check suffices).

Let me define the regexes concretely:

```ts
const STOPWORDS = new Set(['the','a','an','this','that','these','those','you','your','i','we','it','he','she','they','is','are','was','were','be','been','and','or','to','of','in','on','at','with','by','for','from','as','not','no','do','does','did','can','cannot','will','would','should','shall','may','might','must','if','when','then','so','but','than','too','very','just','only','about','into','over','under','behind','before','after','against','between','out','up','down','off','once','here','there','where','what','which','who','whom','whose','how','all','any','some','each','few','more','most','other','such','no','nor','own','same','s','t','don','now']);
```
Hmm, note: 'only', 'just'... These appear capitalized at start ("Only the boss...") → first word of entity match will be stripped if in stopwords. But strip only leading stopword words in matched phrase, e.g., "The Gravel Wretch" → "Gravel Wretch". Also strip trailing? "Wretch the" rare. Skip trailing.

Spell-out numbers:
```ts
const WORD_NUMBERS: Record<string, number> = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, a:1, an:1 };
```
Include "a/an" → "a shard" would become quantity (1, shard)!! "a shard of glass" → quantity 1 shard; source "a shard of glass" contains "a shard" → source has (1, shard) → supported ✓. But "an shard" mismatch... edge. Hmm, is it desirable? "a shard" claim of quantity 1 — source also says "a shard" → OK supported. If source doesn't say "a shard", grounded answer "take a shard" would fail! Risky. Drop 'a'/'an' from WORD_NUMBERS. "two shards" etc stay. Also "dozen", "pair"? skip.

Quantity regex:
```ts
const QUANTITY_RE = /(?:\b\d{1,3}\b|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b|\bseven\b|\beight\b|\bnine\b|\bten\b)(?:\s+([a-z][a-z-]*))?/gi;
```
Hmm, need to avoid matching "one" in "the one and only"? "one" followed by "and" (lowercase) → quantity (1, 'and')?? unit 'and' → source quantities for unit 'and' is empty → ungrounded → false drop! Ugh. Constraint: unit must be a non-stopword noun-ish word. Filter: if captured unit is in QUANTITY_UNIT_STOPLIST (words like and, or, the, of, to, in, at, with, for, that, this, then, than, which, who, when, where, what, while, but, if, as, is, are, was, were, be, been, by, on, up, out, off, do, does, did, have, has, had, will, would, can, could, should, may, might, must, not, no, yes, all, any, some, each, few, more, most, other, such, own, same, now, here, there, then, they, them, their, there? ...), treat as bare number atom. Let me reuse STOPWORDS set for unit filter. "five shards" → unit 'shards' not in stopwords ✓ → quantity. "one of a kind" → 'of' is stopword → bare number 1 → supported if any '1' in sources... bare number check: sourceNumbers includes 1 only if a "1" or "one" appears in source... "one" spell-out in source — do we count spell-out numbers in sourceNumbers? Consistency: yes, count. If source has no 1 → "one of a kind" sentence ungrounded → false drop. Hmm. Mitigation: treat bare numbers as neutral (not ungrounded) — i.e., don't make a sentence ungrounded on bare numbers alone? But "wait 3 days" with source "wait 4 days" → 3 bare... "days" — wait, "3 days" has a unit ✓ caught. Bare number without unit is rare and low-info; make bare numbers not atoms (skip) — ASSUMPTION comment: bare numbers without units not gated (lexical limit), quantities with units are gated. Then remove the 'number' kind entirely. Simpler: atoms = entities + unit-quantities only.

But "Five" alone "Five of you will die"? unit filtered ('of') → skipped ✓ no false drop.

Also digit "4" in "the 4 shards" ✓. "5x5"? "5x5 grid" — regex `\d{1,3}\b` matches "5" then next char "x" is not space → no unit → bare → skipped ✓ no crash.

Ordinal "4th": `\d{1,3}\b` — after "4" is "t" → \b fails between 4 and t? \b is between \d and letter? Both are word chars → no boundary → \b fails → "4th" not matched at all ✓ good, skip ordinals naturally.

Entity regex:
```ts
const ENTITY_RE = /\b[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*/g;
```
For each match: split into words; drop leading stopwords; if remaining length 0 → skip; if remaining is single word AND match started at index 0 of sentence (sentence start) → skip (sentence-start artifact). Hmm — "Four shards are required": "Four" is at sentence start, single word after stopword strip ("Four" not stopword) → skipped ✓. But what if source has a real single-word name at sentence start: "Moonlight Shard lies..." → "Moonlight Shard" two words → kept ✓. Single-word name at sentence start ("Gravel Wretch" is two words; single-word names like "Doomguard" at sentence start: "Doomguard guards the gate." → skipped by rule → not gated → OK (lenient, not a false drop). Acceptable: gate errs on lenient at sentence start, strict elsewhere. Document in comment.

Wait, another subtlety: entity "Moonlight Shard" — when checking support, I lowercase to "moonlight shard" substring in normalized source ✓. What about "Shards" capitalized in source? Normalized to lowercase handles it ✓.

Multi-sentence: extract atoms per sentence (sentence = raw.split with lookbehind). Note that entity regex could span sentence boundary if joined — I extract per sentence, safe.

Redaction function (in hint module or same file — separate `src/answer/hint-redactor.ts`? or `redact.ts`... convention kebab: `hint-redactor.ts`).

```ts
const NAME_PLACEHOLDER = 'hidden name';
export function redactHint(answer: string, question: string): string {
  return redactQuantities(redactLocations(redactNames(answer)), question);
}
```
Order: names first, then locations, then quantities (quantities last so that redacted text "a hidden place" doesn't contain numbers — it doesn't; "several" isn't a digit).

redactNames: reuse ENTITY_RE with same stopword stripping and sentence-start rule (per sentence, then join). Replacement:
```
text.replace(ENTITY_RE, (match, offset) => { ... compute cleaned; if none → return match; check preceding char for article: /(?:^|\s)(the|a|an)\s$/i against text.slice(0, offset) → but the article was consumed? The article is not part of the match (stopword stripped from match). So the preceding text ends with "the " (in case "Weaken the Gravel Wretch"). If preceding ends with article → replace with 'the hidden name', else 'a hidden name'.
```
But note: if match includes leading stopword words ("The Gravel Wretch" matched whole; cleaned = "Gravel Wretch"; preceding text = "Weaken " with no article; replacement "a hidden name" → "Weaken a hidden name" ✓ (the original "The" is consumed in the match ✓ good).
Case: "Weaken the Gravel Wretch": ENTITY_RE at "the"? match starts at lowercase 't'? no — regex requires [A-Z] start → match starts at "Gravel Wretch"; preceding ends with "the " → detect article → "the hidden name" ✓.

Also, placeholder word "hidden name" lowercase → no new entity ✓. But wait — subsequent location regex on "[redacted...]"? We use 'the hidden name' — no location preps. Then quantity: fine.

Edge: names inside location phrase: "behind the Bakery" — name "Bakery" (capitalized) → redacted to "behind the hidden name" first, then location regex: "behind the hidden" → "hidden" is not in stoplist → "behind a hidden place"?? "hidden" as location object noun → replace whole "behind the hidden" → "behind a hidden place", leaving " name"? My location regex replaces the match `behind\s+(?:the\s+)?([a-z]+)` → "behind the hidden" matched, replaced by "behind a hidden place", leaving " name" → "behind a hidden place name". Ugh. Mitigation: run location redaction BEFORE name redaction: "behind the Bakery" → "behind a hidden place" (object "Bakery"? my location regex only captures lowercase [a-z-]+ — "Bakery" is uppercase → no match). Hmm.
Let me make location regex capture any-case first word: `((?:the|a|an)\s+)?([A-Za-z][a-z-]*)` and stoplist check lowercased. "behind the Bakery" → object "Bakery" not in stoplist → replace with "behind a hidden place" ✓ (consumes "the Bakery" entirely) → then name redaction finds no "Bakery" ✓. But order: location first, then name. Check grounded answer "The cellar lies behind the bakery." lowercase "bakery" → location: "behind the bakery" → "behind a hidden place" ✓.
But wait — location regex `in\s+the\s+([A-Za-z][a-z-]*)` might capture a verb-like word? "in the gate", fine. "in the way" → 'way' stoplisted ✓. "in the glass"? 'glass' not in stoplist → "in a hidden place" — well, acceptable (conservative spoiler redaction).
Also "at the cost of X": 'cost' → "at a hidden place of X"?? "at the cost" → object 'cost' → not in stoplist → "at a hidden place" + " of shards" → "at a hidden place of shards". Bad grammar but rare in game guide. Add 'cost' to stoplist. And 'end','time','place','position','game','air','ground','day','night','night'?? "at night" — 'night' is a time, not a location secret → stoplist. "in the morning"? 'morning' stoplist. Add: end, time, way, game, air, ground, cost, day, night, morning, evening, minute, hour, second, place, position, end, end. OK.

redactQuantities: per sentence? Whole text with QUANTITY_RE + unit stopword filter; for each match: number (digit or spell-out), unit (lowercased, depluralized for comparison but keep original surface in question check? compare normalized: unit.replace(/s$/,'')). Question side: extract same atoms from question → set of `${n}:${unit}`. If match's key in set → keep (return original match text with original case? return match as-is ✓). Else replace: with unit → `several ${unit}` (surface unit from text, lowercased? keep original surface: match's unit substring as-is, lowercased? "Four Shards"? rare; use match's unit substring as-is). Without unit (bare) → can't happen since atoms only with units... But redaction should also catch "4" standalone? "You need 4." → digit no unit → per decision not gated; redaction: spec says quantities → bare "4" is a quantity! Redaction should redact bare numbers too (spec's "quantities" is broader). Let me redact standalone digits: replace with "a few"? "You need 4." → "You need a few." Hmm "a few." is awkward but OK. Standalone spell-outs without unit — dangerous ("one of a kind" → "several of a kind"??). Only redact spell-outs when followed by a non-stopword noun (i.e., they're quantities); leave bare spell-outs. Bare digits → "a few"? "3 days" handled by unit rule anyway; standalone "3" → "a few". Hmm "3" → "a few" implies 2–3... "several" implies 3+. Whatever — use "a few". Edge: "3" in "3pm"? Skip perfection.
  Wait, also the depluralization: "shards" surface preserved in "several shards" ✓ (just replace the number word).
  Question check: player said "I have two shards" → set {2:shard}. Hint "several shards..." — the number was already replaced with "several" (since "four" not in question). But if answer says "You have two shards and need two more" → (2, shard) in question → keep ✓.

Verify main hint scenario once more:
Full: "The cellar lies behind the bakery. Weaken the Gravel Wretch with a shard of glass. Four shards are required to seal the cellar door."
1. Location: S1 "behind the bakery" → "behind a hidden place". S2/S3 no location preps... S3 "seal the cellar door" — "seal the" isn't a prep in list ✓. "with a shard of glass" — 'with' not in prep list ✓ good (items not redacted).
2. Name: S2 "Gravel Wretch" → preceding "the " → "the hidden name". S1 "The" at start → single at start skipped ✓.
3. Quantities (question "How do I get past the cellar door?": no numbers): S3 "Four shards" → 'four' spell-out, unit 'shards' not stopword → key 4:shard not in question → "several shards".
Final: "The cellar lies behind a hidden place. Weaken the hidden name with a shard of glass. Several shards are required to seal the cellar door."
- Contains "Gravel Wretch"? No ✓. "bakery"? No ✓. Digits? None ✓. "Four"? None ✓.

Hint helpfulness expectedFacts: ["several shards are required", "hidden place", "hidden name"]? Judge normalized substring: "several shards are required to seal the cellar door" contains "several shards are required" ✓; "hidden place" ✓; "hidden name" ✓.

Scenario: player-mentioned quantity:
Question: "I have four shards already. What now?" Sources same. Script: "Four shards are required to seal the cellar door. Place them on the altar." — "altar" lowercase; no atoms?? "Four shards" quantity ✓ grounded. S2 zero atoms kept. Full answer OK. Hint: (4:shard) in question → "Four shards are required..." kept ✓. Assert hint contains "Four shards".
Wait "Place them on the altar" — location? 'on the altar' → 'altar' not in stoplist → "on a hidden place". Fine.

Faithfulness judge with plantedFalseFacts: judge(answer, sources, { plantedFalseFacts }) → if any normalized planted substring in normalized answer → 0. In lie scenario the final answer is refusal → refusal short-circuits at 1.0 before planted check — that's fine (planted check is for when lie text survives). In direct unit test: judge("The door opens with a Moonlight Shard.", [sources], { plantedFalseFacts: ['Moonlight Shard'] }) → 0.0, and also 0.0 even without list (entity ungrounded). I'll assert both paths.

Helpfulness judge: normalized contains. Refusal detection: text.trim().toLowerCase() === NOT_COVERED or startsWith? I'll export `isRefusal(text): boolean` = trim().toLowerCase() === NOT_COVERED. Harness uses exact match with service constant.

Harness:
```ts
export interface GoldenScenario {
  id: string;
  description?: string;
  question: string;
  sources: string[];
  mode?: AnswerMode;           // default 'answer'
  llmReply: string;            // scripted fake LLM output
  expectedFacts: string[];
  plantedFalseFacts?: string[];
  expectRefusal?: boolean;
}
export interface ScenarioReport { id; mode; text; refusal; helpfulness; faithfulness; finalScore; pass }
export interface EvalReport { reports: ScenarioReport[]; passed: boolean; average: number }
export function runEval(scenarios, service?: AnswerService): Promise<EvalReport>
```
Hmm — the service needs the llm client per scenario (each scenario scripts different reply). So harness takes `makeLlm: (s: GoldenScenario) => LlmClient` and `gate?`? Simplest: harness takes `makeLlm` (defaults to `(s) => ScriptedLlmClient.fromText(s.llmReply)`) and constructs its own AnswerService per scenario: `new AnswerService(makeLlm(s))`. Judges: construct `FaithfulnessJudge`, `HelpfulnessJudge` (default instances, overridable via options for testability). finalScore = Math.min(h, f); pass = finalScore >= threshold (default 0.75, option).

average = mean of finalScores. passed = all pass.

Now golden scenarios file — 4 scenarios:
1. `grounded-answer-high` — main, mode 'answer', expectedFacts: ['gravel wretch', 'behind the bakery', 'four shards are required'] (normalized lowercase — judge normalizes). plantedFalseFacts: ['moonlight shard', 'rusted key', 'five shards'] (not in correct reply; planted list documents the temptation). llmReply = the 3-sentence grounded text.
   Verify expectedFacts against reply: "The cellar lies behind the bakery." ✓ contains "behind the bakery"; "Weaken the Gravel Wretch..." ✓ "gravel wretch"; S3 ✓ "four shards are required".
2. `confident-lie-low` — same question/sources, llmReply = "The cellar door opens with a Moonlight Shard. You need five shards and the Rusted Key to proceed." plantedFalseFacts: ['moonlight shard','five shards','rusted key'], expectedFacts: ['gravel wretch','four shards'], expectRefusal: false. Result: refusal → helpfulness 0 → final 0.
   Hmm wait — helpfulness when expectRefusal false and answer is refusal → 0.0 ✓. Faithfulness 1.0. Final 0.0 < threshold ✓ "scores low".
3. `uncovered-refsus` (typo careful) `uncovered-refusal` — question "What does the Moonlight Shrine do?" sources = cellar texts (no shrine), llmReply = "The Moonlight Shrine restores health. A Rusted Key glows beside it." expectRefusal: true, expectedFacts: [], plantedFalseFacts: ['moonlight shrine','rusted key']. Gate: S1 entity "Moonlight Shrine" ungrounded → drop; S2 "Rusted Key" ungrounded → drop → refusal ✓ helpfulness 1 (expected refusal), faithfulness 1 → final 1 → pass. This proves the refusal scenario.
4. `hint-redacted` — main question, mode 'hint', llmReply = grounded 3 sentences, expectedFacts: ['several shards are required','hidden place','hidden name'], plantedFalseFacts: ['gravel wretch','bakery']. Faithfulness of hint text: atoms: none?? "The cellar lies behind a hidden place." — no capitals mid... "The" at start skipped; no quantities ("several" isn't a word-number) → zero atoms → 1.0 ✓. Helpful: 3/3 → 1.0. Final 1 → pass. Planted check: hint contains 'gravel wretch'? No ✓ (would force 0).

Also scenario 5? `quantity-mismatch-dropped` — mode answer, question is main, llmReply = "Four shards are required. Bring five shards and the Rusted Key." S1 grounded (4 ✓). S2: (5, shard) not in {4} → drop. Result "Four shards are required." Helpful: expectedFacts ['four shards are required'] → 1.0; faithfulness: no atoms in result? "Four shards are required." — "Four" at start single word → skipped as entity; quantity: "four shards" → (4, shard) ∈ {4} ✓ → 1 atom supported → 1.0. Final 1.0. Assert: result text doesn't contain 'five', does contain 'Four'. This is the "quantity errors caught exactly" pipeline test. Also the direct judge test for 5→0 / 4→1.

Wait — verify S2 "Bring five shards and the Rusted Key." atoms: quantity (5, shard): sources' unit 'shard' numbers = {4} from "Four shards are required" and "a shard of glass" (no number). 5 ∉ → ungrounded ✓ drop. Also "Rusted Key" ungrounded. ✓.

Also verify grounded scenario S1 "The cellar lies behind the bakery." atoms zero → kept as "unverifiable" — is that OK for faithfulness? Judge: zero atoms → 1.0 ✓ consistent.

Now — sources for scenarios:
```ts
const CELLAR_PAGES = [
  'The Gravel Wretch is the guardian of the cellar. It can only be weakened by a shard of glass. Four shards are required to seal the cellar door.',
  'The cellar lies behind the bakery. The door has no keyhole. Shards of glass can be found in broken windows.',
];
```
Extract source quantities: "Four shards" → (4, shard) ✓. "Four" at sentence start in source — quantity regex is independent of entity rule ✓. Note "no keyhole" — 'no' fine.
Source "Shards of glass can be found in broken windows." — location "in broken windows" → not redacted because not in answer. OK.

Now, gate for S3 of grounded: "Four shards are required to seal the cellar door." atoms: quantity (4, shard) ✓ grounded; entity: "Four" single at start → skip. → grounded ✓.

S2: "Weaken the Gravel Wretch with a shard of glass." atoms: entity "Gravel Wretch" → "gravel wretch" in source ✓. Also entity "Weaken" at start single → skipped ✓. (a shard — no 'a' in word numbers ✓ no quantity). → grounded ✓.

Now write the judges file:

```ts
import { GroundingGate, LexicalGroundingGate, extractAtoms, type FactualAtom } from '../answer/grounding-gate.js';
import { NOT_COVERED, isRefusal } from '../answer/answer-service.js'?
```
Watch for circular imports: answer.service imports grounding-gate; judges import grounding-gate + refusal constants. Put NOT_COVERED + isRefusal in `src/answer/refusal.ts`? or in grounding-gate? I'll make a small module `src/answer/refusal.ts`:
```ts
export const NOT_COVERED_MESSAGE = 'not covered by my sources';
export const LLM_SENTINEL = 'NOT_COVERED';
export function isRefusal(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === NOT_COVERED_MESSAGE || t === LLM_SENTINEL.toLowerCase();
}
```
Judges:

```ts
export interface Judge { score(...): number }  // maybe just two classes
export class FaithfulnessJudge {
  constructor(private readonly gate: GroundingGate = new LexicalGroundingGate()) {}
  judge(answer: string, sources: string[], opts: { plantedFalseFacts?: string[] } = {}): number {
    if (isRefusal(answer)) return 1;
    const nAnswer = normalize(answer);
    for (const p of opts.plantedFalseFacts ?? []) if (nAnswer.includes(normalize(p))) return 0;
    const atoms = extractAtoms(answer);
    if (atoms.length === 0) return 1;
    const blob = normalize(sources.join('\n'));
    const sourceQuantities = collectSourceQuantities(sources);
    const sourceNumbers = ... (all numbers)
    let ok = 0;
    for (const a of atoms) {
      const supported = a.kind === 'entity' ? blob.includes(a.value) : sourceQuantities.has(a.unit) && sourceQuantities.get(a.unit)!.has(a.number);
      if (supported) ok++;
    }
    return ok / atoms.length;
  }
}
```
extractAtoms on multi-sentence answer: run per sentence (to respect sentence-start rule). My extractAtoms should split internally. Let me design `extractAtoms(text: string): FactualAtom[]` that internally splits into sentences and extracts per sentence. Gate.assess(sentence...) hmm — gate needs per-sentence verdicts for filtering; I'll expose `splitSentences(text)` and `extractSentenceAtoms(sentence)`. Gate:
```ts
assess(sentence, sources) { const atoms = extractSentenceAtoms(sentence); return { grounded: atoms.every(supported), atoms }; }
filter(raw, sources) { const sents = splitSentences(raw); ... kept/dropped }
```
`filter` on gate — or does service do it? Service shouldn't have logic duplication; let's give gate `filter(raw, sources): { kept: string[], dropped: string[] }`.

HelpfulnessJudge:
```ts
judge(answer: string, spec: { expectedFacts: string[]; expectRefusal?: boolean }): number {
  if (spec.expectRefusal) return isRefusal(answer) ? 1 : 0;
  if (isRefusal(answer)) return 0;
  const total = spec.expectedFacts.length;
  if (total === 0) return 0;
  const n = normalize(answer);
  const hit = spec.expectedFacts.filter(f => n.includes(normalize(f))).length;
  return hit / total;
}
```

Harness:
```ts
export interface GoldenScenario { id: string; description?: string; question: string; sources: string[]; mode?: AnswerMode; llmReply: string; expectedFacts: string[]; plantedFalseFacts?: string[]; expectRefusal?: boolean; }
export interface ScenarioReport { id: string; mode: AnswerMode; text: string; refusal: boolean; helpfulness: number; faithfulness: number; finalScore: number; pass: boolean; }
export interface EvalReport { reports: ScenarioReport[]; average: number; passed: boolean; }
export interface EvalOptions { threshold?: number; makeLlm?: (s: GoldenScenario) => LlmClient; faithfulnessJudge?: FaithfulnessJudge; helpfulnessJudge?: HelpfulnessJudge; }
export async function runEval(scenarios: GoldenScenario[], options: EvalOptions = {}): Promise<EvalReport> {
  const threshold = options.threshold ?? 0.75;
  const makeLlm = options.makeLlm ?? ((s) => ScriptedLlmClient.fromText(s.llmReply));
  const fJ = options.faithfulnessJudge ?? new FaithfulnessJudge();
  const hJ = options.helpfulnessJudge ?? new HelpfulnessJudge();
  const reports = [];
  for (const s of scenarios) {
    const service = new AnswerService(makeLlm(s));
    const mode = s.mode ?? 'answer';
    const result = await service.answer(s.question, s.sources, mode);
    const helpfulness = hJ.judge(result.text, { expectedFacts: s.expectedFacts, expectRefusal: s.expectRefusal });
    const faithfulness = fJ.judge(result.text, s.sources, { plantedFalseFacts: s.plantedFalseFacts });
    const finalScore = Math.min(helpfulness, faithfulness);
    reports.push({ id: s.id, mode, text: result.text, refusal: result.refusal, helpfulness, faithfulness, finalScore, pass: finalScore >= threshold });
  }
  const average = reports.length ? reports.reduce((a, r) => a + r.finalScore, 0) / reports.length : 0;
  return { reports, average, passed: reports.every(r => r.pass) };
}
```

Now let me write tests.

`test/answer.service.spec.ts`:
1. "returns a grounded answer and drops nothing when every sentence is grounded" — service with grounded script; assert text === joined sentences, refusal false.
2. "refuses with 'not covered by my sources' when no sentence is grounded (confident lie)" — lie script; assert text === NOT_COVERED_MESSAGE, refusal true.
3. "refuses when the LLM answers the sentinel" — script "NOT_COVERED" → refusal.
4. "drops only the ungrounded sentence when quantities disagree (5 vs 4 shards)" — script "Four shards are required. Bring five shards to the door." → result "Four shards are required.", dropped contains the 5 one. Exactness: also variant with script where only sentence is "Bring five shards." → refusal. And "Bring four shards." → kept.
5. "keeps an answer when the player-visible name is in sources, refuses invented names" — "The Rusted Key opens the gate." → refusal.

`test/hint.spec.ts`:
1. "redacts boss names, locations, and quantities from the grounded answer" — main scenario; assert !contains 'Gravel Wretch', !contains 'bakery', !contains 'four' (case-insensitive), contains 'several shards', contains 'hidden place', contains 'hidden name'.
2. "keeps quantities the player already mentioned" — question "I have four shards already. What now?" → hint contains 'Four shards'.
3. "is derived by redaction, not re-prompting" — ScriptedLlmClient instance; run with mode 'hint'; assert client.calls.length === 1 and result.fullAnswer equals what mode 'answer' would produce (run a second service? same client? I'll run two services with two clients each scripted the same; assert hint.fullAnswer === answerResult.text, and the single client.calls.length===1 for the hint run). Also hint.text !== fullAnswer (redaction happened).
4. "refusal passes through in hint mode without redaction" — lie script + mode hint → text === NOT_COVERED, refusal true. (Reasonable behavior.)

`test/eval-harness.spec.ts`:
1. "confident-lie scenario scores low" — run scenario 2 alone (or all): report.finalScore === 0 (helpfulness 0). Assert < 0.25.
2. "grounded scenario scores high" — report.finalScore === 1 and pass true.
3. "uncovered scenario yields a passing refusal" — report.refusal true, helpfulness 1, faithfulness 1, final 1.
4. "quantity errors are caught exactly: 5 shards → 0, 4 shards → 1" — direct FaithfulnessJudge tests.
5. "final score is the min of the two judges" — craft a scenario where helpfulness < faithfulness? e.g., expectedFacts has 2 items but reply contains only one → helpfulness 0.5, faithfulness 1 → final 0.5, pass false. Custom scenario inline.
6. "runEval over GOLDEN_SCENARIOS passes overall" — all 5 scenarios, passed true, and individual IDs have expected finals.

`test/grounding-gate.spec.ts`? Covered in service tests; maybe small direct gate tests: extractSentenceAtoms("Five shards and the Rusted Key.") etc. I'll fold a few gate asserts into answer spec to keep file count moderate. Task calls for tests proving 4 behaviors — covered. Let me include some gate-level asserts for "caught exactly" in eval spec with the judge.

Also `package.json`:
```json
{
  "name": "grounded-llm-product",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run" },
  "devDependencies": { "typescript": "^5.5.0", "vitest": "^2.0.0", "@types/node": "^20.0.0" }
}
```
tsconfig.json:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": ".",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```
NodeNext + ESM: imports need `.js` extension. Vitest handles TS with extensions: I'll use `import { x } from '../src/answer/answer-service.js'` in tests ✓, and relative `.js` inside src ✓.

Now let me write all the code carefully, checking regexes and logic.

**grounding-gate.ts** (src/answer/grounding-gate.ts):

```ts
/**
 * Sentence-level grounding gate.
 *
 * A sentence is *grounded* when every factual atom in it is supported by the
 * source texts. Factual atoms are the parts of a sentence that carry checkable
 * claims:
 *   - proper-noun entities ("Gravel Wretch", "Moonlight Shard")
 *   - quantities with units ("four shards", "5 keys")
 *
 * // ASSUMPTION: the gate is intentionally lexical and deterministic (no
 * // second LLM call). It catches the two failure classes the product cares
 * // about — invented names and wrong counts — but cannot verify freely
 * // paraphrased plain-prose claims; such sentences are kept if the rest of
 * // the answer is grounded and dropped only when nothing in the whole answer
 * // is verifiable (which triggers refusal).
 */

export type FactualAtom =
  | { kind: 'entity'; value: string }
  | { kind: 'quantity'; number: number; unit: string };

const STOPWORDS = new Set([...]);
const WORD_NUMBERS: Record<string, number> = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };

export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

const ENTITY_RE = /\b[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*/g;

function singularize(unit: string): string {
  return unit.endsWith('s') ? unit.slice(0, -1) : unit;
}

export function extractSentenceAtoms(sentence: string): FactualAtom[] {
  const atoms: FactualAtom[] = [];
  // entities
  for (const match of sentence.match(ENTITY_RE) ?? []) {
    const words = match.split(' ').filter(w => !STOPWORDS.has(w.toLowerCase()));
    if (words.length === 0) continue;
    const atSentenceStart = sentence.startsWith(match);
    if (words.length === 1 && atSentenceStart) continue; // probably just capitalized first word
    const value = normalize(words.join(' '));
    if (!atoms.some(a => a.kind === 'entity' && a.value === value)) atoms.push({ kind: 'entity', value });
  }
  // quantities
  const QUANTITY_RE = /(?:\b(?:\d{1,3})\b|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b|\bseven\b|\beight\b|\bnine\b|\bten\b)(?:\s+([a-z][a-z-]*))?/gi;
  for (const match of sentence.match(QUANTITY_RE) ?? []) {
    ...
  }
  return atoms;
}
```

Hmm wait, QUANTITY_RE with optional group: "four shards" match = "four shards", group1 = "shards" ✓. "5" alone in "need 5." → match "5", group1 undefined → bare → skip (by design). But danger: "one" inside "the one and only" → match "one and"?? group1 'and' (lowercase, matches [a-z]+) → unit 'and' → stopword check: 'and' in STOPWORDS → treat as bare → skip ✓. I'll implement unit filter: unit && !STOPWORDS.has(unit) → quantity atom, else skip.

Also spell-out matching should be case-insensitive: "Four shards" at sentence start ✓ /i. But "FOUR"? fine.

Number extraction: if match starts with digit → parseInt(match.slice up to first space). If spell-out → WORD_NUMBERS[match first word lower].

Deduplicate atoms.

```ts
export function extractAtoms(text: string): FactualAtom[] {
  const all: FactualAtom[] = [];
  for (const s of splitSentences(text)) {
    for (const a of extractSentenceAtoms(s)) if (!all.some(same(a))) all.push(a);
  }
  return all;
}
```

Source-side:
```ts
export function sourceQuantities(sources: string[]): Map<string, Set<number>> {
  const map = new Map();
  for (const s of sources) for (const a of extractAtoms(s)) if (a.kind === 'quantity') { set }
  return map;
}
```
Wait, extractAtoms(s) on source sentence: "Four shards are required to seal the cellar door." → quantity (4, 'shard') ✓ (unit 'shards' singularized). "a shard of glass" no. "Shards of glass can be found" — "Shards" capitalized at start → single word at start → skipped as entity ✓ (not a name, OK).

Hmm — subtle: entity value comparison: answer "the Gravel Wretch" → entity "gravel wretch"; source blob contains "the gravel wretch is the guardian" ✓ substring.

Also singular/plural for entities: answer "Gravel Wretches"?? normalize "gravel wretches" not substring of "gravel wretch" (order reversed). Add a fallback: check if singularized form is substring, or if value+'s' is substring? Keep both: supported if blob.includes(value) || blob.includes(value + 's') || (if ends 's') blob.includes(value.slice(0,-1)). Good enough.

Gate class:

```ts
export interface SentenceVerdict { sentence: string; grounded: boolean; atoms: FactualAtom[]; }
export interface GroundingGate {
  assess(sentence: string, sources: string[]): SentenceVerdict;
  filter(rawAnswer: string, sources: string[]): { kept: string[]; dropped: string[] };
}

export class LexicalGroundingGate implements GroundingGate {
  assess(sentence, sources) {
    const atoms = extractSentenceAtoms(sentence);
    const blob = normalize(sources.join(' '));
    const quantities = sourceQuantities(sources);
    const supported = atoms.every(a => a.kind === 'entity'
        ? entitySupported(a.value, blob)
        : (quantities.get(a.unit) ?? new Set()).has(a.number));
    return { sentence, grounded: supported, atoms };
  }
  filter(raw, sources) {
    const kept: string[] = []; const dropped: string[] = [];
    let groundedAtomCount = 0;
    for (const s of splitSentences(raw)) {
      const v = this.assess(s, sources);
      if (v.grounded) { kept.push(s); groundedAtomCount += v.atoms.length; }
      else dropped.push(s);
    }
    if (groundedAtomCount === 0) return { kept: [], dropped: kept.concat(dropped) }; // nothing verifiable
    return { kept, dropped };
  }
}
```
Hmm — "nothing verifiable" case: all atoms zero (pure prose) → refused. But wait: if all sentences have atoms but none supported → groundedAtomCount 0 → refuse ✓ (confident lie). Mixed: S1 grounded with atoms, S2 atomless → kept ✓ groundedAtomCount>0.

Edge: atomless answer → kept becomes [] and dropped = all → service refuses ✓.

Wait, bug: if groundedAtomCount === 0 but some sentence was "grounded" (vacuously, atomless) — I push to kept then reset. Return dropped as everything, kept empty. Service: `if (result.kept.length === 0 || hasNoAtoms(kept))` — actually since filter already returns kept=[] in that case, service only checks kept.length===0 → refuse. But careful: kept nonempty but all atomless can't happen (filter zeroes it). ✓ Simpler.

But hmm: should a purely atomless LLM answer ("I suggest caution.") be refused as "not covered"? It's unanswerable from sources — yes, refusal is right.

**llm-client.ts**:

```ts
export interface LlmRequest { system: string; prompt: string; }
export interface LlmCompletion { text: string; }
export interface LlmClient { complete(request: LlmRequest): Promise<LlmCompletion>; }

export class ScriptedLlmClient implements LlmClient {
  readonly calls: LlmRequest[] = [];
  constructor(private readonly reply: (request: LlmRequest) => string) {}
  static fromText(text: string): ScriptedLlmClient { return new ScriptedLlmClient(() => text); }
  async complete(request: LlmRequest): Promise<LlmCompletion> {
    this.calls.push(request);
    return { text: this.reply(request) };
  }
}
```

**refusal.ts** as above.

**answer-service.ts**:

```ts
import { LlmClient } from './llm-client.js';
import { GroundingGate, LexicalGroundingGate, splitSentences } from './grounding-gate.js';
import { LLM_SENTINEL, NOT_COVERED_MESSAGE } from './refusal.js';
import { redactHint } from './hint-redactor.js';

export type AnswerMode = 'answer' | 'hint';
export interface AnswerResult {
  mode: AnswerMode;
  text: string;
  refusal: boolean;
  droppedSentences: string[];
  /** Present in hint mode: the grounded answer the hint was redacted from. */
  fullAnswer?: string;
}

export class AnswerService {
  constructor(
    private readonly llm: LlmClient,
    private readonly gate: GroundingGate = new LexicalGroundingGate(),
  ) {}

  async answer(question: string, sources: string[], mode: AnswerMode = 'answer'): Promise<AnswerResult> {
    const raw = (await this.llm.complete(this.buildPrompt(question, sources))).text;
    if (this.isSentinel(raw)) {
      return this.refusalResult(mode);
    }
    const { kept, dropped } = this.gate.filter(raw, sources);
    if (kept.length === 0) return this.refusalResult(mode);
    const full = kept.join(' ');
    if (mode === 'hint') {
      const text = redactHint(full, question);
      return { mode, text, refusal: false, droppedSentences: dropped, fullAnswer: full };
    }
    return { mode, text: full, refusal: false, droppedSentences: dropped };
  }

  private refusalResult(mode: AnswerMode): AnswerResult {
    return { mode, text: NOT_COVERED_MESSAGE, refusal: true, droppedSentences: [] };
  }

  private isSentinel(raw: string): boolean {
    return raw.trim() === LLM_SENTINEL || /not\s+covered/i.test(raw);
  }

  private buildPrompt(question: string, sources: string[]): LlmRequest {
    const pages = sources.map((s, i) => `--- page ${i + 1} ---\n${s}`).join('\n\n');
    return {
      system:
        'You are a game guide. Answer strictly from the wiki pages provided. ' +
        'If the pages do not contain the answer, reply exactly with: ' + LLM_SENTINEL,
      prompt: `Player question: ${question}\n\nWiki pages:\n${pages}`,
    };
  }
}
```

Wait — hint mode: redact the grounded answer — but should hint also be refusal if full is empty? Covered (kept.length===0 → refusal before mode branch) ✓.

One concern: `isSentinel` regex /not\s+covered/i would fire on raw answers like "It's not covered in the pages, but..." — acceptable.

**hint-redactor.ts**:

```ts
import { ENTITY_RE?? } 
```
I need access to entity matching with position info → redactNames uses replace with callback. Let me export a helper from grounding-gate: `forEntities(text: string, cb: (match: string, offset: number, sentenceStart: boolean) => string): string`? Simpler: redactor implements its own regex (duplicating a small regex) — but the stopword-strip logic is shared. I'll export from grounding-gate:

```ts
export interface EntityMatch { raw: string; value: string; atSentenceStart: boolean; }
export function findEntities(sentence: string): EntityMatch[] {
  const out: EntityMatch[] = [];
  for (const m of sentence.match(ENTITY_RE) ?? []) {
    const words = m.split(' ').filter(w => !STOPWORDS.has(w.toLowerCase()));
    if (words.length === 0) continue;
    const atSentenceStart = sentence.startsWith(m);
    if (words.length === 1 && atSentenceStart) continue;
    out.push({ raw: m, value: normalize(words.join(' ')), atSentenceStart });
  }
  return out;
}
```
And extractSentenceAtoms uses findEntities. Redactor:

```ts
import { findEntities, splitSentences, normalize, STOPWORDS? } from './grounding-gate.js';

export const NAME_PLACEHOLDER = 'hidden name';
const LOCATION_PREPS = 'in|at|on|under|behind|inside|beyond|beside|near';
const LOCATION_RE = new RegExp(`\\b(?:${LOCATION_PREPS})\\s+(?:(?:the|a|an)\\s+)?([A-Za-z][a-z-]*)`, 'gi');
const HARMLESS_LOCATION_WORDS = new Set(['end','time','way','game','air','ground','cost','day','night','morning','evening','minute','hour','second','place','position','door'?]);
```
Hmm 'door' — "at the door" generic → harmless? But "cellar door" location-ish... "at the door" harmless ✓ add 'door'.

Order per sentence: location first, then names? Earlier I reasoned location first to consume "the Bakery". But names first consumes "Bakery" leaving "behind the " + then location regex would capture "hidden"? no — after name replacement "behind the hidden name", location regex `behind\s+(?:the\s+)?([A-Za-z][a-z-]*)` would capture "hidden" → "behind a hidden place name". So location FIRST: "behind the Bakery" → LOCATION_RE matches "behind the Bakery"? pattern: `behind\s+(?:(?:the|a|an)\s+)?([A-Za-z][a-z-]*)` → "behind the Bakery": "the" consumed by optional group, capture "Bakery" ✓ → replace whole match with "behind a hidden place" → then names find none ✓.
But name inside location without preposition: "Bakery district" → name redaction → "a hidden name district" ✓ fine.
Quantities last ✓.

Also: location regex might match "on a shard of glass"? 'on' + article + 'a'?? "with a shard" — 'with' not in preps ✓. "on the shard"? rare.

redactNames:
```ts
function redactNamesInSentence(sentence: string): string {
  const entities = findEntities(sentence);
  // Replace from last to first to keep offsets valid
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    const idx = sentence.indexOf(e.raw);  // hmm raw could repeat
```
Offset problem: `match()` loses offsets. Use `matchAll` in findEntities? Let me change findEntities to use `sentence.matchAll(ENTITY_RE)` and record `m.index`. Store `index` in EntityMatch. Then replacement:
```ts
const before = sentence.slice(0, e.index);
const precededByArticle = /(?:^|\s)(?:the|a|an)\s$/i.test(before);
const replacement = precededByArticle ? `the ${NAME_PLACEHOLDER}` : `a ${NAME_PLACEHOLDER}`;
sentence = sentence.slice(0, e.index) + replacement + sentence.slice(e.index + e.raw.length);
```
Wait — but if raw starts with a stopword ("The Gravel Wretch"), the article is inside raw; preceding article check: before ends with "Weaken " → no article → replacement "a hidden name" → "Weaken a hidden name" ✓ (original "The" is consumed since raw includes it ✓ good).
If raw = "Gravel Wretch" (no leading stopword, preceded by "the ") → "the hidden name" ✓.
Process from last to first keeps earlier offsets valid ✓ (index stored from original sentence; replacing from end keeps earlier indices valid ✓).
Also multiple entities with same raw (e.g., "Wretch ... Wretch") — matchAll gives each index ✓.

Edge: entity value check... Also entities equal to "REDACTED"? no.

Also: should redactNames skip the placeholder itself? The placeholder is inserted during iteration from end; earlier entities are unaffected. ✓

redactQuantities:
```ts
const QUANTITY_RE = /(\b\d{1,3}\b|\bone\b|\btwo\b|\bthree\b|\bfive\b|\bfour\b|\bsix\b|\bseven\b|\beight\b|\bnine\b|\bten\b)\s+([a-z][a-z-]*)/gi;
function redactQuantitiesInText(text, question): string {
  const allowed = allowedQuantityKeys(question); // Set of "n:unit"
  let out = text.replace(QUANTITY_RE, (full, num, unit) => {
    const n = numToNumber(num); if (n === null) return full;
    const u = singularize(unit.toLowerCase());
    if (allowed.has(`${n}:${u}`)) return full;
    return `several ${unit}`; // keep surface unit
  });
  // bare digits not followed by unit
  out = out.replace(/\b(\d{1,3})\b(?!\s)/, ...) hmm
```
Bare digit: after the unit pass, remaining digits: `out.replace(/\b\d{1,3}\b/g, m => 'a few')` — but digits that were part of kept allowed pairs? Unit pass kept the original "four shards" (spell-out, no digit) ✓; kept digit pair "2 shards" (player mentioned) would be replaced to "a few shards" by the bare pass — bug. Fix: do both in one pass: match optional unit; if unit && allowed → keep whole; if unit && !allowed → "several unit"; if no unit (bare) → "a few"?? but bare "3" → "a few" is a redaction ✓ per spec (quantity). But careful, the first alternative matched with group2 undefined when digit followed by space + stopword like "5 of them": regex requires `\s+([a-z][a-z-]*)` — "of" matches [a-z]+ → group2 = 'of' → unit stopword 'of' → treat as bare? I decided unit stopword → bare → "a few of them"?? that changes "5 of them" to "a few of them" ✓ actually that's correct redaction! Wait no — "5 of them" is quantity 5 → redact → "a few of them" ✓ good. So: group2 present but in STOPWORDS → treat as bare number: replace only the number token → need to replace just `full`? full = "5 of" → replace with "a few of"? Hmm: number + ' of' → "a few of" ✓ works: replacement = `a few ${group2}`? That's "a few of them" ✓. And stopword unit like "5 or 6"? → "5 or" → "a few or 6"?? then 6 becomes... 6 is matched separately? "5 or 6": first match "5 or" (unit 'or' stopword → "a few or"), remaining "6" → bare "a few" → "a few or a few" — acceptable lol. Fine.
So logic:
```
replace(QUANTITY_BARE, (full, num, unit) => {
  const n = toNumber(num); if (n === null) return full;
  if (unit) {
    if (STOPWORDS.has(unit.toLowerCase())) return `a few ${unit}`;  // number redacted, tail kept
    const key = `${n}:${singularize(unit.toLowerCase())}`;
    if (allowed.has(key)) return full;
    return `several ${unit}`;
  }
  return 'a few';
});
```
With QUANTITY_BARE = /(\b\d{1,3}\b|\b(?:one|two|...)\b)(?:\s+([a-z][a-z-]*))?/gi — optional group. Note: spell-out "one" in "one way or another": unit 'way' — not in STOPWORDS (generic word) → key "1:way" not in allowed → "several way or another"?? Bad: "several way or another". Ugh. Add 'way' to... 'way' is in HARMLESS_LOCATION_WORDS but quantity unit check uses STOPWORDS. I'll make a UNITS_GUARD set = STOPWORDS ∪ {way, kind, sort, hand, eye, heart, mind, place, position, room?}. "one way or another" → 'way' in guard → "a few way or another" — still awkward ("a few way"). Hmm. Alternative: replace number with "a few" only if unit is plural-looking or... over-engineering. Frequency in game answers: low. Accept the edge; the tests won't hit it. Actually — safer: for spell-out numbers (non-digits), only redact when unit is not in guard AND ... hmm "five shards" must be redacted (shards is noun). "one way" — 'way' in guard → skip redaction entirely (return full)? "one way or another" stays — is "one" a dangerous quantity? It's an idiomatic one. Guard → skip (no redaction). But "five of you" → 'of' is stopword → skip? "five of you die" — quantity 5 survives! Bad. Distinguish: 'of' → number modifies an external noun → redact number → "a few of you" ✓. 'way'/'kind' → idiomatic → keep. Two sets: REDACTABLE_TAILS (prepositions/stopwords where we redact the number and keep the tail): of, and, or, to, by, for, in, at, on... basically STOPWORDS. GUARD_TAILS (idiomatic nouns, keep whole): way, kind, sort, hand, eye, heart, mind, place, position, time, game. OK:
```
if (unit) {
  const u = unit.toLowerCase();
  if (GUARD_TAILS.has(u)) return full;               // idiom, keep
  if (STOPWORDS.has(u)) return `a few ${unit}`;       // redact number, keep tail
  key... allowed → full : `several ${unit}`
}
return 'a few';
```
Good enough.

allowedQuantityKeys(question): extract atoms from question → quantities → add `${n}:${unit}`. Question "I have four shards already." → (4, shard) ✓.

Spell-out in question: "four" ✓ handled by regex.

toNumber: /^\d+$/ → parseInt; else WORD_NUMBERS[lower]; else null.

Also, depluralization: "shards" surface preserved in "several shards" ✓ (just replace number word).

Now re-check hint flow with order [location, name, quantity] per sentence, then join.

Recheck main hint:
S1 "The cellar lies behind the bakery."
- location: "behind the bakery" → capture 'bakery' harmless? no → replace → "The cellar lies behind a hidden place."
- names: findEntities("The cellar lies behind a hidden place.") → "The" at start single → skipped; "Hidden"? 'hidden' lowercase after replacement ✓ none.
- quantities: none.
S2 "Weaken the Gravel Wretch with a shard of glass."
- location: preps? 'with' no ✓.
- names: "Gravel Wretch" (matchAll on "Weaken the Gravel Wretch..." — "Weaken" at start single → skipped; "Gravel Wretch" ✓) preceding "Weaken the " ends with "the " → "the hidden name" → "Weaken the hidden name with a shard of glass."
- quantities: "a shard" — 'a' not in number alternation ✓ untouched.
S3 "Four shards are required to seal the cellar door."
- location: "seal the cellar door" no prep ✓; "to seal" — 'to' not in prep list ✓.
- names: "Four" at start single → skipped ✓ (phew — otherwise "Four" → "a hidden name"!).
- quantities: "Four shards": number 'four' → n=4, unit 'shards' → guard? no; stopword? no; key '4:shard' in allowed? question "How do I get past the cellar door?" → no → "several shards" → "Several shards are required to seal the cellar door." Wait case: original "Four" capital at sentence start → replacement `several ${unit}` = "several shards" → sentence starts with lowercase "Several"?? original capital F is part of the number token we replaced → "several shards are required..." sentence starts lowercase. Cosmetic issue; fix: capitalize the first char of the sentence after all redactions? Add a final polish: in redactHint, after processing each sentence, capitalize first letter. ✓ Let me do that.

Final hint: "The cellar lies behind a hidden place. Weaken the hidden name with a shard of glass. Several shards are required to seal the cellar door." ✓ all assertions hold: no 'gravel wretch', no 'bakery', no 'four'/'5', contains 'several shards', 'hidden place', 'hidden name'.

Player-quantity scenario: question "I have four shards already. What now?" allowed {4:shard}. Script: "Four shards are required to seal the cellar door." → hint keeps "Four shards are required to seal the cellar door." ✓ contains 'Four shards'.

**Verify grounded scenario answer mode**:
raw = "The cellar lies behind the bakery. Weaken the Gravel Wretch with a shard of glass. Four shards are required to seal the cellar door."
- S1 atoms: findEntities → "The" at start single skipped → none; quantities: none? "cellar" no. → grounded (vacuously) → kept.
- S2: "Gravel Wretch" supported: blob contains "gravel wretch" ✓ → kept.
- S3: "Four" entity skipped (at start); quantity (4, 'shard'): sourceQuantities — from CELLAR_PAGES: S1 page "Four shards are required" → (4,shard) ✓; supported ✓ kept.
→ text = raw (joined with ' ' — same) ✓ refusal false.
Helpful: expectedFacts ['gravel wretch','behind the bakery','four shards are required'] — normalize answer contains all ✓ 1.0.
Faithful: atoms across sentences: entity gravel wretch ✓, quantity 4:shard ✓ → 2/2 = 1.0. planted: none present ✓. Final 1.0 ✓.

**Lie scenario**: raw = "The cellar door opens with a Moonlight Shard. You need five shards and the Rusted Key to proceed."
- S1: "The" skipped; "Moonlight Shard" entity → "moonlight shard" in blob? blob = cellar pages — no "moonlight" → ungrounded → drop.
- S2: "You" at start single skipped; "Rusted Key" → not in blob → ungrounded; quantity (5,'shard'): {4} no → ungrounded. Drop.
- groundedAtomCount = 0 → kept [] → refuse ✓.
Helpful: expectRefusal false, isRefusal → 0.0. Faithful: refusal → 1.0. Final 0.0 ✓ low.

**Uncovered scenario**: question "What does the Moonlight Shrine do?" sources = CELLAR_PAGES (no shrine). Script: "The Moonlight Shrine restores health. A Rusted Key glows beside it."
- S1: "The Moonlight Shrine" — matchAll: match "The Moonlight Shrine" (all caps consecutive) → words after stopword filter: "Moonlight Shrine" (The dropped) → 2 words → value "moonlight shrine" → atSentenceStart? match starts at 0 ✓ but words.length 2 → kept as atom → not in blob → ungrounded → drop.
- S2: "A Rusted Key glows beside it." match "A Rusted Key" → words "Rusted Key" (A dropped) → 2 words → ungrounded → drop. ("beside" is lowercase ✓.)
→ refusal ✓. Helpful (expectRefusal true): 1.0. Faithful: 1.0. Final 1.0 ✓ pass.

**Quantity-exact scenario** (in scenarios file? I said 5 scenarios): id 'quantity-mismatch-dropped': question main, script "Four shards are required. Bring five shards to the door."
- S1: atoms: "Four" skipped; (4,shard) ✓ → kept.
- S2: "Bring" skipped; (5,shard) ✗ → drop.
→ text "Four shards are required." Helpful: expectedFacts ['four shards are required'] → 1.0. Faithful: atoms: (4,shard) ✓ → 1.0 → final 1.0, pass. Test asserts !text.includes('five') ✓ "caught exactly."

And direct judge test (eval spec):
- judge("Bring five shards to the door.", pages) → atoms (5,shard) ✗ → 0.0.
- judge("Bring four shards to the door.", pages) → (4,shard) ✓ → 1.0.
Exactly ✓.

**min() test**: custom scenario: question "Where is the cellar?" sources pages; script: "The cellar lies behind the bakery." expectedFacts: ['behind the bakery','no keyhole'] → 1/2 = 0.5 helpful; faithful: atoms zero → 1.0; final 0.5; pass false (threshold .75). ✓ proves min.

Now — another required behavior: "scripted confident-lie answer scores low" ✓ (final 0). "Correct grounded answer scores high" ✓ (1.0, pass). "Scenario whose sources miss the answer leads to refusal" ✓ (refusal true). "Quantity errors caught exactly" ✓ both gate and judge.

Additional hint tests: no re-prompting (calls === 1) ✓.

Now, `GOLDEN_SCENARIOS` export — include all 5:
1. grounded-answer-high (mode 'answer')
2. confident-lie-low
3. uncovered-refusal (expectRefusal true)
4. quantity-mismatch-dropped
5. hint-redacted (mode 'hint') expectedFacts ['several shards are required','hidden place','hidden name'], plantedFalseFacts ['gravel wretch','bakery','four shards'] — wait 'four shards' planted check: hint text has "Several shards" — does normalized hint contain "four shards"? No ✓. Faithfulness on hint: atoms: let me re-scan hint atoms: "The cellar lies behind a hidden place." → entities: "The" skipped; "Hidden"? lowercase ✓ none. Quantities: none. S2: "Weaken the hidden name with a shard of glass." none. S3: "Several shards are required to seal the cellar door." — 'Several' not word-number ✓ none. → 0 atoms → 1.0 ✓. Final 1.0 ✓.

Hmm wait, scenario 5 plantedFalseFacts 'four shards' — hint doesn't contain ✓.

Also verify helpfulness normalization: expectedFact 'several shards are required' is normalized and contained in hint ✓. 'hidden place' ✓. 'hidden name' ✓.

Now STOPWORDS list — need to include: the,a,an,this,that,these,those,you,your,i,we,it,he,she,they,is,are,was,were,be,been,and,or,to,of,in,on,at,with,by,for,from,as,not,no,do,does,did,can,cannot,will,would,should,shall,may,might,must,if,when,then,so,but,than,too,very,just,only,about,into,over,under,behind,before,after,against,between,out,up,down,off,once,here,there,where,what,which,who,whom,whose,how,all,any,some,each,few,more,most,other,such,own,same,now,of.
Note 'under','behind','in','on','at' are stopwords — used in entity leading-strip ✓, and quantity unit guard (stopword unit → redact number, keep tail) ✓.

Wait conflict: 'in' is a location prep AND stopword — fine, different uses.

ENTITY_RE with matchAll, and \b before [A-Z]: "the Gravel" — 'G' boundary ✓.

Potential pitfall: `sentence.matchAll` requires /g ✓.

Also findEntities needs index: use matchAll, m.index.

Now let me write splitSentences with lookbehind — Node 20 supports ✓, esbuild/vitest fine, TS target ES2022 ✓.

Edge: raw LLM text with trailing period and multiple spaces — fine.

Also answer() — service should handle empty sources? Not required.

**Verify import/export consistency**:

grounding-gate.ts exports: FactualAtom, normalize, splitSentences, findEntities, EntityMatch, extractSentenceAtoms, extractAtoms, sourceQuantities, SentenceVerdict, GroundingGate, LexicalGroundingGate. Also STOPWORDS? Hint-redactor needs STOPWORDS and singularize and WORD_NUMBERS/toNumber. Export: STOPWORDS, IDIOMATIC_UNITS, singularize, numberTokenToValue? Let me organize:

grounding-gate.ts:
- normalize, splitSentences
- STOPWORDS (set), IDIOMATIC_TAILS (set), WORD_NUMBERS, toNumber, singularize
- ENTITY_RE? redactor needs it → export const ENTITY_RE.
- QUANTITY_RE? redactor builds its own with capture groups — different group structure. Redactor will define its own regex locally. OK, I'll export only what's needed.
- EntityMatch, findEntities
- FactualAtom, extractSentenceAtoms, extractAtoms
- sourceQuantities(sources): Map<string, Set<number>>
- entitySupported(value, blob): boolean (used by gate; testable)
- SentenceVerdict, GroundingGate, LexicalGroundingGate

Refinement of extractSentenceAtoms:
```ts
export function extractSentenceAtoms(sentence: string): FactualAtom[] {
  const atoms: FactualAtom[] = [];
  const addAtom = (a: FactualAtom) => {
    const dup = atoms.some(x => x.kind === a.kind && (x.kind === 'entity' ? x.value === (a as any).value : ...));
```
Cleaner:
```ts
const key = (a: FactualAtom) => a.kind === 'entity' ? `e:${a.value}` : `q:${a.number}:${a.unit}`;
if (!atoms.some(x => key(x) === key(a))) atoms.push(a);
```

Quantities in a sentence:
```ts
const QUANTITY_RE = /(\b\d{1,3}\b|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b|\bseven\b|\beight\b|\bnine\b|\bten\b)(?:\s+([a-z][a-z-]*))?/gi;
for (const m of sentence.matchAll(QUANTITY_RE)) {
  const n = toNumber(m[1]); if (n === null) continue;
  const unit = m[2] ? m[2].toLowerCase() : null;
  if (unit && (STOPWORDS.has(unit) || IDIOMATIC_TAILS.has(unit))) continue;
  atoms quantity { n, unit: unit ? singularize(unit) : ... }
```
Wait — I decided bare numbers (no unit) → skip entirely as atoms. So: `if (!unit) continue;` ✓ (bare "3" is not gated). And unit stopword → skip (bare-ish). ✓ So atoms quantities only with real units.

Redactor's quantity regex: needs to also redact bare digits. Keep full form there:
```ts
const QUANTITY_RE = /(\b\d{1,3}\b|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b|\bseven\b|\beight\b|\bnine\b|\bten\b)(?:\s+([a-z][a-z-]*))?/gi;
replace((full, numTok, unitTok) => {
  const n = toNumber(numTok); if (n === null) return full;
  if (!unitTok) return 'a few';
  const u = unitTok.toLowerCase();
  if (IDIOMATIC_TAILS.has(u)) return full;
  if (STOPWORDS.has(u)) return `a few ${unitTok}`;
  if (allowed.has(`${n}:${singularize(u)}`)) return full;
  return `several ${unitTok}`;
});
```
Hmm — spell-out "ten" as a normal word? "ten" alone → 'a few' fine.
Also danger: "four" in "four of a kind"? 'of' stopword → "a few of a kind" ✓.

allowed keys from question: use extractSentenceAtoms? extractSentenceAtoms skips bare numbers ✓ only real units — same key format ✓.

toNumber:
```ts
export function toNumber(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  const v = WORD_NUMBERS[token.toLowerCase()];
  return v ?? null;
}
```

entitySupported:
```ts
export function entitySupported(value: string, normalizedBlob: string): boolean {
  return (
    normalizedBlob.includes(value) ||
    normalizedBlob.includes(`${value}s`) ||
    (value.endsWith('s') && normalizedBlob.includes(value.slice(0, -1)))
  );
}
```

sourceQuantities:
```ts
export function sourceQuantities(sources: string[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const src of sources) {
    for (const s of splitSentences(src)) {
      for (const a of extractSentenceAtoms(s)) {
        if (a.kind !== 'quantity') continue;
        const set = map.get(a.unit) ?? new Set<number>();
        set.add(a.number);
        map.set(a.unit, set);
      }
    }
  }
  return map;
}
```

LexicalGroundingGate:
```ts
export class LexicalGroundingGate implements GroundingGate {
  assess(sentence: string, sources: string[]): SentenceVerdict {
    const atoms = extractSentenceAtoms(sentence);
    const blob = normalize(sources.join(' '));
    const quantities = sourceQuantities(sources);
    const grounded = atoms.every(a =>
      a.kind === 'entity'
        ? entitySupported(a.value, blob)
        : (quantities.get(a.unit) ?? new Set<number>()).has(a.number));
    return { sentence, atoms, grounded };
  }

  filter(rawAnswer: string, sources: string[]): { kept: string[]; dropped: string[] } {
    const kept: string[] = [];
    const dropped: string[] = [];
    let supportedAtomCount = 0;
    for (const sentence of splitSentences(rawAnswer)) {
      const verdict = this.assess(sentence, sources);
      if (verdict.grounded) {
        kept.push(sentence);
        supportedAtomCount += verdict.atoms.length;
      } else {
        dropped.push(sentence);
      }
    }
    // Nothing verifiable was supported -> the answer is not covered by the sources.
    if (supportedAtomCount === 0) return { kept: [], dropped: [...kept, ...dropped] };
    return { kept, dropped };
  }
}
```
Wait: atomless grounded sentence has verdict.atoms.length 0 → no contribution ✓. Confident lie: all dropped, supportedAtomCount 0 → kept [] ✓. But subtle: S1 atomless (kept vacuously), S2 grounded with atoms → count>0 → kept=[S1,S2] ✓. All atomless → count 0 → kept [] → refuse ✓.

Hmm one flaw: S1 atomless kept vacuously but the answer as a whole is a lie with only lowercase words... documented limitation ✓.

findEntities:
```ts
export interface EntityMatch { raw: string; value: string; index: number; }
export function findEntities(sentence: string): EntityMatch[] {
  const out: EntityMatch[] = [];
  for (const m of sentence.matchAll(ENTITY_RE)) {
    const words = m[0].split(' ').filter(w => !STOPWORDS.has(w.toLowerCase()));
    if (words.length === 0) continue;
    const atSentenceStart = m.index === 0;
    if (words.length === 1 && atSentenceStart) continue;
    out.push({ raw: m[0], value: normalize(words.join(' ')), index: m.index ?? 0 });
  }
  return out;
}
```
matchAll m.index type number|undefined → `m.index ?? 0` but if index is undefined matchAll... in matchAll, index is defined when /g. TS type says number|undefined → coerce ✓.

Note: deduplicate entities in atoms: two mentions "Wretch" — dedup by key ✓ but for redaction we need all occurrences → findEntities returns all (no dedup) ✓ separate function ✓.

Now — "atSentenceStart" check `m.index === 0` vs sentence.startsWith(m[0]) — with /g matchAll index 0 = start ✓ simpler.

Edge: "Four shards are required." → "Four" index 0 single word → skipped ✓. But "Four" in WORD regex is also → quantity (4, shard) ✓ — so the sentence is still gated by quantity ✓ good.

Edge: "Weaken the Gravel Wretch..." "Weaken" index 0 single → skipped ✓; "Gravel Wretch" ✓.

Edge: "A Rusted Key glows beside it." → match "A Rusted Key" index 0; words after filter: ["Rusted","Key"] length 2 → atom ✓ (leading stopword stripped, multi-word survives even at start) — that's what I want ✓.

Now hint-redactor.ts:

```ts
import {
  ENTITY_RE,
  IDIOMATIC_TAILS,
  STOPWORDS,
  findEntities,
  normalize,
  singularize,
  splitSentences,
  toNumber,
  extractSentenceAtoms,
} from './grounding-gate.js';

export const NAME_PLACEHOLDER = 'hidden name';
export const PLACE_PLACEHOLDER = 'a hidden place';

const LOCATION_RE = /\b(?:in|at|on|under|behind|inside|beyond|beside|near)\s+(?:(?:the|a|an)\s+)?([A-Za-z][a-z-]*)/gi;
const HARMLESS_LOCATION_WORDS = new Set(['end','time','way','game','air','ground','cost','day','night','morning','evening','minute','hour','second','place','position','door','edge','line']);

function redactLocations(sentence: string): string {
  return sentence.replace(LOCATION_RE, (full, word: string) => {
    const w = word.toLowerCase();
    if (HARMLESS_LOCATION_WORDS.has(w) || STOPWORDS.has(w)) return full;
    return full.replace(/\s+(?:(?:the|a|an)\s+)?[A-Za-z][a-z-]*$/i, '') + ` ${PLACE_PLACEHOLDER}`;
  });
}
```
Hmm, cleaner: reconstruct: prep = full up to word start... let me capture prep:
```ts
const LOCATION_RE = /\b(in|at|on|under|behind|inside|beyond|beside|near)\s+(?:(?:the|a|an)\s+)?([A-Za-z][a-z-]*)/gi;
replace((full, prep, word) => HARMLESS... ? full : `${prep} ${PLACE_PLACEHOLDER}`)
```
✓ simpler.

Redact names:
```ts
function redactNames(sentence: string): string {
  const entities = findEntities(sentence);
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    const before = sentence.slice(0, e.index);
    const precededByArticle = /(?:^|\s)(?:the|a|an)\s$/i.test(before);
    const replacement = precededByArticle ? `the ${NAME_PLACEHOLDER}` : `a ${NAME_PLACEHOLDER}`;
    sentence = before + replacement + sentence.slice(e.index + e.raw.length);
  }
  return sentence;
}
```
Wait — if raw includes a leading stopword article ("The Gravel Wretch" raw), before doesn't end with article (the article is inside raw) → replacement "a hidden name" → "a hidden name with a shard..." but original "Weaken The Gravel Wretch" is rare casing... in our data "the" is lowercase ✓. If raw starts with "The" (stopword included), replacement "a hidden name" replaces "The Gravel Wretch" ✓ correct.

Order note: location before name (consuming "behind the Bakery"), but location regex might also consume "beside a hidden name"?? "glows beside it" — 'it'... [A-Za-z][a-z-]* captures "it" — hmm 'it' is a pronoun! Add pronouns to harmless/stopword check: STOPWORDS has 'it' ✓ (I have it in the list) → return full ✓.

Also "on the altar" → 'altar' → "on a hidden place" ✓ intended.
"at the end" → 'end' harmless ✓ keep.
"in the cellar" → cellar not harmless → "in a hidden place" — wait, is that desired? "cellar" is a location → yes, redact ✓. But scenario hint S3: "seal the cellar door" — no prep before "cellar" ✓ untouched.
S1: "behind the bakery" → "behind a hidden place" ✓.

Hmm — "in broken windows" (source, not in answer) fine.

Quantities:
```ts
const QUANTITY_RE = /(\b\d{1,3}\b|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b|\bseven\b|\beight\b|\bnine\b|\bten\b)(?:\s+([a-z][a-z-]*))?/gi;

function allowedQuantityKeys(question: string): Set<string> {
  const keys = new Set<string>();
  for (const sentence of splitSentences(question)) {
    for (const atom of extractSentenceAtoms(sentence)) {
      if (atom.kind === 'quantity') keys.add(`${atom.number}:${atom.unit}`);
    }
  }
  return keys;
}

function redactQuantities(sentence: string, allowed: Set<string>): string {
  return sentence.replace(QUANTITY_RE, (full, numToken: string, unitToken?: string) => {
    const n = toNumber(numToken);
    if (n === null) return full;
    if (!unitToken) return 'a few';
    const u = unitToken.toLowerCase();
    if (IDIOMATIC_TAILS.has(u)) return full;
    if (STOPWORDS.has(u)) return `a few ${unitToken}`;
    if (allowed.has(`${n}:${singularize(u)}`)) return full;
    return `several ${unitToken}`;
  });
}
```
Wait, problem: spell-out word-number match without unit, e.g., "one" alone in "one way or another" → 'one' with unit 'way' → idiomatic → full ✓. "one" alone at end: "there is one" → no unit → 'a few' → "there is a few" ugh. Acceptable? Hmm "one" bare → 'a few' changes meaning but redacts quantity per spec... "there is one" → reveals a count of 1 — redacting to "a few" is roughly OK. Accept.

But dangerous: word "one" as a pronoun in "I am the one" → next word? "one." end → 'a few' → "I am the a few" broken. Rare in game guide answers. Accept (documented as lexical redaction limitation? brief comment).

Also QUANTITY_RE digit alternative `\b\d{1,3}\b` — "5 shards" → number 5 unit shards ✓. Note: "0 shards"? toNumber ✓ 0.

Redact per-sentence order: locations → names → quantities, then capitalize first letter:
```ts
function polish(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function redactHint(fullAnswer: string, question: string): string {
  const allowed = allowedQuantityKeys(question);
  return splitSentences(fullAnswer)
    .map(s => polish(redactQuantities(redactNames(redactLocations(s)), allowed)))
    .join(' ');
}
```
Verify S2 after location: no change; names: "Weaken the hidden name with a shard of glass."; quantities: none ✓.
S3: quantities: "Four shards" → not allowed → "several shards"; polish → "Several shards are required to seal the cellar door." ✓.
S1: location → "The cellar lies behind a hidden place."; names: findEntities — "The" index 0 single skipped ✓; quantities none; polish → same ✓.

Check hint doesn't accidentally contain "five"/"four": ✓.

Now judges.ts:

```ts
import { extractAtoms, isRefusal? no — from refusal.js } ...

export class FaithfulnessJudge {
  constructor(private readonly gate: GroundingGate = new LexicalGroundingGate()) {}
  judge(answer: string, sources: string[], options: { plantedFalseFacts?: string[] } = {}): number {
    if (isRefusal(answer)) return 1;
    const lowered = normalize(answer);
    for (const planted of options.plantedFalseFacts ?? []) {
      if (lowered.includes(normalize(planted))) return 0;
    }
    const atoms = extractAtoms(answer);
    if (atoms.length === 0) return 1;
    const supported = atoms.filter(a => this.gate.assess??
```
Hmm — gate.assess is per-sentence; here I need per-atom support. Let me expose a helper in the gate: `isAtomSupported(atom, sources): boolean` on LexicalGroundingGate (part of interface? Add to interface:
```ts
export interface GroundingGate {
  assess(sentence: string, sources: string[]): SentenceVerdict;
  isAtomSupported(atom: FactualAtom, sources: string[]): boolean;
  filter(rawAnswer: string, sources: string[]): { kept: string[]; dropped: string[] };
}
```
Lexical impl:
```ts
isAtomSupported(atom, sources) {
  if (atom.kind === 'entity') return entitySupported(atom.value, normalize(sources.join(' ')));
  return (sourceQuantities(sources).get(atom.unit) ?? new Set()).has(atom.number);
}
```
And assess uses this ✓.

Faithfulness:
```ts
const ok = atoms.filter(a => this.gate.isAtomSupported(a, sources)).length;
return ok / atoms.length;
```

HelpfulnessJudge:
```ts
export interface HelpfulnessSpec { expectedFacts: string[]; expectRefusal?: boolean; }
export class HelpfulnessJudge {
  judge(answer: string, spec: HelpfulnessSpec): number {
    if (spec.expectRefusal) return isRefusal(answer) ? 1 : 0;
    if (isRefusal(answer)) return 0;
    const total = spec.expectedFacts.length;
    if (total === 0) return 0;
    const lowered = normalize(answer);
    const hit = spec.expectedFacts.filter(f => lowered.includes(normalize(f))).length;
    return hit / total;
  }
}
```

eval-harness.ts:
```ts
import { AnswerService, AnswerMode } from '../answer/answer-service.js';
import { LlmClient, ScriptedLlmClient } from '../answer/llm-client.js';
import { FaithfulnessJudge, HelpfulnessJudge } from './judges.js';

export interface GoldenScenario {
  id: string;
  description?: string;
  question: string;
  sources: string[];
  mode?: AnswerMode;
  /** Scripted reply the fake LLM returns for this scenario. */
  llmReply: string;
  expectedFacts: string[];
  plantedFalseFacts?: string[];
  expectRefusal?: boolean;
}

export interface ScenarioReport { id: string; mode: AnswerMode; text: string; refusal: boolean; helpfulness: number; faithfulness: number; finalScore: number; pass: boolean; }
export interface EvalReport { reports: ScenarioReport[]; average: number; passed: boolean; }
export interface EvalOptions {
  threshold?: number;
  makeLlm?: (scenario: GoldenScenario) => LlmClient;
  faithfulnessJudge?: FaithfulnessJudge;
  helpfulnessJudge?: HelpfulnessJudge;
}

export const DEFAULT_PASS_THRESHOLD = 0.75;

export async function runEval(scenarios: GoldenScenario[], options: EvalOptions = {}): Promise<EvalReport> {
  const threshold = options.threshold ?? DEFAULT_PASS_THRESHOLD;
  const makeLlm = options.makeLlm ?? ((s: GoldenScenario) => ScriptedLlmClient.fromText(s.llmReply));
  const faithfulnessJudge = options.faithfulnessJudge ?? new FaithfulnessJudge();
  const helpfulnessJudge = options.helpfulnessJudge ?? new HelpfulnessJudge();

  const reports: ScenarioReport[] = [];
  for (const scenario of scenarios) {
    const mode = scenario.mode ?? 'answer';
    const service = new AnswerService(makeLlm(scenario));
    const result = await service.answer(scenario.question, scenario.sources, mode);
    const helpfulness = helpfulnessJudge.judge(result.text, { expectedFacts: scenario.expectedFacts, expectRefusal: scenario.expectRefusal });
    const faithfulness = faithfulnessJudge.judge(result.text, scenario.sources, { plantedFalseFacts: scenario.plantedFalseFacts });
    const finalScore = Math.min(helpfulness, faithfulness);
    reports.push({ id: scenario.id, mode, text: result.text, refusal: result.refusal, helpfulness, faithfulness, finalScore, pass: finalScore >= threshold });
  }
  const average = reports.length > 0 ? reports.reduce((sum, r) => sum + r.finalScore, 0) / reports.length : 0;
  return { reports, average, passed: reports.every(r => r.pass) };
}
```

golden-scenarios.ts:
```ts
import type { GoldenScenario } from './eval-harness.js';

export const CELLAR_PAGES = [
  'The Gravel Wretch is the guardian of the cellar. It can only be weakened by a shard of glass. Four shards are required to seal the cellar door.',
  'The cellar lies behind the bakery. The door has no keyhole. Shards of glass can be found in broken windows.',
];

export const GROUNDING_REPLIES = {...}?
```
Let me just inline the replies:

```ts
export const GOLDEN_SCENARIOS: GoldenScenario[] = [
  {
    id: 'grounded-answer-high',
    description: 'A fully grounded answer should score high on both judges.',
    question: 'How do I get past the cellar door?',
    sources: CELLAR_PAGES,
    mode: 'answer',
    llmReply: 'The cellar lies behind the bakery. Weaken the Gravel Wretch with a shard of glass. Four shards are required to seal the cellar door.',
    expectedFacts: ['behind the bakery', 'gravel wretch', 'four shards are required'],
    plantedFalseFacts: ['moonlight shard', 'rusted key', 'five shards'],
  },
  {
    id: 'confident-lie-low',
    description: 'A confident but unsupported answer must score low.',
    question: 'How do I get past the cellar door?',
    sources: CELLAR_PAGES,
    mode: 'answer',
    llmReply: 'The cellar door opens with a Moonlight Shard. You need five shards and the Rusted Key to proceed.',
    expectedFacts: ['gravel wretch', 'four shards'],
    plantedFalseFacts: ['moonlight shard', 'rusted key', 'five shards'],
  },
  {
    id: 'uncovered-refusal',
    description: 'Sources that lack the answer yield a refusal, even when the LLM hallucinates.',
    question: 'What does the Moonlight Shrine do?',
    sources: CELLAR_PAGES,
    mode: 'answer',
    llmReply: 'The Moonlight Shrine restores health. A Rusted Key glows beside it.',
    expectedFacts: [],
    expectRefusal: true,
    plantedFalseFacts: ['moonlight shrine', 'rusted key'],
  },
  {
    id: 'quantity-mismatch-dropped',
    description: 'A wrong quantity (five vs four shards) is dropped exactly, the right sentence kept.',
    question: 'How do I get past the cellar door?',
    sources: CELLAR_PAGES,
    mode: 'answer',
    llmReply: 'Four shards are required. Bring five shards to the door.',
    expectedFacts: ['four shards are required'],
    plantedFalseFacts: ['five shards'],
  },
  {
    id: 'hint-redacted',
    description: 'Hint mode redacts names, places and quantities from the grounded answer.',
    question: 'How do I get past the cellar door?',
    sources: CELLAR_PAGES,
    mode: 'hint',
    llmReply: 'The cellar lies behind the bakery. Weaken the Gravel Wretch with a shard of glass. Four shards are required to seal the cellar door.',
    expectedFacts: ['several shards are required', 'a hidden place', 'a hidden name'],
    plantedFalseFacts: ['gravel wretch', 'bakery', 'four shards'],
  },
];
```
Wait expectedFacts 'a hidden place' — hint contains "behind a hidden place" ✓ substring 'a hidden place' ✓; 'a hidden name' ✓.

Verify quantity-mismatch scenario helpfulness: final answer "Four shards are required." contains 'four shards are required' ✓ 1.0. Faithfulness: atoms: (4,shard) ✓ → 1.0 → final 1.0, pass ✓. planted 'five shards' not in answer ✓.

Verify confident-lie: final = refusal "not covered by my sources". Helpful 0 (expectRefusal undefined → refusal → 0). Faithful: isRefusal → 1.0. final 0.0, pass false ✓.

Now the tests.

test/answer.service.spec.ts:
```ts
import { describe, expect, it } from 'vitest';
import { AnswerService } from '../src/answer/answer-service.js';
import { ScriptedLlmClient } from '../src/answer/llm-client.js';
import { NOT_COVERED_MESSAGE } from '../src/answer/refusal.js';
import { CELLAR_PAGES } from '../src/eval/golden-scenarios.js';

const QUESTION = 'How do I get past the cellar door?';
const GROUNDED_REPLY = 'The cellar lies behind the bakery. Weaken the Gravel Wretch with a shard of glass. Four shards are required to seal the cellar door.';
const LIE_REPLY = 'The cellar door opens with a Moonlight Shard. You need five shards and the Rusted Key to proceed.';

describe('AnswerService', () => {
  it('returns the grounded answer when every sentence is supported', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText(GROUNDED_REPLY));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');
    expect(result.refusal).toBe(false);
    expect(result.text).toBe(GROUNDED_REPLY);
    expect(result.droppedSentences).toEqual([]);
  });

  it('refuses with the not-covered message when the answer is a confident lie', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText(LIE_REPLY));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');
    expect(result.refusal).toBe(true);
    expect(result.text).toBe(NOT_COVERED_MESSAGE);
  });

  it('refuses when the LLM itself says the pages do not cover the question', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText('NOT_COVERED'));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');
    expect(result.refusal).toBe(true);
    expect(result.text).toBe(NOT_COVERED_MESSAGE);
  });

  it('drops a sentence with a wrong quantity and keeps the correct one', async () => {
    const reply = 'Four shards are required. Bring five shards to the door.';
    const service = new AnswerService(ScriptedLlmClient.fromText(reply));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');
    expect(result.refusal).toBe(false);
    expect(result.text).toBe('Four shards are required.');
    expect(result.droppedSentences).toEqual(['Bring five shards to the door.']);
    expect(result.text).not.toContain('five');
  });

  it('treats the exact quantity in the sources as grounded', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText('Bring four shards to the door.'));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');
    expect(result.refusal).toBe(false);
    expect(result.text).toBe('Bring four shards to the door.');
  });

  it('refuses an invented name that appears in no source', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText('The Rusted Key opens the gate.'));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');
    expect(result.refusal).toBe(true);
    expect(result.text).toBe(NOT_COVERED_MESSAGE);
  });
});
```
Wait "The Rusted Key opens the gate." — atoms: "Rusted Key" (after A-stopword-strip? raw "The Rusted Key" → words ["Rusted","Key"] → atom) not in sources → ungrounded → single sentence → supportedAtomCount 0 → refusal ✓.

Hmm "Bring four shards to the door." atoms: "Bring" index 0 skipped; quantity (4,shard) ✓ grounded → kept ✓ text = itself ✓.

Also verify GROUNDED_REPLY text roundtrip: splitSentences on it → 3 sentences; join(' ') reconstructs exactly (single spaces, trailing period kept) ✓.

test/hint.spec.ts:
```ts
import { describe, expect, it } from 'vitest';
import { AnswerService } from '../src/answer/answer-service.js';
import { ScriptedLlmClient } from '../src/answer/llm-client.js';
import { NOT_COVERED_MESSAGE } from '../src/answer/refusal.js';
import { CELLAR_PAGES } from '../src/eval/golden-scenarios.js';

const QUESTION = 'How do I get past the cellar door?';
const GROUNDED_REPLY = 'The cellar lies behind the bakery. Weaken the Gravel Wretch with a shard of glass. Four shards are required to seal the cellar door.';
const LIE_REPLY = 'The cellar door opens with a Moonlight Shard. You need five shards and the Rusted Key to proceed.';

describe('hint mode', () => {
  it('redacts boss names, item locations and quantities from the grounded answer', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText(GROUNDED_REPLY));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'hint');
    expect(result.refusal).toBe(false);
    expect(result.text).not.toContain('Gravel Wretch');
    expect(result.text).not.toContain('bakery');
    expect(result.text.toLowerCase()).not.toContain('four');
    expect(result.text).not.toMatch(/\d/);
    expect(result.text).toContain('a hidden place');
    expect(result.text).toContain('the hidden name');
    expect(result.text).toContain('several shards');
    expect(result.fullAnswer).toBe(GROUNDED_REPLY);
  });

  it('keeps quantities the player already mentioned', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText('Four shards are required to seal the cellar door.'));
    const result = await service.answer('I have four shards already. What now?', CELLAR_PAGES, 'hint');
    expect(result.refusal).toBe(false);
    expect(result.text).toContain('Four shards are required');
  });

  it('is derived from the grounded answer by redaction, not by a second LLM call', async () => {
    const llm = ScriptedLlmClient.fromText(GROUNDED_REPLY);
    const service = new AnswerService(llm);
    const hint = await service.answer(QUESTION, CELLAR_PAGES, 'hint');
    expect(llm.calls).toHaveLength(1);
    const answerText = (await new AnswerService(ScriptedLlmClient.fromText(GROUNDED_REPLY)).answer(QUESTION, CELLAR_PAGES, 'answer')).text;
    expect(hint.fullAnswer).toBe(answerText);
    expect(hint.text).not.toBe(answerText);
  });

  it('refuses in hint mode when nothing is grounded', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText(LIE_REPLY));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'hint');
    expect(result.refusal).toBe(true);
    expect(result.text).toBe(NOT_COVERED_MESSAGE);
  });
});
```
Verify "keeps quantities the player mentioned": question "I have four shards already. What now?" allowed keys: (4,shard). Reply "Four shards are required to seal the cellar door." hint: location? "seal the cellar door" none; names: "Four" index 0 single → skipped ✓; quantities: "Four shards" → allowed ✓ keep → "Four shards are required to seal the cellar door." ✓ contains 'Four shards are required' ✓.
Wait — "I have four shards already. What now?" — allowedQuantityKeys: sentence 1: "I" index 0 single skipped as entity; quantity "four shards" ✓ (4,shard). Sentence 2 "What now?" — "What" index 0 skipped ✓.

Verify "is derived..." test: hint fullAnswer === answerText: fullAnswer = "The cellar lies behind the bakery. Weaken the Gravel Wretch with a shard of glass. Four shards are required to seal the cellar door." answerText same ✓. hint.text differs (redacted) ✓. llm.calls toHaveLength(1) ✓ — proves no re-prompting.

Verify redacted hint doesn't match /\d/: "several shards" no digits ✓; no ordinals ✓.

Verify `expect(result.text).not.toContain('Gravel Wretch')` ✓ replaced.

test/eval-harness.spec.ts:
```ts
import { describe, expect, it } from 'vitest';
import { runEval } from '../src/eval/eval-harness.js';
import { GOLDEN_SCENARIOS, CELLAR_PAGES } from '../src/eval/golden-scenarios.js';
import { FaithfulnessJudge } from '../src/eval/judges.js';
import type { GoldenScenario } from '../src/eval/eval-harness.js';

describe('eval harness', () => {
  it('scores the scripted confident lie low', async () => {
    const report = await runEval(GOLDEN_SCENARIOS.filter(s => s.id === 'confident-lie-low'));
    const r = report.reports[0];
    expect(r.refusal).toBe(true);
    expect(r.helpfulness).toBe(0);
    expect(r.finalScore).toBeLessThan(0.25);
  });

  it('scores a correct grounded answer high', async () => {
    const report = await runEval(GOLDEN_SCENARIOS.filter(s => s.id === 'grounded-answer-high'));
    const r = report.reports[0];
    expect(r.finalScore).toBe(1);
    expect(r.pass).toBe(true);
  });

  it('yields a passing refusal when the sources lack the answer', async () => {
    const report = await runEval(GOLDEN_SCENARIOS.filter(s => s.id === 'uncovered-refusal'));
    const r = report.reports[0];
    expect(r.refusal).toBe(true);
    expect(r.helpfulness).toBe(1);
    expect(r.faithfulness).toBe(1);
    expect(r.pass).toBe(true);
  });

  it('catches quantity errors exactly: five shards fails, four shards passes', async () => {
    const judge = new FaithfulnessJudge();
    expect(judge.judge('Bring five shards to the door.', CELLAR_PAGES)).toBe(0);
    expect(judge.judge('Bring four shards to the door.', CELLAR_PAGES)).toBe(1);
  });

  it('uses the minimum of helpfulness and faithfulness as the final score', async () => {
    const scenario: GoldenScenario = {
      id: 'partial-helpfulness',
      question: 'Where is the cellar and what does its door need?',
      sources: CELLAR_PAGES,
      mode: 'answer',
      llmReply: 'The cellar lies behind the bakery.',
      expectedFacts: ['behind the bakery', 'no keyhole'],
    };
    const report = await runEval([scenario]);
    const r = report.reports[0];
    expect(r.helpfulness).toBe(0.5);
    expect(r.faithfulness).toBe(1);
    expect(r.finalScore).toBe(0.5);
    expect(r.pass).toBe(false);
  });

  it('passes the full golden scenario suite', async () => {
    const report = await runEval(GOLDEN_SCENARIOS);
    const byId = Object.fromEntries(report.reports.map(r => [r.id, r]));
    expect(byId['grounded-answer-high'].finalScore).toBe(1);
    expect(byId['confident-lie-low'].finalScore).toBe(0);
    expect(byId['uncovered-refusal'].finalScore).toBe(1);
    expect(byId['quantity-mismatch-dropped'].finalScore).toBe(1);
    expect(byId['hint-redacted'].finalScore).toBe(1);
    expect(report.passed).toBe(true);
    expect(report.average).toBeGreaterThan(0.8);
  });
});
```
Verify partial-helpfulness: reply "The cellar lies behind the bakery." — atoms zero → kept (supportedAtomCount 0 → wait! filter: zero atoms across answer → supportedAtomCount 0 → kept [] → REFUSAL!! Bug for this scenario: the reply has zero verifiable atoms → service refuses → helpfulness: isRefusal → 0 (expectRefusal false) → final 0 not 0.5. My test expectation is wrong.
Fix: make reply contain a grounded atom: "Weaken the Gravel Wretch. The cellar lies behind the bakery." → atoms: Gravel Wretch ✓ → kept both sentences → text = that. helpfulness: 'behind the bakery' ✓, 'no keyhole' ✗ → 0.5 ✓. Faithfulness: 1 atom grounded → 1.0 ✓. Final 0.5 ✓ pass false ✓.
Update scenario llmReply accordingly. Also this scenario tests mixed keep — good.

Hmm wait — but this exposes a design tension: a fully lowercase grounded reply (atomless) is refused. "The cellar lies behind the bakery." alone → refused even though true. Is that a spec violation? "drop ungrounded sentences or the service refuses" — a reply with zero verifiable claims = "not covered" from the gate's perspective → refusal is defensible (can't verify anything → treat as ungrounded). Document in a comment: a reply with zero verifiable atoms is treated as not covered. ✓ (I'll add comment in gate's filter and near the assumption.)

Recheck 'hint-redacted' scenario in harness: faithfulness on hint: atoms? "The cellar lies behind a hidden place." none; "Weaken the hidden name with a shard of glass." — entities: "Weaken" index 0 skipped; others lowercase ✓ none; "Several shards are required to seal the cellar door." — "Several" not word-number ✓ none. → 0 atoms → 1.0 ✓. Helpful: 3 facts ✓ 1.0. Final 1.0 ✓ pass ✓. planted check: hint normalized contains 'gravel wretch'? No; 'bakery'? No; 'four shards'? No ✓ (would return 0 but doesn't reach... wait judge order: isRefusal no → planted check → none → atoms → 1.0 ✓).

Verify 'quantity-mismatch-dropped' harness path: text "Four shards are required." ✓ final 1.0.

'grounded-answer-high' faithfulness: extractAtoms over full text: entities: sentence 1 "The" skipped → none; sentence 2 "Gravel Wretch" ✓ supported; sentence 3 "Four" index 0 skipped; quantity (4,shard) ✓ → atoms: [e:gravel wretch, q:4:shard] both supported → 1.0 ✓. Helpful: 'behind the bakery' ✓ 'gravel wretch' ✓ 'four shards are required' ✓ → 1.0 ✓.

'confident-lie-low' — wait, let me re-verify S1 entity extraction: "The cellar door opens with a Moonlight Shard." ENTITY_RE matches: "The" (index 0, followed by lowercase → match "The"), then "Moonlight Shard". "The" → words ["The"] → filter stopword → empty → skip ✓. "Moonlight Shard" → atom, value "moonlight shard" → blob? CELLAR_PAGES blob: "the gravel wretch is the guardian of the cellar. it can only be weakened by a shard of glass. four shards are required to seal the cellar door. the cellar lies behind the bakery. the door has no keyhole. shards of glass can be found in broken windows." — contains "moonlight shard"? No ✓ ungrounded.
S2: "You need five shards and the Rusted Key to proceed." — "You" index 0 single skipped ✓; "Rusted Key" atom → not in blob ✓ ungrounded; quantity: "five shards" → (5, shard): sourceQuantities: from page 1 "Four shards are required" → (4,shard); "a shard of glass" → 'a' not number; page 2 "Shards of glass" no number. → {shard:{4}}; 5 ∉ → ungrounded ✓. S2 ungrounded. Both dropped → refusal ✓.

'uncovered-refusal' S2: "A Rusted Key glows beside it." — "A Rusted Key": matchAll: at index 0 "A Rusted Key" (A, Rusted, Key all caps) → filter "A" (stopword) → ["Rusted","Key"] length 2 → atom ✓ → not in blob (blob has no "rusted") → ungrounded ✓ drop. "it." lowercase ✓. S1: "The Moonlight Shrine restores health." → "The Moonlight Shrine" → filter The → ["Moonlight","Shrine"] → "moonlight shrine" not in blob → drop ✓ → refusal ✓.

Now the harness 'finalScore' values — confident-lie: helpful 0 → min(0,1)=0 ✓.

average for full suite: (1+0+1+1+1)/5 = 0.8 → toBeGreaterThan(0.8)?? 0.8 > 0.8 is false! Fix: use >= 0.8 → `expect(report.average).toBeCloseTo(0.8)`. ✓

Now one more check — `runEval` filter by id returns array; reports[0] — fine. TS: reports[0] type ScenarioReport (noUncheckedIndexedAccess not enabled — my tsconfig doesn't enable it; strict only → default noUncheckedIndexedAccess false ✓).

Also in "final score is min" test I defined GoldenScenario inline — mode optional ✓, expectRefusal omitted ✓.

Now STOPWORDS — finalize the list, ensure 'the','a','an', 'you','i','we','it','he','she','they','is','are','was','were','be','been','and','or','to','of','in','on','at','with','by','for','from','as','not','no','do','does','did','can','will','would','should','shall','may','might','must','if','when','then','so','but','than','too','very','just','only','about','into','over','under','behind','before','after','against','between','out','up','down','off','once','here','there','where','what','which','who','whose','how','all','any','some','each','few','more','most','other','such','own','same','now','cannot','nor'.

IDIOMATIC_TAILS: way, kind, sort, hand, eye, heart, mind, place, position, time, game, side, front.

Note: unit 'door' — "4 door"?? not idiomatic → redact, fine.

Now — one more thing to double-check: the first alternative of QUANTITY_RE in redactor `\b\d{1,3}\b` and the second spell-out alternation with \b on both sides: `|\bone\b|...` I'll write the group as `(\b\d{1,3}\b|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b|\bseven\b|\beight\b|\bnine\b|\bten\b)` ✓.

Potential collision: "shards" as unit — plural; singularize both sides ✓ (atom unit singularized; allowed key singularized ✓; replacement keeps surface 'shards' ✓).

One subtle: redactor's QUANTITY_RE could match "shard of" after "a"? no — 'a' not a number ✓.

Also "glass" — "a shard of glass": quantity regex finds "glass"? Not a number ✓.

Now, redactLocations regex: `/\b(in|at|on|under|behind|inside|beyond|beside|near)\s+(?:(?:the|a|an)\s+)?([A-Za-z][a-z-]*)/gi` — check S1 "The cellar lies behind the bakery." → matches "behind the bakery" → group1 'behind', group2 'bakery' → not harmless/stopword → "behind a hidden place" ✓. Check "Weaken the hidden name with a shard of glass." — 'with' not in list ✓. Check "seal the cellar door" none ✓. Check hint test 2 reply: "Four shards are required to seal the cellar door." no prep ✓.
Danger: "in the answer"? 'answer' not harmless → redact → "in a hidden place" — hmm in a guide text "in the answer below" would break. Acceptable.
Also "on the ground" → harmless ✓. "at the end" ✓.
Wait 'at' — "at a hidden place" replacement preserves prep: `${prep} ${PLACE_PLACEHOLDER}` → "behind a hidden place" ✓.

Order concern: location redaction runs before names; LOCATION regex's group2 [A-Za-z] could capture "Gravel" in "in Gravel Hall" → "in a hidden place" and "Hall" left dangling: "in a hidden place Hall"?? "in the Gravel Hall": match "in the Gravel" → replaced → "in a hidden place Hall" — 'Hall' dangles. Then names: "Hall" single word not at start → atom... redact → "in a hidden place a hidden name". Ugh but rare. Accept (documented as lexical limitation? maybe one comment).

polish: capitalize first char: "behind..."? S1 starts with "The" already ✓. S3 "several" → "Several" ✓.

Now — does redactQuantities break the 'hidden name'/'hidden place' placeholders? No numbers ✓.

One more: after redaction, "several" in hint S3 — 'Several' capitalized at sentence start: in later faithfulness eval, "Several" would be single word at start → entity skipped ✓ good (if it were multi-word, problem; it's not).

Verify allowedQuantityKeys uses extractSentenceAtoms which needs unit non-stopword — question "I have four shards already." → "four shards" unit 'shards' ✓ key '4:shard' ✓.

Now package.json — vitest version: "^2.1.9"? Use "^2.1.0" and typescript "^5.5.4", @types/node "^20.14.0". pnpm fine.

tsconfig: module NodeNext + moduleResolution NodeNext; target ES2022; strict true; types: ["node"]? vitest provides its own; `types: ["node"]` safe. lib? target ES2022 lib default. Lookbehind in regexes is a runtime feature, fine.

Wait — with NodeNext, `.js` extension in imports in TS ✓ standard.

Do I need vitest.config.ts? No.

Also — "ESM, type: module" ✓ package.json.

Re-check `splitSentences` lookbehind in regex literal: `/ (?<=[.!?])\s+/` — I'll write `/(?<=[.!?])\s+/`. TS/esbuild support ✓ (esbuild targets... vitest uses esbuild with default target — lookbehind is ES2018 ✓).

Also, `matchAll` needs /g ✓.

Now potential TS strict issues:
- `m.index ?? 0` OK.
- replace callback params typed by signature — explicit annotation `(full: string, prep: string, word: string)` ✓.
- `entitySupported` etc. fine.
- In judges, `atoms.filter(...).length / atoms.length` ✓.
- `Object.fromEntries(report.reports.map(r => [r.id, r]))` → type Record<string, ScenarioReport> ✓ indexed access OK without noUncheckedIndexedAccess.

Edge: `expect(r.helpfulness).toBe(0.5)` — floating 0.5 exact ✓ (1/2). `toBe(0)` exact ✓. `toBe(1)` ✓ (2/2=1, 3/3=1, 1/1=1).

In 'partial-helpfulness' — helpfulness = 1/2 = 0.5 ✓ exact.

Now the "ASSUMPTION" comments:
1. Lexical gate scope (grounding-gate.ts header): gate verifies names and quantities lexically; cannot verify arbitrary paraphrased claims; a reply with zero verifiable atoms is treated as not covered → refusal.
2. Hint redaction (hint-redactor.ts): treats all proper-noun entities as secrets (can't classify boss vs item lexically → generic placeholder); item locations = objects of location prepositions; quantities = number+unit tokens, kept only when the same (quantity, unit) appears in the player's question.
3. Single capitalized word at sentence start treated as artifact (grounding-gate findEntities).
4. No bare-digit gating? That's inside the lexical scope note. Also no DB/NestJS — the task is a standalone pipeline; not a symbol-level assumption, more of a layout choice; skip comment? The "conventions" block lists NestJS stack but the task explicitly is pipeline + harness with fake LLM. I'll add one ASSUMPTION comment in answer-service or the header? "Use the most defensible reading and mark it" — add a note in answer.service.ts: `// ASSUMPTION: the task specifies a standalone pipeline + harness, so the service uses constructor DI rather than a NestJS module; no persistence is specified.` That's defensible.

Also `answer(question, sources, mode)` — method signature matches ✓.

Double-check `NOT_COVERED` sentinel regex: raw "NOT_COVERED" trimmed equals ✓. What if LLM says "I'm not covered by my sources." → /not\s+covered/i matches ✓ refusal.

Now — the "dropped or refuse" requirement: my service does both (drop ungrounded, refuse if nothing remains). ✓

Also "hint mode derived by redaction of the full grounded answer, not by re-prompting" ✓ (single LLM call, redact(gated)).

Files list:
1. package.json
2. tsconfig.json
3. src/answer/llm-client.ts
4. src/answer/refusal.ts
5. src/answer/grounding-gate.ts
6. src/answer/hint-redactor.ts
7. src/answer/answer-service.ts
8. src/eval/judges.ts
9. src/eval/eval-harness.ts
10. src/eval/golden-scenarios.ts
11. test/answer.service.spec.ts
12. test/hint.spec.ts
13. test/eval-harness.spec.ts

Conventions say `test/<feature>.spec.ts` — `test/answer.service.spec.ts`? The layout pattern shows `test/<feature>.spec.ts`. I'll keep `answer.service.spec.ts`, `hint.spec.ts`? To be safe with pattern: feature names: answer, hint, eval-harness. `test/hint.spec.ts` fits `test/<feature>.spec.ts` ✓. OK.

Now let me write grounding-gate.ts fully, careful:

```ts
/**
 * Sentence-level grounding gate.
 *
 * A sentence is grounded when every factual atom it carries is supported by
 * the source pages. Factual atoms are the checkable claims in a sentence:
 *
 *   - entity: proper-noun phrases ("Gravel Wretch", "Moonlight Shard")
 *   - quantity: number + unit pairs ("four shards", "5 keys")
 *
 * // ASSUMPTION: the gate is deliberately lexical and deterministic (no
 * // second LLM call). It verifies the two failure classes the product cares
 * // about — invented names and wrong counts — but it cannot semantically
 * // verify freely paraphrased plain prose. Sentences without any verifiable
 * // atoms are kept only if the rest of the answer contains grounded claims;
 * // an answer with zero verifiable atoms is treated as not covered and
 * // triggers a refusal.
 */

export type FactualAtom =
  | { kind: 'entity'; value: string }
  | { kind: 'quantity'; number: number; unit: string };

export interface SentenceVerdict {
  sentence: string;
  atoms: FactualAtom[];
  grounded: boolean;
}

export interface GroundingGate {
  assess(sentence: string, sources: string[]): SentenceVerdict;
  isAtomSupported(atom: FactualAtom, sources: string[]): boolean;
  /** Split a raw LLM answer into grounded (kept) and ungrounded (dropped) sentences. */
  filter(rawAnswer: string, sources: string[]): { kept: string[]; dropped: string[] };
}

export const STOPWORDS = new Set([ ... ]);

const IDIOMATIC_UNITS = new Set(['way','kind','sort','hand','eye','heart','mind','place','position','side','front']);

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

export function singularize(word: string): string {
  return word.endsWith('s') ? word.slice(0, -1) : word;
}

export function toNumber(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return WORD_NUMBERS[token.toLowerCase()] ?? null;
}

export const ENTITY_RE = /\b[A-Z][a-z]*(?:\s+[A-Z][a-z]*)*/g;
```
Hmm earlier I had [A-Z][a-zA-Z]* (allowing uppercase inside for acronyms) — either fine; keep `[A-Z][a-z]*` for simplicity.

```ts
export interface EntityMatch { raw: string; value: string; index: number; }

export function findEntities(sentence: string): EntityMatch[] {
  const matches: EntityMatch[] = [];
  for (const m of sentence.matchAll(ENTITY_RE)) {
    const words = m[0].split(' ').filter((w) => !STOPWORDS.has(w.toLowerCase()));
    if (words.length === 0) continue;
    // // ASSUMPTION: a single capitalized word in first position is treated as
    // a sentence-start artifact ("The door..."), not as a name.
    if (words.length === 1 && m.index === 0) continue;
    matches.push({ raw: m[0], value: normalize(words.join(' ')), index: m.index ?? 0 });
  }
  return matches;
}

const QUANTITY_RE = /(\b\d{1,3}\b|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b|\bseven\b|\beight\b|\bnine\b|\bten\b)(?:\s+([a-z][a-z-]*))?/gi;

export function extractQuantities(sentence: string): { number: number; unit: string }[] {
  const out: { number: number; unit: string }[] = [];
  for (const m of sentence.matchAll(QUANTITY_RE)) {
    const number = toNumber(m[1]);
    if (number === null) continue;
    const unit = m[2] ? m[2].toLowerCase() : null;
    // A unit that is a stopword/idiom ("five of them", "one way") carries no countable item.
    if (unit === null || STOPWORDS.has(unit) || IDIOMATIC_UNITS.has(unit)) continue;
    out.push({ number, unit: singularize(unit) });
  }
  return out;
}

function atomKey(atom: FactualAtom): string {
  return atom.kind === 'entity' ? `entity:${atom.value}` : `quantity:${atom.number}:${atom.unit}`;
}

export function extractSentenceAtoms(sentence: string): FactualAtom[] {
  const atoms: FactualAtom[] = [];
  for (const e of findEntities(sentence)) atoms.push({ kind: 'entity', value: e.value });
  for (const q of extractQuantities(sentence)) atoms.push({ kind: 'quantity', number: q.number, unit: q.unit });
  const seen = new Set<string>();
  return atoms.filter((a) => { const k = atomKey(a); if (seen.has(k)) return false; seen.add(k); return true; });
}

export function extractAtoms(text: string): FactualAtom[] {
  const atoms: FactualAtom[] = [];
  const seen = new Set<string>();
  for (const sentence of splitSentences(text)) {
    for (const a of extractSentenceAtoms(sentence)) {
      const k = atomKey(a);
      if (seen.has(k)) continue;
      seen.add(k);
      atoms.push(a);
    }
  }
  return atoms;
}

export function sourceQuantities(sources: string[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const sentence of splitSentences(sources.join('\n'))) {
    for (const a of extractSentenceAtoms(sentence)) {
      if (a.kind !== 'quantity') continue;
      const set = map.get(a.unit) ?? new Set<number>();
      set.add(a.number);
      map.set(a.unit, set);
    }
  }
  return map;
}

export function entitySupported(value: string, normalizedSourceBlob: string): boolean {
  return (
    normalizedSourceBlob.includes(value) ||
    normalizedSourceBlob.includes(`${value}s`) ||
    (value.endsWith('s') && normalizedSourceBlob.includes(value.slice(0, -1)))
  );
}

export class LexicalGroundingGate implements GroundingGate {
  assess(sentence: string, sources: string[]): SentenceVerdict {
    const atoms = extractSentenceAtoms(sentence);
    return { sentence, atoms, grounded: atoms.every((a) => this.isAtomSupported(a, sources)) };
  }

  isAtomSupported(atom: FactualAtom, sources: string[]): boolean {
    if (atom.kind === 'entity') {
      return entitySupported(atom.value, normalize(sources.join(' ')));
    }
    return (sourceQuantities(sources).get(atom.unit) ?? new Set<number>()).has(atom.number);
  }

  filter(rawAnswer: string, sources: string[]): { kept: string[]; dropped: string[] } {
    const kept: string[] = [];
    const dropped: string[] = [];
    let supportedAtomCount = 0;
    for (const sentence of splitSentences(rawAnswer)) {
      const verdict = this.assess(sentence, sources);
      if (verdict.grounded) {
        kept.push(sentence);
        supportedAtomCount += verdict.atoms.length;
      } else {
        dropped.push(sentence);
      }
    }
    // Nothing verifiable was supported: the answer is not covered by the sources.
    if (supportedAtomCount === 0) {
      return { kept: [], dropped: [...kept, ...dropped] };
    }
    return { kept, dropped };
  }
}
```

Wait — problem with `sourceQuantities` via `splitSentences(sources.join('\n'))` — join with '\n' then split on [.!?\s] — newlines are \s so boundaries OK ✓.

Check quantity "4" digit: "Four" spelled in source ✓; if source says "4 shards" → digit ✓ both fine.

Now potential issue: QUANTITY_RE digit alternative `\b\d{1,3}\b` followed by optional `\s+([a-z][a-z-]*)` — for "5 shards" in LIE ✓. Also "2-3 keys"? "2" then "-"... `\b\d{1,3}\b` matches "2", next char "-" is not \s → no unit → skip (bare) ✓ no crash.

Also spell-out "one" in "the one and only" → unit "and" stopword → skip ✓.

Now hint-redactor.ts:

```ts
import {
  IDIOMATIC_UNITS?
```
Wait I renamed to IDIOMATIC_UNITS. Also need STOPWORDS, singularize, toNumber, findEntities, splitSentences.

```ts
/**
 * Spoiler-free hint redaction.
 *
 * A hint is derived from the *already grounded* full answer; it never issues
 * a second LLM call. The redaction is lexical:
 *
 *   - boss names (and any other proper-noun entity) -> "the/a hidden name"
 *     // ASSUMPTION: without a name taxonomy we cannot lexically tell a boss
 *     name from a named item, so every proper-noun entity is redacted and a
 *     generic placeholder is used.
 *   - item locations (objects of location prepositions) -> "a hidden place"
 *   - quantities (number + unit) -> "several <unit>", unless the exact same
 *     quantity+unit already appears in the player's question (known to them).
 */

import {
  IDIOMATIC_UNITS,
  STOPWORDS,
  findEntities,
  singularize,
  splitSentences,
  toNumber,
  extractSentenceAtoms,
} from './grounding-gate.js';

export const NAME_PLACEHOLDER = 'hidden name';
export const PLACE_PLACEHOLDER = 'a hidden place';

const LOCATION_RE = /\b(in|at|on|under|behind|inside|beyond|beside|near)\s+(?:(?:the|a|an)\s+)?([A-Za-z][a-z-]*)/gi;
const HARMLESS_LOCATION_WORDS = new Set(['end','time','way','game','air','ground','cost','day','night','morning','evening','minute','hour','second','place','position','door','edge','line','side']);

const QUANTITY_RE = /(\b\d{1,3}\b|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b|\bseven\b|\beight\b|\bnine\b|\bten\b)(?:\s+([a-z][a-z-]*))?/gi;

function redactLocations(sentence: string): string {
  return sentence.replace(LOCATION_RE, (_full: string, prep: string, word: string) => {
    const w = word.toLowerCase();
    if (HARMLESS_LOCATION_WORDS.has(w) || STOPWORDS.has(w)) return _full;
    return `${prep} ${PLACE_PLACEHOLDER}`;
  });
}
```
Wait: STOPWORDS contains 'on','at','in'... word is the *object* noun, not a prep; stopwords as object: "in the it"? no. Fine.

Hmm — "at a hidden place" — PLACE_PLACEHOLDER includes article 'a' → "behind a hidden place" ✓ good.

```ts
function redactNames(sentence: string): string {
  const entities = findEntities(sentence);
  for (let i = entities.length - 1; i >= 0; i -= 1) {
    const e = entities[i];
    const before = sentence.slice(0, e.index);
    const precededByArticle = /(?:^|\s)(?:the|a|an)\s$/i.test(before);
    const replacement = precededByArticle ? `the ${NAME_PLACEHOLDER}` : `a ${NAME_PLACEHOLDER}`;
    sentence = `${before}${replacement}${sentence.slice(e.index + e.raw.length)}`;
  }
  return sentence;
}
```

```ts
function quantityKeysIn(text: string): Set<string> {
  const keys = new Set<string>();
  for (const sentence of splitSentences(text)) {
    for (const a of extractSentenceAtoms(sentence)) {
      if (a.kind === 'quantity') keys.add(`${a.number}:${a.unit}`);
    }
  }
  return keys;
}

function redactQuantities(sentence: string, playerKnown: Set<string>): string {
  return sentence.replace(QUANTITY_RE, (_full: string, numToken: string, unitToken?: string) => {
    const number = toNumber(numToken);
    if (number === null) return _full;
    if (unitToken === undefined || unitToken === null) return 'a few';
    const unit = unitToken.toLowerCase();
    if (IDIOMATIC_UNITS.has(unit)) return _full;
    if (STOPWORDS.has(unit)) return `a few ${unitToken}`;
    if (playerKnown.has(`${number}:${singularize(unit)}`)) return _full;
    return `several ${unitToken}`;
  });
}
```
TS: in replace callback, param type: (substring: string, ...args: any[]) — the extra params are any → typing `(unitToken?: string)` for any param is fine? TS lib defines replace(searchValue: string | RegExp, replacer: (substring: string, ...args: any[]) => string). Declared callback params get contextual types: substring: string, rest any. `(_full: string, numToken: string, unitToken?: string)` — numToken contextually any → annotated string ✓; unitToken any → annotated `string | undefined`... I wrote `unitToken?: string` → type string|undefined ✓ any assignable ✓.

Hmm — m[2] is undefined when group didn't participate → in the replace callback, non-participating groups become undefined ✓.

Edge: "ten" word followed by unit... fine.

Also: `return 'a few'` for bare number — replaces e.g. "5" → "a few". "wait 5" → "wait a few" ✓.

```ts
function capitalizeFirst(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function redactHint(fullAnswer: string, question: string): string {
  const playerKnown = quantityKeysIn(question);
  return splitSentences(fullAnswer)
    .map((sentence) => capitalizeFirst(redactQuantities(redactNames(redactLocations(sentence)), playerKnown)))
    .join(' ');
}
```

Verify: does redactNames run before redactQuantities in the order I map? I wrote redactQuantities(redactNames(redactLocations(...))) — locations → names → quantities ✓.

Now — verify main hint S2 again with location first: "Weaken the Gravel Wretch with a shard of glass." — LOCATION_RE: 'with' not in list ✓ no change. redactNames → "Weaken the hidden name with a shard of glass." ✓ quantities: none ✓.

S1: "The cellar lies behind the bakery." → location: "behind the bakery" → w='bakery' not harmless → "The cellar lies behind a hidden place." ✓ names: findEntities on result: "The" index 0 single skipped ✓ none. ✓.

Now answer-service.ts:

```ts
import { GroundingGate, LexicalGroundingGate } from './grounding-gate.js';
import { LlmClient } from './llm-client.js';
import { redactHint } from './hint-redactor.js';
import { LLM_REFUSAL_SENTINEL, NOT_COVERED_MESSAGE } from './refusal.js';

// // ASSUMPTION: the task is a standalone pipeline + eval harness (no API
// // surface, no persistence), so the service uses plain constructor
// // injection of the LLM client instead of a NestJS module; the client is
// // swappable for a scripted fake in tests and in the eval harness.

export type AnswerMode = 'answer' | 'hint';

export interface AnswerResult {
  mode: AnswerMode;
  /** The answer (or refusal message) shown to the player. */
  text: string;
  refusal: boolean;
  /** Sentences dropped by the grounding gate. */
  droppedSentences: string[];
  /** Hint mode only: the grounded full answer the hint was redacted from. */
  fullAnswer?: string;
}

export class AnswerService {
  constructor(
    private readonly llm: LlmClient,
    private readonly gate: GroundingGate = new LexicalGroundingGate(),
  ) {}

  async answer(question: string, sources: string[], mode: AnswerMode = 'answer'): Promise<AnswerResult> {
    const raw = (await this.llm.complete(this.buildPrompt(question, sources))).text;

    if (this.llmSaidNotCovered(raw)) {
      return this.refusal(mode);
    }

    const { kept, dropped } = this.gate.filter(raw, sources);
    if (kept.length === 0) {
      return this.refusal(mode);
    }

    const fullAnswer = kept.join(' ');
    if (mode === 'hint') {
      return {
        mode,
        text: redactHint(fullAnswer, question),
        refusal: false,
        droppedSentences: dropped,
        fullAnswer,
      };
    }
    return { mode, text: fullAnswer, refusal: false, droppedSentences: dropped };
  }

  private refusal(mode: AnswerMode): AnswerResult {
    return { mode, text: NOT_COVERED_MESSAGE, refusal: true, droppedSentences: [] };
  }

  private llmSaidNotCovered(raw: string): boolean {
    return raw.trim() === LLM_REFUSAL_SENTINEL || /not\s+covered/i.test(raw);
  }

  private buildPrompt(question: string, sources: string[]): LlmRequest {
    ...
  }
}
```
Need to import LlmRequest type. ✓

refusal.ts:
```ts
/** Exact refusal message the service returns when sources do not cover the question. */
export const NOT_COVERED_MESSAGE = 'not covered by my sources';
/** Token the LLM is instructed to reply with when the pages lack the answer. */
export const LLM_REFUSAL_SENTINEL = 'NOT_COVERED';

export function isRefusal(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === NOT_COVERED_MESSAGE || t === LLM_REFUSAL_SENTINEL.toLowerCase();
}
```

llm-client.ts:
```ts
/** Transport-agnostic LLM boundary; a scripted fake plugs in for evals and tests. */
export interface LlmRequest {
  system: string;
  prompt: string;
}

export interface LlmCompletion {
  text: string;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmCompletion>;
}

/** Deterministic fake: returns a scripted reply and records every request. */
export class ScriptedLlmClient implements LlmClient {
  readonly calls: LlmRequest[] = [];

  constructor(private readonly reply: (request: LlmRequest) => string) {}

  static fromText(text: string): ScriptedLlmClient {
    return new ScriptedLlmClient(() => text);
  }

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    this.calls.push(request);
    return { text: this.reply(request) };
  }
}
```

judges.ts:
```ts
import { GroundingGate, LexicalGroundingGate, extractAtoms } from '../answer/grounding-gate.js';
import { isRefusal, normalize?? }
```
normalize is from grounding-gate ✓.

```ts
/**
 * Faithfulness: does the answer say only what the sources support?
 * Refusals are vacuously faithful; a planted false fact that survives in the
 * text is a hard zero; otherwise the score is the fraction of factual atoms
 * supported by the sources.
 */
export class FaithfulnessJudge {
  constructor(private readonly gate: GroundingGate = new LexicalGroundingGate()) {}

  judge(answer: string, sources: string[], options: { plantedFalseFacts?: string[] } = {}): number {
    if (isRefusal(answer)) return 1;
    const lowered = normalize(answer);
    for (const planted of options.plantedFalseFacts ?? []) {
      if (lowered.includes(normalize(planted))) return 0;
    }
    const atoms = extractAtoms(answer);
    if (atoms.length === 0) return 1;
    const supported = atoms.filter((a) => this.gate.isAtomSupported(a, sources)).length;
    return supported / atoms.length;
  }
}

/**
 * Helpfulness: does the answer deliver the golden facts?
 * A scenario that expects a refusal scores 1 only when the service refused.
 */
export class HelpfulnessJudge {
  judge(answer: string, spec: { expectedFacts: string[]; expectRefusal?: boolean }): number {
    if (spec.expectRefusal) return isRefusal(answer) ? 1 : 0;
    if (isRefusal(answer)) return 0;
    const total = spec.expectedFacts.length;
    if (total === 0) return 0;
    const lowered = normalize(answer);
    const hits = spec.expectedFacts.filter((f) => lowered.includes(normalize(f))).length;
    return hits / total;
  }
}
```

eval-harness.ts as sketched. Also add a convenience `describeReport`? no — discipline.

Now, `isRefusal` imported in judges from '../answer/refusal.js' ✓.

golden-scenarios.ts:
```ts
import type { GoldenScenario } from './eval-harness.js';

/** Wiki page fixtures shared by the scenarios. */
export const CELLAR_PAGES = [
  'The Gravel Wretch is the guardian of the cellar. It can only be weakened by a shard of glass. Four shards are required to seal the cellar door.',
  'The cellar lies behind the bakery. The door has no keyhole. Shards of glass can be found in broken windows.',
];

export const GROUNDING_REPLY?
```
I'll just keep the array as designed. Also export GROUNDED_REPLY constant for reuse in tests? Tests could import from golden-scenarios for consistency: `GROUNDED_REPLY` and `CONFIDENT_LIE_REPLY`. Yes — DRY: tests import from golden-scenarios.

```ts
export const GROUNDED_REPLY =
  'The cellar lies behind the bakery. Weaken the Gravel Wretch with a shard of glass. Four shards are required to seal the cellar door.';

export const CONFIDENT_LIE_REPLY =
  'The cellar door opens with a Moonlight Shard. You need five shards and the Rusted Key to proceed.';
```

Scenario 5 hint llmReply: GROUNDED_REPLY.

Final golden scenarios (5) as above.

Now — one more verification: `uncovered-refusal` scenario: expectRefusal true, expectedFacts []. Helpful: isRefusal(refusal text) → 1 ✓. Faithful: isRefusal → 1 ✓ final 1 ✓.

Also — wait, in 'confident-lie-low', is the planted check even relevant? text is refusal → returns 1 before planted check ✓ fine.

Full suite average: 0.8 exactly → toBeCloseTo(0.8) ✓. passed: all pass? confident-lie pass=false!! `report.passed = reports.every(r => r.pass)` → false! My full-suite test asserts `report.passed).toBe(true)` — wrong: the suite intentionally contains a failing scenario (the lie must score low → fail). The meaning of passed is "all scenarios met threshold" — the lie scenario correctly fails eval. So I'll assert `report.passed).toBe(false)`? That seems weird as a "pass the full golden scenario suite." Hmm.

Rethink: the meaning of a scenario's "pass": the golden scenario encodes expected behavior. For confident-lie, the expected behavior is a low score. So a scenario "passes" when the observed score matches the expectation, not when score ≥ threshold. Better: add optional `expectation: 'high' | 'low'`? Or per-scenario `minScore`/`maxScore`? Cleaner: keep `pass = finalScore >= threshold` as "eval pass" but in the full-suite test don't assert `passed` true; instead assert per-id scores. Or redefine: GoldenScenario has optional `expectRefusal` and a pass criterion = score matches band? Simplest and defensible: keep per-report `pass` = finalScore ≥ threshold (a quality gate), and in the full-suite test assert per-id finalScores and not assert `passed`. But `passed` would be false due to the intentional-failure scenario — a confusing API.

Alternative: make the lie scenario an eval "negative case" — eval harness's job is to score; whether it passes is up to the caller. I'll keep `passed` (all ≥ threshold) but the full suite contains a case we know fails... then `passed: false` is correct behavior — the eval correctly flags the lie. But the "full golden scenario suite" containing an intentional failure → passed=false is by design: the suite demonstrates detection. In the test I'll assert each score and that the lie report's pass===false and others pass===true. That's a crisp statement: the harness flags exactly the lie. Let me do that:

```ts
expect(byId['confident-lie-low'].pass).toBe(false);
for (const id of ['grounded-answer-high','uncovered-refusal','quantity-mismatch-dropped','hint-redacted']) expect(byId[id].pass).toBe(true);
expect(report.passed).toBe(false); // only the planted-lie scenario fails, by design
```
✓ clean.

Also double-check 'uncovered-refusal' pass: final 1 ≥ .75 ✓ true.

Now, "quantity errors caught exactly" is also demonstrated in the pipeline (quantity-mismatch-dropped) ✓ and the direct judge 5→0/4→1 ✓.

Let me also reconsider whether dropping "Bring five shards to the door." is correct given sentence S1 is grounded: yes mixed behavior ✓.

Also — LIE_REPLY sentence 2: "You need five shards and the Rusted Key to proceed." — quantity regex: "five shards" → (5,shards) ✓; also "and the Rusted Key" fine.

Now — LIE_REPLY S1 also has "Moonlight Shard" — "The cellar door opens with a Moonlight Shard." — ENTITY_RE: "The" (index 0), "Moonlight Shard" ✓.

Hmm wait — one more: entity "Moonlight Shard" value "moonlight shard" — entitySupported checks blob.includes('moonlight shard') → false; 'moonlight shards' false; value doesn't end 's' → false ✓ ungrounded.

Also verify S1 is ungrounded overall → drop ✓ (need every to be supported; entity fails) ✓.

Now — GROUNDED_REPLY S3: "Four shards are required to seal the cellar door." — QUANTITY_RE: "Four shards" ✓ (4, shard). Also "door" — no.
Also verify no spurious entity: "Four" index 0 single skipped ✓.

CELLAR_PAGES page 2 first sentence: "The cellar lies behind the bakery." — in sourceQuantities: entities: "The" skipped; no quantity ✓. Page 1: "Four shards are required to seal the cellar door." → (4,shard) ✓; "The Gravel Wretch is the guardian..." entities: "The" skipped; "Gravel Wretch" ✓ (irrelevant for quantities). "It can only be weakened by a shard of glass." — "It" index 0 single skipped ✓; no quantity ('a' not number) ✓.

So sourceQuantities = { shard: {4} } ✓.

Now — helpfulness 'four shards are required' normalized vs reply "Four shards are required to seal the cellar door." normalized contains ✓.

Hint scenario expectedFacts: ['several shards are required','a hidden place','a hidden name'] — hint = "The cellar lies behind a hidden place. Weaken the hidden name with a shard of glass. Several shards are required to seal the cellar door." → contains all ✓ (normalized: 'a hidden place' ✓, 'a hidden name'? text has "the hidden name" — contains 'a hidden name'?? "the hidden name" — substring 'a hidden name'? t-h-e space h... "he hidden name" — 'a hidden name' needs 'a ' before 'hidden'. "Weaken the hidden name" → substring: "n the hidden name" — no 'a hidden name'!! Bug in my expectedFact. Fix expectedFacts to ['several shards are required','a hidden place','hidden name'] → 'hidden name' substring ✓.

Wait let me verify 'hidden place' too: "behind a hidden place" → 'a hidden place' ✓ but I'll use 'hidden place' to be safe. I'll set ['several shards are required', 'hidden place', 'hidden name'] ✓ all substrings ✓.

And test/hint.spec.ts assertion `toContain('the hidden name')` ✓ text has it.

Now — redactNames on S2: findEntities("Weaken the Gravel Wretch with a shard of glass."):
matchAll: "Weaken" (index 0) → words ["Weaken"] length 1 at 0 → skipped ✓. "Gravel Wretch" ✓ index 14? whatever. before = "Weaken the " → precededByArticle regex /(?:^|\s)(?:the|a|an)\s$/i on "Weaken the " → matches " the " at end ✓ → replacement "the hidden name" → "Weaken the hidden name with a shard of glass." ✓.

quantities: none ✓. polish: starts with 'W' ✓.

S3: "Four shards are required to seal the cellar door." → location: preps? none ('to' not in list) ✓. names: "Four" index 0 single skipped ✓. quantities: "Four shards" → number 4, unit 'shards'; playerKnown for QUESTION 'How do I get past the cellar door?' → keys: any quantities? no digits/spell-out... "four"? none ✓ → not known → `several shards` → "several shards are required to seal the cellar door." → polish → "Several shards are required to seal the cellar door." ✓.

Final hint: "The cellar lies behind a hidden place. Weaken the hidden name with a shard of glass. Several shards are required to seal the cellar door." ✓ matches expectations; no digits ✓; no 'four' case-insensitive ✓; no 'bakery' ✓; no 'Gravel Wretch' ✓.

Player-known test: question "I have four shards already. What now?" → quantityKeysIn: split → ["I have four shards already.","What now?"] → atoms: "I" skipped; (4,shard) ✓ → key '4:shard'. Reply "Four shards are required to seal the cellar door." → hint: location none; names: "Four" skipped; quantities: 'four'+'shards' → known '4:shard' ✓ → keep original "Four shards" → text "Four shards are required to seal the cellar door." → contains 'Four shards are required' ✓.

Wait — reply is single sentence; is it grounded? Atoms: (4,shard) ∈ source {shard:{4}} ✓ → kept ✓.

Also note: reply for that test "Four shards are required to seal the cellar door." — grounded ✓ (4 supported).

Now the "derived, not re-prompted" test: uses one ScriptedLlmClient; after hint answer, calls length 1 ✓. Then second service with new client for answer text ✓. hint.fullAnswer === answerText ✓ (both = GROUNDED_REPLY exactly, since all sentences kept and join reproduces it).
Verify join reproduces: split of GROUNDED_REPLY: ["The cellar lies behind the bakery.","Weaken the Gravel Wretch with a shard of glass.","Four shards are required to seal the cellar door."] join(' ') === original ✓ (original has single spaces between).

Also `hint.text !== answerText` ✓.

Now the "refuses in hint mode" test: LIE_REPLY → gate filter: all dropped, supportedAtomCount 0 → kept [] → refusal(mode='hint') → text NOT_COVERED ✓ refusal true ✓.

Now — service.answer with mode 'hint' and kept nonempty but redactHint... fine.

Vitest imports: describe/expect/it ✓.

tsconfig "types": ["node"]? Without, global Node types absent — I don't use Node APIs... `Number`, `Set` fine. vitest globals? I'll import explicitly ✓. Skip "types".

Also `"strict": true` covers strictNullChecks etc. `m.index ?? 0` — RegExpMatchArray index? matchAll yields RegExpExecArray-like with index: number ✓ (typed as number in ES2020 lib). Actually RegExpMatchArray.index?: number? For matchAll the iterator returns RegExpMatchArray with index: number? Lib def: matchAll returns Iterator<RegExpMatchArray>; RegExpMatchArray has `index?: number`?? Hmm: RegExpMatchArray extends Array<string> and has index: number and input: string in lib.es2015? Let me recall: `interface RegExpMatchArray extends Array<string> { index?: number; input?: string; }` — I think index is optional? In newer lib: `interface RegExpMatchArray extends Array<string> { index: number; input: string; }`? TS lib es5.d.ts:
```
interface RegExpMatchArray extends Array<string> {
    index?: number;
    input?: string;
}
```
I recall it being optional (with `?`). My `m.index ?? 0` handles both ✓ safe.

Also `.filter` with side-effecting callback — fine.

Another design point — the task: "helpfulness judge and faithfulness judge that receives the sources; final score = min of the two" ✓ implemented in harness.

"A sentence-level grounding gate where ungrounded sentences are dropped OR the service refuses" ✓ both behaviors present (drop + refuse when nothing remains).

Also let me re-check the ENTITY_RE word boundary with hyphens etc. Fine.

Potential subtle bug: QUANTITY_RE with /gi and `sentence.matchAll` — matchAll requires /g ✓.

In redactQuantities, the callback receives groups: for "Four shards": group1 'Four', group2 'shards' ✓. For "5" alone: group1 '5', group2 undefined ✓.

Edge: "25 keys" → \d{1,3} '25' ✓.

Edge: "4 shards." (period) → 'shards' then '.' → [a-z-]* stops at '.' ✓ 'shards' ✓.

Now let me also verify 'quantity-mismatch-dropped' gate S2: "Bring five shards to the door." — entities: "Bring" index 0 skipped ✓; quantity (5,shard): {shard:{4}} → 5 ∉ → ungrounded → drop ✓. S1 "Four shards are required." atoms: (4,shard) ✓ → kept, count 1 > 0 ✓. Result kept ["Four shards are required."] ✓ dropped ["Bring five shards to the door."] ✓ text "Four shards are required." ✓.

Direct judge: judge('Bring five shards to the door.', CELLAR_PAGES) → not refusal; no planted; atoms: (5,shard) → unsupported → 0/1 = 0 ✓. judge('Bring four shards to the door.') → (4,shard) ✓ → 1 ✓.

Partial-helpfulness scenario: reply "Weaken the Gravel Wretch. The cellar lies behind the bakery." — S1 atoms: "Weaken" skipped; "Gravel Wretch" ✓ grounded. S2 atomless → grounded vacuously ✓ kept (count 1>0) ✓. Text = full. Helpful: expectedFacts ['behind the bakery' ✓, 'no keyhole' ✗] → 0.5 ✓. Faithful: atoms [gravel wretch] supported → 1 ✓. Final 0.5, pass false ✓.

Wait 'no keyhole' — not in reply ✓ 0.5 exact ✓.

Now — package.json test script "vitest run" ✓. Also "build"? no; noEmit.

Also — should I include a README? "Don't create files the task doesn't call for" → skip.

Also double-check `eval-harness.ts` — imports: AnswerService, AnswerMode from '../answer/answer-service.js'; LlmClient, ScriptedLlmClient; judges. Types GoldenScenario/ScenarioReport/EvalReport. DEFAULT_PASS_THRESHOLD = 0.75.

In the test "uses the minimum..." — runEval([scenario]) default threshold 0.75 → pass false ✓.

Also `helpfulness).toBe(0.5)` — 1/2 float exact ✓. `faithfulness).toBe(1)` — 1/1 ✓.

Now, one concern: `HelpfulnessJudge.judge` — scenario 'grounded-answer-high' expectedFacts includes 'gravel wretch' — normalized reply contains "the gravel wretch" ✓.

All checked. Also verify no circular imports: golden-scenarios imports type from eval-harness (type-only ✓); tests import both — fine, no cycle (type imports are erased).

Also — convention "Code and comments in English" ✓. "Class names PascalCase" ✓ (AnswerService, LexicalGroundingGate, FaithfulnessJudge, HelpfulnessJudge, ScriptedLlmClient). "Endpoints kebab-case" N/A. "snake_case for table/columns" N/A.

Naming: files kebab-case.role.ts — answer.service.ts ✓; others: llm-client.ts (no role — acceptable as shared module), grounding-gate.ts, hint-redactor.ts, refusal.ts, judges.ts, eval-harness.ts, golden-scenarios.ts. Fine.

One more consideration: the prompt says "sentence-level grounding gate" — my gate: sentence-level ✓.

Also, `answer()` parameter order (question, sources, mode) exactly as task ✓.

Now let me finalize STOPWORDS list (lowercase):
['the','a','an','this','that','these','those','you','your','i','we','it','he','she','they','is','are','was','were','be','been','being','and','or','to','of','in','on','at','with','by','for','from','as','not','no','nor','do','does','did','can','could','cannot','will','would','should','shall','may','might','must','if','when','then','so','but','than','too','very','just','only','about','into','over','under','behind','before','after','against','between','out','up','down','off','once','here','there','where','what','which','who','whom','whose','how','all','any','some','each','few','more','most','other','such','own','same','now']

Check: unit guard uses STOPWORDS — 'door'? not in stopword list → "4 door" redacted to 'several door' — fine, nonsense input.

LOCATION_RE stopword object check: 'it' in STOPWORDS ✓ ("beside it" kept — "A Rusted Key glows beside it" is dropped as ungrounded anyway).

Now let me write the final files. Also a small detail: `answer-service.ts` imports the LlmRequest type from llm-client ✓.

Also `hint-redactor.ts` — imports extractSentenceAtoms ✓ used in quantityKeysIn ✓.

Also — in redactLocations I use `STOPWORDS.has(w)`: 'it' ✓, also 'here' etc. ✓.

Also PLACE: "at a hidden place" — for prep 'at' ✓ `${prep} ${PLACE_PLACEHOLDER}` = "at a hidden place" ✓.

Verify polish on S1: "The cellar..." capital T already ✓ charAt(0).toUpperCase() is a no-op ✓.

Potential issue: capitalizeFirst on empty string? splitSentences filters empty ✓.

Now the tsconfig include test + src ✓. Vitest resolves TS out of the box ✓.

package.json:
```json
{
  "name": "grounded-game-guide",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.5.4",
    "vitest": "^2.1.9"
  }
}
```

Now let me assemble all the final file contents and rescan for TS strictness:

1. `entities.length - 1; i >= 0; i -= 1` fine.
2. `private readonly reply: (request: LlmRequest) => string` — used ✓.
3. In judge: `options.plantedFalseFacts ?? []` ✓.
4. `atomKey` used in extractSentenceAtoms filter ✓.
5. `findEntities` — m[0] split(' ') — regex ensures single-space groups ✓.
6. eval-harness: `const mode = scenario.mode ?? 'answer';` ✓; `new AnswerService(makeLlm(scenario))` — gate default ✓.
7. `reports.every(r => r.pass)` ✓.

Also `ScenarioReport` should include a `description`? No.

Edge in test: `Object.fromEntries(...)` typed as Record<string, ScenarioReport> — `byId['x'].finalScore` ✓ (no noUncheckedIndexedAccess).

I think I'm done. Let me also add a file header comment on eval-harness explaining score = min.

One more thing: the task says "eval harness: golden scenarios (question, sources, expected facts, planted false facts like invented item requirements)" — my GoldenScenario has all: question ✓ sources ✓ expectedFacts ✓ plantedFalseFacts ✓ (+ llmReply, mode, expectRefusal). Planted false facts are actually planted in llmReply (lie reply contains Moonlight Shard, etc.) and listed for the judge ✓.

Let me write it out. Also keep prose between blocks to nothing (instruction: keep it to nothing; "start with the first heading"). So output = headings + fenced blocks only.

Order: package.json, tsconfig.json, src/answer/llm-client.ts, src/answer/refusal.ts, src/answer/grounding-gate.ts, src/answer/hint-redactor.ts, src/answer/answer-service.ts, src/eval/judges.ts, src/eval/eval-harness.ts, src/eval/golden-scenarios.ts, test/answer.service.spec.ts, test/hint.spec.ts, test/eval-harness.spec.ts.

Let me write out the grounding-gate STOPWORDS array in full.

Also note: `IDIOMATIC_UNITS` exported and used in hint-redactor ✓ (not needed elsewhere but I'll export for symmetry).

Final check on redactQuantities replacement for stopword unit: `a few ${unitToken}` — e.g., "5 of" → "a few of" ✓.

Also bare 'a few' replaces the token in the sentence: "You need 5." → "You need a few." ✓.

Also — wait, one more scenario detail: 'confident-lie-low' expectedFacts: ['gravel wretch','four shards'] — helpfulness on refusal = 0 regardless ✓.

And in 'grounded-answer-high', plantedFalseFacts ['moonlight shard','rusted key','five shards'] — grounded reply contains none ✓ → judge proceeds to atoms → 1.0 ✓. ('four shards' is in reply but not planted ✓; 'five shards' — does reply contain 'five shards'? No ✓.)

Note: 'five shards' in normalized grounded reply? "Four shards are required..." no 'five' ✓.

Hmm, one more thing: planted check in FaithfulnessJudge `lowered.includes(normalize(planted))` — 'five shards' normalized 'five shards' ✓.

OK — also `isRefusal('not covered by my sources')` ✓ exact match.

Let me also re-verify the `llmSaidNotCovered` on GROUNDED_REPLY: /not\s+covered/i — does GROUNDED_REPLY contain "not covered"? "Four shards are required to seal the cellar door." no ✓. LIE no ✓.

Also the sentinel check `raw.trim() === 'NOT_COVERED'` ✓ test 3.

Now let me write the final answer blocks. Careful with formatting: heading line `### path`, then a fenced block with language tag, only content.

Actually one more reconsideration: should `answer` handle `sources` empty → refusal? gate.filter with empty sources: any entity unsupported, quantity unsupported → likely refusal ✓ naturally.

And `splitSentences` on text without punctuation → single sentence ✓.

Ready. Let me write it out.

Wait, one more possible TS gripe: `const QUANTITY_RE = /(...)|(\bten\b)/gi;` — the alternation group: `(\b\d{1,3}\b|\bone\b|...)` ✓.

In `extractQuantities`, `m[2] ? m[2].toLowerCase() : null` — m[2] is string|undefined; truthy check ✓.

In `redactQuantities` replace callback: params `(_full: string, numToken: string, unitToken?: string)` — TS: replacer signature `(substring: string, ...args: any[])` → extra params are any; annotating as `string` OK; `unitToken?: string` — is it allowed to annotate an any param with `string | undefined`? The param is contextually `any`; explicit annotation `unitToken?: string` is permitted (any → assignable to any annotation) ✓.

`toNumber(numToken)` numToken is string ✓.

Also `entitySupported` parameter name fine.

In answer-service, unused import LlmRequest? Used in buildPrompt return type ✓.

eval-harness: `import { AnswerService, type AnswerMode } from '../answer/answer-service.js';` — mixed import ✓ (verbatimModuleSyntax not set; inline type OK in TS 5 ✓).

Tests import constants from golden-scenarios: GROUNDED_REPLY, CONFIDENT_LIE_REPLY, CELLAR_PAGES, GOLDEN_SCENARIOS ✓ all exported.

In test/answer.service.spec.ts I also import NOT_COVERED_MESSAGE ✓.

Let me also reconsider the `droppedSentences` assertion in the exact-quantity test: dropped = ['Bring five shards to the door.'] — exact string from split ✓ (sentence keeps its period) ✓.

And the `result.text).toBe('Four shards are required.')` ✓.

Also — GROUNDED_REPLY test asserts `result.text).toBe(GROUNDED_REPLY)` — kept.join(' ') must equal exactly ✓ verified.

Time to output. No prose outside the pattern.
</think>

### package.json
```json
{
  "name": "grounded-game-guide",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
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
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2022"]
  },
  "include": ["src", "test"]
}
```

### src/answer/llm-client.ts
```ts
/**
 * Transport-agnostic LLM boundary. Any implementation (a real provider
 * client, or the scripted fake below) can be injected into AnswerService.
 */

export interface LlmRequest {
  system: string;
  prompt: string;
}

export interface LlmCompletion {
  text: string;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmCompletion>;
}

/** Deterministic fake: returns a scripted reply and records every request. */
export class ScriptedLlmClient implements LlmClient {
  readonly calls: LlmRequest[] = [];

  constructor(private readonly reply: (request: LlmRequest) => string) {}

  static fromText(text: string): ScriptedLlmClient {
    return new ScriptedLlmClient(() => text);
  }

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    this.calls.push(request);
    return { text: this.reply(request) };
  }
}
```

### src/answer/refusal.ts
```ts
/** Exact refusal message returned when the sources do not cover the question. */
export const NOT_COVERED_MESSAGE = 'not covered by my sources';

/** Token the LLM is instructed to reply with when the pages lack the answer. */
export const LLM_REFUSAL_SENTINEL = 'NOT_COVERED';

export function isRefusal(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return trimmed === NOT_COVERED_MESSAGE || trimmed === LLM_REFUSAL_SENTINEL.toLowerCase();
}
```

### src/answer/grounding-gate.ts
```ts
/**
 * Sentence-level grounding gate.
 *
 * A sentence is grounded when every factual atom it carries is supported by
 * the source pages. Factual atoms are the checkable claims in a sentence:
 *
 *   - entity:   proper-noun phrases ("Gravel Wretch", "Moonlight Shard")
 *   - quantity: number + unit pairs ("four shards", "5 keys")
 *
 * // ASSUMPTION: the gate is deliberately lexical and deterministic (no second
 * // LLM call). It verifies the two failure classes the product cares about —
 * // invented names and wrong counts — but cannot semantically verify freely
 * // paraphrased plain prose. A sentence with no verifiable atoms is kept only
 * // if the rest of the answer contains grounded claims; an answer with zero
 * // verifiable atoms is treated as "not covered" and triggers a refusal.
 */

export type FactualAtom =
  | { kind: 'entity'; value: string }
  | { kind: 'quantity'; number: number; unit: string };

export interface SentenceVerdict {
  sentence: string;
  atoms: FactualAtom[];
  grounded: boolean;
}

export interface GroundingGate {
  assess(sentence: string, sources: string[]): SentenceVerdict;
  isAtomSupported(atom: FactualAtom, sources: string[]): boolean;
  /** Splits a raw LLM answer into grounded (kept) and ungrounded (dropped) sentences. */
  filter(rawAnswer: string, sources: string[]): { kept: string[]; dropped: string[] };
}

export const STOPWORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those',
  'you', 'your', 'i', 'we', 'it', 'he', 'she', 'they',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'and', 'or', 'to', 'of', 'in', 'on', 'at', 'with', 'by', 'for', 'from', 'as',
  'not', 'no', 'nor',
  'do', 'does', 'did', 'can', 'could', 'cannot',
  'will', 'would', 'should', 'shall', 'may', 'might', 'must',
  'if', 'when', 'then', 'so', 'but', 'than', 'too',
  'very', 'just', 'only', 'about',
  'into', 'over', 'under', 'behind', 'before', 'after', 'against', 'between',
  'out', 'up', 'down', 'off', 'once',
  'here', 'there', 'where', 'what', 'which', 'who', 'whom', 'whose', 'how',
  'all', 'any', 'some', 'each', 'few', 'more', 'most', 'other', 'such', 'own', 'same', 'now',
]);

/** Words that follow number words idiomatically ("one way", "a kind of") and are not items. */
export const IDIOMATIC_UNITS = new Set([
  'way', 'kind', 'sort', 'hand', 'eye', 'heart', 'mind',
  'place', 'position', 'side', 'front',
]);

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export function singularize(word: string): string {
  return word.endsWith('s') ? word.slice(0, -1) : word;
}

export function toNumber(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return WORD_NUMBERS[token.toLowerCase()] ?? null;
}

const ENTITY_RE = /\b[A-Z][a-z]*(?:\s+[A-Z][a-z]*)*/g;

const QUANTITY_RE =
  /(\b\d{1,3}\b|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b|\bseven\b|\beight\b|\bnine\b|\bten\b)(?:\s+([a-z][a-z-]*))?/gi;

export interface EntityMatch {
  raw: string;
  value: string;
  index: number;
}

export function findEntities(sentence: string): EntityMatch[] {
  const matches: EntityMatch[] = [];
  for (const match of sentence.matchAll(ENTITY_RE)) {
    const words = match[0].split(' ').filter((word) => !STOPWORDS.has(word.toLowerCase()));
    if (words.length === 0) continue;
    // ASSUMPTION: a single capitalized word in first position is treated as a
    // sentence-start artifact ("The door..."), not as a name; multi-word
    // capitalized phrases at the start ("Moonlight Shard ...") are still names.
    if (words.length === 1 && match.index === 0) continue;
    matches.push({
      raw: match[0],
      value: normalize(words.join(' ')),
      index: match.index ?? 0,
    });
  }
  return matches;
}

export function extractQuantities(sentence: string): { number: number; unit: string }[] {
  const quantities: { number: number; unit: string }[] = [];
  for (const match of sentence.matchAll(QUANTITY_RE)) {
    const number = toNumber(match[1]);
    if (number === null) continue;
    const unit = match[2] ? match[2].toLowerCase() : null;
    // A "unit" that is a stopword or idiom ("five of them", "one way") does
    // not name a countable item; bare numbers carry no checkable unit.
    if (unit === null || STOPWORDS.has(unit) || IDIOMATIC_UNITS.has(unit)) continue;
    quantities.push({ number, unit: singularize(unit) });
  }
  return quantities;
}

function atomKey(atom: FactualAtom): string {
  return atom.kind === 'entity' ? `entity:${atom.value}` : `quantity:${atom.number}:${atom.unit}`;
}

export function extractSentenceAtoms(sentence: string): FactualAtom[] {
  const atoms: FactualAtom[] = [];
  for (const entity of findEntities(sentence)) {
    atoms.push({ kind: 'entity', value: entity.value });
  }
  for (const quantity of extractQuantities(sentence)) {
    atoms.push({ kind: 'quantity', number: quantity.number, unit: quantity.unit });
  }
  const seen = new Set<string>();
  return atoms.filter((atom) => {
    const key = atomKey(atom);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractAtoms(text: string): FactualAtom[] {
  const atoms: FactualAtom[] = [];
  const seen = new Set<string>();
  for (const sentence of splitSentences(text)) {
    for (const atom of extractSentenceAtoms(sentence)) {
      const key = atomKey(atom);
      if (seen.has(key)) continue;
      seen.add(key);
      atoms.push(atom);
    }
  }
  return atoms;
}

/** All (unit -> set of numbers) pairs the sources assert, e.g. shard -> {4}. */
export function sourceQuantities(sources: string[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const sentence of splitSentences(sources.join('\n'))) {
    for (const atom of extractSentenceAtoms(sentence)) {
      if (atom.kind !== 'quantity') continue;
      const set = map.get(atom.unit) ?? new Set<number>();
      set.add(atom.number);
      map.set(atom.unit, set);
    }
  }
  return map;
}

export function entitySupported(value: string, normalizedSourceBlob: string): boolean {
  return (
    normalizedSourceBlob.includes(value) ||
    normalizedSourceBlob.includes(`${value}s`) ||
    (value.endsWith('s') && normalizedSourceBlob.includes(value.slice(0, -1)))
  );
}

export class LexicalGroundingGate implements GroundingGate {
  assess(sentence: string, sources: string[]): SentenceVerdict {
    const atoms = extractSentenceAtoms(sentence);
    return {
      sentence,
      atoms,
      grounded: atoms.every((atom) => this.isAtomSupported(atom, sources)),
    };
  }

  isAtomSupported(atom: FactualAtom, sources: string[]): boolean {
    if (atom.kind === 'entity') {
      return entitySupported(atom.value, normalize(sources.join(' ')));
    }
    // Quantity checks are exact: "5 shards" fails when the sources say 4.
    return (sourceQuantities(sources).get(atom.unit) ?? new Set<number>()).has(atom.number);
  }

  filter(rawAnswer: string, sources: string[]): { kept: string[]; dropped: string[] } {
    const kept: string[] = [];
    const dropped: string[] = [];
    let supportedAtomCount = 0;
    for (const sentence of splitSentences(rawAnswer)) {
      const verdict = this.assess(sentence, sources);
      if (verdict.grounded) {
        kept.push(sentence);
        supportedAtomCount += verdict.atoms.length;
      } else {
        dropped.push(sentence);
      }
    }
    // Nothing verifiable was supported: the answer is not covered by the sources.
    if (supportedAtomCount === 0) {
      return { kept: [], dropped: [...kept, ...dropped] };
    }
    return { kept, dropped };
  }
}
```

### src/answer/hint-redactor.ts
```ts
/**
 * Spoiler-free hint redaction.
 *
 * A hint is derived from the already-grounded full answer by redaction only;
 * it never issues a second LLM call. The redaction is lexical:
 *
 *   - proper-noun entities (boss names, named items, named places)
 *       -> "the/a hidden name"
 *     // ASSUMPTION: without a name taxonomy a lexical redactor cannot tell a
 *     // boss name from a named item, so every proper-noun entity is redacted
 *     // to a generic placeholder.
 *   - item locations (objects of location prepositions) -> "a hidden place"
 *   - quantities (number + unit) -> "several <unit>", unless the exact same
 *     quantity + unit already appears in the player's question (known to them)
 */

import {
  IDIOMATIC_UNITS,
  STOPWORDS,
  extractSentenceAtoms,
  findEntities,
  singularize,
  splitSentences,
  toNumber,
} from './grounding-gate.js';

export const NAME_PLACEHOLDER = 'hidden name';
export const PLACE_PLACEHOLDER = 'a hidden place';

const LOCATION_RE =
  /\b(in|at|on|under|behind|inside|beyond|beside|near)\s+(?:(?:the|a|an)\s+)?([A-Za-z][a-z-]*)/gi;

/** Location words that reveal nothing ("at the end", "in the air"). */
const HARMLESS_LOCATION_WORDS = new Set([
  'end', 'time', 'way', 'game', 'air', 'ground', 'cost',
  'day', 'night', 'morning', 'evening',
  'minute', 'hour', 'second',
  'place', 'position', 'door', 'edge', 'line', 'side',
]);

const QUANTITY_RE =
  /(\b\d{1,3}\b|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b|\bseven\b|\beight\b|\bnine\b|\bten\b)(?:\s+([a-z][a-z-]*))?/gi;

function redactLocations(sentence: string): string {
  return sentence.replace(LOCATION_RE, (full: string, prep: string, word: string) => {
    const lowered = word.toLowerCase();
    if (HARMLESS_LOCATION_WORDS.has(lowered) || STOPWORDS.has(lowered)) return full;
    return `${prep} ${PLACE_PLACEHOLDER}`;
  });
}

function redactNames(sentence: string): string {
  const entities = findEntities(sentence);
  for (let i = entities.length - 1; i >= 0; i -= 1) {
    const entity = entities[i];
    const before = sentence.slice(0, entity.index);
    const precededByArticle = /(?:^|\s)(?:the|a|an)\s$/i.test(before);
    const replacement = precededByArticle ? `the ${NAME_PLACEHOLDER}` : `a ${NAME_PLACEHOLDER}`;
    sentence = `${before}${replacement}${sentence.slice(entity.index + entity.raw.length)}`;
  }
  return sentence;
}

function quantityKeysIn(text: string): Set<string> {
  const keys = new Set<string>();
  for (const sentence of splitSentences(text)) {
    for (const atom of extractSentenceAtoms(sentence)) {
      if (atom.kind === 'quantity') keys.add(`${atom.number}:${atom.unit}`);
    }
  }
  return keys;
}

function redactQuantities(sentence: string, playerKnown: Set<string>): string {
  return sentence.replace(QUANTITY_RE, (full: string, numToken: string, unitToken?: string) => {
    const number = toNumber(numToken);
    if (number === null) return full;
    if (unitToken === undefined || unitToken === null) return 'a few';
    const unit = unitToken.toLowerCase();
    if (IDIOMATIC_UNITS.has(unit)) return full;
    if (STOPWORDS.has(unit)) return `a few ${unitToken}`;
    if (playerKnown.has(`${number}:${singularize(unit)}`)) return full;
    return `several ${unitToken}`;
  });
}

function capitalizeFirst(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function redactHint(fullAnswer: string, question: string): string {
  const playerKnown = quantityKeysIn(question);
  return splitSentences(fullAnswer)
    .map((sentence) =>
      capitalizeFirst(redactQuantities(redactNames(redactLocations(sentence)), playerKnown)),
    )
    .join(' ');
}
```

### src/answer/answer-service.ts
```ts
import { GroundingGate, LexicalGroundingGate } from './grounding-gate.js';
import { redactHint } from './hint-redactor.js';
import { LlmClient, LlmRequest } from './llm-client.js';
import { LLM_REFUSAL_SENTINEL, NOT_COVERED_MESSAGE } from './refusal.js';

// ASSUMPTION: the task specifies a standalone pipeline + eval harness (no API
// surface, no persistence), so the service uses plain constructor injection of
// the LLM client instead of a NestJS module; a scripted fake plugs in for
// tests and for the eval harness.

export type AnswerMode = 'answer' | 'hint';

export interface AnswerResult {
  mode: AnswerMode;
  /** The answer (or refusal message) shown to the player. */
  text: string;
  refusal: boolean;
  /** Sentences dropped by the grounding gate. */
  droppedSentences: string[];
  /** Hint mode only: the grounded full answer the hint was redacted from. */
  fullAnswer?: string;
}

export class AnswerService {
  constructor(
    private readonly llm: LlmClient,
    private readonly gate: GroundingGate = new LexicalGroundingGate(),
  ) {}

  async answer(question: string, sources: string[], mode: AnswerMode = 'answer'): Promise<AnswerResult> {
    const raw = (await this.llm.complete(this.buildPrompt(question, sources))).text;

    if (this.llmSaidNotCovered(raw)) {
      return this.refusal(mode);
    }

    const { kept, dropped } = this.gate.filter(raw, sources);
    if (kept.length === 0) {
      return this.refusal(mode);
    }

    const fullAnswer = kept.join(' ');
    if (mode === 'hint') {
      return {
        mode,
        text: redactHint(fullAnswer, question),
        refusal: false,
        droppedSentences: dropped,
        fullAnswer,
      };
    }
    return {
      mode,
      text: fullAnswer,
      refusal: false,
      droppedSentences: dropped,
    };
  }

  private refusal(mode: AnswerMode): AnswerResult {
    return { mode, text: NOT_COVERED_MESSAGE, refusal: true, droppedSentences: [] };
  }

  private llmSaidNotCovered(raw: string): boolean {
    return raw.trim() === LLM_REFUSAL_SENTINEL || /not\s+covered/i.test(raw);
  }

  private buildPrompt(question: string, sources: string[]): LlmRequest {
    const pages = sources
      .map((source, i) => `--- page ${i + 1} ---\n${source}`)
      .join('\n\n');
    return {
      system:
        'You are a game guide. Answer strictly from the wiki pages provided. ' +
        `If the pages do not contain the answer, reply exactly with: ${LLM_REFUSAL_SENTINEL}`,
      prompt: `Player question: ${question}\n\nWiki pages:\n${pages}`,
    };
  }
}
```

### src/eval/judges.ts
```ts
import { GroundingGate, LexicalGroundingGate, extractAtoms, normalize } from '../answer/grounding-gate.js';
import { isRefusal } from '../answer/refusal.js';

/**
 * Faithfulness: does the answer say only what the sources support?
 * The judge receives the sources. Refusals are vacuously faithful; a planted
 * false fact that survives in the text is a hard zero; otherwise the score is
 * the fraction of factual atoms supported by the sources.
 */
export class FaithfulnessJudge {
  constructor(private readonly gate: GroundingGate = new LexicalGroundingGate()) {}

  judge(answer: string, sources: string[], options: { plantedFalseFacts?: string[] } = {}): number {
    if (isRefusal(answer)) return 1;

    const lowered = normalize(answer);
    for (const planted of options.plantedFalseFacts ?? []) {
      if (lowered.includes(normalize(planted))) return 0;
    }

    const atoms = extractAtoms(answer);
    if (atoms.length === 0) return 1;
    const supported = atoms.filter((atom) => this.gate.isAtomSupported(atom, sources)).length;
    return supported / atoms.length;
  }
}

/**
 * Helpfulness: does the answer deliver the golden facts?
 * A scenario that expects a refusal scores 1 only when the service refused;
 * any refusal in a non-refusal scenario scores 0.
 */
export class HelpfulnessJudge {
  judge(answer: string, spec: { expectedFacts: string[]; expectRefusal?: boolean }): number {
    if (spec.expectRefusal) return isRefusal(answer) ? 1 : 0;
    if (isRefusal(answer)) return 0;

    const total = spec.expectedFacts.length;
    if (total === 0) return 0;
    const lowered = normalize(answer);
    const hits = spec.expectedFacts.filter((fact) => lowered.includes(normalize(fact))).length;
    return hits / total;
  }
}
```

### src/eval/eval-harness.ts
```ts
import { AnswerService, type AnswerMode } from '../answer/answer-service.js';
import { LlmClient, ScriptedLlmClient } from '../answer/llm-client.js';
import { FaithfulnessJudge, HelpfulnessJudge } from './judges.js';

/**
 * A golden scenario pairs a question with wiki-page fixtures and a scripted
 * LLM reply (the fake client's canned output). `expectedFacts` are the facts a
 * good answer must contain; `plantedFalseFacts` are false claims (e.g. an
 * invented item requirement) planted in the scripted reply that a faithful
 * answer must not contain; `expectRefusal` marks scenarios whose sources lack
 * the answer, where the correct behaviour is a refusal.
 */
export interface GoldenScenario {
  id: string;
  description?: string;
  question: string;
  sources: string[];
  mode?: AnswerMode;
  /** Scripted reply the fake LLM returns for this scenario. */
  llmReply: string;
  expectedFacts: string[];
  plantedFalseFacts?: string[];
  expectRefusal?: boolean;
}

export interface ScenarioReport {
  id: string;
  mode: AnswerMode;
  text: string;
  refusal: boolean;
  helpfulness: number;
  faithfulness: number;
  finalScore: number;
  pass: boolean;
}

export interface EvalReport {
  reports: ScenarioReport[];
  average: number;
  passed: boolean;
}

export interface EvalOptions {
  threshold?: number;
  makeLlm?: (scenario: GoldenScenario) => LlmClient;
  faithfulnessJudge?: FaithfulnessJudge;
  helpfulnessJudge?: HelpfulnessJudge;
}

export const DEFAULT_PASS_THRESHOLD = 0.75;

/**
 * Runs every scenario through the answer pipeline and scores each result with
 * the helpfulness judge and the faithfulness judge (which receives the
 * sources). Final score = min(helpfulness, faithfulness).
 */
export async function runEval(
  scenarios: GoldenScenario[],
  options: EvalOptions = {},
): Promise<EvalReport> {
  const threshold = options.threshold ?? DEFAULT_PASS_THRESHOLD;
  const makeLlm = options.makeLlm ?? ((scenario: GoldenScenario) => ScriptedLlmClient.fromText(scenario.llmReply));
  const faithfulnessJudge = options.faithfulnessJudge ?? new FaithfulnessJudge();
  const helpfulnessJudge = options.helpfulnessJudge ?? new HelpfulnessJudge();

  const reports: ScenarioReport[] = [];
  for (const scenario of scenarios) {
    const mode = scenario.mode ?? 'answer';
    const service = new AnswerService(makeLlm(scenario));
    const result = await service.answer(scenario.question, scenario.sources, mode);

    const helpfulness = helpfulnessJudge.judge(result.text, {
      expectedFacts: scenario.expectedFacts,
      expectRefusal: scenario.expectRefusal,
    });
    const faithfulness = faithfulnessJudge.judge(result.text, scenario.sources, {
      plantedFalseFacts: scenario.plantedFalseFacts,
    });
    const finalScore = Math.min(helpfulness, faithfulness);

    reports.push({
      id: scenario.id,
      mode,
      text: result.text,
      refusal: result.refusal,
      helpfulness,
      faithfulness,
      finalScore,
      pass: finalScore >= threshold,
    });
  }

  const average =
    reports.length > 0 ? reports.reduce((sum, report) => sum + report.finalScore, 0) / reports.length : 0;
  return { reports, average, passed: reports.every((report) => report.pass) };
}
```

### src/eval/golden-scenarios.ts
```ts
import type { GoldenScenario } from './eval-harness.js';

/** Wiki page fixtures shared by the scenarios. */
export const CELLAR_PAGES = [
  'The Gravel Wretch is the guardian of the cellar. It can only be weakened by a shard of glass. Four shards are required to seal the cellar door.',
  'The cellar lies behind the bakery. The door has no keyhole. Shards of glass can be found in broken windows.',
];

/** A fully grounded reply. */
export const GROUNDED_REPLY =
  'The cellar lies behind the bakery. Weaken the Gravel Wretch with a shard of glass. Four shards are required to seal the cellar door.';

/** A confident lie: invented item requirement + wrong quantity + invented name. */
export const CONFIDENT_LIE_REPLY =
  'The cellar door opens with a Moonlight Shard. You need five shards and the Rusted Key to proceed.';

export const GOLDEN_SCENARIOS: GoldenScenario[] = [
  {
    id: 'grounded-answer-high',
    description: 'A fully grounded answer must score high on both judges.',
    question: 'How do I get past the cellar door?',
    sources: CELLAR_PAGES,
    mode: 'answer',
    llmReply: GROUNDED_REPLY,
    expectedFacts: ['behind the bakery', 'gravel wretch', 'four shards are required'],
    plantedFalseFacts: ['moonlight shard', 'rusted key', 'five shards'],
  },
  {
    id: 'confident-lie-low',
    description: 'A confident but unsupported answer must score low.',
    question: 'How do I get past the cellar door?',
    sources: CELLAR_PAGES,
    mode: 'answer',
    llmReply: CONFIDENT_LIE_REPLY,
    expectedFacts: ['gravel wretch', 'four shards'],
    plantedFalseFacts: ['moonlight shard', 'rusted key', 'five shards'],
  },
  {
    id: 'uncovered-refusal',
    description: 'Sources that lack the answer yield a refusal, even when the LLM hallucinates.',
    question: 'What does the Moonlight Shrine do?',
    sources: CELLAR_PAGES,
    mode: 'answer',
    llmReply: 'The Moonlight Shrine restores health. A Rusted Key glows beside it.',
    expectedFacts: [],
    expectRefusal: true,
    plantedFalseFacts: ['moonlight shrine', 'rusted key'],
  },
  {
    id: 'quantity-mismatch-dropped',
    description: 'A wrong quantity (five vs four shards) is caught exactly: the sentence is dropped, the correct one kept.',
    question: 'How do I get past the cellar door?',
    sources: CELLAR_PAGES,
    mode: 'answer',
    llmReply: 'Four shards are required. Bring five shards to the door.',
    expectedFacts: ['four shards are required'],
    plantedFalseFacts: ['five shards'],
  },
  {
    id: 'hint-redacted',
    description: 'Hint mode redacts names, item locations and quantities from the grounded answer.',
    question: 'How do I get past the cellar door?',
    sources: CELLAR_PAGES,
    mode: 'hint',
    llmReply: GROUNDED_REPLY,
    expectedFacts: ['several shards are required', 'hidden place', 'hidden name'],
    plantedFalseFacts: ['gravel wretch', 'bakery', 'four shards'],
  },
];
```

### test/answer.service.spec.ts
```ts
import { describe, expect, it } from 'vitest';

import { AnswerService } from '../src/answer/answer-service.js';
import { ScriptedLlmClient } from '../src/answer/llm-client.js';
import { NOT_COVERED_MESSAGE } from '../src/answer/refusal.js';
import { CELLAR_PAGES, CONFIDENT_LIE_REPLY, GROUNDED_REPLY } from '../src/eval/golden-scenarios.js';

const QUESTION = 'How do I get past the cellar door?';

describe('AnswerService', () => {
  it('returns the grounded answer untouched when every sentence is supported', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText(GROUNDED_REPLY));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');

    expect(result.refusal).toBe(false);
    expect(result.text).toBe(GROUNDED_REPLY);
    expect(result.droppedSentences).toEqual([]);
  });

  it('refuses with "not covered by my sources" when the reply is a confident lie', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText(CONFIDENT_LIE_REPLY));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');

    expect(result.refusal).toBe(true);
    expect(result.text).toBe(NOT_COVERED_MESSAGE);
  });

  it('refuses when the LLM itself says the pages do not cover the question', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText('NOT_COVERED'));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');

    expect(result.refusal).toBe(true);
    expect(result.text).toBe(NOT_COVERED_MESSAGE);
  });

  it('drops only the sentence with the wrong quantity and keeps the correct one', async () => {
    const service = new AnswerService(
      ScriptedLlmClient.fromText('Four shards are required. Bring five shards to the door.'),
    );
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');

    expect(result.refusal).toBe(false);
    expect(result.text).toBe('Four shards are required.');
    expect(result.droppedSentences).toEqual(['Bring five shards to the door.']);
    expect(result.text.toLowerCase()).not.toContain('five');
  });

  it('treats the exact quantity stated in the sources as grounded', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText('Bring four shards to the door.'));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');

    expect(result.refusal).toBe(false);
    expect(result.text).toBe('Bring four shards to the door.');
  });

  it('refuses an invented name that appears in no source', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText('The Rusted Key opens the gate.'));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'answer');

    expect(result.refusal).toBe(true);
    expect(result.text).toBe(NOT_COVERED_MESSAGE);
  });
});
```

### test/hint.spec.ts
```ts
import { describe, expect, it } from 'vitest';

import { AnswerService } from '../src/answer/answer-service.js';
import { ScriptedLlmClient } from '../src/answer/llm-client.js';
import { NOT_COVERED_MESSAGE } from '../src/answer/refusal.js';
import { CELLAR_PAGES, CONFIDENT_LIE_REPLY, GROUNDED_REPLY } from '../src/eval/golden-scenarios.js';

const QUESTION = 'How do I get past the cellar door?';

describe('hint mode', () => {
  it('redacts boss names, item locations and quantities from the grounded answer', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText(GROUNDED_REPLY));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'hint');

    expect(result.refusal).toBe(false);
    expect(result.text).not.toContain('Gravel Wretch');
    expect(result.text).not.toContain('bakery');
    expect(result.text.toLowerCase()).not.toContain('four');
    expect(result.text).not.toMatch(/\d/);
    expect(result.text).toContain('hidden place');
    expect(result.text).toContain('the hidden name');
    expect(result.text).toContain('several shards');
    expect(result.fullAnswer).toBe(GROUNDED_REPLY);
  });

  it('keeps quantities the player already mentioned in their question', async () => {
    const service = new AnswerService(
      ScriptedLlmClient.fromText('Four shards are required to seal the cellar door.'),
    );
    const result = await service.answer('I have four shards already. What now?', CELLAR_PAGES, 'hint');

    expect(result.refusal).toBe(false);
    expect(result.text).toContain('Four shards are required');
  });

  it('is derived from the grounded answer by redaction, not by a second LLM call', async () => {
    const llm = ScriptedLlmClient.fromText(GROUNDED_REPLY);
    const service = new AnswerService(llm);
    const hint = await service.answer(QUESTION, CELLAR_PAGES, 'hint');

    expect(llm.calls).toHaveLength(1);

    const answerText = (
      await new AnswerService(ScriptedLlmClient.fromText(GROUNDED_REPLY)).answer(QUESTION, CELLAR_PAGES, 'answer')
    ).text;
    expect(hint.fullAnswer).toBe(answerText);
    expect(hint.text).not.toBe(answerText);
  });

  it('refuses in hint mode when nothing is grounded', async () => {
    const service = new AnswerService(ScriptedLlmClient.fromText(CONFIDENT_LIE_REPLY));
    const result = await service.answer(QUESTION, CELLAR_PAGES, 'hint');

    expect(result.refusal).toBe(true);
    expect(result.text).toBe(NOT_COVERED_MESSAGE);
  });
});
```

### test/eval-harness.spec.ts
```ts
import { describe, expect, it } from 'vitest';

import {
  GOLDEN_SCENARIOS,
  CELLAR_PAGES,
} from '../src/eval/golden-scenarios.js';
import { runEval, type GoldenScenario, type ScenarioReport } from '../src/eval/eval-harness.js';
import { FaithfulnessJudge } from '../src/eval/judges.js';

describe('eval harness', () => {
  it('scores a scripted confident-lie answer low', async () => {
    const report = await runEval(GOLDEN_SCENARIOS.filter((s) => s.id === 'confident-lie-low'));
    const r = report.reports[0];

    expect(r.refusal).toBe(true);
    expect(r.helpfulness).toBe(0);
    expect(r.finalScore).toBeLessThan(0.25);
    expect(r.pass).toBe(false);
  });

  it('scores a correct grounded answer high', async () => {
    const report = await runEval(GOLDEN_SCENARIOS.filter((s) => s.id === 'grounded-answer-high'));
    const r = report.reports[0];

    expect(r.refusal).toBe(false);
    expect(r.helpfulness).toBe(1);
    expect(r.faithfulness).toBe(1);
    expect(r.finalScore).toBe(1);
    expect(r.pass).toBe(true);
  });

  it('yields a passing refusal when the sources lack the answer', async () => {
    const report = await runEval(GOLDEN_SCENARIOS.filter((s) => s.id === 'uncovered-refusal'));
    const r = report.reports[0];

    expect(r.refusal).toBe(true);
    expect(r.helpfulness).toBe(1);
    expect(r.faithfulness).toBe(1);
    expect(r.finalScore).toBe(1);
    expect(r.pass).toBe(true);
  });

  it('catches quantity errors exactly: five shards fails, four shards passes', async () => {
    const judge = new FaithfulnessJudge();

    expect(judge.judge('Bring five shards to the door.', CELLAR_PAGES)).toBe(0);
    expect(judge.judge('Bring four shards to the door.', CELLAR_PAGES)).toBe(1);
  });

  it('scores a planted false fact as unfaithful even when the rest is grounded', async () => {
    const judge = new FaithfulnessJudge();

    const score = judge.judge('Bring four shards and a Moonlight Shard.', CELLAR_PAGES, {
      plantedFalseFacts: ['moonlight shard'],
    });
    expect(score).toBe(0);
  });

  it('uses the minimum of helpfulness and faithfulness as the final score', async () => {
    const scenario: GoldenScenario = {
      id: 'partial-helpfulness',
      question: 'Where is the cellar and what does its door need?',
      sources: CELLAR_PAGES,
      mode: 'answer',
      llmReply: 'Weaken the Gravel Wretch. The cellar lies behind the bakery.',
      expectedFacts: ['behind the bakery', 'no keyhole'],
    };
    const report = await runEval([scenario]);
    const r = report.reports[0];

    expect(r.helpfulness).toBe(0.5);
    expect(r.faithfulness).toBe(1);
    expect(r.finalScore).toBe(0.5);
    expect(r.pass).toBe(false);
  });

  it('flags exactly the planted-lie scenario across the full golden suite', async () => {
    const report = await runEval(GOLDEN_SCENARIOS);
    const byId = Object.fromEntries(report.reports.map((r) => [r.id, r])) as Record<string, ScenarioReport>;

    expect(byId['grounded-answer-high'].finalScore).toBe(1);
    expect(byId['confident-lie-low'].finalScore).toBe(0);
    expect(byId['uncovered-refusal'].finalScore).toBe(1);
    expect(byId['quantity-mismatch-dropped'].finalScore).toBe(1);
    expect(byId['hint-redacted'].finalScore).toBe(1);

    // Only the deliberately planted lie fails; the suite as a whole does not pass.
    expect(byId['confident-lie-low'].pass).toBe(false);
    for (const id of ['grounded-answer-high', 'uncovered-refusal', 'quantity-mismatch-dropped', 'hint-redacted']) {
      expect(byId[id].pass).toBe(true);
    }
    expect(report.passed).toBe(false);
    expect(report.average).toBeCloseTo(0.8);
  });
});
```
