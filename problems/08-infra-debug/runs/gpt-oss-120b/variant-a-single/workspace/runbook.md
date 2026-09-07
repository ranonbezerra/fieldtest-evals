# Runbook – Verification Steps for the Fixed Staging Cluster

Below are the ordered commands you should run **after** applying the corrected manifests
and updating the kubeconfig. Each command includes the *expected* output when the
system is healthy.

---

## 1. Establish the SSH tunnel

```bash
ssh -L 6443:10.0.0.5:6443 jump -N &
```

**Expected result:** No output; the command runs in the background.  
Verify the tunnel is listening:

```bash
$ lsof -iTCP:6443 -sTCP:LISTEN
COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
ssh      1234 user    6u  IPv4  0x...      0t0  TCP 127.0.0.1:6443 (LISTEN)
```

---

## 2. Test the kubeconfig TLS handshake

```bash
KUBECONFIG=./kubeconfig kubectl version --short
```

**Expected output (no TLS errors):**
```
Client Version: v1.28.0
Server Version: v1.28.0
```

If the server certificate is still mismatched, the error will mention the hostname
(`localhost`). In that case re‑check the `server` field in `kubeconfig`.

---

## 3. List Pods – sanity check

```bash
KUBECONFIG=./kubeconfig kubectl get pods -n api
```

**Expected output (example):**
```
NAME                     READY   STATUS    RESTARTS   AGE
api-5d7f9c9f8b-2xkzv     1/1     Running   0          2m
```

All pods should be in `Running` with `READY` column showing `1/1`.

---

## 4. Verify Service endpoints

```bash
KUBECONFIG=./kubeconfig kubectl get svc api -o jsonpath='{.spec.selector}'
```

**Expected output:**
```
map[app:api]
```

```bash
KUBECONFIG=./kubeconfig kubectl get endpoints api
```

**Expected output (example):**
```
NAME   ENDPOINTS          AGE
api    10.244.1.5:3000    1m
```

The presence of an endpoint proves the selector now matches the pods.

---

## 5. Test the readiness probe manually

```bash
POD_IP=$(kubectl get pod -l app=api -o jsonpath='{.items[0].status.podIP}')
curl http://$POD_IP:3000/health
```

**Expected output:**
```json
{"status":"ok"}
```

If you receive a connection error, the container is not listening on the expected port.

---

## 6. Confirm the pod is `Ready`

```bash
KUBECONFIG=./kubeconfig kubectl get pod -l app=api -o wide
```

**Expected output (Ready column):**
```
NAME            READY   STATUS    RESTARTS   AGE   IP           NODE
api-5d7f9c9f8b-2xkzv   1/1     Running   0          2m    10.244.1.5   worker-1
```

The `READY` column should show `1/1`, indicating the readiness probe succeeded.

---

## 7. Verify Ingress routes to the API

```bash
curl -k https://staging.example.com/api/health
```

*(Replace `staging.example.com` with the actual host used in the Ingress.)*

**Expected output:**
```json
{"status":"ok"}
```

A `200 OK` response confirms the Ingress correctly forwards traffic to the Service,
which now has healthy endpoints.

---

## 8. CI health check (optional)

Trigger the CI pipeline or run the health‑check script used by CI:

```bash
./scripts/ci-health-check.sh
