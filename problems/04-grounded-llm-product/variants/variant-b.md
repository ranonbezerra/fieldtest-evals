# Variant B — Internal policy support bot

Build the answer pipeline + eval harness for an HR/IT policy bot. Input: employee
question + the 2–4 policy document excerpts retrieval returned (fixtures).
Output: an answer grounded ONLY in those excerpts. Wrong policy answers create
legal exposure, so an unsupported answer is worse than no answer. There is also a
"manager mode" restriction: some excerpts are marked manager-only and their
content must never appear in answers to non-managers.

In **TypeScript**, deliver:

1. `answer(question, excerpts, role)` with an injectable (fake) LLM client and a
   sentence-level grounding gate; ungrounded content is removed or the bot
   answers "this isn't covered by the policies I have — contact HR".
2. Role restriction enforced by filtering/redaction in code, not by prompt.
3. Eval harness: golden scenarios with expected facts and planted FALSE facts
   (e.g., an invented reimbursement limit); helpfulness judge + faithfulness
   judge that sees the excerpts; final = min(helpful, faithful).
4. Tests proving: confident invented-policy answer fails; grounded answer passes;
   missing-coverage yields refusal; a manager-only fact leaking to an employee
   role fails the scenario outright; numeric limits checked exactly.
