$ pnpm install -> 1
Progress: resolved 1, reused 0, downloaded 0, added 0
 ERR_PNPM_NO_MATCHING_VERSION  No matching version found for drizzle-orm-pg@^0.30.0 while fetching it from https://registry.npmjs.org/

This error happened while installing a direct dependency of /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/12-orm-migration/runs/gpt-oss-120b--ladder--effort-high/variant-a-single/workspace

The latest release of drizzle-orm-pg is "0.16.3".

Other releases are:
  * update-table-api: 0.14.1-bad61c5
  * pipeline-add-mysql: 0.14.2-3967f06
  * docs-1: 0.14.2-c7344a5
  * AndriiSherman-patch-1: 0.14.3-314c1fa
  * feature/index-name: 0.15.0-67805d4
  * feature/pg-aws-dataapi: 0.15.2-2b4d90d
  * beta: 0.16.0-3e17d6e
  * feature/sqlite-wasm: 0.16.2-43776eb

If you need the full list of all 170 published versions run "$ pnpm view drizzle-orm-pg versions".


$ tsc --noEmit (attempt 0) -> 1

[41m                                                                               [0m
[41m[37m                This is not the tsc command you are looking for                [0m
[41m                                                                               [0m

To get access to the TypeScript compiler, [34mtsc[0m, from the command line either:

- Use [1mnpm install typescript[0m to first add TypeScript to your project [1mbefore[0m using npx
- Use [1myarn[0m to avoid accidentally running code from un-installed packages

