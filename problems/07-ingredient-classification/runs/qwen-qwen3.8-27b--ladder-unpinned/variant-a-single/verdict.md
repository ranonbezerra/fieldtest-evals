# Verdict — 07 Versioned classification engine (qwen3.8-27b, hosted, **ladder**)

```yaml
verdict:      VOID
condition:    {runner: api, spec: ladder, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b}

gate:         [M1 –, M2 –, M3 –, M4 –, M5 –, M6 –]
graded:       not assessed

typecheck:    n/a — nothing was delivered
tests:        n/a

failure_mode: harness_artifact
              # Both attempts failed upstream and neither returned any content.

cost:         {output_tokens: 1 + 42695, requests: 2}

would_merge:  n/a — this run is not evidence about the model
headline:     Void. Cloudflare returned one token and an error; Reka burned 42,695
              tokens and returned nothing.
```

## Both attempts, no content

    attempt 1   Cloudflare        1 token   finish: error   content 0
    retry       Reka         42,695 tokens  finish: error   content 0

No files reached the workspace. There is nothing here to judge.

## Not the model

Across the seven ladder runs attempted, upstream providers split cleanly:

    Parasail    2 completed, 0 failed
    Novita      1 completed, 0 failed
    Mancer 2    1 completed, 0 failed
    Cloudflare  0 completed, 2 failed   (both at exactly 1 token)
    Venice      0 completed, 1 failed
    Reka        0 completed, 1 failed

Three backends served every request they were given; three failed every request they
were given. `qwen/qwen3.8-27b` has fourteen endpoints on OpenRouter and they differ in
quantization (`fp8` × 9, `unknown` × 4, **`fp4` × 1**) and in output ceiling (32,768
to 235,929 — a sevenfold spread).

Re-run once the provider is pinned. See FINDINGS §4.19.
