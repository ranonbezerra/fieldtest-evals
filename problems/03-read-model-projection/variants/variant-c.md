# Variant C — Support-ticket SLA board

A support tool shows team leads a live board: per agent and per day — open
tickets, breached SLAs, median first-response time, resolved count. The source
is an events table (ticket_events: opened, assigned, replied, resolved,
reopened) now at ~20M rows; the board query walks events and takes ~15s.
Leads reassign tickets and expect the board correct on next refresh; SLA breach
counts trigger escalations, so they must be exact.

Build in **TypeScript + NestJS + Prisma + Postgres**: per-(agent, day)
projection table(s) with DDL and indexes; in-transaction maintenance invoked by
the event-append service (note: reopen must decrement resolved); re-derivation
for any (agent, day) from the events table; scheduled drift repair; the board
query; tests for read-your-own-writes, concurrent event appends for one agent,
and repair convergence after an injected corruption. Include DESIGN.md.
