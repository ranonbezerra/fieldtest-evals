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

## What has been measured so far

Full record with numbers and consequences in [`FINDINGS.md`](FINDINGS.md). The six
that changed how this repository works:

| | Finding | What it changed |
|---|---|---|
| 1 | Generation runs at **~10.6 tok/s**, and the output ceiling is **16,384 tokens with reasoning paid out of it** | The deliverables of one problem cannot fit in one reply. Hence the phase design |
| 2 | On a task answered in two small files, reasoning filled **16,249 of 16,384 tokens**; the same task without it took **1,020** and produced a longer plan | Reasoning off for phase 0, on for implementation. Raising the server's ceiling would buy a bigger deliberation, not an answer |
| 3 | With reasoning off, problem 01 produced a 14-file plan in **4,327 tokens** that decided **all eight of its must-haves correctly** | The phase design works on a real problem, not only on a toy |
| 4 | The server's memory ceiling **moves with host load** — 37.44 to 32.36 GiB in one session — and under swap pressure the server **dies rather than slowing**. One phase ran 46 minutes and produced zero bytes | Both runners refuse to start on a paging host; every run records the ceiling's range |
| 5 | The model can be **"loaded" and paged out at once**: the server reporting 22.27 GiB resident while the host held 3.6 GiB wired and 24.2 GiB compressed | `ft-vitals` flags it. Unloading returned 23 GiB for a fourteen-second reload |
| 6 | The cheatsheet was **leaking two rubric answers** in sentences that read as good advice | `ft-lint-cheatsheet`, validated against a planted leak |

Two of the instruments above were themselves wrong first, both in the direction that
gets a check switched off — one sized the model against the wrong memory figure, the
other gated on swap occupancy instead of swap rate. Recorded in `FINDINGS.md` §4,
because a repository about checks that pass for the wrong reason does not get to
exempt its own.

**Not yet established:** no problem has been run end to end and judged; no judging has
been blind; the `aider` and `chat` conditions have not been run. `FINDINGS.md` §5 is
the list.

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

Running on a Mac (Apple Silicon, 48 GB) via oMLX.

**Current: `Qwen3.8-27B-MLX-6bit`** — Qwen3.5 hybrid architecture, 64 layers with full
attention every fourth, 6-bit MLX quantization, 22.27 GiB resident, reasoning on by
default. Measured here: **~5 tokens/second of output**, a flat prefill curve to ~36k
tokens and a 20x cliff beyond it, and a hard 16,384-token output ceiling that its
reasoning is paid out of. Those three numbers shape the whole harness; the arithmetic
is in [`harness/README.md`](harness/README.md).

Planned: a second model family, for recipe variety rather than a bigger number.

Verdicts live inside each problem's `runs/` tree — deliberately, there is no
cross-problem scoreboard to collapse them into.

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
