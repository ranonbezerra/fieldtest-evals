# Variant C — Open track: "this module is a problem" (deliberately vague)

The fixture is a working scheduling module (`src/modules/scheduling/`) in a
services-marketplace API. It passes its (partial) tests and works in
production. The only guidance you get is what the team feels:

> Every change to scheduling takes forever and breaks something. Nobody wants
> to touch scheduling.service.ts anymore. Can you clean it up? It must keep
> working exactly as it does — clients depend on its current behavior,
> including the weird parts.

The fixture module genuinely contains (unlabeled): duplicated availability
logic in two methods, persistence mixed into domain rules, a hidden temporal
coupling between two public methods, dead branches, and at least one quirk
callers depend on. Nothing is marked. Finding what deserves refactoring IS the
task.

## What is expected of you

1. A short `REFACTOR_PLAN.md` first: what you found, what you will change, what
   you will deliberately NOT change and why.
2. Characterization tests pinning current behavior of anything you intend to
   move — before moving it.
3. The refactor itself, behavior-preserving, scoped to the module.
4. `NOTES.md` for quirks/bugs found and preserved, with proposed follow-ups.

You are judged as much on what you chose (and declined) to refactor as on the
execution.
