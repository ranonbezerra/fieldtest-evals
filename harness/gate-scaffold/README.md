# Gate scaffold

Copied into a run's `workspace/` **after the model has finished writing** and only
where the file is absent, so the typecheck can run at all.

## Why this exists

Two runs, independently, declared manifests with no build configuration — and both
were right to. The variants ask for a schema, a migration, a module, tests and a
design note; none mentions `tsconfig.json`. The phase-0 instruction goes further and
names *"whether a config file is in scope"* as a convention to settle in one line and
move past.

So `ft-go`'s gate only fired when the model happened to write config it was never
asked for. **A gate that cannot fire is decorative** — the failure problem 16 exists
to measure, in the harness itself. Problem 01's most serious defect, an invented
Prisma `lock` option, is one a typecheck rejects immediately, and it went unnoticed.


> **The evidence is in git history, not in the tree.** The workspace this was
> validated against belonged to the discarded campaign and was removed with it. It is
> recoverable:
>
> ```
> git show fd9647f:problems/01-payout-outbox/runs/qwen3.8-27b-mlx-6bit/variant-a/workspace/src/payout/payout.repository.ts
> ```
>
> Lines 40 and 89 hold the invented option. The gate's behaviour is a property of the
> gate and does not depend on the parameters that produced the code — but a claim
> whose evidence has been deleted should say where it went.

## What it does not change

The model is never told about these files and never sees them; they arrive after its
last phase. They do not appear in any prompt, and they are recorded per run in
`meta.yaml` as `gate_scaffold_added` so a judge knows which files are not the model's
work.

The alternative — asking each variant for build configuration — was rejected: it
would change what eighteen problems measure and spend the model's output budget on
config instead of on the problem.

## Keeping it honest

The dependency list mirrors the cheatsheet's declared stack and nothing more. Adding
a package here to make a run compile would be fixing the run, not the gate.
