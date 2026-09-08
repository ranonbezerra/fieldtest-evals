# fieldtest-evals

Real-world evaluations for local LLMs running on Apple Silicon.

This is **not a benchmark**. There is no leaderboard and no aggregate score. A
pass percentage says nothing about whether a model can understand a messy, real
problem and solve it *completely*. Every problem here is mirrored from a real
situation I faced building and operating production systems — marketplaces,
payment pipelines, an LLM product, a web3 anchoring pipeline, multi-tenant
platforms, infra — and every solution is judged as a whole: did it get the hard
parts right, did it respect the constraints, would I ship it?

**Every setting has to earn itself from real use.** A field test measures what a
developer would actually do, so a knob is set the way a developer would set it or it
is not set at all. Where a limit comes from this machine rather than from a decision —
the 16,384-token output ceiling is one oMLX server's, not a choice — it binds the local
runs because it must, and it is not imposed on anything that does not share the
constraint. Handicapping one side to make a table tidier measures the table.

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

### The scoreboard

Eighteen problems, three conditions, every run judged by hand against a written rubric.

| | local, phased | qwen hosted, single | gpt-oss-120b hosted |
|---|---|---|---|
| PASS | 1 | 1 | 1 |
| PASS_WITH_NOTES | 3 | 4 | 3 |
| FAIL | 14 | 13 | 14 |
| wall clock | 43.2 h | 5.3 h | **1.5 h** |
| cost | a laptop's three days | $3.46 | **$0.10** |

Three near-identical scores, and that is the least interesting thing about them:

- **one** problem is non-FAIL in all three conditions (08, infra debugging)
- **nine** are FAIL in all three
- **eight** disagree — and the disagreements fall on a single line

Every problem `gpt-oss-120b` won is one where a codebase already exists and the job is
to read it and change a little (10, 11, 13). Every problem it lost to Qwen is one where
the job is to build a working system from a description (04, 05, 18). Its own record
says the same without the comparison: **9 greenfield problems, 9 failures; 4 fixture
problems, 1 PASS and 3 PASS_WITH_NOTES.**

Qwen3.8-27B is the mirror image — it builds every part of a problem and then cannot
resolve its own references. On problem 02 hosted it met 6 of 6 must-haves with 10 of 11
real tests passing, and failed on 25 typecheck errors of which 24 were a missing `.js`.

**Neither model is better; they fail at different halves of the same job.** A benchmark
reporting one number per model hides that entirely, which is most of why this
repository exists.

### What is being measured, and on what

| | |
|---|---|
**The local condition.** The constraints below — the output ceiling, the context
window, and the phase decomposition they force — are properties of running a model on a
48 GB laptop. They are configuration for the *local* condition and nothing else; the
hosted conditions run uncapped, because a hosted model has no such limits and imposing
them would measure the harness.

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

### gpt-oss-120b

