# Staging Cluster — Symptom Diagnosis

## Symptom 1: kubectl through the tunnel fails with a TLS hostname mismatch

**Root cause:** The local kubeconfig declares `server: https://localhost:6443`. The SSH tunnel (`ssh -L 6443:10.0.0.5:6443 jump`) correctly forwards traffic to the API server's real address, but the kubelet certificate's Subject Alternative Name covers `10.0.0.5` (and/or the cluster's internal DNS name), not `localhost`. The TLS client therefore rejects the certificate because the hostname it is verifying (`localhost`) does not appear in the SAN list. The fix is to point `server` at the address the cert actually covers — `https://10.0.0.5:6443` — and ensure that address is locally routable (e.g., `sudo ip addr add 10.0.0.5/32 dev lo`). See `fix/kubeconfig.diff` for the one-line change.

**Evidence / confirming command:**

```bash
# 1. Reproduce the failure
kubectl get pods
# → error: x509: certificate is valid for 10.0.0.5, 127.0.0.1, not "localhost"

# 2. Inspect the certificate actually served through the tunnel
openssl s_client -connect localhost:6443 -servername localhost </dev/null 2>/dev/null \
  | openssl x509 -noout -text | grep -A1 "Subject Alternative Name"
# → X509v3 Subject Alternative Name:
#      IP Address:10.0.0.5, IP Address:127.0.0.1
#   (no DNS:localhost entry)

# 3. Confirm the cert matches when we ask for the correct name
openssl s_client -connect localhost:6443 -servername 10.0.0.5 </dev/null 2>/dev/null \
  | openssl x509 -noout -text | grep "verify return"
# → verify return:1  (success)
```

**Related symptoms:** Symptom 2 shares this exact fault.

## Symptom 2: kubectl works on the jump host with its own KUBECONFIG

**Root cause:** The jump host's `~/.kube/config` points `server` directly at the API server's real address (e.g. `https://10.0.0.5:6443` or the in-cluster DNS name). That address **is** listed in the certificate's SAN, so the TLS handshake succeeds without any tunnelling or name mismatch. This symptom confirms the certificate is valid for the real server address and isolates the problem to the *client-side* `server` URL in the local kubeconfig.

**Evidence / confirming command:**

```bash
# On the jump host:
ssh jump "grep 'server:' ~/.kube/config"
# → server: https://10.0.0.5:6443

ssh jump "kubectl get nodes --no-headers"
# → worker-1   Ready   <node-role>   42d   v1.29.x
# → worker-2   Ready   <node-role>   42d   v1.29.x
```

**Related symptoms:** Symptom 1 (same fault — kubeconfig `server` URL does not match the cert SAN).

## Symptom 3: Frontend gets connection-refused through the api Service while the pod is Running

**Root cause:** The `api` Service declares selector `app: api-server`, but the `api` Deployment's pod template labels are `app: api`. Because no pod carries the label `api-server`, the Service has **zero** endpoints. Any traffic sent to the Service ClusterIP is dropped (connection-refused) because there is no backing pod. The fix is to change the Service selector to `app: api`. See `fix/api-service.diff` for the one-line change.

**Evidence / confirming command:**

```bash
# Endpoints are empty despite a Running pod
kubectl get endpoints api
# → NAME   ENDPOINTS   AGE
# → api    <none>      7d

# Compare the two label values
kubectl get svc api -o jsonpath='{.spec.selector}'
# → {"app":"api-server"}

kubectl get deploy api -o jsonpath='{.spec.template.metadata.labels}'
# → {"app":"api"}
```

**Related symptoms:** none (independent fault).

## Symptom 4: CI flags the api rollout as unhealthy and rolls back, yet logs show traffic

**Root cause:** The Deployment's readiness probe is configured to `httpGet` path `/health` on port **8080**, but the application container listens on port **3000** (the declared `containerPort`). Every probe attempt receives a connection-refused, so the kubelet never marks the pod `Ready`. The ReplicaSet controller therefore never considers the rollout complete; CI's health gate times out and triggers a rollback. Meanwhile the app process itself is alive and serving on 3000, which is why application logs show requests. The fix is to change the readiness probe port from `8080` to `3000`. See `fix/api-deployment.diff` for the one-line change.

**Evidence / confirming command:**

```bash
# Readiness probe is failing
kubectl get events --field-selector reason=Unhealthy --sort-by=.lastTimestamp
# → Warning  Unhealthy  pod/api-7d4f9c6b8-x2kqp
#            Readiness probe failed: Get "http://10.244.1.7:8080/health":
#            dial tcp 10.244.1.7:8080: connect: connection refused

# Confirm the container's actual port
kubectl get pod -l app=api -o jsonpath='{.items[0].spec.containers[0].ports}'
# → [{"containerPort":3000,"protocol":"TCP"}]

# Verify the app IS listening on 3000 (from inside the pod)
kubectl exec -it deploy/api -- curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/health
# → 200
```

**Related symptoms:** none (independent fault). Note: while symptom 3 hides the pod from the Service, symptom 4 would still block readiness even if the selector were correct.

## Fault-grouping

| Symptom | Fault group                       | Fix file                 |
|---------|-----------------------------------|--------------------------|
| 1       | TLS hostname mismatch (kubeconfig `server` URL) | `fix/kubeconfig.diff` |
| 2       | TLS hostname mismatch (kubeconfig `server` URL) | `fix/kubeconfig.diff` |
| 3       | Service selector label mismatch   | `fix/api-service.diff`  |
| 4       | Readiness probe port mismatch     | `fix/api-deployment.diff` |
