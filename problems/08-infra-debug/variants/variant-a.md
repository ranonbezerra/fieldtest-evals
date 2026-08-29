# Variant A — Kubernetes behind a jump host

You've joined a team whose staging cluster sits behind an SSH jump host. The
previous engineer left. Symptoms reported:

- `kubectl get pods` through the tunnel fails with a TLS certificate error
  mentioning the hostname.
- The API works if you export `KUBECONFIG` on the jump host itself.
- The `api` Deployment shows `Running` but the frontend gets connection refused
  through the `api` Service.
- Rollouts of `api` are flagged "unhealthy" by CI and rolled back, though the
  app logs show it serving traffic seconds later.

You are given: the kubeconfig (server: `https://localhost:6443` via
`ssh -L 6443:10.0.0.5:6443 jump`), and manifests for the `api` Deployment
(readiness probe hitting `/health` on port 8080; container listens on 3000),
Service (selector `app: api-server`; Deployment labels `app: api`), and Ingress.

Deliver:

1. `diagnosis.md` — each symptom traced to its root cause, with the command/
   evidence that confirms it (note which symptoms share one fault).
2. Corrected manifests/kubeconfig as minimal diffs. TLS must be fixed properly
   (correct server name that the cert covers, or documented SAN reissue) — no
   `insecure-skip-tls-verify`.
3. `runbook.md` — ordered verification commands with expected outputs, from
   tunnel up to end-to-end request.
