# repair1-set

## reasoning

```
The errors are about unterminated regular expression literals. Looking at the code:

In `normalizer.ts` line 20-21 and `methodology.service.ts` line 52-53, there are regex patterns that span multiple lines because the `\n` in the regex is being interpreted as an actual newline instead of the escape sequence `\n`.

The issue is in the `split` regex patterns:
- `split(/[,\n]+/)` — the `\n` is being rendered as a literal newline in the source code
- `split(/[,
]/)` — same issue

Wait, looking at the actual code provided in the reference:

```ts
return list
    .split(/[,\n]+/)
```

and

```ts
return list
    .split(/[,\n]/)
```

But in the actual files, the `\n` appears to have been rendered as a literal newline character instead of the two characters `\n`. So the regex literal is broken across lines.

The fix is to ensure the `\n` is properly escaped so it's a newline character within the regex, not a literal line break.

Let me fix both files:

For `normalizer.ts`:
- Line with `split(/[,\n]+/)` needs to have `\n` properly as escaped characters
- Line with `split(/[,\n]/)` needs same

For `methodology.service.ts`:
- Line with `split(/[,
]+/)` needs fix

The fix is to replace the literal newline in the regex with the escape sequence `\n`. Since I need to output the complete file content, I'll write them correctly.

Actually, looking more carefully at the reference code - the reference shows:
```ts
.split(/[,\n]+/)
```
and
```ts
.split(/[,
]+/)
```

The first one looks correct (with `\n` as escape). The second one in methodology.service.ts shows a literal newline inside the regex. Let me re-read...

In the methodology.service.ts reference:
```ts
private parseIngredients(list: string): string[] {
    return list
      .split(/[,
]+/)
```

This shows `[,` then a newline then `]+/` - that's the bug. The `\n` was rendered as a literal newline.

In normalizer.ts:
```ts
export function parseIngredients(list: string): string[] {
    return list
      .split(/[,
]/)
```

Same issue - literal newline in the regex.

So I need to fix both files by replacing the literal newline inside the regex with `\n` (the escape sequence).

For the output, I need to write the regex as `/[,\n]+/` where `\n` is two characters (backslash + n) in the source code, which represents a newline character in the regex.

When writing the complete file content in a code block, I need to make sure the `\n` appears as the escape sequence `\n` (backslash-n) within the regex literal.

Let me write both files correctly.
```

## reply

### src/common/normalizer.ts
```ts
/**
 * Normalize an ingredient string for matching:
 * 1. NFD decomposition to separate accents from base characters
 * 2. Remove combining diacritical marks
 * 3. Lowercase
 * 4. Trim and collapse internal whitespace
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Parse a raw INCI ingredient list string into individual ingredients. */
export function parseIngredients(list: string): string[] {
  return list
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
```

### src/methodology/methodology.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { MethodologyRepository } from './methodology.repository';
import { ClassifyService } from '../classify/classify.service';
import { ProductsRepository } from '../products/products.repository';
import { normalize } from '../common/normalizer';

@Injectable()
export class MethodologyService {
  constructor(
    private readonly repository: MethodologyRepository,
    private readonly classifyService: ClassifyService,
    private readonly productsRepository: ProductsRepository,
  ) {}

  async createVersion(version: string): Promise<void> {
    await this.repository.createVersion(version);
  }

  async addRule(versionId: string, rule: { name: string; severity: string; source: string }): Promise<void> {
    await this.repository.addRule(versionId, rule);
  }

  /**
   * Publish a methodology version and trigger idempotent re-scoring of affected products.
   * Re-scoring is idempotent: classifyService checks for existing results and skips if found.
   */
  async publishVersion(versionId: string): Promise<void> {
    await this.repository.publish(versionId);

    const version = await this.repository.getById(versionId);
    if (!version) return;

    // Determine which ingredients are covered by rules in this version
    const ruleIngredientNames = new Set(
      version.rules.map((r) => normalize(r.name)),
    );

    // Find affected products
    const products = await this.productsRepository.getAll();
    for (const product of products) {
      const ingredients = this.parseIngredients(product.ingredientList);
      const normalized = ingredients.map(normalize);
      const isAffected = normalized.some((n) => ruleIngredientNames.has(n));
      if (isAffected) {
        await this.classifyService.classify(product.id, undefined, versionId);
      }
    }
  }

  private parseIngredients(list: string): string[] {
    return list
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
}
```
