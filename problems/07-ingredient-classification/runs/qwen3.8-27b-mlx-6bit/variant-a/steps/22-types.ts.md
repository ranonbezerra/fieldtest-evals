# 22-types.ts

## reasoning

```
Let me analyze the PLAN.md to determine exactly what `src/classification/types.ts` should contain.

From the plan, section 3 "Types and signatures", under "Shared types":

```ts
export type Severity = 'banned' | 'restricted' | 'watch';

export interface IngredientFinding {
  rawText: string;
  resolvedName: string | null;   // null when unknown
  ingredientId: number | null;
  isUnknown: boolean;
  flag: string | null;
  severity: Severity | null;
  sourceCitation: string | null;
}

export interface ClassificationResponse {
  productId: number;
  methodologyVersionId: number;
  findings: IngredientFinding[];          // sorted by product_ingredients.position
  unknownIngredients: string[];           // rawText of each unknown, same order
  overallConfidence: number;              // 0..1
  disclaimer: string;                     // fixed English disclaimer
}

export interface ProfiledClassificationResponse extends ClassificationResponse {
  profileId: number;
}
```

And the domain errors:

```ts
export class ResourceNotFound extends Error { code = 'resource_not_found'; }
export class ConflictError      extends Error { code = 'conflict'; }
```

The manifest says:
`src/classification/types.ts | reads: - | Severity, IngredientFinding, ClassificationResponse, ProfiledClassificationResponse, domain errors`

So I need to write exactly these types and error classes. Let me make sure I'm following the conventions:
- TypeScript strict
- ESM
- Code and comments in English

Let me write the complete file. The plan shows `code = 'resource_not_found'` and `code = 'conflict'` as class properties. In strict TypeScript, I should type these properly. Let me use `readonly code` or just declare them as properties.

Actually, looking at the plan more carefully, it shows:
```ts
export class ResourceNotFound extends Error { code = 'resource_not_found'; }
export class ConflictError      extends Error { code = 'conflict'; }
```

I'll implement these exactly as shown. In TypeScript strict mode, the `code` property will be inferred as a string literal type since it's initialized inline. That's fine.

Let me write the complete file now.
```

## reply

```ts
export type Severity = 'banned' | 'restricted' | 'watch';

export interface IngredientFinding {
  rawText: string;
  resolvedName: string | null; // null when unknown
  ingredientId: number | null;
  isUnknown: boolean;
  flag: string | null;
  severity: Severity | null;
  sourceCitation: string | null;
}

export interface ClassificationResponse {
  productId: number;
  methodologyVersionId: number;
  findings: IngredientFinding[]; // sorted by product_ingredients.position
  unknownIngredients: string[]; // rawText of each unknown, same order
  overallConfidence: number; // 0..1
  disclaimer: string; // fixed English disclaimer
}

export interface ProfiledClassificationResponse extends ClassificationResponse {
  profileId: number;
}

export class ResourceNotFound extends Error {
  readonly code = 'resource_not_found';
}

export class ConflictError extends Error {
  readonly code = 'conflict';
}
```
