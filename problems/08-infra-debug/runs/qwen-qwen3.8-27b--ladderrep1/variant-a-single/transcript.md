# Transcript — 08-infra-debug / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
Let me organize what's needed. The task is Variant A / L2-spec: fix 3 faults in a Kubernetes staging cluster behind a jump host:

1. Fault 1: The API server cert doesn't cover `localhost` (the tunnel target). Symptoms: kubectl TLS error via the tunnel; works on the jump host.
2. Fault 2: The Service selector `app: api-server` doesn't match the pod label `app: api`. Connection refused.
3. Fault 3: The readiness probe hits port 8080 but the container listens on 3000. CI rollout judged unhealthy; the pod is never Ready, which also excludes it from the Service's endpoints.

Deliverables:
1. `diagnosis.md` — trace each symptom to root cause, with confirming commands/evidence, and note which symptoms share the fault.
2. Corrected manifests/kubeconfig as **minimal diffs** — "change only what's wrong, nothing else. I want three fixes readable from the diff, not three rewritten files." But the format requirement says: "For each file ... one fenced block containing **only that file's contents**" — "no fragments, no 'unchanged' comments, no diffs."

Hmm, tension here. The task spec asks for minimal diffs, but the mechanical format explicitly says: "no fragments, no 'unchanged' comments, no diffs." And "deliver every file the solution needs, complete, from the first line to the last line."

But wait — the original manifests/kubeconfig are not given to me as files. The task only describes them: kubeconfig with server `https://localhost:6443` via `ssh -L 6443:10.0.0.5:6443 jump`; Deployment's readiness probe hitting `/health` on port 8080, container listening on 3000; Service with selector `app: api-server`; Deployment labels `app: api`; Ingress. I don't have the actual file contents. So I have to construct plausible original manifests and provide corrected full files.

The format parser only reads headings and fenced blocks, so I must deliver full corrected files. The "minimal diff" requirement from the spec is about the *content* — that is, the changes within each file should be minimal, touching only the erroneous lines. Since I don't have the original files, I'll create plausible complete manifests and apply the minimal fixes. I should include a `// ASSUMPTION` note where I make assumptions about unspecified parts.

Wait — the instructions say "if a needed symbol is really missing from the task, don't silently guess... use the most defensible interpretation and mark it at the point it matters with a single `// ASSUMPTION: <unresolved item>` comment." These are YAML files, so I can use a `# ASSUMPTION:` comment.

File layout I get to decide. Let me think about what files to create:

- `diagnosis.md`
- `runbook.md`
- Corrected manifests — where to put them? Something like `manifests/api-deployment.yaml`, `manifests/api-service.yaml`, `manifests/api-ingress.yaml`, and the kubeconfig fix.

Wait, how do I "fix" the kubeconfig? Fault 1: the cert SANs cover the control-plane address (10.0.0.5, and probably the cluster DNS name too) but not `localhost`. Two correct options:

Option A: Keep the tunnel to `localhost:6443` but use a `server` name the cert covers... no wait. The tunnel forwards `localhost:6443` → `10.0.0.5:6443`. The client connects to `localhost:6443`, and the TLS handshake verifies the server name against the cert's SANs. If the cert's SANs cover `10.0.0.5` and not `localhost`, verification fails.

To fix this without weakening verification while keeping the tunnel working, the options are:

1. Reissue the server cert with `localhost` (and probably `127.0.0.1`) in the SANs. This is a server-side change. Documented.
2. Or... hmm, can I make the client verify against a different name? In practice, kubectl verifies the name in the `server` field against the SANs. There's no legitimate "override server name" in kubeconfig. There's an `--server-name` flag? No — that's for... actually kubectl has no such flag. There's `kubectl --insecure-skip-tls-verify` (banned), and `--server` just changes the URL, and verification still happens against the URL's host.

Hmm, actually is there a way? In Go's TLS, if the client sets `InsecureSkipVerify`, verification is skipped. Some clients let you set the `ServerName` separately from the address (SNI override). kubectl doesn't expose this. So for kubectl, the legitimate fix is: reissue the cert with `localhost` in the SANs. That's the documented, server-side fix.

The spec says: "Two correct options: keep the connection through the tunnel and verify against a name the cert actually covers, or reissue the cert with the tunnel hostname in the SANs, documented as a server-side change someone needs to perform."

Hmm, "keep the connection through the tunnel and verify against a name the cert actually covers" — how do I do that? The cert covers `10.0.0.5`. The tunnel target is `10.0.0.5`. The client address is `localhost`. TLS name verification matches the address the client connects to against the SANs... unless the cert also covers `localhost`. Hmm.

Wait — actually! What if I change the tunnel to bind to... no, the client-side bind address doesn't change the name the TLS client uses; the client uses the hostname in the URL (`https://localhost:6443`). If I set the server in kubeconfig to `https://127.0.0.1:6443` and the cert covers `127.0.0.1`? Not stated as covered. The cert covers "the control-plane address" — 10.0.0.5.

Hmm, another thought: `ssh -L 6443:10.0.0.5:6443` — what if I made the SSH local-forward... no, the forward always binds on the local machine. The name the client presents is whatever the URL is.

Actually, there is a clever option: use `ssh -L` with a *unix socket*? No, TLS name verification would use the socket's peer address... complicated.

Another legitimate approach: `https_proxy`? No.

Honestly, the cleanest, most defensible fix: reissue the API server cert with `DNS:localhost, IP:10.0.0.5` (preserving the existing SANs) — documented as a server-side change (via kubeadm, `kubeadm certs renew apiserver`, and... hmm, kubeadm's cert generation uses the control-plane's API IP, not arbitrary names; to add `localhost` you'd have to regenerate the cert manually or with a CA tool). In the runbook I can document: "Server-side: regenerate the API server cert with SANs including `localhost` (e.g., `openssl` signed by the cluster CA, or a kubeadm config change that adds `--cert-dir`...)." Actually, for kubeadm clusters, `kubeadm certs renew apiserver` regenerates with the same SANs (the control-plane IP + hostname). To add `localhost`, one would typically create a new CSR or use cert-manager... For the purposes of this deliverable, documenting the SAN reissue as a server-side change is sufficient. The spec explicitly endorses this: "reissue the cert with the tunnel hostname in the SANs, documented as a server-side change someone needs to perform."

So: kubeconfig itself — what changes? If I go with the SAN reissue path, then the kubeconfig can stay as `https://localhost:6443` — nothing changes in the kubeconfig file! The fix is on the server side. But the deliverable says "corrected manifests/kubeconfig as minimal diffs" — the diff for the kubeconfig might be empty, or it might need something.

Hmm, wait, let me reconsider. Is there anything actually wrong in the kubeconfig per the fault list? The fault is purely the cert's SANs. The kubeconfig's server URL `https://localhost:6443` is correct in light of the tunnel. So "corrected kubeconfig" = no changes, or...

Alternative: keep the client connecting to a name the cert covers via a tunnel trick? What if the kubeconfig used `server: https://10.0.0.5:6443` and the user set up an SSH tunnel with local binding... no, `localhost` in the forward is a local address, and from the workstation 10.0.0.5 is not routable. The spec warns: "A fix that points the client directly at that address will fix the name but break the connection."

So the only workable fix: reissue the cert with `localhost` in the SANs. And the kubeconfig stays the same. But then the "minimal diff" for the kubeconfig is empty. Should I still provide the kubeconfig as a full file (unchanged, for completeness) and note in the diagnosis/runbook that the kubeconfig needs no change? The spec asks for three fixes: (1) cert reissue [server-side, documented], (2) Service selector, (3) readiness port. So the artifacts: corrected Deployment, corrected Service, and documentation of the cert reissue (in diagnosis.md / runbook.md, plus a script?).

Hmm, "three fixes readable from the diff, not three rewritten files" — since I must deliver full files (no diffs allowed by the format), I'll make the manifests minimal and only the one bad line different from the broken version described. In diagnosis.md I can present the exact changed lines (in the doc, a diff-style presentation is fine — the ban on diffs is on file content, and markdown prose inside a fenced block is the file content itself; the doc can *reference* before/after lines — that's natural for a diagnosis).

Wait, actually, the format rule: "no fragments, no 'unchanged' comments, no diffs" applies to file contents. Inside diagnosis.md, it's fine and expected to write "selector: app: api-server → app: api" as prose. The spec explicitly asks for diagnosis to trace symptoms with confirming commands.

Now, the kubeconfig: should I include it as a file? The task says "You are given: the kubeconfig (server: `https://localhost:6443`...), and the manifests." I don't actually have it, so I'd need to reconstruct. I think it's better to include a reconstructed kubeconfig as a full file with an ASSUMPTION comment on the parts I'm guessing (user, auth). Actually — do I need to provide the kubeconfig at all? The deliverable says "corrected manifests/kubeconfig as minimal diffs." With the SAN reissue approach, the kubeconfig is unchanged. Providing an unchanged kubeconfig as a file means "a file I wasn't shown a replacement for"... The instructions say "don't restate files I wasn't asked to change, and don't fabricate replacements for files you were shown." I wasn't actually shown the kubeconfig file, only described. I was shown its contents descriptively.

I think the most defensible move is:
- Provide corrected `api-deployment.yaml` and `api-service.yaml` (the two file-based fixes).
- The Ingress is described but no fault is assigned to it; "change only what's wrong" — the Ingress needs no change. Should I still provide it? "Don't restate files I wasn't asked to change." The Ingress is fine, so I don't deliver a file for it. But then "three fixes" = Service selector, readiness port, cert SAN. Two of the three fixes live in files. Good.

Hmm wait — the Ingress: is it actually fine? The symptoms don't mention the Ingress. The spec lists three faults; the Ingress is not in any. So I don't touch the Ingress. Should I still include it? I'll leave it out and mention in diagnosis.md that the Ingress was reviewed and has no fault. Actually, the diagnosis should be about the four symptoms. I can mention Ingress is unrelated to the symptoms. Keep it brief.

Should I include the kubeconfig? If I choose the SAN reissue, the kubeconfig is unchanged. To make it explicit that the kubeconfig requires no change, I'll document in diagnosis.md that the kubeconfig's `server` entry is correct as-is and the fix is a server-side cert reissue. I'll not ship the kubeconfig file (unchanged → not delivered). Hmm, but the deliverable wording "corrected manifests/kubeconfig as minimal diffs" — the slash means "manifests and/or kubeconfig." The corrected set of artifacts = two manifests + the cert reissue documentation. That satisfies "three fixes readable."

Or — should I include the cert reissue as a file? Like `certs/reissue-apiserver-cert.md` or a script `certs/reissue-apiserver-cert.sh`? The spec: "reissue the cert with the tunnel hostname in the SANs, documented as a server-side change someone needs to perform." "Documented" — a doc. I can fold this into the runbook and diagnosis. A small script might be over-delivery ("don't create files that aren't asked for"). Hmm, the task asks for `diagnosis.md`, corrected artifacts, `runbook.md`. A standalone cert doc is not explicitly requested. I'll document the SAN reissue inside diagnosis.md (root cause + the exact server-side steps) and include verification steps in runbook.md (confirming the new cert's SANs via `openssl s_client`). That's the right scope, I think.

