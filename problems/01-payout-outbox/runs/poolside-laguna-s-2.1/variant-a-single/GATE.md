$ pnpm install -> 1
Progress: resolved 1, reused 0, downloaded 0, added 0

   ╭─────────────────────────────────────────╮
   │                                         │
   │   Update available! 10.28.2 → 12.3.4.   │
   │   Changelog: https://pnpm.io/v/12.3.4   │
   │    To update, run: pnpm self-update     │
   │                                         │
   ╰─────────────────────────────────────────╯

 ERR_PNPM_NO_MATCHING_VERSION  No matching version found for @types/reflect-metadata@^0.2.0 while fetching it from https://registry.npmjs.org/

This error happened while installing a direct dependency of /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/01-payout-outbox/runs/poolside-laguna-s-2.1/variant-a-single/workspace

The latest release of @types/reflect-metadata is "0.1.0".

Other releases are:
  * ts2.0: 0.1.0
  * ts2.1: 0.1.0
  * ts2.2: 0.1.0
  * ts2.3: 0.1.0
  * ts2.4: 0.1.0
  * ts2.5: 0.1.0
  * ts2.6: 0.1.0
  * ts2.7: 0.0.5

If you need the full list of all 6 published versions run "$ pnpm view @types/reflect-metadata versions".


$ tsc --noEmit (attempt 0) -> 1

[41m                                                                               [0m
[41m[37m                This is not the tsc command you are looking for                [0m
[41m                                                                               [0m

To get access to the TypeScript compiler, [34mtsc[0m, from the command line either:

- Use [1mnpm install typescript[0m to first add TypeScript to your project [1mbefore[0m using npx
- Use [1myarn[0m to avoid accidentally running code from un-installed packages

