# Variant C — Appliance manual assistant

Build the answer pipeline + eval harness for a product-support assistant that
answers from appliance manuals. Input: user question + the manual sections
retrieval returned (fixtures). Output: an answer grounded ONLY in those
sections. Safety-critical: an invented step (wrong breaker, wrong part number,
skipping "unplug first") can hurt someone, so unsupported instructions must
never ship. There is also a "quick mode" that returns only the numbered steps,
derived from the full answer.

In **TypeScript**, deliver:

1. `answer(question, sections, mode)` with an injectable (fake) LLM client and a
   sentence-level grounding gate; ungrounded sentences are dropped, and if the
   remaining answer is incomplete the service refuses and points to support.
2. Quick mode produced by extracting/redacting from the full grounded answer.
3. Eval harness: golden scenarios with expected facts and planted FALSE facts
   (e.g., an invented part number or torque value); helpfulness judge +
   faithfulness judge that sees the sections; final = min(helpful, faithful).
4. Tests proving: confident invented-step answer fails; grounded answer passes;
   out-of-manual question yields refusal; part numbers and numeric values are
   checked exactly, not by fuzzy similarity.
