# Rubric — 05 On-chain anchoring

## Gate: must-haves (missing any = FAIL)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **Write-ahead before broadcast** | An anchor record (with the identifying material: nonce/signed-tx hash or deterministic id) is committed to the DB *before* the broadcast call. Persisting txHash only after the call returns = the original bug = fail. |
| M2 | **One anchor per document version** | Unique constraint on (documentId, version); a crash-and-retry cannot create a second on-chain anchor for the same version. |
| M3 | **Broadcast ≠ confirmed** | Distinct states (e.g., PREPARED → BROADCAST → CONFIRMED / FAILED); confirmation comes from receipt polling, never assumed from the broadcast response. |
| M4 | **Ambiguous broadcast handled** | On timeout/unknown, the recovery path queries the chain for the pre-persisted tx identity before ever re-broadcasting. |
| M5 | **Canonical hashing** | Document hash computed over a stable canonical serialization (defined and tested); hashing a re-rendered PDF or non-canonical JSON = fail. |
| M6 | **No key material in code** | Signer is injected/abstracted; no private keys, mnemonics, or RPC secrets anywhere. |

## Graded criteria (0–3 each)

1. **State machine** — transitions guarded; FAILED only on definitive rejection.
2. **Recovery routine** — startup/cron sweep that resolves BROADCAST-limbo records via chain lookup.
3. **Verification endpoint** — given a document, recompute hash and prove/deny anchoring with chain reference.
4. **Tests** — crash-between-broadcast-and-persist simulation (must not double-anchor), duplicate anchor attempt, confirmation flow, canonicalization stability.
5. **Code quality** — clean chain-client abstraction, sane schema.
6. **Process** — transcript shows the model identifying the broadcast/persist race on its own.

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
`gate` carries this problem's must-haves; `graded` carries its graded criteria above.
