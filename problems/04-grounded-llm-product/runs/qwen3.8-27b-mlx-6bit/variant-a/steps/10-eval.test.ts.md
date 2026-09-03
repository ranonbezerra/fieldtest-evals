# 10-eval.test.ts

## reasoning

```
Let me analyze the test cases file and the references to write `test/eval.test.ts`.

From the test cases file, I need to cover:

1. confident-lie scores below threshold
2. correct grounded answer scores at or above threshold
3. sources-lack-answer yields refusal and a low helpfulness score
4. quantity mismatch is caught exactly
5. quantity match is not penalised
6. finalScore is the minimum, not the maximum
7. boundary: score exactly at PASS_THRESHOLD passes
8. multiple scenarios return one EvalResult each, in input order
9. ScriptedLLMClient exhaustion propagates
10. empty plantedFalseFacts and no quantity claims → faithfulness is 1

Let me look at the references to understand the interfaces:

- `runEval(scenarios, llm, redactionConfig?)` returns `Promise<EvalResult[]>`
- `EvalResult` has: `scenarioId`, `helpfulnessScore`, `faithfulnessScore`, `finalScore`, `passed`
- `PASS_THRESHOLD = 0.8`
- `Scenario` has: `id`, `question`, `sources`, `expectedFacts`, `plantedFalseFacts`
- `Source` has: `id`, `title`, `text`
- `ScriptedLLMClient(replies: string[])`
- `GOLDEN_SCENARIOS` from `src/eval/scenarios.ts`

Now let me think about each test case:

1. **Confident-lie scores below threshold**: The LLM returns an answer containing a planted false fact. I need to use the "ashen-keep-lie" scenario where `plantedFalseFacts: ["requires the Crystal Key", "level 20"]`. The LLM should return something like "You need level 12 to enter the Ashen Keep. It requires the Crystal Key." - this has "level 12" (expected fact) but also "requires the Crystal Key" (planted false fact). The faithfulness score should be low because of the false fact.

Wait, but I need to make sure the sentence is grounded enough to pass the grounding gate. Let me think about the grounding algorithm: ≥ 70% of content-word bigrams must appear in at least one source.

Source text: "The Ashen Keep is accessible from level 12 onwards. No special items are required to enter."

If the LLM says "You need level 12 to enter the Ashen Keep. It requires the Crystal Key."

Let me think about bigrams. Content words (excluding stop words): "need", "level", "enter", "Ashen", "Keep", "requires", "Crystal", "Key"

Bigrams from sentence 1: "need level", "level 12", "12 enter", "enter Ashen", "Ashen Keep" - wait, the grounding uses content-word bigrams. Let me re-read the plan.

The plan says: "extract content-word bigrams; compute overlap with every source. grounded = (maxOverlap / totalBigrams) ≥ 0.7"

I don't have the exact implementation of `gateSentences`, but I can reason about it. The key insight is that the test needs to work with whatever the grounding implementation does. Since I'm writing tests, I should craft LLM responses that are clearly grounded (high overlap) or clearly ungrounded.

For the confident-lie test, I want the sentence to pass grounding but contain a false fact. Let me use text that heavily overlaps with the source:

Source: "The Ashen Keep is accessible from level 12 onwards. No special items are required to enter."

LLM response: "The Ashen Keep is accessible from level 12 onwards. It requires the Crystal Key to enter."

The first sentence is almost verbatim from the source, so it should be grounded. The second sentence "It requires the Crystal Key to enter" - bigrams would be "requires crystal", "crystal key", "key enter". The source has "required to enter" but not "requires the Crystal Key". So this sentence might NOT be grounded and would be dropped.

Hmm, that's a problem. If the grounding gate drops the sentence with the false fact, then the judge never sees it and faithfulness stays high.

Wait, the test case description says: "Would fail if: ... the grounding gate drops the sentence carrying the false fact so the judge never sees it." So I need to make sure the false-fact sentence IS grounded.

Let me think differently. I need a sentence that:
- Contains a planted false fact (e.g., "requires the Crystal Key")
- Has ≥ 70% bigram overlap with the source

Source: "The Ashen Keep is accessible from level 12 onwards. No special items are required to enter."

If I say: "The Ashen Keep is accessible from level 12 onwards and requires the Crystal Key."

Bigrams (content words): "ashen keep", "keep accessible", "accessible level", "level 12", "12 onwards", "onwards requires", "requires crystal", "crystal key"

Source bigrams: "ashen keep", "keep accessible", "accessible level", "level 12", "12 onwards", "onwards special", "special items", "items required", "required enter"

Overlap: "ashen keep", "keep accessible", "accessible level", "level 12", "12 onwards" = 5 out of 8 = 62.5%. That's below 70%.

Hmm. Let me try a different approach. What if the false fact is embedded in a way that most of the bigrams still match?

Actually, wait. I'm overthinking this. The test cases say these are the tests I should write. Let me look at what makes sense given the implementation.

Actually, let me reconsider. The grounding gate works on content-word bigrams. Let me think about what "content words" means - likely it excludes stop words like "the", "a", "is", "from", "to", "and", "it", etc.

Let me try: "The Ashen Keep is accessible from level 12 onwards and no special items are required to enter."

This is almost the entire source. Bigrams would mostly match. But it doesn't contain a false fact.

What about: "The Ashen Keep is accessible from level 12 onwards and requires the Crystal Key to enter."

Content words: ashen, keep, accessible, level, 12, onwards, requires, crystal, key, enter
Bigrams: ashen-keep, keep-accessible, accessible-level, level-12, 12-onwards, onwards-requires, requires-crystal, crystal-key, key-enter

Source content words: ashen, keep, accessible, level, 12, onwards, special, items, required, enter
Source bigrams: ashen-keep, keep-accessible, accessible-level, level-12, 12-onwards, onwards-special, special-items, items-required, required-enter

Overlap: ashen-keep, keep-accessible, accessible-level, level-12, 12-onwards = 5/9 = 55.6%. Still below 70%.

This is tricky. Let me think about this differently.

What if I use a different scenario where the source text is longer and the false fact is a small addition?

Or what if I craft the scenario myself (not using GOLDEN_SCENARIOS) for this specific test?

Actually, looking at the test cases more carefully:

"confident-lie scores below threshold — The LLM is scripted to return an answer that contains a planted false fact (e.g. "requires the Crystal Key") alongside some grounded text."

The key insight: I can use a custom scenario for the test, not necessarily the golden scenarios. Or I can use the golden scenario but craft the LLM response carefully.

Let me think about what would work. If I have a source with a lot of text, and the LLM response is mostly from that source with one false fact sprinkled in, the bigram overlap would be high enough.

Let me create a scenario with a longer source:

Source: "The Ashen Keep is accessible from level 12 onwards. No special items are required to enter. The Ashen Keep contains the Obsidian Throne and ancient ruins that predate the kingdom."

If LLM says: "The Ashen Keep is accessible from level 12 onwards and no special items are required to enter. It requires the Crystal Key to access the Obsidian Throne."

Hmm, this is getting complex. Let me think about a simpler approach.

Actually, you know what - let me just make the LLM response be a single sentence that's heavily grounded but contains the false fact. The trick is to make most bigrams overlap.

What if the source is: "The Ashen Keep is accessible from level 12 onwards. The Crystal Key is not needed for entry."

And the LLM says: "The Ashen Keep is accessible from level 12 onwards. The Crystal Key is required for entry."

Source content words: ashen, keep, accessible, level, 12, onwards, crystal, key, needed, entry
Source bigrams: ashen-keep, keep-accessible, accessible-level, level-12, 12-onwards, onwards-crystal, crystal-key, key-needed, needed-entry

LLM content words: ashen, keep, accessible, level, 12, onwards, crystal, key, required, entry
LLM bigrams: ashen-keep, keep-accessible, accessible-level, level-12, 12-onwards, onwards-crystal, crystal-key, key-required, required-entry

Overlap: ashen-keep, keep-accessible, accessible-level, level-12, 12-onwards, onwards-crystal, crystal-key = 7/9 = 77.8% ≥ 70%. 

And the planted false fact "Crystal Key is required" or just "requires the Crystal Key" - wait, I need to check what the planted false fact substring is.

Actually, let me step back. For the test, I can define my own scenarios inline. The test doesn't have to use GOLDEN_SCENARIOS. Let me design scenarios that make the tests work cleanly.

Let me redesign:

**Test 1: Confident-lie scores below threshold**
- Source: "The Ashen Keep is accessible from level 12 onwards. The Crystal Key is not needed for entry."
- LLM response: "The Ashen Keep is accessible from level 12 onwards. The Crystal Key is required for entry."
- expectedFacts: ["level 12"]
- plantedFalseFacts: ["Crystal Key is required"]
- The sentence is grounded (77.8% overlap), so it passes the gate.
- Helpfulness: "level 12" is present → score 1
- Faithfulness: "crystal key is required" is in the answer (lowercased) → that's a planted false fact present → fails. Also quantity check: no digit-unit pairs... wait "12 onwards" - is "onwards" a unit? The regex is `\b(\d+)\s+([a-zA-Z]+)\b` so "12 onwards" would match with num=12, unit="onwards". Then it looks for "(\d+)\s+onwards" in sources. Source has "level 12 onwards" - so the pattern `\b(\d+)\s+onwards\b` would match "12 onwards" in the source. So srcNum=12, claim.num=12, they match. OK so no quantity mismatch there.
- Faithfulness score: 1 check (the false fact), 0 passed → score 0.
- finalScore = min(1, 0) = 0 < 0.8 ✓

Wait, but I need to double-check: does "12 onwards" get extracted? The regex `\b(\d+)\s+([a-zA-Z]+)\b` - "12" followed by whitespace and then "onwards". Yes, it would match. And in the source, "level 12 onwards" contains "12 onwards" so the source pattern `\b(\d+)\s+onwards\b` would find "12 onwards" with srcNum=12. Match! Good.

Actually wait, I realize I should double-check the grounding more carefully. Let me recount.

The grounding algorithm splits into sentences first, then checks each sentence.

Sentence 1: "The Ashen Keep is accessible from level 12 onwards."
Content words (removing stop words like "the", "is", "from"): ashen, keep, accessible, level, 12, onwards
Bigrams: ashen-keep, keep-accessible, accessible-level, level-12, 12-onwards (5 bigrams)

Source: "The Ashen Keep is accessible from level 12 onwards. The Crystal Key is not needed for entry."
Content words: ashen, keep, accessible, level, 12, onwards, crystal, key, needed, entry
Source bigrams: ashen-keep, keep-accessible, accessible-level, level-12, 12-onwards, onwards-crystal, crystal-key, key-needed, needed-entry

Overlap for sentence 1: all 5 bigrams are in source → 5/5 = 100% ≥ 70%. Grounded! ✓

Sentence 2: "The Crystal Key is required for entry."
Content words: crystal, key, required, entry
Bigrams: crystal-key, key-required, required-entry (3 bigrams)

Overlap with source: crystal-key is in source. key-required? Source has "key-needed" not "key-required". required-entry? Source has "needed-entry" not "required-entry".
So overlap: 1/3 = 33.3% < 70%. NOT grounded. ✗

So sentence 2 would be dropped! That means the judge never sees "Crystal Key is required". This is exactly the failure mode the test case warns about.

I need a different approach. Let me make the false fact part of a sentence that's still grounded.

What if I combine them into one sentence?
"The Ashen Keep is accessible from level 12 onwards and the Crystal Key is required for entry."

Content words: ashen, keep, accessible, level, 12, onwards, crystal, key, required, entry
Bigrams: ashen-keep, keep-accessible, accessible-level, level-12, 12-onwards, onwards-crystal, crystal-key, key-required, required-entry (9 bigrams)

Source bigrams: ashen-keep, keep-accessible, accessible-level, level-12, 12-onwards, onwards-crystal, crystal-key, key-needed, needed-entry

Overlap: ashen-keep, keep-accessible, accessible-level, level-12, 12-onwards, onwards-crystal, crystal-key = 7/9 = 77.8% ≥ 70%. Grounded! ✓

And the planted false fact "Crystal Key is required" (lowercased: "crystal key is required") - wait, the answer text would be "The Ashen Keep is accessible from level 12 onwards and the Crystal Key is required for entry." Lowercased: "the ashen keep is accessible from level 12 onwards and the crystal key is required for entry."

Does it contain "crystal key is required"? Yes! "crystal key is required" is a substring.

So:
- expectedFacts: ["level 12"] → present in answer → helpfulness = 1
- plantedFalseFacts: ["crystal key is required"] → present in answer → faithfulness check fails
- Quantity check: "12 onwards" → num=12, unit="onwards". Source has "12 onwards" → match. No mismatch.
- Faithfulness: 1 check (false fact present), 0 passed → score 0/1 = 0
- finalScore = min(1, 0) = 0 < 0.8 ✓

This works! Let me use this approach.

**Test 2: Correct grounded answer scores at or above threshold**
- Source: "The Ashen Keep is accessible from level 12 onwards. No special items are required to enter."
- LLM response: "The Ashen Keep is accessible from level 12 onwards. No special items are required to enter."
- expectedFacts: ["level 12"]
- plantedFalseFacts: ["requires the Crystal Key"]

The LLM response is verbatim from the source, so all sentences are grounded (100% overlap).
- Helpfulness: "level 12" present → 1
- Faithfulness: "requires the crystal key" not in answer → passed. Quantity: "12 onwards" → source has "12 onwards" → match. Score = 1
- finalScore = min(1, 1) = 1 ≥ 0.8 ✓

**Test 3: Sources-lack-answer yields refusal**
- Source: "The Riverbend area features lush vegetation and several fishing spots along the eastern shore."
- LLM response: "The password to open the Vault of Whispers is ancient and mysterious."
- expectedFacts: ["password"] (or something that would be in a correct answer)
- plantedFalseFacts: []

The LLM response shares no bigrams with the source (completely different topic). So no sentences are grounded → refusal.
- answer() returns text: "not covered by my sources", refused: true
- Helpfulness: does "not covered by my sources" contain "password"? No → score 0
- Faithfulness: no planted false facts, no quantity claims → score 1
- finalScore = min(0, 1) = 0 < 0.8 ✓

Wait, but the test case says "Because the scenario's expectedFacts is non-empty, helpfulness must be 0". Let me make sure expectedFacts is non-empty. I'll use ["password"].

Actually, looking at the golden scenario "vault-no-source", it has `expectedFacts: []`. If expectedFacts is empty, helpfulnessJudge returns score 1 (the `expectedFacts.length === 0 ? 1` branch). So finalScore would be min(1, 1) = 1, which is ≥ 0.8 and `passed` would be true. That contradicts the test case.

So for this test, I need a scenario where expectedFacts is non-empty. Let me use a custom scenario.

Let me use:
- expectedFacts: ["Vault of Whispers"]
- The refusal string "not covered by my sources" doesn't contain "Vault of Whispers" → helpfulness = 0
- finalScore = min(0, 1) = 0 < 0.8 ✓

**Test 4: Quantity mismatch caught exactly**
- Source: "The Dragonblade requires 4 Ember Shards to forge."
- LLM response: "The Dragonblade requires 5 Ember Shards to forge."
- expectedFacts: ["Dragonblade"]
- plantedFalseFacts: []

Let me check grounding:
LLM: "The Dragonblade requires 5 Ember Shards to forge."
Content words: dragonblade, requires, 5, ember, shards, forge
Bigrams: dragonblade-requires, requires-5, 5-ember, ember-shards, shards-forge

Source: "The Dragonblade requires 4 Ember Shards to forge."
Content words: dragonblade, requires, 4, ember, shards, forge
Source bigrams: dragonblade-requires, requires-4, 4-ember, ember-shards, shards-forge

Overlap: dragonblade-requires, ember-shards, shards-forge = 3/5 = 60% < 70%. NOT grounded!

Hmm, that's a problem. The "5" vs "4" changes two bigrams: "requires-5" vs "requires-4" and "5-ember" vs "4-ember".

I need to make the sentence longer so that the quantity difference is a smaller fraction of total bigrams.

What about: "The Dragonblade requires 5 Ember Shards to forge at the Forge of Ashes in the Underbelly district."

Source: "The Dragonblade requires 4 Ember Shards to forge. It is crafted at the Forge of Ashes in the Underbelly district."

LLM content words: dragonblade, requires, 5, ember, shards, forge, forge, ashes, underbelly, district
Wait, "forge" appears twice? Let me be more careful.

Actually, I think the bigram extraction is on the sequence of content words in order. Let me list them:
LLM: dragonblade, requires, 5, ember, shards, forge, forge, ashes, underbelly, district
Bigrams: dragonblade-requires, requires-5, 5-ember, ember-shards, shards-forge, forge-forge, forge-ashes, ashes-underbelly, underbelly-district (9 bigrams)

Source content words: dragonblade, requires, 4, ember, shards, forge, crafted, forge, ashes, underbelly, district
Source bigrams: dragonblade-requires, requires-4, 4-ember, ember-shards, shards-forge, forge-crafted, crafted-forge, forge-ashes, ashes-underbelly, underbelly-district (10 bigrams)

Overlap: dragonblade-requires, ember-shards, shards-forge, forge-ashes, ashes-underbelly, underbelly-district = 6/9 = 66.7% < 70%. Still not enough!

Let me add more source-matching content. What if the source is longer?

Source: "The Dragonblade requires 4 Ember Shards to forge. It is crafted at the Forge of Ashes in the Underbelly district. The Dragonblade is a legendary weapon."

LLM: "The Dragonblade requires 5 Ember Shards to forge at the Forge of Ashes in the Underbelly district. The Dragonblade is a legendary weapon."

LLM content words: dragonblade, requires, 5, ember, shards, forge, forge, ashes, underbelly, district, dragonblade, legendary, weapon
Bigrams: dragonblade-requires, requires-5, 5-ember, ember-shards, shards-forge, forge-forge, forge-ashes, ashes-underbelly, underbelly-district, district-dragonblade, dragonblade-legendary, legendary-weapon (12 bigrams)

Source content words: dragonblade, requires, 4, ember, shards, forge, crafted, forge, ashes, underbelly, district, dragonblade, legendary, weapon
Source bigrams: dragonblade-requires, requires-4, 4-ember, ember-shards, shards-forge, forge-crafted, crafted-forge, forge-ashes, ashes-underbelly, underbelly-district, district-dragonblade, dragonblade-legendary, legendary-weapon (13 bigrams)

Overlap: dragonblade-requires, ember-shards, shards-forge, forge-ashes, ashes-underbelly, underbelly-district, district-dragonblade, dragonblade-legendary, legendary-weapon = 9/12 = 75% ≥ 70%. Grounded! ✓

Now faithfulness:
- plantedFalseFacts: [] → no false fact checks
- Quantity claims in answer: "5 ember" → num=5, unit="ember". Wait, the regex is `\b(\d+)\s+([a-zA-Z]+)\b`. In "5 Ember Shards", it would match "5 Ember" (num=5, unit="ember") and also... wait, does it match "Shards" as a separate thing? No, the regex matches digit followed by word. So only "5 Ember" matches (num=5, unit="ember").

Wait, actually "Shards" isn't preceded by a digit in the text "5 Ember Shards". The regex would find:
- In "requires 5 Ember Shards": "5 Ember" → num=5, unit="ember"

Then it looks for `\b(\d+)\s+ember\b` (case insensitive) in sources. Source has "4 Ember Shards" → matches "4 ember" → srcNum=4, claim.num=5. Mismatch! ✓

- Also "4 Ember" in source... wait, does the answer have any other digit-word pairs? "Forge of Ashes" - no digits. So just one quantity claim.

Faithfulness: totalChecks = 1 (the quantity mismatch), passedChecks = 0 → score = 0/1 = 0 < 0.8 ✓

And the `missed` array should contain a string identifying both numbers: "quantity mismatch: answer says \"5 ember\", source says \"4 ember\"" (approximately).

Wait, but I also need to check: does the answer contain "4 ember" anywhere? No, it says "5 Ember Shards". Good.

Actually, hold on. Let me re-examine. The answer text after grounding would be the grounded sentences joined. If there's only one sentence and it's grounded, the text is that sentence.

Let me simplify. I'll use a scenario where:
- Source has enough text to make the LLM response grounded despite the quantity change
- The quantity mismatch is the key faithfulness failure

Let me try a simpler approach with a longer source:

Source: "The Dragonblade requires 4 Ember Shards to forge. The blade is tempered in volcanic glass. It can be obtained from the Forge of Ashes. Players report that the forge is dangerous at night."

LLM: "The Dragonblade requires 5 Ember Shards to forge. The blade is tempered in volcanic glass. It can be obtained from the Forge of Ashes. Players report that the forge is dangerous at night."

Now the LLM response has 4 sentences. Let me check each:

Sentence 1: "The Dragonblade requires 5 Ember Shards to forge."
Content words: dragonblade, requires, 5, ember, shards, forge
Bigrams: dragonblade-requires, requires-5, 5-ember, ember-shards, shards-forge

Source bigrams (from full source): dragonblade-requires, requires-4, 4-ember, ember-shards, shards-forge, forge-blade, blade-tempered, tempered-volcanic, volcanic-glass, glass-obtained, obtained-forge, forge-ashes, ashes-players, players-report, report-forge, forge-dangerous, dangerous-night

Wait, I need to be more careful. The source is one text, and I extract all content words from it in order:
"dragonblade requires 4 ember shards forge blade tempered volcanic glass obtained forge ashes players report forge dangerous night"

Source bigrams: dragonblade-requires, requires-4, 4-ember, ember-shards, shards-forge, forge-blade, blade-tempered, tempered-volcanic, volcanic-glass, glass-obtained, obtained-forge, forge-ashes, ashes-players, players-report, report-forge, forge-dangerous, dangerous-night (17 bigrams)

Sentence 1 bigrams: dragonblade-requires, requires-5, 5-ember, ember-shards, shards-forge (5 bigrams)
Overlap with source: dragonblade-requires ✓, requires-5 ✗, 5-ember ✗, ember-shards ✓, shards-forge ✓ = 3/5 = 60% < 70%. NOT grounded!

Hmm. Sentence 1 alone isn't grounded enough because the quantity change affects 2 out of 5 bigrams.

Sentence 2: "The blade is tempered in volcanic glass."
Content words: blade, tempered, volcanic, glass
Bigrams: blade-tempered, tempered-volcanic, volcanic-glass (3 bigrams)
Overlap: all 3 are in source → 100% ✓

Sentence 3: "It can be obtained from the Forge of Ashes."
Content words: obtained, forge, ashes (assuming "it", "can", "be", "from", "the", "of" are stop words)
Bigrams: obtained-forge, forge-ashes (2 bigrams)
Overlap: both in source → 100% ✓

Sentence 4: "Players report that the forge is dangerous at night."
Content words: players, report, forge, dangerous, night (assuming "that", "the", "is", "at" are stop words)
Bigrams: players-report, report-forge, forge-dangerous, dangerous-night (4 bigrams)
Overlap: all 4 in source → 100% ✓

So sentences 2, 3, 4 are grounded but sentence 1 is not. The final text would be sentences 2-4 joined, which does NOT contain "5 Ember Shards". So the quantity mismatch is never detected!

This is a problem. The grounding gate is too aggressive for short sentences with a single number change.

I need to either:
1. Make the quantity sentence long enough that the mismatch is a small fraction
2. Use a different approach

Let me try option 1. What if the sentence is:
"The Dragonblade requires 5 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."

Content words: dragonblade, requires, 5, ember, shards, forge, forge, ashes, blade, tempered, volcanic, glass (12 words)
Bigrams: dragonblade-requires, requires-5, 5-ember, ember-shards, shards-forge, forge-forge, forge-ashes, ashes-blade, blade-tempered, tempered-volcanic, volcanic-glass (11 bigrams)

Source content words: dragonblade, requires, 4, ember, shards, forge, blade, tempered, volcanic, glass, obtained, forge, ashes (13 words)
Source bigrams: dragonblade-requires, requires-4, 4-ember, ember-shards, shards-forge, forge-blade, blade-tempered, tempered-volcanic, volcanic-glass, glass-obtained, obtained-forge, forge-ashes (12 bigrams)

Overlap: dragonblade-requires ✓, requires-5 ✗, 5-ember ✗, ember-shards ✓, shards-forge ✓, forge-forge ✗ (source has forge-blade not forge-forge), forge-ashes ✓, ashes-blade ✗ (source has forge-ashes then... wait let me recheck)

Hmm, I'm getting confused. Let me be very precise.

Source text: "The Dragonblade requires 4 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."

Content words (in order): dragonblade, requires, 4, ember, shards, forge, forge, ashes, blade, tempered, volcanic, glass
(12 content words, assuming "the", "to", "at", "of", "where", "is", "in" are stop words)

Source bigrams (11): dragonblade-requires, requires-4, 4-ember, ember-shards, shards-forge, forge-forge, forge-ashes, ashes-blade, blade-tempered, tempered-volcanic, volcanic-glass

LLM text: "The Dragonblade requires 5 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."

Content words (in order): dragonblade, requires, 5, ember, shards, forge, forge, ashes, blade, tempered, volcanic, glass
(12 content words)

LLM bigrams (11): dragonblade-requires, requires-5, 5-ember, ember-shards, shards-forge, forge-forge, forge-ashes, ashes-blade, blade-tempered, tempered-volcanic, volcanic-glass

Overlap: dragonblade-requires ✓, requires-5 ✗ (source has requires-4), 5-ember ✗ (source has 4-ember), ember-shards ✓, shards-forge ✓, forge-forge ✓, forge-ashes ✓, ashes-blade ✓, blade-tempered ✓, tempered-volcanic ✓, volcanic-glass ✓

= 9/11 = 81.8% ≥ 70%. Grounded! ✓

This works. The only differences are the two bigrams involving the changed number (requires-5 vs requires-4, and 5-ember vs 4-ember).

So for test 4:
- Source: "The Dragonblade requires 4 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."
- LLM: "The Dragonblade requires 5 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."
- expectedFacts: ["Dragonblade"]
- plantedFalseFacts: []

Faithfulness check:
- No planted false facts to check.
- Quantity claims in answer: "5 Ember" → num=5, unit="ember"
- Look for `\b(\d+)\s+ember\b` in source: finds "4 Ember" → srcNum=4, claim.num=5 → MISMATCH
- totalChecks = 1, passedChecks = 0 → score = 0

Also check: are there other digit-word pairs in the answer? Let me scan: "The Dragonblade requires 5 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."
- "5 Ember" → yes
- Any others? No other digits.

So faithfulnessScore = 0, helpfulnessScore = 1 (assuming "Dragonblade" is in the answer), finalScore = 0 < 0.8 ✓

And the `missed` array should contain something like "quantity mismatch: answer says \"5 ember\", source says \"4 ember\"".

Wait, I need to verify: the faithfulnessJudge's `missed` array. Looking at the code:
```
missed.push(`quantity mismatch: answer says "${claim.num} ${claim.unit}", source says "${srcNum} ${claim.unit}"`);
```

So it would be: `quantity mismatch: answer says "5 ember", source says "4 ember"`

The test should verify that `missed` contains a string with both "5" and "4". I'll check that the missed array has an entry that contains both numbers.

**Test 5: Quantity match is not penalised**
- Source: "The Dragonblade requires 4 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."
- LLM: "The Dragonblade requires 4 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."
- expectedFacts: ["Dragonblade"]
- plantedFalseFacts: []

Same as test 4 but with "4" instead of "5". The sentence is grounded (100% overlap).
- Quantity claim: "4 Ember" → num=4, unit="ember". Source has "4 Ember" → srcNum=4 = claim.num → no mismatch.
- totalChecks = 1, passedChecks = 1 → score = 1
- finalScore = min(1, 1) = 1 ✓

**Test 6: finalScore is the minimum, not the maximum**
- I need a scenario where helpfulness = 1 but faithfulness < 1, and verify finalScore equals faithfulness.
- Source: "The Dragonblade requires 4 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."
- LLM: "The Dragonblade requires 5 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."
- expectedFacts: ["Dragonblade", "Forge of Ashes"]
- plantedFalseFacts: []

Helpfulness: "dragonblade" ✓, "forge of ashes" ✓ → score 1
Faithfulness: quantity mismatch (5 vs 4) → score 0
finalScore = min(1, 0) = 0

I assert that finalScore === faithfulnessScore (which is 0), not helpfulnessScore (which is 1).

Actually, let me make it a bit more nuanced. What if faithfulness is 0.5 (not 0)? That would be a stronger test of min vs max.

For faithfulness = 0.5, I need 2 checks with 1 passing and 1 failing. I could have:
- 1 planted false fact that's absent (passes)
- 1 quantity mismatch (fails)
→ score = 1/2 = 0.5

Let me design:
- Source: "The Dragonblade requires 4 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."
- LLM: "The Dragonblade requires 5 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."
- expectedFacts: ["Dragonblade", "Forge of Ashes"]
- plantedFalseFacts: ["Crystal Key"]

Helpfulness: "dragonblade" ✓, "forge of ashes" ✓ → 1
Faithfulness: 
- "crystal key" in answer? No → passes (1 check)
- Quantity: "5 ember" vs source "4 ember" → mismatch (1 check)
- totalChecks = 2, passedChecks = 1 → score = 0.5

finalScore = min(1, 0.5) = 0.5

I assert finalScore === 0.5, which equals faithfulnessScore and is NOT helpfulnessScore (1).

**Test 7: Boundary score exactly at PASS_THRESHOLD passes**
- I need finalScore === 0.8 exactly.
- For faithfulness: if totalChecks = 5 and passedChecks = 4, score = 4/5 = 0.8.
- Or for helpfulness: if expectedFacts has 5 items and 4 are matched, score = 4/5 = 0.8.

Let me use helpfulness: 5 expected facts, 4 present → helpfulness = 0.8.
Faithfulness: no planted false facts, no quantity claims → score = 1.
finalScore = min(0.8, 1) = 0.8 → passed should be true (≥ 0.8).

Scenario:
- Source: "The Dragonblade requires 4 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."
- LLM: "The Dragonblade requires 4 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."
- expectedFacts: ["Dragonblade", "Ember Shards", "Forge of Ashes", "volcanic glass", "nonexistent fact"]
- plantedFalseFacts: []

Helpfulness: 4/5 = 0.8
Faithfulness: no checks → 1
finalScore = min(0.8, 1) = 0.8
passed = 0.8 >= 0.8 → true ✓

Wait, but I need to make sure the LLM response is grounded. It's verbatim from the source, so 100% overlap. Good.

And "nonexistent fact" is not in the answer, so it's missed. The other 4 are present.

Let me verify each:
- "dragonblade" in "the dragonblade requires 4 ember shards to forge at the forge of ashes where the blade is tempered in volcanic glass." → yes
- "ember shards" → yes
- "forge of ashes" → yes
- "volcanic glass" → yes
- "nonexistent fact" → no

4/5 = 0.8 ✓

**Test 8: Multiple scenarios return one EvalResult each, in input order**
- Use GOLDEN_SCENARIOS (3 scenarios) with a ScriptedLLMClient that has 3 replies.
- Assert the returned array has length 3 and scenarioId at each index matches.

But wait, the golden scenarios have different needs. The ScriptedLLMClient returns replies in order regardless of what prompt is passed. So I just need 3 replies.

I'll use:
- Reply 1 (for "dragonblade-correct"): "The Dragonblade requires 4 Ember Shards to forge at the Forge of Ashes."
- Reply 2 (for "ashen-keep-lie"): "The Ashen Keep is accessible from level 12 onwards."
- Reply 3 (for "vault-no-source"): "I don't know about that."

Actually, the content of the replies doesn't matter for this test - I'm just checking the structure (length and order). Let me use simple replies.

But wait, I need to make sure the ScriptedLLMClient doesn't throw. It needs exactly 3 replies for 3 scenarios.

**Test 9: ScriptedLLMClient exhaustion propagates**
- 2 scenarios, but ScriptedLLMClient with only 1 reply.
- The second `answer()` call should throw "ScriptedLLMClient exhausted".
- I should assert that the error is thrown (using `expect(...).rejects.toThrow(...)` or similar).

**Test 10: Empty plantedFalseFacts and no quantity claims → faithfulness is 1**
- A scenario where plantedFalseFacts is [] and the grounded answer has no digit-unit pairs.
- Source: "The Riverbend area features lush vegetation and several fishing spots along the eastern shore."
- LLM: "The Riverbend area features lush vegetation and several fishing spots along the eastern shore."
- expectedFacts: ["Riverbend"]
- plantedFalseFacts: []

The answer has no digits, so no quantity claims. No planted false facts.
Faithfulness: totalChecks = 0 → score = 1 (the `totalChecks === 0 ? 1` branch) ✓

Now let me also verify grounding for this:
LLM content words: riverbend, area, features, lush, vegetation, several, fishing, spots, along, eastern, shore
Bigrams: riverbend-area, area-features, features-lush, lush-vegetation, vegetation-several, several-fishing, fishing-spots, spots-along, along-eastern, eastern-shore (10 bigrams)

Source content words: same (it's verbatim)
Source bigrams: same 10 bigrams

Overlap: 10/10 = 100% ✓

Now let me write the test file. I'll use Vitest with `describe`, `it`, `expect`.

Let me also think about imports:
- `runEval` from `../src/eval/harness`
- `PASS_THRESHOLD` from `../src/eval/harness`
- `ScriptedLLMClient` from `../src/llm-client`
- `GOLDEN_SCENARIOS` from `../src/eval/scenarios`
- `Scenario` type from `../src/eval/scenarios`
- `Source` type from `../src/sources`

Wait, looking at the layout convention: `test/<feature>.spec.ts`. But the plan says `test/eval.test.ts` and `test/answer.test.ts`. I'll follow the plan.

Actually wait, the convention says `test/<feature>.spec.ts` but the plan explicitly names `test/eval.test.ts`. The task says "Write exactly one file: `test/eval.test.ts`" so I'll use that name.

Let me also think about whether I need to import `faithfulnessJudge` directly for test 4 (checking the `missed` array). Looking at the test case: "the verdict's `missed` array must contain a string identifying both numbers."

But `runEval` only returns `EvalResult` which has scores, not verdicts. So to check the `missed` array, I'd need to call `faithfulnessJudge` directly.

Let me re-read the test case: "A scripted LLM that says '5 shards' while the source says '4 shards' causes `faithfulnessScore` < 0.8 (quantity mismatch caught exactly)."

And the case description: "the verdict's `missed` array must contain a string identifying both numbers"

So I should call `faithfulnessJudge` directly for this assertion. Let me import it.

Actually, I can do both: use `runEval` to check the score, and also call `faithfulnessJudge` directly to check the missed array. Or I can just call `faithfulnessJudge` directly for the detailed assertion.

Let me structure it as: use `runEval` for the score assertion, and separately call `faithfulnessJudge` for the `missed` array assertion.

Now let me write the complete file:

```ts
import { describe, it, expect } from "vitest";
import { runEval, PASS_THRESHOLD } from "../src/eval/harness";
import { ScriptedLLMClient } from "../src/llm-client";
import { GOLDEN_SCENARIOS } from "../src/eval/scenarios";
import type { Scenario } from "../src/eval/scenarios";
import type { Source } from "../src/sources";
import { faithfulnessJudge } from "../src/eval/judges";

