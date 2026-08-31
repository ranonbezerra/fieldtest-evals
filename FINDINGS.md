# Findings

Everything measured while building this harness and running the first model against
it. One entry per finding: **what was measured**, the number, and **what it changed**.
A finding with no consequence is an anecdote, and a consequence with no number is a
preference — neither belongs here.

Entries are dated by the state of the repository, not the calendar. When a later
measurement contradicts an earlier one, the earlier entry is corrected in place and
says so, because a findings file that only accumulates becomes a place to argue from
rather than a place to check.

**Under test:** `Qwen3.8-27B-MLX-6bit` — Qwen3.5 hybrid, 64 layers with full attention
every fourth, 6-bit MLX, 22.27 GiB resident, served by oMLX on a 48 GiB Apple Silicon
Mac. Reasoning on by default.

---

## 1. The model

### 1.1 Generation runs at ~10.6 tokens/second, and slows as the prompt grows

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

### 1.4c The ceiling retry, validated in production

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

### 1.2 The output ceiling is 16,384 tokens, and reasoning is paid out of it

Not a model limit — the model's own config imposes none, and its architecture supports
262,144 positions. It is an oMLX per-model setting.

*Changed:* the entire harness shape. The deliverables of a single problem do not fit in
one reply, which is why work is decomposed into one file per request.

### 1.3 With reasoning, output is bound by the budget. Without it, by the task.

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

### 1.4 A ceiling hit mid-reasoning returns the reasoning as the answer

When the ceiling cuts the model before its thinking closes, the server cannot separate
the two and returns the deliberation in `content`, with `reasoning_content` empty. The
harness wrote 68 KB of it to `PLAN.md` and continued as though it were a specification.

*Changed:* `ft-go` treats a ceiling hit in phase 0 as a failure and writes no artifact.
A phase that was cut off did not answer.

### 1.4b Implementation phases fill the budget too, on the files that are hard

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

### 1.5 The model plans well when given the budget to answer

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

## 4. The instruments were wrong twice, in the direction that gets them ignored

Recorded because the repository's whole subject is checks that pass for the wrong
reason, and it would be dishonest to exempt its own.

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

### 4.0b A gate in the wrong place empties a run instead of stopping it

Worse than any false positive above, and a design error rather than a measurement one.
`ft-go` gates on host pressure once, at the top — the decision point. Each phase then
gated again through `ft-run`, so a run already in progress **abandoned itself file by
file** and committed a plan with ten empty files beside it.

*Changed:* pressure appearing mid-run is recorded — `host.pressure_samples`, and
`host_pressure_at_send` per request — and the run is marked not comparable. A run you
must discount is strictly more useful than no run at all.

Both were found by running them against the real machine, not by reading them.

### 4.1 The self-test earns its place

Four defects, all mine, found on its first run before a campaign spent hours: a crash
at capture from a renamed flag; a manifest parser matching the placeholder in its own
instruction's example; 1.4 above; and a contradiction I had written into the self-test
variant — "no dependencies" against a cheatsheet saying "tests use Vitest". The model
spent its budget asking whether Vitest counted, and **the question restarted rather
than resolving**, which is `reference_gap` by this repository's own diagnostic.

*Changed:* run [`harness/selftest`](harness/selftest) after any change to the runners
or the phase instructions. It costs minutes and has already saved hours twice.

---

### 1.6 It writes a thorough-looking suite whose critical test is decorative

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

### 1.6b The agent watching the campaign was loading the machine it was measuring

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

### 1.4d A ceiling hit produces plausible garbage in a third distinct way

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

### 1.7 An unexplained gap between what the client waits and what the server counts

Recorded as an open measurement, not a diagnosis.

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

## 5. What is not established

- **One model, one machine.** Nothing here separates the model from this hardware.
- **One sample per cell** in the reasoning experiment, and the fourth cell is still in
  flight (1.3).
- **No problem has been run end to end and judged.** The self-test proves the
  plumbing; it is not a problem.
- **No blind judging has happened.** Every assessment so far is the operator's.
- **The `aider` and `chat` conditions have not been run.** Their costs are documented
  from the pilot's record and from this harness's design, not from measurements taken
  here.

---

## 6. Open predictions

Written before the data, so they can be wrong rather than rationalised afterwards.

### 6.1 The gate is disarmed by construction, and it should repeat on problem 02

Problem 01's manifest declared ten files and no `tsconfig.json`, so `ft-go`'s typecheck
could not run at all — and the run's most serious defect, an invented Prisma `lock`
option, is one a typecheck catches in seconds.

**This is not the model's failure.** Three pieces of evidence:

- the variant's Deliverables list asks for schema, migration, module, tests and
  `DESIGN.md`. It never mentions build configuration
- the phase-0 instruction explicitly tells the model not to deliberate about it:
  *"where the task leaves a convention open — which file something lives in, **whether
  a config file is in scope**, how a helper is named — choose, write it in section 1
  in one line, and move on"*
- the plan recorded eleven substantive assumptions, including one about configuration
  (intervals via environment variables, *"no hardcoded config"*). It read the
  deliverables list correctly and did not consider `tsconfig` part of the scope

So the chain is: a statement that does not ask for build config, feeding a gate that
only runs when build config exists. **A gate that cannot fire is decorative** — which
is precisely what problem 16 exists to measure, committed here in the harness itself.

**Prediction:** problem 02 variant A will also omit build configuration, and its gate
will also report `ran: false`.

> **CONFIRMED.** Problem 02's manifest declared ten files and zero configuration;
> `gate: ran=false`. Two runs, independently, read the deliverables list correctly.
> The fix was then implemented — `harness/gate-scaffold/`, copied in after the
> model's last phase and recorded per run as `gate_scaffold_added`.
>
> **And validated against problem 01, which the gate had never seen.** Running it
> over that workspace:
>
> ```
> payout.repository.ts(40,9): error TS2322: Type '{ mode: string; }' is not
>                             assignable to type 'never'
> payout.repository.ts(89,9): error TS2322: ... (same)
> ```
>
> Lines 40 and 89 are exactly the two `lock: { mode: 'FOR UPDATE' }` calls. The gate
> rejects the invented API in seconds.
>
> It also found three defects the operator's manual review had missed: `Cannot
> redeclare block-scoped variable 'payout'` twice in the service — a plain compile
> error — several `'err' is of type 'unknown'` under `strict`, and twelve imports
> written without the `.js` extension that ESM requires and the cheatsheet declares.
>
> **A human reading 300 lines of plausible TypeScript missed a duplicate `const`.**
> That is the argument for the gate in one line.

**If it repeats:** the harness supplies a minimal `package.json` and `tsconfig.json`
before the gate, with the dependencies the cheatsheet declares. The model keeps
delivering what the statement asks for; the gate becomes able to fire. Changing the
statements instead would change what eighteen problems measure, and spend the model's
budget writing config rather than solving the problem.

**If it does not repeat:** the more interesting outcome. Two runs of the same harness
diverging on whether config is in scope would mean the instruction leaves it genuinely
open, and the fix is to settle it in the instruction rather than to paper over it in
the gate.
