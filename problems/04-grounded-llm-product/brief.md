# 04 — Grounded LLM answers + an eval that can't be fooled

## The real situation

A gameplay-assistant product answers player questions by scraping 2–3 wiki pages
and synthesizing an answer with an LLM. It had an eval harness with an LLM judge,
and the harness looked healthy — until a model swap. The cheaper model that won
the bake-off, once in real use, **hallucinated a game fact with total confidence**
(invented a requirement that doesn't exist in the game). The harness had rated
answers like that highly.

Root cause: the judge never saw the scraped sources. It was grading *confidence
and helpfulness*, not truth. The fix reshaped both the product and the eval:

- **Product side:** answers must be grounded in the fetched sources; a
  token-overlap grounding gate checks each sentence against source text; a
  spoiler-safe "hint" mode must answer without revealing information beyond a
  scope, derived by *redacting from the full answer* (not by asking the model to
  "be vague").
- **Eval side:** a second judge pass that **sees the sources** and scores
  faithfulness only, combined as `min(helpful, faithful)` so confidence can never
  buy back a lie; per-scenario planted false facts (a gabarito of things that are
  NOT true) that any passing answer must not assert; quantity/number checks.

This is "LLM as product" engineering: the model is the easy part; the harness
that refuses to be charmed is the real work.

## Stack

TypeScript, NestJS (or plain Node service). The LLM can be faked with a scripted
client — the eval logic, grounding gate, and judge design are what's being
tested, not prompt vibes.
