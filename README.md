# fieldtest-evals

Real-world evaluations for local LLMs running on Apple Silicon.

This is **not a benchmark**. There is no leaderboard and no aggregate score. A
pass percentage says nothing about whether a model can understand a messy, real
problem and solve it *completely*. Every problem here is mirrored from a real
situation I faced building and operating production systems — marketplaces,
payment pipelines, an LLM product, a web3 anchoring pipeline, multi-tenant
platforms, infra — and every solution is judged as a whole: did it get the hard
parts right, did it respect the constraints, would I ship it?

## The problems

| # | Problem | Domain | Origin |
|---|---------|--------|--------|
| [01](problems/01-payout-outbox/) | Payout with outbox + hold | Payments | Async payout pipeline for a marketplace |
| [02](problems/02-reconciliation-resend/) | Reconciliation + safe resend | Payments / ops | Production hardening of an instant-payment pipeline |
| [03](problems/03-read-model-projection/) | Read-model projection | Data / performance | 20–30s dashboard rebuilt to sub-50ms |
| [04](problems/04-grounded-llm-product/) | Grounded LLM answers + honest evals | LLM as product | A judge that rewarded confident hallucination, and its fix |
| [05](problems/05-onchain-anchoring/) | On-chain document anchoring | Web3 / infra | A real double-anchor vulnerability (txHash not persisted at broadcast) |
| [06](problems/06-multi-tenant-isolation/) | Multi-tenant white label | Platform / security | Retrofitting tenancy onto a single-operator system |
| [07](problems/07-ingredient-classification/) | Versioned classification engine | Data modeling / rules | Product-safety scanner: methodology versioning, profiles, unknowns |
| [08](problems/08-infra-debug/) | Fix the deploy, keep the security | Infra / debugging | Day-one onboarding into a broken cluster behind a jump host |
| [09](problems/09-feature-in-conventions/) | Feature inside someone else's conventions | Greenfield / architecture | Implementing spec'd epics in a scaffold with an established structure |
| [10](problems/10-adapt-existing-screen/) | Adapt an existing screen | Frontend / editing | Porting a proven UX pattern into a live back-office without regressions |
| [11](problems/11-behavior-preserving-refactor/) | Behavior-preserving refactor | Maintenance | Deduplicating drifted copies while quirks callers depend on stay intact |
| [12](problems/12-orm-migration/) | Dependency migration under partial coverage | Maintenance / data layer | ORM swap and provider swap where green tests don't mean done |
| [13](problems/13-legacy-characterization-tests/) | Characterization tests for legacy code | Testing | Pinning a module untouched since 2019 before anyone dares change it |
| [14](problems/14-code-review-planted-bugs/) | Code review with planted bugs | Code reading | Reviewing payment-grade code seeded with the bug classes that cause outages |
| [15](problems/15-wiring-boot-failure/) | Compiles clean, fails at boot | Framework / debugging | Three merged features, an unresolved provider, and a cycle through a constant |
| [16](problems/16-migration-that-lied/) | The migration that lied | Data / ops | A green pipeline that applied three migrations and created nothing |
| [17](problems/17-token-rotation-reuse/) | Refresh rotation + reuse detection | Security / concurrency | The task that failed as one unit of work and succeeded as three |
| [18](problems/18-timing-equal-enumeration/) | The defence no status code can see | Security / testing | Identical responses, unequal work, and a perfect timing oracle |

Each problem directory contains:

```
problems/NN-slug/
  brief.md          # the real-world situation behind the problem (anonymized)
  rubric.md         # must-haves (hard gate) + graded quality criteria
  variants/         # 3 different statements of the same underlying problem
  reference/        # annotated reference solution (the judging anchor)
  runs/             # created per model at run time (see below)
```

**Why 3 variants per problem:** (1) anti-memorization — a model can't
pattern-match a known statement; (2) consistency is signal — solving 1 of 3 is a
very different capability than solving 3 of 3, and no percentage captures that.
From problem 09 onward, **variant C is deliberately underspecified**: it mirrors
how work actually arrives (a vague PM request, an internal memo), and part of
what's judged there is whether the model surfaces and records its assumptions
instead of confidently guessing.

