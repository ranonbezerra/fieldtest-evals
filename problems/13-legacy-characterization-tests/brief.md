# 13 — Characterization tests for untested legacy code

## The real situation

A system built solo and running in production since 2019 has modules nobody has
touched in years — they work, they matter, and they have zero tests. Before any
feature work or refactor can happen safely, the current behavior needs to be
pinned: **characterization tests** that describe what the code actually does
today, not what it should do. That inversion is what makes this a distinct
skill: when a test reveals a bug, the test still asserts the buggy output
(named and documented as such), because "fixing" behavior that years of callers
and stored data depend on is a decision for later, made deliberately —
not a side effect of writing tests.

Test writing is one of the persistently understudied task categories for coding
agents, and legacy code is its hardest setting: line coverage is easy to
manufacture and means almost nothing when tests cover lines rather than
behavior. The gate here is therefore behavioral: branches, boundaries, and
quirks pinned with meaningful assertions; production code untouched; every
discovered oddity reported separately with evidence and a proposed (not
applied) fix.

Variant C is deliberately underspecified: the request never says "write tests"
— reading that the safe next step *is* characterization is part of the task.

## Stack

TypeScript (modules are framework-light on purpose — pure-ish logic with a
thin persistence seam), Vitest/Jest.
