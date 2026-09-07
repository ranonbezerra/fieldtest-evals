# Verdict — 10 Adapt an existing screen (gpt-oss-120b, hosted, single request)

```yaml
verdict:      PASS_WITH_NOTES
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: openai/gpt-oss-120b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ~, M6 ✓]

graded:       {component_placement: 3, state_management: 3, regression_care: 3,
               test_quality: 0, quality: 2, process: n/a}

typecheck:    passed on attempt 0 — zero repairs
tests:        the scaffold's suite passes 2 of 2, verified by the judge.
              The model wrote none of its own.

failure_mode: none
              # The gaps are omissions, not defects: no new test, and requirement 3
              # of the variant is unimplemented.

revisions:    {self_repairs: 0, dropped_a_requirement: partly}
cost:         {wall_minutes: ~2, requests: 1, usd: 0.0022}
host:         {n/a — the model is not on this machine}

verification: run by the judge. Workspace copied, `pnpm install`, `vitest run`
              unmodified — the scaffold's `SessionsListScreen.test.tsx` passes.

would_merge:  after adding the tests the variant asks for
headline:     Three files, one request, a clean compile and no regressions — the
              first genuinely surgical edit either model has produced.
```

## It is an edit

The whole delivery:

    src/app/AppLayout.tsx              modified — renders <ActiveSessionBar />
    src/components/ActiveSessionBar.tsx  new — 61 lines
    src/features/sessions/queries.ts   modified — adds useActiveSession, useCloseSession

Nothing else in the scaffold differs. M1 asks for an edit rather than a rewrite and M6
for no drive-by changes; both hold exactly, and the variant's closing line —
"Deliver the edit as a coherent diff" — is honoured.

M4 is the requirement that separates a real implementation from a plausible one:

    useQuery({ queryKey: sessionKeys.active(), queryFn: () => api.getActiveSession() })

The server is the source of truth, through `GET /sessions/active`, with no client-side
persistence of a server fact. That is requirement 4 of the variant, stated as a
constraint and met as one.

M3 goes through react-query, the app's existing mechanism, with `useQueryClient` for
invalidation. The bar ticks its elapsed time on a one-second interval, offers close
behind a `ConfirmDialog` — the scaffold's own component — and lives in `AppLayout`, so
it is on every authenticated screen.

M2 is verified rather than assumed: the scaffold's suite runs green against this
workspace.

## What is missing

**No tests.** The variant asks for "the edit as a coherent diff **+ tests in the app's
style**", and the model wrote none. `test_quality: 0`. The scaffold's
`SessionsListScreen.test.tsx` shows the style; nothing was added beside it.

**Requirement 3 is unimplemented.** "Only one active session at a time; opening another
replaces it (with confirm if the current one has unsaved notes — the detail screen
already tracks a dirty flag)." The confirm dialog in the bar guards *closing*, not
replacing, and the detail screen was not touched, so the dirty flag is never consulted.

**M5 is partial**: `if (isLoading || !session) return null;` handles pending by
rendering nothing, which is reasonable for a bar, but there is no error branch — a
failed `getActiveSession` is indistinguishable from no active session.

## Against Qwen3.8-27B on the same problem

| | Qwen3.8-27B (blind) | gpt-oss-120b (fixture visible) |
|---|---|---|
| files delivered | 29 | **3** |
| scaffold files changed | 8 overwritten, 13 more by the gate | 2, both required |
| shared types | rewrote `api/types.ts`, deleting four exports | untouched |
| the app after the change | two parallel applications, `main.tsx` mounting its own | one application, edited |
| typecheck | 33 errors, all in scaffold files | **0, attempt 0** |
| existing suite | unrunnable | **2 of 2 pass** |
| verdict | FAIL | **PASS_WITH_NOTES** |

This is the sharpest before/after the fixture fix has produced. Qwen, given a prose
description of an app it could not see, built its own and broke the original on the way
out. Given the same task with the code in front of it, gpt-oss-120b changed three files
and left everything else alone.

**And it is the same model that, on the seven greenfield problems, produced skeletons
with the bodies missing.** On this problem there was no body to invent — the
application already existed — and what it had to do was read, place and connect. That
it does well.
