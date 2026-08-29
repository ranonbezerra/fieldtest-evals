# Variant C — "Can you take a look at this PR?" (deliberately underspecified)

You receive a PR diff (fixture in `fixtures/pr-diff/`) titled **"Add balance
top-up via provider X"** touching a NestJS/Prisma wallet service: a new
endpoint, a provider client, a schema migration, and edits to two existing
services. The only request, from a teammate:

> Can you take a look at this PR when you get a chance? Want to merge today
> if possible.

That is the entire instruction. No checklist, no severity scale, no areas to
focus on.

## What is expected of you

Real review judgment: decide what matters enough to block a same-day merge.
The diff contains a small number of genuine problems of very different weight
(at least one that must block, at least one worth a comment but not a block)
mixed with perfectly fine code and a couple of things that merely *look*
suspicious but are correct in context — reading the surrounding fixture code
is required to tell the difference.

Produce `REVIEW.md` shaped like a real PR review:

1. A verdict up front: block or approve-with-comments, with one-paragraph
   rationale proportionate to what you found.
2. Findings with `file:line`, severity, mechanism, and minimal fix — only what
   you can defend; flagging the correct-in-context decoys costs you.
3. Non-blocking observations, if any, clearly separated.

Tone and proportion are part of the evaluation: this is a note to a teammate
shipping today, not an audit report.
