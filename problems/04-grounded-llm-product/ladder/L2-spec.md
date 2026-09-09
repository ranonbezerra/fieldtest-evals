# Issue #77 — The guide assistant invents item requirements, and hint mode leaks bosses

**Repo:** `guide-assistant` · **Labels:** `bug` `trust` `blocker`
**Reported by:** community team · **Diagnosed by:** platform

---

## What is happening

Two complaints from the same week.

**A player was told to farm an item that does not exist in the game.** The wiki pages
we fetched said nothing about it. The model produced a fluent, confident paragraph and
we shipped it verbatim. We have no way to tell, today, whether an answer is supported
by the pages we retrieved — we only know the pages went into the prompt.

**Hint mode spoiled a boss.** It is supposed to give a nudge without revealing boss
names, item locations, or quantities the player has not already mentioned. It is
currently implemented by asking the model a second time with "be vague", and the
second answer is a fresh generation with fresh opportunities to reveal things — and to
invent them.

There is a third failure our current eval cannot see. A judge that scores an answer
without the sources in front of it rates confidence and fluency, which is exactly what
a hallucination has most of. Our scores went up while these two incidents happened.

## What we need

### 1. A sentence-level grounding gate on the production path

`answer(question, sources, mode)` behind an injectable LLM client — a scripted fake is
fine and is what the tests should use.

Check each sentence of the model's answer against the source texts. A sentence whose
claims the sources do not support is dropped. If nothing survives, the service refuses:
**"not covered by my sources"**. Refusing is a correct outcome, not a failure path —
the alternative is what caused the first incident.

Numbers and quantities need checking exactly. "5 shards" when the page says 4 is the
failure that looks most like success.

### 2. Hint mode is a redaction of the grounded answer

Derive it from the answer that already passed the gate, by removing what must not be
revealed. **No second LLM call.** A second generation can invent; a redaction cannot.

The redaction has to actually redact. Whatever rule you choose — proper nouns, entity
classes, quantities not present in the player's question — write a test that feeds it a
sentence containing a boss name, a location and a quantity and asserts all three are
gone from the output.

### 3. A judge that sees the sources

The faithfulness judge receives the source texts. This is the fix for the third
failure: a judge without them is scoring style.

Score helpfulness and faithfulness separately and combine them as **`min(helpful,
faithful)`**. A confident useless refusal and a fluent lie should both score low, and
averaging lets the second one hide.

### 4. Golden scenarios with planted false facts

Each scenario carries the question, the sources, the facts the answer should contain,
and **facts that are false** — an invented item requirement, a wrong quantity, a
misattributed location. Include a scenario whose sources do not contain the answer at
all, so refusal is the correct output and the harness scores it as such.

## Acceptance

- A scripted confident lie scores low
- A correct grounded answer scores high
- Sources that lack the answer → refusal, scored as correct
- "5 shards" against sources saying 4 → caught, exactly
- Hint mode output contains no boss name, no location, no unmentioned quantity
- The faithfulness judge's signature takes the sources

## Deliverables

`answer(question, sources, mode)` with the grounding gate · the redaction-based hint
mode · the eval harness with golden scenarios and both judges · tests for the
acceptance cases above.

## Notes

TypeScript. The LLM client is an interface with a scriptable fake — no network in
tests, and the fake must return a specific answer per scenario so a confident lie can
be planted.
