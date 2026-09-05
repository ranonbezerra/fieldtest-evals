# Verdict — 09 Feature in conventions

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, reasoning_effort: medium}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided, M6 decided]
gate:         [M1 ✓, M2 ✗, M3 ✓, M4 ✓, M5 ✓, M6 ✓]

graded:       {convention_fidelity: 2, domain_modeling: 3, ambiguity_handling: 2,
               test_quality: 3, code_quality: 2, process: 2}

manifest:     12 declared, 12 built, not truncated
typecheck:    failed after 13 repairs — 12 errors, 10 of them TS2307
tests:        9 of 16 pass

failure_mode: reference_gap
              # It assumed `common/auth.guard` and `common/current-user.decorator`
              # exist. The scaffold's `common/` holds api-result, app-error and
              # error.filter, and nothing else. Importing them with `.js` failed, and
              # it diagnosed the failure as the extension rather than the missing
              # file — then stripped the extension from all nine imports in that file,
              # including the seven that would have resolved.

revisions:    {self_repairs: 13, dropped_a_requirement: no}
cost:         {wall_minutes: 165, output_tokens: 100074, tokens_per_second: 10.1,
               requests: 27, output_ceiling_hits: []}
host:         {requests_under_pressure: 0 of 27, ceiling_gib: [37.44, 37.44],
               comparable: yes}

would_merge:  after_changes
headline:     Reads the codebase's conventions well, then infers the wrong rule from
              a failure and applies it to a whole file.

notes: |
  The first problem with an existing codebase, and the convention-following is mostly
  good. The migration ships as `0001_create_trips.sql` beside the scaffold's
  `0000_init.sql`, in its numbering. Entities go in `trips/entities/`, matching
  `users/entities/`. The test lands at `src/modules/trips/trips.service.spec.ts`,
  matching `users.service.spec.ts`. Nothing outside `trips/` was touched.
  M1 holds: the controller calls the service, the service calls the repository, and
  no Drizzle call appears above the repository.
  M2 is where it splits. The **error** envelope is followed exactly — every failure is
  `new AppError('not_found' | 'forbidden' | 'validation_failed', …)`, drawn from the
  scaffold's closed union rather than invented. The **result** envelope is not: the
  scaffold's controllers return `ApiResult.ok(await …)` and this one returns the
  service's value bare. Half a convention, and the half a client sees.
  The seven failing tests are the fifth instance of one artifact of a run disagreeing
  with another. Its implementation reuses the scaffold's generic codes; its tests
  assert domain-specific ones — `not_the_owner`, `invite_not_found`,
  `trip_not_found`, `not_a_member`, `invalid_date_range`. The scaffold's own comment
  says "Adding a code is normal; inventing an envelope is not", so the tests took a
  permission the implementation declined. Neither choice is wrong; they disagree.
```

## A correct inference from a false premise

`trips.controller.ts` carries this, written by the model:

    // ASSUMPTION: the auth guard and current-user decorator are imported without a
    // `.js` extension; the compiler could not resolve the `.js`-suffixed paths.

Both halves are true and the conclusion does not follow. `../../common/auth.guard.js`
did not resolve — because `auth.guard.ts` does not exist. The scaffold's `common/`
contains `api-result.ts`, `app-error.ts` and `error.filter.ts`. The model needed an
auth guard and a `@CurrentUser` decorator, assumed a codebase like this one would have
them, and imported them.

Then the compiler said it could not find the module, and the model read that as *this
project does not use extensions here* — and applied the new rule to every import in
the file. Nine imports lost their extension; two of them were genuinely missing files,
seven would have resolved.

The per-file measurement makes it exact:

| file | with `.js` | without |
|---|--:|--:|
| `trips.service.ts` | 8 | 0 |
| `trips.service.spec.ts` | 7 | 0 |
| `trips.repository.ts` | 4 | 0 |
| `trips.module.ts` | 3 | 0 |
| `get-trip-response.dto.ts` | 1 | 0 |
| **`trips.controller.ts`** | **0** | **9** |

Six files unanimous one way, one file unanimous the other, and a written record of why.
This is not the drift §3.6 has been measuring across runs. It is a local hypothesis,
formed from real evidence, generalised one step too far — and it produced nine of the
run's twelve errors.

*What this adds to §3.6:* the convention is decided per file, each file is internally
consistent, and at least once the decision was reasoned rather than random. That the
reasoning was wrong is a different failure from inconsistency, and it wants a different
fix: not "tell it the module system" but "the missing file, not the extension, is why
this did not resolve."
