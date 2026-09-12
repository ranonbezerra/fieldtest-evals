$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 8, reused 8, downloaded 0, added 0
Packages: +85
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 132, reused 85, downloaded 0, added 15
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

Done in 2.7s using pnpm v10.28.2

$ prisma format -> 0
Prisma schema loaded from prisma/schema.prisma
Formatted prisma/schema.prisma in 14ms 🚀

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 36ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Curious about the SQL queries Prisma ORM generates? Optimize helps you enhance your visibility: https://pris.ly/tip-2-optimize



$ tsc --noEmit (attempt 0) -> 2
ification/classification.module.ts(4,42): error TS2307: Cannot find module './classification.repository' or its corresponding type declarations.
src/classification/classification.module.ts(5,32): error TS2307: Cannot find module '../products/products.module' or its corresponding type declarations.
src/classification/classification.module.ts(6,35): error TS2307: Cannot find module '../ingredients/ingredients.module' or its corresponding type declarations.
src/classification/classification.module.ts(7,37): error TS2307: Cannot find module '../methodologies/methodologies.module' or its corresponding type declarations.
src/classification/classification.module.ts(8,32): error TS2307: Cannot find module '../profiles/profiles.module' or its corresponding type declarations.
src/classification/classification.module.ts(9,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/classification/classification.repository.ts(2,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/classification/classification.service.ts(2,42): error TS2307: Cannot find module './classification.repository' or its corresponding type declarations.
src/classification/classification.service.ts(3,36): error TS2307: Cannot find module '../products/products.repository' or its corresponding type declarations.
src/classification/classification.service.ts(4,39): error TS2307: Cannot find module '../ingredients/ingredients.repository' or its corresponding type declarations.
src/classification/classification.service.ts(5,39): error TS2307: Cannot find module '../methodologies/methodology.repository' or its corresponding type declarations.
src/classification/classification.service.ts(6,33): error TS2307: Cannot find module '../methodologies/rules.repository' or its corresponding type declarations.
src/classification/classification.service.ts(7,36): error TS2307: Cannot find module '../profiles/profiles.repository' or its corresponding type declarations.
src/classification/classification.service.ts(8,37): error TS2307: Cannot find module '../methodologies/modifiers.repository' or its corresponding type declarations.
src/classification/classification.service.ts(9,41): error TS2307: Cannot find module './dto/classification-result.dto' or its corresponding type declarations.
src/classification/classification.service.ts(11,33): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../utils/normalizer.js'?
src/classification/classification.service.ts(12,30): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../constants/ocr-typo-fixture.js'?
src/classification/dto/classify.dto.ts(1,35): error TS2307: Cannot find module 'class-validator' or its corresponding type declarations.
src/ingredients/ingredients.module.ts(2,39): error TS2307: Cannot find module './ingredients.repository' or its corresponding type declarations.
src/ingredients/ingredients.module.ts(3,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/ingredients/ingredients.repository.ts(2,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/ingredients/ingredients.repository.ts(4,33): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../utils/normalizer.js'?
src/main.ts(2,27): error TS2307: Cannot find module './app.module' or its corresponding type declarations.
src/methodologies/methodologies.module.ts(2,39): error TS2307: Cannot find module './methodology.repository' or its corresponding type declarations.
src/methodologies/methodologies.module.ts(3,33): error TS2307: Cannot find module './rules.repository' or its corresponding type declarations.
src/methodologies/methodologies.module.ts(4,37): error TS2307: Cannot find module './modifiers.repository' or its corresponding type declarations.
src/methodologies/methodologies.module.ts(5,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/methodologies/methodologies.module.ts(6,35): error TS2307: Cannot find module '../ingredients/ingredients.module' or its corresponding type declarations.
src/methodologies/methodology.repository.ts(2,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/methodologies/modifiers.repository.ts(2,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/methodologies/rules.repository.ts(2,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/products/products.module.ts(2,36): error TS2307: Cannot find module './products.repository' or its corresponding type declarations.
src/products/products.module.ts(3,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/products/products.module.ts(4,35): error TS2307: Cannot find module '../ingredients/ingredients.module' or its corresponding type declarations.
src/products/products.repository.ts(2,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/profiles/profiles.module.ts(2,36): error TS2307: Cannot find module './profiles.repository' or its corresponding type declarations.
src/profiles/profiles.module.ts(3,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/profiles/profiles.module.ts(4,35): error TS2307: Cannot find module '../ingredients/ingredients.module' or its corresponding type declarations.
src/profiles/profiles.repository.ts(2,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.


$ tsc --noEmit (attempt 1) -> 2
src/classification/classification.controller.ts(12,39): error TS2339: Property 'classify' does not exist on type 'ClassificationService'.
src/classification/classification.repository.ts(31,11): error TS2322: Type 'number | null' is not assignable to type 'number'.
  Type 'null' is not assignable to type 'number'.
src/classification/classification.repository.ts(61,11): error TS2322: Type 'number | null' is not assignable to type 'number'.
  Type 'null' is not assignable to type 'number'.
src/classification/dto/classify.dto.ts(1,35): error TS2307: Cannot find module 'class-validator' or its corresponding type declarations.


$ tsc --noEmit (attempt 2) -> 2
src/classification/classification.controller.ts(12,39): error TS2339: Property 'classify' does not exist on type 'ClassificationService'.
src/classification/classification.repository.ts(31,11): error TS2322: Type 'number | null' is not assignable to type 'number'.
  Type 'null' is not assignable to type 'number'.
src/classification/classification.repository.ts(61,11): error TS2322: Type 'number | null' is not assignable to type 'number'.
  Type 'null' is not assignable to type 'number'.

