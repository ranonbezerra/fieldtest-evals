# cosmetics-scanner

Classifies cosmetics from their INCI ingredient lists. Rules come from a regulator's
restricted list and a curated watch list, each entry with a source citation and a
severity (banned / restricted / watch), grouped under immutable methodology
versions. The output is per-ingredient findings with source citations — never a
binary safe/toxic verdict.

Stack: TypeScript (strict, ESM), NestJS, Prisma, PostgreSQL, Vitest, pnpm.

## Setup

    cp .env.example .env             # set DATABASE_URL
    pnpm install
    pnpm prisma:generate
    pnpm prisma:migrate              # applies prisma/migrations
    pnpm start:dev                   # or: pnpm build && pnpm start
    pnpm test                        # needs the same DATABASE_URL

Configuration comes from environment variables only: `DATABASE_URL`, `PORT`.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /products | Create a product with an ordered INCI list |
| POST | /profiles | Create a family profile (contexts: `child_under_3`, `pregnancy`) |
| GET | /products/:productId/classification?profileId= | classify: active methodology + optional profile |
| GET | /products/:productId/classification-results?methodologyVersionId=v1 | stored result for an explicit version |
| POST | /methodology-versions | Ingest a methodology version (rules with citations) |
| POST | /methodology-versions/:versionId/publish | Publish (makes it immutable) + idempotent re-score of all products |
| POST | /methodology-versions/:versionId/rescore | Re-run the (idempotent) re-score |
| GET | /methodology-versions | List versions |

Errors use one envelope: `{ "error": { "code", "message", "details" } }` with
snake_case codes: `invalid_input`, `resource_not_found`, `no_published_methodology`,
`methodology_immutable`, `conflict`, `internal_error`.

## How classification works

1. Each listed ingredient is normalized (case, accents, whitespace) and resolved
   against canonical ingredients and their synonym/typo variants (fixture data in
   `src/classification/fixtures.ts`). What does not resolve is **unknown**: listed
   in the output, counted against confidence, never dropped, never treated as clean.
2. The base rules of the active (latest published) methodology version set each
   ingredient's flag, severity, and source citation.
3. The profile's contextual modifiers tighten (never loosen) severities by the
   precedence below.

Results are stored keyed by **(product, methodologyVersion)**. Publishing a new
version re-scores all products into new rows; stored rows are never rewritten, so
previous versions stay retrievable exactly as they were. Re-scoring is idempotent:
upsert on the unique (product, version) key with a deterministic payload.

Confidence is the fraction of the list that resolved to a known ingredient, rounded
to 4 decimals (an empty list is 0). Unknown ingredients lower it.

Output ordering is deterministic: findings are sorted by canonical name, then by
normalized raw text — the stored ingredient order never leaks into the output.

## Modifier precedence (written down)

Given the base severity of an ingredient in the active methodology version and the
context modifiers whose context is present in the profile:

1. A modifier may only tighten, never loosen: the effective severity is the maximum
   of the base severity and the modifier severities (banned > restricted > watch).
2. Ties are broken by fixed context precedence: `child_under_3`, then `pregnancy`
   (`MODIFIER_PRECEDENCE` in `src/classification/classification.service.ts`). If the
   base rule and a modifier tie, the base citation wins.
3. Contexts outside the precedence list sort after the listed ones, in rule-table
   order.
4. Modifiers never apply to unknown (unresolved) ingredients.

The winner is chosen by (severity rank, precedence index) — never by iteration
order — so two modifiers on one ingredient resolve the same way every time.

## Assumptions

- The task references "provided" synonym/typo fixtures; none were attached to this
  repo, so the fixture data in `src/classification/fixtures.ts` is a stand-in shaped
  to cover the required behaviours.
- Family profiles carry the contexts `child_under_3` and `pregnancy`; a profile may
  combine several, and modifiers from all of them are applied together.
- Tests run against a real PostgreSQL database at `DATABASE_URL` with the schema
  applied (`pnpm prisma migrate deploy`).
