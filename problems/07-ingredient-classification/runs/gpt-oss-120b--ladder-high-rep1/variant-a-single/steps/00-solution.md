# solution

## reasoning

```
The task is to build a solution for the described problem: implement an ingredient classification system with NestJS, Prisma, Postgres. Must create Prisma schema, NestJS modules, controllers, services, repositories, tests.

We need to include everything needed to run the solution (though this is theoretical, not actually executed). But we need to create a full solution that covers all the required functionalities: the schema includes ingredients, synonyms, methodology versions grouping rules, products with ingredient lists, classification results keyed by product and version, profiles (for contextual modifiers). Also need to define the rules (which have source citation, severity, maybe type: banned/restricted/watch). Also synonyms for ingredients (canonical mapping). Also a table for typographical variants? The spec says "synonym fixtures" and "common OCR typos". They are provided, but we don't have them. We can assume they are provided via fixtures (maybe JSON files) loaded into the system. But we can just assume the repository uses a fixture for synonyms, perhaps stored as a map in code.

We'll need to implement classification logic:

- Input: productId, optional profileId.
- Resolve product: get its ingredient list (string entries).
- For each ingredient string: normalize (case, accents, diacritics removal), apply synonyms and OCR typo mapping.
- After normalization, match ingredient to canonical ingredient in DB (ingredients table). If not found, treat as unknown.
- For recognized ingredient: find associated rule(s) from active methodology version: base rules (from restricted list and watch list) for the ingredient (maybe ingredient may have multiple rules). Each rule has severity and source citation. Possibly multiple rules for same ingredient, but we need to pick the highest severity? The spec mentions "base rules" and then "profile's contextual modifiers" which can change the flag for an ingredient (like child under 3 might upgrade watch to restricted?). We need to define precedence: maybe profile modifiers override base rules, with ordering defined (maybe by severity: watch < restricted < banned). Or maybe we define a simple mapping: if profile has a modifier for ingredient (or a category?), we apply that.

We need to store results: classification result table, containing productId, methodologyVersionId, timestamp, overall confidence, disclaimer, and per-ingredient findings: maybe we store each ingredient's result in a separate table (classification_ingredients) linked to the result. Or embed JSON. Simpler: use a JSON column for findings.

Because of the strict layers: controller, service, repository. No raw SQL in service; only repository uses Prisma client.

We need to define modules: maybe ingredients, products, classification (with controller and service). Profiles also.

Also need to define the endpoint: classify product, maybe GET /products/:productId/classify?profileId=... (though typical restful route might be /products/:productId/classify). According to naming conventions: endpoints kebab-case, plural. So maybe /products/:productId/classify?profileId=... is okay. Or use /classifications?productId=...&profileId=... but we need to follow pattern: "kebab-case, plural". The controller can be ProductClassificationController with endpoint POST /classifications.

Better to define endpoint: POST /classifications (with body containing productId and optional profileId). Or GET. Let's decide: POST /classifications.

Now tests: We need to test:

- A profile flips a finding that base rules alone would not have flagged.
- An unrecognized ingredient appears as unknown and confidence drops.
- Synonym and OCR typo resolve to canonical ingredient.
- Same product classification two runs produce identical output.
- Same product classification with shuffled ingredient order produce identical output.
- After publishing v2, both v1 and v2 results are retrievable for the same product.

Thus we need to seed some fixture data in tests: create product with ingredient list, create ingredient entries, synonyms, rules, methodology versions (v1, v2), profiles.

Implementation details:

- For synonyms: ingredient synonyms: synonyms table linking synonyms to canonical ingredient. For OCR typo fixtures: maybe a simple map from typo to canonical name. We can treat as synonym too.

- For methodology version: model MethodologyVersion with fields: id, name, createdAt, active (maybe boolean), maybe published flag. It has related Rule entries.

- Model Rule: id, ingredientId (or ingredientName?), severity (enum), sourceCitation, methodologyVersionId.

- Possibly rules can be for ingredient not just ingredient ID? For watch list, watch might be generic (like "parabens" group)? But we will keep simple: each rule is tied to canonical ingredient ID.

- Profiles: model Profile with id, name, maybe a many-to-many to ProfileModifier (or just mapping to modifiers). For simplicity, we can define a table ProfileModifier linking profileId to ingredientId and severityOverride (or type). But the spec mentions contextual modifiers (child under 3, pregnancy) that "tighten certain rules". This likely means for certain profiles, if ingredient severity is watch, then treat as restricted/banned. For example, child under 3: watch => restricted, restricted => banned.

We'll define an enum ModifierType: CHILD_UNDER_3, PREGNANCY.

We'll define a mapping of severity modifications per profile. To keep simple, we can define a table ProfileSeverityModifier: profileId, baseSeverity, resultingSeverity. Or just code it in service: for a given profile, apply severity escalation: watch => restricted => banned (one level up). We need to write precedence definition in comment.

Thus classification logic:

1. For each ingredient string:
   - normalize: trim, lower case, remove accents (decompose Unicode and filter diacritic). Could implement a helper function: normalizeIngredient.
   - map synonyms: check synonyms table for canonical ingredient where synonym matches normalized string.
   - map OCR typos: we can treat same as synonyms; we can have a separate table OcrTypo: typo->canonicalIngredientId (or same synonyms). Use synonyms table.

   - After mapping, we have canonical ingredient ID. If not found, it's unknown.

2. For recognized ingredient:
   - Find rule(s) for the canonical ingredient in the active methodology version (the latest version maybe flagged as active). If multiple rules exist (maybe duplicates from multiple sources), pick the highest severity (banned > restricted > watch). Determine source citation (maybe we need to store all sources? For simplicity, we store the rule with highest severity; we can also list all citations). We'll just include the chosen rule's sourceCitation.

   - Apply profile modifiers: If profileId is provided, get the profile, and adjust severity according to some defined precedence: e.g., for childUnder3 profile, severity escalates by one level (watch->restricted, restricted->banned). For pregnancy profile, maybe only certain ingredients flagged, but we can just apply the same escalation. The spec says "contextual modifiers by defined precedence". We'll define a simple map.

   - The flag: maybe "flagged" boolean if severity is banned or restricted? Or all severity levels considered flagged? The spec says "per-ingredient findings (flag, severity, source citation)". We'll set flag true if severity is not watch? Actually watch is a finding too. Could set flag true for any rule found. For unknown, flag false maybe.

3. Overall confidence: ratio of recognized ingredients to total ingredients (maybe 0-1). Unknown ingredients lower confidence. If all recognized, confidence 1.0.

4. Disclaimer: static string like "Classification based on methodology version X.".

5. Store result: create ClassificationResult row with productId, methodologyVersionId, timestamp, confidence, disclaimer, and JSON for findings.

   Findings: array of objects: ingredientId (or name), ingredientOriginal (original string), flag, severity, sourceCitation, unknown (boolean). For unknown, unknown: true, flag false, severity null, sourceCitation null.

Now storing: In Prisma, we can define a JSON column for findings: results Json (or JsonB). Prisma supports Json type.

We need to ensure immutability: methodology version is immutable; when publishing new version, we need to re-score all products: classification results for that version.

Implement a command or service method: rescoreAllProductsForVersion(versionId) that will go through all products, classify each using that version's rules, and store result. Idempotent: If result already exists for product+version, update if necessary or upsert (create if not exist). But should not duplicate rows. Use upsert.

We need to be able to retrieve results: maybe GET /results?productId=...&versionId=... returns stored result.

We also need to implement the classification service method classify(productId, profileId?) which uses active methodology version. Should store result? According to spec: classification result is stored, keyed by product and methodologyVersion. Probably classification call should store new result for the active version. But also maybe just compute and return. We'll implement that the classification will compute result for active version and upsert into results.

Now the tests. We'll use Vitest.

We'll need to bootstrap NestJS testing module with in-memory SQLite? But spec expects PostgreSQL. For simplicity, we can use SQLite in tests, but spec says PostgreSQL. For tests we can use an in-memory SQLite with Prisma? Or we can use Prisma's SQLite provider for tests. But the code base expects PostgreSQL; maybe in test we use a test database via environment variable. However, given constraints we can assume test runs with a test DB.

We'll just define tests using Prisma client to insert test data, then call service classify and assert outputs.

Now file layout.

We need:

- prisma/schema.prisma: define all models.

- src/main.ts: NestJS bootstrap.

- src/app.module.ts: import sub-modules.

- src/ingredients/ingredients.module.ts: includes IngredientsService, IngredientsRepository.

- src/ingredients/ingredients.service.ts: maybe not needed.

- src/ingredients/ingredients.repository.ts: DB operations for ingredients and synonyms.

But given the requirement to have controller only for classification (maybe also for result retrieval). We'll define:

- src/classification/classification.module.ts

- src/classification/classification.controller.ts: defines endpoint to classify (POST /classifications).

- src/classification/classification.service.ts: contains business logic for classify.

- src/classification/classification.repository.ts: DB interactions: fetching product, ingredients, rules, methodology version, saving result.

Also, src/products/product.module.ts, product.service.ts, product.repository.ts. But we can embed product fetching in classification repository.

Also, src/profiles/profile.module.ts, etc.

But to keep minimal, we can have:

- src/classification/

- src/methodology/methodology.module.ts maybe for publishing version.

But we need a command to publish new version and trigger rescoring.

Simplify: We'll implement a MethodologyService with method publishNewVersion(versionName, rules) which creates version, adds rules, and triggers rescoring.

Now test file: test/classification.spec.ts.

We'll need to configure NestJS test module with modules and Prisma client.

Now we need to decide the names and files.

Naming conventions:

- Table and column: snake_case via @map.

- Endpoint: kebab-case, plural.

- TS file: kebab-case.role.ts. But typical naming pattern is like classification.service.ts (lowercase). That matches.

We'll follow: src/classification/classification.controller.ts, classification.service.ts, classification.repository.ts.

Now details.

Prisma schema:

We need models:

- ingredient

- ingredient_synonym

- methodology_version

- rule

- product

- product_ingredient (join table for many-to-many with order maybe)

- classification_result

- profile

- profile_modifier maybe.

- maybe OcrTypo table (or treat as synonym). For simplicity, treat as synonym.

Define enumerations:

- enum Severity: banned, restricted, watch.

- enum MethodologyStatus: published? Actually version is immutable, but we need to designate active version for classification. Could have a boolean active. Or we could treat the latest published as active.

Define models:

model Ingredient {
  id          Int      @id @default(autoincrement())
  name        String   @unique @map("name")
  synonyms    IngredientSynonym[]
  // other fields maybe.

  // Relations:
  // rules: Rule[]
}

model IngredientSynonym {
  id            Int       @id @default(autoincrement())
  synonym       String    @unique
  ingredient    Ingredient @relation(fields: [ingredientId], references: [id])
  ingredientId  Int
}

model MethodologyVersion {
  id          Int      @id @default(autoincrement())
  version     String   @unique
  createdAt   DateTime @default(now())
  active      Boolean  @default(false) // indicates if this version is the active for classification
  rules       Rule[]
  // results: ClassificationResult[]
}

model Rule {
  id                  Int      @id @default(autoincrement())
  ingredient          Ingredient @relation(fields: [ingredientId], references: [id])
  ingredientId        Int
  severity            Severity
  sourceCitation      String
  methodologyVersion  MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])
  methodologyVersionId Int
}

enum Severity {
  banned
  restricted
  watch
}

model Product {
  id          Int       @id @default(autoincrement())
  name        String
  // maybe other fields
  productIngredients ProductIngredient[]
  // results: ClassificationResult[]
}

model ProductIngredient {
  id          Int    @id @default(autoincrement())
  product     Product @relation(fields: [productId], references: [id])
  productId   Int
  ingredientString String // raw string as stored
  // maybe order column
}

model ClassificationResult {
  id                Int      @id @default(autoincrement())
  product           Product  @relation(fields: [productId], references: [id])
  productId         Int
  methodologyVersion MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])
  methodologyVersionId Int
  classifiedAt      DateTime @default(now())
  confidence        Float
  disclaimer        String
  findings          Json    // JSON array of per-ingredient findings
  // Unique key (productId, methodologyVersionId)
  @@unique([productId, methodologyVersionId])
}

model Profile {
  id          Int     @id @default(autoincrement())
  name        String  @unique
  // maybe type or modifiers
  // For simplicity, we store a JSON of modifiers or have a many-to-many
  // Let's define a profile_type enum: child_under_3, pregnancy
  type        ProfileType
}

enum ProfileType {
  child_under_3
  pregnancy
}

Potentially we could have profile_modifiers but we can embed the logic in service.

We may need to map synonyms and OCR typos. Provide fixture of synonyms; we can seed synonyms via test.

Now about "methodology version is immutable" -> we set active boolean. For publishing new version, we set active true and set previous version active false. That ensures classification uses only active version.

Now classification repository: fetch active version: findFirst where active true order by createdAt desc? Or findUnique by version name.

Implementation steps:

- classification.service.classify(productId, profileId?) does:

   - fetch product with ingredients (including ingredientString). Using repository.

   - fetch active methodology version.

   - fetch all synonyms map: load all synonyms into a map (synonym -> ingredientId). Use repository.

   - fetch rules for active version: load into a map: ingredientId -> array of Rule.

   - fetch profile if profileId provided.

   - For each productIngredient entry:

        - originalString = ingredientString

        - normalized = normalize(originalString)

        - If normalized matches a synonym: use its ingredientId (via synonyms map). Else try to match normalized directly to ingredient name (maybe we have a mapping from canonical name). We can also load all ingredient names into map.

        - If ingredientId found:

            - Get base rules for ingredientId from rules map: possibly multiple. Choose the highest severity rule (banned > restricted > watch). For tie, maybe pick any.

            - severity = baseSeverity, sourceCitation = rule.sourceCitation, flag = true.

            - Apply profile modifications: if profile present, we adjust severity according to precedence: For child_under_3: severity escalates to next higher severity (watch->restricted, restricted->banned, banned remains banned). For pregnancy: maybe same. Write this in code and comment.

            - After adjustment, flag stays true.

        - else (ingredient not found): mark unknown: flag = false, severity = null, sourceCitation = null, unknown = true.

        - Add to findings array.

   - Compute confidence: recognizedCount / totalCount. Recognized includes known and unknown? According to spec, unknown lowers confidence: so confidence = recognizedCount (non-unknown) / totalCount. Or unknown is not recognized. So confidence = knownCount / totalCount.

   - Disclaimer: e.g., `Classification based on methodology version ${activeVersion.version}.`

   - Upsert classification result:

        - Try to find existing result for productId + activeVersion.id. If exists, update fields; else create new.

   - Return result object.

Now re-scoring path: method publishMethodologyVersion(versionName: string, rules: RuleCreateInput[]) which:

- Create MethodologyVersion with version: versionName, active: true.

- Insert associated rules. Each rule includes ingredientId, severity, sourceCitation.

- Set previous versions active to false.

- After creation, trigger re-scoring: fetch all products and for each call classification service classify using the new version (maybe pass no profile). But classification currently always uses active version; after setting active to true, it will use it.

- Must be idempotent: re-scoring for same version should not duplicate rows. Use upsert (unique constraint). So we can call classification service's internal method computeAndStore(productId, versionId). Or just loop.

- For deterministic: ensure that sorting of ingredients (order) does not affect output: we should sort the findings by canonical ingredient name or original order? The spec says identical result regardless of order. So we must sort the findings in a deterministic way, e.g., by normalized ingredient string (or by original index). But if order changed, output should be same; so we must sort the findings by ingredient name (canonical) to guarantee same order. Or we can sort by normalized string.

- Use a stable order: sort findings by ingredient name (or unknown at end). We'll sort by ingredient name (or original string after normalization) ascending.

Now unknown ingredient handling: unknown entries are included in findings with unknown flag and they lower confidence.

Now profile flipping: Suppose base rule says watch for ingredient X. Profile child_under_3 escalates severity to restricted, making flag more severe; we need to test that.

Implementation details:

- Use Prisma client injection via NestJS provider. Usually we have a PrismaService that wraps PrismaClient and provides it. We'll need to create src/prisma/prisma.service.ts and src/prisma/prisma.module.ts. However, we can create simple injection: create PrismaService class annotated @Injectable() with PrismaClient.

- For simplicity, define PrismaService in src/prisma/prisma.service.ts and export.

- All repositories will inject PrismaService.

Now code structure:

Files:

- prisma/schema.prisma

- src/main.ts

- src/app.module.ts

- src/prisma/prisma.service.ts

- src/prisma/prisma.module.ts

- src/classification/classification.module.ts

- src/classification/classification.controller.ts

- src/classification/classification.service.ts

- src/classification/classification.repository.ts

- src/methodology/methodology.module.ts

- src/methodology/methodology.service.ts

- src/methodology/methodology.repository.ts

- src/profiles/profile.module.ts

- src/profiles/profile.service.ts

- src/profiles/profile.repository.ts

- src/products/product.module.ts

- src/products/product.service.ts

- src/products/product.repository.ts

- test/classification.spec.ts

That's many files, but the instruction: "Deliver every file the solution needs, complete." So we need to provide all.

Given the time constraints, we can condense some modules: combine product repo into classification repo. But we may need Prisma module anyway.

Simplify: Keep only necessary modules: classification (controller, service, repo), methodology (service for publishing), and PrismaService. Maybe define a module that includes classification and methodology.

We'll also need to add a DTO for classify request. But we can just parse body.

Now we need to produce code with proper NestJS structure.

Let's start building.

First, prisma/schema.prisma.

Define models as described.

Be mindful about naming: table names default to model name in lowercase; with @map we can set snake_case. We can also map column names with @map.

Add enum definitions.

Add @@unique constraints.

Now main.ts: typical bootstrap.

AppModule: imports classification and methodology modules, PrismaModule.

Now PrismaService: class PrismaService extends PrismaClient; we need to call $connect in onModuleInit and $disconnect on beforeDestroy.

Now classification repository: methods:

- getProductWithIngredients(productId: number): returns product with its productIngredients.

- getActiveMethodologyVersion(): returns MethodologyVersion (where active = true). Might also return null if none.

- getRulesByVersion(versionId: number): return all rules for version.

- getSynonymsMap(): return map<string, number> (synonym -> ingredientId). We'll need to include canonical name mapping too: maybe map name to id.

- getIngredientById(ingredientId): return ingredient.

- upsertClassificationResult(productId, versionId, resultDto): uses upsert.

Implementation uses Prisma client.

Now classification service: method classify(productId: number, profileId?: number): returns ClassificationResultDto (type). Use repository to fetch data, do normalization, mapping.

Implement normalizeIngredient: lower case, remove diacritics (use .normalize('NFD') and regex). Remove extra spaces. Also maybe remove punctuation.

Synonym resolution: first check synonyms map; then if not found, check if normalized string matches ingredient name (canonical). We need a map of canonical names (normalized) to ingredientId.

Now severity escalation logic:

Define helper: applyProfileModifiers(severity: Severity, profile?: Profile): Severity.

We need a Profile entity: we can fetch profile by id, includes type (ProfileType). For child_under_3 and pregnancy, we apply escalation: if severity === 'watch', escalate to 'restricted'; if 'restricted' => 'banned'; else remain 'banned'.

Add comment: Precedence: profile modifiers applied after base rules, escalates severity by one level.

Now find highest severity rule: define severity rank: banned=3, restricted=2, watch=1.

Now unknown ingredient: we still include original string in findings with unknown flag.

Compute confidence: knownCount / totalCount.

Disclaimer: static: `Based on methodology version ${version.version}`.

Return result.

Now upsert classification: Use repository method that upserts based on unique (productId, methodologyVersionId). Insert findings as JSON.

Now classification controller: define endpoint POST /classifications; body includes productId and optional profileId.

Return result DTO.

Now methodology service: method publishVersion(versionName: string, rules: { ingredientName: string; severity: Severity; sourceCitation: string }[]): Should map ingredientName to ingredientId (find or create ingredient?). For simplicity, we assume ingredient already exists; in test we create ingredients and synonyms. We then create MethodologyVersion, set active = true, deactivate other versions, create rules.

After creation, call classificationService.rescoreAllProducts(versionId) maybe.

Add method rescoreAllProducts: fetch all products ids, call classificationService.classify(productId) (but that will use active version). To avoid duplication, we can pass versionId to repository for upserting. We'll implement classificationService.classifyInternal(productId, versionId, profileId?) but to keep simple, we can call classify(productId) after activating version. Since classify upserts with the active version.

Now profile entity: not needed for core, but need repository to get profile.

Define profile repository: findById.

Now tests.

Test steps:

1. Setup test module with PrismaService, ClassificationModule, MethodologyModule, etc.

2. Before each test, reset DB: maybe using Prisma migrate? But we can just delete all.

3. Insert fixture data:

   - Ingredients: ingredientA (name: "sodium laureth sulfate"), ingredientB ("parabens").

   - Synonyms: "sls" -> ingredientA; "paraben" -> ingredientB.

   - OCR typo fixture: "sodum laureth sulfete" (typo) -> ingredientA as synonym.

   - Profiles: child under 3 (type child_under_3), pregnancy (type pregnancy).

   - Product: product with ingredient list: raw strings: ["SLS", "Paraben", "UnknownIngredient", "sodum laureth sulfete"] (mixed case, synonyms, typo, unknown).

   - Methodology version v1 with rules: ingredientA: severity watch, source "regulator-2023". ingredientB: severity banned, source "regulator-2023". (Assume base rules.)

4. Activate version v1.

5. Test classification without profile: classify product.

   - Expect findings: ingredientA flagged watch, source regulator-2023; ingredientB flagged banned; unknown ingredient flagged unknown; the typo resolved to ingredientA watch.

   - Confidence: recognized count = 3 (SLS, Paraben, typo), total=4 => 0.75.

   - Ensure unknown ingredient appears.

6. Test profile flipping: classify product with profile child_under_3.

   - For ingredientA (watch), escalates to restricted. For ingredientB (banned) stays banned. Check that watch is upgraded to restricted, flag still true, severity now restricted.

   - Ensure that profile flips a finding.

7. Test synonym and typo resolve: SLS resolves to ingredientA; typo resolves.

8. Test deterministic: run classify twice, ensure same output.

9. Test shuffled order: create a new product with same ingredient list shuffled, classification output same (order of findings sorted). Ensure same.

10. Publish v2: create new methodology version with updated rules: maybe change ingredientA severity to restricted (from watch) and add new rule for a new ingredient.

   - Publish new version (v2). This will re-score all products.

   - Retrieve classification result for product and version v1 (old) and v2 (new). Verify both exist.

   - Confirm v1 result unchanged (e.g., severity for ingredientA still watch). v2 result now has restricted.

   - Confirm no duplicate rows for v2.

Now for retrieving results: classification service can have method getResult(productId, versionId). Or controller GET endpoint.

We'll add endpoint GET /classifications/:productId?version=:versionName to retrieve.

Simplify: In test we can directly query repository to fetch results.

Implement classification repository method findResult(productId, versionId) that returns result.

Now tests can use repository.

Now we need DTOs: ClassifyRequestDto with productId (number) and optional profileId (number). ClassificationResultDto includes productId, methodologyVersion, confidence, disclaimer, findings.

Define FindingDto: originalIngredient, canonicalIngredient? (maybe name), flag, severity?, sourceCitation?, unknown (boolean).

Now code.

Now produce final answer with all files.

We need to abide by naming conventions: file names kebab-case.role.ts. So classification.controller.ts, classification.service.ts, classification.repository.ts.

We need to include imports from NestJS and Prisma.

Now generate code.

First file: prisma/schema.prisma.

We'll include necessary models.

Potentially we need to set provider = "postgresql". But for test we might use SQLite; but spec says Postgres. We'll set provider = "postgresql". And use url = env("DATABASE_URL").

Now code.

Second file: src/main.ts.

Third: src/app.module.ts.

Fourth: src/prisma/prisma.service.ts.

Fifth: src/prisma/prisma.module.ts.

Sixth: src/classification/classification.module.ts.

Seventh: src/classification/classification.controller.ts.

Eighth: src/classification/classification.service.ts.

Ninth: src/classification/classification.repository.ts.

Tenth: src/methodology/methodology.module.ts.

Eleventh: src/methodology/methodology.service.ts.

Twelfth: src/methodology/methodology.repository.ts.

Thirteenth: src/profiles/profile.module.ts.

Fourteenth: src/profiles/profile.service.ts.

Fifteenth: src/profiles/profile.repository.ts.

Sixteenth: src/products/product.module.ts.

Seventeenth: src/products/product.service.ts.

Eighteenth: src/products/product.repository.ts.

Nineteenth: test/classification.spec.ts.

That might be a lot but we can do.

But some modules might be empty; but for completeness we include them.

We can reduce number by merging product and classification into classification repository, but keep separate for clarity.

Given the instruction "Do not create a file it does not call for", we should only create files needed to implement solution. There's no requirement to have separate modules for product, profile if we embed them in classification repository. However we might need profile repository for profile fetch. But can embed.

But we need to have a PrismaModule to provide PrismaService across modules.

Now start writing code.

We need to be careful with NestJS imports and providers.

Also we need to implement classification logic in service using repository methods.

Now write each file.

Let's begin.

### prisma/schema.prisma

We'll define all models.

We'll include mapping for snake_case using @map for table names and column names if needed. But by default Prisma creates snake_case for fields? Actually it uses field name as column name. But to enforce snake_case, we can add @map attribute to each field name if we want to map to snake_case. Not necessary for test but include.

We'll define:

model Ingredient {
  id        Int       @id @default(autoincrement())
  name      String    @unique @map("name")
  synonyms  IngredientSynonym[]
  // rules relation
  rules     Rule[]
  // For mapping normalized names: we can add a computed column? Not needed.

  @@map("ingredients")
}

model IngredientSynonym {
  id           Int        @id @default(autoincrement())
  synonym      String     @unique
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id])
  ingredientId Int

  @@map("ingredient_synonyms")
}

model MethodologyVersion {
  id          Int      @id @default(autoincrement())
  version     String   @unique
  created_at  DateTime @default(now()) @map("created_at")
  active      Boolean  @default(false)
  rules       Rule[]
  classification_results ClassificationResult[]

  @@map("methodology_versions")
}

model Rule {
  id                   Int      @id @default(autoincrement())
  ingredient           Ingredient @relation(fields: [ingredientId], references: [id])
  ingredientId         Int
  severity             Severity
  source_citation      String   @map("source_citation")
  methodology_version  MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])
  methodologyVersionId Int

  @@map("rules")
}

enum Severity {
  banned
  restricted
  watch
}

model Product {
  id                Int               @id @default(autoincrement())
  name              String
  product_ingredients ProductIngredient[]
  classification_results ClassificationResult[]

  @@map("products")
}

model ProductIngredient {
  id               Int     @id @default(autoincrement())
  product          Product @relation(fields: [productId], references: [id])
  productId        Int
  ingredient_string String @map("ingredient_string")
  // order column for deterministic? Not needed.
  @@map("product_ingredients")
}

model ClassificationResult {
  id                  Int      @id @default(autoincrement())
  product             Product  @relation(fields: [productId], references: [id])
  productId           Int
  methodology_version MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])
  methodologyVersionId Int
  classified_at       DateTime @default(now()) @map("classified_at")
  confidence          Float
  disclaimer          String
  findings            Json

  @@unique([productId, methodologyVersionId])
  @@map("classification_results")
}

model Profile {
  id    Int        @id @default(autoincrement())
  name  String     @unique
  type  ProfileType

  @@map("profiles")
}

enum ProfileType {
  child_under_3
  pregnancy
}

Add any needed indexes? Not needed.

Now ensure the naming with snake_case: we used @map for table names and column names where needed.

Now file src/main.ts.

We'll have typical Nest application bootstrap.

Now src/app.module.ts: import all modules.

Now src/prisma/prisma.service.ts.

Implement as:

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

Now src/prisma/prisma.module.ts.

@Module({ providers: [PrismaService], exports: [PrismaService] })

Now classification.module.ts: imports PrismaModule, provides ClassificationService, ClassificationRepository, ClassificationController.

Now classification.controller.ts.

Define DTO: ClassifyDto.

Define endpoints: POST /classifications; GET /classifications/:productId?version=:version.

Return DTO.

Now classification.service.ts: inject repository.

Define method classify(productId: number, profileId?: number): returns result DTO.

Implement normalization functions and mapping.

Now classification.repository.ts: inject PrismaService.

Implement methods.

Now methodology.module.ts: imports PrismaModule, ClassificationModule (for rescoring). Provide MethodologyService.

MethodologyService: publishVersion(versionName: string, rules: RuleInput[]) // rule input: ingredientName, severity, sourceCitation.

Will need to ensure ingredient exists.

Will also need to handle deactivating previous versions.

Will also trigger rescore: maybe classificationService.rescoreAllProducts(). So we need to inject ClassificationService.

Now method for rescoreAllProducts: classificationService.rescoreAllProducts().

In ClassificationService, implement method rescoreAllProducts(versionId: number) that fetches all product ids from repository and classifies each product with no profile using that version. Or just call repository method to compute result directly (skip upserting to active version?). Since we want to store results keyed by version, we need to compute result with given versionId.

Our classify method currently picks active version; to classify for a specific version, we can add internal method classifyForVersion(productId: number, versionId: number, profileId?: number). We'll implement in repository: computeClassification(productId, versionId, profileId?) and upsert result keyed by productId and versionId.

But to avoid complexity, we can use the active version after setting active, then call classify (which uses active version). That's simpler: after publishing new version, set it active, then call classify for each product. That will store results for new version. However, the classification result table has unique (productId, methodologyVersionId). Since previous version's result already exists, new version will insert new row.

Thus we need to adjust classify method to accept optional versionId; if not provided, use active version.

Add signature: classify(productId: number, profileId?: number, methodologyVersionId?: number). When called from classification controller (user request), we pass versionId undefined (active). When called for rescoring, we pass versionId = newVersion.id. This will cause repository to upsert for that version.

In classify service, we first decide version: if methodologyVersionId provided, fetch that version; else fetch active version.

Now classification repository should provide method getMethodologyVersionById.

Now profile: repository fetch profile by id.

Now we need to load synonyms and ingredients.

Implementation steps inside service:

- Get product.

- Get methodology version.

- Get synonyms (maybe all) and ingredient names map (canonical). Use repository.

- Build map: normalized string -> ingredientId (including synonyms). Also map canonical normalized ingredient name -> ingredientId.

- Get rules for version: map ingredientId -> array of rules.

- Process each product ingredient:

   - originalString = productIngredient.ingredient_string

   - normalized = normalizeString(originalString)

   - find ingredientId: first check synonyms map; else check canonical map; else unknown.

   - If found: get rule(s) for ingredientId. If none, base severity = null? Actually if no rule, treat as not flagged (maybe safe). But spec implies only restricted, banned, watch entries are flagged; others are not flagged. So if no rule, then no flag.

   - For known ingredient with rule: apply severity and sourceCitation. Then apply profile modifiers.

   - For known ingredient without rule: flag false, unknown false, severity null.

   - Add to findings.

- After processing all, compute recognizedCount: count of ingredients where ingredientId is not null (i.e., known). UnknownCount = total - recognizedCount.

- Confidence = recognizedCount / totalCount.

- Disclaimer: e.g., `Classification based on methodology version ${methodologyVersion.version}.`

- Upsert result.

- Return result DTO.

Now unknown ingredient: flag false, unknown true, severity null, sourceCitation null.

Now need to define types for result: maybe interface ClassificationResultDto { productId: number; methodologyVersion: string; confidence: number; disclaimer: string; findings: FindingDto[]; }

Findings: interface FindingDto { original: string; canonical?: string; flag: boolean; severity?: Severity; sourceCitation?: string; unknown: boolean; }

Now we need to import severity enum from Prisma client.

Now repository methods: findProductWithIngredients(productId), findActiveMethodologyVersion, findMethodologyVersionById, findRulesByVersionId, findSynonymsMap, findIngredientNameMap, upsertClassificationResult.

Implement findSynonymsMap: fetch all synonyms: prisma.ingredientSynonym.findMany(). Map synonym (normalized) to ingredientId.

FindIngredientNameMap: fetch all ingredients: prisma.ingredient.findMany(). Map normalized name to ingredientId and name.

Now for performance we could fetch only relevant data, but not needed.

Now for re-scoring path: after publishing new version, we need to re-score all products.

MethodologyService.publishVersion method:

- Takes versionName string and rules array.

- In a transaction:

  - Deactivate previous versions: update all methodologyVersions set active = false.

  - Create new version with active true.

  - For each rule in input, find ingredient by name (or create if not exist). We'll assume ingredient exists.

  - Insert rule for new version.

- After transaction, get all product IDs (prisma.product.findMany select id). Then for each productId, call classificationService.classify(productId, undefined, newVersion.id). Could use Promise.all.

Now classificationService.classify will use versionId argument to classify with that version.

We need to add method signature accordingly.

Now we also need a repository method findAllProductIds.

Now test file.

We'll need to set up test environment: Use PrismaService to create test data.

In test, we need to import modules.

We'll use NestJS testing module: Test.createTestingModule.

We'll use beforeAll to initialize.

We'll need to clear tables before each test: prisma.classificationResult.deleteMany, productIngredient.deleteMany, product.deleteMany, etc.

Now write test cases.

We'll implement using async/await.

Now we need to ensure deterministic order of findings: after processing, sort findings by (canonical name or original normalized string). We'll sort by (canonical?.toLowerCase() ?? original.toLowerCase()).

Now test that same product classification two runs yields same result (including order). We can compare JSON deep equal.

Now test that shuffled ingredient order yields same result: for product2 with same ingredients shuffled, classification should be same as product1. Since we sort findings, this will hold.

Now test that unknown appears and confidence drops.

Test profile flips.

Now test after publishing v2, both v1 and v2 results are retrievable.

Thus we need to implement method to retrieve result by productId and versionName (or versionId). Provide repository method findResult(productId, versionId). In test, we can fetch using repository.

Add to classification.service a method getResult(productId, versionName?). Or directly call repository.

Simplify: In test, we can call prisma.classificationResult.findUnique({ where: { productId_methodologyVersionId: { productId, methodologyVersionId: versionId } } } ). But we need to know versionId.

We can expose repository method.

Alright.

Now ensure naming conventions: file names kebab-case.

Now write code.

Potential pitfalls:

- Prisma JSON type mapping to TypeScript: use any.

- In TypeScript, we need to import types for Prisma client.

- Use nest injection for repository: @Injectable().

- Provide imports.

Now start writing each file.

---

First file:

### prisma/schema.prisma

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["mapRelationFields"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Severity {
  banned
  restricted
  watch
}

enum ProfileType {
  child_under_3
  pregnancy
}

model Ingredient {
  id        Int                @id @default(autoincrement())
  name      String             @unique @map("name")
  synonyms  IngredientSynonym[]
  rules     Rule[]

  @@map("ingredients")
}

model IngredientSynonym {
  id           Int        @id @default(autoincrement())
  synonym      String     @unique
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id])
  ingredientId Int

  @@map("ingredient_synonyms")
}

model MethodologyVersion {
  id          Int      @id @default(autoincrement())
  version     String   @unique
  created_at  DateTime @default(now()) @map("created_at")
  active      Boolean  @default(false)
  rules       Rule[]
  results     ClassificationResult[]

  @@map("methodology_versions")
}

model Rule {
  id                    Int               @id @default(autoincrement())
  ingredient            Ingredient        @relation(fields: [ingredientId], references: [id])
  ingredientId          Int
  severity              Severity
  source_citation       String            @map("source_citation")
  methodology_version   MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])
  methodologyVersionId  Int

  @@map("rules")
}

model Product {
  id                Int                 @id @default(autoincrement())
  name              String
  product_ingredients ProductIngredient[]
  results           ClassificationResult[]

  @@map("products")
}

model ProductIngredient {
  id                Int    @id @default(autoincrement())
  product           Product @relation(fields: [productId], references: [id])
  productId         Int
  ingredient_string String @map("ingredient_string")

  @@map("product_ingredients")
}

model ClassificationResult {
  id                  Int      @id @default(autoincrement())
  product             Product  @relation(fields: [productId], references: [id])
  productId           Int
  methodology_version MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])
  methodologyVersionId Int
  classified_at       DateTime @default(now()) @map("classified_at")
  confidence          Float
  disclaimer          String
  findings            Json

  @@unique([productId, methodologyVersionId])
  @@map("classification_results")
}

model Profile {
  id    Int        @id @default(autoincrement())
  name  String     @unique
  type  ProfileType

  @@map("profiles")
}
```

