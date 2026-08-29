# Harness

Every model answers the same question under the same conditions. If the setup varies
between runs, you are measuring the setup.

Three ways of reaching the model are in scope, and the eval runs all three: they are
how this work is actually done, and their differences are a finding rather than a
nuisance. [`conditions.md`](conditions.md) documents each and what it costs.

```
harness/
  ft-env.sh              locates the repo, loads credentials, fixes the parameters
  ft-flush               releases the server's accumulated KV cache
  ft-run                 one request, direct to the API          (runner: api)
  ft-aider               one request, through aider              (runner: aider)
  ft-go                  orchestrates a whole run, either runner
  ft-lint-cheatsheet     finds answers leaking from a cheatsheet into a rubric
  instructions/          the phase prompts — the most load-bearing text here
  cheatsheet/            the conventions every request is given
  chat/                  what the by-hand chat condition needs
  ft-vitals              host memory, the server's ceiling, and whether it is safe to measure
  conditions.md          the three ways in, and their trade-offs
  host-limits.md         what the machine does to the measurement
  judge-prompt.md        blind judging
```

## The model under test

| | |
|---|---|
| id | `Qwen3.8-27B-MLX-6bit` |
| architecture | Qwen3.5 hybrid — 64 layers, full attention every 4th (16 full, 48 linear) |
| quantization | 6-bit MLX, group size 64, affine |
| weights resident | 22.27 GiB |
| server | oMLX, OpenAI-compatible, on a 48 GB Apple Silicon Mac |
| reasoning | **on by default** (`thinking_default: true`), and paid out of the output budget |
| generation | **~10.6 tok/s on a quiet host**, stable across phases. Under swap pressure the same model measured 5.1 — that figure was the machine, not the model |

## Fixed parameters

| Parameter | Value | Why this value |
|---|--:|---|
| temperature | 0.6 | The model's own generation config ships `temperature 1.0, top_p 0.95, top_k 20`, and Qwen's guidance for reasoning mode is 0.6/0.95/20. **The obvious choice — 0.2, for determinism — is wrong here:** near-greedy decoding sends a reasoning model into repetition, and the repetition is paid out of the same 16,384 tokens as the answer. Determinism is bought with variants and repeat runs, not with a temperature that changes the failure mode. |
| top_p | 0.95 | as above |
| top_k | 20 | as above |
| max_tokens | 16384 | the server's ceiling; not a choice |
| context window | 32768 | measured — see below |
| system prompt | the problem's cheatsheet, nothing else | |
| tools | none in the `api` and `aider` conditions | the phases carry everything the model may see |
| time budget | none | wall time is recorded, not capped |

Changing any of these invalidates comparison with every run already recorded. They
live in one place, [`ft-env.sh`](ft-env.sh), so no run can quietly use others.

## Why 32,768, measured rather than inherited

Two ceilings, and the one that binds is not the one you would guess.

**Memory.** The KV cache is what the context window costs, and on a hybrid model only
the full-attention layers pay: 16 layers × 2 × 4 KV heads × 256 dim × 2 bytes =
**64 KiB per token**. The other 48 layers are linear and hold constant state. The
server's own guard agrees — refusing a ~144k-token prompt it priced at
`KV+SDPA 10.64 GB` against a `metal_cap` of `35.57 GB`, where the arithmetic above
predicts 9.44 GB of KV plus workspace.

**Time, which binds first.** A staged prefill probe against the live server:

| prompt tokens | seconds | |
|--:|--:|---|
| 9,117 | 17.5 | |
| 36,417 | 17.4 | |
| ~72,000 | 341.4 | 20× the time for 2× the tokens |
| ~144,000 | — | refused by the memory guard |

Between 36k and 72k the prefill stops being roughly free and starts costing minutes.
Nothing here needs a window that large: every phase is one file with its declared
dependencies, and the largest is a few thousand tokens. **32,768 sits inside the flat
part of that curve with the memory limit far away.**

Two consequences worth stating plainly:

- **Raising the window to fix a truncation is the obvious move and the wrong one.** A
  phase that does not fit is a phase that should be split.
- **Give the client the same number as the server.** [`ft-run`](ft-run) refuses a
  request whose estimated prompt plus output would exceed the window, because the
  server's refusal is a hard error where the client's own stop is a legible one.

## The ceiling that actually decides runs

Input is almost never the problem. **Output is, and thinking is paid out of it** — and on this model that is not a
caveat, it is the dominant cost. It is also **specific to the planning phase**.
Measured across one self-test run on a task small enough to answer in two files:

| phase | output tokens | reasoning | wall |
|---|--:|--:|--:|
| plan | 16,249 / 16,384 | 63,171 chars | 25 min |
| `src/money.ts` | 2,361 | 7,517 chars | 4 min |
| `test/money.test.ts` | 7,068 | 26,492 chars | 11 min |

