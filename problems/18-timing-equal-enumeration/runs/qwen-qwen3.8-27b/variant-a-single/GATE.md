$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 15, reused 14, downloaded 0, added 0
Progress: resolved 16, reused 15, downloaded 0, added 0
Progress: resolved 16, reused 15, downloaded 1, added 0
Progress: resolved 143, reused 130, downloaded 2, added 0
Progress: resolved 279, reused 218, downloaded 3, added 0
Packages: +223
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 281, reused 220, downloaded 3, added 222
Progress: resolved 281, reused 220, downloaded 3, added 223, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @nestjs/platform-express 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ argon2 0.41.1 (0.45.1 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @nestjs/testing 10.4.22 (12.0.1 is available)
+ @swc/core 1.16.2
+ @types/express 4.17.25 (5.0.6 is available)
+ @types/node 20.19.43 (26.4.1 is available)
+ @types/supertest 6.0.3 (7.2.1 is available)
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ supertest 7.2.2
+ typescript 5.9.3 (7.0.2 is available)
+ unplugin-swc 1.5.11
+ vitest 2.1.9 (5.0.0 is available)

Done in 6.5s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 23ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Need your database queries to be 1000x faster? Accelerate offers you that and more: https://pris.ly/tip-2-accelerate



$ tsc --noEmit (attempt 0) -> 0


$ vitest run -> 1
failed to load config from /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/qwen-qwen3.8-27b/variant-a-single/workspace/vitest.config.ts

⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯
TypeError: swc is not a function
    at file:///Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/qwen-qwen3.8-27b/variant-a-single/workspace/vitest.config.ts.timestamp-1788768037224-fc3c167ad738c8.mjs:6:5
    at ModuleJob.run (node:internal/modules/esm/module_job:439:25)
    at async node:internal/modules/esm/loader:643:26
    at async loadConfigFromBundledFile (file:///Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/qwen-qwen3.8-27b/variant-a-single/workspace/node_modules/.pnpm/vite@5.4.21_@types+node@20.19.43/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:66975:15)
    at async loadConfigFromFile (file:///Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/qwen-qwen3.8-27b/variant-a-single/workspace/node_modules/.pnpm/vite@5.4.21_@types+node@20.19.43/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:66816:24)
    at async resolveConfig (file:///Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/qwen-qwen3.8-27b/variant-a-single/workspace/node_modules/.pnpm/vite@5.4.21_@types+node@20.19.43/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:66416:24)
    at async _createServer (file:///Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/qwen-qwen3.8-27b/variant-a-single/workspace/node_modules/.pnpm/vite@5.4.21_@types+node@20.19.43/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:63015:18)
    at async createViteServer (file:///Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/qwen-qwen3.8-27b/variant-a-single/workspace/node_modules/.pnpm/vitest@2.1.9_@types+node@20.19.43/node_modules/vitest/dist/chunks/cli-api.DqsSTaIi.js:9842:18)
    at async createVitest (file:///Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/qwen-qwen3.8-27b/variant-a-single/workspace/node_modules/.pnpm/vitest@2.1.9_@types+node@20.19.43/node_modules/vitest/dist/chunks/cli-api.DqsSTaIi.js:11461:18)
    at async prepareVitest (file:///Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/qwen-qwen3.8-27b/variant-a-single/workspace/node_modules/.pnpm/vitest@2.1.9_@types+node@20.19.43/node_modules/vitest/dist/chunks/cli-api.DqsSTaIi.js:11884:15)




