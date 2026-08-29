# Judge prompt template

Use with a frontier model, one anonymized run at a time. Fill the `{…}` slots.
Judge one dimension at a time; require quoted evidence for every score.

Stage runs with [`ft-anon`](ft-anon) first — it strips the model's identity from
`meta.yaml` while keeping the counters, which are evidence.

---

You are judging one solution to a software engineering problem, blind to which model
produced it. Be strict, evidence-based, and unimpressed by confidence.

INPUTS
<variant>{variant .md, verbatim}</variant>
<rubric>{rubric.md, verbatim}</rubric>
<reference>{reference/SOLUTION.md — your anchor, not a template the solution must copy}</reference>
<run>
<plan>{PLAN.md — the specification the model wrote for itself before any code}</plan>
<workspace>{file tree + contents}</workspace>
<transcript>{complete session transcript, including each request's reasoning}</transcript>
<telemetry>{the anonymized meta.yaml: counters, throughput, revisions, failures}</telemetry>
</run>

PROCEDURE

**0. PLAN.** Before reading any code, evaluate `PLAN.md` alone against the rubric's
must-haves. For each must-have, say whether the plan **decides** it correctly,
decides it wrongly, or leaves it undecided — with the quoted line. A plan that gets a
must-have right and code that then loses it is a different failure from a plan that
never had it, and only this step can tell them apart.

If the run has no `PLAN.md` (the `chat` condition, or a `--spec ladder` run), say so
and skip to step 1. In a `ladder` run the plan is the reference's and is **not** the
model's work: judge only the implementation.

**1. GATE.** Evaluate each must-have (M1..Mn) independently against the delivered
code. For each: ✓/✗ plus the exact quoted lines of code (or transcript) that prove it.
**If evidence is absent, the verdict is ✗** — absence of proof fails a must-have.

**2.** If any must-have is ✗, the final verdict is FAIL. Still complete the remaining
steps: the feedback is the point.

**3. GRADED.** Score each graded criterion 0–3, one at a time, each with quoted
evidence and one sentence of justification. Alternative designs that differ from the
reference but satisfy the rubric score on their merits.

**4. FAILURE MODE.** For every phase that produced nothing, produced a wrong artifact,
or needed a revision, classify it as exactly one of:

| Mode | What it looks like | What it means |
|---|---|---|
| `reference_gap` | the model reasons about something it cannot read, and **the question restarts** — *"Is X a class or an interface? Which of these is expected?"* | the phase named something unresolvable. Splitting would not help; both halves inherit it |
| `decision_overload` | the reasoning is correct and simply does not converge — *"Step 4 before step 5, because an expired token reused is still a leak."* The question is **decided**, there are just too many of them | the phase carried too many independent ways to be silently wrong |
| `wrong_answer` | it wrote confidently and the code is wrong | the model's own ceiling. This is the only mode that is about the model |
| `harness_artifact` | truncated path, unparsed reply, empty file with a clean exit, task trimmed out of the window | the tool, not the model. Say which |
| `host_pressure` | nothing to read in the reasoning, because the model never got to reason. Identified from `<telemetry>`, not the run: `host.pressure_samples > 0`, or a wall time wildly out of line with the tokens produced | **the machine.** A 46-minute phase that produced zero bytes was measured on this hardware, with the model's weights paged to disk. Classifying it as `wrong_answer` puts a defect on the model that belongs to the host |

The distinction between the first two is the most decision-relevant output of this
whole procedure for a local model, and the transcript's reasoning is where it is
legible. A run with no failures gets `none`.

**5.** Fill the verdict template exactly. In `notes`, write the 3–6 most
decision-relevant lines: what it nailed, what sank it, what to probe next.

RULES
- Judge only what is in the run. Do not assume unwritten code works.
- **The transcript counts.** Convention-reading order, assumption-surfacing, and
  whether self-corrections converged or thrashed are graded material.
- **A revision is not a pass.** `revisions.self_repairs > 0` means the model was handed
  the compiler's exact messages and given another attempt. Weigh the result
  accordingly, and check the repair did not drop a requirement to silence an error.
- **An `// ASSUMPTION:` comment is evidence, not an excuse.** The harness invites the
  model to mark what it could not resolve rather than guess in silence. A well-placed
  one is process credit; one covering a decision the statement did settle is not.
- Do not average away a critical flaw; the gate exists so you cannot.
- **Hollow tests are negative evidence, not coverage.** Assertion-free, happy-path-only,
  or asserting that a call happened rather than what it did. So is a criterion that
  passes for the wrong reason: a status code checked instead of a body, a version
  string checked instead of the extension, a migration the tool reports as applied
  while it created nothing, a loop that matched no rows.
- **Throughput is context, not a score.** Slow is not wrong. But an output-ceiling hit
  is: it means no answer rather than a wrong one, and step 4 must say which cause.
- **Check the host before blaming the model.** `<telemetry>` carries `host`. If
  `pressure_samples > 0`, say so in `notes` and do not quote the throughput figure:
  the server's own ceiling moves with the machine's load, and under swap the model
  server dies rather than slowing down. See [`host-limits.md`](host-limits.md).
