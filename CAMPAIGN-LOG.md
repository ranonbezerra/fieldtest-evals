# Campaign log

Written by `harness/ft-campaign` as each run lands. One row per run.

| finished (UTC) | problem | variant | outcome | wall | out tokens | tok/s | revisions | files | comparable |
|---|---|:-:|---|--:|--:|--:|:-:|:-:|:-:|
| 2026-08-30 07:11 | 01-payout-outbox | a | ok | 269.8 min | 90812 | 6.8 | 0 | 11/11 | yes |
| 2026-08-30 12:17 | 01-payout-outbox | a | **1 failure(s)**: memory pressure during 1 of 12 samples: node is using 172% C | 303.9 min | 109075 | 6.8 | 0 | 10/10 | no |
| 2026-08-30 12:19 | 02-reconciliation-resend | a | **no meta** (exit 1) | – | – | – | – | – | – |