Now next file: src/main.ts

```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Enable CORS for convenience
  app.enableCors();
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
```

Now src/app.module.ts

```ts
// src/app.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ClassificationModule } from './classification/classification.module';
import { MethodologyModule } from './methodology/methodology.module';
import { ProfileModule } from './profiles/profile.module';
import { ProductModule } from './products/product.module';

@Module({
  imports: [
    PrismaModule,
    ClassificationModule,
    MethodologyModule,
    ProfileModule,
    ProductModule,
  ],
})
export class AppModule {}
```

Now src/prisma/prisma.service.ts

```ts
// src/prisma/prisma.service.ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

Now src/prisma/prisma.module.ts

```ts
// src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

Now src/classification/classification.module.ts

```ts
// src/classification/classification.module.ts
import { Module } from '@nestjs/common';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';
import { ClassificationRepository } from './classification.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { ProfileModule } from '../profiles/profile.module';
import { ProductModule } from '../products/product.module';
import { MethodologyModule } from '../methodology/methodology.module';

@Module({
  imports: [PrismaModule, ProfileModule, ProductModule, MethodologyModule],
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
  exports: [ClassificationService],
})
export class ClassificationModule {}
```

Now src/classification/classification.controller.ts

```ts
// src/classification/classification.controller.ts
import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ClassificationService } from './classification.service';
import { ClassificationResultDto } from './dto/classification-result.dto';
import { ClassifyDto } from './dto/classify.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('classifications')
@Controller('classifications')
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Post()
  @ApiOperation({ summary: 'Classify a product' })
  @ApiResponse({ status: 200, description: 'Classification result', type: ClassificationResultDto })
  async classify(@Body() dto: ClassifyDto): Promise<ClassificationResultDto> {
    const { productId, profileId } = dto;
    return this.classificationService.classify(productId, profileId);
  }

  @Get(':productId')
  @ApiOperation({ summary: 'Get stored classification result' })
  @ApiResponse({ status: 200, description: 'Stored result', type: ClassificationResultDto })
  async getResult(
    @Param('productId', ParseIntPipe) productId: number,
    @Query('version') version?: string,
  ): Promise<ClassificationResultDto> {
    return this.classificationService.getResult(productId, version);
  }
}
```