File layout:
```
diagnosis.md
runbook.md
manifests/api-deployment.yaml
manifests/api-service.yaml
```

Hmm, or flat: `api-deployment.yaml`, `api-service.yaml`? The layout is my choice. The repo is a staging-infra repo; a `manifests/` directory is defensible. I'll use `manifests/`.

Now, let me write the manifests. I need plausible, complete, minimal manifests consistent with the description. Since I'm reconstructing, I'll mark assumptions with `# ASSUMPTION:` comments at the points where I've guessed values that aren't specified (image, replicas, resource names, namespace, etc.). But note: too many assumption comments is noisy; the instruction says to mark "at the point it matters" — i.e., where a missing symbol really matters. What matters for the fix: the label `app: api` (given), the selector (given as `app: api-server`, corrected to `app: api`), the probe path `/health` on port 8080 (given), the container port 3000 (given). What's not given: image name/tag, container name, namespace, replicas, Ingress details, Service port/type, probe details (initialDelay, etc.). These I'll pick sensible defaults and mark key ones with a single assumption comment.

Let me draft the Deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: staging            # ASSUMPTION: namespace not specified
  labels:
    app: api
spec:
  replicas: 2                   # ASSUMPTION
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: registry.internal/staging/api:1.4.2   # ASSUMPTION: image/tag not provided
          ports:
            - containerPort: 3000
          readinessProbe:
            httpGet:
              path: /health
              port: 3000      # was 8080 — the app listens on 3000
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
          resources:
            ...
```

Hmm — do I want a liveness probe? If it was in the original, fine; I'm reconstructing, so I'll keep it minimal. The described original only mentions the readiness probe. Minimal reconstruction: readiness probe only. Adding a liveness probe would be inventing content. Keep it minimal: one container, port, readiness probe.

Wait, should I put a comment in the file indicating the fix? "Minimal diff, three fixes readable" — a short comment `# FIX: ...` is helpful and arguably within scope. But "change only what's wrong, nothing else" — a comment is not a functional change. Hmm. A minimal comment noting the fix aids readability of the "diff." But the file I deliver is the full corrected file, and a reader comparing to the broken version will see the changed line. A one-line `# was 8080` comment is, I think, acceptable and useful. Actually, in a real PR, you wouldn't leave "was X" comments; you'd describe in the PR description. Since the format forbids a PR description and diagnosis.md covers that, I'll keep the YAML clean without "was" comments. Clean files are more professional. Decision: clean YAML, fixes live in diagnosis.md.

Hmm, but then "three fixes readable from the diff" — in the diff against the broken state, the changes are visible: `port: 8080` → `port: 3000`, `app: api-server` → `app: api`, and the cert (server-side). Good.

Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: staging
  labels:
    app: api
spec:
  selector:
    app: api        # was: app: api-server (matched no pod)
  ports:
    - port: 80
      targetPort: 3000
      protocol: TCP
  type: ClusterIP
```

Wait — what's the Service's port? The frontend hits the Service; the Ingress routes to the Service. Common: port 80 → targetPort 3000. Since the container listens on 3000, targetPort must be 3000. The original bad manifest had the wrong selector; its port might have been 8080 too? Not stated. The spec lists only three faults. So Service port: 80, targetPort: 3000 is a defensible default. I'll mark `# ASSUMPTION: Service port mapping (80 -> 3000) not specified in the ticket`.

Hmm, actually wait. Let me reconsider: "targetPort: 3000" — is that given? The container listens on 3000, so targetPort 3000 (or a named port). Defensible. I'll add one assumption comment.

Deployment name: `api` (the "api Deployment"). Service name: `api`? The symptom says "the `api` Service." So Service name `api`. Good.

