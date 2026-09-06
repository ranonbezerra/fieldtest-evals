# plan

## reasoning

```
Let me analyze the task carefully. I need to write a PLAN.md for a code review task. The task is to produce a REVIEW.md that reviews specific files from a NestJS/Prisma payments service.

Let me think about what this plan needs to cover:

1. The task is to review `transfers.service.ts`, `accounts.repository.ts`, and `serializer.ts` from `fixtures/transfers/`.
2. The output is `REVIEW.md` with findings, severity rankings, and a verdict.
3. The plan is for whoever will actually do the review - they'll have this PLAN.md and the fixture files.

Key decisions to make:
- The output file is `REVIEW.md` at the repository root
- The reviewer will read the fixture files to trace code paths
- The plan needs to specify the structure of REVIEW.md
- No persistence, no types to export - this is a document production task

Let me think about what assumptions are needed:
- The reviewer has access to the fixture files in `fixtures/transfers/`
- The output is a single markdown file
- Findings are specific to the code as-is (not speculative refactors)
- The "areas worth tracing" in the variant are hints, not a complete list

Data model: none - this is a review document, no persistence.

Types and signatures: The structure of REVIEW.md needs to be defined - what fields each finding has, what the verdict section looks like.

Control flow: The process of reviewing - read files, trace paths, identify findings, rank them, write verdict.

Tests: This is a document, not code. But we could specify validation criteria.

Manifest: REVIEW.md reads the three fixture files.

Let me be precise about the structure of REVIEW.md since that's the "type" here.

Actually, let me re-read the task requirements:
1. For each finding: `file:line`, severity (blocker/major/minor), mechanism (why it breaks, under what conditions), concrete minimal fix
2. Rank by severity, end with verdict (block or approve with comments)
3. Precision over recall. Style preferences in separate final section marked non-blocking.

The "areas worth tracing" are:
- promise handling on the notification path
- lock acquisition order across account pairs
- client lifecycle in the raw-connection branch
- money serialization on the audit-log branch
- the query pattern inside the statement builder
- the balance update in the retry path
- what happens inside vs outside the transaction boundary

Now let me write the PLAN.md. I need to be terse and direct.
```

## reply

## 1. Assumptions

- The reviewer has read access to `fixtures/transfers/transfers.service.ts`, `fixtures/transfers/accounts.repository.ts`, and `fixtures/transfers/serializer.ts` before writing findings.
- Output is a single file `REVIEW.md` at the repository root; no other files are produced.
- Findings reference 1-based line numbers as they appear in the fixture files.
- "Minimal fix" means a short code sketch (≤ 10 lines) or a one-sentence description of the change; no full rewrites.
- A finding that cannot be traced to a concrete code path (e.g., "might be slow") is excluded.
- The "areas worth tracing" list in the task is a hint set, not an exhaustive bug list; the reviewer traces those first, then reads the remaining code for additional defensible findings.

## 2. Data model

None. The task produces a markdown document; no persistence is involved.

## 3. Types and signatures

The deliverable is `REVIEW.md`, structured as follows:

```
# Code Review — Transfers Service

## Findings

### F1 — <short title>
- **Location:** `file.ts:NN`
- **Severity:** blocker | major | minor
- **Mechanism:** <why it breaks, under what conditions (load / error path / concurrent shape)>
- **Fix:** <code sketch ≤ 10 lines, or precise one-sentence description>

### F2 — ...
(repeat for each finding)

## Verdict
block | approve-with-comments
<one-paragraph justification referencing finding IDs>

## Non-blocking observations
(bullet list; explicitly labelled "style / readability — does not affect correctness")
```

Severity ordering: all `blocker` findings first, then `major`, then `minor`. Within a severity tier, order is by file (transfers.service.ts → accounts.repository.ts → serializer.ts).

Rules:
- Every finding must name at least one concrete line range.
- "Mechanism" must state the triggering condition (e.g., "when two concurrent transfers touch the same pair of accounts in opposite order").
- A finding with no fix sketch is invalid; if the fix is a one-liner, write it inline.
- The verdict must reference finding IDs (e.g., "Blocked by F1, F3").

## 4. Control flow

The review process is linear:

1. **Read all three fixture files in full.** Note the public method signatures and any injected dependencies.
2. **Trace the hinted paths first** (in this order): notification promise handling → lock acquisition order → raw-connection client lifecycle → audit-log money serialization → statement-builder query pattern → retry-path balance update → transaction boundary (inside vs. outside).
3. **Trace remaining paths** not covered by step 2: error branches, early returns, retry loops, and any code that mutates state without a visible rollback.
4. **Draft findings.** For each, verify the line number by re-reading that region of the file.
5. **Rank and assign severity.** A finding is a blocker if it corrupts money or violates atomicity under a realistic condition. Major if it causes a crash, deadlock, or silent data loss on an error path. Minor if it is a leak, a race that degrades but does not corrupt, or an inconsistent state that is self-healing.
6. **Write the verdict.** If any blocker exists → block. Else if majors exist → approve-with-comments (list them). Else → approve-with-comments (style only) or plain approve.
7. **List non-blocking observations** separately, if any.

No code is modified. No files other than `REVIEW.md` are written.

## 5. Tests

This task produces a document, not executable code. Validation criteria:

- Every finding cites a real line in one of the three fixture files (spot-checkable by opening the file).
- No finding duplicates another (same root cause at the same site appears once).
- Severity assignments are mutually consistent: a blocker implies "corrupts funds or breaks atomicity"; a major implies "crashes or silently loses data on an error path"; a minor is anything less.
- The verdict matches the highest-severity finding present (block iff ≥ 1 blocker).
- Non-blocking section, if present, contains no items that restate a finding.
- Total findings: the reviewer should expect between 4 and 8 findings across the hinted areas; fewer than 4 suggests missed paths, more than 8 suggests low-precision padding.

## 6. Manifest

<!-- manifest
REVIEW.md | reads: fixtures/transfers/transfers.service.ts, fixtures/transfers/accounts.repository.ts, fixtures/transfers/serializer.ts | code-review findings with severity, mechanism, and fix for the transfers service -->
-->