Problems 15–18 come from a second source: a measured record of a local model
executing roughly thirty tasks on a production monorepo. Every defect in them
happened, and each was found *after* the tools reported success — which is what they
have in common and why they are worth their place. They are also the four the
existing fourteen could not catch: **an unresolved dependency compiles perfectly**, a
migration that is not in the journal is not applied whatever the tool prints, six
independent traps in one task is two tasks, and a property no assertion on a status
code can see.

**The rubric is the core artifact.** Must-haves act as a gate: a payout service
that passes its tests but debits the balance instead of holding it *fails*,
because in production that's an incident. Graded criteria then assess design and
code quality against the reference. This mirrors the current best practice for
code evaluation: automated tests for "does it work", per-problem rubric for
everything tests can't see — with rubrics specific to each task, since generic
rubrics systematically mis-evaluate.

## Results — what these models can actually do

This is the card the repository exists to hand you. Not a score: **what you can give a
model and expect back.**

### What is being measured, and on what

| | |
|---|---|
| **Model** | [`Qwen/Qwen3.8-27B`](https://huggingface.co/Qwen/Qwen3.8-27B), released 14 August 2026 — 27B dense, **natively multimodal** (only the text path is exercised here) |
| **Architecture** | 64 layers, hidden 5,120, hybrid: `16 × (3 × Gated DeltaNet → 1 × Gated Attention)`. Linear attention in 48 layers, full attention in 16 |
| **Quantization** | 6-bit MLX (LM Studio community build), group size 64 · **22.27 GiB resident** |
| **Reasoning** | thinking mode by default, paid out of the same budget as the answer. Runs at **`reasoning_effort: medium`** — measured, not chosen: at the model's own default the planning phase overflowed the output ceiling in 3 of 3 runs and returned no plan |
| **Generation** | **temperature 1.0, top_p 0.95, top_k 20** — the model card's own recommendation for thinking mode, not this harness's choice |
| **Machine** | MacBook Pro, **Apple M4 Pro**, 14 cores (10P/4E), **48 GB unified memory**, macOS 26.6 |
| **Server** | oMLX, OpenAI-compatible endpoint |
| **Context window** | **32,768** of a native 262,144 — measured, not chosen: prefill is flat to 36k tokens and 20× slower by 72k |
| **Output ceiling** | **16,384 tokens**, a server setting rather than a model limit |

The model's own published scores include SWE-bench Pro **61.7** and GPQA Diamond
**89.2**. This repository is not trying to reproduce those; it asks a different
question — whether the model can take a messy real problem end to end and produce
something you would ship.

Every number here was measured on this machine and is reproducible from
[`harness/README.md`](harness/README.md), except the published benchmark scores,
which are the model's own and are labelled as such.

**The hardware is not a footnote.** A 48 GB machine running a 22 GiB model has less
headroom than the arithmetic suggests, and the server's own memory ceiling **moves
with what else is open** — 37.44 GiB down to 32.36 GiB inside one session. Under swap
pressure it does not slow down, it stops answering: one phase ran 46 minutes and
produced zero bytes. Runs taken under pressure are marked `comparable: no` rather than
averaged in. [`harness/host-limits.md`](harness/host-limits.md) has the measurements.

<!-- results:start -->

### qwen3.8-27b-mlx-6bit

| # | Problem | A | B | C | L2 | What you can hand it |
|---|---|:-:|:-:|:-:|:-:|---|
| 01 | payout outbox | ✗ | – | – | – | Satisfies every must-have, including both it failed at low effort, and imports a file its own plan forgot to commission. |
| 02 | reconciliation resend | ✗<br><sub>M1</sub> | – | – | – | Writes the test that catches its own bug, and ships the bug. |
| 03 | read model projection | ✗<br><sub>M1, M2, M3, M5</sub> | – | – | – | Its compile errors hid its real ones, and thirty repairs fixed neither. |
| 04 | grounded llm product | ~ | – | – | – | Builds the eval architecture correctly and then evaluates the answer after its own filter has already removed the lie. |
| 05 | onchain anchoring | ✗ | – | – | – | The strongest work in the campaign, held out of the build by a missing file extension. |
| 06 | multi tenant isolation | ✗ | – | – | – | Enforces isolation structurally, in the one place that cannot be forgotten, and cannot prove it because the scaffold has no test runner for the framework it declares. |
| 07 | ingredient classification | ✗ | – | – | – | One file nobody was asked to write hid a wrong relation name in every query of a repository, and only a real database said so. |
| 08 | infra debug | ✓ | – | – | – | Finds three faults behind four symptoms, fixes each in one line, and says which symptom was evidence rather than a bug. |
| 09 | feature in conventions | ✗<br><sub>M2</sub> | – | – | – | Reads the codebase's conventions well, then infers the wrong rule from a failure and applies it to a whole file. |
| 10 | adapt existing screen | – | – | – | – | *not yet run* |
| 11 | behavior preserving refactor | – | – | – | – | *not yet run* |
| 12 | orm migration | – | – | – | – | *not yet run* |
| 13 | legacy characterization tests | – | – | – | – | *not yet run* |
| 14 | code review planted bugs | – | – | – | – | *not yet run* |
| 15 | wiring boot failure | – | – | – | – | *not yet run* |
| 16 | migration that lied | – | – | – | – | *not yet run* |
| 17 | token rotation reuse | – | – | – | – | *not yet run* |
| 18 | timing equal enumeration | – | – | – | – | *not yet run* |


<!-- results:end -->

### Reading a row

**A, B, C** are the three statements of the same problem. Solving one of three is a
different capability from solving three of three, and the row shows which — that is
why there is no average. From problem 09 onward, **C is deliberately underspecified**:
a one-line request from a PM, where what is judged is whether the model surfaces the
decisions it had to make instead of guessing silently.

**L2** is the ladder, and it is the most useful cell for a working developer. It reruns
the same problem with the design already given — the reference's types, signatures and
error codes, bodies left open. So:

| A/B/C | L2 | What it means for you |
|:-:|:-:|---|
| ✗ | ✓ | **It cannot design this, but it can build it.** Give it a specified card and it will write the code |
| ✗ | ✗ | Out of reach at this size. Do not hand it this class of work |
| ✓ | – | It handled the ticket as written. Nothing to specify |

**The small text under a ✗** names the must-haves that failed — `M2` on problem 01 is
the race-safe reservation. That is the actionable half of a failure: not *"it scored
low"*, but *"it wrote a check-then-update where the check and the claim had to be one
act"*.

**✓ PASS · ~ PASS_WITH_NOTES · ✗ FAIL · – not run.** A must-have missing is a FAIL
whatever the tests say, because in production it is an incident.

### What a verdict costs to produce

Every run records wall time, tokens in and out, tokens per second, how many revisions
the model made to its own work, and whether the host was under memory pressure while it
ran. A run taken on a loaded machine is marked not comparable rather than quietly
averaged in. [`FINDINGS.md`](FINDINGS.md) has why that matters here.

### Honesty about this table

It is generated by `harness/ft-results --write` from the `verdict.md` files on disk,
never edited by hand — a hand-maintained results table rots, and a rotted one is worse
than none because it reads as current.

Judging is blind: runs are staged anonymised with `harness/ft-anon`, judged one
dimension at a time against the problem's own rubric with evidence quoted, and only
then mapped back to model ids.

## What has been measured so far

Seven of eighteen problems, one variant each, one fixed configuration. Full record with
numbers in [`FINDINGS.md`](FINDINGS.md); every claim below is from a `verdict.md` on
disk.

**Two of seven compile. None passes clean.** That is the headline and it needs its
qualifier: the failures are rarely about the domain. Across seven runs, **39 of 42
must-haves are satisfied in the source** — the model designs these systems correctly
far more often than it delivers them buildable. Four of the five misses are one run,
problem 03, and that run is §3.6b's case: its unresolved imports stopped the compiler
from checking anything behind them.

| | Finding | What it means for you |
|---|---|---|
| 1 | **Its plan contradicts itself, and the code implements the executable half** — the invariant in one section, the procedure that breaks it in another | Approving the plan does not protect you. Read its sections against each other |
| 2 | **It designs against files and methods nobody commissioned.** A `PrismaService` named in three constructors and never written; controllers calling service methods that do not exist | The gap is between phases, not inside them. Cross-check the manifest against the interfaces |
| 3 | **A module-resolution convention decides half the gates.** The two runs that compiled carry the `.js` extension on 100% of relative imports; every run below 98% failed on it | Tell it your module system's consequences, not just its name |
| 4 | **An unresolved import hides everything behind it.** Six errors after forty repairs read as nearly-clean; the untyped Prisma client behind them hid a wrong relation name in every query of a repository | An error count means nothing until imports resolve |
| 5 | **It reaches for raw SQL when the ORM runs out, and gets it right** — `SELECT … FOR UPDATE`, `FOR UPDATE SKIP LOCKED`, `ON CONFLICT … DO UPDATE SET col = col + n` | The hard concurrency primitives are within reach |
| 6 | **Repairs converge on what they understand and never touch what they do not.** Forty rounds fixed type errors and never once added a file extension the compiler named in its own message | A repair loop that runs is not a repair loop that converges |
| 7 | **It writes the test that catches its own bug, then ships the bug.** Problem 02 named `amount mismatch: order is NOT settled and NOT treated as absent` and violated it twenty lines above | Run its tests. They are better than its code |

**What it is good at, concretely.** Structural enforcement it cannot forget later — a
Prisma client extension that stamps `tenantId` on every write, `AsyncLocalStorage` for
request context. Recovery paths that handle both directions of a crash. Canonical
hashing with sorted keys, tested for insertion order. Idempotency with both guards —
pre-check and unique-violation re-read. Error taxonomies with four buckets where the
problem needs four.

**What it is not good at.** Holding an agreement between two files it wrote at
different times.

**Cost:** 256 requests, 1,003,273 output tokens, 28.9 hours of generation for seven
problems, at 9.5–9.6 tokens per second in every single run. A run costs 1.7 to 7.7
hours depending on how much its gate has to repair.

**Two discards** are documented in [`FINDINGS.md`](FINDINGS.md) §0 rather than deleted:
five runs at the wrong temperature, and three more where the planning phase overflowed
its output ceiling and the harness silently fell back to a lower reasoning effort. A
results table is worth exactly what its worst row is worth.

**About the machine and the instruments:**

| | Finding | What it changed |
|---|---|---|
| 1 | The output ceiling is **16,384 tokens with reasoning paid out of it** — a server setting, not a model limit | The whole phase design: one file per request |
| 2 | The server's memory ceiling **moves with host load**, and under swap pressure it does not slow down — it dies | Runs are gated on a measured margin, not on free memory |
| 3 | The model can be **"loaded" and paged out at once** — 22 GiB resident against 4 GiB wired | `ft-flush` recovers it; a run is refused until it does |
| 4 | A **resumed run reported the tail of itself as the whole run** — 57 minutes for a run that cost 340 | Totals come from the requests, which survive a resume |
| 5 | A **silent file cap cut one run's plan by fifteen files**, including every test | Truncation is now loud, recorded, and marked not comparable |
| 6 | A **killed run's lock outlived it**, so the machine could never reclaim the model again | The lock's pid is probed; a dead holder's lock is cleared |

Ten of the harness's own instruments were wrong before they were right, and eight
failed in the same direction: reporting success, or refusing healthy work. The tenth
was written *after* the other nine were catalogued, in the file that names the pattern.
[`FINDINGS.md`](FINDINGS.md) §4 has them all, because a repository about criteria that
pass for the wrong reason does not get to exempt its own.

Changes the first pass has earned and does not get to use — a plan-consistency check, a
manifest reference check, feeding the test suite back as a repair round, a database for
the test step — are collected in [`SECOND-PASS.md`](SECOND-PASS.md) rather than applied.
One configuration for all eighteen; improvements found along the way are the argument
for a second pass, not for switching mid-flight.

## How to use this repo

### 0. Prerequisites

- Node 20+ and pnpm (solutions are TypeScript/NestJS/Prisma; Postgres via Docker)
- A local model server exposing an OpenAI-compatible endpoint — oMLX here, on a
  Mac with 48 GB of unified memory
- `~/.config/fieldtest/omlx.env` holding `OMLX_KEY`, `OMLX_BASE`, `OMLX_MODEL` —
  copy [`harness/omlx.env.example`](harness/omlx.env.example) and `chmod 600` it
- Docker, for problems needing Postgres
- aider, for the `aider` condition; a chat client, for the `chat` condition

Prove the machinery before spending hours on it:

```bash
. harness/ft-env.sh
harness/ft-flush --status         # is the server there, and how much is resident
harness/ft-go harness/selftest a  # a tiny task through every phase
```

### 1. Run a model on a variant

```bash
. harness/ft-env.sh
harness/ft-go 01 a                  # runner=api, spec=model — the default pairing
harness/ft-go 01 a --runner aider   # same phases, through aider
harness/ft-go 01 a --spec ladder    # implementation only, from the reference's spec
```

An agentic loop is not used, and cannot be: it grows its own context until the
conversation is trimmed, and the first thing trimmed is the problem statement. A
single request is not enough either — the deliverables run to several files against a
16,384-token output ceiling that the model's reasoning is also paid out of. So the
work is **decomposed without being designed**:

| Phase | What happens |
|---|---|
| 0 | The model writes `PLAN.md` — files, schema, types, signatures, error codes, state machine. No bodies. It is a level-2 specification and **the model under test is the one who writes it**. |
| 1..N | One file per request. Context is the cheatsheet, the variant, the model's own plan, and the already-written files this one depends on, read-only. No tools, no exploration. |
| gate | Typecheck, then up to two revisions carrying the compiler's exact messages and the files those messages name. |

Phase 0 is where the design is judged — the must-haves are visible in the plan before
a line of code is spent — and because the plan resolving the references is the model's
own, nothing has been decided for it.

The third way in, a **free chat** in Cline or oMLX's own UI, is not scriptable and is
run by hand from [`harness/chat/README.md`](harness/chat/README.md). All three ways are
part of the eval; [`harness/conditions.md`](harness/conditions.md) documents what each
one costs and what it can and cannot tell you.

Rules that keep runs comparable: same parameters for every model, fixed in one file;
no hints and no steering beyond what the variant states; and **never edit a workspace
after the run** — `ft-go` refuses to re-enter a run directory, because fixes belong in
notes, not in the artifact being judged.

### 2. Capture

`ft-go` writes each run directory itself:

```
PLAN.md          the model's own specification — judged before any code
workspace/       the code exactly as the model left it
steps/           every request: its reasoning, its reply, its counters
transcript.md    all of it concatenated, nothing elided
GATE.md          typecheck output for every attempt, revisions included
meta.yaml        below
```

`meta.yaml` carries what a verdict needs and a workspace cannot show: wall time split
into generation / model loads / gate, **tokens per second**, prompt and completion
totals, **how many revisions the model made to its own work**, every phase that hit
the output ceiling, files declared versus files that came back empty, and an explicit
**failures** list naming each in the terms that decide what to do about it.

The transcript matters as much as the code, and the reasoning inside it most of all:
a phase that ends with nothing written is either reasoning about a reference it cannot
read or carrying more decisions than fit, and those want opposite fixes.

### 3. Test

Every variant demands its own tests as a deliverable, so testing a run means
running the solution's own suite plus your scrutiny of what it actually covers:

```bash
cd runs/<model-id>/variant-a/workspace
docker compose up -d db        # if the solution defines one; else run Postgres yourself
pnpm install && pnpm test
```

Then check the tests against the rubric's expectations (e.g., for 01: is there a
*real* concurrency test, a duplicate-delivery test, an exhaustion test — or only
happy paths?). A green suite with hollow tests is itself a finding. Exceptions:
problem 08 delivers diagnosis + corrected config + runbook (verify by following
the runbook); problem 13's deliverable IS a test suite (run it against the
untouched fixture); problem 14 delivers a review report (score it against the
answer key in `reference/`).

