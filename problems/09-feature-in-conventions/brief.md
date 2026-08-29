# 09 — Greenfield feature inside someone else's conventions

## The real situation

A side product reached the point every planned project reaches: spec written,
ADRs accepted, epics broken down — and zero code. Implementing the first epics
means the most common professional task there is: building a feature *inside* an
established structure, where "works" is only half the job. The other half is
respecting the architecture someone already decided: module layout, layering
(handlers never touch the database), a shared result/error envelope, naming, how
migrations are written, how tests are organized.

Research on agents calls the failure mode this problem hunts **constraint
decay**: models that solve the functional task fine in a sandbox degrade sharply
when they must simultaneously satisfy a repo's real structural constraints —
they put logic in the wrong layer, bypass the established patterns, or invent a
parallel style. In a team, that PR gets rejected even if it works.

Each variant therefore ships a conventions contract alongside the feature spec.
Correctness and convention adherence are judged **separately**: a working
feature that ignores the architecture fails this problem's gate, exactly like it
would fail review.

Variant C is deliberately underspecified — part of what's measured there is
whether the model surfaces assumptions and asks/records them instead of
confidently guessing.

## Stack

TypeScript, NestJS, Drizzle ORM, PostgreSQL (React for the thin UI slice where
a variant asks for one).
