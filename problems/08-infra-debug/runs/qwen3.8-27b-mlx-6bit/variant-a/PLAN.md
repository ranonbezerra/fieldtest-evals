## 1. Assumptions

- Output files live at repo root: `diagnosis.md`, `runbook.md`, and a `fix/` directory containing unified-diff files. Reason: the task says "deliver" three items; a `fix/` dir keeps diffs separate from prose.
- "Minimal diffs" means unified-diff (`.diff`) files against the originals as described in the variant statement. Reason: applies with `patch -p0` and shows only changed lines.
- The TLS fix uses the "correct server name that the cert covers" path: change `server` in kubeconfig from `https://localhost:6443` to `https://10.0.0.5:6443`. Reason: no cert reissue needed; the runbook documents the required local IP alias (`ip addr add 10.0.0.5/32 dev lo` or equivalent) so the tunnel endpoint is reachable at that address.
- The Ingress manifest is unchanged; no symptom implicates it. It appears in the diagnosis only as context for the end-to-end request path in the runbook.
- The Service `targetPort` is `3000` (matching the container). The only Service bug is the selector label mismatch.
- The Deployment original has: label `app: api`, container image `<some-image>`, containerPort 3000, readinessProbe `httpGet /health:8080`. The fix changes the probe port to 3000.
- The Service original has: selector `app: api-server`, port 80, targetPort 3000. The fix changes the selector to `app: api`.

## 2. Data model

none

## 3. Types and signatures

No exported code types. The deliverables are documents and diffs with fixed structures:

**`diagnosis.md` structure:**
- Title: `# Staging Cluster — Symptom Diagnosis`
- One `## <symptom-N>: <one-line summary>` section per symptom (4 sections).
- Each section contains: `**Root cause:**` (one paragraph), `**Evidence / confirming command:**` (fenced code block with the command and expected output fragment), `**Related symptoms:**` (line naming other sections that share this fault or depend on it, or "none").
- A final `## Fault-grouping` section: a table mapping each symptom number to its fault group (e.g., "TLS hostname", "Service selector", "Probe port").

**`fix/*.diff` files:**
- Standard unified diff format. Header lines reference the original file path (e.g., `a/kubeconfig.yaml`, `b/kubeconfig.yaml`).
- `fix/kubeconfig.diff` — one hunk: the `server:` line.
- `fix/api-deployment.diff` — one hunk: the `port: 8080` → `port: 3000` in readinessProbe.
- `fix/api-service.diff` — one hunk: the selector label value `api-server` → `api`.

**`runbook.md` structure:**
- Title: `# Staging Cluster — Verification Runbook`
- Numbered steps (`## Step N: <title>`) in execution order.
- Each step: a fenced `bash` block with the command, then an **Expected** line or short block showing the key output to confirm success.
- Steps are ordered: prerequisites → tunnel → TLS check → pod status → service endpoints → end-to-end curl through Ingress.

**Error / failure modes documented in the runbook:**
- Each step notes the specific error message that means "stop, re-read diagnosis." (e.g., Step 3: if `curl -v https://10.0.0.5:6443/version` still shows a cert error, the IP alias is missing.)

**Ordering constraint:** `diagnosis.md` must reference the same file names and line-level changes that appear in the `.diff` files, so a reader can cross-check. The runbook's expected outputs must be consistent with the *post-fix* state.

## 4. Control flow

This is a documentation task; there is no runtime state machine. The logical verification chain the runbook encodes:

| Step | What it verifies | Depends on |
|------|-----------------|------------|
| 1 – IP alias | `ip addr show lo` lists `10.0.0.5/32` | Nothing |
| 2 – Tunnel | `ssh -L 6443:10.0.0.5:6443 jump` (background), then `nc -z 10.0.0.5 6443` succeeds | Step 1 |
| 3 – TLS handshake | `curl -sk https://10.0.0.5:6443/version` returns JSON with `gitVersion`; cert hostname matches | Step 2 |
| 4 – kubectl auth | `kubectl get nodes` (no flags) returns node list; confirms kubeconfig is valid post-fix | Step 3 |
| 5 – Pod readiness | `kubectl get pods -l app=api` shows `READY 1/1`; `kubectl describe pod` shows readiness probe on :3000 passing | Step 4 + deployment fix applied |
| 6 – Service endpoints | `kubectl get endpoints api` returns a non-empty IP list matching the pod IP | Step 5 + service fix applied |
| 7 – End-to-end via Ingress | `curl -s http://<ingress-host>/health` returns 200 JSON | Steps 5, 6 |

No step may be skipped. If any step's expected output is not met, the runbook says to stop and consult the matching section in `diagnosis.md`.

## 5. Tests

For a documentation deliverable, "tests" are structural and cross-consistency checks:

- `diagnosis.md` contains exactly four `## Symptom` sections and one `## Fault-grouping` table.
- Each symptom section names a root cause, a confirming command in a fenced block, and a related-symptoms line.
- The `fix/` directory contains exactly three `.diff` files; each is valid unified diff (applies with `patch --dry-run`).
- `fix/kubeconfig.diff` changes exactly one line: the `server:` value.
- `fix/api-deployment.diff` changes exactly one line: the readiness probe port.
- `fix/api-service.diff` changes exactly one line: the selector label value.
- The Ingress is NOT modified (no ingress diff file exists).
- `runbook.md` has 7 steps in the order specified in §4; each step has a command block and an expected-output annotation.
- The runbook's Step 3 uses `https://10.0.0.5:6443` (post-fix server), not `localhost`.
- No file contains the string `insecure-skip-tls-verify`.

## 6. Manifest

<!-- manifest
diagnosis.md | reads: - | symptom-to-root-cause mapping, confirming commands, fault-grouping table
runbook.md | reads: diagnosis.md | ordered 7-step verification from IP alias through end-to-end curl
fix/kubeconfig.diff | reads: diagnosis.md | one-line unified diff changing server URL to https://10.0.0.5:6443
fix/api-deployment.diff | reads: diagnosis.md | one-line unified diff changing readinessProbe port 8080→3000
fix/api-service.diff | reads: diagnosis.md | one-line unified diff changing selector label api-server→api
-->
