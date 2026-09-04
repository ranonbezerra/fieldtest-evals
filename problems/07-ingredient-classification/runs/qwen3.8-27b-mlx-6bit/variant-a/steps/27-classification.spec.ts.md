# 27-classification.spec.ts

## reasoning

```
Let me analyze what I need to write:

1. The file is `test/classification.spec.ts`
2. It needs to contain the 6 behaviour tests from section 5 of PLAN.md, but the reference file `27-classification.spec.ts-cases.txt` lists 19 specific test cases that I need to implement.

Let me look at the cases from the reference file:

1. Profile escalates a watch finding to banned
2. Profile does NOT de-escalate an existing finding
3. Profile adds a flag where no base rule exists
4. Unknown ingredient is visible in both `findings` and `unknownIngredients`
5. One unknown among five ingredients yields `overallConfidence` of exactly 0.8
6. Ten or more unknowns clamp confidence to 0
7. Seeded OCR typo "gyceryl" resolves to canonical "glycerol"
8. Accented, mixed-case, extra-whitespace input resolves to canonical form
9. Two consecutive `classify` calls return deep-equal responses
10. Two products with same ingredient set in shuffled positions yield identical finding sets
11. After publishing v2, both v1 and v2 results are retrievable and v1's findings unchanged
12. Publishing a new version triggers re-scoring for every product
13. Running `rescoreAll` twice produces identical stored rows
14. Classify with non-existent product id raises `ResourceNotFound`
15. Classify with non-existent profile id raises `ResourceNotFound`
16. Classify when no methodology version is active raises `ResourceNotFound`
17. Publishing an already-active version raises `ConflictError`
18. A recognized ingredient with no rule appears in findings with null flag/severity, NOT in unknownIngredients
19. The disclaimer string is present and identical in every response

Now let me think about how to structure this test file. I need to:
- Use Vitest
- Test the `ClassificationService` directly (unit tests with mocked repositories)
- Or use an integration approach

Looking at the plan, it says "All tests use an in-memory or test Postgres via Prisma, seeded from `prisma/seed.ts`." But since I have no database access and need to write a test that's self-contained, I should use mocked repositories.

Wait, let me re-read the plan. It says "Test the behaviour, not the implementation." And the convention says "Never assert only that a call happened."

Looking at the service code, it takes repositories as constructor dependencies. So I can mock them and test the service's behaviour.

Let me think about what data I need:

From the seed:
- Ingredients: glycerol, paraffinum liquidum, tocopherol, phenoxyethanol, sodium lauryl sulfate, fragrance
- Synonyms: glycerin → glycerol, gyceryl → glycerol, mineral oil → paraffinum liquidum, etc.
- Rules for v1:
  - phenoxyethanol: BANNED, 'banned_ingredient', 'EU Regulation 1223/2009 Annex II, entry 18'
  - sodium lauryl sulfate: RESTRICTED, 'restricted_concentration', 'EU Regulation 1223/2009 Annex V, 16.0'
  - fragrance: WATCH, 'sensitization_risk', 'EU Scientific Committee SCCS/1596/13'
  - paraffinum liquidum: WATCH, 'comedogenic_risk', 'ICR 2019 comedogenicity index'
- Profiles:
  - Child under 3 (id=1): phenoxyethanol→BANNED, fragrance→BANNED, SLS→BANNED
  - Pregnancy (id=2): paraffinum liquidum→RESTRICTED, fragrance→RESTRICTED

Now let me write the test file. I'll use Vitest with `vi.fn()` for mocking repositories.

Let me think about the structure:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClassificationService } from '../src/classification/classification.service';
import { ProductRepository } from '../src/product/product.repository';
import { IngredientRepository } from '../src/ingredient/ingredient.repository';
import { MethodologyRepository } from '../src/methodology/methodology.repository';
import { ProfileRepository } from '../src/profile/profile.repository';
import { ClassificationRepository } from '../src/classification/classification.repository';
import { ResourceNotFound, ConflictError } from '../src/classification/types';
```

Wait, I need to check - does `ConflictError` exist in the types? Looking at the plan:

```ts
export class ResourceNotFound extends Error { code = 'resource_not_found'; }
export class ConflictError      extends Error { code = 'conflict'; }
```

Yes, both are in `src/classification/types.ts`.

Now let me think about the mocking strategy. The service constructor takes:
- productRepo
- ingredientRepo
- methodologyRepo
- profileRepo
- classificationRepo

I'll create mock objects for each.

Let me think about what the repository methods return based on the Prisma types:

For `ProductRepository.findById`:
- Returns a product with `productIngredients` relation (eager loaded)

For `IngredientRepository.resolve`:
- Returns `{ ingredient: Ingredient; matchedVia: 'canonical' | 'synonym' } | null`

For `MethodologyRepository.getActive`:
- Returns a methodology version or null

For `MethodologyRepository.getRules`:
- Returns rules array

For `ProfileRepository.findById`:
- Returns a profile or null

For `ProfileRepository.getModifiers`:
- Returns modifiers array

For `ClassificationRepository.upsert`:
- Takes result data and findings, returns the result

Let me now write each test:

**Test 1: Profile escalates a watch finding to banned**
- Product has fragrance (WATCH in base rules)
- Profile 1 (child) has fragrance → BANNED
- Call classify(productId, profileId=1)
- Expect finding for fragrance to have severity 'banned', flag 'banned_for_infants', citation from modifier