| # | Problem | A | B | C | L2 | What you can hand it |
|---|---|:-:|:-:|:-:|:-:|---|
| 01 | payout outbox | ✗ | – | – | – | Eight of eight must-haves — including the transaction boundary the 27B missed — on a codebase whose three main files each address a different repository. |
| 02 | reconciliation resend | ✗<br><sub>M1, M3, M4, M5, M6</sub> | – | – | – | Twelve files, a clean module graph, a green test run — and the two methods the problem is about are both marked "placeholder". |
| 03 | read model projection | ✗<br><sub>M1, M2, M3, M5</sub> | – | – | – | A correct schema, a good index, three services with the right names — and the two that matter are a stub and a delegate to that stub. |
| 04 | grounded llm product | ✗<br><sub>M6</sub> | – | – | – | Six files, the right architecture, `Math.min` in the right place — and a spoiler-free mode that redacts nothing, proven by running it. |
| 05 | onchain anchoring | ✗ | – | – | – | It wrote the repository, then wrote the service believing the repository did not exist and that it was forbidden from creating one. |
| 06 | multi tenant isolation | ✗<br><sub>M5</sub> | – | – | – | Twenty-seven files, a genuinely structural tenant filter, and a test suite consisting of the assertion that the code compiles. |
| 07 | ingredient classification | ✗<br><sub>M3, M5, M6</sub> | – | – | – | A well-modelled schema with an empty application on top of it, and a service that delegates the whole problem to a method nobody wrote. |
| 08 | infra debug | ~ | – | – | – | Three faults found, the security trap refused, a 139-line runbook, and a TLS fix that removes the tunnel it needs. Fifty-four seconds and five hundredths of a cent. |
| 09 | feature in conventions | ✗<br><sub>M5</sub> | – | – | – | Given the codebase to read, it followed the conventions it could see and invented the semantics it had to understand. |
| 10 | adapt existing screen | ~ | – | – | – | Three files, one request, a clean compile and no regressions — the first genuinely surgical edit either model has produced. |
| 11 | behavior preserving refactor | ✓ | – | – | – | Three copies became one, all three call sites delegate, the quirk survives as an option, and the uncovered copy got its characterization test first — in one request, for seven hundredths of a cent. |
| 12 | orm migration | ✗<br><sub>M1</sub> | – | – | – | A real migration — Drizzle in the repository, the dependency declared, the BigInt contract reasoned about — that begins by replacing the safety net it was supposed to run against. |
| 13 | legacy characterization tests | ~ | – | – | – | Sixty-one green tests pinning the legacy calculator as it actually behaves, four planted quirks found and one more besides, every fix proposed and none applied — in one request. |
| 14 | code review planted bugs | ✗ | – | – | – | A review with real line numbers and correct mechanisms, five of seven plants, written in a format the harness cannot read and therefore never written at all. |
| 15 | wiring boot failure | ✗<br><sub>M5</sub> | – | – | – | All three defects fixed in the file the key names, nothing silenced, a clean compile in one request — and no diagnosis at all. |
| 16 | migration that lied | ✗<br><sub>M1, M2, M3, M6, M7</sub> | – | – | – | Its correction reproduces the defect it was hired to find: two new migration files on disk, neither of them in the journal. |
| 17 | token rotation reuse | ✗<br><sub>M2, M3, M8</sub> | – | – | – | A sound family model with an absolute deadline, wired to a repository that exists under different names — and no compare-and-swap anywhere. |
| 18 | timing equal enumeration | ✗<br><sub>M5</sub> | – | – | – | The right defence, measured once. |

### poolside-laguna-s-2.1

| # | Problem | A | B | C | L2 | What you can hand it |
|---|---|:-:|:-:|:-:|:-:|---|
| 01 | payout outbox | ✗ | – | – | – | Twenty minutes and 126,727 tokens of visible deliberation, cut off mid-sentence, with no complete file in it. |
| 02 | reconciliation resend | – | – | – | – | *not yet run* |
| 03 | read model projection | – | – | – | – | *not yet run* |
| 04 | grounded llm product | – | – | – | – | *not yet run* |
| 05 | onchain anchoring | – | – | – | – | *not yet run* |
| 06 | multi tenant isolation | – | – | – | – | *not yet run* |
| 07 | ingredient classification | – | – | – | – | *not yet run* |
| 08 | infra debug | – | – | – | – | *not yet run* |
| 09 | feature in conventions | – | – | – | – | *not yet run* |
| 10 | adapt existing screen | – | – | – | – | *not yet run* |
| 11 | behavior preserving refactor | – | – | – | – | *not yet run* |
| 12 | orm migration | – | – | – | – | *not yet run* |
| 13 | legacy characterization tests | – | – | – | – | *not yet run* |
| 14 | code review planted bugs | – | – | – | – | *not yet run* |
| 15 | wiring boot failure | – | – | – | – | *not yet run* |
| 16 | migration that lied | – | – | – | – | *not yet run* |
| 17 | token rotation reuse | – | – | – | – | *not yet run* |
| 18 | timing equal enumeration | – | – | – | – | *not yet run* |

### qwen-qwen3.8-27b

