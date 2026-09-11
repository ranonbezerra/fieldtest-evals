# Runbook

Run this from the directory containing `staging.kubeconfig`, `api-deployment.yaml`, and `api-service.yaml`.

## 1. Start the SSH tunnel

    ssh -fN -L 6443:10.0.0.5:6443 jump

Expected: no output. If the port is already in use, stop the old tunnel first.

## 2. Confirm the local tunnel port

    nc -z 127.0.0.1 6443 && echo tunnel-listening

Expected:

    tunnel-listening

## 3. Select the corrected kubeconfig

    export KUBECONFIG=$PWD/staging.kubeconfig
    kubectl config view --minify -o yaml

Expected relevant output:

    clusters:
      - cluster:
          server: https://localhost:6443
          tls-server-name: "10.0.0.5"
        name: staging

No `insecure-skip-tls-verify` line is present.

## 4. Confirm the certificate name being verified

    openssl s_client -connect 127.0.0.1:6443 </dev/null 2>/dev/null | openssl x509 -noout -ext subjectAltName

Expected:

    X509v3 Subject Alternative Name:
        IP Address:10.0.0.5

## 5. Confirm the API server is reachable through the tunnel

    kubectl get --raw=/healthz

Expected:

    ok

## 6. Apply the corrected API manifests

    kubectl apply -f api-deployment.yaml -f api-service.yaml

Expected:

    deployment.apps/api configured
    service/api configured

If the resources are being created for the first time, `configured` is replaced by `created`.

## 7. Confirm the rollout is healthy

    kubectl rollout status deployment/api --timeout=120s

Expected:

    deployment "api" successfully rolled out

## 8. Confirm the pod is Ready

    kubectl get pods -l app=api -o wide

Expected: one `api` pod with `READY 1/1` and `STATUS Running`, for example:

    NAME              READY   STATUS    RESTARTS   AGE   IP           NODE
    api-7d4b9c6f8-x2y9z   1/1     Running   0          2m    10.244.0.12  node-1

## 9. Confirm the Service has endpoints

    kubectl get endpoints api

Expected: `ENDPOINTS` is not `<none>` and shows the pod IP and port `3000`, for example:

    NAME   ENDPOINTS         AGE
    api    10.244.0.12:3000  2m

## 10. Confirm the container health endpoint

    kubectl exec deploy/api -- wget -qO- http://127.0.0.1:3000/health

Expected:

    ok

## 11. Make an end-to-end request through the Service

    API_PORT=$(kubectl get svc api -o jsonpath='{.spec.ports[0].port}')
    echo "API_PORT=$API_PORT"

Expected:

    API_PORT=80

Start port-forward:

    kubectl port-forward svc/api 8080:$API_PORT

Expected:

    Forwarding from 127.0.0.1:8080 -> 80
    Forwarding from [::1]:8080 -> 80

In a second shell:

    curl -sS http://127.0.0.1:8080/health

Expected:

    ok

Stop port-forward with `Ctrl-C`. Expected:

    closing port forward
```
