# 08 — Infra debugging: fix the deploy without breaking security

## The real situation

Onboarding into an unfamiliar environment: a remote Kubernetes cluster set up by
someone else, reachable only through an SSH jump host. Nothing works on day one —
`kubectl` fails TLS verification because the API server certificate doesn't cover
the tunneled hostname (a SAN problem), services like Postgres and the artifact
registry are only reachable via port-forwarding, and half the errors are
misleading symptoms of one underlying misconfiguration.

The engineering skill being tested is not "knows kubectl flags". It is the debug
discipline under an unfamiliar stack:

- **Diagnose before touching.** Read the error, form a hypothesis, verify with a
  command, then change one thing.
- **Minimal fix, root cause.** Fix the certificate SANs or the kubeconfig server
  name — don't sprinkle `insecure-skip-tls-verify: true` and call it done.
  Disabling security to make an error disappear is the canonical wrong answer,
  and models offer it constantly.
- **Distinguish faults from symptoms.** One wrong service selector produces
  connection-refused errors three layers up; a missing readiness probe makes a
  healthy rollout look broken.
- **Leave a runbook.** The fix isn't finished until the next person can verify
  the system without re-deriving everything.

This is the "infra" problem of the suite: given a broken environment definition
with planted faults, produce diagnosis, minimal corrections, and a verification
runbook.

## Stack

Kubernetes manifests and/or docker-compose + shell. Deliverables are corrected
config files and a runbook — this problem intentionally has no TypeScript
solution tree.
