# Campaign log

Written by `harness/ft-campaign` as each run lands. One row per run.

| finished (UTC) | problem | variant | outcome | wall | out tokens | tok/s | revisions | files | comparable |
|---|---|:-:|---|--:|--:|--:|:-:|:-:|:-:|
| 2026-09-01 06:03 | 01-payout-outbox | a | **2 failure(s)**: reply produced no file content | 250.4 min | 146619 | 9.8 | 0 | 9/10 | yes |
| 2026-09-01 12:03 | 02-reconciliation-resend | a | **no meta** (exit 124) | – | – | – | – | – | – |
| 2026-09-01 18:04 | 03-read-model-projection | a | **no meta** (exit 124) | – | – | – | – | – | – |
| 2026-09-02 04:27 | 01-payout-outbox | a | **1 failure(s)**: typecheck still failing after 2 repairs | 190.2 min | 110036 | 9.7 | 9 | 14/14 | yes |
| 2026-09-02 06:09 | 02-reconciliation-resend | a | ok | 101.7 min | 58593 | 9.7 | 5 | 7/7 | yes |
| 2026-09-02 13:53 | 03-read-model-projection | a | **3 failure(s)**: test file overflowed at reasoning_effort=low, the lowest set | 464.2 min | 269975 | 9.7 | 30 | 19/19 | no |
| 2026-09-03 03:12 | 04-grounded-llm-product | a | **1 failure(s)**: test file overflowed at reasoning_effort=low, the lowest set | 144.5 min | 82510 | 9.6 | 4 | 10/10 | yes |
| 2026-09-03 06:07 | 05-onchain-anchoring | a | **2 failure(s)**: typecheck still failing after 2 repairs | 174.8 min | 100054 | 9.6 | 13 | 10/10 | no |
| 2026-09-03 08:40 | 06-multi-tenant-isolation | a | **2 failure(s)**: typecheck still failing after 2 repairs | 153.4 min | 86346 | 9.5 | 10 | 20/20 | no |
| 2026-09-04 04:50 | 06-multi-tenant-isolation | a | **2 failure(s)**: typecheck still failing after 2 repairs | 289.4 min | 163945 | 9.5 | 26 | 22/22 | no |
| 2026-09-04 11:13 | 07-ingredient-classification | a | **2 failure(s)**: typecheck still failing after 2 repairs | 383.0 min | 218160 | 9.6 | 40 | 27/27 | no |
| 2026-09-05 03:26 | 08-infra-debug | a | **2 failure(s)**: typecheck still failing after 2 repairs | 26.3 min | 15955 | 10.4 | 0 | 5/5 | no |
| 2026-09-05 06:13 | 09-feature-in-conventions | a | **1 failure(s)**: typecheck still failing after 2 repairs | 166.6 min | 100074 | 10.1 | 13 | 12/12 | yes |
| 2026-09-05 07:54 | 10-adapt-existing-screen | a | **2 failure(s)**: typecheck still failing after 2 repairs | 101.4 min | 62359 | 10.3 | 3 | 7/7 | no |
| 2026-09-05 08:58 | 11-behavior-preserving-refactor | a | **2 failure(s)**: typecheck still failing after 2 repairs | 63.8 min | 38725 | 10.2 | 8 | 6/6 | no |
| 2026-09-06 08:07 | 13-legacy-characterization-tests | a | **1 failure(s)**: test file overflowed at reasoning_effort=low, the lowest set | 61.9 min | 38745 | 10.5 | 0 | 2/2 | yes |
| 2026-09-06 09:19 | 14-code-review-planted-bugs | a | **1 failure(s)**: typecheck still failing after 2 repairs | 72.3 min | 46030 | 10.7 | 4 | 1/1 | yes |
| 2026-09-06 10:33 | 15-wiring-boot-failure | a | **2 failure(s)**: typecheck still failing after 2 repairs | 73.6 min | 43608 | 10.0 | 10 | 10/10 | no |
| 2026-09-06 10:56 | 16-migration-that-lied | a | **1 failure(s)**: typecheck still failing after 2 repairs | 16.5 min | 9906 | 10.3 | 0 | 4/4 | yes |
| 2026-09-06 12:45 | 17-token-rotation-reuse | a | **2 failure(s)**: test file overflowed at reasoning_effort=low, the lowest set | 109.0 min | 66782 | 10.3 | 1 | 8/8 | no |
| 2026-09-06 15:38 | 18-timing-equal-enumeration | a | **1 failure(s)**: typecheck still failing after 2 repairs | 172.6 min | 104232 | 10.1 | 9 | 11/11 | yes |
| 2026-09-07 00:30 | 01-payout-outbox | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 01:13 | 02-reconciliation-resend | a | **no meta** (exit 1) | – | – | – | – | – | – |
| 2026-09-07 02:40 | 03-read-model-projection | a | **no meta** (exit 1) | – | – | – | – | – | – |
| 2026-09-07 02:54 | 04-grounded-llm-product | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 03:22 | 05-onchain-anchoring | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 03:52 | 06-multi-tenant-isolation | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 04:08 | 07-ingredient-classification | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 04:19 | 08-infra-debug | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 04:46 | 09-feature-in-conventions | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 05:19 | 10-adapt-existing-screen | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 05:28 | 11-behavior-preserving-refactor | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 05:57 | 12-orm-migration | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 06:06 | 13-legacy-characterization-tests | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 06:54 | 14-code-review-planted-bugs | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 07:12 | 15-wiring-boot-failure | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 07:15 | 16-migration-that-lied | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 07:48 | 17-token-rotation-reuse | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 08:00 | 18-timing-equal-enumeration | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 22:49 | 01-payout-outbox | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 22:52 | 02-reconciliation-resend | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 23:02 | 03-read-model-projection | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 23:07 | 04-grounded-llm-product | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 23:14 | 05-onchain-anchoring | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 23:30 | 06-multi-tenant-isolation | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 23:35 | 07-ingredient-classification | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 23:42 | 09-feature-in-conventions | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 23:47 | 10-adapt-existing-screen | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 23:48 | 11-behavior-preserving-refactor | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 23:54 | 12-orm-migration | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 23:55 | 13-legacy-characterization-tests | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 23:59 | 14-code-review-planted-bugs | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 23:59 | 15-wiring-boot-failure | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-07 23:59 | 16-migration-that-lied | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-08 00:06 | 17-token-rotation-reuse | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-08 00:09 | 18-timing-equal-enumeration | a | **no meta** (exit 0) | – | – | – | – | – | – |

