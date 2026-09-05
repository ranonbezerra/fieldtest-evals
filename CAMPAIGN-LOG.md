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
