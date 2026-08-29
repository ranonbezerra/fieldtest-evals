# Runs — 02 reconciliation resend

Created by `harness/ft-go`; nothing here is written by hand.

```
runs/
  qwen3.8-27b-mlx-6bit/            # runner=api, spec=model — the default pairing
    variant-a/
      PLAN.md          the model's own specification, written before any code
      workspace/       the code exactly as the model left it
      steps/           every request: reasoning, reply, counters
      transcript.md    all of it concatenated, nothing elided
      GATE.md          typecheck output for every attempt, revisions included
      meta.yaml        counters, throughput, revisions, failures
      verdict.md       written after blind judging
    variant-b/
    variant-c/
  qwen3.8-27b-mlx-6bit--aider/     # runner=aider
  qwen3.8-27b-mlx-6bit--chat/      # the by-hand chat condition
  qwen3.8-27b-mlx-6bit--ladder/    # spec=ladder: implementation only
```

The tag carries the axes that are not at their defaults, so the combinations never
overwrite each other. What each condition costs is in
[`harness/conditions.md`](../../../harness/conditions.md).

`ft-go` refuses to re-enter a run directory. **Never edit a workspace after the run** —
fixes belong in notes, not in the artifact being judged.
