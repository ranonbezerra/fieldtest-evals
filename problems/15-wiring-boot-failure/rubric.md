# Rubric — 15 Compiles clean, fails at boot

## Gate: must-haves (missing any = FAIL, regardless of tests)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **It boots** | `pnpm start` (or the fixture's boot script) resolves the dependency graph and reaches the listening state. This is the whole problem; a run whose application does not start fails here whatever else it did. |
| M2 | **Every new provider is registered** | Each service, repository and processor introduced appears in exactly one module's `providers`. Not two — a provider registered in two modules is two instances, and any state in it silently diverges. |
| M3 | **Cross-module providers are exported and imported** | A provider injected outside its own module is in that module's `exports`, and the consuming module `imports` the owner. Registering it a second time in the consumer instead = ✗. |
| M4 | **No import cycle** | No module file imports, directly or transitively, something that imports it back. A shared constant or token lives in its own file that imports nothing. |
| M5 | **Diagnosis names the mechanism, not the symptom** | The written diagnosis says *which* provider was unresolvable and *why the compiler could not see it*. "Added the missing import" without naming the mechanism = ✗. |
| M6 | **Proof of boot, not proof of compile** | The deliverable includes a check that fails when the wiring is wrong — a boot test that instantiates the application context, or a documented command whose output is shown. A green `tsc` or a green unit suite offered as evidence = ✗. |
| M7 | **Nothing silenced** | No `any`, no `@ts-ignore`, no provider replaced by a stub, no `forwardRef` used to paper over a cycle that should be broken by moving a constant. `forwardRef` is acceptable only with a written justification of why the cycle is genuine. |

## Graded criteria (0–3 each, judged blind against the reference)

1. **Root-cause reasoning** — did it trace from the runtime error to the
   registration that was missing, or did it try edits until something worked?
2. **Cycle handling** — the constant moved to a file that imports nothing, versus
   a `forwardRef` sprayed at the symptom.
3. **Boot proof** — the quality of the check added: does it actually fail when a
   provider is unregistered, or does it merely pass today?
4. **Blast radius** — changes confined to wiring. Refactoring unrelated code
   while chasing this is a negative.
5. **Write-up** — the diagnosis reads like something a colleague could act on
   next time this class appears.
6. **Process** (from transcript) — did it reason about resolution order and
   module ownership, or pattern-match on the error string?

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
`gate` carries M1..M7; `graded` carries the six criteria above.
