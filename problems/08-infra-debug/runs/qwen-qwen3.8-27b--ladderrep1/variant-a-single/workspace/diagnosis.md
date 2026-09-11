# Diagnosis — staging behind the jump host

Four symptoms were reported; they are **three faults**. Symptoms 1 and 2 are one
fault, and symptom 3 is produced by **two** faults at once. Anyone counting four
independent problems will fix three things, ship, and still see connection
refused.

## Symptom → fault map

| # | Symptom | Fault(s) |
|---|---------|----------|
| 1 | `kubectl get pods` through the tunnel fails with a TLS error naming the hostname | **F1** |
| 2 | The API works when the kubeconfig is exported on the jump host itself | **F1** |
| 3 | The `api` Deployment shows `Running`, but the frontend gets connection refused through the `api` Service | **F2 + F3** |
| 4 | CI flags `api` rollouts "unhealthy" and rolls them back, while the app logs show it serving seconds later | **F3** |

## F1 — the API server certificate does not cover `localhost`

Workstations reach the API through `ssh -L 6443:10.0.0.5:6443 jump`, so the
client dials `https://localhost:6443`. TLS verification matches the name in that
URL against the certificate's SANs. The certificate carries the control plane's
identity — its address `10.0.0.5` and the `kubernetes` service names — but not
`localhost`, so the handshake aborts on the name.

**Symptom 1.** From the workstation, tunnel up:

```sh
kubectl -n staging get pods
# The server could not set up a secure connection to https://localhost:6443:
# tls: failed to verify certificate: x509: certificate is valid for
# kubernetes, kubernetes.default, kubernetes.default.svc, 10.0.0.5, not localhost
```

The decisive evidence is the SAN list of the certificate actually served on the
tunneled port:

```sh
echo | openssl s_client -connect localhost:6443 -servername localhost 2>/dev/null \
  | openssl x509 -noout -ext subjectAltName
# X509v3 Subject Alternative Name:
#     DNS:kubernetes, DNS:kubernetes.default, DNS:kubernetes.default.svc, IP Address:10.0.0.5
```

`localhost` is absent — that is the fault, isolated from everything else. (Any
TLS client on the workstation, e.g. `curl`, fails the same way with a
hostname-mismatch SSL error.)

**Symptom 2.** On the jump host the exported kubeconfig's `server` entry points
at the control-plane address the certificate *does* cover, so the same
credentials verify fine there:

```sh
ssh jump
grep 'server:' ~/staging/kubeconfig
# server: https://10.0.0.5:6443
KUBECONFIG=~/staging/kubeconfig kubectl get pods -n staging   # works
```

**Symptoms 1 and 2 are this single fault** — one certificate, two vantage
points. Treating them as two problems leads to "fixing" the kubeconfig instead
of the certificate.

**Fix.** Reissue the API server certificate with `DNS:localhost` added to the
SANs, keeping every existing SAN (the jump-host path must keep working). This
is a server-side change on the control plane; the exact procedure is in
`runbook.md`, step 2.

Why the alternatives are wrong:

- Pointing `server` at `https://10.0.0.5:6443` fixes the name and breaks the
  connection — `10.0.0.5` is not routable from workstations, which is exactly
  why the jump host and the tunnel exist.
- kubectl has no supported "verify as a different name" option, and
  `insecure-skip-tls-verify` (or anything equivalent) is out of scope.
- `kubeadm certs renew apiserver` re-signs with the control plane's identity
  only; the SAN list has to be extended by hand, which is why the runbook shows
  the manual re-sign.

The kubeconfig itself is **unchanged**: once the certificate covers
`localhost`, `server: https://localhost:6443` is already correct.

## F2 — the Service selects pods the Deployment never labels

`manifests/api-service.yaml` selects `app: api-server`;
`manifests/api-deployment.yaml` labels its pods `app: api`. No pod matches, so
the Service has no endpoints, and kube-proxy refuses every connection to its
ClusterIP.

**Symptom 3, first cause.** The container is healthy — the refusal happens at
the Service layer, before any pod is even selected:

```sh
kubectl -n staging get svc api -o jsonpath='{.spec.selector}'
# {"app":"api-server"}

kubectl -n staging get pods -l app=api
# NAME   READY   STATUS    RESTARTS   AGE    <- pods exist and run

kubectl -n staging get endpoints api
# NAME   ENDPOINTS   AGE
# api    <none>      5d

kubectl -n staging exec deploy/frontend -- curl -sv http://api:80/ 2>&1 | tail -1
# curl: (7) Failed to connect to api port 80: Connection refused
```

**Fix.** One line in `manifests/api-service.yaml`: selector `app: api-server`
→ `app: api`, matching the labels the Deployment already ships. (Aligning the
Deployment's labels to the Service instead would force a full pod churn for
the same result.)

## F3 — the readiness probe targets a port the app does not listen on

The probe hits `/health` on port **8080**; the container listens on **3000**.
The probe can never succeed, so every pod stays `0/1` ready for its whole
life.

**Symptom 4.** CI gates on rollout readiness (`kubectl rollout status`), which
never completes, so it declares the rollout unhealthy and rolls back — while
the app has been serving on 3000 the entire time, as its logs show:

```sh
kubectl -n staging get pods -l app=api
# NAME   READY   STATUS    RESTARTS   AGE
# api-...  0/1    Running   0          4m     <- Running, but never Ready

kubectl -n staging describe pod api-... | grep -A1 Unhealthy
# Warning  Unhealthy  ...  Readiness probe failed:
#   Get "http://10.42.x.x:8080/health": dial tcp 10.42.x.x:8080: connect: connection refused

kubectl -n staging exec api-... -- curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/health
# 200    <- the app answers on 3000 (use whatever HTTP client the image ships)
```

**Symptom 3, second cause.** Kubernetes excludes pods that are not Ready from
a Service's endpoint list *regardless of labels*. So even with F2 fixed,
`ENDPOINTS` stays `<none>` until the probe can pass. **Fixing the selector
alone does not clear the connection-refused symptom** — both F2 and F3 must
land.

**Fix.** One line in `manifests/api-deployment.yaml`: readiness probe
`port: 8080` → `port: 3000`.

## What changed, where

| Artefact | Change | Fault |
|----------|--------|-------|
| `manifests/api-service.yaml` | selector `app: api-server` → `app: api` | F2 |
| `manifests/api-deployment.yaml` | readinessProbe port `8080` → `3000` | F3 |
| API server certificate (control plane) | reissued with `DNS:localhost` added, all existing SANs kept | F1 |
| kubeconfig | **unchanged** — no `insecure-skip-tls-verify`; `server` stays `https://localhost:6443` | — |
| Ingress | reviewed; no fault; unchanged | — |

Ordering: certificate reissue first (runbook step 2), then the Deployment fix,
then the Service selector — once the probe passes, the corrected selector
immediately produces endpoints. Verify top to bottom with `runbook.md`.