| # | Problem | A | B | C | L2 | What you can hand it |
|---|---|:-:|:-:|:-:|:-:|---|
| 01 | payout outbox | ✗<br><sub>M3</sub> | – | – | – | Seven of eight must-haves, the strongest reservation in the campaign, and the outbox message lands in its own transaction. |
| 02 | reconciliation resend | ✗ | – | – | – | Chose a compiler setting its own imports violate, in the same reply that wrote both. |
| 03 | read model projection | ✗<br><sub>M1, M2, M3, M5</sub> | – | – | – | An invalid relation in its own schema stops the client from generating, and hides that half its services call methods nobody wrote. |
| 04 | grounded llm product | ~ | – | – | – | The best run of the campaign: eleven files, one request, clean compile, and every must-have met — undone only by a test that disagrees with the code beside it about a capital letter. |
| 05 | onchain anchoring | ~ | – | – | – | Fifteen files, one request, clean compile, six of six must-haves, and a recovery design that is the best engineering in either campaign — with a red suite that is entirely the tests' fault. |
| 06 | multi tenant isolation | ✗<br><sub>M5</sub> | – | – | – | The application is right and the only thing that fails is the test file that was supposed to prove it — which, on this problem, is the point. |
| 07 | ingredient classification | ✗ | – | – | – | A carefully versioned design that cannot be built, because two relation fields point at a model that never learned it was pointed at. |
| 08 | infra debug | ✓ | – | – | – | Four symptoms, three faults, no security disabled, and the one piece of reasoning the reference does not ask for: that a failing readiness probe empties a Service's endpoints too. |
| 09 | feature in conventions | ✗<br><sub>M2</sub> | – | – | – | On the one problem that is purely about obeying a convention placed in front of it, it obeyed for seven files and then stopped. |
| 10 | adapt existing screen | ✗<br><sub>M1, M2, M6</sub> | – | – | – | The bar is good work. It is bolted to an application the model wrote from scratch beside the one it was asked to edit, and the shared types it rewrote on the way took the orders feature down with them. |
| 11 | behavior preserving refactor | ✗<br><sub>M4, M5</sub> | – | – | – | The only run in either campaign where everything compiles and every test passes, and it fails on the one thing it was hired to do: there are still two copies of the mapper. |
| 12 | orm migration | ✗<br><sub>M4, M5, M6</sub> | – | – | – | It translated the schema, swapped the dependency in package.json, and did not touch one line of the code that talks to the database. |
| 13 | legacy characterization tests | ✗<br><sub>M2, M3, M5, M6</sub> | – | – | – | A confident, detailed, well-organised characterization of a module that did not exist until the model wrote it. |
| 14 | code review planted bugs | ~ | – | – | – | Seven findings, seven planted bugs, no false positives, correct mechanisms and correct fixes — written by a model that says, in its own first paragraph, that it was never shown the code. |
| 15 | wiring boot failure | ✗<br><sub>M1</sub> | – | – | – | It diagnosed the boot failure correctly, prescribed the right structural fix, refused the wrong one and explained why — and applied all of it to a copy of the app it built itself, one directory below the real one. |
| 16 | migration that lied | ✗<br><sub>M1, M2, M4, M6, M7</sub> | – | – | – | It designed exactly the right three checks for symptoms it was told about, and invented a cause, a filename and a migration journal for the code it could not read. |
| 17 | token rotation reuse | ✗<br><sub>M8</sub> | – | – | – | Seven of eight must-haves, the best concurrency design in either campaign, and a test suite that cannot compile because of one word. |
| 18 | timing equal enumeration | ~ | – | – | – | A real timing-equalisation, proven by its own statistical test, undone at the last inch by the default export of a vite plugin. |

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
| 10 | adapt existing screen | ✗<br><sub>M1, M4</sub> | – | – | – | Builds the whole feature correctly beside the application and never connects it to anything. |
| 11 | behavior preserving refactor | ✗<br><sub>M3, M4, M5</sub> | – | – | – | Turns three copies into four, and the suite stays green because the tests still point at the copies it left alone. |
| 12 | orm migration | ✗<br><sub>M4</sub> | – | – | – | It wrote a Drizzle implementation beside the Prisma one instead of in place of it, and every covered test stayed green because every covered test is still talking to Prisma. |
| 13 | legacy characterization tests | ✗<br><sub>M2, M3, M5, M6</sub> | – | – | – | Writes a characterization suite and a bug report for a module it never opened, and presents invented code as the evidence. |
| 14 | code review planted bugs | ~ | – | – | – | Finds every critical plant and rates one of them minor. |
| 15 | wiring boot failure | ✗<br><sub>M1, M2, M3</sub> | – | – | – | Diagnoses the wiring correctly and then builds a new module rather than fixing the one that is broken. |
| 16 | migration that lied | ~ | – | – | – | Names all three silent failures, gets one mechanism wrong, and says out loud which part it is guessing. |
| 17 | token rotation reuse | ✗ | – | – | – | Gets all eight security properties right and hands the caller a token it never stored. |
| 18 | timing equal enumeration | ✗<br><sub>M1</sub> | – | – | – | Equalises the expensive operation, then adds a second expensive operation to one branch, and writes the test that would have caught it. |


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

**Seventeen of eighteen problems, one variant each, one fixed configuration.** Full
record in [`FINDINGS.md`](FINDINGS.md); every claim below comes from a `verdict.md` on
disk.

    1 PASS · 3 PASS_WITH_NOTES · 13 FAIL
    81 of 109 must-haves satisfied in the source
    typecheck: 5 pass, 10 fail, 2 do not apply
    391 requests · 1,529,689 output tokens · 43.2 hours · 9.5–10.5 tok/s throughout

