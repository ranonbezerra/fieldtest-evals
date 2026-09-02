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

### 1.3 The plan contradicts itself, and the code implements the executable half

Across the three judged runs, **every must-have in all three rubrics was named in
`PLAN.md`** — twenty of twenty. Three were then missing from the code, and the first
reading of that was drift: decided right, lost in implementation. That reading was
wrong. In all three cases the plan states the requirement **and its violation**, in
different sections, and the code is a faithful implementation of one of them.

Both plans use the same structure, unprompted: §1 Assumptions, §2 Data model, §3 Types
and signatures (ending in *Ordering rules*), §4 Control flow, §5 Tests, §6 Manifest.
Invariants live in §3 as prose and as type signatures. Procedures live in §4 as
numbered steps and literal SQL. The three failures are all a disagreement across that
boundary.

| Run | MH | The invariant | The procedure | Built |
|---|---|---|---|:-:|
| 01 | M4 | §3:164 — *"must use a conditional update (`WHERE status = 'pending'`) so two workers cannot claim"* | §4:190 — `UPDATE … WHERE id=? AND status IN ('pending','processing')` | §4 |
| 01 | M7 | §1 — *"never assume a transfer failed when we cannot confirm; a human inspects before releasing or confirming"* | §4:196 — *"if attempts >= maxAttempts: in one transaction → `releaseHold`, `updatePayoutStatus(→ needs_review)`"* | §4 |
| 03 | M1 | §4:271–277 — *"opens a Prisma transaction … all inside the transaction … Commit transaction"* | §3:195 — `applyOrderCreated(input, order): Promise<void>`, no parameter to carry one | §3 |

The pattern is not "§4 wins". It is **the more executable form wins**: literal SQL beats
a prose rule, and an existing parameter list beats a prose instruction. In problem 03 the
signature had a second advantage — it was written at phase 04 and needed at phase 10, so
by then it was a file on disk that the new file had to compile against. Prose in §4
cannot change a parameter list.

*What this means for a developer:* the model is not failing to follow its plan. It
follows it exactly. Reading the plan and approving it is not enough, because the plan
approves of two incompatible things and only says so if you read its sections against
each other. The check is mechanical and cheap: take every *must* in the ordering rules,
find the numbered step that implements it, and read them side by side. All three defects
here are visible in that one pass, before any code exists.

*What this means for the harness:* phase 0 emits a specification that is never checked
against itself. A consistency pass between phase 0 and phase 1 — quote each invariant,
name the step that satisfies it, reconcile the disagreements — is the intervention this
finding argues for. It is **not** being applied in this pass; the configuration is fixed
for all eighteen (§6.2). Recorded as the strongest candidate for a second pass, alongside
§3.6.

*Superseded:* an earlier version of this finding was titled *"The plan is more reliable
than the code that implements it"* and read the three failures as implementation drift.
It reached the verdicts for problems 01 and 03 before it was checked against the plans'
§4 sections. Both verdicts now record `plan_gate: wrong` for the affected must-haves
rather than `decided`.

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

### 4.6 A fix to the orchestrator does not reach the orchestrator already running

The run timeout was raised from six hours to eight after problem 02 was killed at
exactly six. Problem 03 was then killed at exactly six as well.

`ft-campaign` reads its source once, at launch, and had been running for seventeen
hours. `ft-go` is re-invoked per problem and picks up changes immediately; the
orchestrator around it does not. Two runs were lost to a fix that had been committed,
pushed, and was sitting in the file the running process was no longer reading.

*Changed:* nothing in the code. The rule is operational and belongs written down:
**a change to `ft-campaign` requires restarting `ft-campaign`.** A change to `ft-go`,
`ft-run` or the instructions does not.

Third variant today of the same shape: a correction applied in one place and not
another. The retry existed for file phases and not for the case phase; the abort in
phase 0 read the first attempt's counters and not the retry's; and here the fix
reached the file but not the process.

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

### 4.7 A resumed run reported the tail of itself as the whole run

`meta.yaml` summed only the phases of the invocation that wrote it. Both problems 02
and 03 were interrupted and resumed, so both recorded the segment after the resume as
if it were the run:

| | meta.yaml said | the requests say |
|---|---|---|
| 02 | 57 min, 35,116 tokens | **340 min, 200,810 tokens, 23 requests** |
| 03 | 172 min, 104,583 tokens | **454 min, 272,380 tokens, 37 requests** |

Problem 01 ran start to finish in one invocation and its meta matches the requests
exactly — 250 against 249 minutes, tokens identical. That agreement is what made the
other two look trustworthy.

