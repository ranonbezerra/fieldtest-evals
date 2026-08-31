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
| id | [`Qwen/Qwen3.8-27B`](https://huggingface.co/Qwen/Qwen3.8-27B), 14 August 2026 |
| architecture | 64 layers, hidden 5,120 · `16 × (3 × Gated DeltaNet → 1 × Gated Attention)` — linear attention in 48 layers, full in 16 |
| modality | natively multimodal; only the text path is exercised here |
| quantization | 6-bit MLX, group size 64, affine |
| weights resident | 22.27 GiB |
| server | oMLX, OpenAI-compatible |
| machine | MacBook Pro, Apple M4 Pro, 14 cores (10P/4E), 48 GB unified memory, macOS 26.6 |
| reasoning | **on by default** (`thinking_default: true`), and paid out of the output budget |
| generation | not yet measured at the correct parameters. The discarded campaign saw ~10.6 tok/s on a quiet host and 5.1 while swapping — the second figure was the machine, not the model |

## Fixed parameters

| Parameter | Value | Why this value |
|---|--:|---|
| temperature | 1.0 | **The model card's own recommendation for thinking mode**, which is this model's default mode. An earlier campaign ran at 0.6, carried over from Qwen3 guidance for a different model after misreading `model_type: qwen3_5` in the config as the model's name. Those runs were discarded rather than compared against these. The obvious choice — 0.2, for determinism — is wrong twice over: it is not what the card says, and near-greedy decoding sends a reasoning model into repetition paid out of the same budget as the answer. Determinism is bought with variants and repeat runs. |
| top_p | 0.95 | card's recommendation |
| top_k | 20 | card's recommendation |
| `reasoning_effort` | unset | The model's own dial (`xhigh`/`medium`/`low`). Left at the model's default so a run measures the model rather than a setting. The harness lowers it to `low` **only** as a recorded fallback after a phase overflows its budget, and on the writing pass of the two-pass test phase. |
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

Input is almost never the problem. **Output is, and thinking is paid out of it.** Neither counter shows the reasoning, so
a phase that needed 1,900 tokens of code can spend 15,000 and write nothing — that
pair is from the pilot's record, not from this campaign. Every
request records `output_ceiling_hit`, and when it fires the run is not a wrong answer
— it is no answer.

How much of the budget this model spends deliberating, and on which phases, was
measured under the wrong parameters and is being re-measured. `FINDINGS.md` Appendix A
holds the old figures for comparison; none should be quoted.


### Reasoning runs at the model's own default

`reasoning_effort` is left unset, so every phase carries the model's default. The
harness lowers it to `low` in exactly two places, both recorded per run: as a fallback
after a phase overflows its budget, and on the writing pass of the two-pass test phase.

An earlier version disabled reasoning outright for phase 0, from measurements taken at
the wrong temperature and before `reasoning_effort` was known to exist. Turning off a
model's defining behaviour by default is not measuring the model.


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

`meta.yaml` records, per run:

| group | fields |
|---|---|
| identity | `model`, `model_repo`, `quantization`, `architecture`, `modality`, `server`, `harness`, `runner`, `spec_source`, `problem`, `variant`, `date` |
| parameters | `temperature`, `top_p`, `top_k`, `max_tokens`, `context_window` |
| reasoning | `effort` (the model's default), `lowered_to_low_after_ceiling`, `test_write_pass_effort` |
| cost | `wall_seconds` / `wall_minutes`, `requests`, `tokens`, `throughput` split into generation / model loads / gate+io |
| outcome | `output_ceiling_hits`, `two_pass_test_files`, `files_declared`, `files_empty`, `revisions`, `gate` including `gate_scaffold_added`, and an explicit **`failures`** list naming each in the terms that decide what to do about it |
| host | `pressure_samples` of `samples`, the ceiling's range, peak swap, minimum free memory, and the full `trace` |

The identity block exists so a run can be read years later without this README. It is
also where a misconfiguration would be caught: an earlier version recorded the
architecture from the config's implementation-class name, and every run written under
it carried a model description that was wrong.

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

## Recording what a run taught you

A verdict says what the model did on one problem. A **finding** says what the campaign
learned, and those are different artifacts with different lifetimes.

After a run, anything that would change how the next run is set up goes in
[`../FINDINGS.md`](../FINDINGS.md), in the file's own shape: **what was measured, the
number, and what it changed.** A finding with no consequence is an anecdote; a
consequence with no number is a preference.

Three rules that keep it usable rather than merely long:

- **Correct in place.** When a later measurement contradicts an earlier entry, fix the
  entry and say it was corrected. Two of the entries there are corrections of this
  repository's own instruments. A findings file that only accumulates becomes a place
  to argue from instead of a place to check.
- **Mark what is one sample.** Entries carry their own status. One that is still in
  flight says so rather than reading as settled.
- **§5 is not optional.** What has *not* been established is the section that decays
  fastest and matters most — it is what stops a reader trusting the rest further than
  it goes.

The six entries that changed how this repository works are summarised in the top-level
[`README.md`](../README.md).

## Blind judging

Stage runs into an anonymized tree (`run-01/`, `run-02/`, …) with `meta.yaml` removed
and the order shuffled. Judge, write verdicts, then map back to model ids.
