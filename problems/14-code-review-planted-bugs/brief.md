# 14 — Code review with planted bugs

## The real situation

Reading code is half the job, and it's the half agentic workflows lean on
hardest: if models write more of the code, humans and models both spend more
time reviewing it. Preparing for payments-infrastructure work meant drilling
exactly this — reviewing backend services seeded with the bug classes that
actually take systems down: a floating promise whose rejection vanishes, a
deadlock from inconsistent lock ordering, connection-pool exhaustion from a
missing release on the error path, `JSON.stringify` throwing on BigInt in the
one branch that serializes money, N+1 queries hidden behind an innocent map,
read-modify-write races, transactions that hold an external HTTP call open. In
that drill, 8 of 9 planted bugs were found — the missed one is why this
problem exists.

Review is judged on **precision as much as recall**. A review that flags 40
"issues" to hit 9 real bugs would be rejected by any team: noise costs reviewer
trust. Style nits offered in place of the deadlock is the canonical bad review.
So the deliverable is a structured report — per finding: location, mechanism
(why it breaks, under what conditions), severity, and a concrete minimal fix —
and the score weighs false positives against hits.

Variant C narrows the artifact to a PR diff with a vague request, closest to
real review: part of the task is deciding what matters enough to block a merge.

## Stack

TypeScript / NestJS / Prisma fixtures (buggy-but-plausible services). Review
only: the model must NOT rewrite the code, only report.