Now need DTOs: classification-result.dto.ts and classify.dto.ts. Must create those files. Since we need to deliver all files. Let's create folder src/classification/dto.

We need to follow naming conventions: file name kebab-case.role.ts. So classification-result.dto.ts, classify.dto.ts.

Add files accordingly.

Create src/classification/dto/classify.dto.ts

```ts
// src/classification/dto/classify.dto.ts
import { IsInt, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ClassifyDto {
  @ApiProperty({ description: 'ID of the product to classify' })
  @IsInt()
  @Min(1)
  productId: number;

  @ApiPropertyOptional({ description: 'Optional profile ID for contextual modifiers' })
  @IsOptional()
  @IsInt()
  @Min(1)
  profileId?: number;
}
```

Now src/classification/dto/classification-result.dto.ts

```ts
// src/classification/dto/classification-result.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Severity } from '@prisma/client';

export class FindingDto {
  @ApiProperty({ description: 'Original ingredient string as provided' })
  original: string;

  @ApiProperty({ description: 'Canonical ingredient name, if resolved', nullable: true })
  canonical?: string | null;

  @ApiProperty({ description: 'Whether this ingredient triggered a rule' })
  flag: boolean;

  @ApiProperty({ description: 'Severity level if flagged', enum: Severity, nullable: true })
  severity?: Severity | null;

  @ApiProperty({ description: 'Source citation for the rule', nullable: true })
  sourceCitation?: string | null;

  @ApiProperty({ description: 'True if the ingredient could not be resolved' })
  unknown: boolean;
}

export class ClassificationResultDto {
  @ApiProperty({ description: 'Product ID' })
  productId: number;

  @ApiProperty({ description: 'Methodology version used for classification' })
  methodologyVersion: string;

  @ApiProperty({ description: 'Overall confidence (0-1)' })
  confidence: number;

  @ApiProperty({ description: 'Disclaimer text' })
  disclaimer: string;

  @ApiProperty({ type: [FindingDto], description: 'Per-ingredient findings' })
  findings: FindingDto[];
}
```

Now classification.service.ts

