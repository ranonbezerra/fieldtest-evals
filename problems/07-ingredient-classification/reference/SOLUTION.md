# Reference solution — annotated core

## Crux 1: schema — rules are data, versions are immutable

```prisma
model MethodologyVersion {
  id        String  @id @default(uuid())
  number    Int     @unique
  active    Boolean @default(false)
  rules     Rule[]                    // M1: rules belong to a version
}

model Rule {
  id           String @id @default(uuid())
  versionId    String
  ingredientId String
  kind         RuleKind   // BANNED_BY_LIST | RESTRICTED | WATCH
  severity     Int        // ordered scale, data not code
  sourceRef    String     // citable: "Regulator list Y (2021)" (M4)
  appliesTo    Json?      // contextual: {profileTag: "infant"} — null = base
}

model Ingredient {
  id       String @id @default(uuid())
  canonical String @unique
  synonyms  IngredientSynonym[]       // M6: INCI, trade names, typos
}

model ClassificationResult {
  productId String
  versionId String
  findings  Json      // per-ingredient: {flag, severity, sourceRef}
  unknowns  String[]  // M3: surfaced, never swallowed
  confidence Float
  @@id([productId, versionId])       // M2: history preserved per version
}
```

## Crux 2: normalize → resolve → apply (pure engine)

```ts
export function classify(
  listed: string[], rules: Rule[], profileTags: string[],
): Verdict {
  const resolved = listed.map(raw => resolveIngredient(normalize(raw))); // M6
  const unknowns = resolved.filter(r => !r.match).map(r => r.raw);       // M3

  const findings = resolved.filter(r => r.match).flatMap(r => {
    const base = rules.filter(x => x.ingredientId === r.match.id && !x.appliesTo);
    const ctx  = rules.filter(x => x.ingredientId === r.match.id
                    && profileTags.includes(x.appliesTo?.profileTag));
    // M5: defined precedence — contextual overrides base for the same
    // ingredient; among applicable rules, highest severity wins. Deterministic
    // and input-order-independent (sort before reduce).
    return mergeByPrecedence(base, ctx);
  });

  const coverage = (resolved.length - unknowns.length) / resolved.length;
  return {
    findings,                         // M4: flags + severity + sourceRef
    unknowns,
    confidence: round(coverage * ruleCoverageFactor(findings)),
    disclaimer: DISCLAIMER,           // findings, not accusations
  };
}
```

Engine is pure (rules + list in, verdict out): trivially testable, persistence
stays at the edges (graded 5).

## Crux 3: version publish → idempotent re-score

```ts
async publish(versionId: string) {
  await this.activate(versionId);                       // old version stays queryable
  for await (const batch of this.products.iterate()) {
    await Promise.all(batch.map(p =>
      this.prisma.classificationResult.upsert({         // M2: rerun-safe
        where: { productId_versionId: { productId: p.id, versionId } },
        create: this.compute(p, versionId),
        update: this.compute(p, versionId),
      })));
  }
}
```

"Why did it say X last month?" is answerable: fetch the result for the version
active last month — it was never touched.

## Common wrong answers

- Editing rules in place — every historical result silently changes meaning.
- Unknown ingredient skipped or counted as clean — false-safety machine.
- Binary toxic/safe label — legal surface; must be sourced findings + disclaimer.
- `if (name === rule.name)` — dies on the first INCI synonym or OCR typo.
- If/else chains per ingredient — rules must be data so the methodology can
  change without a deploy.