Problems 09–16 ship with fixture codebases and scaffolds under each problem's
`fixtures/` or `scaffold/`. All are built and verified — the NestJS and React
scaffolds typecheck and their own tests pass against real dependencies; the review
fixtures typecheck standalone; problem 16's fixture was run against a real Postgres
and confirmed to report success while creating nothing. Copy a scaffold into the run
workspace before the run.

**Keep every `reference/` out of the model-under-test's context.** From 08 onward
they are answer keys.

### Before a campaign: the machine

```bash
harness/ft-vitals          # host memory, the server's ceiling, whether it is safe
```

`ft-go` refuses to start on a loaded host, and the refusal is not fussiness. The
server's ceiling **moves with the machine's load** — 37.44 GiB down to 32.36 GiB
inside one session, measured — and under swap pressure the model server does not slow
down, it dies. One phase was recorded running 46 minutes and producing zero bytes,
with the model's weights paged to disk.

Close Docker (5–6 GiB idle), close the editor, and run nothing beside a run.
[`harness/host-limits.md`](harness/host-limits.md) has the measurements.

### 4. Judge (blind)

```bash
harness/ft-anon 01          # shuffled run-01/, run-02/, … with identity stripped
```

Identity is stripped; the counters are not, because they are evidence.

1. **Plan first.** Judge `PLAN.md` alone against the must-haves, before any code. A
   must-have decided in the plan and lost in the code is an implementation failure;
   one never in the plan is a design failure. Only this step separates them.