```ts
// src/classification/classification.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ClassificationRepository } from './classification.repository';
import { ProfileRepository } from '../profiles/profile.repository';
import { ClassificationResultDto, FindingDto } from './dto/classification-result.dto';
import { Severity } from '@prisma/client';

@Injectable()
export class ClassificationService {
  constructor(
    private readonly classificationRepo: ClassificationRepository,
    private readonly profileRepo: ProfileRepository,
  ) {}

  /**
   * Classify a product using the active methodology version.
   * If a profileId is provided, apply contextual modifiers.
   * The result is stored (upsert) keyed by product and methodology version.
   */
  async classify(
    productId: number,
    profileId?: number,
    methodologyVersionId?: number,
  ): Promise<ClassificationResultDto> {
    // 1. Retrieve product with its ingredient strings
    const product = await this.classificationRepo.findProductWithIngredients(productId);
    if (!product) {
      throw new NotFoundException(`Product with id ${productId} not found`);
    }

    // 2. Determine methodology version
    const methodologyVersion = methodologyVersionId
      ? await this.classificationRepo.findMethodologyVersionById(methodologyVersionId)
      : await this.classificationRepo.findActiveMethodologyVersion();

    if (!methodologyVersion) {
      throw new BadRequestException('No active methodology version found');
    }

    // 3. Load synonym and canonical maps
    const synonymMap = await this.classificationRepo.getSynonymMap(); // normalized synonym -> ingredientId
    const canonicalMap = await this.classificationRepo.getCanonicalIngredientMap(); // normalized name -> { id, name }

    // 4. Load rules for this version
    const rulesMap = await this.classificationRepo.getRulesMapByVersion(methodologyVersion.id);
    // rulesMap: ingredientId -> Rule (highest severity)

    // 5. Load profile if provided
    const profile = profileId ? await this.profileRepo.findById(profileId) : null;
    if (profileId && !profile) {
      throw new NotFoundException(`Profile with id ${profileId} not found`);
    }

    // 6. Process each ingredient
    const findings: FindingDto[] = [];
    let recognizedCount = 0;
    const totalCount = product.product_ingredients.length;

    for (const pi of product.product_ingredients) {
      const original = pi.ingredient_string;
      const normalized = ClassificationService.normalizeIngredient(original);

      // Resolve to ingredientId via synonyms or canonical name
      let ingredientId: number | null = null;
      let canonicalName: string | null = null;

      if (synonymMap.has(normalized)) {
        ingredientId = synonymMap.get(normalized)!;
        canonicalName = canonicalMap.get(normalized)?.name ?? null;
      } else if (canonicalMap.has(normalized)) {
        const entry = canonicalMap.get(normalized)!;
        ingredientId = entry.id;
        canonicalName = entry.name;
      }

      if (ingredientId) {
        recognizedCount++;
        // Find rule for this ingredient (if any)
        const rule = rulesMap.get(ingredientId) ?? null;
        let flag = false;
        let severity: Severity | null = null;
        let sourceCitation: string | null = null;

        if (rule) {
          flag = true;
          severity = rule.severity;
          sourceCitation = rule.sourceCitation;
        }

        // Apply profile modifiers if applicable
        if (profile && severity) {
          severity = this.applyProfileModifier(severity, profile.type);
        }

        findings.push({
          original,
          canonical: canonicalName,
          flag,
          severity,
          sourceCitation,
          unknown: false,
        });
      } else {
        // Unknown ingredient
        findings.push({
          original,
          canonical: null,
          flag: false,
          severity: null,
          sourceCitation: null,
          unknown: true,
        });
      }
    }

    // Deterministic ordering: sort findings by canonical name (or original) alphabetically
    findings.sort((a, b) => {
      const aKey = a.canonical?.toLowerCase() ?? a.original.toLowerCase();
      const bKey = b.canonical?.toLowerCase() ?? b.original.toLowerCase();
      return aKey.localeCompare(bKey);
    });

    const confidence = totalCount > 0 ? recognizedCount / totalCount : 0;
    const disclaimer = `Classification based on methodology version ${methodologyVersion.version}.`;

    // Upsert result
    await this.classificationRepo.upsertClassificationResult({
      productId: product.id,
      methodologyVersionId: methodologyVersion.id,
      confidence,
      disclaimer,
      findings,
    });

    return {
      productId: product.id,
      methodologyVersion: methodologyVersion.version,
      confidence,
      disclaimer,
      findings,
    };
  }

  /**
   * Retrieve a stored classification result.
   * If version is omitted, the active version is used.
   */
  async getResult(productId: number, version?: string): Promise<ClassificationResultDto> {
    const methodologyVersion = version
      ? await this.classificationRepo.findMethodologyVersionByName(version)
      : await this.classificationRepo.findActiveMethodologyVersion();

    if (!methodologyVersion) {
      throw new BadRequestException('Methodology version not found');
    }

    const result = await this.classificationRepo.findResult(productId, methodologyVersion.id);
    if (!result) {
      throw new NotFoundException(
        `Result for product ${productId} and version ${methodologyVersion.version} not found`,
      );
    }

    // Transform DB result to DTO
    return {
      productId: result.productId,
      methodologyVersion: methodologyVersion.version,
      confidence: result.confidence,
      disclaimer: result.disclaimer,
      findings: result.findings as FindingDto[],
    };
  }

  /**
   * Apply profile modifiers to severity based on defined precedence.
   * Precedence: profile modifiers are applied after base rules and
   * elevate severity by one level (watch → restricted → banned).
   * If severity is already 'banned', it remains 'banned'.
   */
  private applyProfileModifier(severity: Severity, profileType: string): Severity {
    // For this implementation, all profile types share the same escalation logic.
    const order: Severity[] = ['watch', 'restricted', 'banned'];
    const idx = order.indexOf(severity);
    if (idx === -1) return severity;
    // Escalate one level if not already at max
    const newIdx = Math.min(idx + 1, order.length - 1);
    return order[newIdx];
  }

  /**
   * Normalizes ingredient strings: lowercases, removes diacritics,
   * trims whitespace, collapses multiple spaces.
   */
  private static normalizeIngredient(input: string): string {
    // Lowercase
    let str = input.toLowerCase();
    // Unicode normalize and strip diacritics
    str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Remove punctuation (commas, hyphens, etc.) except spaces
    str = str.replace(/[.,;:()\-_/]/g, ' ');
    // Collapse whitespace
    str = str.replace(/\s+/g, ' ').trim();
    return str;
  }
}
```

Now classification.repository.ts

```ts
// src/classification/classification.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Product,
  MethodologyVersion,
  Rule,
  ClassificationResult,
} from '@prisma/client';
import { FindingDto } from './dto/classification-result.dto';

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProductWithIngredients(productId: number): Promise<Product & { product_ingredients: { ingredient_string: string }[] } | null> {
    return this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        product_ingredients: true,
      },
    });
  }

  async findActiveMethodologyVersion(): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findFirst({
      where: { active: true },
    });
  }

  async findMethodologyVersionById(id: number): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findUnique({
      where: { id },
    });
  }

  async findMethodologyVersionByName(version: string): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findUnique({
      where: { version },
    });
  }

  /**
   * Returns a map of normalized synonym => ingredientId
   */
  async getSynonymMap(): Promise<Map<string, number>> {
    const synonyms = await this.prisma.ingredientSynonym.findMany({
      include: {
        ingredient: true,
      },
    });
    const map = new Map<string, number>();
    for (const syn of synonyms) {
      const normalized = ClassificationService.normalizeIngredient(syn.synonym);
      map.set(normalized, syn.ingredientId);
    }
    return map;
  }

  /**
   * Returns a map of normalized canonical ingredient name => { id, name }
   */
  async getCanonicalIngredientMap(): Promise<Map<string, { id: number; name: string }>> {
    const ingredients = await this.prisma.ingredient.findMany();
    const map = new Map<string, { id: number; name: string }>();
    for (const ing of ingredients) {
      const normalized = ClassificationService.normalizeIngredient(ing.name);
      map.set(normalized, { id: ing.id, name: ing.name });
    }
    return map;
  }

  /**
   * Returns a map of ingredientId => Rule with highest severity for the given methodology version
   */
  async getRulesMapByVersion(versionId: number): Promise<Map<number, Rule>> {
    const rules = await this.prisma.rule.findMany({
      where: { methodologyVersionId: versionId },
    });
    // Determine highest severity per ingredient
    const severityRank: { [key in Severity]: number } = {
      watch: 1,
      restricted: 2,
      banned: 3,
    };
    const map = new Map<number, Rule>();
    for (const rule of rules) {
      const existing = map.get(rule.ingredientId);
      if (!existing || severityRank[rule.severity] > severityRank[existing.severity]) {
        map.set(rule.ingredientId, rule);
      }
    }
    return map;
  }

  async upsertClassificationResult(params: {
    productId: number;
    methodologyVersionId: number;
    confidence: number;
    disclaimer: string;
    findings: FindingDto[];
  }): Promise<ClassificationResult> {
    const { productId, methodologyVersionId, confidence, disclaimer, findings } = params;
    // Upsert based on unique constraint (productId, methodologyVersionId)
    return this.prisma.classificationResult.upsert({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId,
        },
      },
      create: {
        productId,
        methodologyVersionId,
        confidence,
        disclaimer,
        findings: findings as any, // JSON column
      },
      update: {
        confidence,
        disclaimer,
        findings: findings as any,
        // Also update classified_at?
        // Assuming we keep original timestamp; could update to now if desired.
      },
    });
  }

  async findResult(productId: number, methodologyVersionId: number): Promise<ClassificationResult | null> {
    return this.prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId,
        },
      },
    });
  }

  async findAllProductIds(): Promise<number[]> {
    const products = await this.prisma.product.findMany({
      select: { id: true },
    });
    return products.map(p => p.id);
  }

  // Helper to normalize strings (used in maps)
  // Re-exported from ClassificationService to keep normalization consistent
  private static normalizeIngredient = ClassificationService.normalizeIngredient;
}
```

Note: In getSynonymMap and getCanonicalIngredientMap we referenced ClassificationService.normalizeIngredient, but that's a private static method. Since we cannot reference private static from other class directly, we need to make it exported or duplicate normalization logic. To avoid circular dependency, better to extract normalization function to a utility file. Let's create src/utils/normalizer.ts.

Create file src/utils/normalizer.ts

```ts
// src/utils/normalizer.ts
export function normalizeIngredient(input: string): string {
  // Lowercase
  let str = input.toLowerCase();
  // Unicode normalize and strip diacritics
  str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Remove punctuation (commas, hyphens, etc.) except spaces
  str = str.replace(/[.,;:()\-_/]/g, ' ');
  // Collapse whitespace
  str = str.replace(/\s+/g, ' ').trim();
  return str;
}
```

Now modify ClassificationService to import normalizeIngredient from utils. Replace static method with imported function.

Update classification.service.ts accordingly.

Update classification.repository.ts to import normalizeIngredient.

Now modify those files.

Let's rewrite classification.service.ts with import.

```ts
// src/classification/classification.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ClassificationRepository } from './classification.repository';
import { ProfileRepository } from '../profiles/profile.repository';
import { ClassificationResultDto, FindingDto } from './dto/classification-result.dto';
import { Severity } from '@prisma/client';
import { normalizeIngredient } from '../utils/normalizer';

@Injectable()
export class ClassificationService {
  constructor(
    private readonly classificationRepo: ClassificationRepository,
    private readonly profileRepo: ProfileRepository,
  ) {}

  async classify(
    productId: number,
    profileId?: number,
    methodologyVersionId?: number,
  ): Promise<ClassificationResultDto> {
    const product = await this.classificationRepo.findProductWithIngredients(productId);
    if (!product) {
      throw new NotFoundException(`Product with id ${productId} not found`);
    }

    const methodologyVersion = methodologyVersionId
      ? await this.classificationRepo.findMethodologyVersionById(methodologyVersionId)
      : await this.classificationRepo.findActiveMethodologyVersion();

    if (!methodologyVersion) {
      throw new BadRequestException('No active methodology version found');
    }

    const synonymMap = await this.classificationRepo.getSynonymMap(); // normalized synonym -> ingredientId
    const canonicalMap = await this.classificationRepo.getCanonicalIngredientMap(); // normalized name -> { id, name }

    const rulesMap = await this.classificationRepo.getRulesMapByVersion(methodologyVersion.id);

    const profile = profileId ? await this.profileRepo.findById(profileId) : null;
    if (profileId && !profile) {
      throw new NotFoundException(`Profile with id ${profileId} not found`);
    }

    const findings: FindingDto[] = [];
    let recognizedCount = 0;
    const totalCount = product.product_ingredients.length;

    for (const pi of product.product_ingredients) {
      const original = pi.ingredient_string;
      const normalized = normalizeIngredient(original);

      let ingredientId: number | null = null;
      let canonicalName: string | null = null;

      if (synonymMap.has(normalized)) {
        ingredientId = synonymMap.get(normalized)!;
        canonicalName = canonicalMap.get(normalized)?.name ?? null;
      } else if (canonicalMap.has(normalized)) {
        const entry = canonicalMap.get(normalized)!;
        ingredientId = entry.id;
        canonicalName = entry.name;
      }

      if (ingredientId) {
        recognizedCount++;
        const rule = rulesMap.get(ingredientId) ?? null;
        let flag = false;
        let severity: Severity | null = null;
        let sourceCitation: string | null = null;

        if (rule) {
          flag = true;
          severity = rule.severity;
          sourceCitation = rule.sourceCitation;
        }

        if (profile && severity) {
          severity = this.applyProfileModifier(severity, profile.type);
        }

        findings.push({
          original,
          canonical: canonicalName,
          flag,
          severity,
          sourceCitation,
          unknown: false,
        });
      } else {
        findings.push({
          original,
          canonical: null,
          flag: false,
          severity: null,
          sourceCitation: null,
          unknown: true,
        });
      }
    }

    findings.sort((a, b) => {
      const aKey = a.canonical?.toLowerCase() ?? a.original.toLowerCase();
      const bKey = b.canonical?.toLowerCase() ?? b.original.toLowerCase();
      return aKey.localeCompare(bKey);
    });

    const confidence = totalCount > 0 ? recognizedCount / totalCount : 0;
    const disclaimer = `Classification based on methodology version ${methodologyVersion.version}.`;

    await this.classificationRepo.upsertClassificationResult({
      productId: product.id,
      methodologyVersionId: methodologyVersion.id,
      confidence,
      disclaimer,
      findings,
    });

    return {
      productId: product.id,
      methodologyVersion: methodologyVersion.version,
      confidence,
      disclaimer,
      findings,
    };
  }

  async getResult(productId: number, version?: string): Promise<ClassificationResultDto> {
    const methodologyVersion = version
      ? await this.classificationRepo.findMethodologyVersionByName(version)
      : await this.classificationRepo.findActiveMethodologyVersion();

    if (!methodologyVersion) {
      throw new BadRequestException('Methodology version not found');
    }

    const result = await this.classificationRepo.findResult(productId, methodologyVersion.id);
    if (!result) {
      throw new NotFoundException(
        `Result for product ${productId} and version ${methodologyVersion.version} not found`,
      );
    }

    return {
      productId: result.productId,
      methodologyVersion: methodologyVersion.version,
      confidence: result.confidence,
      disclaimer: result.disclaimer,
      findings: result.findings as FindingDto[],
    };
  }

  /**
   * Apply profile modifiers to severity based on defined precedence.
   * Precedence: profile modifiers are applied after base rules and
   * elevate severity by one level (watch → restricted → banned).
   * If severity is already 'banned', it remains 'banned'.
   */
  private applyProfileModifier(severity: Severity, profileType: string): Severity {
    // For this implementation, all profile types share the same escalation logic.
    const order: Severity[] = ['watch', 'restricted', 'banned'];
    const idx = order.indexOf(severity);
    if (idx === -1) return severity;
    const newIdx = Math.min(idx + 1, order.length - 1);
    return order[newIdx];
  }
}
```

Now classification.repository.ts updates to use normalizeIngredient.