Namespace: not specified. `staging` is defensible (it's a staging cluster). I'll mark as an assumption.

Do I need namespace in both files consistently? Yes, I'll use `staging` in both.

Now diagnosis.md. Structure:

# Staging behind jump host — diagnosis

Four symptoms, three faults.

## Symptom → fault map
| # | Symptom | Fault |
|---|---------|-------|
| 1 | kubectl through the tunnel: TLS error that names the host | Fault 1 |
| 2 | The same kubeconfig works on the jump host | Fault 1 |
| 3 | Pods are Running, but the frontend is connection-refused on the Service | Fault 2 (compounded by Fault 3) |
| 4 | CI rollout "unhealthy," rolled back, but the app is serving | Fault 3 |

## Fault 1 — API server cert lacks a SAN for `localhost`
- Tunnel: `ssh -L 6443:10.0.0.5:6443 jump`. The client dials `https://localhost:6443`.
- Cert SANs cover the control plane (IP `10.0.0.5`, and probably the control-plane's DNS name) but not `localhost`. TLS verification matches the name in the URL against the SANs → error like `x509: certificate is valid for 10.0.0.5, not localhost` / `tls: failed to verify certificate: x509: cannot validate certificate for localhost`.
- On the jump host, the kubeconfig's server is `https://10.0.0.5:6443` (a name the cert covers) → works.
- Symptoms 1 and 2 share this fault.
- Confirming commands:
  - `openssl s_client -connect localhost:6443 -servername localhost </dev/null 2>/dev/null | openssl x509 -noout -ext subjectAltName` (with the tunnel up) → SAN list lacks `localhost`.
  - Or `openssl s_client -connect localhost:6443 -verify_return_error ...` which will show the verification failure `verify error:num=69:unable to get local issuer`? Hmm, actually the error is `verify error:num=62:certificate not trusted`? For a name mismatch: `verify error:num=69`? Let me recall: X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT = 2; X509_V_ERR_HOSTNAME_MISMATCH... In OpenSSL, name mismatch is `verify error:num=69`? No. The relevant one: `x509: hostname mismatch` corresponds to X509_V_ERR_HOSTNAME_MISMATCH? Actually, OpenSSL has historically not enforced hostname by default in s_client; `openssl s_client` checks hostname when `-verify_hostname` is used... hmm.

Let me be careful with the exact error string. Go's crypto/tls (which kubectl uses) reports:
`tls: failed to verify certificate: x509: certificate is valid for 10.0.0.5, not localhost` — or, for a DNS name, `x509: hostname localhost does not match the cert`? The exact Go message: `x509: cannot validate certificate for localhost because it doesn't contain any IP SANs` (when there are no IP SANs and host is an IP) or `x509: certificate is valid for 10.0.0.5, not localhost`? Hmm, actually Go's message format is: `x509: certificate is valid for CN1, CN2, not localhost`? Let me recall the real kubectl error:

The common one:
```
The server could not set up a secure connection to https://localhost:6443: tls: failed to verify certificate: x509: certificate is valid for 10.0.0.5, not localhost
```
Hmm, I've seen: `x509: cannot validate certificate for localhost because it doesn't contain any IP SANs` — that's when connecting to an IP address and the cert has no IP SAN. Here we connect to `localhost` (DNS name) and the cert has IP SAN `10.0.0.5` and probably a DNS SAN like `kubernetes`/`kubernetes.default`. Go would report: `x509: certificate is valid for kubernetes, kubernetes.default, kubernetes.default.svc, 10.0.0.5, not localhost`. Yes, that's the format: "certificate is valid for <san list>, not <host>." I'll use that, but phrase the expected output to show the SAN list and `not localhost` — safe and accurate.

For openssl s_client verification, with `--ca-file` and verify... `openssl s_client -connect localhost:6443 -CAfile /etc/ssl/certs/ca.pem` — by default OpenSSL 3.x does not do hostname verification in s_client unless `-verify_hostname`... hmm, actually does s_client do hostname verification? Historically, `openssl s_client` doesn't check the server name against the SAN by default (you use `-verify_hostname`? no...). Let me think. `openssl s_client -connect host:port` — since OpenSSL 1.1? I believe `s_client` by default verifies the chain (with `-CAfile`) but not the hostname. To check the hostname: in newer OpenSSL, is there no `-verify_hostname`? Hmm, actually it is: `openssl s_client` doesn't have a hostname verification flag? Checking my memory: flags include `-verify 0/1/2`, `-CAfile`, `-CApath`, `-cert`, `-key`, `-servername` (SNI). I recall hostname mismatch checks in s_client... in OpenSSL 3.0, `s_client` added `-verify_hostname`? Hmm, honestly not sure. The safe approach for a runbook: use s_client primarily to *dump the cert's SANs* (`| openssl x509 -noout -text`), and demonstrate the failure with kubectl itself (the TLS error is the symptom). For the verification check, I can use `curl`:

`curl --cacert <ca> https://localhost:6443/healthz` → before the fix: `curl: (60) SSL certificate problem: unable to get local issuer certificate`? No — the CA is probably the cluster CA and is in the kubeconfig's `certificate-authority-data`. The error with name mismatch from curl: `curl: (51) SSL: certificate subject name 'kubernetes' does not match target host 'localhost'` or `curl: (60) SSL certificate problem: The certificate's CN does not match`. In curl, the error for hostname mismatch is `CURLE_SSL_CACERT_BADNAME` (51): "the server's SSL certificate is valid but subject name does not match provided target" → message: `curl: (51) SSL: certificate subject name 'kubernetes' does not match target host 'localhost'`. In newer curl with SAN support: `curl: (51) SSL: could not evaluate ...`? Hmm. I think the classic message is still "certificate subject name ... does not match target host." To be safe, I can write the expected output more loosely: "an SSL error stating the certificate is valid for <SANs> but not `localhost` (curl exit 51 / 60)." The spec says each step states what it should output — I can give the representative output and note it's "or equivalent name-mismatch error." That's honest and robust.

Actually, for the runbook, the cleanest evidence commands:

1. Tunnel up: `ssh -N -L 6443:10.0.0.5:6443 jump` (in a separate terminal). Check: `nc -vz localhost 6443` → `Connection to localhost 6443 port [tcp/*] succeeded`.

2. Inspect the served cert:
```
echo | openssl s_client -connect localhost:6443 -servername localhost 2>/dev/null \
  | openssl x509 -noout -ext subjectAltName
```
Expected: `X509v3 Subject Alternative Name: DNS:kubernetes, DNS:kubernetes.default, ... IP Address:10.0.0.5` — and `localhost` is *not* listed. (Post-fix: `DNS:localhost` appears.)

Hmm, `-servername localhost` sets SNI; the apiserver serves the same cert anyway. Good.

3. kubectl:
```
KUBECONFIG=~/staging/kubeconfig kubectl get pods -n staging
```
Before: `The server could not set up a secure connection to https://localhost:6443: tls: failed to verify certificate: x509: certificate is valid for kubernetes, kubernetes.default, kubernetes.default.svc, 10.0.0.5, not localhost`.
After fix: pod list, STATUS `Running` (well, `1/1 Running`).

4. Server-side cert reissue (documented): steps:
   - On the control plane (via jump host): generate a new apiserver key/CRT signed by the cluster CA (kubeadm: `/etc/kubernetes/pki/ca.{crt,key}`), SANs = existing + `DNS:localhost` (+ keep `IP:10.0.0.5`).
   - `systemctl restart kubelet` / `kubeadm certs renew apiserver`? Caution: `kubeadm certs renew apiserver` regenerates with kubeadm's default SANs (control-plane IP + `kubernetes` names), not `localhost`. So the documented approach: create a CSR or use openssl:

```
openssl req -new -key apiserver.key -subj "/CN=staging-apiserver" \
  -addext "subjectAltName=DNS:localhost,DNS:kubernetes,DNS:kubernetes.default,DNS:kubernetes.default.svc,IP:10.0.0.5" \
  -out apiserver.csr
openssl x509 -req -in apiserver.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 365 -copy_extensions copyall -out apiserver.crt
```
   Then place in `/etc/kubernetes/pki/apiserver.{crt,key}`, restart kubelet, and verify via the tunnel that the new cert is served.

That's a reasonable documented server-side change. In the runbook, I'll phrase the step as "prerequisite (server-side, performed once by someone with access to the control plane)."

5. Endpoints:
```
kubectl get endpoints api -n staging
```
Before: `ENDPOINTS <none>`. After: `<pod-ip>:3000,<pod-ip>:3000`.

6. Service:
```
kubectl get svc api -n staging -o wide
```
After: `CLUSTER-IP` `80/TCP`, and `kubectl get endpoints` shows ready addresses.

Also `kubectl describe svc api` shows the selector `app=api`.

7. Pod readiness:
```
kubectl get pods -n staging -l app=api
```
`1/1 Running` (previously `0/1 Running` because the probe never passes — wait, was the pod showing 0/1? Yes: readiness fails forever → READY `0/1`, STATUS `Running` — the symptom said "shows `Running`" — status is Running, ready is 0/1. I'll note the READY column as evidence.)

8. In-cluster curl from a client pod? Simpler: use `kubectl port-forward` or test via the Ingress. End-to-end: the Ingress routes to the Service. Without the Ingress host, I can test from inside the cluster:
```
kubectl run e2e-curl --rm -it --restart=Never --image=curlimages/curl:latest -- curl -sf http://api:80/health
```
Hmm, the image name `curlimages/curl` is real (docker.io/curlimages/curl). Defensible for a runbook. Or port-forward from the workstation: `kubectl port-forward svc/api 3000:80` and then `curl https://...`? No — port-forward to `http://localhost:3000/health`. That's a solid end-to-end-ish test through the Service. In addition, an Ingress test with the actual host header if the Ingress defines a host — I don't know the Ingress's host (not given). Hmm. The deliverable requires "end-to-end request." The safest is: test via the Service inside the cluster (curl pod), and/or port-forward. I'll do:

```
kubectl port-forward -n staging svc/api 18080:80
curl -sS http://localhost:18080/health
```
Expected: `{"status":"ok"}` or similar? The app's health response body is unknown. I'll say `HTTP 200` with the app's health payload (e.g., `ok`/`{"status":"ok"}`) — better: state "an HTTP 200 response from `/health`." To be concrete: expected `200 OK`; body as returned by the app (typically `{"status":"ok"}`). I'll mark the body as an assumption or keep it generic: "200 OK." The spec wants an expected output per step — "HTTP/1.1 200 OK" is a safe concrete expectation. I'll use `curl -sS -o /dev/null -w '%{http_code}\n'` → expected `200`. That's exact and robust.

Plus, an end-to-end via the Ingress: `curl https://<ingress-host>/health` with the proper host — unknown. I'll include a port-forward-based E2E and note that once DNS is in place, the Ingress path is the same request through the LB. Hmm, or `kubectl exec` into an existing pod? The frontend is a separate deployment (the "frontend" is connection-refused). I can test from the frontend's pod:
```
kubectl -n staging exec deploy/frontend -- wget -qO- http://api:80/health
```
But the frontend image may not have wget/curl. Too speculative. The `kubectl run` curl pod is the canonical approach. But `kubectl run` requires a pullable image in that cluster; I'll use `curlimages/curl:latest` with an assumption note... the ASSUMPTION comment convention is for code; in a runbook I can just note it. Keep it simple.

Let me structure the runbook as numbered steps with commands + expected output:

**Prerequisite (server-side, one-time):** Cert reissue — commands + how to confirm (step 2 shows the new SAN).

1. Start the tunnel
2. Confirm the tunnel is forwarding (nc)
3. Inspect the served cert's SANs (openssl) — expected includes `DNS:localhost`
4. `kubectl version --short`? Deprecated. Use `kubectl get --raw /healthz` → `ok`. Nice first kubectl call. Expected: `ok`.
5. `kubectl get pods -n staging` → api pod `1/1 Running`, frontend `1/1 Running`.
6. `kubectl get endpoints api -n staging` → ready IP on port 3000.
7. `kubectl get svc api -n staging` → 80/TCP.
8. In-cluster request: `kubectl run` curl pod → 200.
9. (Optional) port-forward E2E.
10. CI rollout health check: `kubectl rollout status deploy/api -n staging` → `deployment "api" successfully rolled out`.

Also negative confirmation that the kubeconfig has no insecure flag: `grep -n insecure-skip-tls-verify kubeconfig` → no match. Good to include, since it's a spec acceptance criterion.

Now — one more consideration on fault 1's fix: the spec's option 1, "keep the connection through the tunnel and verify against a name the cert actually covers" — I keep circling back: is there a way to do this *client-only*? The client name is fixed by the URL. The URL's host must be a local address (the tunnel binds locally) and must match a SAN. The cert covers `10.0.0.5` — is `10.0.0.5` reachable from the workstation? "The control-plane address is not routable from workstations — that's why the jump host exists." So no. Unless... the SSH local forward binds to `127.0.0.1`, and the client uses `https://127.0.0.1:6443` — cert covers `127.0.0.1`? Not stated; the cert covers "the control-plane address" = 10.0.0.5. So no client-only fix. SAN reissue it is. I'll state this reasoning in diagnosis.md (why I didn't just re-point the server URL, and why I didn't use skip-verify) — that shows the "no weakening" acceptance is met, and directly answers the spec's warning.

Wait, actually one more client-side possibility worth honestly mentioning: the kubeconfig can't override the verified name; `--insecure-skip-tls-verify` and `--insecure-skip-tls-verify-backends` (the latter only for client certs, irrelevant) are both banned. So yes: SAN reissue. I'll state: "Chosen fix: reissue the server cert with `DNS:localhost` in the SANs (keeping the existing SANs). The tunnel and kubeconfig are otherwise unchanged."

Now the exact kubeconfig: the given one has `server: https://localhost:6443`. It stays. Should I include the kubeconfig file with an ASSUMPTION? I'll decide **not** to include the kubeconfig file, because it's unchanged — "don't restate files I wasn't asked to change." The diagnosis will state that the kubeconfig requires no change. Hmm, but the deliverable literally says "corrected manifests/kubeconfig as minimal diffs." If the kubeconfig has no diff, that's covered by a statement. I'm fairly confident this is the right read: the "corrected set" of artifacts is the union.

Hmm, wait. Let me reconsider once more whether the intended fix might be a kubeconfig change: e.g., change `server: https://localhost:6443` to... no. There is no client-side legitimate fix. The spec itself says the fix is either "verify against a name the cert covers" (impossible client-side here, given non-routability) or "SAN reissue." The spec author clearly intends SAN reissue (that's why they emphasize "documented as a server-side change someone needs to perform" and warn against pointing at 10.0.0.5). Confirmed.

Now the manifests. Let me finalize the content.

Deployment (`manifests/api-deployment.yaml`):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: staging
  labels:
    app: api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: registry.internal/staging/api:1.4.2
          ports:
            - containerPort: 3000
              name: http
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 3
            periodSeconds: 5
```

Wait — `maxUnavailable: 0` matters here: with broken readiness, rolling updates never progress (new pods are never Ready) — that's part of why CI sees the rollout as unhealthy. Should I include a strategy block? The described original manifest doesn't mention it. Adding a strategy = adding content not in the ticket. "Change only what's wrong, nothing else" — I'll keep the manifest minimal: no strategy block (default RollingUpdate maxSurge 25%, maxUnavailable 25% is fine and unrelated to the three faults). Keep it lean.

Resources: not mentioned; skip? A real staging manifest would have them, but the ticket doesn't mention them. Minimalism → skip. I'll mark assumptions only where the values *matter* for the fix or the runbook. Image: needed for the file to be complete; I'll mark `# ASSUMPTION: image and tag not provided in the ticket; adjust to the team's registry`. Namespace: `# ASSUMPTION: namespace not specified`. Replicas: `2`? Or `1`? CI rollout + "seconds later serving traffic" — either works. I'll use `2` (staging HA-ish) — hmm, `1` is more minimal. I'll pick `2` with an assumption note. Actually, fewer assumptions is better: replicas 2 is standard for a service with a frontend. I'll keep `2` and one comment? The instruction: mark at the point it matters if a symbol is really missing. Image, namespace, and replicas are all genuinely missing. But three assumption comments is noisy... The convention says to mark unresolved items "at the point it matters." It matters for image (deployment correctness), namespace (runbook's `-n`), service port mapping (E2E correctness), curl image (runbook). I'll mark: image (deployment), namespace (once, in the deployment; the service inherits the same assumption — no need to repeat; actually, each file should be self-contained for a reader... I'll mark the namespace in the deployment and not repeat in the service; hmm, a reader of the service file alone... it's fine, the diagnosis ties them together). Actually, let me add `# ASSUMPTION:` to the deployment (image + namespace + replicas in one line) and the service (port mapping). Keep it tight.

Wait, the namespace assumption appears twice if I write it in both files. I'll put it only in the deployment with the comment; the service just uses `staging`. Acceptable.

Service (`manifests/api-service.yaml`):

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: staging
  labels:
    app: api
spec:
  type: ClusterIP
  selector:
    app: api
  ports:
    - name: http
      port: 80
      targetPort: http
      protocol: TCP
```

`targetPort: http` refers to the containerPort name `http` (3000). That ties the two manifests together nicely. Or explicit `targetPort: 3000`. I'll use the named port — cleaner and less assumption surface (it stays correct if the port moves). But if someone applies the service without the named port... the deployment has `name: http`. Consistent. OK.

`type: ClusterIP` — the default anyway; I'll omit `type` to be minimal? `ClusterIP` is the default; omitting is more minimal. But explicit is more readable... "change only what's wrong" — the original probably omitted it. I'll omit. Ports: the original probably had `port: 80, targetPort: 3000` (or 8080?). Not stated. I'll use `port: 80`, `targetPort: http`, with an assumption comment that the Service exposes 80 → container port 3000 (the ticket doesn't state the mapping).

Hmm, wait — actually, could the original Service's targetPort have been 8080 too (a consistent "8080" confusion)? If the original targetPort was 8080, the "no endpoints" fault still exists, and after fixing the selector + readiness, the targetPort 8080 would still break things (connections to 8080 on the pod are refused). The ticket lists exactly three faults and says "change only what's wrong, nothing else" — the targetPort is not listed as a fault, so the original targetPort must have been correct (3000 or the name). So I'll write targetPort 3000/http as-is (part of the correct baseline), not as a "fix." Good — my reconstruction: only the selector line is the fix in the Service file.

Same for the Deployment: only the readiness probe's `port: 3080` → no wait, 8080 → 3000 is the fix; everything else is baseline.

Now, the Ingress: described but fault-free, so I won't include the file. In diagnosis.md I can note: "Ingress reviewed; it routes to Service `api`; unaffected by the faults, no change needed." Good — shows I considered it.

diagnosis.md content — I'll write it carefully. The spec: "each symptom, its root cause, and the command whose output confirms it. State explicitly which symptoms share the fault."

Structure:

# Diagnosis — staging unreachable, no endpoints, CI rolling back

TL;DR table: four symptoms → three faults; symptoms 1 and 2 = Fault 1; symptom 3 = Faults 2 and 3; symptom 4 = Fault 3.

## Symptoms
S1: kubectl through the tunnel fails TLS, naming the host.
S2: the same kubeconfig works on the jump host.
S3: api pod is Running; frontend → api Service: connection refused.
S4: CI marks the api rollout unhealthy and rolls back; the app logs show it serving.

## Fault 1 — the API server cert has no SAN for `localhost`
The tunnel `ssh -L 6443:10.0.0.5:6443 jump` makes the client dial `https://localhost:6443`. TLS verification matches `localhost` against the cert's SANs, which are the control-plane's identity (e.g., `DNS:kubernetes, DNS:kubernetes.default, DNS:kubernetes.default.svc, IP:10.0.0.5`) — no `localhost` → handshake aborts. That's S1.
On the jump host, the server entry points at a name/IP the cert covers (the control-plane address), so the same auth works — that's S2. **S1 and S2 are the same fault**, not two.
Confirming:
```
# with the tunnel up
echo | openssl s_client -connect localhost:6443 -servername localhost 2>/dev/null \
  | openssl x509 -noout -ext subjectAltName
```
→ the `Subject Alternative Name` line lists the control-plane name/IPs and **does not** include `localhost`.
And kubectl's error names the mismatch:
```
kubectl get pods --kubeconfig ...
```
→ `tls: failed to verify certificate: x509: certificate is valid for kubernetes, kubernetes.default, kubernetes.default.svc, 10.0.0.5, not localhost`

Why the chosen fix: I can't re-point `server` at `10.0.0.5` (not routable from workstations — that's why the jump host exists), and kubectl has no supported "verify as a different name" knob; `insecure-skip-tls-verify` is banned. So: reissue the server cert with `DNS:localhost` added to the SANs (keeping the existing ones). Server-side, one-time; see runbook step 0. The kubeconfig and the tunnel are otherwise unchanged.

## Fault 2 — the Service selects pods the Deployment doesn't label
`api-service.yaml`: `selector: app: api-server`; the Deployment's template labels: `app: api`. → No endpoints. S3: the frontend dials the Service's ClusterIP, and with zero endpoints, the kube-proxy returns RST → connection refused, while the pod is fine (Running).
Confirming:
```
kubectl get svc api -n staging -o jsonpath='{.spec.selector}'   # {"app":"api-server"}
kubectl get endpoints api -n staging                            # ENDPOINTS <none>
kubectl get pods -n staging -l app=api                          # pods exist
```
Fix: the selector to `app: api` (align the Service to the Deployment's labels — the Deployment is the app's contract; changing the Deployment's labels instead would be more invasive and would require a re-roll). Hmm — which direction? The minimal change is either way, but the selector side is safer (label change = pod recreation, churn in all selectors). I'll state: change the selector to match the existing pod labels.

## Fault 3 — the readiness probe hits a port the app doesn't listen on
The probe: `httpGet /health:8080`; the container listens on 3000 → the probe fails forever → the pod is `Running` but READY `0/1`.
- S4: `kubectl rollout status` waits for readiness; it never gets it → CI judges the rollout unhealthy and rolls back. Meanwhile the app itself is up (serving on 3000 — the logs confirm) → "serving seconds later, CI rolls back."
- Compounding effect on S3: a pod that never becomes Ready is excluded from the Service's endpoints **even with a correct selector**. So S3 has two causes (Fault 2 + Fault 3); fixing the selector alone still leaves `ENDPOINTS <none>`.
Confirming:
```
kubectl get pods -n staging -l app=api     # 0/1 Running
kubectl describe pod <api-pod> -n staging  # Readiness probe failed: dial tcp <pod-ip>:8080: connect: connection refused
ss -ltnp in the pod / or:
kubectl exec <api-pod> -- wget -qO- http://127.0.0.1:3000/health   # 200 — the app is listening on 3000
```
(The pod's container may or may not have wget; alternative: `kubectl port-forward` + curl. I'll present one with a note.)

Hmm, `kubectl describe`'s event message for a failed httpGet on a refused port: `Readiness probe failed: Get "http://10.42.x.x:8080/health": dial tcp 10.42.x.x:8080: connect: connection refused`. Yes, that's the format. Good.

## Fix summary (what changed, where)
- `manifests/api-service.yaml`: selector `app: api-server` → `app: api`. (One line.)
- `manifests/api-deployment.yaml`: readinessProbe port 8080 → 3000. (One line.)
- Server-side: reissue the API server cert with `DNS:localhost` (documented in runbook step 0). Kubeconfig: no change — `https://localhost:6443` stays; no `insecure-skip-tls-verify` anywhere.
- Ingress: reviewed, no fault, no change.

Ordering note: apply the cert reissue (step 0) → you can even use kubectl to apply the manifest fixes; then the Deployment fix, then the Service (order between the two: fix the probe first so that when the selector matches, the pod is Ready — actually both must be true for endpoints; the order between them is immaterial, but I'll recommend the Deployment (readiness) first, then the Service selector, and then verify endpoints). Good operational nuance to include.

runbook.md — ordered, each step with command + expected output.

Title: Runbook — verify staging health end-to-end.
Precondition: jump host reachable, kubeconfig on the workstation, someone with access to the control plane (for step 0, one-time only).

### Step 0 (one-time, server-side) — Reissue the API server cert with `localhost` in the SANs
On the control plane (via `ssh jump` → `ssh 10.0.0.5` or kubectl exec... simpler: over ssh to the control-plane node):
```
cd /etc/kubernetes/pki
openssl req -new -key apiserver.key \
  -subj "/CN=staging-apiserver" \
  -addext "subjectAltName=DNS:localhost,DNS:kubernetes,DNS:kubernetes.default,DNS:kubernetes.default.svc,IP:10.0.0.5" \
  -out apiserver.csr
openssl x509 -req -in apiserver.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 365 -copy_extensions copyall -out apiserver.new.crt
sudo cp apiserver.new.crt apiserver.crt
sudo systemctl restart kubelet
```
Expected: no output (success); `systemctl is-active kubelet` → `active`.
Verify the served cert:
```
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -ext subjectAltName
```
→ includes `DNS:localhost`.
Note: keep the old SANs — the jump host's kubeconfig (which uses the control-plane address) must keep working.

Hmm wait — the CN: the original CN is unknown. If I change the CN... the apiserver cert is used for the server; the CN matters less (SANs are authoritative), and client certs verify *clients* by CN. I'll preserve "keep the existing CN" — better: `openssl req -subj` should reuse the existing CN: "use the current cert's CN (`openssl x509 -noout -subject`)." I'll phrase it: "keep the current subject (CN); only add `DNS:localhost` to the SAN." Good detail that shows rigor.

### Step 1 — Start the tunnel
```
ssh -N -f -L 6443:10.0.0.5:6443 jump
```
(-N no command, -f background. Or foreground in its own terminal; I'll show foreground `ssh -N -L ...` and note to keep it open.)
Confirm:
```
nc -vz localhost 6443
```
Expected: `Connection to localhost 6443 port [tcp/*] succeeded!` (nc's wording varies: `succeeded`.)

### Step 2 — The tunnel serves a cert that covers `localhost`
```
echo | openssl s_client -connect localhost:6443 -servername localhost 2>/dev/null \
  | openssl x509 -noout -ext subjectAltName
```
Expected:
```
X509v3 Subject Alternative Name:
    DNS:localhost, DNS:kubernetes, DNS:kubernetes.default, DNS:kubernetes.default.svc, IP Address:10.0.0.5
```
(failure mode before step 0: `DNS:localhost` missing.)

### Step 3 — kubectl can talk to the API through the tunnel
```
kubectl --kubeconfig ~/staging/kubeconfig get --raw /healthz
```
Expected: `ok`
(Negative check — no skip-verify in the config:)
```
grep -c 'insecure-skip-tls-verify' ~/staging/kubeconfig
```
Expected: `0`
Hmm, grep -c outputs 0 and exits 1 — that's fine, expected output `0`.

### Step 4 — Pods are Running and Ready
```
kubectl -n staging get pods -l app=api
```
Expected:
```
NAME    READY   STATUS    RESTARTS   AGE
api-xxxx-aaaa   1/1   Running   0   ...
```
(Both replicas `1/1`.)

### Step 5 — The Service has endpoints
```
kubectl -n staging get endpoints api
```
Expected:
```
ENDPOINTS             AGE
10.42.x.x:3000,10.42.x.y:3000   ...
```
(No `<none>`.)
And the selector sanity:
```
kubectl -n staging get svc api -o jsonpath='{.spec.selector}'
```
→ `{"app":"api"}`

### Step 6 — The app answers through the Service (in-cluster)
```
kubectl -n staging run api-e2e --rm -i --restart=Never \
  --image=curlimages/curl:latest -- \
  curl -sS -o /dev/null -w '%{http_code}\n' http://api:80/health
```
Expected: `200`
Cleanup happens automatically with `--rm` (the pod is deleted after it exits).

Hmm, `kubectl run ... --rm -i` — is `-i` needed? No stdin needed; `--rm` is enough. I'll keep `--rm --restart=Never`.

### Step 7 — End-to-end through the Service from the workstation (port-forward)
```
kubectl -n staging port-forward svc/api 18080:80
```
(other terminal)
```
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:18080/health
```
Expected: `200`
This exercises Service → endpoint → container port 3000.

Hmm, steps 6 and 7 overlap; the spec asks for "from the tunnel up to an end-to-end request" — one E2E is enough; but the two views (in-cluster and via the tunnel) are both nice. I'll keep both and be concise. Or drop 7 to keep it tight... "someone who has never seen this cluster can run it top to bottom and know staging is healthy" — the port-forward test is the "real" request from a user's vantage point. Keep both, and step 7 also covers the "still works through the tunnel" acceptance (kubectl via the tunnel). Fine.

### Step 8 — Rollouts are healthy (what CI was flagging)
```
kubectl -n staging rollout status deploy/api
```
Expected: `deployment "api" successfully rolled out`
(And after a deploy: no rollback.)

### Step 9 (optional) — Frontend → API path
The original symptom's path. E.g., from a frontend pod or via the Ingress host. The frontend is in-cluster, so:
```
kubectl -n staging exec deploy/frontend -- sh -c 'wget -qO- http://api:80/health || curl -sf http://api:80/health'
```
Too speculative about the image's tools. Alternative: I'll just note that step 6 covers the frontend's exact path (frontend → ClusterIP `api:80` → endpoints). I'll fold it into step 6's note rather than a separate step. Keep the runbook at 8 steps. Good.

Also a "if a step fails" quick table? The spec doesn't ask for it. "Do exactly what the task asks" — no extras. I'll skip a big troubleshooting section; maybe a one-liner per step noting the failure mode (I've been doing that inline). Fine.

Now: should I include the kubeconfig as a file? Decision: no (unchanged). But hmm, the deliverable says "corrected manifests/kubeconfig as minimal diffs" — I keep going back and forth. Let me settle it definitively: the kubeconfig contains no error; shipping it as a "corrected" file would be false (there's nothing to correct), and the format ban "don't restate files I wasn't asked to change" pushes against it. I'll explicitly state in diagnosis.md §Fix: "kubeconfig: unchanged — `server: https://localhost:6443` is correct; the defect was on the cert side." That closes the loop. Settled.

Directory naming: the repo is `staging-infra`. I'll put the manifests in a `manifests/` directory: `manifests/api-deployment.yaml`, `manifests/api-service.yaml`. The docs at the repo root: `diagnosis.md`, `runbook.md`. This is a defensible layout.

Now, one more nuance for the Deployment manifest: `selector.matchLabels` must equal the template label `app: api` — it was already correct in the original (not listed as a fault). I'll include it (needed for completeness).

Image: `registry.internal/staging/api:1.4.2`? I'm inventing a registry; I'll keep it generic: `registry.internal/staging/api:latest`? A tagged version is more realistic for CI rollbacks. I'll use `registry.internal/staging/api:1.4.2` with an assumption comment.

Wait, and the container `name`: `api`. The ports `name: http` — I chose that for the Service's targetPort. Is the named port an invention? Yes, but it's a standard practice and keeps the service/Deployment coupled. Alternatively, an explicit `targetPort: 3000`. I'll go with explicit `targetPort: 3000` in the Service — fewer moving parts, fewer assumptions (no dependency on the named port existing). Decision: `targetPort: 3000` in the Service, no `name` on the containerPort? `name` is optional. I'll leave `name: http`? Simpler: omit the name. Final:

Deployment container:
```
ports:
  - containerPort: 3000
```
Service:
```
ports:
  - name: http
    port: 80
    targetPort: 3000
    protocol: TCP
```
Service port `name: http` is conventional and harmless.

Assumption comments (YAML `#`):
- Deployment: on the image line: `# ASSUMPTION: image/tag not given in the ticket; replace with the team's registry path`. On the namespace line: `# ASSUMPTION: namespace not specified; adjust if the app lives elsewhere` — but the runbook hardcodes `-n staging`... I'll make the runbook consistently use `staging` and note once in the runbook that "if your cluster uses a different namespace, substitute it in every command." Better to keep the runbook clean: I'll add one line at the top: "Every command assumes namespace `staging`; substitute if different." And in the YAML, one assumption comment on the deployment's namespace; the service just uses staging (the same assumption is covered by the deployment's comment? A reader of the service file alone... I'll add a short one-liner in the service too? Hmm. I'll put `# ASSUMPTION: namespace not specified (see diagnosis.md)` in both. Slightly redundant but self-contained. OK, fine — one line each.
- Replicas: 2 — is that assumption worth a comment? It affects the expected output in the runbook (the "two pods" list). I'll add to the runbook instead: "expected: one row per replica (2 in the shipped manifest)." Or I just make the runbook's expected output representative: `api-6d9f8b7c4-xxxxx 1/1 Running` and `api-6d9f8b7c4-yyyyy 1/1 Running`. Fine, I'll show two rows without a comment. And in the YAML: I won't comment on replicas... the "missing symbol" rule: replicas is genuinely missing. To be safe: one combined comment on the deployment spec: `# ASSUMPTION: replicas=2, image, and namespace are not specified in the ticket; adjust to the cluster` — hmm, "adjust to the cluster" is vague. Let me do this:
  - On the image line: `# ASSUMPTION: image and tag were not provided with the ticket`
  - On the namespace line (deployment): `# ASSUMPTION: namespace not specified; runbook assumes staging`
  - On the namespace line (service): same short comment.
  - On the service port line: `# ASSUMPTION: Service listens on 80 -> container 3000 (mapping not specified)`
  - Replicas: leave `replicas: 2` without a comment — a replica count is a normal baseline detail and the runbook says "one row per replica." Defensible without a comment. Hmm, strictly it's a missing symbol... but it doesn't matter for any fix or verification. I'll leave it clean.

Also, should the Deployment have a `strategy` for the CI rollback story? No — keep it minimal.

One more check on the runbook step 6 image: `curlimages/curl:latest` — real image on Docker Hub. Fine. Or `alpine` with `wget -qO-`? The curl image is more direct. I'll keep it.

Now, the "evidence" commands in diagnosis — the spec: "the command/ evidence that confirms it." I'll make sure each fault section has a command + what its output showed. Also the fault 1 symptom 2 confirmation: "on the jump host: `ssh jump` then `KUBECONFIG=... kubectl get pods` works — because the server entry there is `https://10.0.0.5:6443` (the SAN-covered name)." Command: `grep server ~/staging/kubeconfig` on the jump host → `server: https://10.0.0.5:6443`. Hmm — is that jump host kubeconfig's server entry given? The ticket says "the API works if you export KUBECONFIG on the jump host itself" — a separate kubeconfig on the jump host, and the L2-spec says: "on the jump host the server entry is the address the cert covers." So I can state: the jump host's kubeconfig's `server` is `https://10.0.0.5:6443` (or a DNS name the cert covers). The exact value is an assumption; I'll phrase it: "the server entry there names the control plane (e.g., `https://10.0.0.5:6443`) — a SAN the cert covers." With "e.g." it's safe.

Also, the spec says the symptoms were "reported by 3 people" and such — not needed in the deliverable.

Let me also re-check the exact wording of Go's TLS error for a kubectl name mismatch. When kubectl dials `https://localhost:6443` with a valid chain but no `localhost` in the SANs, the error is:
`The server could not set up a secure connection to https://localhost:6443: tls: failed to verify certificate: x509: certificate is valid for kubernetes, kubernetes.default, kubernetes.default.svc, 10.0.0.5, not localhost`

I've seen `x509: certificate is valid for <list>, not <host>` — hmm, actually, I recall Go's message being: "x509: cannot validate certificate for localhost because it doesn't contain any IP SANs" (only when host is IP). For a DNS host: `x509: certificate is valid for CN=... `? Let me think about the actual kubectl error I've seen:

```
E0501 ... The connection to the server localhost:6443 was refused - did you specify the right host or port?
```
That's when no tunnel. For a name mismatch:
```
tls: failed to verify certificate: x509: certificate is valid for 192.168.1.5, not localhost
```
Yes — I'm confident this format exists in Go: in `x509`'s `validForName`/`HostnameToIP`... the error is constructed in `certificate.validForNames`... `&CertificateInvalidError{Cert: cert, Name: name}` → `fmt.Sprintf("certificate is valid for %s, not %s", strings.Join(cert.DNSNames... plus IPs...), name)`? Hmm, `CertificateInvalidError.Error()`: "x509: certificate is valid for " + strings.Join(dnsNames, ", ") + ", not " + e.Name. Yes. So the message lists DNS names (and IP SANs formatted as IP strings) — good, my phrasing is accurate. I'll present it with the likely SAN list and note "(the SAN list will be whatever the current cert contains — the point is: no `localhost`, and the error names it)."

For the runbook, the key expected output for the *post-fix* state is what matters (it's a verification runbook), and diagnosis carries the pre-fix evidence.

Also: runbook step 3 negative grep: `grep -c insecure-skip-tls-verify` outputs `0`. But the exit code 1 makes the run "fail" in a strict script; I'll just present it as a check with expected output `0`. Fine.

Let me also think about the `kubectl get --raw /healthz` output: `ok` (with a newline). Yes.

`kubectl get endpoints api` output format:
```
NAME   ENDPOINTS             AGE
api    10.42.1.5:3000,10.42.2.9:3000   5d
```
Good.

`kubectl -n staging get pods -l app=api`:
```
NAME                 READY   STATUS    RESTARTS   AGE
api-7b9f6c5d8-4k2lm   1/1     Running   0          12m
api-7b9f6c5d8-9x7pn   1/1     Running   0          12m
```
Good.

`rollout status`: `deployment "api" successfully rolled out`. Good.

The describe pod events for the pre-fix evidence (in diagnosis):
```
Warning  Unhealthy  ...  Readiness probe failed: Get "http://10.42.1.5:8080/health": dial tcp 10.42.1.5:8080: connect: connection refused
```
Good, that's the actual k8s event wording.

The curl error pre-fix (in diagnosis, as an alternative evidence for fault 1):
```
curl: (51) SSL: certificate subject name 'kubernetes' does not match target host 'localhost'
```
Hmm — modern curl uses SANs; the message might be `curl: (51) SSL: could not verify hostname...`? Let me not over-specify; I'll use the kubectl error (Go format, confident) and the openssl SAN dump (definitive evidence). I'll drop the curl error from diagnosis, or mention it loosely: "curl through the same tunnel fails with a hostname-mismatch SSL error (exit 51/60)." I'll keep it to one line.

Now — the runbook's step 0 (server-side) — how does a runbook reader get to the control plane? Via the jump host: `ssh jump` then `ssh 10.0.0.5` (or `sudo -i`). I'll write: "on the control-plane node (via `ssh jump && ssh 10.0.0.5`)." Fine.

Also, step 0 must not break the jump host's access: keep the old SANs (IP 10.0.0.5, etc.) — I'll call that out explicitly: "preserve every existing SAN and add `DNS:localhost`."

And after the kubelet restart, the apiserver may take a few seconds; I'll note re-checking step 2. Also: does changing the apiserver cert require a kubelet restart? The kubelet serves the apiserver cert; the kube-apiserver process loads the cert at startup — restarting the kubelet restarts the static pod (kubelet manages the apiserver static pod) → yes, `sudo systemctl restart kubelet` brings the new cert up. Standard procedure. Good.

Alternatively `kubeadm certs renew apiserver` — but that regenerates with kubeadm's SANs (control-plane IP/hostname), not `localhost` — I'll note in the diagnosis: "why not `kubeadm certs renew`: it regenerates with the control-plane's identity only; a manual re-sign with the extended SAN list is needed." A nice detail for rigor. I'll include a short note in the diagnosis's fix section.

Now, let me write the final files. Order in the reply: any order is fine; the parser takes the last occurrence per path (I'll use each path once). I'll do: diagnosis.md, runbook.md, manifests/api-deployment.yaml, manifests/api-service.yaml.

Let me write the diagnosis.md in full:

```markdown
# Diagnosis — staging behind the jump host

Four symptoms were reported. They are **three faults**: symptoms 1 and 2 are one
fault, and symptom 3 is produced by two faults. Fixing any of the three in
isolation does not make staging healthy; all three must land.

## Symptoms and the fault behind each

| # | Symptom | Fault |
|---|---------|-------|
| 1 | `kubectl get pods` through the tunnel fails with a TLS error that names the hostname | **F1** |
| 2 | The same kubeconfig works when exported on the jump host | **F1** |
| 3 | The `api` Deployment shows `Running`, but the frontend gets connection refused through the `api` Service | **F2 + F3** |
| 4 | CI flags `api` rollouts "unhealthy" and rolls them back, while the app logs show it serving | **F3** |

## F1 — the API server certificate does not cover `localhost`

The workstation reaches the API through `ssh -L 6443:10.0.0.5:6443 jump`, so the
client dials `https://localhost:6443`. TLS verification checks the name in that
URL against the certificate's SANs. The certificate carries the control-plane's
identity (its address `10.0.0.5` and the `kubernetes` service names), not
`localhost`, so verification aborts:

- **Symptom 1.** From the workstation, with the tunnel up:

  ```sh
  kubectl -n staging get pods
  # The server could not set up a secure connection to https://localhost:6443:
  # tls: failed to verify certificate: x509: certificate is valid for
  # kubernetes, kubernetes.default, kubernetes.default.svc, 10.0.0.5, not localhost
  ```

  Decisive evidence — the served certificate's SAN list (tunnel up):

  ```sh
  echo | openssl s_client -connect localhost:6443 -servername localhost 2>/dev/null \
    | openssl x509 -noout -ext subjectAltName
  # X509v3 Subject Alternative Name:
  #     DNS:kubernetes, DNS:kubernetes.default, DNS:kubernetes.default.svc, IP Address:10.0.0.5
  ```

  `localhost` is absent. (curl through the same tunnel fails the same way with a
  hostname-mismatch SSL error.)

- **Symptom 2.** On the jump host the `server` entry in the exported kubeconfig
  points at the control-plane address the certificate actually covers, so the
  same credentials verify fine there:

  ```sh
  ssh jump
  grep 'server:' ~/staging/kubeconfig
  # server: https://10.0.0.5:6443
  KUBECONFIG=~/staging/kubeconfig kubectl get pods -n staging   # works
  ```

  **Symptoms 1 and 2 are the single fault F1** — one certificate, two vantage
  points. Counting them as two problems leads to "fixing" the kubeconfig instead
  of the certificate.

**Fix.** Re-issue the API server certificate with `DNS:localhost` added to the
SANs, keeping every existing SAN (the jump-host path must keep working). This is
a server-side change on the control plane; exact steps are in `runbook.md`, step 0.

Why not the alternatives:

- Pointing `server` at `https://10.0.0.5:6443` fixes the name but breaks the
  connection — `10.0.0.5` is not routable from workstations; that is why the
  jump host and the tunnel exist.
- kubectl has no supported "verify as a different name" option;
  `insecure-skip-tls-verify` is explicitly out of scope.
- `kubeadm certs renew apiserver` re-signs with the control-plane identity only;
  the SAN list must be extended by hand, which is why step 0 shows the manual
  re-sign.

The kubeconfig itself is **unchanged**: `server: https://localhost:6443` is
correct once the certificate covers `localhost`.

## F2 — the Service selects pods the Deployment never labels

`manifests/api-service.yaml` selects `app: api-server`;
`manifests/api-deployment.yaml` labels its pods `app: api`. No pod matches, so
the Service has no endpoints, and kube-proxy refuses every connection to its
ClusterIP:

- **Symptom 3 (first cause).** From a client (e.g. the frontend pod):

  ```sh
  kubectl -n staging get svc api -o jsonpath='{.spec.selector}'
  # {"app":"api-server"}
  kubectl -n staging get pods -l app=api
  # NAME   READY   STATUS    RESTARTS   AGE   <- pods exist and run
  kubectl -n staging get endpoints api
  # NAME   ENDPOINTS   AGE
  # api    <none>      5d
  curl -v http://api:80/   # from a pod in the namespace
  # * Connection refused
  ```

  The pod is `Running` because its *container* is healthy; the refused
  connection happens at the Service layer, before any pod is selected.

**Fix.** One line in `manifests/api-service.yaml`:
`selector: app: api-server` → `app: api`, matching the labels the Deployment
already ships. (Aligning the Deployment's labels to the Service would force a
full pod churn to change which labels exist, for the same result.)

## F3 — the readiness probe targets a port the app does not listen on

The probe hits `/health` on port **8080**; the container listens on **3000**.
The probe can never succeed, so every pod stays `0/1` ready for its whole life:

- **Symptom 4.** CI waits on the rollout's readiness (`kubectl rollout
  status`), which never completes, so it declares the rollout unhealthy and
  rolls back — while the app has been serving on 3000 the whole time, which the
  logs show:

  ```sh
  kubectl -n staging get pods -l app=api
  # NAME   READY   STATUS    RESTARTS   AGE
  # api-...  0/1    Running   0          4m     <- Running, but never Ready

  kubectl -n staging describe pod api-... | grep -A2 Events
  # Warning  Unhealthy  ...  Readiness probe failed:
  #   Get "http://10.42.x.x:8080/health": dial tcp 10.42.x.x:8080: connect: connection refused

  kubectl -n staging exec api-... -- sh -c 'wget -qO- http://127.0.0.1:3000/health'
  # 200 OK  <- the app is listening on 3000
  ```

- **Symptom 3 (second cause).** Kubernetes excludes a pod that is not Ready
  from a Service's endpoint list *regardless of labels*. So even with F2 fixed,
  `ENDPOINTS` stays `<none>` until the probe can pass. **Fixing the selector
  alone does not clear the connection-refused symptom.**

**Fix.** One line in `manifests/api-deployment.yaml`: readiness probe
`port: 8080` → `port: 3000`.

## What changed, where

| Artefact | Change | Fault |
|----------|--------|-------|
| `manifests/api-service.yaml` | selector `app: api-server` → `app: api` | F2 |
| `manifests/api-deployment.yaml` | readinessProbe port `8080` → `3000` | F3 |
| API server certificate (control plane) | re-issued with `DNS:localhost` added, all existing SANs kept | F1 |
| kubeconfig | **unchanged** — no `insecure-skip-tls-verify`, `server` stays `https://localhost:6443` | — |
| Ingress | reviewed, no fault, unchanged | — |

Apply the certificate re-issue first (step 0 in `runbook.md`), then the
Deployment fix, then the Service selector — after the probe passes, the
selector's match immediately produces endpoints. Verify top to bottom with
`runbook.md`.
```

Hmm wait, the `wget` in the exec: the container may not have wget; I'll keep it with a hedge: "(any tool the image ships, e.g. `wget -qO-` or `curl -s`)". I'll keep the command as `wget -qO-` with the expected `200 OK`... does wget -qO- output the body and not "200 OK"? `wget -qO-` outputs the body quietly. The body is unknown. Better: use `curl -s -o /dev/null -w '%{http_code}'` → `200`. But curl may not be in the container either. Honestly, for the diagnosis evidence, the describe-pod event + pod `0/1` is enough. The exec probe is a nice extra; I'll present it as: "and the app itself answers on 3000" with the command `kubectl port-forward` alternative? Overkill for the diagnosis. I'll keep the exec line and add a note "(swap in whatever the image ships — the point is 3000 answers, 8080 does not)." And expected output: `200` / the app's health body. I'll write:

```sh
kubectl -n staging exec api-... -- curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/health
# 200
```
With a note. Fine.

Now the runbook.md:

```markdown
# Runbook — verify staging end-to-end

Run top to bottom from a workstation that can reach the jump host. Namespace
`staging` is assumed throughout; substitute yours if different. Each step
states what it must print; any deviation is a stop signal for that step's fault
(see `diagnosis.md`).

## Step 0 — (one-time, server-side) re-issue the API server cert with `DNS:localhost`

Performed on the control-plane node (via `ssh jump && ssh 10.0.0.5`). Add
`DNS:localhost` to the SANs; **keep every existing SAN** so the jump-host
kubeconfig keeps working.

```sh
cd /etc/kubernetes/pki
# note the current subject and SANs so you preserve them
openssl x509 -in apiserver.crt -noout -subject -ext subjectAltName

openssl req -new -key apiserver.key \
  -subj "$(openssl x509 -in apiserver.crt -noout -subject | sed 's/^subject=//')" \
  -addext "subjectAltName=DNS:localhost,DNS:kubernetes,DNS:kubernetes.default,DNS:kubernetes.default.svc,IP:10.0.0.5" \
  -out apiserver.csr

openssl x509 -req -in apiserver.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 365 -copy_extensions copyall -out apiserver.new.crt

sudo cp apiserver.new.crt apiserver.crt
sudo systemctl restart kubelet
systemctl is-active kubelet
# active
```

Expected: `active`. (The kubelet restarts the apiserver static pod with the new
certificate; allow a few seconds.)

## Step 1 — bring the tunnel up

```sh
ssh -N -L 6443:10.0.0.5:6443 jump
# keep this running; in another shell:
nc -vz localhost 6443
```

Expected: `Connection to localhost 6443 port [tcp/*] succeeded!`
(If it is refused: the tunnel did not come up — check the jump host and
that nothing else binds local 6443.)

## Step 2 — the served certificate now covers `localhost`

```sh
echo | openssl s_client -connect localhost:6443 -servername localhost 2>/dev/null \
  | openssl x509 -noout -ext subjectAltName
```

Expected:

```
X509v3 Subject Alternative Name:
    DNS:localhost, DNS:kubernetes, DNS:kubernetes.default, DNS:kubernetes.default.svc, IP Address:10.0.0.5
```

(If `DNS:localhost` is missing, step 0 did not take — check the served cert's
serial against `/etc/kubernetes/pki/apiserver.crt`.)

## Step 3 — kubectl reaches the API through the tunnel, without weakening verification

```sh
grep -c 'insecure-skip-tls-verify' ~/staging/kubeconfig
# 0
kubectl --kubeconfig ~/staging/kubeconfig get --raw /healthz
# ok
```

## Step 4 — the api pods are Running *and* Ready

```sh
kubectl -n staging get pods -l app=api
```

Expected — one row per replica, READY `1/1` (not `0/1`):

```
NAME                 READY   STATUS    RESTARTS   AGE
api-7b9f6c5d8-4k2lm   1/1     Running   0          12m
api-7b9f6c5d8-9x7pn   1/1     Running   0          12m
```

(`0/1 Running` means the probe is still failing — see F3 in `diagnosis.md`.)

## Step 5 — the Service selects the pods and has endpoints

```sh
kubectl -n staging get svc api -o jsonpath='{.spec.selector}'
# {"app":"api"}
kubectl -n staging get endpoints api
```

Expected — a pod IP on port 3000 per replica, **not** `<none>`:

```
NAME   ENDPOINTS                        AGE
api    10.42.1.5:3000,10.42.2.9:3000    5d
```

## Step 6 — end-to-end request: in-cluster client → Service → container

This is exactly the path the frontend uses (`api:80` → endpoint → port 3000):

```sh
kubectl -n staging run api-e2e --rm --restart=Never \
  --image=curlimages/curl:latest -- \
  curl -sS -o /dev/null -w '%{http_code}\n' http://api:80/health
```

Expected: `200`
(the pod `api-e2e` is deleted by `--rm` when the job exits.)

## Step 7 — end-to-end request: from the workstation, through the tunnel

```sh
kubectl -n staging port-forward svc/api 18080:80
# in another shell:
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:18080/health
```

Expected: `200`

## Step 8 — rollouts are healthy (the check CI was failing)

```sh
kubectl -n staging rollout status deploy/api
```

Expected: `deployment "api" successfully rolled out`

If every step printed what it was supposed to, staging is healthy: the tunnel
verifies the API's real certificate, the Service fronts live endpoints, the app
answers through them, and rollouts complete.
```

Wait, step 3's `grep -c` prints `0` and exits 1 — the comment `# 0` indicates the expected output. Fine.

One thing: step 0's `-subj "$(openssl x509 ... -noout -subject | sed ...)"` — the subject format is `/CN=...`. The openssl x509 output: `subject=CN = staging-apiserver` (spaces around `=` in newer openssl). Using the raw string for `-subj` — does openssl req accept `/CN=...` format, and does it also accept `CN = ...`? `-subj` expects the "name" format `/CN=value`. The sed'd `CN = staging-apiserver` may not parse. Safer: instruct to copy the CN manually: "-subj '/CN=<existing-CN>' (from the subject printed above)". Simpler and less error-prone. I'll rewrite:

```sh
# 1. note the current subject CN and SANs — you must preserve both
openssl x509 -in apiserver.crt -noout -subject -ext subjectAltName

# 2. CSR with the same CN, old SANs plus DNS:localhost
openssl req -new -key apiserver.key \
  -subj "/CN=<existing-CN-from-step-1>" \
  -addext "subjectAltName=DNS:localhost,<existing-SANs-from-step-1>" \
  -out apiserver.csr

# 3. sign with the cluster CA
openssl x509 -req -in apiserver.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 365 -copy_extensions copyall -out apiserver.new.crt

sudo cp apiserver.new.crt apiserver.crt
sudo systemctl restart kubelet
systemctl is-active kubelet
# active
```

Placeholder `<existing-...>` is honest and correct practice. Good.

Hmm, `-copy_extensions copyall` is OpenSSL 3.0+. Node 20 era... a modern control plane likely has OpenSSL 3. Fallback note? Keep it; this is a staging control plane. I could add "(OpenSSL 3.x; on 1.1.x put the SANs directly in the req via -addext, which is also 1.1.1+...)" — actually, `-addext` in `openssl req` is 1.1.1+, and `-copy_extensions` in `x509` is 3.0+. On 1.1.1 you'd sign with `openssl x509 -req -extfile <(echo "subjectAltName=...")`. I'll add a one-line note: "on OpenSSL 1.1.x, move the `subjectAltName` into an `-extfile` for the sign step." One line, keeps rigor without bloat. Hmm, "don't improve beyond the task" — this is part of documenting the server-side change correctly; one line is fine. Actually, let me keep the runbook lean and drop the version note... the task says the runbook is for "someone who has never seen this cluster" — a version note is genuinely useful. I'll keep one short parenthetical. Fine.

Also, in the runbook, should I mention that the tunnel port 6443 may conflict if another cluster uses it? A note in step 1 covers "nothing else binds local 6443." Good.

Now the final manifests.

`manifests/api-deployment.yaml`:

```yaml
# Staging API deployment.
# ASSUMPTION: image, tag, and namespace were not given with the ticket; adjust to the cluster.
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: staging
  labels:
    app: api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: registry.internal/staging/api:1.4.2
          ports:
            - containerPort: 3000
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 3
            periodSeconds: 5
```

Hmm — `initialDelaySeconds`/`periodSeconds` are inventions. The original probably had some probe timing. Minimal reconstruction: just httpGet path + port? A probe without any timing is valid (defaults). I'll keep it minimal — only `httpGet.path` and `httpGet.port`. That makes the "one line changed" diff maximally clear. Decision: drop the timing.

Wait — but the comment at the top "Staging API deployment" + the assumption line — the convention says to mark at the point it matters; a top comment that spans the image is a bit off. I'll put the assumption on the image line, and the namespace assumption on the namespace line:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: staging # ASSUMPTION: namespace not specified in the ticket
  labels:
    app: api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: registry.internal/staging/api:1.4.2 # ASSUMPTION: image/tag not given in the ticket
          ports:
            - containerPort: 3000
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
```

`replicas: 2` — no comment (a baseline detail, noted in the runbook as "one row per replica"). OK.

`manifests/api-service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: staging # ASSUMPTION: namespace not specified in the ticket
  labels:
    app: api
spec:
  selector:
    app: api
  ports:
    - name: http
      port: 80 # ASSUMPTION: Service->container mapping not given; 80 -> 3000
      targetPort: 3000
      protocol: TCP
```

Good. Both files are small, complete, and the fixes are visible.

Wait — do I need `protocol: TCP`? The default is TCP; minimal → drop it? It's a common baseline. "Change only what's wrong" applies to changes against the original; my reconstruction should be plausible-baseline. I'll drop `protocol` for leanness... actually, most real Service manifests I've seen omit protocol. Drop it.

And `name: http` on the Service port — omit? Common to have. Keep it, harmless.

Now, one more re-check on the deliverable "corrected manifests/kubeconfig as minimal diffs": my two YAML files are the corrected manifests, minimal (only the fixed lines differ from the broken versions described). The cert fix is documented. The kubeconfig is unchanged (stated). I'm satisfied.

The format: level-3 heading with only the path, followed by a fenced block with only the content. No prose outside (prose is ignored, but I'll keep it minimal — actually, the instructions say to keep it to nothing; I'll output only the headings and blocks). Language tag for the fence: I'll use `markdown` for .md, `yaml` for .yaml. The example shows `ts`/`prisma` tags — the tag is fine; the parser probably reads the block content regardless. I'll use the appropriate tags.

Let me double-check the YAML validity mentally and the markdown's fenced blocks inside markdown files: diagnosis.md and runbook.md contain ```sh fenced code blocks inside my outer ```markdown fence — that's fine; the outer fence is triple backticks and the inner is triple backticks... wait, that's a problem! If the outer fence is ``` and the inner content has ```, the inner ``` will close the outer block!

The format: "one fenced block containing only that file's contents." If a file's contents themselves contain triple-backtick code fences, nesting inside a triple-backtick outer fence breaks the parsing. I must use a longer outer fence: four backticks ```` for the outer. The example uses triple, but for files containing fences I should use a 4-backtick fence (standard markdown nested fences). The parser says "one fenced block" — a 4-backtick fence is still a fenced block. I'll use ````markdown and ````yaml as needed. For the YAML files, the contents have no backticks → triple is fine, but I could consistently use 4 for all. Hmm, is there a risk the parser only recognizes exactly triple backticks? The instructions' example shows triple. But the mechanical parser for "fenced block" — a robust one handles longer fences. The markdown files *require* a longer outer fence (otherwise the content is corrupted — the first inner ``` closes the outer). There's no way to include a ``` code block in a markdown file inside a triple-fence. So I must use a 4-backtick outer fence for diagnosis.md and runbook.md. For the YAML, the content has no backticks → I'll use a 4-backtick fence there too for consistency? If the parser is strict about triple, triple is safer for the YAML... but then it's inconsistent across files. I think a sane parser handles ````. Risk assessment: using triple for the markdown files *breaks the content* — catastrophic. Using 4 everywhere — at worst the parser handles 4 (99% of parsers are line-based fence detectors matching ``` or more). I'll use 4-backtick fences for all four files. Actually, hmm, let me reconsider: "nothing outside that pattern is read." The pattern is heading + fenced block. A fenced block = a line of 3+ backticks (with an info string), then content, then a closing line. Standard. I'll go with ````.

Alternative: avoid inner fences in the markdown files by using indented code blocks (4-space indent)? Then the outer could be triple. But indented blocks inside a fenced markdown are still fine... but readability of the delivered .md file matters (a human will read diagnosis.md). Inner triple-backtick blocks with `sh` highlighting are far better for a diagnosis doc. So: inner triple, outer quadruple. Final decision.

Now let me write it all out carefully. Also the note "paths that appear twice are taken once at the last occurrence" — I'll use each path once.

Let me finalize the diagnosis.md text (tightened, no reference material). I must not reproduce the reference material — I'll write it in my own words. My draft above is in my own words. Fine.

One more consideration: the runbook's "Step 0" being one-time and server-side — the spec's "someone who has never seen this cluster can run it top to bottom" — the cert reissue is already done after the fix is shipped (the artifact is the fix). But the runbook should verify it; step 0 as "one-time" is the documented change + verification. I'll frame step 0 as "only if the certificate does not yet cover localhost" — i.e., a prerequisite check: first check, then re-issue if needed. Better: step 0 = "confirm the cert covers localhost (and re-issue once if not)." That way, top-to-bottom running works in both the fresh-fix and post-fix worlds. I'll structure it:

## Step 0 — API server cert covers `localhost` (one-time server-side fix)
First check from the workstation (tunnel from step 1 is not up yet... hmm, order: checking the SAN needs the tunnel. Order: step 1 tunnel, step 2 cert check, then re-issue if missing? But then the re-issue step is sandwiched. Alternatively, step 0 = the tunnel, step 1 = cert check with an embedded "if missing, do the server-side re-issue, then re-run this step." That's cleaner operationally:

1. Tunnel up.
2. Check the served cert's SANs → expected `DNS:localhost`. If missing: do the documented server-side re-issue (shown inline or in an appendix), restart the kubelet, re-run step 2.
3. kubectl /healthz + no skip-verify.
4. Pods 1/1.
5. Endpoints.
6. In-cluster E2E.
7. Workstation E2E.
8. Rollout status.

Yes — I'll reorder: the tunnel first (everything depends on it), then the cert gate. The re-issue block sits inside step 2 as a "if it fails" action. That's how a runbook reads.

Let me restructure the runbook:

# Runbook — staging end-to-end verification
Intro: workstation + jump host access; namespace assumption; run top to bottom; each step states expected output; stop on deviation.

## 1. Bring the tunnel up
`ssh -N -L 6443:10.0.0.5:6443 jump` (keep running; verify in another shell)
`nc -vz localhost 6443`
Expected: `Connection to localhost 6443 port [tcp/*] succeeded!`

## 2. The API's certificate covers `localhost`
The command; expected SAN line.
If `DNS:localhost` is missing — one-time server-side re-issue (on the control plane via `ssh jump && ssh 10.0.0.5`):
[the openssl block]
Then: `sudo systemctl restart kubelet` → `systemctl is-active kubelet` → `active`; wait ~10 seconds and re-run this step. Expected after re-run: the SAN line includes `DNS:localhost`.

## 3. kubectl through the tunnel, full verification
`grep -c insecure-skip-tls-verify ~/staging/kubeconfig` → `0`
`kubectl --kubeconfig ~/staging/kubeconfig get --raw /healthz` → `ok`
(If the TLS name error returns: step 2 not satisfied.)

## 4. Pods are Running and Ready
`kubectl -n staging get pods -l app=api` → expected table, `1/1`.
Note: `0/1` → probe fault (F3).

## 5. The Service has endpoints
selector jsonpath → `{"app":"api"}`
`kubectl -n staging get endpoints api` → expected IPs `:3000`, no `<none>`.
Note: `<none>` with the correct selector → pods not Ready (step 4).

## 6. End-to-end request — in-cluster (the frontend's exact path)
kubectl run curl → `200`.

## 7. End-to-end request — from the workstation via the tunnel
port-forward + curl → `200`.

## 8. Rollout health (the check CI was failing)
`kubectl -n staging rollout status deploy/api` → `deployment "api" successfully rolled out`

Closing line: if all steps printed the expected output, staging is healthy.

Good. Now — the expected output for `nc`: the wording of `-vz` is `Connection to localhost 6443 port [tcp/*] succeeded!`. On macOS/BSD nc: `Connection to localhost (localhost) port 6443 [tcp/*] succeeded`? I'll write the canonical GNU form and not fuss.

`curlimages/curl:latest` — fine.

Step 6 note: `--rm` requires kubectl ≥1.? (2018, kubectl 1.12?) — fine.

Also in step 6, if the cluster's image pull requires a pull secret, the pod may be ImagePullBackOff — I won't add a caveat; keep it lean. Hmm, "someone who has never seen this cluster" — one short note "(if the cluster needs a registry pull secret, add `--overrides`..." — no, too deep. Skip.

Let me re-check the diagnosis's symptom 3 evidence: `curl -v http://api:80/` from a pod — the frontend hits the Service; connection refused because no endpoints. The `curl -v` output shows `* connect to api port 80 from ... refused: Connection refused`. I'll show:

```sh
kubectl -n staging exec deploy/frontend -- curl -sv http://api:80/ 2>&1 | tail -1
# curl: (7) Failed to connect to api port 80: Connection refused
```
Assumes the frontend has curl — I'll hedge: "(any client pod with curl; the frontend pod or a one-off)." Fine.

I think I'm ready to write the final output. Length: substantive but focused. Let me finalize the wording and make sure no reference text is copied verbatim (paraphrase; short technical phrases like the fault descriptions are fine as facts).

Also, discipline: files to deliver — 4 files total. The task asked for diagnosis.md, the corrected artifacts (2 manifests + the documented cert reissue), and runbook.md. The Ingress is explicitly not delivered (no change) — I'll mention it in the diagnosis table. The kubeconfig is not delivered — I'll mention it in the diagnosis. I believe this satisfies "don't create files that aren't asked for."

Wait, should the cert re-issue steps go in their own file, e.g., `certs/reissue-apiserver.md`? The task's "deliver: 2. corrected manifests/kubeconfig as minimal diffs. TLS must be properly fixed (correct server name..., or documented SAN reissue)." "Documented" — in which document? The deliverables list has diagnosis.md and runbook.md; I'll document it in both (diagnosis: rationale; runbook: steps). A third file is not asked for. I'll keep it in the two docs. Final.

Now let me write the final content. Watch the nested fences: the outer is ```` (4 backticks), and the inner is ``` (3 backticks).

YAML assumption comments: keep them one line each.

Also, the Deployment: should I add `terminationGracePeriodSeconds` etc.? No. Minimal.

The final check on the runbook's step 2 re-issue block inside the markdown — it's a nested fenced block within the runbook file (inner triple). Fine.

I'll write it all now. I'll keep the diagnosis's table and sections. I'll make sure the "which symptoms share a fault" statement is explicit (it's in the intro + F1 + F3 sections + the table).

The word count/length is fine. Let me write the output.
```

## reply

### diagnosis.md
````markdown
# Diagnosis — staging behind the jump host

Four symptoms were reported; they are **three faults**. Symptoms 1 and 2 are one
fault, and symptom 3 is produced by **two** faults at once. Anyone counting four
independent problems will fix three things, ship, and still see connection
refused.

## Symptom → fault map

| # | Symptom | Fault(s) |
|---|---------|----------|
| 1 | `kubectl get pods` through the tunnel fails with a TLS error naming the hostname | **F1** |
| 2 | The API works when the kubeconfig is exported on the jump host itself | **F1** |
| 3 | The `api` Deployment shows `Running`, but the frontend gets connection refused through the `api` Service | **F2 + F3** |
| 4 | CI flags `api` rollouts "unhealthy" and rolls them back, while the app logs show it serving seconds later | **F3** |

## F1 — the API server certificate does not cover `localhost`

Workstations reach the API through `ssh -L 6443:10.0.0.5:6443 jump`, so the
client dials `https://localhost:6443`. TLS verification matches the name in that
URL against the certificate's SANs. The certificate carries the control plane's
identity — its address `10.0.0.5` and the `kubernetes` service names — but not
`localhost`, so the handshake aborts on the name.

**Symptom 1.** From the workstation, tunnel up:

```sh
kubectl -n staging get pods
# The server could not set up a secure connection to https://localhost:6443:
# tls: failed to verify certificate: x509: certificate is valid for
# kubernetes, kubernetes.default, kubernetes.default.svc, 10.0.0.5, not localhost
```

The decisive evidence is the SAN list of the certificate actually served on the
tunneled port:

```sh
echo | openssl s_client -connect localhost:6443 -servername localhost 2>/dev/null \
  | openssl x509 -noout -ext subjectAltName
# X509v3 Subject Alternative Name:
#     DNS:kubernetes, DNS:kubernetes.default, DNS:kubernetes.default.svc, IP Address:10.0.0.5
```

`localhost` is absent — that is the fault, isolated from everything else. (Any
TLS client on the workstation, e.g. `curl`, fails the same way with a
hostname-mismatch SSL error.)

**Symptom 2.** On the jump host the exported kubeconfig's `server` entry points
at the control-plane address the certificate *does* cover, so the same
credentials verify fine there:

```sh
ssh jump
grep 'server:' ~/staging/kubeconfig
# server: https://10.0.0.5:6443
KUBECONFIG=~/staging/kubeconfig kubectl get pods -n staging   # works
```

**Symptoms 1 and 2 are this single fault** — one certificate, two vantage
points. Treating them as two problems leads to "fixing" the kubeconfig instead
of the certificate.

**Fix.** Reissue the API server certificate with `DNS:localhost` added to the
SANs, keeping every existing SAN (the jump-host path must keep working). This
is a server-side change on the control plane; the exact procedure is in
`runbook.md`, step 2.

Why the alternatives are wrong:

- Pointing `server` at `https://10.0.0.5:6443` fixes the name and breaks the
  connection — `10.0.0.5` is not routable from workstations, which is exactly
  why the jump host and the tunnel exist.
- kubectl has no supported "verify as a different name" option, and
  `insecure-skip-tls-verify` (or anything equivalent) is out of scope.
- `kubeadm certs renew apiserver` re-signs with the control plane's identity
  only; the SAN list has to be extended by hand, which is why the runbook shows
  the manual re-sign.

The kubeconfig itself is **unchanged**: once the certificate covers
`localhost`, `server: https://localhost:6443` is already correct.

## F2 — the Service selects pods the Deployment never labels

`manifests/api-service.yaml` selects `app: api-server`;
`manifests/api-deployment.yaml` labels its pods `app: api`. No pod matches, so
the Service has no endpoints, and kube-proxy refuses every connection to its
ClusterIP.

**Symptom 3, first cause.** The container is healthy — the refusal happens at
the Service layer, before any pod is even selected:

```sh
kubectl -n staging get svc api -o jsonpath='{.spec.selector}'
# {"app":"api-server"}

kubectl -n staging get pods -l app=api
# NAME   READY   STATUS    RESTARTS   AGE    <- pods exist and run

kubectl -n staging get endpoints api
# NAME   ENDPOINTS   AGE
# api    <none>      5d

kubectl -n staging exec deploy/frontend -- curl -sv http://api:80/ 2>&1 | tail -1
# curl: (7) Failed to connect to api port 80: Connection refused
```

**Fix.** One line in `manifests/api-service.yaml`: selector `app: api-server`
→ `app: api`, matching the labels the Deployment already ships. (Aligning the
Deployment's labels to the Service instead would force a full pod churn for
the same result.)

## F3 — the readiness probe targets a port the app does not listen on

The probe hits `/health` on port **8080**; the container listens on **3000**.
The probe can never succeed, so every pod stays `0/1` ready for its whole
life.

**Symptom 4.** CI gates on rollout readiness (`kubectl rollout status`), which
never completes, so it declares the rollout unhealthy and rolls back — while
the app has been serving on 3000 the entire time, as its logs show:

```sh
kubectl -n staging get pods -l app=api
# NAME   READY   STATUS    RESTARTS   AGE
# api-...  0/1    Running   0          4m     <- Running, but never Ready

kubectl -n staging describe pod api-... | grep -A1 Unhealthy
# Warning  Unhealthy  ...  Readiness probe failed:
#   Get "http://10.42.x.x:8080/health": dial tcp 10.42.x.x:8080: connect: connection refused

kubectl -n staging exec api-... -- curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/health
# 200    <- the app answers on 3000 (use whatever HTTP client the image ships)
```

**Symptom 3, second cause.** Kubernetes excludes pods that are not Ready from
a Service's endpoint list *regardless of labels*. So even with F2 fixed,
`ENDPOINTS` stays `<none>` until the probe can pass. **Fixing the selector
alone does not clear the connection-refused symptom** — both F2 and F3 must
land.

**Fix.** One line in `manifests/api-deployment.yaml`: readiness probe
`port: 8080` → `port: 3000`.

## What changed, where

| Artefact | Change | Fault |
|----------|--------|-------|
| `manifests/api-service.yaml` | selector `app: api-server` → `app: api` | F2 |
| `manifests/api-deployment.yaml` | readinessProbe port `8080` → `3000` | F3 |
| API server certificate (control plane) | reissued with `DNS:localhost` added, all existing SANs kept | F1 |
| kubeconfig | **unchanged** — no `insecure-skip-tls-verify`; `server` stays `https://localhost:6443` | — |
| Ingress | reviewed; no fault; unchanged | — |

Ordering: certificate reissue first (runbook step 2), then the Deployment fix,
then the Service selector — once the probe passes, the corrected selector
immediately produces endpoints. Verify top to bottom with `runbook.md`.
````

### runbook.md
````markdown
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
````

### manifests/api-deployment.yaml
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: staging # ASSUMPTION: namespace not specified in the ticket
  labels:
    app: api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: registry.internal/staging/api:1.4.2 # ASSUMPTION: image/tag not given in the ticket
          ports:
            - containerPort: 3000
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
```

### manifests/api-service.yaml
```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: staging # ASSUMPTION: namespace not specified in the ticket
  labels:
    app: api
spec:
  selector:
    app: api
  ports:
    - name: http
      port: 80 # ASSUMPTION: Service->container mapping not given; frontend uses 80 -> 3000
      targetPort: 3000
```


---