The gap between those first two lines is the finding. **It designs these systems
correctly far more often than it delivers them working**, and what fails is almost
never the domain reasoning.

### What fails, and it is one thing

**Its references into code it wrote are reliable. Its references outward are where the
work stops.**

The four problems with no boundary to cross — a diagnosis, a review report, a set of
migrations — produced the only PASS and three of the four non-failures. Problem 08
scored 3 on every criterion in 26 minutes and six requests. The thirteen requiring
construction across files produced thirteen failures.

| | Finding | What it means for you |
|---|---|---|
| 1 | **One artifact of a run is right and another, from the same run, disagrees.** Seven times, and in five of them the artifact that was right is a test | **Run what it writes.** Its tests judge its code better than its code does |
| 2 | **Given existing code, it adds beside the defect instead of changing it.** A feature built and never wired in; three duplicate copies becoming four; a new module instead of exporting from the broken one | Review the diff for what it did *not* touch |
| 3 | **It does not reliably declare what it needs to read.** Problem 13 wrote a characterization suite for a module it never opened, then presented reconstructed code as observed evidence | Check that the files it reasoned about are files it saw |
| 4 | **A clean typecheck means less than it looks.** One run compiled and shipped refresh tokens whose hash was never stored; another had a single unused-import error and was entirely dead code | Compile status is not a proxy for working |
| 5 | **Its plan contradicts itself** — the invariant in one section, the procedure that breaks it in another | Read the plan's sections against each other, before the code |
| 6 | **Repairs converge on what they understand and never touch what they do not.** Forty rounds fixed type errors and never added a file extension the compiler named in its own message | A repair loop that runs is not one that converges |

### What it is good at, concretely

`SELECT … FOR UPDATE`, `FOR UPDATE SKIP LOCKED`, `ON CONFLICT … DO UPDATE SET col =
col + n` — it reaches for raw SQL when the ORM runs out and gets it right. A Prisma
client extension stamping `tenantId` on every write. `AsyncLocalStorage` for request
context. Idempotency with both guards. A recovery sweep resolving both directions of a
crash. Canonical hashing with sorted keys. Timing equalisation by doing equal work
rather than sleeping a random interval. Reuse checked before expiry, so a token that is
both consumed and expired is treated as compromise.

Diagnosis is its strongest mode. Given a broken cluster it found three faults behind
four symptoms and said which symptom was evidence rather than a bug. Given a codebase
to review it found every plant marked critical.

### How much of this is the harness

**Some of it, and it is measured rather than estimated.** One line of `tsconfig` —
`moduleResolution: bundler`, which accepts both import conventions — moves five runs:

| run | as measured | with `bundler` |
|---|--:|--:|
| 03 read model projection | 31 errors | **8** |
| 05 on-chain anchoring | 17 | **2** |
| 06 multi-tenant isolation | 24 | **11** |
| 18 timing-equal enumeration | 17 | **7** |
| 15 wiring boot failure | 4 | 4 |

Four more runs lost their test suites to `@nestjs/testing`, which the cheatsheet's
declared stack implies and the scaffold does not supply. Twelve harness defects were
found and fixed along the way; four of them cost a real measurement.

Best estimate: **the first pass under-reports by roughly two runs of seventeen**, and
does not change the character of what the model does well or badly. What the second
pass buys is not more passes — it is failures that read *"used an interface as a NestJS
injection token"* instead of *"missed a file extension"*.

Both discards are documented in [`FINDINGS.md`](FINDINGS.md) §0 rather than deleted:
five runs at the wrong temperature, and three where the planning phase overflowed its
ceiling and the harness silently fell back to a lower reasoning effort.

### What running it locally costs

Every run's own telemetry, and beside it what the same tokens would have cost through
OpenRouter's hosted `qwen/qwen3.8-27b` at $0.42 in / $3.00 out per million.

