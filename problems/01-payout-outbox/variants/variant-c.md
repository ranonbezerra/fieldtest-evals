# Variant C — Prepaid wallet gift-card redemption

A prepaid wallet app lets users convert wallet balance into third-party gift
cards. Card issuance goes through an external fulfillment partner (assume
`partner.issueCard({orderId, sku, amount}) -> {cardCode}`; the call can throw,
time out, or return HTTP 202 with the final outcome available later via
`partner.getOrder(orderId)`).

The partner charges us for every issued card, so issuing the same card twice is
direct financial loss; failing to deliver a card the user paid for is a support
nightmare. Both have happened before with a naive implementation.

## Requirements

Implement in **TypeScript + NestJS + Prisma + PostgreSQL**:

1. `POST /redemptions` — body: `{ userId, sku, amount, clientToken }`. The mobile
   app retries on timeout; the same `clientToken` must map to exactly one
   redemption and one balance lock.
2. Fulfillment must run asynchronously via a Postgres-backed outgoing-message
   table and a worker loop. The queue is at-least-once: design for duplicates.
3. Users can trigger redemptions from two devices simultaneously. The wallet must
   never go negative under concurrent redemptions.
4. Make the redemption lifecycle explicit, distinguishing "sent to partner" from
   "card issued and confirmed".
5. Keep an auditable ledger of wallet movements. The user's settled balance drops
   only when the card issuance is confirmed; until then the funds are earmarked.
6. If the partner keeps failing transiently, cap the attempts and leave the
   redemption in a state operations can resolve manually. Explain in a comment why
   automatically returning the funds at that point would be dangerous.

## Deliverables

- Prisma schema + migration
- NestJS module: controller, service, worker
- Tests for: concurrent redemptions from one wallet, duplicate message delivery,
  attempt exhaustion
- A short `DESIGN.md` (10–20 lines) explaining your funds-safety approach

Amounts are in minor units. Do not use floating point for money.
