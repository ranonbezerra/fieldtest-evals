# Variant B — Inference provider swap in an LLM feature

The fixture is a working NestJS service with an LLM-backed endpoint
(summarize + tag a submitted text) built directly against a local-inference
HTTP API (streaming chunks, one prompt format, provider-specific error codes).
The product is moving to a cloud provider with a different SDK: different
request/response shape, different streaming interface, different error
taxonomy, different token accounting.

## The task

1. Introduce a provider port (interface) and migrate the feature to the new
   provider SDK (a fake implementing its documented interface is provided —
   no real API calls); the old provider client is fully removed.
2. Product behavior unchanged: same endpoint contract, same SSE chunk shape to
   clients, same fallback text on provider failure, same max-length handling.
3. Error taxonomy mapped deliberately: rate-limit, timeout, and content-filter
   errors from the new SDK must map to the SAME externally-visible behaviors
   as before (retry, fallback, 422 respectively). Document in
   MIGRATION_NOTES.md.
4. The suite covers happy path + one error. Behaviors exist that no test
   covers but the frontend depends on (find them by reading the SSE handling
   and call sites; pin them with tests before swapping).

Green tests alone ≠ done; judging includes uncovered behaviors.
