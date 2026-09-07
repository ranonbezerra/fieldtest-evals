# Verdict — 09 Feature inside conventions (hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✗, M3 ~, M4 ✓, M5 ✓, M6 ~]

graded:       {convention_fidelity: 1, domain_modeling: 2, ambiguity: n/a,
               test_quality: 0, quality: 1, process: n/a}

typecheck:    failed after 2 repairs — 24 errors, 16 of them unresolved relative
              imports that all exist on disk
tests:        11 of 14 pass

failure_mode: reference_gap
              # Two kinds, both inside one reply. The `.js` extension convention is
              # held for seven files and dropped for the last five. And the test file
              # calls a four-argument `createTrip` that the service, written five
              # files earlier, declares as `createTrip(userId, dto)`.

revisions:    {self_repairs: 2, dropped_a_requirement: yes}
cost:         {wall_minutes: —, output_tokens: —, requests: 3, usd: —}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     On the one problem that is purely about obeying a convention placed in
              front of it, it obeyed for seven files and then stopped.

notes: |
  M1 holds: the controller imports the service, the dtos and the guard, and touches
  no database. M4 holds cleanly — of every scaffold file, only `src/app.module.ts`
  differs, which is the wiring the feature requires. M5 ships `drizzle/0001_trips.sql`
  in the repo's migration style. M6's layout is right, `trips.service.spec.ts` beside
  the module exactly as `users.service.spec.ts` sits.
  M2 fails, and it fails against an instruction the variant writes out in full:
  `All endpoints return the shared envelope { ok, data | error }`. The scaffold shows
  it twice over — `async create(...): Promise<ApiOk<User>>` returning
  `ApiResult.ok(...)`. The model's controller imports no `ApiResult`, declares no
  envelope type and returns the service's value raw. It also writes `@Controller()`
  bare where every scaffold controller carries its prefix.
  M3 is partial: all four endpoints exist and are wired, and three of the model's own
  tests for them fail.
```

## Seven files with the convention, five without

The scaffold uses `.js` on every relative import and sets `"moduleResolution":
"NodeNext"`; the model kept that tsconfig, so the extension is mandatory. Its own
delivery, in order:

    1–7.  entities, dtos, the SQL migration          all with .js
      8.  trips.repository.ts        com=0  sem=3    ← dropped
      9.  trips.service.ts           com=4  sem=0    ← recovered
     10.  trips.controller.ts        com=0  sem=5    ← dropped
     11.  trips.module.ts            com=0  sem=3    ← dropped
     12.  trips.service.spec.ts      com=0  sem=3    ← dropped
     13.  src/app.module.ts          com=0  sem=2    ← dropped

Sixteen unresolved imports, and **every file they name exists in the workspace**. This
is not a missing file or an ambiguous convention. The convention was in the code it was
handed, it followed it for thirty-seven imports, and it lost it for sixteen — all of
them in the second half of one reply.

## The signature that changed between two files

    src/modules/trips/trips.service.ts:14
      async createTrip(userId: string, dto: CreateTripDto): Promise<Trip>

    src/modules/trips/trips.service.spec.ts:80
      const result = await service.createTrip('Summer Trip', 'Lisbon', '2025-06-01', …)

Four positional strings against `(userId, dto)`. `userId` receives `'Summer Trip'`,
`dto` receives the string `'Lisbon'`, and so `dto.name` is `undefined` — which is
exactly what the failing assertion reports:

    -  "name": "Summer Trip",
    +  "name": undefined,

The dto declares the right four fields. The service reads the right four fields. The
test supplies the right four values. **Only the call shape disagrees**, and it
disagrees with a signature the model wrote four files earlier in the same reply.

## What this corrects about problem 05

The verdict on 05 hosted concluded that `reference_gap` "is a property of asking this
model for one file at a time." That is too strong, and this run is the counterexample.

Measured across all thirteen hosted runs that chose NodeNext:

| | runs | relative imports |
|---|---|---|
| convention held throughout | 04, 05, 07, 11, 15, 18 | **145 with `.js`, 0 without** |
| one convention, wrongly chosen | 02 | 0 with, 14 without |
| convention lost partway | 03, 06, 09, 17 | 94 with, 29 without |

The single request does not eliminate the defect. It changes its shape: locally the
model lost the extension on **seventeen of eighteen** files, uniformly, because each
file was a separate request with no sight of the last. Hosted, six runs hold the
convention perfectly across 145 imports, and four lose it partway through a long reply.

**What the decomposition did was convert an occasional drift into a certainty.** The
drift itself belongs to the model.
