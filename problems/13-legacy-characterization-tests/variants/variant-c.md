# Variant C — "We need to be able to touch this safely" (underspecified)

The fixture is the same untested `feeCalculator.ts` as variant A. The request
you get is only this, from the maintainer:

> Next cycle we have to add a new complexity band and a new rate table to the
> fee calculator. Honestly I'm afraid of that file — it's been running since
> 2019, billing depends on it, and the historical numbers are audited. Do
> whatever you think makes that upcoming change safe. Don't change what it
> returns for anything that exists today.

Nobody says "write tests". Nobody forbids anything except changing outputs.

## What is expected of you

1. Read the situation: decide what "make it safe" means here and record your
   reasoning and plan briefly in `APPROACH.md` before executing. (Refactoring
   first, adding the feature early, or "improving" outputs are all traps given
   the constraints; recognizing why is part of the evaluation.)
2. Execute: production behavior untouched and pinned, discoveries documented
   with proposed-not-applied fixes (FINDINGS.md), deterministic suite, honest
   open questions for anything you couldn't safely determine.

You are judged on whether your chosen deliverable is the right one for the
constraints as much as on its quality.
