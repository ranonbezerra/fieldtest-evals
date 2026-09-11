# Runbook — staging end-to-end verification

Run top to bottom from a workstation that can reach the jump host. Namespace
`staging` is assumed in every command; substitute yours if different. Each step
states exactly what it should print. Any deviation is a stop signal — follow
the note under the failing step and `diagnosis.md`.

## 1. Bring the tunnel up

```sh
ssh -N -L 6443:10.0.0.5:6443 jump        # keep this process running
# in another shell:
nc -vz localhost 6443
```

Expected:

```
Connection to localhost 6443 port [tcp/*] succeeded!
```

If refused: the tunnel is not forwarding — check jump-host access and that
nothing else on the workstation already binds local port 6443.

## 2. The API certificate covers `localhost`

```sh
echo | openssl s_client -connect localhost:6443 -servername localhost 2>/dev/null \
  | openssl x509 -noout -ext subjectAltName
```

Expected:

```
X509v3 Subject Alternative Name:
    DNS:localhost, DNS:kubernetes, DNS:kubernetes.default, DNS:kubernetes.default.svc, IP Address:10.0.0.5
```

If `DNS:localhost` is missing, the certificate has not been reissued yet.
Perform the one-time server-side change on the control-plane node
(`ssh jump && ssh 10.0.0.5`), preserving the existing subject and every
existing SAN so the jump-host kubeconfig keeps working:

```sh
cd /etc/kubernetes/pki
# note the current CN and SANs — they must survive the reissue
openssl x509 -in apiserver.crt -noout -subject -ext subjectAltName

# CSR: same CN, old SANs plus DNS:localhost
openssl req -new -key apiserver.key \
  -subj "/CN=<existing-CN-from-above>" \
  -addext "subjectAltName=DNS:localhost,<existing-SANs-from-above>" \
  -out apiserver.csr

# sign with the cluster CA (OpenSSL 3.x; on 1.1.x pass the SAN via -extfile)
openssl x509 -req -in apiserver.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 365 -copy_extensions copyall -out apiserver.new.crt

sudo cp apiserver.new.crt apiserver.crt
sudo systemctl restart kubelet
systemctl is-active kubelet
# active
```

Then wait ~10 s and rerun the check at the top of this step. Expected after
the reissue: the SAN line includes `DNS:localhost`. Verification is still full
chain + name check — nothing is being skipped.

## 3. kubectl reaches the API through the tunnel, with full verification

```sh
grep -c 'insecure-skip-tls-verify' ~/staging/kubeconfig
# 0
kubectl --kubeconfig ~/staging/kubeconfig get --raw /healthz
# ok
```

If the TLS "certificate is valid for …, not localhost" error returns, step 2
is not satisfied.

## 4. The `api` pods are Running **and** Ready

```sh
kubectl -n staging get pods -l app=api
```

Expected — one row per replica, READY `1/1`:

```
NAME                 READY   STATUS    RESTARTS   AGE
api-7b9f6c5d8-4k2lm   1/1     Running   0          12m
api-7b9f6c5d8-9x7pn   1/1     Running   0          12m
```

`0/1 Running` means the readiness probe is still failing (F3 in
`diagnosis.md`) — check the probe port in the Deployment.

## 5. The Service selects the pods and has endpoints

```sh
kubectl -n staging get svc api -o jsonpath='{.spec.selector}'
# {"app":"api"}
kubectl -n staging get endpoints api
```

Expected — a pod IP on port 3000 per replica, and **not** `<none>`:

```
NAME   ENDPOINTS                        AGE
api    10.42.1.5:3000,10.42.2.9:3000    5d
```

`<none>` with the correct selector means the pods are not Ready — back to
step 4. `{"app":"api-server"}` as the selector means the Service fix was not
applied (F2).

## 6. End-to-end request — in-cluster, the frontend's exact path

This is precisely the request the frontend makes: `api:80` → Service
endpoints → container port 3000.

```sh
kubectl -n staging run api-e2e --rm --restart=Never \
  --image=curlimages/curl:latest -- \
  curl -sS -o /dev/null -w '%{http_code}\n' http://api:80/health
```

Expected:

```
200
```

(`--rm` deletes the one-off pod when the command exits.)

## 7. End-to-end request — from the workstation, through the tunnel

```sh
kubectl -n staging port-forward svc/api 18080:80
# in another shell:
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:18080/health
```

Expected:

```
200
```

## 8. Rollout health — the check CI was failing

```sh
kubectl -n staging rollout status deploy/api
```

Expected:

```
deployment "api" successfully rolled out
```

If every step printed what it was supposed to, staging is healthy: the tunnel
verifies the API's real certificate by name, the Service fronts live
endpoints, the app answers through them, and rollouts complete instead of
triggering a rollback.
