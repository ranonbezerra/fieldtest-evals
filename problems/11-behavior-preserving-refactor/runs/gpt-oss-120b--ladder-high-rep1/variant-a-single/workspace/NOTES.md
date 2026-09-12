# NOTES

## Copies of the payment status mapping (pre‑refactor)

| Module                | Behaviour                                                                                               |
|-----------------------|----------------------------------------------------------------------------------------------------------|
| **orders**            | Maps provider status to internal status for the order detail screen. Throws an error for unknown codes. |
| **payouts**           | Same base mapping plus two payout‑specific codes (`PAYOUT_SETTLED`, `PAYOUT_REVERSED`). Returns `'unknown'` for any provider code it does not recognise. |
| **reporting script**  | Same base mapping, but returns the upper‑cased string `'FAILED'` for `DECLINED` and `EXPIRED` (legacy report casing). Returns `null` for unknown codes, causing the row to be omitted from the CSV. |

## Legacy report casing quirk

The finance CSV historically expects the failed status to be upper‑cased (`'FAILED'`).  
The new `PaymentStatusMapper` exposes this behaviour via the option:

```ts
mapProviderStatus(code, { legacyReportCasing: true })