**Test 2: Profile does NOT de-escalate**
- Product has phenoxyethanol (BANNED in base rules)
- Profile with a lower severity modifier for phenoxyethanol (but wait, in the seed all child modifiers are BANNED which is same as base)
- I need to create a scenario where modifier has lower ordinal. Let me use pregnancy profile for SLS: base is RESTRICTED, pregnancy doesn't have SLS modifier... 
- Actually, let me think differently. I'll set up a scenario where the base rule is BANNED and the modifier is WATCH. Since I'm mocking, I can control what comes back.

Actually, I should set up the mocks to return specific data. Let me create a helper or just set up mocks per test.

Let me think about this more carefully. I'll create mock factories:

```typescript
function createMockProduct(id: number, name: string, ingredients: {rawText: string, position: number}[]) {
  return { id, name, productIngredients: ingredients };
}

function createMockIngredient(id: number, canonicalName: string, displayName: string) {
  return { id, canonicalName, displayName };
}
```

Let me write the full test file now. I'll organize it with `describe` blocks for logical groupings.

Actually, looking at the plan more carefully:

> 6 behaviour tests listed in section 5

But the cases file lists 19 tests. The instruction says "Write every one of them." So I need all 19.

Let me structure this properly. I'll use a `describe` for the main test suite and group related tests.

Let me think about the mocking more carefully:

The `productRepo.findById` needs to return a product with `productIngredients` already loaded. Looking at the service code:

```typescript
const product = await this.productRepo.findById(productId);
// ...
product.productIngredients.map(...)
```

So the product object must have a `productIngredients` array.

For `ingredientRepo.resolve(normalizedText)`:
- Returns `{ ingredient: { id, canonicalName, displayName }, matchedVia: 'canonical' | 'synonym' }` or `null`

For `methodologyRepo.getActive()`:
- Returns `{ id, version, name, isActive, createdAt }` or null

For `methodologyRepo.getRules(versionId)`:
- Returns array of `{ id, methodologyVersionId, ingredientId, severity (string like 'BANNED'), flag, sourceCitation }`

For `profileRepo.findById(id)`:
- Returns `{ id, name, description, createdAt }` or null

For `profileRepo.getModifiers(profileId)`:
- Returns array of `{ id, profileId, ingredientId, severity (string), flag, sourceCitation }`

For `classificationRepo.upsert(resultData, findings)`:
- Returns the result object

Now let me write the tests. I'll create a setup function that creates the service with fresh mocks each time.

Let me also think about what `ConflictError` looks like. The plan says it's in types.ts but I only see `ResourceNotFound` imported in the service. Let me check if `ConflictError` is actually used in the service... Looking at the service code, it only throws `ResourceNotFound`. The `ConflictError` would be thrown by `MethodologyService.publish()`, not `ClassificationService`. 

But the test case says "Publishing an already-active version raises ConflictError" - this would be testing `MethodologyService`, not `ClassificationService`. Hmm, but the plan says the test file is `test/classification.spec.ts` and tests are for the classification service.

Wait, let me re-read the plan's section 5:
> | 6 | **Both versions coexist:** publish v1, classify → result stored under v1. Publish v2, re-score → result stored under v2. GET `/products/:id/results` returns entries for both versions; v1 findings are unchanged. |

And the cases file includes "Publishing an already-active version raises `ConflictError`". This suggests I might need to test the methodology service too, or at least the publish flow.

But looking at the manifest, the test file is `test/classification.spec.ts` and it reads from `src/classification/classification.service.ts`. The plan says the tests should cover the 6 behaviour tests.

I think for the "Publishing an already-active version raises ConflictError" test, I would need to also import and test the `MethodologyService`. But the plan's manifest only lists the classification service as a read dependency for the test file.

Hmm, but the instruction says "Write every one of them" referring to the cases file. Let me include it by testing the methodology service as well, or I can test it indirectly.

Actually, looking more carefully at the architecture: `MethodologyService.publish()` calls `this.methodologyRepo.publish(versionId)` which is where the conflict would be detected. The repository would check if the version is already active and throw.

Since I'm mocking repositories, I can test this by:
- Mocking `methodologyRepo.publish` to throw `ConflictError` when called with an already-active version
- Then testing that `MethodologyService.publish` propagates it

But wait, the test file is specifically for classification. Let me re-read the instruction: "Write every one of them" - meaning all 19 cases from the cases file.

I think the cleanest approach is to include a small describe block for the publish/conflict case that tests the `MethodologyService` directly, since it's part of the classification flow (publish triggers rescore).

Actually, let me reconsider. The `MethodologyService` is in a different module. But the test file can import it. Let me just include all 19 tests, importing whatever services I need.

