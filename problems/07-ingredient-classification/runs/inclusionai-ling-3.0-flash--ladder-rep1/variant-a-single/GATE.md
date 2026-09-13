$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0

   ╭─────────────────────────────────────────╮
   │                                         │
   │   Update available! 10.28.2 → 12.4.1.   │
   │   Changelog: https://pnpm.io/v/12.4.1   │
   │    To update, run: pnpm self-update     │
   │                                         │
   ╰─────────────────────────────────────────╯

Progress: resolved 9, reused 9, downloaded 0, added 0
Packages: +85
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 132, reused 85, downloaded 0, added 84
Progress: resolved 132, reused 85, downloaded 0, added 85, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @types/node 22.20.2
+ prisma 5.22.0 (8.0.0-rc.14 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 2.5s using pnpm v10.28.2

$ prisma format -> 0
Prisma schema loaded from prisma/schema.prisma
Formatted prisma/schema.prisma in 13ms 🚀

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 34ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want to react to database changes in your app as they happen? Discover how with Pulse: https://pris.ly/tip-1-pulse



$ tsc --noEmit (attempt 0) -> 2
src/common/normalizer.ts(20,12): error TS1161: Unterminated regular expression literal.
src/common/normalizer.ts(21,1): error TS1005: ',' expected.
src/common/normalizer.ts(21,2): error TS1161: Unterminated regular expression literal.
src/methodology/methodology.service.ts(52,14): error TS1161: Unterminated regular expression literal.
src/methodology/methodology.service.ts(53,1): error TS1005: ',' expected.
src/methodology/methodology.service.ts(53,3): error TS1161: Unterminated regular expression literal.


$ tsc --noEmit (attempt 1) -> 2
ssify.repository' or its corresponding type declarations.
src/classify/classify.module.ts(2,33): error TS2307: Cannot find module './classify.service' or its corresponding type declarations.
src/classify/classify.module.ts(3,36): error TS2307: Cannot find module './classify.repository' or its corresponding type declarations.
src/classify/classify.module.ts(4,36): error TS2307: Cannot find module './classify.controller' or its corresponding type declarations.
src/classify/classify.repository.ts(2,31): error TS2307: Cannot find module '../../prisma/prisma.service' or its corresponding type declarations.
src/classify/classify.repository.ts(74,58): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/classify/classify.repository.ts(121,38): error TS7006: Parameter 'f' implicitly has an 'any' type.
src/classify/classify.repository.ts(128,58): error TS7006: Parameter 'u' implicitly has an 'any' type.
src/classify/classify.service.ts(2,61): error TS2307: Cannot find module './classify.repository' or its corresponding type declarations.
src/classify/classify.service.ts(3,45): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../common/normalizer.js'?
src/classify/classify.service.ts(4,29): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../common/severity.js'?
src/classify/classify.service.ts(54,11): error TS2739: Type 'never[]' is missing the following properties from type 'FindingOut': ingredientName, listedAs, isFlagged
src/classify/classify.service.ts(100,16): error TS2339: Property 'push' does not exist on type 'FindingOut'.
src/classify/classify.service.ts(110,14): error TS2339: Property 'sort' does not exist on type 'FindingOut'.
src/classify/classify.service.ts(110,20): error TS7006: Parameter 'a' implicitly has an 'any' type.
src/classify/classify.service.ts(110,23): error TS7006: Parameter 'b' implicitly has an 'any' type.
src/classify/classify.service.ts(126,26): error TS2339: Property 'map' does not exist on type 'FindingOut'.
src/classify/classify.service.ts(126,31): error TS7006: Parameter 'f' implicitly has an 'any' type.
src/main.ts(2,27): error TS2307: Cannot find module './app.module' or its corresponding type declarations.
src/methodology/methodology.controller.ts(2,36): error TS2307: Cannot find module './methodology.service' or its corresponding type declarations.
src/methodology/methodology.controller.ts(3,39): error TS2307: Cannot find module './methodology.repository' or its corresponding type declarations.
src/methodology/methodology.module.ts(2,36): error TS2307: Cannot find module './methodology.service' or its corresponding type declarations.
src/methodology/methodology.module.ts(3,39): error TS2307: Cannot find module './methodology.repository' or its corresponding type declarations.
src/methodology/methodology.module.ts(4,39): error TS2307: Cannot find module './methodology.controller' or its corresponding type declarations.
src/methodology/methodology.module.ts(5,32): error TS2307: Cannot find module '../classify/classify.module' or its corresponding type declarations.
src/methodology/methodology.module.ts(6,32): error TS2307: Cannot find module '../products/products.module' or its corresponding type declarations.
src/methodology/methodology.repository.ts(2,31): error TS2307: Cannot find module '../../prisma/prisma.service' or its corresponding type declarations.
src/methodology/methodology.service.ts(2,39): error TS2307: Cannot find module './methodology.repository' or its corresponding type declarations.
src/methodology/methodology.service.ts(3,33): error TS2307: Cannot find module '../classify/classify.service' or its corresponding type declarations.
src/methodology/methodology.service.ts(4,36): error TS2307: Cannot find module '../products/products.repository' or its corresponding type declarations.
src/methodology/methodology.service.ts(5,27): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../common/normalizer.js'?
src/methodology/methodology.service.ts(35,26): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/products/products.controller.ts(2,33): error TS2307: Cannot find module './products.service' or its corresponding type declarations.
src/products/products.module.ts(2,33): error TS2307: Cannot find module './products.service' or its corresponding type declarations.
src/products/products.module.ts(3,36): error TS2307: Cannot find module './products.repository' or its corresponding type declarations.
src/products/products.module.ts(4,36): error TS2307: Cannot find module './products.controller' or its corresponding type declarations.
src/products/products.repository.ts(2,31): error TS2307: Cannot find module '../../prisma/prisma.service' or its corresponding type declarations.
src/products/products.service.ts(2,36): error TS2307: Cannot find module './products.repository' or its corresponding type declarations.
src/profiles/profiles.controller.ts(2,33): error TS2307: Cannot find module './profiles.service' or its corresponding type declarations.
src/profiles/profiles.module.ts(2,33): error TS2307: Cannot find module './profiles.service' or its corresponding type declarations.
src/profiles/profiles.module.ts(3,36): error TS2307: Cannot find module './profiles.repository' or its corresponding type declarations.
src/profiles/profiles.module.ts(4,36): error TS2307: Cannot find module './profiles.controller' or its corresponding type declarations.
src/profiles/profiles.repository.ts(2,31): error TS2307: Cannot find module '../../prisma/prisma.service' or its corresponding type declarations.
src/profiles/profiles.service.ts(2,36): error TS2307: Cannot find module './profiles.repository' or its corresponding type declarations.


$ tsc --noEmit (attempt 2) -> 2
prisma/prisma.module.ts(2,31): error TS2307: Cannot find module './prisma.service' or its corresponding type declarations.
src/classify/classify.controller.ts(25,5): error TS2322: Type '({ id: string; createdAt: Date; productId: string; methodologyVersionId: string; confidence: number; disclaimer: string; } & { findings: { id: string; severity: string | null; source: string | null; classificationId: string; ingredientName: string; listedAs: string; isFlagged: boolean; }[]; unknownIngredients: { ......' is not assignable to type 'ClassificationResultDto | null'.
  Type '{ id: string; createdAt: Date; productId: string; methodologyVersionId: string; confidence: number; disclaimer: string; } & { findings: { id: string; severity: string | null; source: string | null; classificationId: string; ingredientName: string; listedAs: string; isFlagged: boolean; }[]; unknownIngredients: { ...;...' is not assignable to type 'ClassificationResultDto | null'.
    Type '{ id: string; createdAt: Date; productId: string; methodologyVersionId: string; confidence: number; disclaimer: string; } & { findings: { id: string; severity: string | null; source: string | null; classificationId: string; ingredientName: string; listedAs: string; isFlagged: boolean; }[]; unknownIngredients: { ...;...' is not assignable to type 'ClassificationResultDto'.
      Types of property 'findings' are incompatible.
        Type '{ id: string; severity: string | null; source: string | null; classificationId: string; ingredientName: string; listedAs: string; isFlagged: boolean; }[]' is not assignable to type '{ ingredient: string; listedAs: string; isFlagged: boolean; severity?: string | undefined; source?: string | undefined; }[]'.
          Property 'ingredient' is missing in type '{ id: string; severity: string | null; source: string | null; classificationId: string; ingredientName: string; listedAs: string; isFlagged: boolean; }' but required in type '{ ingredient: string; listedAs: string; isFlagged: boolean; severity?: string | undefined; source?: string | undefined; }'.
src/classify/classify.repository.ts(38,18): error TS2353: Object literal may only specify known properties, and 'createdAt' does not exist in type 'MethodologyVersionOrderByWithRelationInput | MethodologyVersionOrderByWithRelationInput[]'.
src/classify/classify.service.ts(36,19): error TS2322: Type '{ id: string; createdAt: Date; productId: string; methodologyVersionId: string; confidence: number; disclaimer: string; } & { findings: { id: string; severity: string | null; source: string | null; classificationId: string; ingredientName: string; listedAs: string; isFlagged: boolean; }[]; unknownIngredients: { ...;...' is not assignable to type 'ClassificationResultDto'.
  Types of property 'findings' are incompatible.
    Type '{ id: string; severity: string | null; source: string | null; classificationId: string; ingredientName: string; listedAs: string; isFlagged: boolean; }[]' is not assignable to type '{ ingredient: string; listedAs: string; isFlagged: boolean; severity?: string | undefined; source?: string | undefined; }[]'.
      Property 'ingredient' is missing in type '{ id: string; severity: string | null; source: string | null; classificationId: string; ingredientName: string; listedAs: string; isFlagged: boolean; }' but required in type '{ ingredient: string; listedAs: string; isFlagged: boolean; severity?: string | undefined; source?: string | undefined; }'.

