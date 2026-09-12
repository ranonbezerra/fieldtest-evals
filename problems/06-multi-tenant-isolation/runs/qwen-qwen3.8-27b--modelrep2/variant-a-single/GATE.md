$ pnpm install -> 1
Progress: resolved 1, reused 0, downloaded 0, added 0
 ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/@vitejs%2Fplugin-swc: Not Found - 404

This error happened while installing a direct dependency of /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/06-multi-tenant-isolation/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace

@vitejs/plugin-swc is not in the npm registry, or you have no permission to fetch it.

No authorization header was set for the request.


$ tsc --noEmit (attempt 0) -> 1

[41m                                                                               [0m
[41m[37m                This is not the tsc command you are looking for                [0m
[41m                                                                               [0m

To get access to the TypeScript compiler, [34mtsc[0m, from the command line either:

- Use [1mnpm install typescript[0m to first add TypeScript to your project [1mbefore[0m using npx
- Use [1myarn[0m to avoid accidentally running code from un-installed packages