The numbers were not implausible. A 57-minute run beside a 250-minute one reads as a
model finding — *this problem was easier* — and it was published as one. The
underestimate is six-fold and points the same direction every time, because the tail
of a run is always shorter than the run.

*Changed, three things:*

- `ft-go` now totals from `steps/*.usage.json`, which every request appends to and a
  resume adds to rather than replaces. `wall_minutes` stays this invocation's, now
  flagged `wall_is_this_invocation_only`, and `resumed` is recorded.
- `ft-campaign` appends to `ft-go.log` with a timestamped separator instead of
  overwriting it. The old behaviour left two runs' logs reading, in their entirety,
  `timed out` — the first invocation's output was discarded on `TimeoutExpired` and
  the second invocation never wrote there at all.
- `sh()` keeps what the child had already written when it kills it. `TimeoutExpired`
  carries `stdout`; the handler was returning the string `"timed out"` in its place.

*And a better instrument was already there.* Every request records
`host_pressure_at_send`, which is the condition at the moment it mattered rather than
a periodic sample. By that measure all three runs are clean — 0 of 15, 0 of 23, 0 of
37 requests sent under pressure — where `host.samples` had taken 12, 1 and 2 samples
respectively and could not have supported the claim. The verdicts now quote the
per-request count.

*Also swept:* `ft-go` recorded `temperature` with a fallback of `0.6` — the discarded
campaign's value — for the case where `FT_ENV` had not been sourced. It never fired,
because `ft-env.sh` sets 1.0. It is now 1.0 in both places.

### 4.8 A new instrument's first run reported ten refusals as ten successes

`ft-effort` replays the phases that overflowed at a different `reasoning_effort`. Its
first run was refused by `ft-run` on all ten phases — the host had 4.1 GiB of margin
against the 6.0 GiB the harness requires — and it printed `fits` ten times.

A refused request writes no usage record. The tool read the absent record with
`.get("output_ceiling_hit")`, got `None`, and `bool(None)` is `False`: no ceiling hit,
therefore it fit. The absence of evidence was read as evidence of success, in the
direction that produces a finding rather than a blank.

*Changed:* a missing usage record is now `NOT RUN`, counted separately, and the summary
distinguishes "phases that ran" from "phases". A run where nothing ran now says so.

This is the eighth instrument to fail in this direction and it was written after the
seven others were catalogued, in a file that opens by naming the pattern. Writing the
finding down does not confer immunity to it. The rule that does the work is narrower
and mechanical: **when a measurement comes back empty, the code must say which of "it
did not happen" and "it happened and was fine" it is looking at.** Every defect in this
section is a place where those two collapsed into one branch.

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
- **The timeout goes from six hours to twelve.** Six was set when the gate could not
  fire and runs took five. Eight was set next, and problem 03 then ran 7.6 hours —
  twenty-four minutes of margin, which is not margin.

*Now measured, on three complete runs:*

| run | repair requests | share of output | time | gate |
|---|--:|--:|--:|:-:|
| 01 payout outbox | 0 of 15 | 0% | — | passed |
| 02 reconciliation resend | 10 of 23 | **33%** | 1.9 h | failed |
| 03 read model projection | 14 of 37 | **33%** | 2.5 h | failed |

Both failing runs spent exactly a third of their output on repairs, and both still
failed. The repair loop is not a rescue with a cost — on this evidence it is a cost
that has not yet rescued anything. What it did buy is diagnosis: problem 02's three
rounds fixed every type error they understood and never once touched the `TS2307`
that was in the output all three times (§3.6), and that contrast is the finding.

*What this does not fix:* a run that needs more than two repair rounds still fails the
gate, and now fails it faster. That is the intended behaviour — `revisions.self_repairs`
is recorded and a repaired run is the one to read first — but the ceiling on repairs has
never been tested against a model that needs three.

### 3.6 One file per request holds a convention inside a run of phases and drops it between them

The single largest cause of gate failure so far is not a domain error. It is the `.js`
extension that `"type": "module"` with `moduleResolution: NodeNext` requires on relative
imports. Omitting it produces `TS2307: Cannot find module` on files that exist.

It accounts for **23 of the 32 remaining errors in problem 03** and **every unresolved
error in problem 02**, whose six must-haves are otherwise all satisfied. Problem 01
compiled on the first attempt.

The scaffold is byte-identical across all three runs. What differs is the model, and it
differs *within* a run. Problem 03's split follows the phase order exactly:

| phases | files | extension |
|---|---|---|
| 02–05 | `projections/*` | none |
| 06–09 | `operations/*` | `.js` |
| 10 | `writes.service.ts` | none |
| 11 | `writes.module.ts` | `.js` |
| 12–14 | `drift-repair/*`, `app.module.ts` | none |

