# The second pass

Changes the first pass earned and does not get to use. The eighteen problems run
under one fixed configuration, and anything here would alter what a run produces — so
it waits, and it waits in writing rather than in memory.

The rule that decides what belongs here: **observation can be added mid-campaign,
intervention cannot.** Running the suite a model wrote changes only what is known
about a run, so it was added and applied backwards to runs already judged (§3.7).
Repairing against that suite changes the artifact, so it is on this page.

---

## 1. Check the plan against itself before phase 1

**From:** §1.3, and every failed must-have in the first three runs.

All twenty must-haves across three rubrics were named in the plans. The ones that
failed were named *twice*, incompatibly, in different sections — the invariant in
`Ordering rules`, the procedure that breaks it in `Control flow`, and the code
implements whichever form is more executable.

The check is mechanical: take every *must* in the ordering rules, find the numbered
step that implements it, and read them side by side. All three defects are visible in
that one pass, before any code exists.

**Open question this settles:** whether the model can catch its own contradiction when
the two halves are put in front of it together. If it can, this is a cheap phase. If
it cannot, the contradiction is not an attention failure and the finding gets sharper.

## 2. Check the manifest resolves every reference

**From:** problem 01 at `medium`, which satisfied all eight must-haves and did not
compile.

Its plan designed both repositories around `PrismaService`, named it in two
constructor signatures, and never listed `src/prisma/prisma.service.ts` in the
manifest. No phase was asked to write it. Every phase imported it.

Mechanical: **every type named in a constructor signature must resolve to a file the
manifest declares.** Same shape as check 1 — the plan is where a code failure was
already visible.

## 3. Feed the suite back, and record which way it goes

**From:** §3.7 and problem 02, which passed `tsc` and failed its own test for the one
must-have the problem exists to test.

The obvious move is a repair round against failing tests, alongside the typecheck one.
The interesting part is not whether it converges — it is **which artifact it edits.**
Handed `amount mismatch: order is NOT settled and NOT treated as absent`, problem 02
could add the missing `statementMap.has(order.txid)` condition, or delete the
assertion. Both make the suite green.

So the phase has to record the choice, not just the outcome: diff the test files
before and after, and treat *the suite weakening* as a first-class result rather than
as a passing run. A model that repairs its code and a model that repairs its test are
not the same tool, and green tells you nothing about which one you have.

Lint belongs in the same phase, and is not decorative here:
`@typescript-eslint/no-floating-promises` is exactly the class of defect that produced
problem 01's three sequential un-transacted awaits and problem 03's split write path.

## 4. Decide whether `moduleResolution: NodeNext` is measuring the model

**From:** §3.6, at the default effort — where the `.js` extension appeared in phases
06–09 of one run and vanished in the rest, and cost two runs their gate.

At `medium` this stopped: problem 01 carried the extension on 26 of 26 relative
imports. So the scaffold may already be fine and the convention drift may have been a
symptom of the low-effort fallback rather than a property of the model.

The second pass should decide deliberately rather than by inertia: either keep
`NodeNext` because a real ESM project is the honest environment, or move to `bundler`
because the extension is a detail of the harness's scaffold and not of the problem
being posed. Both are defensible. What is not defensible is leaving it unexamined now
that it is known to be load-bearing.

## 5. Measure the two-pass test phase at `medium`

**From:** `harness/README.md`.

The writing pass of the test phase still runs at `low`. That design was built when
test files overflowed at every setting tried, which is no longer true — the case
enumeration fit at `medium` in 4,231 tokens and the write fit at `low` in 8,715.
Whether the write pass also fits at `medium`, and whether it produces a better suite
there, is unmeasured and cheap to measure.

## 6. Reconsider the repair ceiling

**From:** §3.5.

Two repair rounds was set when a repair cost ~19 minutes at the default effort. At
`medium` the runs are shorter and the repairs are cheaper, and problem 01 finished
with six errors outstanding — four of which trace to one missing file. Whether a third
round would have closed it is unknown, and the cap has never been tested against a run
that needed one more.
