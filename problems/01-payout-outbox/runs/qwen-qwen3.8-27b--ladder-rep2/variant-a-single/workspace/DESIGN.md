# DESIGN — funds safety

1. **Reserve, don't debit.** Available = `accounts.settled - accounts.held`. Creation
   only grows `held`; `settled` moves only on confirmed settlement (or a proven
   no-settlement release), so an in-flight payout is a visible obligation.
2. **Check-and-reserve is one act.** One `UPDATE ... SET held = held + a WHERE
   settled - held >= a` whose affected-row count the caller inspects: the database
   serialises racers, so exactly one wins, independent of timing.
3. **Atomic outbox.** The payout, the outbox message, and the reserve ledger legs
   commit in one transaction — never reserved funds without a queued transfer, or a
   queued transfer without reserved funds.
4. **Settlement on confirmation, never on send.** A txHash is "knowable, not
   known": once held, the worker only confirms and never calls `transfer` again,
   so redelivery or a crash cannot double-send and `settled` moves exactly once.
5. **Uncertainty parks; it never reverts.** Reversal requires definitive proof the
   funds did not move; after bounded inconclusive attempts the payout parks in
   NEEDS_REVIEW with the reservation intact — the safe direction: worst case is
   funds briefly unavailable while a human reconciles the chain, never an overdrawn
   account or a double payment. (Re-attempting a transfer of unknown outcome can
   still double-send without SDK idempotency; the small attempt cap bounds that.)
