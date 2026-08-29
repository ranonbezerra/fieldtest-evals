# Variant C — "The operators need the new approval flow" (underspecified)

The scaffold is the same operations back-office as variant A (login, sessions
list, session detail with edit + dirty flag).

## The request (verbatim from the PM, no mockup)

> Compliance now requires that closing a session goes through an approval:
> someone with the reviewer role has to look at it before it counts as closed.
> Can you adapt the screens for that? Operators should still feel it's quick,
> and reviewers need somewhere to see what's waiting for them.

That is the entire specification. The API team, moving in parallel, has stubbed
endpoints you may shape within reason (document the contract you assume in
`ASSUMPTIONS.md`).

## What is expected of you

Real decisions are open: does "close" become "request close"? What states does
the UI show (pending review? rejected-with-comment?)? Where does the reviewer
queue live — new route, tab, badge? What happens to the dirty-flag flow? Which
role sees which actions? Decide, record every non-obvious decision + assumed
API contract in `ASSUMPTIONS.md`, and implement the edit.

## Existing behaviors that must not regress

List filtering/pagination; detail editing + dirty-flag warning; logout clearing
state; deep-linking to detail.

Deliver the edit as a coherent diff + tests + `ASSUMPTIONS.md`.