```ts
// src/classification/classification.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Product,
  MethodologyVersion,
  Rule,
  ClassificationResult,
  Severity,
} from '@prisma/client';
import { FindingDto } from './dto/classification-result.dto';
import { normalizeIngredient } from '../utils/normalizer';

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProductWithIngredients(productId: number): Promise<
    Product & {
      product_ingredients: { ingredient_string: string }[];
    } | null
  > {
    return this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        product_ingredients: true,
      },
    });
  }

  async findActiveMethodologyVersion(): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findFirst({
      where: { active: true },
    });
  }

  async findMethodologyVersionById(id: number): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findUnique({
      where: { id },
    });
  }

  async findMethodologyVersionByName(version: string): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findUnique({
      where: { version },
    });
  }

  /**
   * Returns a map of normalized synonym => ingredientId
   */
  async getSynonymMap(): Promise<Map<string, number>> {
    const synonyms = await this.prisma.ingredientSynonym.findMany({
      include: {
        ingredient: true,
      },
    });
    const map = new Map<string, number>();
    for (const syn of synonyms) {
      const normalized = normalizeIngredient(syn.synonym);
      map.set(normalized, syn.ingredientId);
    }
    return map;
  }

  /**
   * Returns a map of normalized canonical ingredient name => { id, name }
   */
  async getCanonicalIngredientMap(): Promise<Map<string, { id: number; name: string }>> {
    const ingredients = await this.prisma.ingredient.findMany();
    const map = new Map<string, { id: number; name: string }>();
    for (const ing of ingredients) {
      const normalized = normalizeIngredient(ing.name);
      map.set(normalized, { id: ing.id, name: ing.name });
    }
    return map;
  }

  /**
   * Returns a map of ingredientId => Rule with highest severity for the given methodology version
   */
  async getRulesMapByVersion(versionId: number): Promise<Map<number, Rule>> {
    const rules = await this.prisma.rule.findMany({
      where: { methodologyVersionId: versionId },
    });
    const severityRank: { [key in Severity]: number } = {
      watch: 1,
      restricted: 2,
      banned: 3,
    };
    const map = new Map<number, Rule>();
    for (const rule of rules) {
      const existing = map.get(rule.ingredientId);
      if (!existing || severityRank[rule.severity] > severityRank[existing.severity]) {
        map.set(rule.ingredientId, rule);
      }
    }
    return map;
  }

  async upsertClassificationResult(params: {
    productId: number;
    methodologyVersionId: number;
    confidence: number;
    disclaimer: string;
    findings: FindingDto[];
  }): Promise<ClassificationResult> {
    const { productId, methodologyVersionId, confidence, disclaimer, findings } = params;
    return this.prisma.classificationResult.upsert({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId,
        },
      },
      create: {
        productId,
        methodologyVersionId,
        confidence,
        disclaimer,
        findings: findings as any,
      },
      update: {
        confidence,
        disclaimer,
        findings: findings as any,
      },
    });
  }

  async findResult(productId: number, methodologyVersionId: number): Promise<ClassificationResult | null> {
    return this.prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId,
        },
      },
    });
  }

  async findAllProductIds(): Promise<number[]> {
    const products = await this.prisma.product.findMany({
      select: { id: true },
    });
    return products.map(p => p.id);
  }
}
```

Now create profile repository.

src/profiles/profile.repository.ts

```ts
// src/profiles/profile.repository.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Profile } from '@prisma/client';

@Injectable()
export class ProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: number): Promise<Profile | null> {
    return this.prisma.profile.findUnique({
      where: { id },
    });
  }

  async createProfile(name: string, type: string): Promise<Profile> {
    return this.prisma.profile.create({
      data: {
        name,
        type,
      },
    });
  }
}
```

Now src/profiles/profile.service.ts

```ts
// src/profiles/profile.service.ts
import { Injectable } from '@nestjs/common';
import { ProfileRepository } from './profile.repository';
import { Profile } from '@prisma/client';

@Injectable()
export class ProfileService {
  constructor(private readonly profileRepo: ProfileRepository) {}

  async create(name: string, type: string): Promise<Profile> {
    return this.profileRepo.createProfile(name, type);
  }

  async findById(id: number) {
    return this.profileRepo.findById(id);
  }
}
```

Now src/profiles/profile.module.ts

```ts
// src/profiles/profile.module.ts
import { Module } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ProfileRepository } from './profile.repository';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ProfileService, ProfileRepository],
  exports: [ProfileService],
})
export class ProfileModule {}
```

Now product repository: src/products/product.repository.ts

```ts
// src/products/product.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Product, ProductIngredient } from '@prisma/client';

@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createProduct(name: string, ingredientStrings: string[]): Promise<Product> {
    return this.prisma.product.create({
      data: {
        name,
        product_ingredients: {
          create: ingredientStrings.map((s) => ({
            ingredient_string: s,
          })),
        },
      },
    });
  }

  async findById(id: number) {
    return this.prisma.product.findUnique({
      where: { id },
      include: {
        product_ingredients: true,
      },
    });
  }
}
```

Now src/products/product.service.ts

```ts
// src/products/product.service.ts
import { Injectable } from '@nestjs/common';
import { ProductRepository } from './product.repository';
import { Product } from '@prisma/client';

@Injectable()
export class ProductService {
  constructor(private readonly productRepo: ProductRepository) {}

  async create(name: string, ingredientStrings: string[]): Promise<Product> {
    return this.productRepo.createProduct(name, ingredientStrings);
  }

  async findById(id: number) {
    return this.productRepo.findById(id);
  }
}
```

Now src/products/product.module.ts

```ts
// src/products/product.module.ts
import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductRepository } from './product.repository';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ProductService, ProductRepository],
  exports: [ProductService],
})
export class ProductModule {}
```

Now methodology repository: src/methodology/methodology.repository.ts

```ts
// src/methodology/methodology.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MethodologyVersion, Rule } from '@prisma/client';

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async deactivateAllVersions(): Promise<void> {
    await this.prisma.methodologyVersion.updateMany({
      where: { active: true },
      data: { active: false },
    });
  }

  async createVersion(version: string): Promise<MethodologyVersion> {
    return this.prisma.methodologyVersion.create({
      data: {
        version,
        active: true,
      },
    });
  }

  async findVersionByName(version: string): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findUnique({
      where: { version },
    });
  }

  async addRule(
    methodologyVersionId: number,
    ingredientId: number,
    severity: string,
    sourceCitation: string,
  ): Promise<Rule> {
    return this.prisma.rule.create({
      data: {
        ingredientId,
        severity: severity as any,
        sourceCitation,
        methodologyVersionId,
      },
    });
  }

  async findAllProducts(): Promise<{ id: number }[]> {
    return this.prisma.product.findMany({
      select: { id: true },
    });
  }
}
```

Now methodology.service.ts

```ts
// src/methodology/methodology.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { MethodologyRepository } from './methodology.repository';
import { ClassificationService } from '../classification/classification.service';
import { PrismaService } from '../prisma/prisma.service';
import { Severity } from '@prisma/client';

interface RuleInput {
  ingredientName: string;
  severity: Severity;
  sourceCitation: string;
}

/**
 * Service to manage methodology versions and trigger re-scoring.
 */
@Injectable()
export class MethodologyService {
  constructor(
    private readonly methodologyRepo: MethodologyRepository,
    private readonly classificationService: ClassificationService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Publishes a new methodology version with the given rules.
   * Re-scores all existing products. The operation is idempotent.
   *
   * Precedence for rule application:
   * - New version is immutable.
   * - Existing version results are retained.
   * - Re-scoring uses the new version exclusively.
   */
  async publishVersion(versionName: string, rules: RuleInput[]): Promise<void> {
    // Check if version already exists
    const existing = await this.methodologyRepo.findVersionByName(versionName);
    if (existing) {
      // Version already exists; assume idempotent, no further action
      return;
    }

    // Transactional creation
    await this.prisma.$transaction(async (tx) => {
      // Deactivate old active versions
      await tx.methodologyVersion.updateMany({
        where: { active: true },
        data: { active: false },
      });

      // Create new version
      const newVersion = await tx.methodologyVersion.create({
        data: {
          version: versionName,
          active: true,
        },
      });

      // Ensure ingredients exist; create if missing
      for (const rule of rules) {
        const ingredient = await tx.ingredient.upsert({
          where: { name: rule.ingredientName },
          update: {}, // No update; immutable
          create: {
            name: rule.ingredientName,
          },
        });

        await tx.rule.create({
          data: {
            ingredientId: ingredient.id,
            severity: rule.severity,
            sourceCitation: rule.sourceCitation,
            methodologyVersionId: newVersion.id,
          },
        });
      }
    });

    // After publishing, re-score all products using the new version
    const newVersion = await this.methodologyRepo.findVersionByName(versionName);
    if (!newVersion) {
      throw new BadRequestException('Failed to retrieve newly created methodology version');
    }

    const productIds = await this.methodologyRepo.findAllProducts();
    for (const p of productIds) {
      // Classify with explicit versionId to ensure idempotency
      await this.classificationService.classify(p.id, undefined, newVersion.id);
    }
  }
}
```

Now methodology.module.ts

```ts
// src/methodology/methodology.module.ts
import { Module } from '@nestjs/common';
import { MethodologyService } from './methodology.service';
import { MethodologyRepository } from './methodology.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { ClassificationModule } from '../classification/classification.module';

@Module({
  imports: [PrismaModule, ClassificationModule],
  providers: [MethodologyService, MethodologyRepository],
  exports: [MethodologyService],
})
export class MethodologyModule {}
```

Note: To avoid circular dependencies (ClassificationModule imports MethodologyModule and vice versa). In NestJS, you can use forwardRef. But we may simplify: MethodologyModule only needs ClassificationService to call classify. Since ClassificationModule exports ClassificationService, we can import it. But ClassificationModule also imports MethodologyModule (currently), but we only need to import MethodologyModule for classification? Actually ClassificationService does not depend on MethodologyService. So ClassificationModule does not need to import MethodologyModule. Remove it from ClassificationModule imports. Let's adjust classification.module.ts accordingly.

Update classification.module.ts:

```ts
// src/classification/classification.module.ts
import { Module } from '@nestjs/common';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';
import { ClassificationRepository } from './classification.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { ProfileModule } from '../profiles/profile.module';
import { ProductModule } from '../products/product.module';

@Module({
  imports: [PrismaModule, ProfileModule, ProductModule],
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
  exports: [ClassificationService],
})
export class ClassificationModule {}
```

Now the classification.service import profileRepo from profile module. Good.

Now we need utils/normalizer.ts file added earlier.

Now test file: test/classification.spec.ts

We need to set up test environment with NestJS TestingModule.

We'll use vitest.

File content:

```ts
// test/classification.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ClassificationService } from '../src/classification/classification.service';
import { ClassificationModule } from '../src/classification/classification.module';
import { MethodologyModule } from '../src/methodology/methodology.module';
import { ProductModule } from '../src/products/product.module';
import { ProfileModule } from '../src/profiles/profile.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MethodologyService } from '../src/methodology/methodology.service';
import { ProductService } from '../src/products/product.service';
import { ProfileService } from '../src/profiles/profile.service';
import { expect } from 'vitest';
import { Severity } from '@prisma/client';

describe('ClassificationService (e2e)', () => {
  let moduleRef: TestingModule;
  let classificationService: ClassificationService;
  let methodologyService: MethodologyService;
  let productService: ProductService;
  let profileService: ProfileService;
  let prisma: PrismaService;

  const ingredientAName = 'Sodium Laureth Sulfate';
  const ingredientBName = 'Parabens';
  const synonymA = 'SLS';
  const typoA = 'sodum laureth sulfete';
  const unknownIngredient = 'MysteryIngredient';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ClassificationModule, MethodologyModule, ProductModule, ProfileModule],
    }).compile();

    classificationService = moduleRef.get(ClassificationService);
    methodologyService = moduleRef.get(MethodologyService);
    productService = moduleRef.get(ProductService);
    profileService = moduleRef.get(ProfileService);
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    // Clean up all tables
    await prisma.classificationResult.deleteMany();
    await prisma.rule.deleteMany();
    await prisma.methodologyVersion.deleteMany();
    await prisma.productIngredient.deleteMany();
    await prisma.product.deleteMany();
    await prisma.ingredientSynonym.deleteMany();
    await prisma.ingredient.deleteMany();
    await prisma.profile.deleteMany();

    // Seed ingredients
    const ingredientA = await prisma.ingredient.create({ data: { name: ingredientAName } });
    const ingredientB = await prisma.ingredient.create({ data: { name: ingredientBName } });

    // Synonyms and OCR typo fixtures
    await prisma.ingredientSynonym.createMany({
      data: [
        { synonym: synonymA, ingredientId: ingredientA.id },
        { synonym: typoA, ingredientId: ingredientA.id },
      ],
    });

    // Create product with ingredients (including synonym, typo, unknown)
    await productService.create('Test Product', [
      synonymA, // resolves to ingredientA
      ingredientBName, // canonical name for ingredientB
      unknownIngredient, // unknown
      typoA, // typo resolves to ingredientA
    ]);

    // Create profile for child under 3
    await profileService.create('Child Under 3', 'child_under_3');

    // Publish methodology version v1
    await methodologyService.publishVersion('v1', [
      {
        ingredientName: ingredientAName,
        severity: Severity.watch,
        sourceCitation: 'regulator-2023',
      },
      {
        ingredientName: ingredientBName,
        severity: Severity.banned,
        sourceCitation: 'regulator-2023',
      },
    ]);
  });

  it('should classify product with unknown ingredient lowering confidence', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Product' } });
    expect(product).toBeDefined();

    const result = await classificationService.classify(product!.id);
    expect(result).toBeDefined();
    // Expect 3 recognized out of 4
    expect(result.confidence).toBeCloseTo(0.75);
    // Find unknown ingredient in findings
    const unknownFinding = result.findings.find((f) => f.unknown);
    expect(unknownFinding).toBeDefined();
    expect(unknownFinding?.original).toBe(unknownIngredient);
  });

  it('profile flips a finding severity', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Product' } });
    const profile = await prisma.profile.findFirst({ where: { name: 'Child Under 3' } });
    expect(product).toBeDefined();
    expect(profile).toBeDefined();

    const result = await classificationService.classify(product!.id, profile!.id);
    expect(result).toBeDefined();

    // Find ingredient A (Sodium Laureth Sulfate) finding
    const findingA = result.findings.find(
      (f) => f.canonical?.toLowerCase() === ingredientAName.toLowerCase(),
    );
    expect(findingA).toBeDefined();
    // Base severity was watch, profile should elevate to restricted
    expect(findingA?.severity).toBe(Severity.restricted);
  });

  it('synonym and OCR typo resolve to canonical ingredient', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Product' } });
    const result = await classificationService.classify(product!.id);
    const findingSynonym = result.findings.find(
      (f) => f.original.toLowerCase() === synonymA.toLowerCase(),
    );
    const findingTypo = result.findings.find(
      (f) => f.original.toLowerCase() === typoA.toLowerCase(),
    );
    expect(findingSynonym).toBeDefined();
    expect(findingTypo).toBeDefined();
    expect(findingSynonym?.canonical).toBe(ingredientAName);
    expect(findingTypo?.canonical).toBe(ingredientAName);
  });

  it('deterministic output across runs and shuffled ingredient order', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Product' } });
    const firstRun = await classificationService.classify(product!.id);
    const secondRun = await classificationService.classify(product!.id);
    expect(firstRun).toEqual(secondRun);

    // Create shuffled product
    const shuffledProduct = await productService.create('Shuffled Product', [
      typoA,
      unknownIngredient,
      ingredientBName,
      synonymA,
    ]);
    const shuffledResult = await classificationService.classify(shuffledProduct.id);
    // Normalize findings order (already sorted) should match original product findings
    expect(shuffledResult.findings).toEqual(firstRun.findings);
    expect(shuffledResult.confidence).toBeCloseTo(firstRun.confidence);
  });

  it('publishing new version retains old results and creates new ones', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Product' } });
    // Ensure v1 result exists
    const v1Result = await classificationService.getResult(product!.id, 'v1');
    expect(v1Result).toBeDefined();
    expect(v1Result.methodologyVersion).toBe('v1');
    // Publish v2 with ingredientA severity upgraded to restricted
    await methodologyService.publishVersion('v2', [
      {
        ingredientName: ingredientAName,
        severity: Severity.restricted,
        sourceCitation: 'regulator-2023',
      },
      {
        ingredientName: ingredientBName,
        severity: Severity.banned,
        sourceCitation: 'regulator-2023',
      },
    ]);

    // Retrieve v2 result
    const v2Result = await classificationService.getResult(product!.id, 'v2');
    expect(v2Result).toBeDefined();
    expect(v2Result.methodologyVersion).toBe('v2');

    // Verify that v1 result unchanged (severity still watch)
    const findingV1 = v1Result.findings.find(
      (f) => f.canonical?.toLowerCase() === ingredientAName.toLowerCase(),
    );
    expect(findingV1?.severity).toBe(Severity.watch);

    // Verify v2 result severity upgraded
    const findingV2 = v2Result.findings.find(
      (f) => f.canonical?.toLowerCase() === ingredientAName.toLowerCase(),
    );
    expect(findingV2?.severity).toBe(Severity.restricted);
  });
});
```