2. **Gate.** Must-haves against the delivered code plus test results. Any ✗ = FAIL,
   and absence of evidence is ✗.
3. **Graded**, with a frontier model as judge, one dimension at a time, evidence
   quoted — [`harness/judge-prompt.md`](harness/judge-prompt.md).
4. **Failure mode.** Classify every phase that produced nothing or produced the wrong
   thing: `reference_gap`, `decision_overload`, `wrong_answer` or `harness_artifact`.
   For a local model this is more decision-relevant than the score.
5. De-anonymize with `ft-anon 01 --key`, write `verdict.md` into each run directory.

The shape of a verdict is [`harness/verdict-template.md`](harness/verdict-template.md).

## Models under test

The full specification sits beside the results table above, where the numbers it
explains actually are.

**Current: `Qwen3.8-27B-MLX-6bit`.** Planned: a second model family, for recipe
variety rather than a bigger number — and the ladder (`--spec ladder`) on whatever
this one failed, which separates *cannot design this* from *cannot implement this*.

Verdicts live inside each problem's `runs/` tree — deliberately, there is no
cross-problem scoreboard to collapse them into.

## Where this came from

The harness did not start here. Its rules — one request per phase, references that
must resolve, the flush between runs, the refusal to let a model explore — come from a
pilot run on a **private production monorepo**, where a local model was given real task
cards and the failures were paid for once each.

