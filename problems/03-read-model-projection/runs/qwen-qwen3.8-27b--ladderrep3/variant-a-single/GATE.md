$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 11, reused 11, downloaded 0, added 0
Progress: resolved 35, reused 34, downloaded 0, added 0
Packages: +176
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 248, reused 176, downloaded 0, added 170
Progress: resolved 248, reused 176, downloaded 0, added 176, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @nestjs/platform-express 10.4.22 (12.0.1 is available)
+ @nestjs/schedule 4.1.2 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @types/node 20.19.43 (22.20.2 is available)
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ tsx 4.23.13
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 3.7s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 147ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want real-time updates to your database without manual polling? Discover how with Pulse: https://pris.ly/tip-0-pulse

┌─────────────────────────────────────────────────────────┐
│  Update available 5.22.0 -> 8.0.0-rc.13                 │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘


$ tsc --noEmit (attempt 0) -> 2
src/common/domain-exception.ts(8,14): error TS2415: Class 'DomainException' incorrectly extends base class 'HttpException'.
  Property 'status' is private in type 'HttpException' but not in type 'DomainException'.
src/main.ts(2,10): error TS2305: Module '"@nestjs/common"' has no exported member 'NestFactory'.
src/re-derivation/re-derivation.repository.ts(15,5): error TS2322: Type 'Promise<any[]>' is not assignable to type 'Promise<T>'.
  Type 'any[]' is not assignable to type 'T'.
    'T' could be instantiated with an arbitrary type which could be unrelated to 'any[]'.
src/re-derivation/re-derivation.repository.ts(15,24): error TS2769: No overload matches this call.
  Overload 1 of 2, '(arg: PrismaPromise<any>[], options?: { isolationLevel?: TransactionIsolationLevel | undefined; } | undefined): Promise<any[]>', gave the following error.
    Argument of type '(tx: TransactionClient) => Promise<T>' is not assignable to parameter of type 'PrismaPromise<any>[]'.
  Overload 2 of 2, '(fn: (prisma: Omit<PrismaClient<PrismaClientOptions, never, DefaultArgs>, "$on" | "$connect" | "$disconnect" | "$use" | "$transaction" | "$extends">) => Promise<...>, options?: { ...; } | undefined): Promise<...>', gave the following error.
    Type '"serializable"' is not assignable to type 'TransactionIsolationLevel | undefined'. Did you mean '"Serializable"'?


$ tsc --noEmit (attempt 1) -> 2
src/common/api-exception-filter.ts(27,26): error TS2341: Property 'status' is private and only accessible within class 'HttpException'.


$ tsc --noEmit (attempt 2) -> 0


$ vitest run -> 0
 { ReDerivationService } from './re-derivation.service.js';
3  |  import { ReDerivationRepository } from './re-derivation.repository.js';

  Plugin: vite:esbuild
  File: /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace/src/re-derivation/re-derivation.module.ts
8:03:45 PM [vite] warning: Expected the "experimentalDecorators" option to be nested inside a "compilerOptions" object
1  |  import { Inject, Injectable, Logger } from '@nestjs/common';
   |   ^
2  |  import { DomainException } from '../common/domain-exception.js';
3  |  import { ReDerivationRepository } from './re-derivation.repository.js';

  Plugin: vite:esbuild
  File: /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace/src/re-derivation/re-derivation.service.ts
8:03:45 PM [vite] warning: Expected the "experimentalDecorators" option to be nested inside a "compilerOptions" object
1  |  import { Inject, Injectable } from '@nestjs/common';
   |   ^
2  |  import type { DbClient } from '../common/db-client.js';
3  |  import { PrismaService } from '../common/prisma.service.js';

  Plugin: vite:esbuild
  File: /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace/src/re-derivation/re-derivation.repository.ts
8:03:45 PM [vite] warning: Expected the "experimentalDecorators" option to be nested inside a "compilerOptions" object
1  |  import { Module } from '@nestjs/common';
   |   ^
2  |  import { ReDerivationModule } from '../re-derivation/re-derivation.module.js';
3  |  import { DriftRepairRepository } from './drift-repair.repository.js';

  Plugin: vite:esbuild
  File: /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace/src/drift-repair/drift-repair.module.ts
8:03:45 PM [vite] warning: Expected the "experimentalDecorators" option to be nested inside a "compilerOptions" object
1  |  import { Inject, Injectable } from '@nestjs/common';
   |   ^
2  |  import { PrismaService } from '../common/prisma.service.js';
3  |  

  Plugin: vite:esbuild
  File: /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace/src/drift-repair/drift-repair.repository.ts
8:03:45 PM [vite] warning: Expected the "experimentalDecorators" option to be nested inside a "compilerOptions" object
1  |  import { Inject, Injectable, Logger } from '@nestjs/common';
   |   ^
2  |  import { Cron, CronExpression } from '@nestjs/schedule';
3  |  import { ReDerivationService } from '../re-derivation/re-derivation.service.js';

  Plugin: vite:esbuild
  File: /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace/src/drift-repair/drift-repair.service.ts
8:03:45 PM [vite] warning: Expected the "experimentalDecorators" option to be nested inside a "compilerOptions" object
1  |  import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
   |   ^
2  |  import { DomainException } from './domain-exception.js';
3  |  

  Plugin: vite:esbuild
  File: /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace/src/common/api-exception-filter.ts
8:03:45 PM [vite] warning: Expected the "experimentalDecorators" option to be nested inside a "compilerOptions" object
1  |  import { PrismaClient } from '@prisma/client';
   |   ^
2  |  
3  |  export function createTestPrisma(): PrismaClient {

  Plugin: vite:esbuild
  File: /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace/test/helpers/db.ts
8:03:45 PM [vite] warning: Expected the "experimentalDecorators" option to be nested inside a "compilerOptions" object
1  |  import type { TestApp } from './app.js';
   |   ^
2  |  
3  |  export interface HttpResult<T> {

  Plugin: vite:esbuild
  File: /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace/test/helpers/http.ts
8:03:45 PM [vite] warning: Expected the "experimentalDecorators" option to be nested inside a "compilerOptions" object
1  |  import type { OrderStatus } from '@prisma/client';
   |   ^
2  |  import { PrismaClient } from '@prisma/client';
3  |  import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

  Plugin: vite:esbuild
  File: /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace/test/re-derivation.spec.ts
8:03:45 PM [vite] warning: Expected the "experimentalDecorators" option to be nested inside a "compilerOptions" object
1  |  import { PrismaClient } from '@prisma/client';
   |   ^
2  |  import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
3  |  import { startTestApp, type TestApp } from './helpers/app.js';

  Plugin: vite:esbuild
  File: /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace/test/concurrent-totals.spec.ts
8:03:45 PM [vite] warning: Expected the "experimentalDecorators" option to be nested inside a "compilerOptions" object
1  |  import { PrismaClient } from '@prisma/client';
   |   ^
2  |  import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
3  |  import { DriftRepairService } from '../src/drift-repair/drift-repair.service.js';

  Plugin: vite:esbuild
  File: /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace/test/drift-repair.spec.ts