// Helper to create a scenario
function makeScenario(overrides: Partial<Scenario> & Pick<Scenario, "id" | "question" | "sources">): Scenario {
  return {
    expectedFacts: [],
    plantedFalseFacts: [],
    ...overrides,
  };
}

describe("runEval", () => {
  it("confident-lie scores below threshold", async () => {
    const sources: Source[] = [
      {
        id: "src-1",
        title: "Ashen Keep",
        text: "The Ashen Keep is accessible from level 12 onwards. The Crystal Key is not needed for entry.",
      },
    ];
    const scenario: Scenario = {
      id: "lie-test",
      question: "How do I enter the Ashen Keep?",
      sources,
      expectedFacts: ["level 12"],
      plantedFalseFacts: ["crystal key is required"],
    };
    const llm = new ScriptedLLMClient([
      "The Ashen Keep is accessible from level 12 onwards and the Crystal Key is required for entry.",
    ]);

    const results = await runEval([scenario], llm);

    expect(results).toHaveLength(1);
    expect(results[0].finalScore).toBeLessThan(PASS_THRESHOLD);
  });

  it("correct grounded answer scores at or above threshold", async () => {
    const sources: Source[] = [
      {
        id: "src-1",
        title: "Ashen Keep",
        text: "The Ashen Keep is accessible from level 12 onwards. No special items are required to enter.",
      },
    ];
    const scenario: Scenario = {
      id: "correct-test",
      question: "How do I enter the Ashen Keep?",
      sources,
      expectedFacts: ["level 12"],
      plantedFalseFacts: ["requires the Crystal Key"],
    };
    const llm = new ScriptedLLMClient([
      "The Ashen Keep is accessible from level 12 onwards. No special items are required to enter.",
    ]);

    const results = await runEval([scenario], llm);

    expect(results).toHaveLength(1);
    expect(results[0].finalScore).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    expect(results[0].passed).toBe(true);
  });

  it("sources-lack-answer yields refusal and a low helpfulness score", async () => {
    const sources: Source[] = [
      {
        id: "src-riverbend",
        title: "Riverbend",
        text: "The Riverbend area features lush vegetation and several fishing spots along the eastern shore.",
      },
    ];
    const scenario: Scenario = {
      id: "no-source-test",
      question: "What secret password opens the Vault of Whispers?",
      sources,
      expectedFacts: ["Vault of Whispers"],
      plantedFalseFacts: [],
    };
    const llm = new ScriptedLLMClient([
      "The password to open the Vault of Whispers is ancient and mysterious.",
    ]);

    const results = await runEval([scenario], llm);

    expect(results).toHaveLength(1);
    expect(results[0].helpfulnessScore).toBe(0);
    expect(results[0].finalScore).toBeLessThan(PASS_THRESHOLD);
  });

  it("quantity mismatch is caught exactly", async () => {
    const sources: Source[] = [
      {
        id: "src-dragonblade",
        title: "Dragonblade",
        text: "The Dragonblade requires 4 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass.",
      },
    ];
    const scenario: Scenario = {
      id: "qty-mismatch",
      question: "How many Ember Shards do I need?",
      sources,
      expectedFacts: ["Dragonblade"],
      plantedFalseFacts: [],
    };
    const llm = new ScriptedLLMClient([
      "The Dragonblade requires 5 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass.",
    ]);

    const results = await runEval([scenario], llm);

    expect(results).toHaveLength(1);
    expect(results[0].faithfulnessScore).toBeLessThan(PASS_THRESHOLD);

    // Verify the missed array identifies both numbers
    const verdict = faithfulnessJudge(
      "The Dragonblade requires 5 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass.",
      sources,
      [],
    );
    expect(verdict.missed).toHaveLength(1);
    expect(verdict.missed[0]).toContain("5");
    expect(verdict.missed[0]).toContain("4");
  });

  it("quantity match is not penalised", async () => {
    const sources: Source[] = [
      {
        id: "src-dragonblade",
        title: "Dragonblade",
        text: "The Dragonblade requires 4 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass.",
      },
    ];
    const scenario: Scenario = {
      id: "qty-match",
      question: "How many Ember Shards do I need?",
      sources,
      expectedFacts: ["Dragonblade"],
      plantedFalseFacts: [],
    };
    const llm = new ScriptedLLMClient([
      "The Dragonblade requires 4 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass.",
    ]);

    const results = await runEval([scenario], llm);

    expect(results).toHaveLength(1);
    expect(results[0].faithfulnessScore).toBe(1);
  });

  it("finalScore is the minimum, not the maximum", async () => {
    const sources: Source[] = [
      {
        id: "src-dragonblade",
        title: "Dragonblade",
        text: "The Dragonblade requires 4 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass.",
      },
    ];
    const scenario: Scenario = {
      id: "min-test",
      question: "How do I forge the Dragonblade?",
      sources,
      expectedFacts: ["Dragonblade", "Forge of Ashes"],
      plantedFalseFacts: ["Crystal Key"],
    };
    const llm = new ScriptedLLMClient([
      "The Dragonblade requires 5 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass.",
    ]);

    const results = await runEval([scenario], llm);

    expect(results).toHaveLength(1);
    const r = results[0];
    // helpfulness should be 1 (both expected facts present)
    expect(r.helpfulnessScore).toBe(1);
    // faithfulness should be 0.5 (1 of 2 checks pass: "crystal key" absent, but quantity mismatch)
    expect(r.faithfulnessScore).toBe(0.5);
    // finalScore must equal the minimum
    expect(r.finalScore).toBe(0.5);
    expect(r.finalScore).toBe(Math.min(r.helpfulnessScore, r.faithfulnessScore));
  });

  it("boundary: score exactly at PASS_THRESHOLD passes", async () => {
    const sources: Source[] = [
      {
        id: "src-dragonblade",
        title: "Dragonblade",
        text: "The Dragonblade requires 4 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass.",
      },
    ];
    const scenario: Scenario = {
      id: "boundary-test",
      question: "Tell me about the Dragonblade.",
      sources,
      expectedFacts: ["Dragonblade", "Ember Shards", "Forge of Ashes", "volcanic glass", "nonexistent fact"],
      plantedFalseFacts: [],
    };
    const llm = new ScriptedLLMClient([
      "The Dragonblade requires 4 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass.",
    ]);

    const results = await runEval([scenario], llm);

    expect(results).toHaveLength(1);
    expect(results[0].helpfulnessScore).toBe(0.8);
    expect(results[0].finalScore).toBe(PASS_THRESHOLD);
    expect(results[0].passed).toBe(true);
  });

  it("multiple scenarios return one EvalResult each, in input order", async () => {
    const llm = new ScriptedLLMClient(["a", "b", "c"]);
    const results = await runEval(GOLDEN_SCENARIOS, llm);

    expect(results).toHaveLength(3);
    expect(results[0].scenarioId).toBe(GOLDEN_SCENARIOS[0].id);
    expect(results[1].scenarioId).toBe(GOLDEN_SCENARIOS[1].id);
    expect(results[2].scenarioId).toBe(GOLDEN_SCENARIOS[2].id);
  });

  it("ScriptedLLMClient exhaustion propagates", async () => {
    const llm = new ScriptedLLMClient(["only one reply"]);
    const scenarios: Scenario[] = [
      {
        id: "s1",
        question: "q1",
        sources: [{ id: "src1", title: "T1", text: "Some text here for grounding purposes." }],
        expectedFacts: [],
        plantedFalseFacts: [],
      },
      {
        id: "s2",
        question: "q2",
        sources: [{ id: "src2", title: "T2", text: "More text here for grounding purposes." }],
        expectedFacts: [],
        plantedFalseFacts: [],
      },
    ];

    await expect(runEval(scenarios, llm)).rejects.toThrow("ScriptedLLMClient exhausted");
  });

  it("empty plantedFalseFacts and no quantity claims yields faithfulness of 1", async () => {
    const sources: Source[] = [
      {
        id: "src-riverbend",
        title: "Riverbend",
        text: "The Riverbend area features lush vegetation and several fishing spots along the eastern shore.",
      },
    ];
    const scenario: Scenario = {
      id: "no-qty-test",
      question: "What is Riverbend like?",
      sources,
      expectedFacts: ["Riverbend"],
      plantedFalseFacts: [],
    };
    const llm = new ScriptedLLMClient([
      "The Riverbend area features lush vegetation and several fishing spots along the eastern shore.",
    ]);

    const results = await runEval([scenario], llm);

    expect(results).toHaveLength(1);
    expect(results[0].faithfulnessScore).toBe(1);
  });
});
```

Wait, I need to double-check a few things:

1. For test 3 (sources-lack-answer), I need to verify that the LLM response is actually ungrounded. The source is about Riverbend (vegetation, fishing spots, eastern shore) and the LLM says "The password to open the Vault of Whispers is ancient and mysterious."

LLM content words: password, open, vault, whispers, ancient, mysterious
Bigrams: password-open, open-vault, vault-whispers, whispers-ancient, ancient-mysterious (5 bigrams)

Source content words: riverbend, area, features, lush, vegetation, several, fishing, spots, along, eastern, shore
Source bigrams: riverbend-area, area-features, features-lush, lush-vegetation, vegetation-several, several-fishing, fishing-spots, spots-along, along-eastern, eastern-shore (10 bigrams)

Overlap: 0/5 = 0% < 70%. Not grounded! ✓ Refusal triggered.

2. For test 8, the replies "a", "b", "c" are single words. Let me check if they'd cause any issues. A single word has no bigrams, so `gateSentences` would... hmm, what happens with 0 bigrams? If totalBigrams is 0, the overlap calculation would be 0/0. 

Looking at the plan: "grounded = (maxOverlap / totalBigrams) ≥ 0.7". If totalBigrams is 0, this is undefined/NaN. The implementation might handle this as grounded (vacuously true) or ungrounded.

Actually, for a single word like "a", it's likely a stop word, so there are 0 content words and 0 bigrams. The behavior depends on implementation.

But for test 8, I don't care about the scores - I just care about the structure (length and order). So even if all sentences are ungrounded and all answers are refusals, the test should still pass because I'm only checking `scenarioId` values.

Actually wait, could there be an issue where `runEval` throws if something goes wrong with a 0-bigram sentence? Let me think... The `answer()` function would call `gateSentences`, which would return sentences with `grounded: false` (or however it handles 0 bigrams). Then `groundedOnly` would return an empty array, and `answer()` would return the refusal. Then the judges run on "not covered by my sources". No exceptions should be thrown.

So test 8 should be fine with single-word replies.

3. For test 9 (exhaustion), the first scenario gets "only one reply" which is a single word. The second scenario tries to call `generate` but the client is exhausted. The error should propagate from `runEval`.

But wait - will the first `answer()` call succeed? With "only one reply" as the LLM response, it's a single word. As discussed, it would likely result in refusal (no grounded sentences). But the `answer()` call itself completes without error. Then the second `answer()` call throws. Since `runEval` doesn't catch errors (per the plan), the error propagates.

Actually, I need to verify: does `runEval` have a try/catch? Looking at the harness code:
```ts
for (const scenario of scenarios) {
    const result = await answer(...);
    // ...
}
```

No try/catch. So the error from the second `answer()` call propagates out of `runEval`. ✓

4. Let me double-check test 6 (min not max). The LLM response is:
"The Dragonblade requires 5 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."

I need to verify it's grounded. As I calculated earlier, 9/11 = 81.8% ≥ 70%. ✓

Helpfulness: 
- "dragonblade" in lowercased answer? Yes.
- "forge of ashes" in lowercased answer? Let me check: "the dragonblade requires 5 ember shards to forge at the forge of ashes where the blade is tempered in volcanic glass." → "forge of ashes" is present. Yes.
- Score: 2/2 = 1 ✓

Faithfulness:
- plantedFalseFacts: ["Crystal Key"]. "crystal key" in answer? No. → passes.
- Quantity: "5 ember" → num=5, unit="ember". Source has "4 ember" → mismatch.
- totalChecks = 2, passedChecks = 1 → score = 0.5 ✓

finalScore = min(1, 0.5) = 0.5 ✓

5. Let me verify test 7 (boundary). The answer is:
"The Dragonblade requires 4 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."

Lowercased: "the dragonblade requires 4 ember shards to forge at the forge of ashes where the blade is tempered in volcanic glass."

Expected facts:
- "dragonblade" → yes
- "ember shards" → yes ("4 ember shards" contains "ember shards")
- "forge of ashes" → yes
- "volcanic glass" → yes
- "nonexistent fact" → no

4/5 = 0.8 ✓

Faithfulness:
- No planted false facts.
- Quantity: "4 ember" → num=4, unit="ember". Source has "4 ember" → match.
- totalChecks = 1, passedChecks = 1 → score = 1

finalScore = min(0.8, 1) = 0.8 = PASS_THRESHOLD → passed = true ✓

6. Now let me reconsider test 1 (confident-lie). I need to make sure the planted false fact "crystal key is required" is actually a substring of the answer.

Answer: "The Ashen Keep is accessible from level 12 onwards and the Crystal Key is required for entry."
Lowercased: "the ashen keep is accessible from level 12 onwards and the crystal key is required for entry."

"crystal key is required" → let me check: "...the crystal key is required for entry..." → yes, "crystal key is required" is a substring. ✓

And I verified earlier that the sentence is grounded (7/9 = 77.8%). ✓

Wait, let me recount for this specific sentence:
"The Ashen Keep is accessible from level 12 onwards and the Crystal Key is required for entry."

Content words (removing the, is, from, and, for): ashen, keep, accessible, level, 12, onwards, crystal, key, required, entry

Hmm wait, "the" appears twice. Let me list all words: the, ashen, keep, is, accessible, from, level, 12, onwards, and, the, crystal, key, is, required, for, entry

Stop words (typical): the, is, from, and, for
Content words: ashen, keep, accessible, level, 12, onwards, crystal, key, required, entry (10 words)

Bigrams: ashen-keep, keep-accessible, accessible-level, level-12, 12-onwards, onwards-crystal, crystal-key, key-required, required-entry (9 bigrams)

Source: "The Ashen Keep is accessible from level 12 onwards. The Crystal Key is not needed for entry."
Content words: ashen, keep, accessible, level, 12, onwards, crystal, key, needed, entry (10 words)
Bigrams: ashen-keep, keep-accessible, accessible-level, level-12, 12-onwards, onwards-crystal, crystal-key, key-needed, needed-entry (9 bigrams)

Overlap: ashen-keep ✓, keep-accessible ✓, accessible-level ✓, level-12 ✓, 12-onwards ✓, onwards-crystal ✓, crystal-key ✓, key-required ✗ (source has key-needed), required-entry ✗ (source has needed-entry)

= 7/9 = 77.8% ≥ 70%. Grounded! ✓

Helpfulness: "level 12" in answer? "the ashen keep is accessible from level 12 onwards and the crystal key is required for entry." → yes, "level 12" is present. Score = 1/1 = 1.

Faithfulness:
- "crystal key is required" in answer? Yes → fails. (1 check)
- Quantity: "12 onwards" → num=12, unit="onwards". Look for `\b(\d+)\s+onwards\b` in source. Source: "level 12 onwards" → matches "12 onwards" → srcNum=12 = claim.num=12. Match! (1 check, passes)

Wait, so totalChecks = 2, passedChecks = 1 → score = 0.5.

finalScore = min(1, 0.5) = 0.5 < 0.8 ✓

Good, still below threshold.

Hmm wait, but actually I need to double-check: does "12 onwards" get extracted from the answer? The answer is "The Ashen Keep is accessible from level 12 onwards and the Crystal Key is required for entry."

The regex `\b(\d+)\s+([a-zA-Z]+)\b` would find "12 onwards" (12 followed by space followed by "onwards"). Yes.

And in the source "The Ashen Keep is accessible from level 12 onwards. The Crystal Key is not needed for entry.", the pattern `\b(\d+)\s+onwards\b` (case insensitive) would find "12 onwards". Yes.

So srcNum = 12, claim.num = 12. Match. No mismatch.

So faithfulness has 2 checks: 1 fail (false fact present), 1 pass (quantity match). Score = 1/2 = 0.5.

finalScore = min(1, 0.5) = 0.5 < 0.8. ✓

This works but the faithfulness score is 0.5, not 0. That's fine - the test just needs it below threshold.

Actually wait, I realize I should double-check whether "12 onwards" is really what gets matched. Let me look at the regex more carefully: `\b(\d+)\s+([a-zA-Z]+)\b`

In "level 12 onwards and the Crystal Key":
- "12 onwards" matches: \b before 12, then \d+ = "12", then \s+ = " ", then [a-zA-Z]+ = "onwards", then \b. Yes.

But wait, would it also try to match "12" with something else? No, the regex engine moves left to right and finds "12 onwards" first.

OK, I'm satisfied with test 1.

7. One more check for test 4 (quantity mismatch). I claimed the sentence is grounded at 9/11 = 81.8%. Let me verify the faithfulness judge would correctly identify the mismatch.

Answer: "The Dragonblade requires 5 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."

Quantity regex `\b(\d+)\s+([a-zA-Z]+)\b` on this text:
- "5 Ember" → num=5, unit="ember" (lowercased from "Ember")

Wait, the regex captures `([a-zA-Z]+)` which would be "Ember" (capital E). Then the code does `m[2].toLowerCase()` → "ember".

Then it builds source pattern: `\b(\d+)\s+ember\b` (with escapeRegex("ember") = "ember", and the "i" flag).

In source: "The Dragonblade requires 4 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."
Pattern `\b(\d+)\s+ember\b` with "i" flag: finds "4 Ember" → srcNum=4.

claim.num=5, srcNum=4 → mismatch! ✓

The missed entry: `quantity mismatch: answer says "5 ember", source says "4 ember"`

This contains both "5" and "4". ✓

Are there any other digit-word pairs in the answer? Let me scan: "The Dragonblade requires 5 Ember Shards to forge at the Forge of Ashes where the blade is tempered in volcanic glass."
- Only "5 Ember". No other digits. ✓

So totalChecks = 1 (just the quantity check, since plantedFalseFacts is empty), passedChecks = 0 → score = 0.

finalScore = min(1, 0) = 0 < 0.8 ✓

Great, all tests check out. Let me write the final file.

Actually, one more thought: for test 8, I'm using `GOLDEN_SCENARIOS` which has 3 scenarios. The ScriptedLLMClient gets 3 replies: "a", "b", "c". Each is a single word. As I discussed, a single word likely has 0 content-word bigrams (or the word itself might be a stop word). The behavior with 0 bigrams is implementation-dependent, but the test only checks structure (length and order), not scores. So it should be safe.

But wait - what if the implementation throws on 0 bigrams (division by zero)? Let me think... The plan says "grounded = (maxOverlap / totalBigrams) ≥ 0.7". If totalBigrams is 0, this would be NaN or Infinity depending on implementation. In JavaScript, `0/0` is `NaN`, and `NaN >= 0.7` is `false`. So the sentence would be ungrounded. No exception thrown.

Actually, for a single word like "a", if it's a stop word, there are 0 content words and 0 bigrams. `0/0` = NaN in JS. `NaN >= 0.7` is false. So grounded = false. The sentence is ungrounded. `answer()` returns refusal. No exception.

But what if the word is NOT a stop word? Like "x"? Then there's 1 content word and 0 bigrams (you need at least 2 words for a bigram). Same situation: 0 bigrams, NaN, ungrounded.

So in all cases, single-word replies lead to refusal without exception. Test 8 is safe.

Let me finalize the file.
```