Now utils/normalizer.ts already added.

Now we need to make sure that classification.repository imports normalizeIngredient correctly.

Now also need to define imports for the DTOs.

Now need to adjust imports for Path.

Now add a file src/utils/normalizer.ts (already created). Ensure its path matches.

Now we may need to adjust the import path for ClassificationResultDto in classification.service, but it's fine.

Now add any missing exports.

Now we also need to ensure that the Prisma client has unique constraint productId_methodologyVersionId. The syntax in upsert where uses composite unique field. In Prisma, you must define @@unique([productId, methodologyVersionId]) and refer to it as productId_methodologyVersionId. The field name is combination of column names: productId_methodologyVersionId. That is correct.

Now check classification.repository methods for upsert: use `where: { productId_methodologyVersionId: { productId, methodologyVersionId } }`. That matches.

Now verify that classification.service's getResult uses classificationRepo.findResult and returns findings.

Now ensure that findResult returns classificationResult; the findings field is JSON. The type is any, but we cast.

Now ensure that the controller's getResult uses query param version.

Now we need to ensure that classification.module's providers include ClassificationRepository and ClassificationService.

Now the profile module exports ProfileService to be used by classification service if needed, but classification service uses ProfileRepository directly.

Now in classification.service's constructor we have profileRepo injected, which is provided by ProfileModule via its providers. Since classification module imports ProfileModule, profileRepo is accessible.

Now classification.service uses ClassificationRepository which is provided in same module.

Now ensure that the import paths for DTOs are correct.

Now check classification.controller for imports: ClassificationService, ClassificationResultDto, ClassifyDto.

Now we need to define classify.dto.ts and classification-result.dto.ts as we did.

Now we need to ensure that we have `classify` route.

Now we need to ensure that the test uses proper imports.

Now need to adjust test imports: we import from '../src/...' as relative path. That should be correct.

Now there may be missing imports for ProfileRepository, but classification.service only imports it; we need to provide ProfileRepository class in ProfileModule's providers.

Now need to adjust profile repository: create method findById as above.

Now we need to ensure that ProfileType enum is used in profile.repository createProfile. In Prisma schema, profile type is defined as enum. In TypeScript, we can use type string (value matches enum). In createProfile we accept type: string, pass to data.type. Should be fine.

Now the test's profile creation: profileService.create('Child Under 3', 'child_under_3').

Now ensure that profileService is exported from ProfileModule. It is exported.

Now the classification service's applyProfileModifier function expects profile.type as string; it doesn't use it.

Now we need to ensure that all modules have necessary imports.

Now we need to ensure that classification.service's upsert calls classificationRepo.upsertClassificationResult. That expects findings: FindingDto[]; we pass as such.

Now classification.repository upsert uses findings: findings as any.

Now need to add import of Severity type in classification.repository.

Now ensure that all imports compile.

Now need to check for potential circular dependencies:

- MethodologyModule imports ClassificationModule, which imports ProfileModule and ProductModule. ClassificationModule does not import MethodologyModule, which avoids circular.

- MethodologyService injects ClassificationService (provided by ClassificationModule). Since MethodologyModule imports ClassificationModule, the provider is available. That's okay.

Potential issues: ClassificationModule imports ProductModule, which also imports PrismaModule. That's fine.

Potential duplication: Both ClassificationModule and MethodologyModule import PrismaModule; that's okay as PrismaModule is global.

Now check for any missing imports: In classification.repository, we imported Rule, Severity, etc.

Now check for any usage of Severity in code: ClassificationService, classification.repository.

Now ensure that classification.service's getResult uses classificationRepo.findMethodologyVersionByName for version param.

Now need to adjust findMethodologyVersionByName method signature: we already have it.

Now classification.service's getResult returns findings directly from result.findings; ensure it's typed.

Now need to check that Prisma schema's product_ingredients table column name is ingredient_string, which matches our code: we refer to product_ingredients.ingredient_string.

Now need to ensure that the product creation method maps ingredient strings correctly: product_ingredients: { create: ingredientStrings.map... } with field ingredient_string.

Now ensure that product repository uses correct naming: property is ingredient_string.

Now we need to ensure that classification.service's findProductWithIngredients includes product_ingredients: true, which yields objects with ingredient_string property.

Now test uses classificationService.classify(product.id). Should work.

Now we need to ensure that the classification.service's classify method accepts profileId optional, and we call it accordingly.

Now in test, the first test runs classificationService.classify(product.id). That calls with profileId undefined and methodologyVersionId undefined (active version). That's fine.

Now second test passes profile.id to classification.

Now third test verifies synonyms and typo.

Now fourth test tests deterministic output and shuffled order. For shuffled product, we call productService.create('Shuffled Product', [...]) and classify. The findings should be same after sorting.

Now ensure that classification.service sorts findings by canonical name or original; for unknown, original name is used. In product1, unknown ingredient original is "MysteryIngredient". In shuffled product, unknown also same; sorting by original name will place unknown somewhere. In both runs, after sorting, the unknown will be placed according to lexical order. However the order of known ingredients may also be sorted; both will match.

Now test expects equality of findings arrays.

Potential risk: unknown ingredient being flagged unknown; the sorting may produce same order; fine.

Now test for v2 publication: methodologyService.publishVersion('v2', ...) should create new version and re-score all products. Our MethodologyService.publishVersion first checks if version already exists; if exists, return early (idempotent). Then performs transaction: deactivates all active versions, creates new version (active), upserts ingredients and creates rules. After transaction, it fetches newVersion, then gets product IDs and calls classificationService.classify(product.id, undefined, newVersion.id). That will store classification results keyed by productId + new version.

Now v1 result should still exist. The test uses classificationService.getResult(product.id, 'v1') to retrieve v1. getResult uses methodologyVersionByName('v1') and fetch result. Since version 'v1' is no longer active, but still present and not deleted, it works.

Now classificationService.getResult will retrieve result with methodologyVersionId of v1.

Now verify that v1 result severity for ingredientA remains watch, not changed. That's expected because v1 version's rule remained same; classification result stored previously remains unchanged. So test passes.

Now v2 result severity for ingredientA should be restricted as per new rule.

Now we need to ensure that methodologyService.publishVersion deactivates old versions but does not delete them.

Now the test expects classificationService.getResult(product.id, 'v2') to exist.

Now we need to ensure that the findResult method in repository can retrieve result for non-active version.

Now test passes.

Now we need to check for any errors like missing imports or type mismatches.

Let's review classification.service code again:

```ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ClassificationRepository } from './classification.repository';
import { ProfileRepository } from '../profiles/profile.repository';
import { ClassificationResultDto, FindingDto } from './dto/classification-result.dto';
import { Severity } from '@prisma/client';
import { normalizeIngredient } from '../utils/normalizer';
```

We need to ensure that `ClassificationResultDto` and `FindingDto` are exported from that file. Yes.

Now we need to check classification.repository imports: `import { Product, MethodologyVersion, Rule, ClassificationResult, Severity } from '@prisma/client';` That's fine.

Now classification.repository getRulesMapByVersion uses severityRank: { [key in Severity]: number }. That's okay.

Now classification.repository getSynonymMap uses normalizeIngredient imported.

Now classification.repository getCanonicalIngredientMap uses same.

Now classification.repository upsert uses findings: findings as any.

Now classification.service uses profile.type (string) in applyProfileModifier. Profile.type is enum (ProfileType). We treat as string. That's fine.

Now profile.repository findById returns a Profile object.

Now profile.service is simple.

Now we need to ensure that Prisma client schema for profile includes type field. Yes.

Now we need to ensure that we imported ProfileModule correctly in classification.module.

Now classification.module imports PrismaModule, ProfileModule, ProductModule.

Now classification.service uses profileRepo directly, which is provided by ProfileModule.

Now ensure that ProfileModule exports ProfileRepository? It provides and doesn't export. But classification.service depends on ProfileRepository injection. Since ProfileModule is imported into ClassificationModule, providers from ProfileModule are available to ClassificationModule (by default, if you import a module, you have access to its exported providers; to use a provider without exporting, you need to also add it to the exports of the module). Actually to use provider injection from another module, the provider must be exported from that module. So in ProfileModule we need to export ProfileRepository (or ProfileService) for injection. Since classification.service injects ProfileRepository, we need to export it. So modify ProfileModule exports: add ProfileRepository.

Update src/profiles/profile.module.ts:

```ts
@Module({
  imports: [PrismaModule],
  providers: [ProfileService, ProfileRepository],
  exports: [ProfileService, ProfileRepository],
})
export class ProfileModule {}
```

Alternatively, classification.service could inject ProfileService which is exported; but injection by type works if ProfileService is exported; but we still need to get the profile entity via ProfileService, not repository. Since we have both service and repository, we can inject ProfileService instead. But we will export both for safety.

Now classification.module imports ProfileModule, so profileRepo injection works.

Now product module may also need to export ProductRepository if needed, but classification.service does not use it directly.

Now classification.service's method getResult uses classificationRepo.findMethodologyVersionByName, which returns version; then classificationRepo.findResult. That works.

Now we need to ensure that classification.controller's GET endpoint's method signature matches.

Now ensure that swagger imports (ApiTags, etc.) are optional; not needed for compile but okay.

Now we need to add a DTO for the response.

Now need to add index exports? Not needed.

Now we need to create src/utils/normalizer.ts as we wrote.

Now create file.

Now final step: ensure all files are present.

List of files:

- prisma/schema.prisma
- src/main.ts
- src/app.module.ts
- src/prisma/prisma.service.ts
- src/prisma/prisma.module.ts
- src/utils/normalizer.ts
- src/classification/classification.module.ts
- src/classification/classification.controller.ts
- src/classification/classification.service.ts
- src/classification/classification.repository.ts
- src/classification/dto/classify.dto.ts
- src/classification/dto/classification-result.dto.ts
- src/methodology/methodology.module.ts
- src/methodology/methodology.service.ts
- src/methodology/methodology.repository.ts
- src/profiles/profile.module.ts
- src/profiles/profile.service.ts
- src/profiles/profile.repository.ts
- src/products/product.module.ts
- src/products/product.service.ts
- src/products/product.repository.ts
- test/classification.spec.ts

Now ensure that each file path uses repository-relative path as required.

Now check for any references to paths that may be mismatched: classification.service imports '../profiles/profile.repository'; correct relative path.

Now classification.service imports '../utils/normalizer'; correct.

Now classification.controller imports dto classes with './dto/...'; correct.

Now test imports relative path using '../src/...'; that's correct for test location.

Now we need to include any needed NestJS modules like ConfigModule for environment variables? Not required.

Now ensure that the PrismaService is imported correctly.

Now we must adjust classification.service to import ClassificationResultDto and FindingDto correctly from the dto folder.

We already did.

Now need to ensure that the code does not use any undefined variable.

Check classification.service: uses ClassificationRepository findActiveMethodologyVersion, findMethodologyVersionById etc.

Now classification.repository: findActiveMethodologyVersion uses `findFirst` with where active = true. Might return null if none.

Now classification.service getResult: if version param provided but method does not find version, throws BadRequest.

Now classification.service classify: for recognized ingredients we set recognizedCount++. However unknown also counted for total but not for recognized.

Now we need to handle case where recognized ingredient has no rule (no flag). According to spec, per-ingredient findings include flag, severity, source citation. If no rule, flag false, severity null, sourceCitation null. That matches our code: if rule missing, flag stays false, severity null.

Now recognizedCount counts recognized ingredients regardless of rule. Should confidence reflect known ingredient (resolved to canonical ingredient) regardless of rule. That's acceptable.

Now ensure that findAllProductIds is used? Not used currently; classification.service used for rescoring uses method classify with versionId. In methodology.service, after publishing version, we retrieve product IDs via methodologyRepo.findAllProducts (which returns id). Then we call classificationService.classify(p.id, undefined, newVersion.id). So that's fine.

Now check methodologyRepo.findAllProducts implementation: returns product IDs.

Now classification.service classify method with versionId: will call findMethodologyVersionById if versionId provided. That method returns version; it does not require active flag.

Now classification.repository upsert uses upsert with unique composite key.

Now we need to ensure that Prisma's upsert where uses unique index name: productId_methodologyVersionId. That name is derived from the fields in the unique constraint: productId + methodologyVersionId. In Prisma, you can reference the unique compound field as `productId_methodologyVersionId`. That's correct.

Now ensure that product_ingredients table column name matches the model field name `ingredient_string`. In product repository, we used `ingredient_string` correctly.

Now test uses `productService.create(name, ingredientStrings)`. productService.create uses productRepo.createProduct which maps ingredient_string.

Now ensure that we have appropriate import for ProductService in test.

Now test imports from src/... which is correct.

Now we must ensure that the test runs with a real database. In this environment, we can't run tests, but code must be logically correct.

Now note that the test uses `await classificationService.classify(product!.id);` which returns ClassificationResultDto. That includes findings.

Now test uses `expect(result).toEqual(secondRun)`. Since we return new object each call but content should be same, deep equality will pass.

Now test compares shuffledResult.findings to firstRun.findings; both sorted arrays, should match.

Now test retrieving v1 result after v2 publication: classificationService.getResult(product.id, 'v1') should find version v1. That version is no longer active, but we still have row.

Now classificationService.getResult will get methodologyVersion by name, then findResult; findResult uses unique composite key. It will return result with findings stored as JSON from previous run. The JSON is stored as a JS array; when we retrieve, it might be an object of type any, but we cast to FindingDto[]. That's okay.

