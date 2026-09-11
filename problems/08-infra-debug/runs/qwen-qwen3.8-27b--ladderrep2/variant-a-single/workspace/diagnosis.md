# Diagnosis — staging cluster behind the jump host

Four symptoms were reported. They are **three faults**: one fault produced two of
the symptoms, and one symptom has two causes. The Ingress and the workstation
kubeconfig have no fault; the fixes are two one-line manifest changes and one
server-side certificate reissue.

## Symptom → fault map

| # | Reported symptom | Fault |
|---|---|---|
| 1 | `kubectl get pods` through the tunnel fails with a TLS error naming the hostname | **Fault 1** — shared with symptom 2 |
| 2 | The API works when the kubeconfig is used on the jump host itself | **Fault 1** — the same single fault as symptom 1 |
| 3 | Frontend gets connection refused through the `api` Service while the Deployment shows `Running` | **Fault 2 + Fault 3** — two causes |
| 4 | CI flags the `api` rollout "unhealthy" and rolls it back, though the app logs show it serving traffic | **Fault 3** |

A reader who counts four independent problems will make three fixes and be
surprised when two symptoms survive.

## Fault 1 — the API-server certificate does not cover `localhost`

**Root cause.** The tunnel `ssh -N -L 6443:10.0.0.5:6443 jump` re-presents the
control plane on loopback, so the kubeconfig's `server` is
`https://localhost:6443` and the TLS client verifies the certificate against the
name `localhost`. The certificate's SANs cover the control-plane address
`10.0.0.5` (plus the cluster's internal names) — not `localhost` — so
verification aborts on the name. The CA chain and the client certificate are
fine. On the jump host, the `server` entry in use is the control-plane address
itself, `https://10.0.0.5:6443`: the name the certificate covers, at an address
directly routable there. Same cluster, same certificate, different name —
**this is why symptoms 1 and 2 are one fault.**

**Confirming evidence** (in order):

**1. Reproduce the failure** (workstation, tunnel up):

      kubectl get pods -n staging

Expected (wording varies slightly by kubectl version; the diagnostic part is the
name mismatch):

      Error: the server could not set up a TLS connection to the host localhost:6443:
        tls: failed to verify certificate: x509: certificate is valid for 10.0.0.5, not localhost

The error names `localhost` — the client is checking the certificate against the
tunnel's hostname, not the control-plane address.

**2. Read the certificate's SANs** (control plane, via the jump host):

      ssh jump
      openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -ext subjectAltName

    # ASSUMPTION: /etc/kubernetes/pki/apiserver.crt is the kubeadm default path; the exact extra internal names vary by cluster.

Expected:

      X509v3 Subject Alternative Name:
          IP Address:10.0.0.5, DNS:kubernetes, DNS:kubernetes.default, DNS:kubernetes.default.svc

Two diagnostic facts, independent of the exact internal names:
`IP Address:10.0.0.5` is present, `DNS:localhost` is absent.

**3. Prove the name is the only variable.** On the jump host:

      export KUBECONFIG=/home/jump/.kube/config   # the jump host's staging kubeconfig
      kubectl get pods -n staging

succeeds — its `server` is `https://10.0.0.5:6443`, a name the certificate
covers. Same CA, same client certificate, same cluster; only the verified name
differs, and only the name check fails.

**Fix — reissue the certificate with the tunnel's hostname in its SANs
(server-side change).**

Two options are rejected, explicitly:
- `insecure-skip-tls-verify` (or anything equivalent) disables hostname **and**
  chain verification for every request. Not acceptable.
- Pointing `server` at `https://10.0.0.5:6443` fixes the name but `10.0.0.5` is
  not routable from a workstation — that is why the jump host exists. The
  tunnel must keep carrying the traffic.

Procedure, on the control plane (via the jump host):

**1.** In the cluster's kubeadm configuration, extend `apiServer.certSANs`
**without removing anything already listed**:

      - 10.0.0.5      # keep — the jump-host and in-cluster clients depend on it
      - localhost     # add — the tunnel's hostname
      - 127.0.0.1     # add — same tunnel, numeric form

**2.** Regenerate the API-server certificate with the **existing** cluster CA:

      sudo kubeadm init phase certs apiserver

**3.** Reload the API server so it serves the new certificate:

      sudo systemctl restart kubelet

**4.** Verify:

      openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -ext subjectAltName

The SAN line now contains `DNS:localhost` and `IP Address:127.0.0.1` **in
addition to** the original entries.

Because the new certificate is signed by the same CA, nothing changes on any
client: the workstation kubeconfig keeps `server: https://localhost:6443` with
full verification (it is therefore **unchanged** in this deliverable), and the
jump-host kubeconfig keeps working because the old SANs were retained.

## Fault 2 — the Service selector matches no pods

**Root cause.** `manifests/api-service.yaml` selects `app: api-server`; the
Deployment labels its pods `app: api`. The endpoint controller finds no pod
matching the selector, so the Service's endpoint list is empty and kube-proxy
has nothing to forward to: the frontend gets connection refused while the pods
sit `Running` (a selector mismatch does not affect pod state at all).

**Confirming evidence** (from any working kubeconfig — on the jump host until
Fault 1 lands):

      kubectl get svc api -n staging -o jsonpath='{.spec.selector}{"\n"}'
      # → {"app":"api-server"}

      kubectl get pods -n staging -l app=api --show-labels
      # → the api pods, each labelled app=api

      kubectl get pods -n staging -l app=api-server
      # → No resources found in staging namespace.

      kubectl get endpoints api -n staging
      # →
      # NAME   ENDPOINTS   AGE
      # api    <none>      6d

**Fix.** One line in `manifests/api-service.yaml`: `app: api-server` →
`app: api`. (Relabeling the Deployment instead would change its
`spec.selector.matchLabels`, forcing replacement of the whole ReplicaSet — a
bigger, riskier change for a fault that is simply a mistyped selector.)

## Fault 3 — the readiness probe targets the wrong port

**Root cause.** The `readinessProbe` in `manifests/api-deployment.yaml` hits
`/health` on port `8080`; the container listens on `3000`. Every probe attempt
is refused inside the pod, the pod never becomes Ready, the rollout never
completes, and CI — which reads the rollout status — declares it unhealthy and
rolls back. The application itself is healthy: it serves on `3000`, which is
exactly why the logs show traffic seconds after the "failure."

**Confirming evidence:**

      kubectl get pods -n staging -l app=api
      # → STATUS Running, but READY 0/1 — Running and never Ready

      kubectl describe pod -n staging <api-pod>
      # → Events:
      #   Warning  Unhealthy  readiness probe failed:
      #   Get "http://10.244.0.15:8080/health": dial tcp 10.244.0.15:8080: connect: connection refused
      #   (the refused port is 8080 — the probe's target, not the app's)

      kubectl logs -n staging <api-pod>
      # → the app listening on :3000 and serving requests

      kubectl rollout status deployment/api -n staging
      # → Waiting for deployment "api" rollout to finish: 0 of 2 updated replicas are available;
      #   error: timed out waiting for the condition
      #   — the exact signal CI acts on

**Interaction with Fault 2.** A pod that never becomes Ready is excluded from
the Service's endpoint list regardless of labels. So while Fault 3 stands,
symptom 3 (connection refused) survives even after the selector is fixed.
**Both faults must be cleared before the Service has any endpoints.**

**Fix.** One line in `manifests/api-deployment.yaml`:
`readinessProbe.httpGet.port` `8080` → `3000`.

## What changes where

| Fault | Change | Where |
|---|---|---|
| 1 | Reissue the API-server certificate: add `localhost` and `127.0.0.1` to the SANs, keep every original SAN, sign with the existing CA | Server-side, on the control plane (procedure in Fault 1) |
| 1 | Kubeconfig | **Unchanged** — `server: https://localhost:6443`, CA pinned, full verification |
| 2 | Service selector `app: api-server` → `app: api` | `manifests/api-service.yaml` |
| 3 | Readiness probe port `8080` → `3000` | `manifests/api-deployment.yaml` |
| — | Ingress | **Unchanged** — no fault |

Verify the result end to end with `runbook.md`.
