# Diagnosis — staging behind the jump host

Four reported symptoms; **three faults**. Fault 1 (F1) produces two of the
symptoms (S1, S2). Fault 3 (F3) produces two (all of S4, and half of S3).
A reader who counts four independent problems will fix three things and
still have S3 broken.

| # | Symptom | Fault |
|---|---------|-------|
| S1 | `kubectl get pods` through the tunnel fails with a TLS error naming the hostname | **F1** |
| S2 | the same kubeconfig works when exported on the jump host | **F1** (same fault, opposite evidence) |
| S3 | `api` pods show `Running`, yet the frontend gets connection refused through the `api` Service | **F2 + F3** |
| S4 | CI flags `api` rollouts unhealthy and rolls back, while app logs show serving | **F3** |

## Fault 1 — the API-server certificate does not cover `localhost`

**Symptoms: S1 and S2.** Both are one fault: a TLS *name* verification
failure. Nothing is wrong with the cluster, the CA, or the client
credentials.

The tunnel is `ssh -L 6443:10.0.0.5:6443 jump`, so from a workstation the
client talks to `https://localhost:6443`. TLS verification then checks the
name `localhost` against the kube-apiserver certificate's SANs. The
certificate covers the control-plane address `10.0.0.5` (an IP SAN) but
not `localhost`, so the handshake aborts on the name. On the jump host the
kubeconfig's server entry is `https://10.0.0.5:6443` — the exact name the
certificate covers — which is why the same cluster is reachable there.
The two symptoms are the same mismatch seen from two sides.

**Confirming evidence**

Workstation, tunnel up (before the fix):

    kubectl get pods

    Unable to connect to the server: x509: certificate is valid for 10.0.0.5, not localhost

Same view, inspecting the certificate through the tunnel:

    openssl s_client -connect 127.0.0.1:6443 -servername localhost </dev/null 2>/dev/null \
      | openssl x509 -noout -ext subjectAltName

    X509v3 Subject Alternative Name:
            IP Address:10.0.0.5

No `localhost` in the list — the name the client presents is not covered.

Jump host (why S2 happens):

    ssh jump 'grep -n "server:" ~/.kubeconfig'

    server: https://10.0.0.5:6443

    kubectl get nodes        # on the jump host, with its own kubeconfig

    NAME     STATUS   ROLES           AGE   VERSION
    ctl01    Ready    control-plane   34d   v1.29.3

The jump-host server entry names exactly the address the certificate
covers, so verification succeeds there.

**Fix (chosen): reissue the serving certificate with `DNS:localhost`
among its SANs.** This is a server-side change, performed on the control
plane via the jump host. The existing SANs — including `IP:10.0.0.5` —
are *kept*, so the jump-host kubeconfig keeps working unchanged, and the
tunnel keeps working: the client still connects to `localhost:6443` and
the name it verifies is now covered.

The kubeconfig itself gets **no diff**: `server: https://localhost:6443`
is the correct entry for a workstation; only the certificate was wrong.

Rejected alternatives, explicitly:

- `insecure-skip-tls-verify` (or `insecureSkipTLSVerify: true`): not
  acceptable; it disables verification instead of fixing the name.
- Pointing `server:` at `https://10.0.0.5:6443`: fixes the name, breaks
  the connection — `10.0.0.5` is not routable from a workstation, which
  is precisely why the tunnel exists.

**Procedure (kubeadm-managed control plane):**

1. Add `localhost` to the SAN list that drives the apiserver certificate:

        apiServer:
          certSANs:
            - 10.0.0.5
        +  - localhost

2. Regenerate and install the certificate on the control-plane node:

        kubeadm init phase certs apiserver
        systemctl stop kubelet
        cp /var/lib/kubelet/pki/apiserver.crt /etc/kubernetes/pki/kube-apiserver.crt
        cp /var/lib/kubelet/pki/apiserver.key /etc/kubernetes/pki/kube-apiserver.key
        systemctl start kubelet

   (Not kubeadm? Create a CSR with `CN=kube-apiserver, O=system:masters`
   and SANs `IP:10.0.0.5, DNS:localhost`, sign it with the cluster's
   `kubernetes` CA, install it as the serving certificate, and restart
   the API server.)

3. Verify — runbook step 2: the `openssl s_client` command above now
   lists `DNS:localhost`, and `kubectl get nodes` through the tunnel
   succeeds with full verification.

## Fault 2 — the Service selector matches no pods

**Symptom: S3 (together with F3).**

`api-service.yaml` selects `app: api-server`; the Deployment's pod
template labels its pods `app: api`. No pod matches, so the Service's
Endpoints set is empty. With no real server behind the Service IP,
kube-proxy has nothing to forward to and the kernel answers RST — the
frontend sees *connection refused* while every pod reports `Running`.

**Confirming evidence**

    kubectl get endpoints api

    NAME   ENDPOINTS   AGE
    api    <none>      12d

    kubectl get pods -l app=api --show-labels

    NAME                   READY   STATUS    RESTARTS   AGE   LABELS
    api-7c9d4b8f6-2m4xk    0/1     Running   0          6m   app=api

    kubectl get pods -l app=api-server

    No resources found in default namespace.

**Fix:** change the Service selector to the label the pods actually
carry. (Not the other way around: re-labelling the Deployment would also
require changing its own `selector.matchLabels` and would replace the
running pods; the Service is the derived object and the one that is
wrong.)

        spec:
          selector:
    -         app: api-server
    +         app: api

## Fault 3 — the readiness probe targets the wrong port

**Symptoms: S4, and the readiness half of S3.**

The probe hits `/health` on port **8080**; the container listens on
**3000**. The probe can never succeed, so no pod ever becomes `Ready`.
CI polls rollout readiness, times out, and rolls the deployment back —
while the app's own logs show it serving traffic, because on 3000 it is.

**Confirming evidence**

    kubectl get pods -l app=api

    NAME                   READY   STATUS    RESTARTS   AGE
    api-7c9d4b8f6-2m4xk    0/1     Running   0          6m
    api-7c9d4b8f6-9q1zn    0/1     Running   0          6m

    `Running` with `0/1` ready is the signature of a failing probe.

    kubectl describe pod api-7c9d4b8f6-2m4xk

    ...
    Readiness probe failed: Get "http://10.244.0.9:8080/health": dial tcp 10.244.0.9:8080: connect: connection refused
    ...
    Warning  Unready  ...  Readiness probe failed

    kubectl exec deploy/api -- wget -qO- http://127.0.0.1:3000/health

    HTTP/1.1 200 OK

    The app answers on 3000; nothing on the pod listens on 8080.

**Fix:**

            readinessProbe:
              httpGet:
                path: /health
    -               port: 8080
    +               port: 3000

## Why S3 needs two fixes

A pod appears in a Service's Endpoints set only if **(a)** the Service
selector matches its labels **and** **(b)** the pod is `Ready`. Fault 2
breaks (a); Fault 3 breaks (b).

- Fix the selector alone: endpoints stay empty (pods never become
  Ready) → still connection refused.
- Fix the probe alone: pods become Ready but are still not selected →
  still connection refused.
- Fix both: both pod IPs appear in the Endpoints set → traffic flows.

## What actually changed (three fixes, nothing else)

1. Server-side: `DNS:localhost` added to the kube-apiserver certificate
   SANs (Fault 1). No kubeconfig line changes; the tunnel is untouched.
2. `api-service.yaml`: selector `app: api-server` → `app: api` (Fault 2).
3. `api-deployment.yaml`: readiness probe port `8080` → `3000` (Fault 3).

The Ingress is not implicated by any reported symptom and is not part of
any of the three faults.