Consistent inside a run of consecutive phases, reset between them. Each file is an
independent request, and nothing carries the previous file's import style forward, so
the convention is re-decided from scratch every few phases. Problem 01 compiled because
its coin came up `.js` fourteen times; problem 02 failed because it never did.

The model does not recognise the symptom as its own. `drift-repair.processor.ts` carries
`// ASSUMPTION: ../projections/projections.service ... cannot be resolved` written
directly above the import that cannot be resolved — it saw the error and attributed it
to the workspace.

*Not changed, deliberately.* Setting `moduleResolution: bundler` in the scaffold would
tolerate both styles and lift two runs from fail to judged-on-merit. It is not being
done, for the same reason as §6.2: the standard has to hold for all eighteen problems,
and this is a real property of the model's output that problem 01 shows is within its
reach. It is recorded here as the first candidate for a second pass.

*This is the cost of the phase design in §3.1.* The decomposition that made the work fit
the ceiling is also what breaks cross-file consistency. Feeding each phase the import
lines of the files already written is the obvious repair and is not yet built.

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

### 6.2 `medium` fits, and the campaign has been running on plans written at `low`

Measured, one axis, everything else held. Six phases ran; four were refused when
`fileproviderd` took 130–143% CPU and are still pending.

| phase | at the default | at `medium` |
|---|--:|--:|
| 01 `00-plan` | 16,384 — ceiling | **5,380** |
| 01 `payout.repository.ts` | 16,384 — ceiling | **10,694** |
| 01 `payout-worker.service.ts` | 16,384 — ceiling | **6,210** |
| 01 `payout.controller.ts` | 16,384 — ceiling | **4,362** |
| 01 `payout.spec.ts-cases` | 16,384 — ceiling | **3,737** |
| 03 `00-plan` | 16,384 — ceiling | **5,706** |

Six of six fit, none near the ceiling. The largest used 65% of it; the median used 36%.
The earlier prediction here — that `medium` produces more than `low` and would overflow
too — was wrong, and wrong in an interesting way. **The medium plan is shorter than the
low plan**: 5,380 tokens against 7,140 for problem 01. More deliberation did not buy
more output. It bought a tighter document.

**The structural finding is what this experiment actually turned up.** Phase 0 overflows
at the default in **3 of 3 runs**, so every plan in this campaign was produced by the
harness's ceiling fallback and written at `reasoning_effort: low`:

| run | plan at default | plan at `low` | governs the run |
|---|---|---|:-:|
| 01 | 16,384, cut off — never reached the interfaces | 7,140 | the `low` one |
| 02 | 16,384, cut off | 9,676 | the `low` one |
| 03 | 16,384, cut off | 6,912 | the `low` one |

Problem 01's default-effort attempt does not contain the string `claimMessage` at all —
it was cut off before it got to the interface section. The document that governs every
downstream file phase is the `low` retry.

And the `low` plans are where §1.3's contradictions live. At `medium`, on the same two
must-haves that failed problem 01:

- **M4** — §3 `claimMessages(limit) // FOR UPDATE SKIP LOCKED, PENDING only`, §4
  *"selects up to 10 PENDING messages with FOR UPDATE SKIP LOCKED"*. The sections agree,
  and the mechanism is stronger than the conditional update the `low` plan specified.
  It also merged `claimMessage` and `claimStaleMessages` into one primitive, which is
  where the `low` plan's ambiguity came from.
- **M7** — stated three times and consistently: §1 *"keep funds reserved … releasing
  would risk double-spend"*, §4 *"set payout → NEEDS_REVIEW … (funds stay reserved)"*,
  and a test asserting *"funds remain reserved (not released back)"*.
- **03's M1** — partially. The hook interface now takes `tx: Prisma.TransactionClient`,
  so the transaction is carryable, which is exactly what the `low` plan made impossible.
  The doc comment above it still reads *"AFTER their transaction commits (same tx in
  practice)"*, which is the same muddle. The signature is what gets implemented (§1.3),
  so this one is fixed in the half that decides.

*What this does not establish.* One sample per phase, at temperature 1.0. A second
`low` plan might not contradict itself and a second `medium` plan might. What is not a
sampling question is the ceiling: 3 of 3 plan phases overflowed at the default, and 6 of
6 phases fit at `medium` with a third of the budget unused.

*What it does establish.* The campaign is not measuring "the model as shipped". At this
output ceiling the model as shipped does not produce a plan — it produces 16,384 tokens
of deliberation and stops. What the campaign measures is the model working from a
specification the harness obtained by turning its reasoning down, and §1.3's three
failed must-haves are all defects in that specification.

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
