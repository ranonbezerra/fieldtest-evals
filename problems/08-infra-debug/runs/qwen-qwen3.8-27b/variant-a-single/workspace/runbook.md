# Runbook

Prerequisites: `ssh`, `kubectl`, `curl`, `openssl`, and access to the jump host. Run the commands from the directory containing the corrected files and PEM credentials.

## 1. Start the SSH tunnel

    ssh -N -L 6443:10.0.0.5:6443 jump

Expected: the command stays connected and produces no error. In another terminal:

    ss -ltn | grep 6443

Expected: a listener on port 6443, for example `127.0.0.1:6443`.

## 2. Use the corrected kubeconfig

If you are using the file-based kubeconfig delivered here, place the existing CA, client certificate, and client key next to `kubeconfig.yaml` as `staging-ca.crt`, `staging-admin.crt`, and `staging-admin.key`. Do not commit those files.

    export KUBECONFIG="$PWD/kubeconfig.yaml"

Expected: no output.

## 3. Verify TLS and API access

    kubectl cluster-info

Expected: `Kubernetes control plane is running at https://localhost:6443` and no `x509`, `certificate is valid for`, or `connection refused` error.

    kubectl get --raw /healthz

Expected:

    ok

    kubectl auth can-i get pods

Expected:

    yes

## 4. Apply the corrected manifests

If `api:1.0.0` in `api-deployment.yaml` is a placeholder in your environment, replace it with the existing image before applying.

    kubectl apply -f api-service.yaml -f api-deployment.yaml -f ingress.yaml

Expected:

    service/api configured
    deployment.apps/api configured
    ingress.networking.k8s.io/api configured

## 5. Verify rollout health

    kubectl rollout status deploy/api --timeout=180s

Expected:

    deployment "api" successfully rolled out

    kubectl get deployment api -o wide

Expected: the `READY` column shows `1/1`, and `UP-TO-DATE` and `AVAILABLE` show `1`.

## 6. Verify Service endpoints and readiness

    kubectl get pods -l app=api -o wide

Expected: one pod with READY `1/1` and STATUS `Running`.

    kubectl get endpoints api -o wide

Expected: one endpoint with port `3000`, for example `10.244.0.2:3000`.

## 7. End-to-end request through the api Service

    kubectl port-forward svc/api 18080:80 &
    PORT_FORWARD_PID=$!
    sleep 2

    curl -fsS http://127.0.0.1:18080/health

Expected: HTTP 200 and the api health payload.

    kill "$PORT_FORWARD_PID"

## 8. End-to-end request through the Ingress

    kubectl get ingress api -o wide

Expected: the backend is `api:80` and `ADDRESS` is populated. If `ADDRESS` is not populated, verify that the Ingress controller and its Service are healthy before continuing.

    INGRESS_ADDRESS=$(kubectl get ingress api -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
    if [ -z "$INGRESS_ADDRESS" ]; then
      INGRESS_ADDRESS=$(kubectl get ingress api -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
    fi
    echo "$INGRESS_ADDRESS"

Expected: a routable IP address or resolvable hostname for the Ingress controller.

    INGRESS_HOST=$(kubectl get ingress api -o jsonpath='{.spec.rules[0].host}')
    if [ -n "$INGRESS_HOST" ]; then
      curl -fsS -H "Host: $INGRESS_HOST" "http://$INGRESS_ADDRESS/health"
    else
      curl -fsS "http://$INGRESS_ADDRESS/health"
    fi

Expected: HTTP 200 and the api health payload.

## If TLS still fails

Verify the SAN actually covered by the server certificate:

    echo | openssl s_client -connect localhost:6443 2>/dev/null | openssl x509 -noout -ext subjectAltName

Set `tls-server-name` in `kubeconfig.yaml` to a value present in that SAN list. If the only usable fix is to add `DNS:localhost` to the API-server certificate, reissue the certificate with the existing SANs plus `DNS:localhost` and `DNS:127.0.0.1`, replace the certificate on the API server, restart the API server, and then rerun this runbook. Do not set `insecure-skip-tls-verify`.