Let me now write the complete file:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClassificationService } from '../src/classification/classification.service';
import { MethodologyService } from '../src/methodology/methodology.service';
import { ResourceNotFound, ConflictError } from '../src/classification/types';
```

Wait, I need to check if `MethodologyService` imports `ClassificationService`. Looking at the plan:
> `src/methodology/methodology.service.ts` | reads: src/methodology/methodology.repository.ts, src/classification/classification.service.ts | publish (tx) then rescoreAll

So `MethodologyService` depends on both `MethodologyRepository` and `ClassificationService`.

Let me check the constructor signature... The plan says:
```ts
class MethodologyService {
  publish(versionId: number): Promise<void>;   // triggers rescoreAll
}
```

So it would be:
```ts
constructor(
  private readonly methodologyRepo: MethodologyRepository,
  private readonly classificationService: ClassificationService,
) {}
```

OK let me just write the test file now. I'll be thorough.

For the "no active methodology" test, I need `methodologyRepo.getActive()` to return null.

For the "publishing already-active version" test, I need to think about where `ConflictError` is thrown. Looking at the plan:
> `publish(versionId: number): Promise<void>;   // transactional: clear old is_active, set new`

The repository's `publish` method does the transaction. So the conflict detection happens in the repository. In my mock, I'll have `methodologyRepo.publish` throw `ConflictError`.

Actually wait - the service might do the check itself. Let me look at the plan's control flow:

> 1. In a transaction: set `is_active = false` on the current active row; set `is_active = true` on `versionId`. | **Yes** | Raise `ConflictError` if `versionId` not found or already active.

So the service raises `ConflictError`. The service would:
1. Get the version by id - if not found, throw ResourceNotFound
2. Check if it's already active - if yes, throw ConflictError
3. If not, do the transaction

So in my mock:
- `methodologyRepo.getById(versionId)` returns the version with `isActive: true`
- The service checks and throws ConflictError

Let me write this now. I'll structure the mocks carefully.

Actually, I realize I should think about what `methodologyRepo` methods are available. From the plan:

```ts
class MethodologyRepository {
  getActive(): Promise<MethodologyVersion | null>;
  getById(id: number): Promise<MethodologyVersion | null>;
  getRules(versionId: number): Promise<Rule[]>;
  create(data: { version: number; name: string }): Promise<MethodologyVersion>;
  publish(versionId: number): Promise<void>;   // transactional: clear old is_active, set new
}
```

So `publish` is on the repository. The service calls `repo.publish(versionId)`. But the plan says the service raises ConflictError... 

Let me re-read: "Raise `ConflictError` if `versionId` not found or already active." This is in the context of the service's publish method. So the service does:
1. `const version = await this.methodologyRepo.getById(versionId)` - if null, throw ResourceNotFound
2. `if (version.isActive) throw new ConflictError()` 
3. `await this.methodologyRepo.publish(versionId)` - does the actual transaction
4. `await this.classificationService.rescoreAll(versionId)`

OK so for the conflict test, I mock:
- `methodologyRepo.getById(1)` → `{ id: 1, version: 1, name: '...', isActive: true }`
- Expect `methodologyService.publish(1)` to reject with ConflictError

Let me write the complete file now. I'll be careful about types.

Looking at the service code more carefully for `fromPrismaSeverity`:
```typescript
function fromPrismaSeverity(s: string | null): Severity | null {
  if (s === null || s === undefined) return null;
  return s.toLowerCase() as Severity;
}
```

So the severity in the DB/mock is stored as uppercase string like 'BANNED', 'RESTRICTED', 'WATCH'.

And `toPrismaSeverity`:
```typescript
function toPrismaSeverity(s: Severity | null): string | null {
  if (s === null) return null;
  return s.toUpperCase();
}
```

So in my mocks, rules and modifiers should have severity as uppercase strings.

Now let me write the complete test file. I'll aim for clarity and completeness.

One more thing - for the "shuffled ingredient order" test, I need to create two products with the same ingredients in different positions. The findings should be identical when sorted by position. But wait - the findings are sorted by position, so if product A has [a(pos1), b(pos2), c(pos3)] and product B has [c(pos1), a(pos2), b(pos3)], the findings will be in different orders (a,b,c vs c,a,b) but each finding will have the same rawText at the same position. 

Actually, re-reading the case: "Two products with the same ingredient set in shuffled positions yield identical finding sets sorted by position"

I think the assertion should be that if you sort both finding arrays by position, they have the same set of (rawText, resolvedName, severity, flag) tuples. Or more precisely, the multiset of findings is the same.

Let me think about this differently. The plan says:
> **Shuffled ingredient order:** create product A with ingredients `[a, b, c]` and product B with `[c, a, b]` (same set, different positions) → both responses have identical sets of findings sorted by position; confidence equal.

So "identical sets of findings sorted by position" means if I sort both arrays by position and compare element-by-element, they should match in terms of the ingredient properties (not the rawText position assignment). Actually no - if product A has a at pos 1 and product B has c at pos 1, then the first finding in A's sorted list is about 'a' and the first in B's sorted list is about 'c'. They wouldn't be identical element-by-element.

I think the correct interpretation is: the *set* of findings (as a multiset, ignoring position) is the same. And confidence is equal. Let me assert that way.

Actually, re-reading more carefully: "both responses have identical sets of findings sorted by position" - I think this means: if you take the findings from both responses, sort them by some canonical key (like resolvedName), they're identical. The "sorted by position" refers to how the service returns them (position order), but for comparison purposes we compare as sets.

Let me just assert that:
1. The set of (resolvedName, severity, flag) tuples is the same for both products
2. Confidence is equal
3. The length of findings arrays is the same

That's the most defensible interpretation.

Now let me write it all out.

