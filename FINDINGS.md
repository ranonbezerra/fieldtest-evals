# Findings

Everything measured while building this harness and running the first model against
it. One entry per finding: **what was measured**, the number, and **what it changed**.
A finding with no consequence is an anecdote, and a consequence with no number is a
preference — neither belongs here.

Entries are dated by the state of the repository, not the calendar. When a later
measurement contradicts an earlier one, the earlier entry is corrected in place and
says so, because a findings file that only accumulates becomes a place to argue from
rather than a place to check.

**Under test:** [`Qwen/Qwen3.8-27B`](https://huggingface.co/Qwen/Qwen3.8-27B) at 6-bit
MLX — 27B dense, natively multimodal, 64 layers, hybrid
`16 × (3 × Gated DeltaNet → 1 × Gated Attention)`, 22.27 GiB resident. Served by oMLX
on a MacBook Pro (M4 Pro, 48 GB). Thinking mode by default, at the card's own
temperature 1.0 / top_p 0.95 / top_k 20.

---

## 0. Parameters, and why the first five runs are not here

The model was identified from its `config.json`, which declares
`model_type: qwen3_5` — the name of the implementation class in transformers, not of
the model. Read as a model name, that led the harness to apply Qwen3's published
guidance and run at **temperature 0.6**.

`Qwen/Qwen3.8-27B` recommends **1.0 / 0.95 / 20** for thinking mode, which is its
default mode. It also exposes **`reasoning_effort`** (`xhigh`/`medium`/`low`) — a
native dial for the budget problem the harness had been working around with a switch
of its own.

Five runs were discarded rather than compared against the corrected ones. What they
produced about the model is in [Appendix A](#appendix-a--superseded-by-the-parameter-correction);
what they produced about the machine and the instruments is in §2 and §4 and stands,
because a false positive on swap occupancy is no less false for having been found at
the wrong temperature.
---

## 1. The model

### 1.1 The output ceiling is 16,384 tokens, and reasoning is paid out of it

Not a model limit — the model's own config imposes none, and its architecture supports
262,144 positions. It is an oMLX per-model setting.

*Changed:* the entire harness shape. The deliverables of a single problem do not fit in
one reply, which is why work is decomposed into one file per request.

### 1.2 A ceiling hit mid-reasoning returns the reasoning as the answer

When the ceiling cuts the model before its thinking closes, the server cannot separate
the two and returns the deliberation in `content`, with `reasoning_content` empty. The
harness wrote 68 KB of it to `PLAN.md` and continued as though it were a specification.
(The 68 KB is from a discarded run; the behaviour is the server's and does not depend
on the parameters that produced the reply.)

*Changed:* `ft-go` treats a ceiling hit in phase 0 as a failure and writes no artifact.
A phase that was cut off did not answer.

## 2. The machine

Full detail in [`harness/host-limits.md`](harness/host-limits.md).

### 2.1 The server's memory ceiling is not a constant

`final_ceiling` was observed at **37.44, 36.48, 32.85 and 32.36 GiB within one
session**, falling as the rest of the machine took memory. The same request can be
served, be slow, or be refused, with nothing about the request having changed.

*Changed:* every run records the ceiling's range. A run whose ceiling moved is not
comparable to one whose ceiling held.

### 2.2 Under swap pressure the server does not slow down — it dies

Recorded: `wired` collapsed from 29.9 to 6.5 GiB as macOS grew the swap file from 9 to
21 GiB to take the model's pages. The server process was gone shortly after. **A phase
ran 46 minutes and produced zero bytes** — not a timeout, not an error, not a ceiling
hit. Just a request whose weights were on disk.

*Changed:* `ft-go` and `ft-run` both refuse to start on a paging host.

### 2.3 "Loaded" is the server's word, and the host disagrees

The state that precedes the death reads as healthy from the server alone: `resident
22.27 GiB, headroom 15.17 GiB, loaded`, while the host had `wired 3.6 GiB` and
**`compressed 24.2 GiB`**. The weights were out of memory; the next request would
decompress 22 GiB before generating a token.

Unloading recovered it: compressed **24.19 → 0.80 GiB**, available **12.4 → 34.6 GiB**,
for one fourteen-second reload.

*Changed:* `ft-vitals` flags `wired` far below what the server calls resident. Without
it, this state reads as "the model is being slow".

### 2.4 Stopping containers does not return memory; restarting the VM does

Docker's Virtualization.framework VM grew from **3.29 to 8.12 GiB across one session**
while the container count went 32 → 28 → 22 → 5 → 14. It grows and does not deflate.

*Changed:* the advice. "Close Docker" was wrong and expensive; "restart it, or leave it
down during runs" is right. **A run needs no database** — generation touches nothing.
Docker is needed to *verify* a run, not to make one.

---

### 2.5 An unexplained gap between what the client waits and what the server counts

Recorded as an open measurement, not a diagnosis. **The figures are from the
discarded campaign** — they are kept because the gap is about the server's accounting,
which a temperature does not touch, and because a 54-minute discrepancy is worth
re-checking rather than forgetting.

| | wall | server `total_time` | gap |
|---|--:|--:|--:|
| problem 02, plan phase | 8.9 min | 8.9 min | **0** |
| problem 02, schema phase | 67.1 min | 12.9 min | **54.2 min** |
| problem 01, whole run | 303 min | 266 min | 37 min |

The server reports thirteen minutes of work on a request the client waited
sixty-seven for, while the phase immediately before it had no gap at all. A one-token
probe fired while the campaign was generating took **12.63 s**, which suggests oMLX
serialises and that `total_time` starts when generation starts rather than when the
request arrives. That does not account for fifty-four minutes.

*Consequence, which is certain even though the cause is not:* **tokens per second as
recorded is optimistic**, because it is computed from the server's figure. Campaign
planning must use wall time. Problem 01 took 5h04 by the clock against the 4h26 its
throughput implied.

*Not yet done:* instrument the gap directly — timestamp the request leaving and the
first byte arriving — rather than inferring it from two numbers that measure different
spans.

## 3. The harness

### 3.1 An agentic loop cannot be used, and neither can a single request

The loop grows its own context until the conversation is trimmed, and what goes first
is the oldest turn — the problem statement. The run then completes plausibly against
instructions no longer in the window. A single request does not fit under 1.2.

*Changed:* the phase design. The model writes its own level-2 plan, then implements it
one file per request, each request assembled from scratch.

### 3.2 Three ways in, all measured

Free chat, aider, and direct API calls are all real ways to work, and their differences
are findings rather than nuisances. [`harness/conditions.md`](harness/conditions.md)
documents what each costs and what each can and cannot tell you.

### 3.3 The cheatsheet leaks answers, and it does not look like it

The shared conventions file said *"an unresolved dependency type-checks perfectly and
fails at boot"* and *"a migration that is not recorded is not applied, whatever the
tool prints"*. Both read as good advice. Both are the answer to a problem's gate,
verbatim.

*Changed:* [`ft-lint-cheatsheet`](harness/ft-lint-cheatsheet) compares cheatsheet
phrases against rubric must-haves, minus what the variant already states. Validated by
planting a known leak and confirming it surfaces.

---

### 3.4 A gate that cannot fire is decorative

`ft-go`'s typecheck only ran when the model happened to write build configuration it
was never asked for. Two runs, independently, declared manifests with no
`tsconfig.json` — and both were right to: the variants ask for a schema, a module,
tests and a design note, and the phase-0 instruction names *"whether a config file is
in scope"* as a convention to settle in one line and move past.

So the gate never fired, and the most serious defect of the first run — an invented
Prisma `lock` option — went unnoticed. A typecheck rejects it in seconds.

*Changed:* [`harness/gate-scaffold/`](harness/gate-scaffold/) supplies a minimal
`package.json` and `tsconfig.json` **after the model's last phase**. It never appears
in any prompt, and `meta.yaml` records `gate_scaffold_added` so a judge knows which
files are not the model's work. A `prisma generate` runs first, because the invented
option is only visible against the client generated from the model's own schema.

*Validated* against a workspace the gate had never seen — one belonging to the
discarded campaign, and so no longer in the tree. Recoverable with
`git show fd9647f:problems/01-payout-outbox/.../payout.repository.ts`. It named lines 40 and 89,
exactly the two `lock` calls, and found three defects the operator's own review had
missed — a duplicate block-scoped `const`, several unknown-typed catch bindings, and
twelve imports without the `.js` extension ESM requires. A human had read that code
closely enough to write a verdict.

**Independent of the parameter correction:** what a statement asks for does not change
with temperature.

## 4. The instruments were wrong six times, mostly in the direction that gets them ignored

Recorded because the repository's whole subject is checks that pass for the wrong
reason, and it would be dishonest to exempt its own. Six defects, and the pattern in
them is worth more than any one: **five refused work on a machine that was fine, and
each was written immediately after a failure it had just watched.** A check built only
from the bad case has never seen the good one.

None of these depended on the generation parameters. A false positive on swap
occupancy is no less false for having been found at temperature 0.6.

| Defect | Effect | Fix |
|---|---|---|
| Sized the model against `Pages free` | Reported a **13.7 GiB shortfall on a host with 2 GiB of real margin**. macOS keeps `free` low on purpose | Size against available: free + inactive + speculative + purgeable |
| Gated on swap **occupancy** | Blocked a healthy machine sitting on 4 GiB of residue from an earlier episode, with 0 swapins/s and 0 swapouts/s | Gate on **rate**, sampled. Occupancy is history; rate is pressure |
| Read low `wired` as the model being paged out | **Emptied the campaign's first run.** MLX wires memory only while the GPU is working, so between requests `wired` drops to a few GiB with nothing evicted. Genuinely paged out: wired 3.6, compressed 24.2. Healthy and idle: wired 3.5, compressed 1.6 — identical in the figure being read | Require the compressor too. Only that figure separates them |

**All three refused work on a machine that was fine.** That is not a coincidence, it
is the shape of the mistake: each check was written from a failure I had just watched,
and calibrated to catch that failure rather than to distinguish it from the healthy
state that resembles it. A check built only from the bad case has never seen the good
one.

### 4.1 A gate in the wrong place empties a run instead of stopping it

Worse than any false positive above, and a design error rather than a measurement one.
`ft-go` gates on host pressure once, at the top — the decision point. Each phase then
gated again through `ft-run`, so a run already in progress **abandoned itself file by
file** and committed a plan with ten empty files beside it.

*Changed:* pressure appearing mid-run is recorded — `host.pressure_samples`, and
`host_pressure_at_send` per request — and the run is marked not comparable. A run you
must discount is strictly more useful than no run at all.

Both were found by running them against the real machine, not by reading them.

### 4.2 The self-test earns its place

Four defects, all mine, found on its first run before a campaign spent hours: a crash
at capture from a renamed flag; a manifest parser matching the placeholder in its own
instruction's example; 1.4 above; and a contradiction I had written into the self-test
variant — "no dependencies" against a cheatsheet saying "tests use Vitest". The model
spent its budget asking whether Vitest counted, and **the question restarted rather
than resolving**, which is `reference_gap` by this repository's own diagnostic.

*Changed:* run [`harness/selftest`](harness/selftest) after any change to the runners
or the phase instructions. It costs minutes and has already saved hours twice.

---

### 4.3 The agent watching the campaign was loading the machine it was measuring

A controlled test, because five earlier attributions in this file were made from proxy
indicators and were wrong. Fifteen samples of WindowServer's CPU with the session
quiet, then twelve while the agent produced heavy tool output into the IDE:

| | median | mean | range |
|---|--:|--:|---|
| session quiet | **27.3%** | 29.7% | 22.6 – 42.3 |
| agent producing output | **46.8%** | 45.9% | 36.0 – 49.3 |

**+19.4 points**, with the ranges barely overlapping — 3 of 15 baseline samples reach
the loaded condition's minimum.

Two corrections follow, and neither is comfortable:

- The "43–49% WindowServer" quoted repeatedly while diagnosing a slowdown was **not a
  state**. Baseline is ~27%. Nearly every reading was taken immediately after dumping
  output to the screen — **the measurement was measuring the act of measuring.**
- The mystery being investigated for several turns did not exist. There was no
  unexplained compositor load; there was an observer.

*What survives:* the display intervention, because it was measured in tokens per
second on the same phase of the same problem — 4.0 to 7.9 — not in compositor CPU.
*What does not:* every sentence attributing that gain to WindowServer.

*Changed:* check on a run infrequently and in as few tool calls as possible. The pilot
already wrote the rule down — *a chat agent cannot supervise a run* — about memory.
This is the same rule with a different mechanism, and it was violated for most of a
session.

### 4.5 A timed-out run leaves its request alive, and the next run queues behind it

`subprocess.run(timeout=…)` kills the child it started. It does not kill the
grandchild. So a timed-out `ft-go` leaves its in-flight `ft-run` generating, and
because the server serialises one request at a time, **the next run then waits behind
a process nobody is listening to.**

Observed directly: problem 02 was killed at its timeout, and twenty-two minutes later
its orphaned request was still generating a repair for a run that no longer existed,
while problem 03 sat in the queue showing a phase name from the previous problem.
Reading the phase label was what gave it away — it named a file problem 03 does not
have.

*Changed:* on a timeout, `ft-campaign` kills the request the run left behind.

### 4.4 Killing the watcher killed the run, twice, and it looked like a clean exit

`ft-campaign` captures `ft-go` through a pipe. Kill the orchestrator and the read end
closes; the child then dies on its **next print** with `BrokenPipeError`, passing
through its `finally`, releasing the lock and leaving no `meta.yaml`.

It ended problems 02 and 05 that way — 6 of 10 files and 4h49 of work respectively —
and both times the evidence said *clean exit*: lock released, server up, no traceback.
The claim made at the time, that killing only the orchestrator would leave the run
going, was wrong. It survives exactly until it next has something to say.

*Changed:* `say()` swallows `BrokenPipeError`. **A run must outlive whoever was
watching it** — the whole point of the campaign design is that it survives being left
alone. `ft-campaign` also tees each run's output to `ft-go.log` inside the run
directory, so a killed orchestrator does not take the log with it.

### 3.5 The gate roughly doubles a run, and the repair loop is why

With the gate armed for the first time, problem 02 wrote all ten of its files and was
then **killed at exactly six hours** by the campaign's own timeout, with no
`meta.yaml`. Every file existed; the run did not.

The repair loop is the cost. A repair rewrites the whole file — `whole` format, not a
diff — and at the model's default effort it deliberates over the rewrite as if it were
new work. **Roughly 19 minutes per repaired file**, against 6–7 minutes for the same
phase in the self-test. Five repairs put the run past the limit.

*Changed, two ways:*

- **Repairs run at `reasoning_effort: low`.** Named as a harness choice rather than
  slipped in: a repair is not design work. It is *"change exactly what these compiler
  messages require"*, with the messages quoted in full — a constrained edit against an
  exact specification, which is the one place lowering the dial costs least.
- **The timeout goes from six hours to eight.** Six was set when the gate could not
  fire and runs took five.

*What this does not fix:* a run that needs more than two repair rounds still fails the
gate, and now fails it faster. That is the intended behaviour — `revisions.self_repairs`
is recorded and a repaired run is the one to read first — but the ceiling on repairs has
never been tested against a model that needs three.

## 5. What is not established

- **Nothing about the model.** The first campaign ran at the wrong temperature and was
  discarded; the corrected one has not started. Every entry in §1 is about the server's
  behaviour, not the model's.
- **One model, one machine.** Nothing here separates the model from this hardware, and
  §2 exists because the hardware turned out to matter more than expected.
- **No problem has been run end to end and judged** at the correct parameters. The
  self-test proves the plumbing; a self-test is not a problem.
- **No judging has been blind.** Every assessment so far was the operator's, and the
  four verdicts that existed were discarded with their runs.
- **The `aider` and `chat` conditions have not been run.** Their costs in
  [`harness/conditions.md`](harness/conditions.md) come from the pilot's record and from
  this harness's design, not from measurements taken here.
- **The ladder has not been run.** `--spec ladder` is implemented and untested, and it
  is the axis that separates *cannot design this* from *cannot implement this* — the
  most useful cell in the results table and still empty.
- **The reading phase does not exist.** Designed in
  [`docs/reading-phase.md`](docs/reading-phase.md), not built, so what the model chooses
  to read from an existing codebase is unmeasured.


## 6. Open predictions

Written before the data, so they can be wrong rather than rationalised afterwards.

### 6.2 `medium` may be the better setting, and the campaign will not use it

At the model's own default effort, **12 of 30 phases (40%) hit the output ceiling**.
When the retry at `low` then succeeds, the work it actually needed was a median of
**7,115 tokens, ranging 1,433–13,202** — much closer to the 16,384 ceiling than the
early trivial-task measurements suggested. There is less room between `low` and the
ceiling than expected, so `medium` producing more than `low` may simply overflow too.

**This will be measured and not acted upon.** The test reruns phases that
demonstrably overflowed at the default, at `medium`, with everything else held — the
same one-axis shape used for the reasoning experiment. If they fit, `medium` becomes a
serious candidate; if they overflow, it is dismissed for the cost of one afternoon
rather than several days.

**And the campaign keeps the current configuration regardless of the answer.** Not
because the answer does not matter, but because eighteen problems measured under two
settings are not a set — the first ones would be incomparable to the rest, exactly the
mistake that cost the first campaign. A better setting found halfway through is an
argument for a second pass, not for switching mid-flight.

There is also a real question underneath, which the measurement alone will not settle:
running at the model's default measures **the model as shipped**, while running at
`medium` measures **the model as a competent user would configure it**. Both are
legitimate and they answer different questions. The default is the standard here
because it is the one that needs no justification.

### 6.1 Test files may overflow, and the two-pass phase is already in place

Under the discarded parameters, test files hit the output ceiling **5 of 9** times
against 6 of 31 for everything else — roughly threefold. The two-pass test phase was
built on that: enumerate the cases at the model's default effort, where naming what
would have to break is the thinking worth having, then write them at
`reasoning_effort: low`, from a list that already holds the decisions.

Capping tests per file was rejected — coverage is a scored criterion, and buying
throughput with it is the wrong trade. Lowering `max_tokens` was rejected as cutting
the waste without touching the cause. Making the plan split its test files was
rejected as the harness designing on the model's behalf.

**Open, because the numbers behind it are gone.** Temperature moves exactly this: how
much a model deliberates before answering. The rate may be lower at 1.0, or higher, or
unchanged.

**Prediction:** test files still overflow more than other files, and the two-pass phase
keeps the artifact intact when they do.

**What would falsify it:** test files overflowing at the same rate as everything else,
which would mean the two-pass phase is machinery for a problem that no longer exists
and should come out.

## Appendix A — superseded by the parameter correction

*Entries keep the numbers they had when written; §1 was renumbered after they moved.*

These were measured at temperature 0.6, before `reasoning_effort` was known to the
harness. They are kept because how a model spends its output budget is exactly the
kind of thing a temperature change moves, and the next campaign gives a clean
comparison against them. **None of them should be quoted as a property of the model.**

#### 1.1 Generation runs at ~10.6 tokens/second, and slows as the prompt grows

Measured across a complete self-test run on a quiet host, stable across phases.
On a real problem it degrades within a run as later phases carry more context:
**10.5 tok/s at 1.4k input tokens, 6.1 at 5.5k, 3.8 at 7.4k** — with the host
clean, 0 of 13 samples under pressure. Attention cost, not memory.

*Consequence for planning:* problem 01 variant A took **4.5 hours**, above the 2.7 h
pessimistic estimate, because the estimate assumed a flat rate.

**And the rate is not a property of the model.** The same problem's early phases were
measured at 10.2 / 9.6 / 10.5 tok/s in one run and **4.4 / 3.8 / 4.3** in the next —
2.5× apart, with memory clean, no swap activity, no thermal warning and on AC power.
What differed was the machine around it: an editor compositing hard, its GPU helper
process, and lint runs from another project appearing at 140–190% of a core.

There is no clean before-and-after here — the editor was open both times — so the
attribution is *contention*, not a specific culprit. What is established is narrower
and still useful:

- **memory figures report a healthy host while throughput halves**, so an instrument
  that measures only memory is blind to most of the variance
- **tokens per second is a property of the run, not of the model**, and belongs in
  `meta.yaml` beside the contention that produced it rather than in a summary

`ft-vitals` now samples load, GPU utilisation, what share the server is getting, and
any process above 25% CPU; it flags one above 80%.

**Then it was tested by intervening, mid-run.** Four displays became two, and the
remaining ultrawide went from 240 Hz to 60 — cutting compositing from 3,089 to 1,224
Mpx/s, a 60% reduction on the same GPU the model runs on.

| | before | after |
|---|--:|--:|
| **generation** | **4.0 tok/s** | **7.9 tok/s** |

Roughly double, on the same problem, the same kind of phase, the same model. Still
short of the 10.5 measured when the machine was otherwise idle, so contention remains.

**The mechanism is NOT established, and an earlier version of this entry claimed it
was.** It reported CPU shares — the server rising from 20% to 53%, the compositor
falling — from `ps -o %cpu`, which on macOS is the average over a process's entire
lifetime rather than a sample. A server up sixteen hours and mostly idle reports
single digits while it is generating, and the figure drifts on its own. Checked
against `top -l 2`: `ps` said the server was at 0.7%, and `top` did not list it in the
top six at all. **Both are right.** The model is GPU-bound; MLX uses almost no CPU.

So the outcome stands — it was measured in tokens per second, on the same phase of the
same problem — and the explanation attached to it did not. Which is the mistake
described two paragraphs below, committed in the paragraph above it.

**A note on which number to watch.** The first indicator to move was WindowServer's
CPU falling, and it was the wrong one: it dropped after two displays were removed
while throughput had not yet changed at all. The share the *server* was getting was a
better proxy, and still only a proxy. Only tokens per second settled it, and it took
forty minutes to arrive. A criterion moving in the expected direction is not the
result — which is the same trap this repository measures in models.

#### 1.4c The ceiling retry, validated in production

The first real ceiling hit of the campaign fired it. Same file, same phase:

| | output | wall | result |
|---|--:|--:|---|
| reasoning on | 16,384 (ceiling) | 40 min | deliberation; the extractor would have written a fragment |
| **retry, reasoning off** | **1,873** | **3.9 min** | complete file, imports and class intact |

Nine times fewer tokens for a better artifact, and it is the same file whose first
attempt in the discarded run produced code beginning at `async processMessages()` with
no class around it.
**An earlier figure of 5.1 was wrong** — it was taken while the host was swapping, and
it measured the swap file. Corrected here rather than deleted, because the mistake is
the finding: throughput is not a property of the model alone.

*Changed:* campaign arithmetic. A phase that fills the output budget costs 26 minutes.

#### 1.3 With reasoning, output is bound by the budget. Without it, by the task.

**Confirmed.** Four measurements, one axis, two task sizes:

| | self-test (2 files) | problem 01 (14 files) |
|---|--:|--:|
| reasoning **on** | 16,249 / 16,384 — **99.2%** | **16,384 / 16,384 — 100%**, `finish_reason: length` |
| reasoning **off** | 1,020 | 4,327 |

Two tasks of very different size both consumed essentially the whole budget when
reasoning was on. With it off, output scaled with the task instead — 1,020 to 4,327,
roughly four times, which is about the ratio between the two tasks.

The plan the model actually needed for problem 01 was 4,327 tokens. With reasoning on
it spent 16,384 and emitted no plan at all: 68,531 bytes of deliberation returned as
content (see 1.4).

*Changed:* **raising the server's output ceiling is off the table as a fix.** Doubling
it buys a 32,000-token deliberation instead of a 16,000-token one, at twice the wall
time, with the same empty result. Memory would allow it — even 131,072 tokens of
output fits with 6 GiB to spare — so the constraint was never the one it looked like.

This is the mechanism behind a rule the pilot had already written down from
experience: *raising the window to fix a truncation is the obvious move and usually
the wrong one.*

> **Caveat on the timing only.** The host began paging in C's final minutes, so its
> 1,607 s is contaminated. The token count is not: a hard ceiling hit at exactly
> 16,384 is the same number whatever the machine was doing.

#### 1.4b Implementation phases fill the budget too, on the files that are hard

The self-test suggested reasoning was only pathological in phase 0 — its two
implementation phases used 14% and 43% of the budget. Problem 01, variant A,
corrected that:

| | phases | output | reasoning |
|---|--:|---|---|
| finished normally | 8 of 11 | 439 – 10,699 tokens | 1,725 – 44,882 chars |
| **hit the ceiling** | **3 of 11** | 16,384 each | reply was deliberation |

The three were the repository, the service and the spec — the three hardest files in
the manifest. So it is not "phase 0 is special": **reasoning fills the budget whenever
the model finds enough to deliberate about**, and on a real problem that is the files
that matter most.

Worse than an empty file: the extractor takes the largest fenced block from a reply
full of code fragments, so one file was written beginning at `async processMessages()`
with no class around it. **It looks like code.** An empty file announces itself; a
plausible fragment does not.

*Changed:* a file phase that hits the ceiling is retried once with reasoning off — the
mode measured to produce an answer rather than fill the budget — and both attempts are
kept. The default is still the model's own, and `meta.yaml` records
`ceiling_retries_without_reasoning`.

#### 1.5 The model plans well when given the budget to answer

With reasoning off, problem 01 variant A produced a 14-file manifest in correct
topological order — module registration and `DESIGN.md` included — in 4,327 tokens and
7 minutes, and **decided all eight of that problem's must-haves correctly**: hold
rather than debit, a row lock for the reservation, the outbox inside the creation
transaction, funds never released on retry exhaustion, integer minor units throughout.

*Changed:* reasoning off for phase 0, on for implementation phases — where it is
productive, one having spent 7,500 characters of it on 2,300 tokens of clean code. A
per-phase axis, recorded in `meta.yaml`, not a switch.

> **Caveat:** judged by the operator against the rubric, not blind. It is a design
> signal, not a verdict.

---

#### 1.6 It writes a thorough-looking suite whose critical test is decorative

Problem 01 variant A produced seventeen tests covering every case the statement
demands, including a correct distinction between ambiguous and definitive provider
failure. Then the one test that had to catch the actual defect could not, for two
reasons at once: it runs against an **in-memory fake of the repository**, so it never
reaches the real code where the missing lock lives, and `Promise.allSettled` over a
synchronous Map **is not concurrency** — single-threaded, the first payout completes
before the second begins.

`does not overdraw under concurrent creation` is green against an implementation that
overdraws.

*Why it matters beyond one run:* this is the failure the repository's own rubrics call
hollow coverage, produced spontaneously and at a level that reads as diligence. An
absent test is a gap someone can see. A green test named after the property it does
not check is a claim.

*Changed:* nothing in the harness — the rubric already gates on it. But it is the
clearest argument yet for the rule that the operator runs the deliverable's tests and
reads what they actually assert, rather than trusting a green suite.

#### 1.4d A ceiling hit produces plausible garbage in a third distinct way

Three manifestations now, all from the same cause and each looking different:

| | what was written |
|---|---|
| phase 0 | 68 KB of deliberation, saved as `PLAN.md` |
| an implementation phase | a fragment beginning at `async processMessages()`, no class around it |
| **another implementation phase** | **a file whose first line is ` ```ts `** and whose last line stops mid-statement |

The third came from a reply carrying **43 fence markers** — the model deliberating in
code blocks — so the largest-span heuristic captured a region that itself contained
fences.

*Changed:* stray fence lines are stripped from any extracted artifact, leading and
trailing. Cheap, and never wrong: a line that is nothing but a fence is not part of
the file. The retry remains the real fix; this is what stops a truncated reply from
producing something that *looks* like a file when the retry does not get to run.

*Which it did not, here.* The process was terminated between the ceiling hit and its
retry, so the polluted file was the artifact on disk. Had it been judged, `payout.service.ts`
would have read as the model failing to produce valid TypeScript — a defect that is
entirely the harness's.

#### 1.4e The repair loop overflows too, and had no retry

Problem 05 ran seven repair phases; **three of the last four hit the ceiling**, 27–28
minutes each, producing nothing. The retry after a ceiling hit had been added to file
phases and not to repairs — which is where a run now spends its longest hours, since
the gate only started firing at problem 04.

*Changed:* a repair that hits the ceiling is retried once with reasoning off, same as
a file phase, and recorded as `repair:<path>` in `ceiling_retries_without_reasoning`.
