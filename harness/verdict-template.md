# Verdict template

One per run, written to `verdict.md` in the run directory after de-anonymizing.
Every problem uses this shape; only the `gate` keys and the `graded` keys differ,
and those come from the problem's own rubric.

```yaml
verdict:      PASS | PASS_WITH_NOTES | FAIL
condition:    {runner: api|aider|chat, spec: model|ladder}

plan_gate:    [M1 decided|wrong|absent, ... ]   # from PLAN.md alone, before the code
gate:         [M1 ✓/✗, ... Mn ✓/✗]              # from the delivered code

graded:       {<the rubric's criteria>: 0-3, ...}

failure_mode: none | reference_gap | decision_overload | wrong_answer | harness_artifact
              | host_pressure
              # one line naming the phase and quoting the reasoning that decides it

revisions:    {self_repairs: n, dropped_a_requirement: yes|no}
cost:         {wall_minutes: n, output_tokens: n, tokens_per_second: n,
               output_ceiling_hits: [phase, ...]}
host:         {pressure_samples: n of m, ceiling_gib: [min, max],
               comparable: yes|no}

would_merge:  yes | after_changes | no
notes:        <3-6 lines, concrete>
```

## Reading the fields

**`plan_gate` against `gate`** is the point of recording both. A must-have decided in
the plan and lost in the code is an implementation failure. One never in the plan is a
design failure. They want different responses and the single gate cannot tell them
apart.

**`failure_mode`** is defined in [`judge-prompt.md`](judge-prompt.md) step 4. For a
local model it is more decision-relevant than the score, because `reference_gap` and
`decision_overload` look identical from outside and want opposite fixes.

**`revisions.dropped_a_requirement`** is the thing a green typecheck cannot see. A
repair is handed the compiler's exact messages; satisfying them by quietly abandoning
something the plan specified is the failure the whole gate exists to catch.

**`host`** decides whether `cost` may be quoted at all. The server's ceiling moves
with the machine's load, and under swap pressure the model server does not slow down —
it dies. Any run with `pressure_samples > 0` is `comparable: no`, and its throughput
is a measurement of the machine. See [`host-limits.md`](host-limits.md).

**`cost`** is context, not score. Slow is not wrong. `output_ceiling_hits` is not
context: it means no answer rather than a wrong one, and `failure_mode` must say which
cause.
