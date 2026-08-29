# Variant B — Review a queue consumer + webhook handler

You are reviewing `jobs.consumer.ts` + `webhooks.controller.ts` +
`deliveries.service.ts` from a NestJS/Prisma notification service (fixture in
`fixtures/consumer/`). It processes a delivery queue and receives provider
webhooks. It works in staging; production traffic is 50× staging.

## The task

Produce `REVIEW.md` — findings only, do not rewrite the code:

1. Per finding: `file:line`, severity (blocker / major / minor), mechanism
   (why and under what conditions it breaks — duplicate delivery, burst load,
   provider retry storms, partial failure), and a concrete minimal fix.
2. Rank by severity; end with block / approve-with-comments and rationale.
3. Precision counts: defendable findings only; style notes in a separate
   non-blocking section.

Areas worth tracing (not a bug list): what "processed" means to the consumer
vs to the queue, awaiting inside loops vs fire-and-forget batches, signature
verification order relative to body parsing, idempotency of the webhook
handler under provider retries, the catch blocks that log and continue, timer
and interval lifecycles under redeploy, and the pagination of the retry
sweep.
