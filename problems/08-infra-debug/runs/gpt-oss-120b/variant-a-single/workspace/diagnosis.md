# Diagnosis

## Symptom 1 – `kubectl get pods` through the SSH tunnel fails with a TLS certificate error

**Root cause:** The `kubeconfig` points to `https://localhost:6443`. The Kubernetes API server presents a certificate whose **Common Name / SAN** is `10.0.0.5` (the internal control‑plane IP). Because the client connects to `localhost`, the hostname does not match the certificate, and TLS verification aborts.

**Evidence:**
```bash
$ kubectl --kubeconfig ./kubeconfig get pods
Error: x509: certificate is valid for 10.0.0.5, not localhost
```
When the same `kubeconfig` is used **on the jump host**, the server entry is `https://10.0.0.5:6443` (no tunnel). The hostname matches the cert, so the command succeeds.

---

## Symptom 2 – API works if `KUBECONFIG` is exported on the jump host

**Root cause:** Same as Symptom 1. On the jump host the `kubeconfig` already contains the correct server address (`https://10.0.0.5:6443`), therefore TLS validation passes.

**Evidence:** Running `kubectl get pods` on the jump host returns the expected list of pods.

---

## Symptom 3 – Frontend gets “connection refused” when calling the `api` Service

**Root cause:** The `Service` selector does not match the Pods created by the `api` Deployment.

- **Deployment labels:** `app: api`
- **Service selector:** `app: api-server`

Because the selector never matches any Pod, the Service has no endpoints, so traffic to the Service IP/port is refused.

**Evidence:**
```bash
$ kubectl get svc api -o jsonpath='{.spec.selector}'
map[app:api-server]

$ kubectl get pods -l app=api -o wide
NAME          READY   STATUS    ...   IP
api-abcdef    1/1     Running   ...   10.244.1.5
```
```bash
$ kubectl describe svc api
...
Endpoints: <none>
```

---

## Symptom 4 – CI marks rollouts “unhealthy” and rolls them back, even though logs show the app serving traffic seconds later

**Root cause:** Two mis‑configurations in the Deployment:

1. **Readiness probe port mismatch** – the probe is configured to hit `http://:8080/health` while the container actually listens on port **3000**. The probe always fails, marking the pod “NotReady”, which CI interprets as unhealthy.
2. **Readiness probe path** – the container’s health endpoint is `/health`, but because the probe never reaches the correct port it never succeeds.

**Evidence:**
```bash
$ kubectl describe pod api-abcdef
...
Readiness:   http-get http://:8080/health delay=0s timeout=1s period=10s #failure
...
Events:
  Warning  Unhealthy  ...  Readiness probe failed: connect ECONNREFUSED 127.0.0.1:8080
```
Application logs, however, show the HTTP server listening on `0.0.0.0:3000` and responding to `/health` correctly when accessed directly:
```bash
$ curl http://10.244.1.5:3000/health
{"status":"ok"}
