# Verdict — 09 Feature inside conventions (gpt-oss-120b, hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: openai/gpt-oss-120b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✗, M6 ~]

graded:       {convention_fidelity: 2, domain_modeling: 2, ambiguity: n/a,
               test_quality: 1, quality: 1, process: n/a}

typecheck:    failed after 2 repairs — 36 errors, 26 of them in the spec file
tests:        3 of 10 pass

failure_mode: reference_gap
              # It read the scaffold's `ApiResult`, imported it correctly, and then
              # called `.isOk` on it twelve times. The scaffold's `ApiResult` is a
              # discriminated union with an `ok()`/`err()` factory and no `isOk`.

revisions:    {self_repairs: 2, dropped_a_requirement: yes}
cost:         {wall_minutes: ~12, requests: 7, usd: 0.0061}
host:         {n/a — the model is not on this machine}

harness_note: |
  **First run of the campaign to see its fixture.** The single shape now sends the
  seeded workspace: the prompt was 47,602 tokens against ~1,340 on the greenfield
  problems. The first attempt was lost to `context_length_exceeded` — 136,221 tokens
  against this model's 131,072 limit — because `seed_reads` included
  `pnpm-lock.yaml`, 84 KB of the 97 KB seeded. Lockfiles are now excluded; runs 09,
  10 and 11 carried it, 12 onward do not.

would_merge:  no
headline:     Given the codebase to read, it followed the conventions it could see
              and invented the semantics it had to understand.
```

## The fix is measurable, and it worked

The scaffold uses `.js` on every relative import. Counting the two models' own source:

| | with `.js` | without |
|---|---|---|
| **gpt-oss-120b, fixture visible** | **58** | **0** |
| Qwen3.8-27B, blind | 37 | 16 |

Zero misses across fifty-eight imports. Qwen lost the convention on sixteen, in the
back half of its reply, because it was working from a prose description of a codebase
it never saw.

M2 is the same story. The variant states the envelope requirement and the scaffold
demonstrates it, and this run does what Qwen did not:

    import { ApiResult } from '../../common/api-result.js';
    // – All responses are wrapped in the shared `ApiResult` envelope.
    ): Promise<ApiResult<any>> {

M1 layering holds — controller to service to repository, no ORM in the controller.
M3 delivers all four endpoints the variant lists. M4 is clean: of the whole scaffold
only `src/app.module.ts` and `drizzle/schema.ts` differ, both of which the feature
requires.

## And then it invented the API it had just imported

The scaffold's `src/common/api-result.ts`:

    export interface ApiOk<T> { … }
    export interface ApiErr { … }
    export type ApiResult<T> = ApiOk<T> | ApiErr;
    export const ApiResult = { ok(…): ApiOk<T>, err(e: AppError): ApiErr };

A discriminated union with a factory. The model's spec file calls `.isOk` **twelve
times** — the `neverthrow`/Rust `Result` idiom — on values of that type:

    src/modules/trips/trips.service.spec.ts(134,22)
      Property 'isOk' does not exist on type 'ApiResult<…>'

Twenty-six of the thirty-six errors are that, and they are why seven of ten tests fail.

This is the campaign's finding, sharpened by the fix rather than removed by it.
**Reading the file taught it the import path, the file layout and the envelope's name.
It did not stop it from assuming what the envelope's methods were.** The model
pattern-matched the surface it could see and filled in the behaviour from a library it
knows.

Its controller shows the same split: `Promise<ApiResult<any>>` where the scaffold
writes `Promise<ApiOk<User>>`, and a bare `@Controller()` where every scaffold
controller carries its prefix. The shape is copied; the specifics are approximated.

## M5

`drizzle/schema.ts` gains ten trip-related declarations and `drizzle/` gains no
migration — `0000_init.sql` is byte-identical to the scaffold's. The variant is
explicit: "Schema changes via Drizzle migrations in `drizzle/`". A hand-edited schema
with no migration is the case M5 exists to catch.

## Against Qwen3.8-27B on the same problem

| | Qwen3.8-27B (blind) | gpt-oss-120b (fixture visible) |
|---|---|---|
| must-haves | 5 of 6 — M2 failed | 5 of 6 — M5 failed |
| `.js` convention | 37 / 16 | **58 / 0** |
| shared envelope | not used | used |
| migration shipped | ✓ `drizzle/0001_trips.sql` | ✗ |
| tests | 11 of 14 pass | 3 of 10 |
| verdict | FAIL | FAIL |

Two 5-of-6s failing different must-haves. The comparison is not clean — one model was
shown the code and the other was not — but the direction is informative: **what the
fixture buys is convention fidelity, not correctness.** The blind run guessed the
layout and got the migration right; the sighted run matched the layout exactly and
invented the API.
