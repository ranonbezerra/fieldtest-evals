# Add balance top-up via provider X

**Branch** `feat/wallet-topup` → `main`  ·  **Author** @dmoreira  ·  5 files changed

Lets a user top up their wallet with a card through provider X.

`POST /wallet/top-ups` creates a top-up, calls the provider, and credits the wallet.
Provider X answers `202` when it has accepted the charge, then confirms asynchronously
on the existing `/webhooks/provider` endpoint (already wired for `wallet.credited`).

Schema gains `wallet_top_ups`, and `wallets` gains `last_top_up_at` for the "recent
activity" strip on the account screen.

Tested locally against the provider sandbox. Ready when someone gets a chance.