---

## Hosted campaigns

Two models, single-request shape, uncapped output — the machine constraints belong to
the local condition and were not carried over.

| | qwen/qwen3.8-27b | openai/gpt-oss-120b |
|---|---|---|
| runs | 18 | 18 |
| wall clock | 5.3 h | **1.5 h** |
| cost | $3.46 | **$0.1029** |
| PASS / NOTES / FAIL | 1 / 4 / 13 | 1 / 3 / 14 |

Against the local phased campaign: 43.2 h, 391 requests, 1 / 3 / 14.

**Only problem 08 is non-FAIL in all three conditions. Nine fail in all three. Eight
disagree**, and the disagreements separate cleanly: gpt-oss-120b wins where a codebase
exists to read (10, 11, 13) and loses where one must be built (04, 05, 18).

### What was corrected mid-campaign

Seven harness defects, all in FINDINGS §4.12–4.18, all found by reading runs rather
than by the harness reporting them:

1. the single shape never handed the model its seeded fixture — problems 09–16 of the
   Qwen hosted campaign ran blind, and eight verdicts carry a note saying so
2. `pnpm-lock.yaml` in the seeded reads pushed problem 09 past the model's context
   limit and cost it a request
3. `ft-run` wrote unfenced replies and tool-call transcripts over source files —
   three files destroyed, all restored
4. the fence parser truncated markdown deliverables — two recovered
5. the gate rewrote fifteen scaffold files it was scoped to leave alone
6. `_shims.d.ts` was deleted when nothing replaced it — 48 phantom errors on local 12
7. `ft-results` read the whole hosted campaign as "not yet run"

The pattern is the same one the repository is about: **every defect made a run look
worse than it was, and none of them announced itself.**

## Laguna S 2.1

`poolside/laguna-s-2.1` — 118B MoE, 8B active, open weights, 21 July 2026. Chosen
because it leads its weight class on agentic benchmarks (78.5% SWE-bench Multilingual,
70.2% Terminal-Bench 2.1) and fits a 128 GB machine at 6-bit with room for KV cache.

Running.
| 2026-09-08 22:56 | 01-payout-outbox | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-08 23:17 | 02-reconciliation-resend | a | **no meta** (exit 0) | – | – | – | – | – | – |
| 2026-09-10 02:53 | 01-payout-outbox | a | **no meta** (exit 0) | – | – | – | – | – | – |