## reply

```typescript
import { describe, it, expect } from "vitest";
import { runEval, PASS_THRESHOLD } from "../src/eval/harness";
import { ScriptedLLMClient } from "../src/llm-client";
import { GOLDEN_SCENARIOS } from "../src/eval/scenarios";
import type { Scenario } from "../src/eval/scenarios";
import type { Source } from "../src/sources";
import { faithfulnessJudge } from "../src/eval/judges";

describe("runEval", () => {
  it("confident-lie scores below threshold", async () => {
    const sources: Source[] = [
      {
        id: "src-ashen",
        title: "Ashen Keep",
        text: "The Ashen Keep is accessible from level 12 onwards. The Crystal Key is not needed for entry.",
      },
    ];
    const scenario: Scenario = {
      id: "lie-test",
      question: "How do I enter the Ashen Keep?",
      sources,
      expectedFacts: ["level 12"],
      plantedFalseFacts: ["crystal key is required"],
    };
    const llm = new ScriptedLLMClient([
      "The Ashen Keep is accessible from level 12 onwards and the Crystal Key is required for entry.",
    ]);

    const results = await runEval([scenario], llm);

    expect(results).toHaveLength(1);
    expect(results[0].finalScore).toBeLessThan(PASS_THRESHOLD);
  });

  it("correct grounded answer scores at or above threshold", async () => {
    const sources: Source[] = [
      {
        id: "src-ashen",
        title: "Ashen Keep",
        text: "The Ashen Keep is accessible from level 12 onwards. No special items are required to enter.",
      },
    ];
    const scenario: Scenario = {
      id: "correct-test",
      question: "How do I enter the Ashen Keep?",
      sources,
      expectedFacts: ["level 12"],
      plantedFalseFacts: ["requires the Crystal Key"],
    };
    const llm = new ScriptedLLMClient([
      "The Ashen Keep is accessible from level 12 onwards. No special items are required to enter.",
    ]);

    const results = await runEval([scenario], llm);

    expect(results).toHaveLength(1);
    expect(results[0].finalScore).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    expect(results[0].passed).toBe(true);
  });

  it("sources-lack-answer yields refusal and a low helpfulness score", async () => {
    const sources: Source[] = [
      {
        id: "src-riverbend",
        title: "Riverbend",
        text: "The Riverbend area features lush vegetation and several fishing spots along the eastern shore.",
      },
    ];
    const scenario: Scenario = {
      id: "no-source-test",
      question: "What secret password opens the Vault of Whispers?",
      sources,
      expectedFacts: ["Vault of Whispers"],
      plantedFalseFacts
