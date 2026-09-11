# Staging health runbook — from tunnel up to an end-to-end request

Run the steps in order, top to bottom, from a workstation with SSH access to
`jump` and the staging kubeconfig. Every step must exit 0 and match its
expected output; stop at the first step that does not and use the failure
table at the end.

Precondition: the Fault-1 certificate reissue has been performed on the
control plane (diagnosis.md, Fault 1). Step 0 checks for it.

**Step 0 — the reissued certificate covers the tunnel name** (control plane,
via the jump host; do once)

      ssh jump
      openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -ext subjectAltName

    # ASSUMPTION: /etc/kubernetes/pki/apiserver.crt is the kubeadm default path; the original extra SAN entries vary by cluster.

Expected: one `Subject Alternative Name` line containing the original
control-plane entries **and** the two new ones:

      X509v3 Subject Alternative Name:
          IP Address:10.0.0.5, DNS:kubernetes, DNS:kubernetes.default, DNS:kubernetes.default.svc, DNS:localhost, IP Address:127.0.0.1

Pass if `DNS:localhost` is present. Fail → the reissue has not landed (or the
API server still serves the old certificate); do not continue — every kubectl
step will die on the name check.

      exit    # back to the workstation

**Step 1 — bring up the tunnel**

      ssh -N -L 6443:10.0.0.5:6443 jump

Expected: no output; the session stays open. In a second shell, confirm the
listener:

      ss -ltn | grep 6443

Expected:

      LISTEN  0  128  127.0.0.1:6443  0.0.0.0:*

If the port is already taken by a stale session, `pkill -f "ssh -N -L 6443"`
and re-run this step.

**Step 2 — point the shell at the kubeconfig and confirm TLS verification is on**

      export KUBECONFIG=$HOME/kubeconfig    # adjust the path; this is the staging kubeconfig
      kubectl config current-context
      kubectl config view --minify

Expected:
- `kubectl config current-context` → `staging`
- `kubectl config view --minify` → the cluster block shows
  `server: https://localhost:6443` and a `certificate-authority-data` field,
  and **no TLS skip-verify flag anywhere** in the output. If a skip-verify
  flag appears, stop: the kubeconfig is wrong.

**Step 3 — the API answers through the tunnel with verified TLS**

      kubectl get --raw /readyz

Expected:

      ok

A `certificate is valid for 10.0.0.5, not localhost` error here = Fault 1 not
fixed (back to Step 0). `connection refused` = tunnel down (back to Step 1).

**Step 4 — the pods are Running *and* Ready**

      kubectl get pods -n staging -l app=api

Expected (READY must be `1/1` on every pod — `0/1` means the readiness probe
is still failing):

      NAME                  READY   STATUS    RESTARTS   AGE
      api-7d9c8b6f5-2x4kp   1/1     Running   0          4m
      api-7d9c8b6f5-9mq7z   1/1     Running   0          4m

**Step 5 — the rollout is healthy (the signal CI reads)**

      kubectl rollout status deployment/api -n staging

Expected:

      deployment "api" successfully rolled out

**Step 6 — the Service has endpoints**

      kubectl get endpoints api -n staging
      kubectl get svc api -n staging

Expected:

      NAME   ENDPOINTS                        AGE
      api    10.244.1.12:3000,10.244.2.9:3000  4m

      NAME   TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)   AGE
      api    ClusterIP   10.96.37.22    <none>        80/TCP    6d

ENDPOINTS must list the pod IPs on port `3000`. `<none>` means the selector
still misses (Fault 2) or the pods are not Ready (Fault 3).

**Step 7 — a request through the Service (the frontend path)**

      kubectl run curl-check -n staging --rm -it --restart=Never --image=curlimages/curl:8.5.0 \
        -- curl -sS -o /dev/null -w '%{http_code}\n' http://api:80/health

Expected:

      200

One-shot pod, removed automatically. A non-200 here points at the app's
`/health` route, not at the Service.

**Step 8 — a request through the Ingress (end to end)**

      INGRESS_HOST=api.staging.internal
      INGRESS_SVC_IP=$(kubectl -n ingress-nginx get svc ingress-nginx-controller -o jsonpath='{.spec.clusterIP}')
      kubectl run curl-check -n staging --rm -it --restart=Never --image=curlimages/curl:8.5.0 \
        -- curl -sS -o /dev/null -w '%{http_code}\n' -H "Host: $INGRESS_HOST" "http://$INGRESS_SVC_IP/health"

    # ASSUMPTION: ingress-nginx namespace and controller service name; the Ingress host matches manifests/api-ingress.yaml.

      kubectl get ingress api -n staging

Expected:
- the curl prints `200`
- `kubectl get ingress` shows a populated HOSTS and ADDRESS:

      NAME   CLASS   HOSTS                    ADDRESS        PORTS   AGE
      api    nginx   api.staging.internal   10.96.10.5     80      2d

Empty ADDRESS = no ingress controller is installed.

**Step 9 — done**

      exit    # closes the tunnel

If Steps 0–8 all matched their expected output, staging is healthy: TLS
verifies through the tunnel, the rollout is green, and a real request reaches
the app through both the Service and the Ingress.

## If a step fails

| Failing step | What it looks like | Suspect |
|---|---|---|
| 0 | `DNS:localhost` missing from the SANs | Reissue not performed, or the API server still serves the old certificate |
| 3 | `x509: certificate is valid for 10.0.0.5, not localhost` | Fault 1 — certificate not reissued, or tunnel retargeted |
| 3 | `connection refused` | Tunnel down or not bound to `6443` (Step 1) |
| 4 | READY `0/1` | Fault 3 — probe still on `8080`, or the app not listening on `3000` |
| 5 | `timed out waiting for the condition` | Rollout not progressing — check Steps 4 and 6 |
| 6 | ENDPOINTS `<none>` | Fault 2 (selector) or Fault 3 (pods not Ready) |
| 7 | non-200 or connection error | App `/health` route, or the Service port mapping |
| 8 | non-200 | Ingress host/path/backend, or missing ingress controller |
