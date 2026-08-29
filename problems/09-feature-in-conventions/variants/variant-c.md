# Variant C — "Add the sharing feature" (deliberately underspecified)

You are joining a group-travel planning product. The API scaffold exists with
two reference modules (`users`, `trips`) demonstrating all conventions (same
contract as variant A: layered modules, repositories own Drizzle, `ApiResult`
envelope, `AppError` codes, migrations, per-module spec tests, auth guard +
current-user decorator).

## Feature request (verbatim from the product owner)

> People keep asking to share their trip with family who don't want to create
> an account. Add the sharing feature. Read-only is fine for now. It should
> feel safe — we don't want random people finding trips.

That is the entire specification. Implement it.

## What is expected of you (process, not spec)

The request leaves real decisions open: link vs email sharing, token format and
lifetime, revocation, what "read-only" includes (members? costs?), rate/abuse
concerns, whether shares survive trip edits. Decide, and record every
non-obvious decision with its rationale in `ASSUMPTIONS.md` at the repo root.
Unstated assumptions baked silently into code count against you; reasonable,
recorded decisions count for you.

Deliver: the feature inside the conventions, migrations, tests,
`ASSUMPTIONS.md`; nothing outside your new module + `drizzle/` except module
registration.
