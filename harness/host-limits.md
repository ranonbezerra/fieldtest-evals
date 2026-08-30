# The machine is part of the measurement

A 48 GiB Mac running a 22.27 GiB model has less room than the arithmetic suggests,
and the ways it runs out are not the ways you would guess. Everything here was
measured on this machine, during the build of this harness. It is documented because
a campaign run on a loaded machine produces numbers that are about the machine.

## What was measured

### The server's ceiling is not a constant

`final_ceiling` — the number oMLX's prefill guard checks against — was observed at
**37.44, 36.48, 32.85 and 32.36 GiB within one session**, falling as the rest of the
machine took memory. The same request can therefore be served, be slow, or be refused,
with nothing about the request having changed.

The refusal, when it comes, reads like a context problem and is not one:

```
oMLX prefill memory guard rejected this prompt: Prefill would require ~35.57 GB peak
(current 24.93 GB + KV+SDPA 10.64 GB) but metal_cap ceiling is 35.57 GB.
```

`current` is the model plus whatever it has accumulated. `KV+SDPA` is what this
request needs. Neither figure is about the prompt being too long in any sense the
model cares about.

### Under swap pressure the model does not slow down gracefully — it dies

The sequence, recorded while the harness self-test was running and several builds
were running beside it:

| | free | wired | compressed | swap used | server |
|---|--:|--:|--:|--:|---|
| start | 2.1 GiB | 29.9 GiB | 4.6 GiB | 7.8 / 9.0 GiB | serving |
| 40 min in | 0.5 GiB | 29.9 GiB | 3.4 GiB | 7.6 / 9.0 GiB | serving, very slowly |
| 46 min in | 0.0 GiB | **6.5 GiB** | **32.9 GiB** | **20.4 / 21.0 GiB** | serving |
| moments later | — | — | — | — | **connection refused** |

Read the third row: `wired` collapsed from 29.9 to 6.5 GiB. Those were the model's
pages, and macOS had grown the swap file from 9 to 21 GiB to take them. Shortly after,
the server process was gone.

Once the model was out of memory, the machine recovered instantly — 28.5 GiB free,
87% free, swap back to 8 GiB. Nothing was leaking. There simply was not room.

### What it cost

**A phase that ran for 46 minutes and produced zero bytes.** Not a timeout, not an
error, not an output-ceiling hit — the three failure modes the harness knows how to
classify. Just a request that never came back, because the weights answering it were
on disk.

Generation on this machine, unloaded, measures **~5 tokens/second**. There is no
figure for generation under swap, because it did not finish.

### "Loaded" is the server's word, and the host disagrees

The state that precedes the server dying reads as healthy from the server alone:

```
server   ceiling 37.44 GiB   resident 22.27 GiB   headroom 15.17 GiB   loaded
host     wired 3.6 GiB       compressed 24.2 GiB  available 12.4 GiB
```

The server says it holds 22.27 GiB. The host says only 3.6 GiB is wired and 24.2 GiB
is sitting in the compressor. **The weights are out of memory.** The next request pays
to bring them all back before it generates a token, and the server reports nothing
unusual while that happens.

`ft-vitals` flags it: `wired` far below what the server calls resident. The fix is to
unload — the model reloads clean on the next request, at the cost of one model load.
Measured here, immediately after:

| | before | after `ft-flush` |
|---|--:|--:|
| compressed | 24.19 GiB | **0.80 GiB** |
| available | 12.4 GiB | **34.6 GiB** |
| margin over what the model needs | tight | **+9.3 GiB** |

Twenty-three gigabytes of compressed memory returned for one fourteen-second reload.
**Flush between runs, and flush after anything that made the host page.**

## What follows for a campaign

**Run it on a quiet machine.** Not as hygiene — as a precondition for the numbers
meaning anything. `ft-go` refuses to start when the host is already under pressure and
records the refusal thresholds in `meta.yaml` either way.

**Close the things that are quietly large.** On this machine, in order:

| | |
|---|--:|
| Docker's VM, idle | 5–6 GiB |
| VS Code and its helpers | 1.5–2 GiB |
| A JVM someone left running | 0.4 GiB |
| Every `pnpm install` / `tsc` / `vitest` you run beside the model | 0.3–1 GiB each, in bursts |

Docker alone is the difference between headroom and swap. Shut it down unless a
problem needs Postgres, and start it only for that problem.

**Do not run anything beside a run.** This is the rule the pilot already wrote down —
*a chat agent cannot supervise a run; both share one model server with one memory
ceiling* — and it was broken during this build, which is how the sequence above got
measured. Fire and forget, then check from outside.

**`ft-vitals` before, and `ft-go` samples during.** Every run records the ceiling's
minimum and maximum, peak swap, minimum free percentage, and how many samples were
taken under pressure. A run with `host.pressure_samples > 0` is not comparable to one
without, and its throughput figure should not be quoted.

## The failure mode this adds

The judge classifies every phase that produced nothing. `host_pressure` belongs
alongside the others, and it is the one the transcript cannot show, because there is
nothing in the reasoning to read — the model was never given a chance to reason. It is
identified from `meta.yaml`, not from the run:

- pressure samples during the phase, and
- a wall time far out of line with the tokens produced, or no tokens at all.

Classifying one of these as `wrong_answer` or `decision_overload` puts a defect on the
model that belongs to the machine, which is the specific mistake this file exists to
prevent.

## Sizing, restated

`FT_CONTEXT_WINDOW` is 32,768 for reasons in [`README.md`](README.md), and none of
them is memory. On a quiet machine the memory limit is roughly four times that. On a
loaded one, memory is the only limit that matters — and it does not present as a
context error, it presents as a dead server.
