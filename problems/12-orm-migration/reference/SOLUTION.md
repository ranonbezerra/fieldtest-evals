# Reference solution — annotated core (contains the planted traps — keep out of model context)

## Fixtures

Built. Both typecheck standalone (`_shims.d.ts`, no `node_modules`). Keep this file
out of the model's context — it names the traps.

**`fixtures/billing-prisma/` — variants A/C.** Prisma schema, seeds, service,
repository, and a five-test suite that covers a happy path per endpoint and nothing
else. Where each trap lives:

| Trap | Where | Why no test catches it |
|---|---|---|
| BigInt serialized as **strings** | `src/common/serializer.ts`, registered globally | The suite asserts `inv.number` and `lineItems.length`, never the type of a money field. The seed carries `9007199254740993n` — past `Number.MAX_SAFE_INTEGER`, so a port to `number` loses a cent silently |
| Line items in **insertion order** | `findLineItems` has no `orderBy`; the `position` column exists and is unused | The seed inserts positions 3, 1, 2 deliberately. The suite counts them; the frontend renders them positionally |
| `null` vs thrown for a missing account | `findAccount` returns `null`; `listForAccount` turns that into `[]`, while `getInvoice` throws | A Drizzle port that throws on a missing account turns a fresh tenant's empty dashboard into a 500. `mapPrismaError` maps `P2025`/`P2002`; the driver's errors have neither shape |

**`fixtures/llm-feature/` — variant B.** The local provider client, the summarize
service and its SSE controller, plus `new-provider-sdk.ts` — a fake of the cloud
SDK's documented surface, including the two lines from its migration guide that
decide the port. The suite has two tests: chunks in order, and the content-filter
rejection.

| Trap | Where | Why no test catches it |
|---|---|---|
| Terminal **`done` event carries the full text** | `summarize.controller.ts` | The suite tests the service, never the controller. The web client renders chunks for the typing effect and then replaces them with `done.text`, which is what it stores and copies. Drop the event and the UI blanks after a successful stream |
| Timeout retries **once**, then yields fallback text at **HTTP 200** | `summarize.service.ts`, the `attempt` loop | Untested. The new SDK's `timeout_error` is a different class, and a port that lets it propagate turns a rendered fallback into a 500 |
| **Multi-byte characters may split across events** | `new-provider-sdk.ts` says so; `local-provider.client.ts` documents the opposite guarantee | Nothing in the suite is non-ASCII. A per-event `TextDecoder().decode(...)` produces U+FFFD mid-word; the port needs `decode(bytes, { stream: true })` |

## The planted uncovered traps (answer key)

**Variants A/C (billing service):**
1. `GET /invoices/:id` serializes BigInt amounts as **strings** via a custom
   serializer registered globally — no test asserts the type. A naive Drizzle
   port returning `number`/`bigint` changes the JSON contract silently (M2/M3).
2. Invoice line items are returned in **insertion order** relying on Prisma's
   default (no ORDER BY). Drizzle without an explicit ORDER BY may differ. The
   frontend renders them positionally. Fix: explicit `ORDER BY position` +
   pinning test.
3. `findAccount` returns `null` for missing, but one call site distinguishes
   `null` from thrown; error-mapping differences (Prisma known error codes vs
   Drizzle/driver errors) must be mapped, or the 404 path becomes a 500.

**Variant B (LLM feature):**
1. The SSE stream emits a **final `done` event with the full text** after the
   chunks — the frontend uses it as the authoritative value; only chunk events
   are tested.
2. Provider timeout currently triggers ONE retry then fallback text with HTTP
   200 (not an error status) — untested; the new SDK throws a different
   timeout class.
3. Unicode: chunk re-assembly is done on the client; the old provider never
   split multi-byte graphemes across chunks, the new one can — the port must
   buffer safely.

## Crux: how a strong run finds unlabeled traps

Behavior diffing, not code reading alone: run the old service against seeds,
capture responses/streams byte-for-byte, run the migrated service, diff. The
transcript should show exactly this (graded 6). Then each diff → pinning test
→ fix → MIGRATION_NOTES.md entry.

## Common wrong answers

- Suite green, contract changed — the spurious solution this problem exists
  to catch (BigInt as number is the canonical one).
- Tests edited to match new output — M1 fail.
- Prisma left in package.json / schema.prisma orphaned — M4.
- Variant B: retry/fallback semantics silently changed because the new SDK's
  error names differ.
- Variant C: choosing by fashion with no ASSUMPTIONS.md rationale.