Now check that methodologyService.publishVersion deactivates all active versions, then creates new version as active. It also upserts ingredients.

Now after publishing v2, the test calls classificationService.getResult(product.id, 'v2'). At that point, classificationService classifies the product with new version and upserts the result. That result is stored.

Now note that in methodologyService.publishVersion, after creating new version, we call findAllProducts to get product IDs, then loop through each product and call classificationService.classify(productId, undefined, newVersion.id). This will compute and upsert for new version. However, the classification results for v2 will be stored, but we also need to handle possible scenario where classificationService may attempt to use the new version's active status (which is true). That's okay. It also uses versionId explicitly, so it uses that version.

Now ensure that classificationService.classify for re-scoring with versionId does not rely on `profileId` default; we pass undefined for profileId, okay.

Now final touches: add any missing exports for modules. Already done.

Now we need to add import for ClassificationResultDto in controller.

Now ensure all imports have correct relative paths.

Now check for any missing directories: src/utils folder not defined yet; need to create folder.

Now final check.

Potential issues:

- In classification.repository, we used `this.prisma.ingredientSynonym.findMany({ include: { ingredient: true } })`. This fetches ingredient for each synonym, but we only need ingredientId. We already get ingredientId from syn.ingredientId, but we also may want to have normalized mapping. That's fine.

- In classification.repository.getSynonymMap: we call normalizeIngredient(syn.synonym). This is correct.

- In classification.repository.getCanonicalIngredientMap: we call normalizeIngredient(ing.name). That's correct.

- In classification.service.applyProfileModifier: we ignore profile type; but as per spec we need to define precedence and note in comment; we included comment.

- The classification.service may need to treat unknown ingredient as recognized false; we did.

- In confidence calculation: recognizedCount / totalCount. That matches spec: unknown lowers confidence.

Now test for unknown ingredient appears and confidence drops: we check that confidence close to 0.75.

Now test for synonyms resolution: we check canonical names.

Now test for profile flips: we check severity escalated.

Now test deterministic: run twice and compare; also shuffled product yields same findings.

Now test for version publishing: both versions results exist, old unchanged, new updated.

Now overall code meets the acceptance criteria.

Now let's produce final answer with all files in order.

Note: The instructions: "For each file, a level-3 heading holding only its repository-relative path, immediately followed by one fenced block holding only that file's content."

So we need to produce:

### prisma/schema.prisma

```prisma
...
```

Then next file.

Make sure to include code fences with appropriate language tags (ts for TypeScript, prisma for schema). Provide file path relative to repository root.

Now generate final answer.
```

## reply

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["mapRelationFields"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Severity {
  banned
  restricted
  watch
}

enum ProfileType {
  child_under_3
  pregnancy
}

model Ingredient {
  id        Int                @id @default(autoincrement())
  name      String             @unique @map("name")
  synonyms  IngredientSynonym[]
  rules     Rule[]

  @@map("ingredients")
}

model IngredientSynonym {
  id           Int        @id @default(autoincrement())
  synonym      String     @unique
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id])
  ingredientId Int

  @@map("ingredient_synonyms")
}

model MethodologyVersion {
  id          Int      @id @default(autoincrement())
  version     String   @unique
  created_at  DateTime @default(now()) @map("created_at")
  active      Boolean  @default(false)
  rules       Rule[]
  results     ClassificationResult[]

  @@map("methodology_versions")
}

model Rule {
  id                    Int               @id @default(autoincrement())
  ingredient            Ingredient        @relation(fields: [ingredientId], references: [id])
  ingredientId          Int
  severity              Severity
  source_citation       String            @map("source_citation")
  methodology_version   MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])
  methodologyVersionId  Int

  @@map("rules")
}

model Product {
  id                Int                 @id @default(autoincrement())
  name              String
  product_ingredients ProductIngredient[]
  results           ClassificationResult[]

  @@map("products")
}

model ProductIngredient {
  id                Int    @id @default(autoincrement())
  product           Product @relation(fields: [productId], references: [id])
  productId         Int
  ingredient_string String @map("ingredient_string")

  @@map("product_ingredients")
}

model ClassificationResult {
  id                  Int      @id @default(autoincrement())
  product             Product  @relation(fields: [productId], references: [id])
  productId           Int
  methodology_version MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])
  methodologyVersionId Int
  classified_at       DateTime @default(now()) @map("classified_at")
  confidence          Float
  disclaimer          String
  findings            Json

  @@unique([productId, methodologyVersionId])
  @@map("classification_results")
}

model Profile {
  id    Int        @id @default(autoincrement())
  name  String     @unique
  type  ProfileType

  @@map("profiles")
}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ClassificationModule } from './classification/classification.module';
import { MethodologyModule } from './methodology/methodology.module';
import { ProfileModule } from './profiles/profile.module';
import { ProductModule } from './products/product.module';

@Module({
  imports: [
    PrismaModule,
    ClassificationModule,
    MethodologyModule,
    ProfileModule,
    ProductModule,
  ],
})
export class AppModule {}
```

### src/prisma/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

### src/prisma/prisma.module.ts
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/utils/normalizer.ts
```ts
export function normalizeIngredient(input: string): string {
  // Lowercase
  let str = input.toLowerCase();
  // Unicode normalize and strip diacritics
  str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Remove punctuation (commas, hyphens, etc.) except spaces
  str = str.replace(/[.,;:()\-_/]/g, ' ');
  // Collapse whitespace
  str = str.replace(/\s+/g, ' ').trim();
  return str;
}
```

### src/classification/classification.module.ts
```ts
import { Module } from '@nestjs/common';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';
import { ClassificationRepository } from './classification.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { ProfileModule } from '../profiles/profile.module';
import { ProductModule } from '../products/product.module';

@Module({
  imports: [PrismaModule, ProfileModule, ProductModule],
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
  exports: [ClassificationService],
})
export class ClassificationModule {}
```

### src/classification/classification.controller.ts
```ts
import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ClassificationService } from './classification.service';
import { ClassificationResultDto } from './dto/classification-result.dto';
import { ClassifyDto } from './dto/classify.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('classifications')
@Controller('classifications')
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Post()
  @ApiOperation({ summary: 'Classify a product' })
  @ApiResponse({
    status: 200,
    description: 'Classification result',
    type: ClassificationResultDto,
  })
  async classify(@Body() dto: ClassifyDto): Promise<ClassificationResultDto> {
    const { productId, profileId } = dto;
    return this.classificationService.classify(productId, profileId);
  }

  @Get(':productId')
  @ApiOperation({ summary: 'Get stored classification result' })
  @ApiResponse({
    status: 200,
    description: 'Stored result',
    type: ClassificationResultDto,
  })
  async getResult(
    @Param('productId', ParseIntPipe) productId: number,
    @Query('version') version?: string,
  ): Promise<ClassificationResultDto> {
    return this.classificationService.getResult(productId, version);
  }
}
```

### src/classification/dto/classify.dto.ts
```ts
import { IsInt, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ClassifyDto {
  @ApiProperty({ description: 'ID of the product to classify' })
  @IsInt()
  @Min(1)
  productId: number;

  @ApiPropertyOptional({ description: 'Optional profile ID for contextual modifiers' })
  @IsOptional()
  @IsInt()
  @Min(1)
  profileId?: number;
}
```

### src/classification/dto/classification-result.dto.ts
```ts
import { ApiProperty } from '@nestjs/swagger';
import { Severity } from '@prisma/client';

export class FindingDto {
  @ApiProperty({ description: 'Original ingredient string as provided' })
  original: string;

  @ApiProperty({ description: 'Canonical ingredient name, if resolved', nullable: true })
  canonical?: string | null;

  @ApiProperty({ description: 'Whether this ingredient triggered a rule' })
  flag: boolean;

  @ApiProperty({ description: 'Severity level if flagged', enum: Severity, nullable: true })
  severity?: Severity | null;

  @ApiProperty({ description: 'Source citation for the rule', nullable: true })
  sourceCitation?: string | null;

  @ApiProperty({ description: 'True if the ingredient could not be resolved' })
  unknown: boolean;
}

export class ClassificationResultDto {
  @ApiProperty({ description: 'Product ID' })
  productId: number;

  @ApiProperty({ description: 'Methodology version used for classification' })
  methodologyVersion: string;

  @ApiProperty({ description: 'Overall confidence (0-1)' })
  confidence: number;

  @ApiProperty({ description: 'Disclaimer text' })
  disclaimer: string;

  @ApiProperty({ type: [FindingDto], description: 'Per-ingredient findings' })
  findings: FindingDto[];
}
```

### src/classification/classification.service.ts
```ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ClassificationRepository } from './classification.repository';
import { ProfileRepository } from '../profiles/profile.repository';
import { ClassificationResultDto, FindingDto } from './dto/classification-result.dto';
import { Severity } from '@prisma/client';
import { normalizeIngredient } from '../utils/normalizer';

@Injectable()
export class ClassificationService {
  constructor(
    private readonly classificationRepo: ClassificationRepository,
    private readonly profileRepo: ProfileRepository,
  ) {}

  async classify(
    productId: number,
    profileId?: number,
    methodologyVersionId?: number,
  ): Promise<ClassificationResultDto> {
    const product = await this.classificationRepo.findProductWithIngredients(productId);
    if (!product) {
      throw new NotFoundException(`Product with id ${productId} not found`);
    }

    const methodologyVersion = methodologyVersionId
      ? await this.classificationRepo.findMethodologyVersionById(methodologyVersionId)
      : await this.classificationRepo.findActiveMethodologyVersion();

    if (!methodologyVersion) {
      throw new BadRequestException('No active methodology version found');
    }

    const synonymMap = await this.classificationRepo.getSynonymMap(); // normalized synonym -> ingredientId
    const canonicalMap = await this.classificationRepo.getCanonicalIngredientMap(); // normalized name -> { id, name }

    const rulesMap = await this.classificationRepo.getRulesMapByVersion(methodologyVersion.id);

    const profile = profileId ? await this.profileRepo.findById(profileId) : null;
    if (profileId && !profile) {
      throw new NotFoundException(`Profile with id ${profileId} not found`);
    }

    const findings: FindingDto[] = [];
    let recognizedCount = 0;
    const totalCount = product.product_ingredients.length;

    for (const pi of product.product_ingredients) {
      const original = pi.ingredient_string;
      const normalized = normalizeIngredient(original);

      let ingredientId: number | null = null;
      let canonicalName: string | null = null;

      if (synonymMap.has(normalized)) {
        ingredientId = synonymMap.get(normalized)!;
        canonicalName = canonicalMap.get(normalized)?.name ?? null;
      } else if (canonicalMap.has(normalized)) {
        const entry = canonicalMap.get(normalized)!;
        ingredientId = entry.id;
        canonicalName = entry.name;
      }

      if (ingredientId) {
        recognizedCount++;
        const rule = rulesMap.get(ingredientId) ?? null;
        let flag = false;
        let severity: Severity | null = null;
        let sourceCitation: string | null = null;

        if (rule) {
          flag = true;
          severity = rule.severity;
          sourceCitation = rule.sourceCitation;
        }

        if (profile && severity) {
          severity = this.applyProfileModifier(severity, profile.type);
        }

        findings.push({
          original,
          canonical: canonicalName,
          flag,
          severity,
          sourceCitation,
          unknown: false,
        });
      } else {
        findings.push({
          original,
          canonical: null,
          flag: false,
          severity: null,
          sourceCitation: null,
          unknown: true,
        });
      }
    }

    // Deterministic ordering: sort findings by canonical name (or original) alphabetically
    findings.sort((a, b) => {
      const aKey = a.canonical?.toLowerCase() ?? a.original.toLowerCase();
      const bKey = b.canonical?.toLowerCase() ?? b.original.toLowerCase();
      return aKey.localeCompare(bKey);
    });

    const confidence = totalCount > 0 ? recognizedCount / totalCount : 0;
    const disclaimer = `Classification based on methodology version ${methodologyVersion.version}.`;

    await this.classificationRepo.upsertClassificationResult({
      productId: product.id,
      methodologyVersionId: methodologyVersion.id,
      confidence,
      disclaimer,
      findings,
    });

    return {
      productId: product.id,
      methodologyVersion: methodologyVersion.version,
      confidence,
      disclaimer,
      findings,
    };
  }

  async getResult(productId: number, version?: string): Promise<ClassificationResultDto> {
    const methodologyVersion = version
      ? await this.classificationRepo.findMethodologyVersionByName(version)
      : await this.classificationRepo.findActiveMethodologyVersion();

    if (!methodologyVersion) {
      throw new BadRequestException('Methodology version not found');
    }

    const result = await this.classificationRepo.findResult(productId, methodologyVersion.id);
    if (!result) {
      throw new NotFoundException(
        `Result for product ${productId} and version ${methodologyVersion.version} not found`,
      );
    }

    return {
      productId: result.productId,
      methodologyVersion: methodologyVersion.version,
      confidence: result.confidence,
      disclaimer: result.disclaimer,
      findings: result.findings as FindingDto[],
    };
  }

  /**
   * Apply profile modifiers to severity based on defined precedence.
   * Precedence: profile modifiers are applied after base rules and
   * elevate severity by one level (watch → restricted → banned).
   * If severity is already 'banned', it remains 'banned'.
   */
  private applyProfileModifier(severity: Severity, profileType: string): Severity {
    // For this implementation, all profile types share the same escalation logic.
    const order: Severity[] = ['watch', 'restricted', 'banned'];
    const idx = order.indexOf(severity);
    if (idx === -1) return severity;
    const newIdx = Math.min(idx + 1, order.length - 1);
    return order[newIdx];
  }
}
```

