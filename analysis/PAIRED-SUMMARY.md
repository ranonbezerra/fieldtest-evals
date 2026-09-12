# What four paired readings say, after every number said nothing

## Closing figures — 2026-09-12, grid complete

These supersede every partial count in this directory, including the mid-campaign
snapshot at the top of `PAIRED-JUDGING.md`.

    grid                15 problems x 4 repetitions x 2 axes = 120 graded cells
    run directories     132 (ladder 72, model 60)
    cells graded        120 (ladder 60, model 60)

Twelve of the 132 directories are not in the grid: problems **08**, **14** and **16**
produce no TypeScript, so `tsc` does not apply and never did. They are judged by hand
and excluded from every rate below, on both axes equally.

    compile rate        ladder 51/60 = 85%   model 48/60 = 80%   Fisher p = 0.632
    green test suite    ladder 40%           model 38%           Fisher p = 0.838
    suite that fails    11 runs              11 runs
    schema failures     6 of 32              2 of 36             Fisher p = 0.135

Two cells were taken twice, and both re-runs are recorded in the grid rather than
quietly replacing the originals:

| cell | why it was taken again | outcome |
|---|---|---|
| **14 ladder rep3** | our connection dropped; the retry hung on a dead socket until the request ceiling expired, the solution never extracted, and the repair phase wrote source files for a problem whose only deliverable is `REVIEW.md` | re-run delivered `REVIEW.md`, 186 lines — confirming harness damage, not the model |
| **05 ladder rep4** | `IncompleteRead(6776 bytes)` at 1848s, then the provider ended the retry with `finish_reason=error` and no content | re-run **failed legitimately** on 4 type errors; 05 is 4/4 on the ladder because a *separate* provider cut was also taken again |

The rule that selected them is in `harness/ft-netcheck` and is deliberately narrow: a
cell is re-run only when **no** attempt extracted anything, because the repair phase then
works from an empty workspace. Six other cells lost a request to the network, retried,
and were left alone — those are real samples. Two more were degraded (code arrived, the
generation did not end cleanly) and were read rather than re-run; re-running those by
whether the gate passed would have selected on the very number being measured.

Nothing else was re-run. No cell was dropped.

## What the numbers say

Nothing. On every measure available without reading code, the level-2 issue buys
nothing. The jump from the earlier campaigns' 22–25% to the eighties belongs to
provider pinning and the schema-aware set repair, both of which these two axes share.

Anyone stopping here would conclude the issue format is not worth writing.

## Then the same runs, read

| problem | what the axes did |
|---|---|
| **12** orm-migration | Both green. The ladder preserved insertion order for line items; the model axis added the `orderBy` that looked missing and wrote a passing test asserting the new contract. The original reads with no `orderBy` and its suite records the consequence in a comment: *insertion order, as the database returns it*. |
| **09** feature-in-conventions | Both green. The ladder answers a non-member with the same not-found a missing trip gets. The model axis returns 403, in both runs read, with **more** tests than the ladder — 18 and 16 against 19 — certifying an enumeration oracle as correct. |
| **03** read-model-projection | The model axis wins, and wins on substance: tenant isolation, out-of-order events by `occurred_at`, denormalised name sync on rename, stable pagination. The ladder fails three of four on Prisma grammar — a covering index with sort directives split across two lines. |
| **02** reconciliation-resend | The control, where both axes compile 3 of 4. **Both implement the requirement correctly**: neither re-sends an order the bank accepted and the statement has not yet published. The ladder also tests it by name; the model axis leaves it unasserted. |

## What this adds up to

Two clear wins for the issue, one clear loss, one draw.

The two wins share a shape. In both, the model axis produced a **green suite asserting
the wrong contract** — which is worse than an untested gap, because it survives every
gate this repository or any CI would run. On 12 it locks in a behaviour change
consumers depend on not happening; on 09 it certifies an information leak. Neither
shows up in a compile rate, a pass rate, or a test count, and both would reach a human
reviewer wearing a green check.

The loss is mechanical and cheap. The issue asked for recency ordering and stable
pagination; the model reached for a covering index and split a Prisma block attribute
across two lines. `prisma format` fixes it in one call, and the gate does not make that
call.

The draw is the most informative cell in the table. On 02 the compile rates are
identical and **so is the correctness** — the issue bought nothing there but a test
name. So the issue is not uniformly better. It pays where the difficulty is a judgement
about **what not to change**, or where the right answer is unguessable from the code and
has to be told.

## The answer to the question the repository was built to ask

Whether to write the diagnosed issue depends on the task, and the discriminator is
legible in advance:

- **A feature with a knowable right answer** — 02, 03, 11, 13, 15 — the model gets there
  from the code. The issue is not worth your time.
- **A change whose difficulty is knowing what to leave alone** — 12 — or **a
  requirement no amount of reading the code reveals** — 09 — the model goes confidently
  wrong and ships a test saying so. The issue is worth writing, and it is the only thing
  in this entire harness that catches it.

Four pairs is four pairs. What raises confidence beyond the sample size is that the two
wins fail in the same direction and for the same reason, and that the draw behaves
exactly as the theory predicts it should.
