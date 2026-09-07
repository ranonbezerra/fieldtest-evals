# Diagnosis

// ASSUMPTION: The exact API-server certificate SAN, the original image reference, and the original kubeconfig credential data were not provided. The corrected files use 10.0.0.5, api:1.0.0, and local PEM file references as defensible stand-ins.

## Symptom 1 — kubectl through the tunnel fails with a TLS certificate error

Root cause: The local kubeconfig targets `https://localhost:6443`, while the API-server certificate is valid for the cluster address `10.0.0.5`. The SSH forward changes the transport endpoint, not the hostname used for TLS verification.

Evidence:

    kubectl get pods

    # The error should identify the hostname mismatch, for example:
    # x509: certificate is valid for 10.0.0.5, not localhost

    kubectl config view --raw

    # clusters[0].cluster.server should be https://localhost:6443
    # no tls-server-name should be present

    echo | openssl s_client -connect localhost:6443 2>/dev/null | openssl x509 -noout -ext subjectAltName

    # Expected: IP:10.0.0.5, and no DNS:localhost or DNS:127.0.0.1

Fix: Add `tls-server-name: 10.0.0.5` to the cluster entry in `kubeconfig.yaml`. This makes kubectl verify the certificate against the name the certificate actually covers while still connecting through `localhost:6443`.

Alternative documented SAN reissue: reissue the API-server certificate with `DNS:localhost` and `DNS:127.0.0.1` in addition to the existing SANs, replace the certificate on the API server, restart the API server, and then use `https://localhost:6443` normally. Do not use `insecure-skip-tls-verify`.

## Symptom 2 — The API works when KUBECONFIG is exported on the jump host

Root cause: Same TLS server-name fault. The jump-host kubeconfig uses an API-server address that matches the certificate SAN, so TLS verification succeeds.

Evidence:

    kubectl config view --minify --raw

    # On the jump host, the active cluster server should be an address covered by the certificate,
    # for example https://10.0.0.5:6443.

Shared fault: This is the same fault as Symptom 1.

## Symptom 3 — api Deployment is Running but frontend gets connection refused through the api Service

Root cause: The Service has no endpoints because of two independent faults. First, the Service selector does not match the Deployment pod labels. Second, the readiness probe hits a port where the container is not listening, so even matching pods would not become Ready.

Evidence:

    kubectl get service api -o jsonpath='{.spec.selector}'

    # {"app":"api-server"}

    kubectl get pods -l app=api --show-labels

    # api-...   0/1 or 1/1   Running   ...   app=api

    kubectl get endpoints api

    # NAME   ENDPOINTS
    # api    <none>

    API_POD=$(kubectl get pod -l app=api -o jsonpath='{.items[0].metadata.name}')
    kubectl describe pod "$API_POD" | grep -A8 Events

    # Warning Unhealthy ... Readiness probe failed: Get "http://10.0.0.x:8080/health": dial tcp : connect: connection refused

    kubectl exec deploy/api -- wget -qO- http://127.0.0.1:3000/health

    # The container responds on port 3000.

Fix: Set the Service selector to `app: api` and set Service `targetPort` to 3000. Also fix the Deployment readiness probe port to 3000.

## Symptom 4 — Rollouts are flagged unhealthy and rolled back although logs show serving traffic later

Root cause: The readiness probe checks `/health` on port 8080, but the container listens on 3000. Kubernetes never marks the pod Ready, so the Deployment readiness gate fails and CI treats the rollout as unhealthy.

Evidence:

    kubectl rollout status deploy/api --timeout=60s

    # Deployment "api" exceeded its progress deadline

    kubectl get events --field-selector type=Warning

    # Events include readiness probe failures for http://<pod-ip>:8080/health

    kubectl logs deploy/api | grep -E "listen|serving"

    # Logs show the application listening or serving on 3000.

Fix: Change the readiness probe `port` from 8080 to 3000. Apply the same correction to the liveness probe if it exists.

## Shared faults and corrected artifacts

- Symptom 1 and Symptom 2 share the TLS server-name fault.
- Symptom 3 and Symptom 4 share the readiness-probe-port fault. Symptom 3 also has the independent Service selector fault.
- `kubeconfig.yaml` corrects the TLS server name.
- `api-service.yaml` corrects the selector and target port.
- `api-deployment.yaml` corrects the probe port.
- `ingress.yaml` is the working Ingress for the api Service; the Ingress itself is not a root cause.
