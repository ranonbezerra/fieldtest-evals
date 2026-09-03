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
manifest declares.**

Problem 03 shows that is too narrow. Its failures are method-level: the repository file
exists, is declared, is imported — and simply does not have `reDeriveWindow` on it. The
services were written in later phases against methods the earlier phase never wrote,
and `tsc` never caught it because the imports did not resolve.

So the check is: **every method a later phase calls on an earlier phase's class must
exist in the interface the plan gave that class.** The plan carries those signatures.
Same document, same mechanical reading, as §1 and this section already argue for.

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

**Measured, on all five valid runs.** One line of `tsconfig.json` —
`moduleResolution: bundler` with `module: ESNext` — against the compiler, no model
time:

| run | NodeNext | bundler |
|---|--:|--:|
| 01 payout outbox | 6 | 6 |
| 02 reconciliation resend | 0 | 0 |
| 03 read model projection | 31 | **8** |
| 04 grounded llm product | 0 | 0 |
| 05 on-chain anchoring | 17 | **2** |

It removes the entire error class and touches nothing that already compiled, because
`bundler` accepts both conventions — it punishes neither the runs that wrote `.js` nor
the ones that did not.

What it leaves behind is worth judging. Problem 05's two remaining errors are
`'ChainClient' only refers to a type, but is being used as a value` — the interface
used as a NestJS injection token, which does not exist at runtime. That is a real
misunderstanding of the framework, and it is what the run should have been failing on
instead of seventeen complaints about file extensions.

The decision is between two different measurements, and it should be made on purpose:

- **Keep `NodeNext`** and add the consequence to the cheatsheet — it already says
  `ESM, "type": "module"` and the model still omits the extension in half the runs, so
  this measures whether it follows an explicit instruction about its environment.
- **Move to `bundler`** and take the question off the test. Defensible because
  `"type": "module"` was the harness's choice and an unusual one: an idiomatic NestJS
  project is CommonJS, which is what the model writes.

Not applied to this pass. Unlike the `--max-files` fix, this changes results already
recorded — problems 03 and 05 would go from 31 and 17 errors to 8 and 2.

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
