$ pnpm install -> 1
Progress: resolved 1, reused 0, downloaded 0, added 0
 ERR_PNPM_NO_MATCHING_VERSION  No matching version found for @types/argon2@^0.28.0 while fetching it from https://registry.npmjs.org/

This error happened while installing a direct dependency of /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace

The latest release of @types/argon2 is "0.15.4".

Other releases are:
  * ts2.0: 0.15.0
  * ts2.1: 0.15.0

If you need the full list of all 7 published versions run "$ pnpm view @types/argon2 versions".


$ tsc --noEmit (attempt 0) -> 1

[41m                                                                               [0m
[41m[37m                This is not the tsc command you are looking for                [0m
[41m                                                                               [0m

To get access to the TypeScript compiler, [34mtsc[0m, from the command line either:

- Use [1mnpm install typescript[0m to first add TypeScript to your project [1mbefore[0m using npx
- Use [1myarn[0m to avoid accidentally running code from un-installed packages

