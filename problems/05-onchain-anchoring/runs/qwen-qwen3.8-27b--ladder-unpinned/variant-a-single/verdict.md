# Verdict — 05 On-chain anchoring (qwen3.8-27b, hosted, **ladder**)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: ladder, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               upstream_provider: Novita}

plan_gate:    n/a — the level-2 specification replaced the plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ~, M6 ✓]

graded:       {state_machine: 3, recovery: 3, verification: 2, tests: 0,
               quality: 1, process: n/a}

typecheck:    failed after 5 repairs — 11 errors, **every one a module against
              another module of the same reply**
tests:        did not run

failure_mode: reference_gap
              # `anchors.module.ts` imports `AnchorWorkersService`,
              # `ConfirmationWorkerService` and `RecoverySweepService` from
              # `./anchors.worker.js`. That file exports one class, `AnchorsWorker`.
              # None of the three names exists.

revisions:    {self_repairs: 5, dropped_a_requirement: no}
cost:         {output_tokens: 101185, requests: 6, usd: 0.3641}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     The best state model this problem has received, wired to three worker
              classes that were never written.
```

## The design is the strongest of any run on this problem

M3 asks that broadcast-sent, confirmed and *unknown* be distinct states. The schema:

    enum AnchorStatus {
      // Prepared:        intent committed, not …
      // BroadcastSent:   node accepted the tra…
      // OutcomeUnknown:  broadcast attempted, …
      //                  Never collapsed into …
      // Confirmed:       receipt with a block …
      // Failed:          definitive failure (n…

`OUTCOME_UNKNOWN` is the state most implementations omit, and the comment says why it
must not be folded away — which is §3 of the issue, understood rather than transcribed.

M1 is in the right order with the reason attached:

    const { txId, signedTx } = await this.chain.prepare(…);
    // Persist anchor intent with tx identity BEFORE broadcasting.
    // This guarantees that even if the process crashes …
    …
    await this.chain.broadcast(signedTx);

M2 `@@unique([documentId, version])` at the schema level. M4 the worker consults
`getReceipt` and `chain-client.ts` carries `Confirmation comes only from getReceipt()`.
M6 no key material anywhere.

M5 is partial: hashing exists but `createHash` appears in the fake chain client rather
than in a canonicalization the issue asked to have written down and reproducible by an
auditor in four years.

## And the module graph refers to code that does not exist

`anchors.module.ts`:

    import {
      AnchorWorkersService,
      ConfirmationWorkerService,
      RecoverySweepService,
    } from './anchors.worker.js';

`anchors.worker.ts`, in the same reply, in full at its export line:

    export class AnchorsWorker {

One class. Three imported names, none of them it.

The other eight errors are the same shape: the controller calls its own service with
two arguments where it takes three, assigns a `VerifyResult` to a differently-declared
`VerifyResult`, and throws a `DuplicateAnchorError` that is defined nowhere. The
repository imports a member `chain-client.ts` does not export.

**Eleven errors, eleven instances of one file disagreeing with another file from the
same reply.** Two more `ASSUMPTION` comments in `anchors.worker.ts` and
`document-content-provider.ts`.

## Four problems into the ladder axis

| | 01 | 03 | 04 | 05 |
|---|---|---|---|---|
| must-haves met | 8/8 | 4/6 | 6/6 | 5.5/6 |
| errors | 25 | 10 | 27 | 11 |
| what they are | schema drift | service drift | module drift | module drift |
| tests ran | no | no | no | no |

Four for four. **Not one of these four runs has produced a suite that executes**, and
in every case the reason is the same: the model builds the thing the specification
describes, and then cannot address it consistently across the files it just wrote.

The `model` axis on this problem scored 6 of 6 and failed on 17 missing `.js`
extensions. The ladder axis scores 5.5 of 6 and fails on three class names. **Handing
over the design moved the failure and did not remove it.**
