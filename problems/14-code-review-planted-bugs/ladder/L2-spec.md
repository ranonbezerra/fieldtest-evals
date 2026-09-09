# Issue #488 — Review `transfers.service.ts` before it goes to production

**Repo:** `payments` · **Labels:** `review` `blocker`
**Requested by:** the transfers team · **Assigned to:** platform

---

## Context

The transfers service is scheduled to ship next sprint. It compiles, it passes its
suite, and it reads well. The team is not confident and cannot say why, which is the
kind of unease worth taking seriously — the suite covers the happy path, and money
services fail on the paths a happy-path suite does not have.

Three files are in scope:

    transfers.service.ts
    accounts.repository.ts
    serializer.ts

## What we need

`REVIEW.md`. **Findings only — do not change the code.** The team fixes what you find;
a diff from a reviewer skips the conversation about whether the fix is right.

### For each finding

- **`file:line`** — real ones. A reviewer who cannot point at the line has not read it.
- **severity**: blocker, major or minor
- **the mechanism**: why it breaks, and under exactly what conditions. "Under
  concurrent load" is not a condition; "two transfers between the same pair of accounts
  in opposite directions, arriving inside the same transaction window" is.
- **a concrete minimal fix** — a code sketch or a precise description. Not "add
  proper error handling".

### Rank by severity, and end with a verdict

**Block** or **approve with comments**, with the reasoning. A review that lists eight
findings and no decision leaves the team exactly where they started.

### Precision counts as much as recall

Flag what you can defend by tracing the code. A review with fifteen findings, six of
which are real, costs the team more time than one with six. If something smells wrong
but you cannot follow it to a failure, either trace it or leave it out.

Style preferences, if you have any, go in a separate final section clearly marked as
non-blocking.

## What this service does

Transfers move money between two internal accounts. The path takes row locks, writes a
ledger entry pair, records an audit log line, notifies the recipient, and has a retry
sweep for transfers that failed partway. There is a raw-connection branch for a
reporting query and a statement builder that assembles a month of activity.

That is the shape. What it does under concurrency, on the error paths, and when the
provider is slow is what the review is for.

## Acceptance

- `REVIEW.md`, ranked, with `file:line`, mechanism, conditions and a fix per finding
- A block-or-approve verdict with reasoning
- No source file modified
- Non-blocking style notes separated, if present

## Notes

TypeScript, NestJS, Prisma. The suite passes today — that is context, not evidence.
