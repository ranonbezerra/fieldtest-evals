# Variant A — Game guide assistant

Build the answer pipeline + eval harness for a gameplay assistant. Input: player
question + 2–3 fetched wiki page texts (provided as fixtures). Output: an answer
grounded ONLY in those pages, plus a spoiler-free hint mode that must not reveal
boss names, item locations, or quantities beyond what the player already
mentioned.

In **TypeScript**, deliver:

1. `answer(question, sources, mode)` using an injectable LLM client (a scripted
   fake is fine) with a sentence-level grounding gate: ungrounded sentences are
   dropped or the service refuses with "not covered by my sources".
2. Hint mode derived by redacting the full grounded answer, not by re-prompting.
3. An eval harness: golden scenarios (question, sources, expected facts, planted
   FALSE facts such as an invented item requirement); a helpfulness judge and a
   faithfulness judge that receives the sources; final score = min of the two.
4. Tests proving: a scripted confident-lie answer scores low; a correct grounded
   answer scores high; a scenario whose sources lack the answer yields refusal;
   quantity errors (e.g., "5 shards" when sources say 4) are caught exactly.
