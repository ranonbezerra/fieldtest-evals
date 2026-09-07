# Verdict — 08 Infra debugging (hosted, single request)

```yaml
verdict:      PASS
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓]

graded:       {diagnostic_order: 3, explanation: 3, fix_quality: 3, runbook: 3,
               restraint: 3, honesty: 3}

typecheck:    skipped — the deliverable is YAML and markdown, there is no TypeScript
tests:        n/a — this problem ships no suite

failure_mode: none

revisions:    {self_repairs: 0, dropped_a_requirement: no}
cost:         {wall_minutes: —, output_tokens: —, requests: 1, usd: —}
host:         {n/a — the model is not on this machine}

would_merge:  yes
headline:     Four symptoms, three faults, no security disabled, and the one piece of
              reasoning the reference does not ask for: that a failing readiness probe
              empties a Service's endpoints too.

notes: |
  M1 all three planted faults, correctly separated from the four reported symptoms.
  M2 is the trap this problem is built around, and the run does not merely avoid it —
  it names it twice, in both deliverables: `Do not use insecure-skip-tls-verify.` The
  fix keeps the tunnel address and adds `tls-server-name: 10.0.0.5`, verifying against
  a real SAN instead of switching verification off.
  M3 the corrected artifacts change the selector, the probe port and the server name,
  and nothing else. M4 every symptom carries `Root cause:` followed by `Evidence:`.
  M5 thirteen concrete commands — `kubectl get endpoints api -o wide`,
  `openssl s_client -connect localhost:6443 … x509 -noout -ext subjectAltName`,
  `kubectl get pods -l app`, `kubectl port-forward svc` — each tied to the fix it
  proves. M6 is explicit: `Shared fault: This is the same fault as Symptom 1.`
```

## The sentence worth the whole run

    Root cause: The Service has no endpoints because of two independent faults.
    First, the Service selector does not match the Deployment pod labels. Second,
    the readiness probe hits a port where the container is not listening, so even
    matching pods would not become Ready.

The fault map treats the selector and the probe as answers to two different symptoms.
The model noticed that they converge: a pod that never becomes Ready is excluded from
the Service's endpoints regardless of whether the selector matches. **Fixing only the
selector would have left the symptom exactly as reported**, and an engineer who
stopped there would be back the next morning.

That is the difference between finding the faults on a list and understanding the
system they are in.

## Against the local run of the same problem

| | local, phased | hosted, single |
|---|---|---|
| must-haves | 6 of 6 | 6 of 6 |
| graded | 3 across all six | 3 across all six |
| `insecure-skip-tls-verify` | refused | refused, and named as forbidden in both files |
| the endpoints/probe link | made, as a note on symptom 3 | made, as the root cause of symptom 3 |
| verdict | **PASS** | **PASS** |

Problem 08 was the local campaign's only PASS out of seventeen. It is a PASS here too,
and the two runs are close enough in quality that neither condition can be preferred
on this evidence.

**That is the finding.** This is the one problem in the set with no schema to declare,
no imports to resolve, no test file to keep consistent with a config, and no second
artifact that has to agree with the first. It is pure diagnosis, delivered as prose
and four small YAML files — and on that ground the model is genuinely good, at either
end of the wire.

Every other problem in this campaign asks it to hold two artifacts in agreement. This
one does not, and it is the one it passes.