### src/classification/classification.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Product,
  MethodologyVersion,
  Rule,
  ClassificationResult,
  Severity,
} from '@prisma/client';
import { FindingDto } from './dto/classification-result.dto';
import { normalizeIngredient } from '../utils/normalizer';

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProductWithIngredients(productId: number): Promise<
    Product & {
      product_ingredients: { ingredient_string: string }[];
    } | null
  > {
    return this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        product_ingredients: true,
      },
    });
  }

  async findActiveMethodologyVersion(): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findFirst({
      where: { active: true },
    });
  }

  async findMethodologyVersionById(id: number): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findUnique({
      where: { id },
    });
  }

  async findMethodologyVersionByName(version: string): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findUnique({
      where: { version },
    });
  }

  /**
   * Returns a map of normalized synonym => ingredientId
   */
  async getSynonymMap(): Promise<Map<string, number>> {
    const synonyms = await this.prisma.ingredientSynonym.findMany({
      include: {
        ingredient: true,
      },
    });
    const map = new Map<string, number>();
    for (const syn of synonyms) {
      const normalized = normalizeIngredient(syn.synonym);
      map.set(normalized, syn.ingredientId);
    }
    return map;
  }

  /**
   * Returns a map of normalized canonical ingredient name => { id, name }
   */
  async getCanonicalIngredientMap(): Promise<Map<string, { id: number; name: string }>> {
    const ingredients = await this.prisma.ingredient.findMany();
    const map = new Map<string, { id: number; name: string }>();
    for (const ing of ingredients) {
      const normalized = normalizeIngredient(ing.name);
      map.set(normalized, { id: ing.id, name: ing.name });
    }
    return map;
  }

  /**
   * Returns a map of ingredientId => Rule with highest severity for the given methodology version
   */
  async getRulesMapByVersion(versionId: number): Promise<Map<number, Rule>> {
    const rules = await this.prisma.rule.findMany({
      where: { methodologyVersionId: versionId },
    });
    const severityRank: { [key in Severity]: number } = {
      watch: 1,
      restricted: 2,
      banned: 3,
    };
    const map = new Map<number, Rule>();
    for (const rule of rules) {
      const existing = map.get(rule.ingredientId);
      if (!existing || severityRank[rule.severity] > severityRank[existing.severity]) {
        map.set(rule.ingredientId, rule);
      }
    }
    return map;
  }

  async upsertClassificationResult(params: {
    productId: number;
    methodologyVersionId: number;
    confidence: number;
    disclaimer: string;
    findings: FindingDto[];
  }): Promise<ClassificationResult> {
    const { productId, methodologyVersionId, confidence, disclaimer, findings } = params;
    return this.prisma.classificationResult.upsert({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId,
        },
      },
      create: {
        productId,
        methodologyVersionId,
        confidence,
        disclaimer,
        findings: findings as any,
      },
      update: {
        confidence,
        disclaimer,
        findings: findings as any,
      },
    });
  }

  async findResult(productId: number, methodologyVersionId: number): Promise<ClassificationResult | null> {
    return this.prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId,
        },
      },
    });
  }

  async findAllProductIds(): Promise<number[]> {
    const products = await this.prisma.product.findMany({
      select: { id: true },
    });
    return products.map(p => p.id);
  }
}
```

### src/methodology/methodology.module.ts
```ts
import { Module } from '@nestjs/common';
import { MethodologyService } from './methodology.service';
import { MethodologyRepository } from './methodology.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { ClassificationModule } from '../classification/classification.module';

@Module({
  imports: [PrismaModule, ClassificationModule],
  providers: [MethodologyService, MethodologyRepository],
  exports: [MethodologyService],
})
export class MethodologyModule {}
```

### src/methodology/methodology.service.ts
```ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { MethodologyRepository } from './methodology.repository';
import { ClassificationService } from '../classification/classification.service';
import { PrismaService } from '../prisma/prisma.service';
import { Severity } from '@prisma/client';

interface RuleInput {
  ingredientName: string;
  severity: Severity;
  sourceCitation: string;
}

/**
 * Service to manage methodology versions and trigger re-scoring.
 */
@Injectable()
export class MethodologyService {
  constructor(
    private readonly methodologyRepo: MethodologyRepository,
    private readonly classificationService: ClassificationService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Publishes a new methodology version with the given rules.
   * Re-scores all existing products. The operation is idempotent.
   *
   * Precedence for rule application:
   * - New version is immutable.
   * - Existing version results are retained.
   * - Re-scoring uses the new version exclusively.
   */
  async publishVersion(versionName: string, rules: RuleInput[]): Promise<void> {
    // Check if version already exists (idempotent)
    const existing = await this.methodologyRepo.findVersionByName(versionName);
    if (existing) {
      return;
    }

    // Transactional creation
    await this.prisma.$transaction(async (tx) => {
      // Deactivate old active versions
      await tx.methodologyVersion.updateMany({
        where: { active: true },
        data: { active: false },
      });

      // Create new version
      const newVersion = await tx.methodologyVersion.create({
        data: {
          version: versionName,
          active: true,
        },
      });

      // Ensure ingredients exist; create if missing and add rules
      for (const rule of rules) {
        const ingredient = await tx.ingredient.upsert({
          where: { name: rule.ingredientName },
          update: {}, // No updates to immutable ingredient
          create: {
            name: rule.ingredientName,
          },
        });

        await tx.rule.create({
          data: {
            ingredientId: ingredient.id,
            severity: rule.severity,
            sourceCitation: rule.sourceCitation,
            methodologyVersionId: newVersion.id,
          },
        });
      }
    });

    // After publishing, re-score all products using the new version
    const newVersion = await this.methodologyRepo.findVersionByName(versionName);
    if (!newVersion) {
      throw new BadRequestException('Failed to retrieve newly created methodology version');
    }

    const productIds = await this.methodologyRepo.findAllProducts();
    for (const p of productIds) {
      // Classify with explicit versionId to ensure idempotency
      await this.classificationService.classify(p.id, undefined, newVersion.id);
    }
  }
}
```

### src/methodology/methodology.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MethodologyVersion, Rule } from '@prisma/client';

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async deactivateAllVersions(): Promise<void> {
    await this.prisma.methodologyVersion.updateMany({
      where: { active: true },
      data: { active: false },
    });
  }

  async createVersion(version: string): Promise<MethodologyVersion> {
    return this.prisma.methodologyVersion.create({
      data: {
        version,
        active: true,
      },
    });
  }

  async findVersionByName(version: string): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findUnique({
      where: { version },
    });
  }

  async addRule(
    methodologyVersionId: number,
    ingredientId: number,
    severity: string,
    sourceCitation: string,
  ): Promise<Rule> {
    return this.prisma.rule.create({
      data: {
        ingredientId,
        severity: severity as any,
        sourceCitation,
        methodologyVersionId,
      },
    });
  }

  async findAllProducts(): Promise<{ id: number }[]> {
    return this.prisma.product.findMany({
      select: { id: true },
    });
  }
}
```

### src/profiles/profile.module.ts
```ts
import { Module } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ProfileRepository } from './profile.repository';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ProfileService, ProfileRepository],
  exports: [ProfileService, ProfileRepository],
})
export class ProfileModule {}
```

### src/profiles/profile.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { ProfileRepository } from './profile.repository';
import { Profile } from '@prisma/client';

@Injectable()
export class ProfileService {
  constructor(private readonly profileRepo: ProfileRepository) {}

  async create(name: string, type: string): Promise<Profile> {
    return this.profileRepo.createProfile(name, type);
  }

  async findById(id: number) {
    return this.profileRepo.findById(id);
  }
}
```

### src/profiles/profile.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Profile } from '@prisma/client';

@Injectable()
export class ProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: number): Promise<Profile | null> {
    return this.prisma.profile.findUnique({
      where: { id },
    });
  }

  async createProfile(name: string, type: string): Promise<Profile> {
    return this.prisma.profile.create({
      data: {
        name,
        type,
      },
    });
  }
}
```

### src/products/product.module.ts
```ts
import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductRepository } from './product.repository';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ProductService, ProductRepository],
  exports: [ProductService],
})
export class ProductModule {}
```

### src/products/product.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { ProductRepository } from './product.repository';
import { Product } from '@prisma/client';

@Injectable()
export class ProductService {
  constructor(private readonly productRepo: ProductRepository) {}

  async create(name: string, ingredientStrings: string[]): Promise<Product> {
    return this.productRepo.createProduct(name, ingredientStrings);
  }

  async findById(id: number) {
    return this.productRepo.findById(id);
  }
}
```

### src/products/product.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Product, ProductIngredient } from '@prisma/client';

@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createProduct(name: string, ingredientStrings: string[]): Promise<Product> {
    return this.prisma.product.create({
      data: {
        name,
        product_ingredients: {
          create: ingredientStrings.map((s) => ({
            ingredient_string: s,
          })),
        },
      },
    });
  }

  async findById(id: number) {
    return this.prisma.product.findUnique({
      where: { id },
      include: {
        product_ingredients: true,
      },
    });
  }
}
```

### test/classification.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { ClassificationService } from '../src/classification/classification.service';
import { ClassificationModule } from '../src/classification/classification.module';
import { MethodologyModule } from '../src/methodology/methodology.module';
import { ProductModule } from '../src/products/product.module';
import { ProfileModule } from '../src/profiles/profile.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MethodologyService } from '../src/methodology/methodology.service';
import { ProductService } from '../src/products/product.service';
import { ProfileService } from '../src/profiles/profile.service';
import { expect } from 'vitest';
import { Severity } from '@prisma/client';

describe('ClassificationService (e2e)', () => {
  let moduleRef: TestingModule;
  let classificationService: ClassificationService;
  let methodologyService: MethodologyService;
  let productService: ProductService;
  let profileService: ProfileService;
  let prisma: PrismaService;

  const ingredientAName = 'Sodium Laureth Sulfate';
  const ingredientBName = 'Parabens';
  const synonymA = 'SLS';
  const typoA = 'sodum laureth sulfete';
  const unknownIngredient = 'MysteryIngredient';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ClassificationModule, MethodologyModule, ProductModule, ProfileModule],
    }).compile();

    classificationService = moduleRef.get(ClassificationService);
    methodologyService = moduleRef.get(MethodologyService);
    productService = moduleRef.get(ProductService);
    profileService = moduleRef.get(ProfileService);
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    // Clean up all tables
    await prisma.classificationResult.deleteMany();
    await prisma.rule.deleteMany();
    await prisma.methodologyVersion.deleteMany();
    await prisma.productIngredient.deleteMany();
    await prisma.product.deleteMany();
    await prisma.ingredientSynonym.deleteMany();
    await prisma.ingredient.deleteMany();
    await prisma.profile.deleteMany();

    // Seed ingredients
    const ingredientA = await prisma.ingredient.create({ data: { name: ingredientAName } });
    const ingredientB = await prisma.ingredient.create({ data: { name: ingredientBName } });

    // Synonyms and OCR typo fixtures
    await prisma.ingredientSynonym.createMany({
      data: [
        { synonym: synonymA, ingredientId: ingredientA.id },
        { synonym: typoA, ingredientId: ingredientA.id },
      ],
    });

    // Create product with ingredients (including synonym, typo, unknown)
    await productService.create('Test Product', [
      synonymA, // resolves to ingredientA
      ingredientBName, // canonical name for ingredientB
      unknownIngredient, // unknown
      typoA, // typo resolves to ingredientA
    ]);

    // Create profile for child under 3
    await profileService.create('Child Under 3', 'child_under_3');

    // Publish methodology version v1
    await methodologyService.publishVersion('v1', [
      {
        ingredientName: ingredientAName,
        severity: Severity.watch,
        sourceCitation: 'regulator-2023',
      },
      {
        ingredientName: ingredientBName,
        severity: Severity.banned,
        sourceCitation: 'regulator-2023',
      },
    ]);
  });

  it('should classify product with unknown ingredient lowering confidence', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Product' } });
    expect(product).toBeDefined();

    const result = await classificationService.classify(product!.id);
    expect(result).toBeDefined();
    // Expect 3 recognized out of 4
    expect(result.confidence).toBeCloseTo(0.75);
    // Find unknown ingredient in findings
    const unknownFinding = result.findings.find((f) => f.unknown);
    expect(unknownFinding).toBeDefined();
    expect(unknownFinding?.original).toBe(unknownIngredient);
  });

  it('profile flips a finding severity', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Product' } });
    const profile = await prisma.profile.findFirst({ where: { name: 'Child Under 3' } });
    expect(product).toBeDefined();
    expect(profile).toBeDefined();

    const result = await classificationService.classify(product!.id, profile!.id);
    expect(result).toBeDefined();

    // Find ingredient A (Sodium Laureth Sulfate) finding
    const findingA = result.findings.find(
      (f) => f.canonical?.toLowerCase() === ingredientAName.toLowerCase(),
    );
    expect(findingA).toBeDefined();
    // Base severity was watch, profile should elevate to restricted
    expect(findingA?.severity).toBe(Severity.restricted);
  });

  it('synonym and OCR typo resolve to canonical ingredient', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Product' } });
    const result = await classificationService.classify(product!.id);
    const findingSynonym = result.findings.find(
      (f) => f.original.toLowerCase() === synonymA.toLowerCase(),
    );
    const findingTypo = result.findings.find(
      (f) => f.original.toLowerCase() === typoA.toLowerCase(),
    );
    expect(findingSynonym).toBeDefined();
    expect(findingTypo).toBeDefined();
    expect(findingSynonym?.canonical).toBe(ingredientAName);
    expect(findingTypo?.canonical).toBe(ingredientAName);
  });

  it('deterministic output across runs and shuffled ingredient order', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Product' } });
    const firstRun = await classificationService.classify(product!.id);
    const secondRun = await classificationService.classify(product!.id);
    expect(firstRun).toEqual(secondRun);

    // Create shuffled product
    const shuffledProduct = await productService.create('Shuffled Product', [
      typoA,
      unknownIngredient,
      ingredientBName,
      synonymA,
    ]);
    const shuffledResult = await classificationService.classify(shuffledProduct.id);
    // Findings are sorted deterministically, so they should match
    expect(shuffledResult.findings).toEqual(firstRun.findings);
    expect(shuffledResult.confidence).toBeCloseTo(firstRun.confidence);
  });

  it('publishing new version retains old results and creates new ones', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Product' } });
    // Ensure v1 result exists
    const v1Result = await classificationService.getResult(product!.id, 'v1');
    expect(v1Result).toBeDefined();
    expect(v1Result.methodologyVersion).toBe('v1');
    // Publish v2 with ingredientA severity upgraded to restricted
    await methodologyService.publishVersion('v2', [
      {
        ingredientName: ingredientAName,
        severity: Severity.restricted,
        sourceCitation: 'regulator-2023',
      },
      {
        ingredientName: ingredientBName,
        severity: Severity.banned,
        sourceCitation: 'regulator-2023',
      },
    ]);

    // Retrieve v2 result
    const v2Result = await classificationService.getResult(product!.id, 'v2');
    expect(v2Result).toBeDefined();
    expect(v2Result.methodologyVersion).toBe('v2');

    // Verify that v1 result unchanged (severity still watch)
    const findingV1 = v1Result.findings.find(
      (f) => f.canonical?.toLowerCase() === ingredientAName.toLowerCase(),
    );
    expect(findingV1?.severity).toBe(Severity.watch);

    // Verify v2 result severity upgraded
    const findingV2 = v2Result.findings.find(
      (f) => f.canonical?.toLowerCase() === ingredientAName.toLowerCase(),
    );
    expect(findingV2?.severity).toBe(Severity.restricted);
  });
});
```
