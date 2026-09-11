# Diagnosis

Four reported symptoms map to three faults, not four independent problems.

| Symptom | Fault |
| --- | --- |
| `kubectl get pods` through the tunnel fails with a TLS certificate error mentioning the hostname | Fault 1: API-server certificate does not cover `localhost` |
| The same kubeconfig works when exported on the jump host | Fault 1: API-server certificate does not cover `localhost` |
| The `api` Deployment is `Running`, but the frontend gets connection refused through the `api` Service | Fault 2: Service selector matches no pods, and Fault 3: readiness probe prevents pods from becoming Ready |
| Rollouts of `api` are flagged unhealthy and rolled back, though the app logs show it serving traffic | Fault 3: readiness probe targets the wrong port |

## Fault 1 — API-server certificate does not cover `localhost`

This is the shared fault behind the first two symptoms.

The workstation connects to the control plane through:

    ssh -L 6443:10.0.0.5:6443 jump

so the local kubeconfig server is `https://localhost:6443`. The API-server certificate is valid for the control-plane address, not `localhost`, so hostname verification fails.

On the jump host, the kubeconfig points directly at the control-plane address that the certificate covers, so the same credentials work there.

Confirming evidence:

    $ kubectl --kubeconfig=staging.kubeconfig get pods
    Unable to connect to the server: tls: failed to verify certificate: x509: certificate is valid for 10.0.0.5, not localhost

    $ kubectl --kubeconfig=staging.kubeconfig config view --minify -o jsonpath='{.clusters[0].cluster.server}'
    https://localhost:6443

    $ ssh jump 'kubectl config view --minify -o jsonpath="{.clusters[0].cluster.server}"'
    https://10.0.0.5:6443

    $ ssh -N -L 6443:10.0.0.5:6443 jump &
    $ openssl s_client -connect 127.0.0.1:6443 </dev/null 2>/dev/null | openssl x509 -noout -ext subjectAltName
    X509v3 Subject Alternative Name:
        IP Address:10.0.0.5

The certificate has no `DNS:localhost` SAN.

Correct fix used here: keep `server: https://localhost:6443` and set the TLS validation name to the name the certificate actually covers:

    tls-server-name: "10.0.0.5"

This does not weaken verification. The certificate chain is still validated, and the name is still validated; only the expected name is corrected.

Alternative fix: reissue the API-server certificate with `DNS:localhost` in its SANs and remove `tls-server-name`.

No `insecure-skip-tls-verify` is used or introduced.

## Fault 2 — Service selector matches no pods

The Service selects a label that no `api` pod has.

Confirming evidence:

    $ kubectl get svc api -o jsonpath='{.spec.selector}{"\n"}'
    {"app":"api-server"}

    $ kubectl get pods -l app=api-server
    No resources found in default namespace.

    $ kubectl get deploy api -o jsonpath='{.spec.template.metadata.labels}{"\n"}'
    {"app":"api"}

    $ kubectl get endpoints api
    NAME   ENDPOINTS   AGE
    api    <none>      6d

Because the selector matches no pods, the Service has no endpoints. Traffic to the Service is therefore refused even though the pod is `Running`.

## Fault 3 — Readiness probe targets the wrong port

The readiness probe checks port `8080`, but the container listens on `3000`.

Confirming evidence:

    $ kubectl get deploy api -o jsonpath='{.spec.template.spec.containers[0].readinessProbe.httpGet.port}{"\n"}'
    8080

    $ kubectl exec deploy/api -- wget -qO- http://127.0.0.1:3000/health
    ok

    $ kubectl exec deploy/api -- wget -qO- http://127.0.0.1:8080/health
    wget: can't connect to remote host (127.0.0.1): Connection refused

    $ kubectl get events --field-selector reason=Unhealthy --sort-by=.lastTimestamp | grep Readiness
    ... Readiness probe failed: Get "http://10.244.0.12:8080/health": dial tcp 10.244.0.12:8080: connect: connection refused

    $ kubectl logs deploy/api --tail=5
    INFO level=info msg="request" method=GET path=/health status=200

The application is serving on `3000`, but Kubernetes never marks the pod Ready because the probe hits the wrong port. That makes CI read the rollout as unhealthy and roll it back.

## Interaction between Fault 2 and Fault 3

The frontend connection-refused symptom has two causes.

Fixing only the Service selector is not enough, because Kubernetes adds only Ready pods to the Service endpoint list. While the readiness probe fails, the pod is not Ready, so the Service still has no endpoints.

Both fixes are required:

    selector:
      app: api

    readinessProbe:
      httpGet:
        path: /health
        port: 3000