That pilot answered *how to get work out of a small local model*. It could not answer
*what a local model is actually able to do*, because every task there was shaped to
succeed. **This repository exists for the second question**, which is why the problems
are whole and messy rather than decomposed, and why nothing here is tuned to make a
model pass.

Figures inherited from that pilot are labelled as such wherever they appear. Everything
else was measured here.

## The harness

| | |
|---|---|
| [`harness/README.md`](harness/README.md) | fixed parameters, and the measurements behind each |
| [`harness/conditions.md`](harness/conditions.md) | the three ways into the model, and what each costs |
| [`harness/host-limits.md`](harness/host-limits.md) | what the machine does to the measurement |
| [`harness/judge-prompt.md`](harness/judge-prompt.md) | blind judging, one dimension at a time |
| [`harness/verdict-template.md`](harness/verdict-template.md) | the shape of a verdict |

```bash
harness/ft-vitals          # is the machine quiet enough to measure on
harness/ft-flush --status  # is the server there, and how much is resident
harness/ft-go <p> <v>      # one run, end to end
harness/ft-anon <p>        # stage runs for blind judging
harness/ft-lint-cheatsheet # find answers leaking from a cheatsheet into a rubric
```

## Stack

First target stack: **TypeScript / NestJS / Prisma / PostgreSQL** (React where a
variant calls for UI). Other languages may be added later as parallel
`reference/` and `runs/` trees. Problem 08 is config/shell by nature.

## License

MIT for the harness and problem statements. Reference solutions are annotated
judging anchors, not production code.
