# Reference solution — annotated core (Variant A anchor; same discipline for B/C)

## Fault map (Variant A)

| Symptom | Root cause | Not the fault |
|---|---|---|
| TLS error via tunnel | Cert SANs cover `10.0.0.5` / cluster DNS names, not `localhost`. kubeconfig points the tunnel at `https://localhost:6443`, so verification correctly fails. | TLS itself; the cert is fine for its real names. |
| Works on the jump host | There the server name matches a SAN. Confirms the SAN hypothesis — evidence, not a separate fault. | — |
| Service connection refused | Selector `app: api-server` matches no pods (labels say `app: api`) → Service has **no endpoints**. | The app, the Ingress, the network. |
| CI marks rollout unhealthy | Readiness probe targets port 8080; container listens on 3000. Probe never passes → rollout deadline → rollback. "Serving seconds later" is the app being fine while the probe lies. | App health. |

## Fixes (minimal diffs)

**TLS — fix the name, never the verification (M2):**

```yaml
# kubeconfig — make the verified name one the cert covers:
server: https://kubernetes.default.svc:6443   # or the cert's real SAN
tls-server-name: kubernetes.default.svc       # verify against SAN through the tunnel
# alternative (documented): reissue the API server cert adding the tunnel
# hostname to its SANs. Choose one; both are root-cause fixes.
# insecure-skip-tls-verify: true  ← the canonical wrong answer.
```

Evidence command: `openssl s_client -connect localhost:6443 </dev/null | openssl x509 -noout -ext subjectAltName`

**Service — one line:**

```yaml
selector:
  app: api        # was: api-server
```

Evidence: `kubectl get endpoints api` (empty before, populated after).

**Probe — point it at reality:**

```yaml
readinessProbe:
  httpGet: { path: /health, port: 3000 }   # was: 8080
```

Evidence: `kubectl describe pod` probe failures before; `kubectl rollout status` clean after.

## Runbook shape (M5)

Ordered, copy-pasteable, each step with expected output:

```bash
ssh -f -N -L 6443:10.0.0.5:6443 jump          # tunnel up
kubectl get nodes                              # expect: Ready, no TLS error
kubectl get endpoints api                      # expect: at least one address
kubectl rollout status deploy/api              # expect: successfully rolled out
kubectl port-forward svc/api 8080:80 & curl -s localhost:8080/health   # expect: 200
```

## The discipline (what the rubric is really measuring)

One hypothesis per symptom, one command to confirm, one minimal change — then
re-verify. Variants B and C follow the identical shape: compose-B's four
symptoms reduce to startup ordering (healthcheck + condition), wrong hostname
(`localhost` inside a container), wrong upstream port, and an unnamed volume;
pipeline-C's reduce to one theme — mutable `latest` as deploy identity — plus
swallowed failures and disabled TLS trust.

## Common wrong answers

- `insecure-skip-tls-verify: true` / `curl -k` / `--insecure-registry` — makes
  the error vanish and the security with it. Instant fail (M2).
- Restarting/recreating resources until symptoms move — no root cause, no
  runbook value.
- Rewriting whole manifests "clean" — destroys reviewability; the diff is the
  deliverable (M3).
- Fixing the Ingress because the frontend got connection refused — patching a
  downstream symptom (M6).