| # | problem | hours | reqs | in | out | hosted |
|---|---|--:|--:|--:|--:|--:|
| 16 | migration that lied | 0.3 | 5 | 13,879 | 9,906 | $0.04 |
| 08 | infra debug | 0.4 | 6 | 23,259 | 15,955 | $0.06 |
| 13 | legacy characterization tests | 1.0 | 5 | 16,364 | 38,745 | $0.12 |
| 11 | behavior-preserving refactor | 1.1 | 16 | 58,046 | 38,725 | $0.14 |
| 14 | code review, planted bugs | 1.2 | 6 | 15,085 | 46,030 | $0.14 |
| 15 | wiring boot failure | 1.2 | 22 | 85,502 | 43,608 | $0.17 |
| 10 | adapt existing screen | 1.7 | 13 | 56,974 | 62,359 | $0.21 |
| 02 | reconciliation resend | 1.7 | 14 | 74,946 | 58,593 | $0.21 |
| 17 | token rotation reuse | 1.8 | 12 | 62,740 | 66,782 | $0.23 |
| 04 | grounded llm product | 2.4 | 18 | 83,246 | 82,510 | $0.28 |
| 09 | feature in conventions | 2.8 | 27 | 162,227 | 100,074 | $0.37 |
| 18 | timing-equal enumeration | 2.9 | 23 | 109,414 | 104,232 | $0.36 |
| 05 | on-chain anchoring | 2.9 | 25 | 149,748 | 100,054 | $0.36 |
| 01 | payout outbox | 3.1 | 25 | 173,279 | 110,036 | $0.40 |
| 06 | multi-tenant isolation | 4.8 | 51 | 323,765 | 163,945 | $0.63 |
| 07 | ingredient classification | 6.3 | 69 | 431,433 | 218,160 | $0.84 |
| 03 | read model projection | 7.7 | 54 | 353,270 | 269,975 | $0.96 |
| | **total** | **43.2** | **391** | **2,193,177** | **1,529,689** | **$5.51** |

**43.2 hours of machine against $5.51.** Those hours are generation only — wall-clock
was longer, with the gate, `pnpm install`, and waiting for memory to free up. The mean
problem is two and a half hours and thirty-two cents.

Three things this table says that the pass/fail column does not.

**Cost is a symptom, not an investment.** The two cheapest runs, problems 16 and 08,
are the two best in the campaign. The most expensive, problem 03, failed four of its
six must-haves. What drives cost is the repair loop, and the repair loop only runs
when something is already wrong.

**The scarce resource is the machine, not the model.** A 22 GiB model on a 48 GB
laptop means the machine is unusable for anything heavy while a run is going, and runs
go for hours. Half the harness — `ft-vitals`, `ft-flush`, the pressure gate, the
margin arithmetic — exists to manage that and nothing else.

**The hosted figure is a floor, not a quote.** It assumes the same token counts. A
hosted model with a 131,072-token output ceiling instead of this server's 16,384 will
spend more per phase, and output pricing includes reasoning tokens, so it could be
several times this.

That is the honest number to plan against, because **a hosted run should not be capped
at 16,384**. Nobody choosing between a laptop and an API imposes this machine's output
ceiling on the API — the cap is an artifact of one oMLX server on one 48 GB laptop, not
a decision anybody would make. Capping it would compare the local model at its best
against the hosted one with a leg tied.

The consequence runs deeper than the number. **The one-file-per-request phase design
exists because of that ceiling** (§3.1): the work had to be cut up because no single
reply could hold it. With 131,072 tokens of output there may be nothing to cut up, and
the problem can be posed the way a developer would actually pose it. Comparing *the
local model with this scaffolding* against *the hosted model without it* is the
comparison that decides anything, because that is how each would really be used.

A capped hosted run is still worth doing — but as a **diagnostic**, after the two
disagree and you want to know which of the differences explains it. Not first, and not
as the default.

### About the machine and the instruments

| | Finding | What it changed |
|---|---|---|
| 1 | The output ceiling is **16,384 tokens with reasoning paid out of it** — a server setting, not a model limit | The whole phase design: one file per request |
| 2 | The context window binds on **prefill time, not memory** — flat to 36k tokens, then 20× the time for 2× the tokens | 32,768, chosen from a measured curve |
| 3 | Under swap pressure the server **does not slow down, it dies** | Runs are gated on a measured margin |
| 4 | The model can be **"loaded" and paged out at once** | `ft-flush` recovers it; a run is refused until it does |
| 5 | A **resumed run reported the tail of itself as the whole run** — 57 minutes for a run that cost 340 | Totals come from the requests, which survive a resume |
| 6 | Three times the harness **documented an intention in prose and did not implement it** — a typecheck exception, running the suite, a fixture shim that shadowed real types | A comment describing what code should do is not a test that it does |

Twelve of the harness's own instruments were wrong before they were right, and most
failed in the same direction: reporting success, or refusing healthy work.
[`FINDINGS.md`](FINDINGS.md) §4 has them all, because a repository about criteria that
pass for the wrong reason does not get to exempt its own.

### What is not settled

Whether *"builds beside instead of changing"* is a property of the model or of this
harness's one-file-per-request shape. An agentic loop would let it re-read what it
wrote. [`SECOND-PASS.md`](SECOND-PASS.md) names the experiment that separates them, and
it costs one variant rather than eighteen.

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
