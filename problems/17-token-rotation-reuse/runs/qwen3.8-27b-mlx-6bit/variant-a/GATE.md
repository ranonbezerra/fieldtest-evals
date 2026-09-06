$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 6, reused 6, downloaded 0, added 0
Progress: resolved 8, reused 7, downloaded 0, added 0
Progress: resolved 8, reused 8, downloaded 0, added 0
Progress: resolved 9, reused 8, downloaded 0, added 0
Progress: resolved 130, reused 83, downloaded 0, added 0
Packages: +85
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 132, reused 85, downloaded 0, added 85, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @types/node 22.20.1 (26.4.1 is available)
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 6.4s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 23ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Interested in query caching in just a few lines of code? Try Accelerate today! https://pris.ly/tip-3-accelerate



$ tsc --noEmit (attempt 0) -> 2
src/auth/auth.module.ts(15,44): error TS2693: 'AccessTokenIssuer' only refers to a type, but is being used as a value here.


$ tsc --noEmit (attempt 1) -> 0


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/17-token-rotation-reuse/runs/qwen3.8-27b-mlx-6bit/variant-a/workspace

 ❯ test/auth.spec.ts (14 tests | 3 failed) 7ms
   × POST /auth/refresh > replay and reuse detection > family invalidation exhausts every active token in the chain 2ms
     → Refresh token is invalid.
   × POST /auth/refresh > audit completeness > each rejection class writes a distinct event_type to audit_events 0ms
     → expected undefined to be defined
   × POST /auth/refresh > successful rotation > returns a new, distinct refresh token that itself works for a subsequent rotation 0ms
     → Refresh token is invalid.

 Test Files  1 failed (1)
      Tests  3 failed | 11 passed (14)
   Start at  09:45:45
   Duration  711ms (transform 464ms, setup 0ms, collect 554ms, tests 7ms, environment 0ms, prepare 31ms)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/auth.spec.ts > POST /auth/refresh > replay and reuse detection > family invalidation exhausts every active token in the chain
Error: Refresh token is invalid.
 ❯ AuthService.refresh src/auth/auth.service.ts:53:15
     51|       case 'rejected':
     52|       case 'reuse':
     53|         throw new InvalidRefreshTokenError('Refresh token is invalid.'…
       |               ^
     54|     }
     55|   }
 ❯ test/auth.spec.ts:273:23

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  test/auth.spec.ts > POST /auth/refresh > audit completeness > each rejection class writes a distinct event_type to audit_events
AssertionError: expected undefined to be defined
 ❯ test/auth.spec.ts:395:30
    393|       await expect(service.refresh({ rawToken: 'x' })).rejects.toBeIns…
    394|       const malformedAudit = auditEvents.find((e) => e.eventType === '…
    395|       expect(malformedAudit).toBeDefined();
       |                              ^
    396| 
    397|       // Unknown: valid format, not in DB.

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  test/auth.spec.ts > POST /auth/refresh > successful rotation > returns a new, distinct refresh token that itself works for a subsequent rotation
Error: Refresh token is invalid.
 ❯ AuthService.refresh src/auth/auth.service.ts:53:15
     51|       case 'rejected':
     52|       case 'reuse':
     53|         throw new InvalidRefreshTokenError('Refresh token is invalid.'…
       |               ^
     54|     }
     55|   }
 ❯ test/auth.spec.ts:508:22

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯


