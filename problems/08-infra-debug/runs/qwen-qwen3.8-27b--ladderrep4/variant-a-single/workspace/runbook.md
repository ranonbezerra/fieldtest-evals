# Runbook — verifying staging end-to-end through the jump host

Run top to bottom from a workstation that can reach `jump` over SSH.
Each step states what it should print. Stop at the first step that does
not match and follow its "if not" note.

ASSUMPTION: the resources live in the `default` namespace; add `-n <ns>`
to every kubectl command if your cluster differs.

ASSUMPTION: hostnames, pod names, IPs, and versions in the expected
outputs are patterns — match the *shape* and the key values (`ok`,
`Ready`, `1/1`, `2/2`, `200`, `DNS:localhost`), not the literal
placeholders.

## 0. Point at the kubeconfig

    export KUBECONFIG=$PWD/config/kubeconfig.yaml

Expected: no output.

    grep -c insecure-skip-tls-verify $KUBECONFIG

Expected: `0`. If it prints anything else, the kubeconfig has been
weakened — restore it; verification must stay on.

## 1. Bring up the tunnel (keep this terminal open)

    ssh -N -L 6443:10.0.0.5:6443 jump

Expected: no output; the session stays silently open. It must stay up
for the whole run.

In a second terminal, confirm the local forward is listening:

    nc -z 127.0.0.1 6443 && echo "6443 is open"

Expected: `6443 is open` (equivalent: `ss -ltn 'sport = :6443'` shows a
`LISTEN` line on `127.0.0.1:6443`).

If nothing listens, the SSH tunnel is not up — fix SSH access to `jump`
before continuing; nothing below can pass.

## 2. The certificate covers the tunnel hostname (Fault 1 check)

    openssl s_client -connect 127.0.0.1:6443 -servername localhost </dev/null 2>/dev/null \
      | openssl x509 -noout -ext subjectAltName

Expected:

    X509v3 Subject Alternative Name:
            IP Address:10.0.0.5, DNS:localhost

(`IP Address:10.0.0.5` is the pre-existing SAN the jump host relies on;
`DNS:localhost` is the one the reissue added.)

If `DNS:localhost` is absent, the certificate reissue has not landed —
stop and complete Fault 1 in `diagnosis.md`.

## 3. The API is reachable with full TLS verification

    kubectl get --raw /healthz

Expected:

    ok

    kubectl get nodes

Expected: a node table whose STATUS column says `Ready`, e.g.:

    NAME     STATUS   ROLES           AGE   VERSION
    ctl01    Ready    control-plane   34d   v1.29.3

Any `x509: ...` or TLS error here means step 2's condition is violated
(Fault 1), or the CA in this kubeconfig does not match the cluster.

## 4. The deployment is rolled out and the pods are Ready (Fault 3 check)

    kubectl get deployment api

Expected: `READY 2/2` and `AVAILABLE 2`.

    kubectl get pods -l app=api -o wide

Expected: one row per replica, each `READY 1/1`, `STATUS Running`,
`RESTARTS 0`.

    kubectl rollout status deployment/api --timeout=90s

Expected:

    deployment "api" successfully rolled out

If not: `kubectl describe pod <pod>`. A `Readiness probe failed` line
mentioning port `8080` means the probe-port fix (Fault 3) is not
applied; a pod that restarts in a loop is a different problem and stops
this runbook.

## 5. The Service has endpoints (Fault 2 check)

    kubectl get endpoints api

Expected: one `podIP:3000` per ready pod, e.g.:

    NAME   ENDPOINTS                          AGE
    api    10.244.0.9:3000,10.244.1.17:3000   12d

If `ENDPOINTS` is `<none>`: the selector (Fault 2) or the readiness
(Fault 3) is still broken — check both before moving on.

## 6. In-cluster request through the Service — the frontend's path

    kubectl run rb-curl --rm -i --restart=Never \
      --image=curlimages/curl:8.4.0 \
      -- curl -sS -o /dev/null -w 'HTTP %{http_code}\n' http://api:3000/health

Expected:

    HTTP 200

(Use any curl image the cluster can pull.) `connection refused` here
means step 5's condition is violated.

## 7. End-to-end request through the Ingress

    kubectl get ingress api -o wide

Expected: non-empty `HOSTS` and `ADDRESS`, e.g.:

    NAME   CLASS   HOSTS               ADDRESS     PORTS   AGE
    api    nginx   api.staging.example 10.0.0.20   80      34d

Use the two values printed for your cluster:

    curl -sS -o /dev/null -w 'HTTP %{http_code}\n' \
      -H 'Host: api.staging.example' http://10.0.0.20/health

Expected:

    HTTP 200

## 8. Regression: the jump-host path is unchanged

The reissue only *added* a SAN, so the jump host's kubeconfig (server
`https://10.0.0.5:6443`) must still verify:

    ssh jump 'kubectl get nodes'

Expected: the same node table as step 3, all `Ready`.

If it now fails with an x509 error, the reissue dropped a pre-existing
SAN — restore the full SAN list (Fault 1 procedure, step 1 keeps every
existing entry).

## 9. Summary

    kubectl get deployment api
    kubectl get service api
    kubectl get endpoints api

Expected together: `2/2` ready · port `3000` → targetPort `3000` ·
endpoints listing every pod IP with `:3000`.

**Verdict:** if steps 1–8 all printed their expected output, staging is
healthy end-to-end: tunnel up → certificate verified for `localhost` →
API answering → pods Ready → Service endpoints populated → in-cluster
request `200` → Ingress request `200` → jump-host access unregressed.

Failure map:

| Step fails | Meaning |
|---|---|
| 1 | SSH/tunnel problem, not a cluster fault |
| 2 | Fault 1 reissue not done |
| 3 | Fault 1 (or CA mismatch in this kubeconfig) |
| 4 | Fault 3 (probe port) |
| 5 | Fault 2 and/or Fault 3 |
| 6 | Fault 2 and/or Fault 3 |
| 7 | Ingress-specific; out of scope of the three faults — check its rules/annotations |
| 8 | Reissue dropped an existing SAN — restore the full SAN list |
