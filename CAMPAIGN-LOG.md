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
