# Staging Cluster — Verification Runbook

Execute every step in order. If a step's expected output is not met, **stop** and
consult the referenced section in `diagnosis.md` before continuing.

---

## Step 1: Add local IP alias for the cluster API address

The kubeconfig (post-fix) points at `https://10.0.0.5:6443`. That address must be
locally routable so the SSH tunnel can bind to it.

```bash
sudo ip addr add 10.0.0.5/32 dev lo
ip addr show lo | grep '10.0.0.5'
```

**Expected**

```
inet 10.0.0.5/32 scope global lo
```

If the address is already present you will see a "RTNETLINK answers: File exists"
warning; that is fine — proceed. If the `ip` command is unavailable, note that and
skip (the address may already exist in your environment).

---

## Step 2: Establish the SSH tunnel

```bash
ssh -N -L 6443:10.0.0.5:6443 jump &
# Wait for the local port to come up (up to 10 s)
for i in $(seq 1 20); do nc -z 10.0.0.5 6443 && break; sleep 0.5; done
nc -z 10.0.0.5 6443 && echo "TUNNEL OK"
```

**Expected**

```
TUNNEL OK
```

If `nc` reports "Connection refused" after the retry loop, the tunnel did not
establish. **Stop** — verify SSH access to `jump` and that port 6443 is open on
`10.0.0.5` from the jump host (`ssh jump "nc -z 10.0.0.5 6443"`).

---

## Step 3: TLS handshake against the post-fix server URL

```bash
curl -sk https://10.0.0.5:6443/version
```

**Expected**

A JSON body containing a `"gitVersion"` field, e.g.:

```json
{
  "major": "1",
  "minor": "29",
  "gitVersion": "v1.29.4",
  ...
}
```

If you see an `x509: certificate is valid for …, not "10.0.0.5"` error, the
certificate SAN does not cover this address. **Stop** — see `diagnosis.md`,
Symptom 1. A SAN reissue or a different server name is required.

---

## Step 4: kubectl authenticates through the tunnel (full TLS verification)

```bash
kubectl get nodes
```

**Expected**

A table of nodes, each with status `Ready`:

```
NAME       STATUS   ROLES    AGE   VERSION
worker-1   Ready    <none>   42d   v1.29.4
worker-2   Ready    <none>   42d   v1.29.4
```

If kubectl reports a TLS or certificate error, **stop** — see `diagnosis.md`,
Symptom 1 / Symptom 2. Confirm your kubeconfig `server` field reads
`https://10.0.0.5:6443` (apply `fix/kubeconfig.diff` if it does not).

---

## Step 5: Pod is Ready (readiness probe on port 3000)

```bash
kubectl get pods -l app=api
```

**Expected**

```
NAME                       READY   STATUS    RESTARTS   AGE
api-7d4f9c6b8-x2kqp        1/1     Running   0          5m
```

Verify the probe is hitting the correct port:

```bash
kubectl get pod -l app=api -o jsonpath='{.items[0].spec.containers[0].readinessProbe}'
```

**Expected**

The JSON includes `"port":3000` (not 8080).

If `READY` shows `0/1` or the event stream shows
`Readiness probe failed: … connect: connection refused` on port 8080, **stop** —
see `diagnosis.md`, Symptom 4. Apply `fix/api-deployment.diff` and re-roll.

---

## Step 6: Service has endpoints

```bash
kubectl get endpoints api
```

**Expected**

A non-empty ENDPOINTS column containing the pod's IP:

```
NAME   ENDPOINTS            AGE
api    10.244.1.7:3000      7d
```

Cross-check the label match:

```bash
kubectl get svc api -o jsonpath='{.spec.selector}'
kubectl get pod -l app=api -o jsonpath='{.items[0].metadata.labels}'
```

**Expected**

Both output `{"app":"api"}`.

If ENDPOINTS shows `<none>`, **stop** — see `diagnosis.md`, Symptom 3. The Service
selector does not match any pod label. Apply `fix/api-service.diff` and re-apply.

---

## Step 7: End-to-end request through the Ingress

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<ingress-host>/health
```

**Expected**

```
200
```

Verify the response body:

```bash
curl -s http://<ingress-host>/health
```

**Expected**

A 200 JSON payload from the api container, e.g. `{"status":"ok"}`.

If you receive `503 Service Unavailable` or a connection-refused error, the
Ingress controller cannot reach the Service. **Stop** — re-check Step 6 (endpoints
populated?) and confirm the Ingress `backend.service.name` is `api` and
`backend.service.port` is `80` (the Service's published port). See
`diagnosis.md`, Symptom 3.

---

## Cleanup (optional)

```bash
# Remove the local IP alias when you are done with the cluster session
sudo ip addr del 10.0.0.5/32 dev lo

# Kill the background tunnel
kill %1
