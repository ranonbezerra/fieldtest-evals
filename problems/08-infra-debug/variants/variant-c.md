# Variant C — CI deploy pipeline that lies

A small team deploys a containerized api via a CI script (build → push to
registry → SSH to host → `docker pull` + restart). Symptoms reported:

- CI is green, but production sometimes still runs the previous version after a
  "successful" deploy.
- Occasionally production serves a version that was never merged to main.
- The deploy step logs `Warning: TLS verification skipped` when talking to the
  registry; nobody knows since when.
- Rollbacks "work" but the app comes up with the new code anyway.

You are given the deploy script containing (among working steps): the image
built and pushed as `registry.local/api:latest` only; the remote host running
`docker pull registry.local/api:latest || true` before restart; `curl -k` used
for the registry health probe and `--insecure-registry` configured on the
daemon; CI triggering on every branch push with the same `latest` tag; the
"rollback" re-tagging `latest` locally on the host without pulling by digest.

Deliver:

1. `diagnosis.md` — each symptom → root cause (mutable tag deploys, swallowed
   pull failures, branch builds racing on one tag, tag-based rollback), with
   the evidence you'd collect (image digests on host vs registry, CI run
   history).
2. A corrected script as a minimal diff: immutable tags (commit SHA), deploy
   and rollback by digest/tag not `latest`, remove `|| true`, restrict CI
   trigger, restore TLS properly (fix the CA trust; no `-k`, no
   insecure-registry).
3. `runbook.md` — verification: deploy a known SHA, confirm the running digest
   matches, perform and verify a rollback.
