# Proposal: measuring what the model chooses to read

Not built. Written down while the reason for it is fresh, so it is a design rather
than a memory.

## The gap

Eight problems (09–16) already hand the model an existing codebase: a NestJS + Drizzle
API with a finished reference module, a React back-office with two domains, a billing
service on Prisma, code with planted bugs. The model modifies real code rather than
starting from nothing.

But it never **chooses** what to look at. The harness gives it exactly the files its
own plan declared under `reads:`, and nothing else. That is deliberate — letting a
model hunt through a repository is what inflates context until the problem statement
is trimmed out of the window, which is the failure the whole phase design exists to
prevent.

The cost of that protection is that a real question cannot be asked:

> Given a codebase larger than its context, what does it open, what does it ignore,
> and does it ask for the right things?

For a model whose context is the binding constraint, that is arguably the most
practically important question there is. A model that opens the schema and the two
call sites is usable on a large codebase. One that asks for forty files, or for none,
is not — and neither failure shows up in a greenfield problem.

## The shape

A phase between 0 and 1, and it is not an agentic loop.

**Give it the tree, not the files.** Paths and sizes only:

```
src/billing/billing.service.ts        4.1 KB
src/billing/billing.repository.ts     2.8 KB
src/common/serializer.ts              0.4 KB
prisma/schema.prisma                  3.2 KB
test/billing.spec.ts                  3.9 KB
... 40 more
```

**Ask it to request.** *"You will implement the task above. Name the files you need to
read, in order of how much you expect each to matter, and one line on why. You may ask
for at most N. You will not get a second chance."*

**Give it exactly what it asked for**, then run phase 0 as normal.

One request in, one list out. Nothing grows, nothing is trimmed, and the choice is
entirely the model's.

## What it measures

| | |
|---|---|
| **Recall** | of the files a correct solution must have read, how many did it ask for? The reference solution already names them |
| **Precision** | how many of its requests were irrelevant? Asking for everything is not reading |
| **Ordering** | it ranks its own requests. Whether the ranking matches what mattered is a separate signal from whether the set does |
| **Calibration** | does it use its budget, exceed it, or ask for two files and guess the rest? |
| **The reasoning** | *"I need the serializer because the response shape is part of the contract"* is a different quality of answer from *"I need all the service files"* |

## Why this is worth a problem rather than only a phase

Problem 12 already has the ideal fixture. Its whole point is that the suite is partial
and the traps live in code no test mentions — the BigInt serializer registered
globally, the line items relying on insertion order, the `null`-versus-thrown call
site. **A model that never asks to see `src/common/serializer.ts` cannot find trap one**,
and today the harness hands it over regardless, which quietly removes the trap.

So the reading phase does not only add a measurement. It restores one that the current
design is suppressing.

## Cost, from measured rates

The tree of a 40-file fixture is roughly 600 tokens in. The reply is a list — a few
hundred out, well under a minute at ~10.6 tok/s. It is the cheapest phase in the run,
and the only one that would have to be added rather than reshaped.

## Open questions, honestly

- **What is N?** Too small and it measures the cap; too large and everyone passes. It
  should probably scale with the fixture and be recorded per problem.
- **Does it get sizes?** Sizes let it budget, and also let it game by picking small
  files. Worth running both ways once.
- **Does a wrong request cost it?** Precision only bites if asking for the wrong file
  spends part of the budget. Otherwise the strategy is always "ask for the maximum".
- **Does this belong to every problem or only to 09–16?** A greenfield problem has no
  tree to read.