The implementation phases are comfortable. **Phase 0 succeeded by 135 tokens on a
trivial task**, which means it will not fit for a real one — and the failure mode is
not a bad plan, it is no plan: the reply is cut off mid-reasoning, and because the
thinking never closes, the server cannot separate it and returns 68 KB of
deliberation as the answer. `ft-go` now detects a ceiling hit in phase 0 and records
it as a failure rather than writing the reasoning to `PLAN.md`.

The open question, and the next thing to measure: `ft-run --no-thinking` on the plan
phase. Reasoning is 97% of that phase's output. Whether the plan survives without it
is an experiment, not an assumption.
Neither counter shows the reasoning, so a phase that needed 1,900 tokens of code can
spend 15,000 and write nothing. Every request records `output_ceiling_hit`, and when
it fires the run is not a wrong answer — it is no answer.

Two causes, identical from outside, wanting opposite fixes. The reasoning in the
transcript says which:

| The model is asking | Cause | Fix |
|---|---|---|
| *"Is X a class or an interface? Which of these is expected?"* — the question restarts | an unresolved reference: it is reasoning about something it cannot read | close the reference. Splitting does not help; both halves inherit it |
| *"Step 4 before step 5, because an expired token reused is still a leak."* — the question is decided | too many decisions in one phase | split |

This distinction is a graded dimension in [`judge-prompt.md`](judge-prompt.md), because
for a local model it is more decision-relevant than the score.

## The machine is part of the measurement

Two ceilings were described above as if they were properties of the model. One of them
is not. `final_ceiling` moved between **37.44 and 32.36 GiB inside a single session**,
falling as the rest of the machine took memory, and under swap pressure the server
does not slow down — it stops answering. A phase was recorded running for 46 minutes
and producing zero bytes, with the model's weights paged to disk.

`ft-go` therefore **refuses to start on a loaded host** (`--ignore-pressure` overrides
and records that it did), samples the host before every phase, and writes the ceiling's
range, peak swap and minimum free memory into `meta.yaml`. A run with
`host.pressure_samples > 0` is not comparable to one without.

Read [`host-limits.md`](host-limits.md) before the first campaign. The short version:
close Docker, close the editor, run nothing beside a run.

## Memory hygiene between requests

oMLX keeps KV cache between requests and returns it slowly at best; the guard's own
message shows `current 24.93 GB` against 22.27 GiB of weights. Left alone it
eventually refuses a prefill with a message that reads like a context problem and is
not one.

[`ft-flush`](ft-flush) releases it. [`ft-go`](ft-go) calls it on a threshold
(`FT_FLUSH_ABOVE_GIB`, default 26) rather than before every request: the pilot's runs
were one large request each, where a blind flush cost one percent; a run here is many
small ones, where it would cost a model load every time. Same protection, a fraction
of the reload.

**Never unload while a request is in flight.** The client is left waiting on a request
nobody will answer: the socket stays open, the process idles, nothing times out. It
cost the pilot thirty-nine minutes. `ft-go` holds a lock file and `ft-flush` refuses
while it exists.

## Per-run capture

Written by `ft-go` into `problems/NN-slug/runs/<tag>/<variant>/`:

```
PLAN.md          the model's own specification (phase 0) — judged before any code
workspace/       the code exactly as the model left it
steps/           every request: its reasoning, its reply, its counters
transcript.md    all of the above concatenated, nothing elided
GATE.md          typecheck output for every attempt, including the repairs
meta.yaml        below
```

`meta.yaml` records, per run: model and quantization, runner and spec source, date,
**wall time split into generation / model loads / gate+io**, request count, prompt and
completion tokens, **output tokens per second** (per request and overall), **revisions
the model made to its own work** and the ceiling on them, every phase that hit the
output ceiling, files declared versus files that came back empty, the gate verdict,
and an explicit **failures** list naming each failure in the terms that decide what to
do about it.

`<tag>` is the model slug, plus `--aider` and `--ladder` when those axes are not at
their defaults, so the four combinations never overwrite each other.

**The exit code is not the signal.** A runner can exit 0 having created the files and
never filled them — it happened three times in one epic of the pilot. `ft-go`
fingerprints what the plan declared and reports empties separately from errors.

## Never edit a workspace after the run

`ft-go` refuses to re-enter an existing run directory. Fixes belong in notes, not in
the artifact being judged.

## Two axes, held separate

```
ft-go <problem> <variant> [--runner api|aider] [--spec model|ladder]
```

**runner** is how the request reaches the model — see [`conditions.md`](conditions.md).
**spec** is where the specification comes from: the model's own phase-0 plan
(`model`), or the reference's level-2 spec (`ladder`).

Run `ladder` only on a problem that failed under `model`. It separates *cannot design
this* from *cannot implement this*, and that is the finding that decides what you can
hand the model.

## Blind judging

Stage runs into an anonymized tree (`run-01/`, `run-02/`, …) with `meta.yaml` removed
and the order shuffled. Judge, write verdicts, then map back to model ids.
