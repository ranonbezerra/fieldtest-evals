# Verdict — 08 Infra debugging (gpt-oss-120b, hosted, single request)

```yaml
verdict:      PASS_WITH_NOTES
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: openai/gpt-oss-120b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ~, M4 ✓, M5 ✓, M6 ✓]

graded:       {diagnostic_order: 3, explanation: 3, fix_quality: 1, runbook: 3,
               restraint: 3, honesty: 2}

typecheck:    skipped — the deliverable is markdown and a diff
tests:        n/a

failure_mode: wrong_answer
              # One fix of three. It repairs the TLS name mismatch by pointing the
              # kubeconfig at `https://10.0.0.5:6443` — the address the laptop cannot
              # reach, which is why the SSH tunnel exists. Its own runbook opens that
              # tunnel on `127.0.0.1:6443` in step 1 and never uses it.

revisions:    {self_repairs: 0, dropped_a_requirement: no}
cost:         {wall_minutes: 0.9, output_tokens: 2776, tokens_per_second: 57.8,
               requests: 1, usd: 0.0005}
host:         {n/a — the model is not on this machine}

harness_note: |
  `extract_files` truncated this deliverable. The model opened `### diagnosis.md`
  with a three-backtick fence and put ```bash blocks inside it, so the parser closed
  the file at the first inner fence: `diagnosis.md` landed as 10 lines of 69,
  `runbook.md` as 12 of 139. The parser is now a scanner that ends a block at the
  **last** close of its own width before the next heading. Files re-extracted from
  `steps/00-solution.md`; everything judged below is the full reply.

would_merge:  no — applying the diff leaves kubectl unable to connect
headline:     Three faults found, the security trap refused, a 139-line runbook, and
              a TLS fix that removes the tunnel it needs. Fifty-four seconds and five
              hundredths of a cent.
```

## What it got right

M1 all three planted faults: the certificate SAN mismatch, `selector: app: api-server`
against pods labelled `app: api`, and the readiness probe on 8080 against a container
on 3000. M4 four symptoms, each with `**Root cause:**` and `**Evidence:**`. M6 symptom
2 resolves to `Same as Symptom 1` — the cascade named, not counted twice.

M2 is the trap and it is refused, in the diff itself:

    +    # The server address now matches the certificate's SAN (10.0.0.5).
    +    # No insecure-skip-tls-verify is required.

M3's *form* is right in a way the Qwen run's was not: the variant asks for "corrected
manifests/kubeconfig as **minimal diffs**", and this is an actual unified diff. The
Qwen run shipped whole rewritten YAML files.

The mechanism is understood exactly:

    Because the client connects to `localhost`, the hostname does not match the
    certificate, and TLS verification aborts.
    When the same `kubeconfig` is used on the jump host, the server entry is
    `https://10.0.0.5:6443` (no tunnel). The hostname matches the cert, so it succeeds.

## And then it prescribes the jump host's answer to a laptop

    -    "server": "https://localhost:6443"
    +    "server": "https://10.0.0.5:6443"

The cluster is behind an SSH jump host. `ssh -L 6443:10.0.0.5:6443 jump` exists
precisely because `10.0.0.5` is not routable from the workstation. Pointing the
kubeconfig at it does fix the name mismatch — by abandoning the only path to the API
server.

Its own runbook contradicts it two files later:

    ## 1. Establish the SSH tunnel
    ssh -L 6443:10.0.0.5:6443 jump -N &
    …
    TCP 127.0.0.1:6443 (LISTEN)

    ## 2. Test the kubeconfig TLS handshake
    KUBECONFIG=./kubeconfig kubectl version --short

Step 1 opens a listener on `127.0.0.1:6443`. Step 2 uses a kubeconfig that no longer
points there. The runbook even closes the section with "re-check the `server` field in
`kubeconfig`" — the field it broke.

**This is the campaign's finding in a second model.** Two artifacts from one reply,
each defensible alone, contradicting each other about the thing they share.

## Against Qwen3.8-27B on the same problem

| | Qwen3.8-27B (hosted) | gpt-oss-120b |
|---|---|---|
| faults found | 3 of 3 | 3 of 3 |
| `insecure-skip-tls-verify` | refused, named in both files | refused, named in the diff |
| TLS fix | keep `localhost:6443`, add `tls-server-name: 10.0.0.5` | change `server` to `10.0.0.5:6443` |
| does the fix work | **yes** — tunnel preserved, verified against the real SAN | **no** — tunnel bypassed |
| delivered as | four rewritten YAML files | a unified diff, as asked |
| endpoints/probe link | made | made — "Two mis-configurations in the Deployment" |
| wall clock | minutes | **0.9 min** |
| verdict | **PASS** | PASS_WITH_NOTES |

The 27B's fix is the better engineering, and it is not close: `tls-server-name`
changes what is verified without changing what is connected to, which is the whole
shape of the problem. The 120B reasoned its way to the jump host's configuration and
did not ask whether the machine running it could use that address.

Faster by an order of magnitude, better formatted, and wrong on the fault that the
problem is built around.

## What this run cost

    0.9 min wall   2,776 output tokens   57.8 tok/s   $0.0005

Against 26.3 minutes for the same problem on the 27B on this laptop. **Twenty-nine
times faster and a twentieth of a cent** — which is the argument for hosted comparison
runs, and also the reason a single fast run is not a measurement. One problem, one
variant, one sample.
