# Cheatsheets

One file, ~800 tokens, loaded as the system message of **every** request in a run.
It is the only thing every phase assumes.

A problem may override the default with its own `problems/NN-slug/CHEATSHEET.md`.

## The rule that governs what may go in one

**Nothing that appears in a rubric's must-haves may appear in a cheatsheet.**

An error here is inherited by every request at once, and a *leak* here is worse than
an error: it hands over the very thing the problem exists to measure. "Money is
integer minor units" is M8 of problem 01 — putting it here would make every model
pass that gate for free, and the run would look like a capability.

Before adding a line, grep the rubrics for it. Conventions the model cannot guess and
that no rubric grades — file layout, the error envelope's shape, which layer may touch
the database — are what belongs here. Anything a rubric scores does not.

Check every factual claim, too. A wrong convention here is a wrong convention in
every run made against it, and it will read as the model's mistake.

## Judgments already made, so they are not remade every time

`ft-lint-cheatsheet` currently surfaces the wiring paragraph against problem 15's
must-haves. **Kept deliberately.** Problem 15's variant A states the same rule in its
own words — *"every provider used across a module boundary is exported and imported"* —
so the model receives it either way, and removing it from here would only make every
other problem's runs worse at a convention they are not being graded on.

What was removed, and why, when the linter first ran:

| Removed | It was the answer to |
|---|---|
| *"An unresolved dependency type-checks perfectly and fails at boot, so nothing downstream catches it"* | problem 15's entire mechanism |
| *"A migration that is not recorded is not applied, whatever the tool prints"* | problem 16's first defect, verbatim |

Both read as good advice, which is exactly why they went unnoticed until the linter
compared them against the gates.
