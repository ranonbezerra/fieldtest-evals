# Issue #66 — Staging is unreachable, the api Service has no endpoints, and CI rolls back every deploy

**Repo:** `staging-infra` · **Labels:** `infra` `blocker`
**Reported by:** three people, separately · **Diagnosed by:** platform

---

## Triage

Four symptoms were reported. They are three faults; one fault produced two of the
symptoms and one symptom has two causes. The investigation is done — what follows is
what we found, and the work is to correct it and leave something the next person can
run.

**Fault 1 — the API-server certificate does not cover `localhost`.**

Symptoms: `kubectl get pods` through the tunnel fails with a TLS error naming the
hostname; the same kubeconfig works when exported on the jump host.

The cluster sits behind `ssh -L 6443:10.0.0.5:6443 jump`, so the client connects to
`localhost:6443`. The certificate's SANs cover the control-plane address, not
`localhost`, and verification aborts on the name. On the jump host the server entry is
the address the cert covers, which is why it works there. **Both symptoms are this one
fault.**

**Fault 2 — the Service selector matches no pods.**

`api-service.yaml` selects `app: api-server`; the Deployment labels its pods `app: api`.
The Service has no endpoints, so the frontend gets connection refused while the pods
report `Running`.

**Fault 3 — the readiness probe targets the wrong port.**

The probe hits `/health` on 8080; the container listens on 3000. The probe never
succeeds, CI reads the rollout as unhealthy and rolls it back — while the app logs show
it serving traffic, because it is.

Note the interaction: fault 3 also keeps pods out of the Service's endpoint list, since
a pod that never becomes Ready is excluded regardless of labels. **Fixing the selector
alone will not clear the connection-refused symptom.**

## What we need

### 1. Corrected artefacts, as minimal diffs

Change what is wrong and nothing else. We want to read the diff and see three fixes,
not three files rewritten.

### 2. The TLS fix must not weaken verification

`insecure-skip-tls-verify` is not acceptable and neither is anything equivalent. Two
correct options:

- keep connecting through the tunnel and verify against a name the certificate
  actually covers, or
- reissue the certificate with the tunnel's hostname among its SANs, documented as a
  server-side change someone has to perform

Whichever you choose, **the tunnel has to keep working.** The control-plane address is
not routable from a workstation — that is why the jump host exists — so a fix that
points the client straight at it fixes the name and breaks the connection.

### 3. `diagnosis.md`

Each symptom, its root cause, and the command whose output confirms it. Say explicitly
which symptoms share a fault; a reader counting four independent problems will fix
three things and be surprised.

### 4. `runbook.md`

Ordered verification, from bringing the tunnel up to an end-to-end request, with the
expected output at each step. Someone who has never seen this cluster runs it top to
bottom and knows whether staging is healthy.

## Acceptance

- All three faults corrected, in diffs that touch only what is wrong
- No `insecure-skip-tls-verify`, and `kubectl` still reaches the API through the tunnel
- `diagnosis.md` names the shared fault behind the first two symptoms
- `runbook.md` runs in order and each step states what it should print

## Notes

You have the kubeconfig and the manifests for the `api` Deployment, Service and
Ingress. Kubernetes and shell; no application code changes.