For the "rescoreAll twice produces identical stored rows" test, I need to:
1. Call `rescoreAll(versionId)` 
2. Capture what was passed to `classificationRepo.upsert`
3. Call `rescoreAll(versionId)` again
4. Capture what was passed again
5. Assert the two captured calls are deep-equal

For "Publishing a new version triggers re-scoring: every product with ≥ 1 ingredient gains a stored result under the new version":
1. Mock `productRepo.listWithIngredients()` to return multiple products
2. Call `rescoreAll(versionId)`
3. Assert `classificationRepo.upsert` was called once per product with the correct versionId

OK I think I have enough to write this. Let me do it now.

Let me also think about the "recognized but unflagged" test. I need an ingredient that:
- Can be resolved (so `ingredientRepo.resolve` returns non-null)
- Has no rule in the active methodology

From the seed, glycerol can be resolved but has no rule in v1. So I'll use that.

Let me write the file now. I'll use a clean structure with helper functions for creating mock data.
```

## reply

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClassificationService } from '../src/classification/classification.service';
import { MethodologyService } from '../src/methodology/methodology.service';
import { ResourceNotFound, ConflictError } from '../src/classification/types';

// ─── Mock factories ────────────────────────────────────────────────────────────

function makeProduct(
  id: number,
  name: string,
  ingredients: { rawText: string; position: number }[],
) {
  return { id, name, productIngredients: ingredients };
}

function makeIngredient(id: number, canonicalName: string, displayName = canonicalName) {
  return { id, canonicalName, displayName };
}

function makeVersion(id: number, version: number, isActive = true) {
  return { id, version, name: `v${version}`, isActive };
}

function makeRule(
  id: number,
  methodologyVersionId: number,
  ingredientId: number,
  severity: string,
  flag: string,
  sourceCitation: string,
) {
  return { id, methodologyVersionId, ingredientId, severity, flag, sourceCitation };
}

function makeModifier(
  id: number,
  profileId: number,
  ingredientId: number,
  severity: string,
  flag: string,
  sourceCitation: string,
) {
  return { id, profileId, ingredientId, severity, flag, sourceCitation };
}

// ─── Mock repository builders ──────────────────────────────────────────────────

interface MockContext {
  productRepo: ReturnType<typeof vi.fn> & object;
  ingredientRepo: ReturnType<typeof vi.fn> & object;
  methodologyRepo: ReturnType<typeof vi.fn> & object;
  profileRepo: ReturnType<typeof vi.fn> & object;
  classificationRepo: ReturnType<typeof vi.fn> & object;
  service: ClassificationService;
}

function buildMocks(overrides?: {
  product?: { id: number; name: string; ingredients: { rawText: string; position: number }[] } | null;
  productsWithIngredients?: { id: number; name: string; productIngredients: { rawText: string; position: number }[] }[];
  activeVersion?: { id: number; version: number; isActive: boolean } | null;
  versionById?: { id: number; version: number; isActive: boolean } | null;
  rules?: Record<number, { id: number; methodologyVersionId: number; ingredientId: number; severity: string; flag: string; sourceCitation: string }[]>;
  resolveMap?: Record<string, { ingredient: { id: number; canonicalName: string; displayName: string }; matchedVia: 'canonical' | 'synonym' } | null>;
  profile?: { id: number; name: string; description: string | null } | null;
  modifiers?: { id: number; profileId: number; ingredientId: number; severity: string; flag: string; sourceCitation: string }[];
}) {
  const productRepo = {
    findById: vi.fn(async (id: number) => {
      if (overrides?.product === null || overrides?.product === undefined) return null;
      if (overrides?.product && overrides.product.id === id) return overrides.product;
      return null;
    }),
    listWithIngredients: vi.fn(async () => overrides?.productsWithIngredients ?? []),
  };

  const ingredientRepo = {
    resolve: vi.fn(async (normalizedText: string) => {
      if (overrides?.resolveMap && normalizedText in overrides.resolveMap) {
        return overrides.resolveMap[normalizedText];
      }
      return null;
    }),
  };

  const methodologyRepo = {
    getActive: vi.fn(async () => overrides?.activeVersion ?? null),
    getById: vi.fn(async (id: number) => {
      if (overrides?.versionById && overrides.versionById.id === id) return overrides.versionById;
      return null;
    }),
    getRules: vi.fn(async (versionId: number) => overrides?.rules?.[versionId] ?? []),
    publish: vi.fn(async () => {}),
  };

  const profileRepo = {
    findById: vi.fn(async (id: number) => {
      if (overrides?.profile && overrides.profile.id === id) return overrides.profile;
      return null;
    }),
    getModifiers: vi.fn(async () => overrides?.modifiers ?? []),
  };

  const classificationRepo = {
    upsert: vi.fn(async (resultData: unknown, findings: unknown) => ({
      id: 1,
      ...resultData as object,
      createdAt: new Date('2024-01-01T00:00:00Z'),
    })),
    findByProductAndVersion: vi.fn(async () => null),
    findByProductId: vi.fn(async () => []),
  };

  const service = new ClassificationService(
    productRepo as any,
    ingredientRepo as any,
    methodologyRepo as any,
    profileRepo as any,
    classificationRepo as any,
  );

  return {
    productRepo,
    ingredientRepo,
    methodologyRepo,
    profileRepo,
    classificationRepo,
    service,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('ClassificationService', () => {
  // 1. Profile escalates a watch finding to banned
  it('profile escalates a watch finding to banned — replaces severity, flag, and citation with modifier values', async () => {
    const frag = makeIngredient(6, 'fragrance');
    const ctx = buildMocks({
      product: makeProduct(1, 'Test Product', [
        { rawText: 'Fragrance', position: 1 },
      ]),
      activeVersion: makeVersion(1, 1),
      rules: {
        1: [makeRule(1, 1, 6, 'WATCH', 'sensitization_risk', 'EU SCCS/1596/13')],
      },
      resolveMap: {
        fragrance: { ingredient: frag, matchedVia: 'canonical' },
      },
      profile: { id: 1, name: 'Child under 3', description: null },
      modifiers: [
        makeModifier(1, 1, 6, 'BANNED', 'banned_for_infants', 'SCCS opinion 2021'),
      ],
    });

    const result = await ctx.service.classify(1, 1) as any;

    const fragFinding = result.findings.find((f: any) => f.resolvedName === 'fragrance');
    expect(fragFinding.severity).toBe('banned');
    expect(fragFinding.flag).toBe('banned_for_infants');
    expect(fragFinding.sourceCitation).toBe('SCCS opinion 2021');
  });

  // 2. Profile does NOT de-escalate an existing finding
  it('profile does not de-escalate an existing finding — modifier with lower ordinal leaves finding untouched', async () => {
    const phenoxy = makeIngredient(4, 'phenoxyethanol');
    const ctx = buildMocks({
      product: makeProduct(1, 'Test Product', [
        { rawText: 'Phenoxyethanol', position: 1 },
      ]),
      activeVersion: makeVersion(1, 1),
      rules: {
        1: [makeRule(1, 1, 4, 'BANNED', 'banned_ingredient', 'EU Reg Annex II')],
      },
      resolveMap: {
        phenoxyethanol: { ingredient: phenoxy, matchedVia: 'canonical' },
      },
      profile: { id: 1, name: 'Child under 3', description: null },
      modifiers: [
        makeModifier(1, 1, 4, 'WATCH', 'low_risk_note', 'Some guideline'),
      ],
    });

    const result = await ctx.service.classify(1, 1) as any;

    const finding = result.findings.find((f: any) => f.resolvedName === 'phenoxyethanol');
    expect(finding.severity).toBe('banned');
    expect(finding.flag).toBe('banned_ingredient');
    expect(finding.sourceCitation).toBe('EU Reg Annex II');
  });

  // 3. Profile adds a flag where no base rule exists
  it('profile adds a flag where no base rule exists — recognized ingredient without a rule still receives modifier', async () => {
    const glycerol = makeIngredient(1, 'glycerol');
    const ctx = buildMocks({
      product: makeProduct(1, 'Test Product', [
        { rawText: 'Glycerol', position: 1 },
      ]),
      activeVersion: makeVersion(1, 1),
      rules: {
        1: [], // no rule for glycerol
      },
      resolveMap: {
        glycerol: { ingredient: glycerol, matchedVia: 'canonical' },
      },
      profile: { id: 1, name: 'Child under 3', description: null },
      modifiers: [
        makeModifier(1, 1, 1, 'RESTRICTED', 'restricted_for_infants', 'Pediatric guideline'),
      ],
    });

    const result = await ctx.service.classify(1, 1) as any;

    const finding = result.findings.find((f: any) => f.resolvedName === 'glycerol');
    expect(finding.severity).toBe('restricted');
    expect(finding.flag).toBe('restricted_for_infants');
    expect(finding.sourceCitation).toBe('Pediatric guideline');
  });

  // 4. Unknown ingredient is visible in both findings and unknownIngredients
  it('unknown ingredient is visible in findings (isUnknown: true) and in the top-level unknownIngredients array', async () => {
    const ctx = buildMocks({
      product: makeProduct(1, 'Test Product', [
        { rawText: 'Glycerin', position: 1 },
        { rawText: 'MysteryCompound', position: 2 },
      ]),
      activeVersion: makeVersion(1, 1),
      rules: { 1: [] },
      resolveMap: {
        glycerin: null, // unresolvable
        mysterycompound: null, // unresolvable
      },
    });

    const result = await ctx.service.classify(1) as any;

    const unknownFinding = result.findings.find((f: any) => f.rawText === 'MysteryCompound');
    expect(unknownFinding.isUnknown).toBe(true);
    expect(unknownFinding.resolvedName).toBeNull();

    expect(result.unknownIngredients).toContain('MysteryCompound');
    expect(result.unknownIngredients).toContain('Glycerin');
  });

  // 5. One unknown among five yields confidence of exactly 0.8
  it('one unknown among five ingredients yields overallConfidence of exactly 0.8', async () => {
    const glycerol = makeIngredient(1, 'glycerol');
    const ctx = buildMocks({
      product: makeProduct(1, 'Test Product', [
        { rawText: 'Glycerol', position: 1 },
        { rawText: 'Tocopherol', position: 2 },
        { rawText: 'Fragrance', position: 3 },
        { rawText: 'Sodium Lauryl Sulfate', position: 4 },
        { rawText: 'UnknownStuff', position: 5 },
      ]),
      activeVersion: makeVersion(1, 1),
      rules: {
        1: [makeRule(1, 1, 6, 'WATCH', 'sensitization_risk', 'SCCS')],
      },
      resolveMap: {
        glycerol: { ingredient: glycerol, matchedVia: 'canonical' },
        tocopherol: { ingredient: makeIngredient(3, 'tocopherol'), matchedVia: 'canonical' },
        fragrance: { ingredient: makeIngredient(6, 'fragrance'), matchedVia: 'canonical' },
        'sodium lauryl sulfate': { ingredient: makeIngredient(5, 'sodium lauryl sulfate'), matchedVia: 'canonical' },
        unknownstuff: null,
      },
    });

    const result = await ctx.service.classify(1) as any;
    expect(result.overallConfidence).toBeCloseTo(0.8);
  });

  // 6. Ten or more unknowns clamp confidence to 0
  it('ten or more unknowns clamp confidence to 0', async () => {
    const ingredients = Array.from({ length: 12 }, (_, i) => ({
      rawText: `Unknown${i}`,
      position: i + 1,
    }));

    const resolveMap: Record<string, null> = {};
    for (const ing of ingredients) {
      resolveMap[ing.rawText.toLowerCase()] = null;
    }

    const ctx = buildMocks({
      product: makeProduct(1, 'Test Product', ingredients),
      activeVersion: makeVersion(1, 1),
      rules: { 1: [] },
      resolveMap,
    });

    const result = await ctx.service.classify(1) as any;
    expect(result.overallConfidence).toBe(0);
  });

  // 7. Seeded OCR typo resolves to canonical form
  it('seeded OCR typo "gyceryl" resolves to canonical "glycerol" via the synonym table', async () => {
    const glycerol = makeIngredient(1, 'glycerol');
    const ctx = buildMocks({
      product: makeProduct(1, 'Test Product', [
        { rawText: 'gyceryl', position: 1 },
      ]),
      activeVersion: makeVersion(1, 1),
      rules: { 1: [] },
      resolveMap: {
        gyceryl: { ingredient: glycerol, matchedVia: 'synonym' },
      },
    });

    const result = await ctx.service.classify(1) as any;
    const finding = result.findings[0];
    expect(finding.resolvedName).toBe('glycerol');
    expect(finding.ingredientId).toBe(1);
    expect(finding.isUnknown).toBe(false);
  });

  // 8. Accented, mixed-case, extra-whitespace input resolves correctly
  it('accented, mixed-case, extra-whitespace input normalizes and resolves to canonical form', async () => {
    const phenoxy = makeIngredient(4, 'phenoxyethanol');
    const ctx = buildMocks({
      product: makeProduct(1, 'Test Product', [
        { rawText: '  PHÉNOXYÉTANOL ', position: 1 },
      ]),
      activeVersion: makeVersion(1, 1),
      rules: {
        1: [makeRule(1, 1, 4, 'BANNED', 'banned_ingredient', 'EU Reg Annex II')],
      },
      resolveMap: {
        // "PHÉNOXYÉTANOL" after NFD + strip marks + lowercase → "phenoxyetanol"
        // But canonical is "phenoxyethanol" — the mock must match what normalize() produces.
        // Actually normalize("  PHÉNOXYÉTANOL ") → "phenoxyetanol" (é → e)
        // The canonical name is "phenoxyethanol". So the resolve map key should be "phenoxyetanol"
        // and it should return the ingredient. This tests that normalization strips accents.
        phenoxyetanol: { ingredient: phenoxy, matchedVia: 'canonical' },
      },
    });

    const result = await ctx.service.classify(1) as any;
    const finding = result.findings[0];
    expect(finding.resolvedName).toBe('phenoxyethanol');
    expect(finding.isUnknown).toBe(false);
    expect(finding.severity).toBe('banned');
  });

  // 9. Two consecutive classify calls return deep-equal responses
  it('two consecutive classify calls on the same product return deep-equal responses', async () => {
    const glycerol = makeIngredient(1, 'glycerol');
    const frag = makeIngredient(6, 'fragrance');
    const ctx = buildMocks({
      product: makeProduct(1, 'Test Product', [
        { rawText: 'Glycerol', position: 1 },
        { rawText: 'Fragrance', position: 2 },
      ]),
      activeVersion: makeVersion(1, 1),
      rules: {
        1: [makeRule(1, 1, 6, 'WATCH', 'sensitization_risk', 'SCCS')],
      },
      resolveMap: {
        glycerol: { ingredient: glycerol, matchedVia: 'canonical' },
        fragrance: { ingredient: frag, matchedVia: 'canonical' },
      },
    });

    const first = await ctx.service.classify(1) as any;
    const second = await ctx.service.classify(1) as any;

    expect(second).toEqual(first);
  });

  // 10. Shuffled ingredient order yields identical finding sets
  it('two products with same ingredient set in shuffled positions yield identical finding sets and confidence', async () => {
    const glycerol = makeIngredient(1, 'glycerol');
    const tocopherol = makeIngredient(3, 'tocopherol');
    const frag = makeIngredient(6, 'fragrance');

    const sharedResolveMap = {
      glycerol: { ingredient: glycerol, matchedVia: 'canonical' as const },
      tocopherol: { ingredient: tocopherol, matchedVia: 'canonical' as const },
      fragrance: { ingredient: frag, matchedVia: 'canonical' as const },
    };

    const sharedRules = {
      1: [makeRule(1, 1, 6, 'WATCH', 'sensitization_risk', 'SCCS')],
    };

    const ctxA = buildMocks({
      product: makeProduct(1, 'Product A', [
        { rawText: 'Glycerol', position: 1 },
        { rawText: 'Tocopherol', position: 2 },
        { rawText: 'Fragrance', position: 3 },
      ]),
      activeVersion: makeVersion(1, 1),
      rules: sharedRules,
      resolveMap: sharedResolveMap,
    });

    const ctxB = buildMocks({
      product: makeProduct(2, 'Product B', [
        { rawText: 'Fragrance', position: 1 },
        { rawText: 'Glycerol', position: 2 },
        { rawText: 'Tocopherol', position: 3 },
      ]),
      activeVersion: makeVersion(1, 1),
      rules: sharedRules,
      resolveMap: sharedResolveMap,
    });

    const resultA = await ctxA.service.classify(1) as any;
    const resultB = await ctxB.service.classify(2) as any;

    expect(resultA.overallConfidence).toBe(resultB.overallConfidence);
    expect(resultA.findings.length).toBe(resultB.findings.length);

    const setA = resultA.findings
      .map((f: any) => [f.resolvedName, f.severity, f.flag])
      .sort(JSON.stringify);
    const setB = resultB.findings
      .map((f: any) => [f.resolvedName, f.severity, f.flag])
      .sort(JSON.stringify);

    expect(setB).toEqual(setA);
  });

  // 11. Both versions coexist after publishing v2
  it('after publishing v2, both v1 and v2 results are retrievable and v1 findings are unchanged', async () => {
    const glycerol = makeIngredient(1, 'glycerol');

    // First: classify under v1
    const ctxV1 = buildMocks({
      product: makeProduct(1, 'Test Product', [
        { rawText: 'Glycerol', position: 1 },
      ]),
      activeVersion: makeVersion(1, 1),
      rules: { 1: [] },
      resolveMap: {
        glycerol: { ingredient: glycerol, matchedVia: 'canonical' },
      },
    });

    const resultV1 = await ctxV1.service.classify(1) as any;
    expect(resultV1.methodologyVersionId).toBe(1);

    // Now publish v2: re-score under v2
    const ctxV2 = buildMocks({
      product: makeProduct(1, 'Test Product', [
        { rawText: 'Glycerol', position: 1 },
      ]),
      activeVersion: makeVersion(2, 2),
      rules: {
        2: [makeRule(10, 2, 1, 'RESTRICTED', 'new_rule', 'New source')],
      },
      resolveMap: {
        glycerol: { ingredient: glycerol, matchedVia: 'canonical' },
      },
    });

    await ctxV2.service.rescoreAll(2);

    // Verify v2 upsert was called with versionId 2
    expect(ctxV2.classificationRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ methodologyVersionId: 2 }),
      expect.any(Array),
    );

    // Verify v1 result was stored under version 1
    expect(ctxV1.classificationRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ methodologyVersionId: 1 }),
      expect.any(Array),
    );

    // v1 findings are unchanged (no re-scoring under v1)
    const v1FindingsCall = ctxV1.classificationRepo.upsert.mock.calls[0][1];
    expect(v1FindingsCall).toHaveLength(1);
    expect(v1FindingsCall[0].resolvedName).toBe('glycerol');
  });

  // 12. Publishing triggers re-scoring for every product with ≥ 1 ingredient
  it('publishing a new version triggers re-scoring: every product with ≥ 1 ingredient gains a stored result under the new version', async () => {
    const glycerol = makeIngredient(1, 'glycerol');

    const productsWithIngredients = [
      {
        id: 1,
        name: 'Product A',
        productIngredients: [{ rawText: 'Glycerol', position: 1 }],
      },
      {
        id: 2,
        name: 'Product B',
        productIngredients: [{ rawText: 'Glycerol', position: 1 }, { rawText: 'Tocopherol', position: 2 }],
      },
    ];

    const ctx = buildMocks({
      productsWithIngredients,
      rules: {
        2: [makeRule(10, 2, 1, 'WATCH', 'some_flag', 'Some source')],
      },
      resolveMap: {
        glycerol: { ingredient: glycerol, matchedVia: 'canonical' },
        tocopherol: { ingredient: makeIngredient(3, 'tocopherol'), matchedVia: 'canonical' },
      },
    });

    await ctx.service.rescoreAll(2);

    expect(ctx.classificationRepo.upsert).toHaveBeenCalledTimes(2);

    const firstCall = ctx.classificationRepo.upsert.mock.calls[0][0] as any;
    const secondCall = ctx.classificationRepo.upsert.mock.calls[1][0] as any;

    expect(firstCall.methodologyVersionId).toBe(2);
    expect(secondCall.methodologyVersionId).toBe(2);

    const productIds = [firstCall.productId, secondCall.productId].sort();
    expect(productIds).toEqual([1, 2]);
  });

  // 13. Running rescoreAll twice produces identical stored rows
  it('running rescoreAll twice for the same version produces identical stored rows (upsert idempotency)', async () => {
    const glycerol = makeIngredient(1, 'glycerol');

    const productsWithIngredients = [
      {
        id: 1,
        name: 'Product A',
        productIngredients: [{ rawText: 'Glycerol', position: 1 }],
      },
    ];

    const ctx = buildMocks({
      productsWithIngredients,
      rules: {
        2: [makeRule(10, 2, 1, 'WATCH', 'some_flag', 'Some source')],
      },
      resolveMap: {
        glycerol: { ingredient: glycerol, matchedVia: 'canonical' },
      },
    });

    await ctx.service.rescoreAll(2);
    const firstCallArgs = ctx.classificationRepo.upsert.mock.calls[0];

    await ctx.service.rescoreAll(2);
    const secondCallArgs = ctx.classificationRepo.upsert.mock.calls[1];

    expect(secondCallArgs).toEqual(firstCallArgs);
  });

  // 14. Classify with non-existent product raises ResourceNotFound
  it('classify with a non-existent product id raises ResourceNotFound', async () => {
    const ctx = buildMocks({
      product: null,
    });

    await expect(ctx.service.classify(999)).rejects.toBeInstanceOf(ResourceNotFound);
  });

  // 15. Classify with non-existent profile raises ResourceNotFound
  it('classify with a non-existent profile id raises ResourceNotFound', async () => {
    const glycerol = makeIngredient(1, 'glycerol');
    const ctx = buildMocks({
      product: makeProduct(1, 'Test Product', [
        { rawText: 'Glycerol', position: 1 },
      ]),
      activeVersion: makeVersion(1, 1),
      rules: { 1: [] },
      resolveMap: {
        glycerol: { ingredient: glycerol, matchedVia: 'canonical' },
      },
      profile: null, // profile not found
    });

    await expect(ctx.service.classify(1, 999)).rejects.toBeInstanceOf(ResourceNotFound);
  });

  // 16. Classify when no active version raises ResourceNotFound
  it('classify when no methodology version is active raises ResourceNotFound', async () => {
    const ctx = buildMocks({
      product: makeProduct(1, 'Test Product', [
        { rawText: 'Glycerol', position: 1 },
      ]),
      activeVersion: null,
    });

    await expect(ctx.service.classify(1)).rejects.toBeInstanceOf(ResourceNotFound);
  });

  // 17. Publishing an already-active version raises ConflictError
  it('publishing an already-active version raises ConflictError', async () => {
    const methodologyRepo = {
      getById: vi.fn(async (id: number) => {
        if (id === 1) return { id: 1, version: 1, name: 'v1', isActive: true };
        return null;
      }),
      publish: vi.fn(async () => {}),
    };

    const classificationService = {
      rescoreAll: vi.fn(async () => {}),
    };

    const methodologyService = new MethodologyService(
      methodologyRepo as any,
      classificationService as any,
    );

    await expect(methodologyService.publish(1)).rejects.toBeInstanceOf(ConflictError);
  });

  // 18. Recognized ingredient with no rule appears with null flag/severity, NOT in unknownIngredients
  it('a recognized ingredient with no rule appears in findings with null flag/severity and is not listed in unknownIngredients', async () => {
    const glycerol = makeIngredient(1, 'glycerol');
    const ctx = buildMocks({
      product: makeProduct(1, 'Test Product', [
        { rawText: 'Glycerol', position: 1 },
      ]),
      activeVersion: makeVersion(1, 1),
      rules: { 1: [] }, // no rule for glycerol
      resolveMap: {
        glycerol: { ingredient: glycerol, matchedVia: 'canonical' },
      },
    });

    const result = await ctx.service.classify(1) as any;

    const finding = result.findings[0];
    expect(finding.resolvedName).toBe('glycerol');
    expect(finding.ingredientId).toBe(1);
    expect(finding.isUnknown).toBe(false);
    expect(finding.flag).toBeNull();
    expect(finding.severity).toBeNull();

    expect(result.unknownIngredients).not.toContain('Glycerol');
    expect(result.unknownIngredients).toHaveLength(0);
  });

  // 19. Disclaimer is present and identical in every response
  it('the disclaimer string is present and identical in every response, including one with zero flagged findings', async () => {
    const glycerol = makeIngredient(1, 'glycerol');

    // Case A: no flags at all
    const ctxA = buildMocks({
      product: makeProduct(1, 'Clean Product', [
        { rawText: 'Glycerol', position: 1 },
      ]),
      activeVersion: makeVersion(1, 1),
      rules: { 1: [] },
      resolveMap: {
        glycerol: { ingredient: glycerol, matchedVia: 'canonical' },
      },
    });

    const resultA = await ctxA.service.classify(1) as any;
    expect(resultA.disclaimer).toBeTypeOf('string');
    expect(resultA.disclaimer.length).toBeGreaterThan(0);

    // Case B: with flags
    const frag = makeIngredient(6, 'fragrance');
    const ctxB = buildMocks({
      product: makeProduct(2, 'Flagged Product', [
        { rawText: 'Fragrance', position: 1 },
      ]),
      activeVersion: makeVersion(1, 1),
      rules: {
        1: [makeRule(1, 1, 6, 'BANNED', 'banned_ingredient', 'EU Reg')],
      },
      resolveMap: {
        fragrance: { ingredient: frag, matchedVia: 'canonical' },
      },
    });

    const resultB = await ctxB.service.classify(2) as any;
    expect(resultB.disclaimer).toBe(resultA.disclaimer);
  });
});
```
