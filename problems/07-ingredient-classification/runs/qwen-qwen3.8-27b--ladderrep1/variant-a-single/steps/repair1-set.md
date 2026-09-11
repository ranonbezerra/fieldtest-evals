# repair1-set

## reasoning

```
Let me look at the errors:

1. `src/classification/classification.service.ts(274,93): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.`
2. `src/classification/classification.service.ts(284,103): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.`

I need to look at lines 274 and 284 in the service file. Let me count the lines in the provided file.

Looking at the service file, let me find the relevant lines. The file is quite long. Let me trace through it carefully.

Let me count lines from the top:

1: `import { Injectable } from '@nestjs/common';`
2: `import { RuleKind, VersionStatus } from '@prisma/client';`
3: `import type { ClassificationResult, MethodologyVersion, Product, Profile } from '@prisma/client';`
4: `import { Errors } from '../common/api-error.js';`
5: `import {`
6: `  ClassificationRepository,`
7: `  type ProductWithIngredients,`
8: `  type ResolutionEntry,`
9: `  type RuleWithIngredient,`
10: `} from './classification.repository.js';`
11: `import { normalizeInci } from './inci-normalizer.js';`
12: `import type { IngredientFixture, MethodologyFixture } from './fixtures.js';`
13: (blank)
14: `export type Severity = 'banned' | 'restricted' | 'watch';`
15: `export type Flag = 'unknown' | 'none' | Severity;`
16: (blank)
17: `export interface Finding {`
18: `  raw: string;`
19: `  canonical: string | null;`
20: `  recognized: boolean;`
21: `  flag: Flag;`
22: `  severity: Severity | null;`
23: `  source: string | null;`
24: `  matchedVia: 'canonical' | 'synonym' | null;`
25: `  modifierContext: string | null;`
26: `}`
27: (blank)
28: `export interface ClassificationSummary {`
29: `  total: number;`
30: `  recognized: number;`
31: `  unknown: number;`
32: `}`
33: (blank)
34: `export interface StoredPayload {`
35: `  schema: 1;`
36: `  methodologyVersion: string;`
37: `  findings: Finding[];`
38: `  confidence: number;`
39: `  summary: ClassificationSummary;`
40: `}`
41: (blank)
42: `export interface ClassificationOutput {`
43: `  productId: string;`
44: `  methodologyVersion: string;`
45: `  profile: string | null;`
46: `  findings: Finding[];`
47: `  confidence: number;`
48: `  summary: ClassificationSummary;`
49: `  disclaimer: string;`
50: `}`
51: (blank)
52: `export interface StoredResultView {`
53: `  productId: string;`
54: `  methodologyVersion: string;`
55: `  findings: Finding[];`
56: `  confidence: number;`
57: `  summary: ClassificationSummary;`
58: `  disclaimer: string;`
59: `}`
60: (blank)
61: `export interface ModifierRow {`
62: `  canonicalName: string;`
63: `  context: string;`
64: `  severity: Severity;`
65: `  source: string;`
66: `}`
67: (blank)
68: `export const DISCLAIMER =`
69: `  'These findings list which rules fired for each ingredient and cite the source of each rule. ' +`
70: `  'They are not a safety verdict: an ingredient without a flag only means no rule in this ' +`
71: `  'methodology version matched it, which is not the same as it being safe.';`
72: (blank)
73: `/**`
74: ` * Modifier precedence — written down; the only permitted resolution order.`
75: ` *`
76: ` * 1. Start from the base severity of the ingredient in the active methodology`
77: ` *    version (which may be "no rule", i.e. unflagged).`
78: ` * 2. A context modifier only tightens, never loosens: the effective severity is`
79: ` *    the maximum of the base severity and the severities of all modifiers whose`
80: ` *    context is present in the profile (banned > restricted > watch).`
81: ` * 3. Ties are broken by fixed context precedence: child_under_3 before`
82: ` *    pregnancy. If the base rule and a modifier tie, the base citation wins.`
83: ` * 4. Contexts outside the precedence list sort after the listed ones; their`
84: ` *    relative order is the deterministic rule-table order.`
85: ` * 5. Modifiers never apply to unknown (unresolved) ingredients.`
86: ` *`
87: ` * The winner is chosen by (severity rank, precedence index) — never by array`
88: ` * iteration order — so two modifiers on one ingredient resolve the same way`
89: ` * every time.`
90: ` */`
91: `export const MODIFIER_PRECEDENCE: readonly string[] = ['child_under_3', 'pregnancy'];`
92: (blank)
93: `const SEVERITY_RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };`
94: (blank)
95: `interface ModifierCandidate {`
96: `  rank: number;`
97: `  order: number;`
98: `  severity: Severity;`
99: `  source: string;`
100: `  context: string | null;`
101: `}`
102: (blank)
103: `function findingSortKey(finding: Finding): string {`
104: `  return finding.recognized`
105: `    ? \`0\u0000${finding.canonical}\u0000${finding.raw}\``
106: `    : \`1\u0000${normalizeInci(finding.raw)}\u0000${finding.raw}\`;`
107: `}`
108: (blank)
109: `/**`
110: ` * Applies a profile's contextual modifiers to base findings using the`
111: ` * precedence written above. Pure and deterministic.`
112: ` */`
113: `export function applyProfileModifiers(`
114: `  findings: Finding[],`
115: `  modifiers: ModifierRow[],`
116: `  contexts: readonly string[],`
117: `): Finding[] {`
118: `  const activeContexts = new Set(contexts);`
119: `  if (activeContexts.size === 0 || modifiers.length === 0) {`
120: `    return findings;`
121: `  }`
122: (blank)
123: `  const byIngredient = new Map<string, ModifierRow[]>();`
124: `  for (const modifier of modifiers) {`
125: `    if (!activeContexts.has(modifier.context)) {`
126: `      continue;`
127: `    }`
128: `    const list = byIngredient.get(modifier.canonicalName);`
129: `    if (list) {`
130: `      list.push(modifier);`
131: `    } else {`
132: `      byIngredient.set(modifier.canonicalName, [modifier]);`
133: `    }`
134: `  }`
135: (blank)
136: `  return findings.map((finding) => {`
137: `    if (!finding.recognized || finding.canonical === null) {`
138: `      return finding;`
139: `    }`
140: `    const candidates: ModifierCandidate[] = [];`
141: `    if (finding.severity !== null && finding.source !== null) {`
142: `      candidates.push({`
143: `        rank: SEVERITY_RANK[finding.severity],`
144: `        order: -1,`
145: `        severity: finding.severity,`
146: `        source: finding.source,`
147: `        context: null,`
148: `      });`
149: `    }`
150: `    for (const modifier of byIngredient.get(finding.canonical) ?? []) {`
151: `      const precedence = MODIFIER_PRECEDENCE.indexOf(modifier.context);`
152: `      candidates.push({`
153: `        rank: SEVERITY_RANK[modifier.severity],`
154: `        order: precedence === -1 ? MODIFIER_PRECEDENCE.length : precedence,`
155: `        severity: modifier.severity,`
156: `        source: modifier.source,`
157: `        context: modifier.context,`
158: `      });`
159: `    }`
160: `    if (candidates.length === 0) {`
161: `      return finding;`
162: `    }`
163: `    candidates.sort((a, b) => b.rank - a.rank || a.order - b.order);`
164: `    const winner = candidates[0];`
165: `    return {`
166: `      ...finding,`
167: `      flag: winner.severity,`
168: `      severity: winner.severity,`
169: `      source: winner.source,`
170: `      modifierContext: winner.context,`
171: `    };`
172: `  });`
173: `}`
174: (blank)
175: `/**`
176: ` * Pure base classification: normalize + resolve each raw ingredient, apply the`
177: ` * version's base rules, sort deterministically, and derive confidence.`
178: ` */`
179: `export function buildBaseClassification(`
180: `  rawIngredients: string[],`
181: `  resolutionMap: Map<string, ResolutionEntry>,`
182: `  baseRules: Map<string, { severity: Severity; source: string }>,`
183: `): { findings: Finding[]; confidence: number; summary: ClassificationSummary } {`
184: `  const findings: Finding[] = rawIngredients.map((raw) => {`
185: `    const key = normalizeInci(raw);`
186: `    const hit = key === '' ? undefined : resolutionMap.get(key);`
187: `    if (hit === undefined) {`
188: `      // Unknown is a first-class outcome: listed, counted against confidence,`
189: `      // never dropped and never treated as clean.`
190: `      return {`
191: `        raw,`
192: `        canonical: null,`
193: `        recognized: false,`
194: `        flag: 'unknown' as const,`
195: `        severity: null,`
196: `        source: null,`
197: `        matchedVia: null,`
198: `        modifierContext: null,`
199: `      };`
200: `    }`
201: `    const rule = baseRules.get(hit.canonicalName);`
202: `    return {`
203: `      raw,`
204: `      canonical: hit.canonicalName,`
205: `      recognized: true,`
206: `      flag: rule ? rule.severity : 'none',`
207: `      severity: rule ? rule.severity : null,`
208: `      source: rule ? rule.source : null,`
209: `      matchedVia: hit.matchedVia,`
210: `      modifierContext: null,`
211: `    };`
212: `  });`
213: (blank)
214: `  // Deterministic order: recognised findings by canonical name, then unknowns`
215: `  // by normalized raw text. The stored ingredient order never leaks through.`
216: `  findings.sort((a, b) => {`
217: `    const keyA = findingSortKey(a);`
218: `    const keyB = findingSortKey(b);`
219: `    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;`
220: `  });`
221: (blank)
222: `  const total = findings.length;`
223: `  const recognized = findings.reduce((count, finding) => count + (finding.recognized ? 1 : 0), 0);`
224: `  const unknown = total - recognized;`
225: `  // Confidence = the fraction of the list we could resolve to a known`
226: `  // ingredient; unknown ingredients lower it. An empty list has no`
227: `  // recognisable content, so 0.`
228: `  const confidence = total === 0 ? 0 : Math.round((recognized / total) * 10000) / 10000;`
229: (blank)
230: `  return { findings, confidence, summary: { total, recognized, unknown } };`
231: `}`
232: (blank)
233: `@Injectable()`
234: `export class ClassificationService {`
235: `  constructor(private readonly repository: ClassificationRepository) {}`
236: (blank)
237: `  // ------------------------------------------------- ingestion (ops/tests)`
238: (blank)
239: `  async ingestIngredients(`
240: `    fixtures: IngredientFixture[],`
241: `  ): Promise<{ ingredients: number; synonyms: number }> {`
242: `    let synonyms = 0;`
243: `    for (const fixture of fixtures) {`
244: `      const ingredient = await this.repository.upsertIngredient(fixture.name);`
245: `      for (const synonym of fixture.synonyms) {`
246: `        await this.repository.upsertSynonym(ingredient.id, synonym);`
247: `        synonyms += 1;`
248: `      }`
249: `    }`
250: `    return { ingredients: fixtures.length, synonyms };`
251: `  }`
252: (blank)
253: `  /**`
254: `   * Ingests a methodology version from a fixture. Idempotent for identical`
255: `   * input; once the version is published, any change is rejected`
256: `   * (published versions never change).`
257: `   */`
258: `  async ingestMethodology(fix: MethodologyFixture): Promise<{`
259: `    versionId: string;`
260: `    slug: string;`
261: `    upserted: number;`
262: `    unchanged: number;`
263: `  }> {`
264: `    const existing = await this.repository.findVersion(fix.slug);`
265: `    const version = existing ?? (await this.repository.createVersion(fix.slug, fix.name));`
266: `    let upserted = 0;`
267: `    let unchanged = 0;`
268: `    for (const rule of fix.rules) {`
269: `      if (rule.kind === 'context' && !rule.context) {`
270: `        throw Errors.invalidInput('A context rule requires a context.', { ingredient: rule.ingredient });`
271: `      }`
272: `      const kind = rule.kind === 'context' ? RuleKind.CONTEXT : RuleKind.BASE;`
273: `      const context = rule.kind === 'context' ? rule.context : '';`
274: `      const found = await this.repository.findRuleByKeys(version.id, rule.ingredient, kind, context);`

Wait, line 274 is:
`      const found = await this.repository.findRuleByKeys(version.id, rule.ingredient, kind, context);`

The error says column 93, type 'string | undefined' not assignable to 'string'. Let me think about what `rule.ingredient` could be. Looking at the `MethodologyFixture` type — it's imported from `./fixtures.js`. I don't have the fixtures file, but based on the usage, `rule.ingredient` is likely typed as `string | undefined` or the `context` field might be `string | undefined`.

Wait, let me re-read. The error is at line 274, column 93. Let me count characters on that line:

`      const found = await this.repository.findRuleByKeys(version.id, rule.ingredient, kind, context);`

Let me count: 6 spaces + "const found = await this.repository.findRuleByKeys(" ... that's about 52 chars to the opening paren. Then `version.id` is 10 chars, comma + space is 2, `rule.ingredient` is 15 chars... so column 93 would be around the `context` argument.

Actually, let me look at line 273:
`      const context = rule.kind === 'context' ? rule.context : '';`

So `context` is typed as `string` here (either `rule.context` which would be string if the type says so, or `''`). But wait — if `rule.context` is `string | undefined`, then `context` would be `string | undefined` because the ternary doesn't narrow it (the false branch is `''` which is string, but the true branch could be `string | undefined`).

Actually wait: `rule.kind === 'context' ? rule.context : ''` — if `rule.context` is `string | undefined`, then the type of this expression is `string | undefined | string` = `string | undefined`.

So `context` on line 273 would be `string | undefined`, and then on line 274 it's passed to `findRuleByKeys` which expects `string`.

Similarly for line 284. Let me count to line 284:

275: `      const identical =`
276: `        found !== null && found.severity.toLowerCase() === rule.severity && found.source === rule.source;`
277: `      if (identical) {`
278: `        unchanged += 1;`
279: `        continue;`
280: `      }`
281: `      if (version.status === VersionStatus.PUBLISHED) {`
282: `        throw Errors.methodologyImmutable(version.slug, rule.ingredient);`
283: `      }`
284: `      await this.repository.upsertRule(version.id, rule.ingredient, rule.severity, rule.source, kind, context);`

So line 284 column 103... let me count:
`      await this.repository.upsertRule(version.id, rule.ingredient, rule.severity, rule.source, kind, context);`

6 spaces + "await this.repository.upsertRule(" = 6 + 33 = 39
"version.id" = 10, so 49
", " = 2, so 51
"rule.ingredient" = 15, so 66
", " = 2, so 68
"rule.severity" = 13, so 81
", " = 2, so 83
"rule.source" = 11, so 94
", " = 2, so 96
"kind" = 4, so 100
", " = 2, so 102
"context" starts at 103

So the error is on `context` at column 103. Same issue — `context` is `string | undefined`.

So the root cause is: `rule.context` from the `MethodologyFixture` type is `string | undefined` (or optional), and the ternary on line 273 doesn't narrow it properly.

The fix: on line 273, we need to ensure `context` is always a `string`. Since we already checked on line 269 that `rule.context` is truthy when `rule.kind === 'context'`, we can use a non-null assertion or provide a fallback.

The simplest fix that changes exactly what the compiler requires:

```ts
const context = rule.kind === 'context' ? (rule.context ?? '') : '';
```

Or we could do:
```ts
const context = rule.kind === 'context' ? rule.context! : '';
```

But the cleanest and safest is the `?? ''` approach since we already validated it's present on line 269-271.

Actually, let me reconsider. The check on line 269 is:
```ts
if (rule.kind === 'context' && !rule.context) {
  throw Errors.invalidInput('A context rule requires a context.', { ingredient: rule.ingredient });
}
```

So after this check, if `rule.kind === 'context'`, we know `rule.context` is truthy (i.e., a non-empty string). But TypeScript doesn't narrow `rule.context` based on this compound condition in the subsequent code. So the type is still `string | undefined`.

The minimal fix is to change line 273 to:
```ts
const context = rule.kind === 'context' ? (rule.context ?? '') : '';
```

This is safe because we've already thrown if it's falsy.

Let me now produce the complete file with just that one-line change.
```

## reply

Looking at the two errors, both are the same root cause: on line 273, `rule.context` is typed as `string | undefined` (from the `MethodologyFixture` type), so the ternary `rule.kind === 'context' ? rule.context : ''` produces `string | undefined`. This `context` variable is then passed to `findRuleByKeys` (line 274) and `upsertRule` (line 284), both of which expect `string`.

The fix is a single change on line 273: use `rule.context ?? ''` to guarantee a `string` (safe because line 269–271 already throws if a context rule has no context).

### src/classification/classification.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { RuleKind, VersionStatus } from '@prisma/client';
import type { ClassificationResult, MethodologyVersion, Product, Profile } from '@prisma/client';
import { Errors } from '../common/api-error.js';
import {
  ClassificationRepository,
  type ProductWithIngredients,
  type ResolutionEntry,
  type RuleWithIngredient,
} from './classification.repository.js';
import { normalizeInci } from './inci-normalizer.js';
import type { IngredientFixture, MethodologyFixture } from './fixtures.js';

export type Severity = 'banned' | 'restricted' | 'watch';
export type Flag = 'unknown' | 'none' | Severity;

export interface Finding {
  raw: string;
  canonical: string | null;
  recognized: boolean;
  flag: Flag;
  severity: Severity | null;
  source: string | null;
  matchedVia: 'canonical' | 'synonym' | null;
  modifierContext: string | null;
}

export interface ClassificationSummary {
  total: number;
  recognized: number;
  unknown: number;
}

export interface StoredPayload {
  schema: 1;
  methodologyVersion: string;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
}

export interface ClassificationOutput {
  productId: string;
  methodologyVersion: string;
  profile: string | null;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}

export interface StoredResultView {
  productId: string;
  methodologyVersion: string;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}

export interface ModifierRow {
  canonicalName: string;
  context: string;
  severity: Severity;
  source: string;
}

export const DISCLAIMER =
  'These findings list which rules fired for each ingredient and cite the source of each rule. ' +
  'They are not a safety verdict: an ingredient without a flag only means no rule in this ' +
  'methodology version matched it, which is not the same as it being safe.';

/**
 * Modifier precedence — written down; the only permitted resolution order.
 *
 * 1. Start from the base severity of the ingredient in the active methodology
 *    version (which may be "no rule", i.e. unflagged).
 * 2. A context modifier only tightens, never loosens: the effective severity is
 *    the maximum of the base severity and the severities of all modifiers whose
 *    context is present in the profile (banned > restricted > watch).
 * 3. Ties are broken by fixed context precedence: child_under_3 before
 *    pregnancy. If the base rule and a modifier tie, the base citation wins.
 * 4. Contexts outside the precedence list sort after the listed ones; their
 *    relative order is the deterministic rule-table order.
 * 5. Modifiers never apply to unknown (unresolved) ingredients.
 *
 * The winner is chosen by (severity rank, precedence index) — never by array
 * iteration order — so two modifiers on one ingredient resolve the same way
 * every time.
 */
export const MODIFIER_PRECEDENCE: readonly string[] = ['child_under_3', 'pregnancy'];

const SEVERITY_RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };

interface ModifierCandidate {
  rank: number;
  order: number;
  severity: Severity;
  source: string;
  context: string | null;
}

function findingSortKey(finding: Finding): string {
  return finding.recognized
    ? `0\u0000${finding.canonical}\u0000${finding.raw}`
    : `1\u0000${normalizeInci(finding.raw)}\u0000${finding.raw}`;
}

/**
 * Applies a profile's contextual modifiers to base findings using the
 * precedence written above. Pure and deterministic.
 */
export function applyProfileModifiers(
  findings: Finding[],
  modifiers: ModifierRow[],
  contexts: readonly string[],
): Finding[] {
  const activeContexts = new Set(contexts);
  if (activeContexts.size === 0 || modifiers.length === 0) {
    return findings;
  }

  const byIngredient = new Map<string, ModifierRow[]>();
  for (const modifier of modifiers) {
    if (!activeContexts.has(modifier.context)) {
      continue;
    }
    const list = byIngredient.get(modifier.canonicalName);
    if (list) {
      list.push(modifier);
    } else {
      byIngredient.set(modifier.canonicalName, [modifier]);
    }
  }

  return findings.map((finding) => {
    if (!finding.recognized || finding.canonical === null) {
      return finding;
    }
    const candidates: ModifierCandidate[] = [];
    if (finding.severity !== null && finding.source !== null) {
      candidates.push({
        rank: SEVERITY_RANK[finding.severity],
        order: -1,
        severity: finding.severity,
        source: finding.source,
        context: null,
      });
    }
    for (const modifier of byIngredient.get(finding.canonical) ?? []) {
      const precedence = MODIFIER_PRECEDENCE.indexOf(modifier.context);
      candidates.push({
        rank: SEVERITY_RANK[modifier.severity],
        order: precedence === -1 ? MODIFIER_PRECEDENCE.length : precedence,
        severity: modifier.severity,
        source: modifier.source,
        context: modifier.context,
      });
    }
    if (candidates.length === 0) {
      return finding;
    }
    candidates.sort((a, b) => b.rank - a.rank || a.order - b.order);
    const winner = candidates[0];
    return {
      ...finding,
      flag: winner.severity,
      severity: winner.severity,
      source: winner.source,
      modifierContext: winner.context,
    };
  });
}

/**
 * Pure base classification: normalize + resolve each raw ingredient, apply the
 * version's base rules, sort deterministically, and derive confidence.
 */
export function buildBaseClassification(
  rawIngredients: string[],
  resolutionMap: Map<string, ResolutionEntry>,
  baseRules: Map<string, { severity: Severity; source: string }>,
): { findings: Finding[]; confidence: number; summary: ClassificationSummary } {
  const findings: Finding[] = rawIngredients.map((raw) => {
    const key = normalizeInci(raw);
    const hit = key === '' ? undefined : resolutionMap.get(key);
    if (hit === undefined) {
      // Unknown is a first-class outcome: listed, counted against confidence,
      // never dropped and never treated as clean.
      return {
        raw,
        canonical: null,
        recognized: false,
        flag: 'unknown' as const,
        severity: null,
        source: null,
        matchedVia: null,
        modifierContext: null,
      };
    }
    const rule = baseRules.get(hit.canonicalName);
    return {
      raw,
      canonical: hit.canonicalName,
      recognized: true,
      flag: rule ? rule.severity : 'none',
      severity: rule ? rule.severity : null,
      source: rule ? rule.source : null,
      matchedVia: hit.matchedVia,
      modifierContext: null,
    };
  });

  // Deterministic order: recognised findings by canonical name, then unknowns
  // by normalized raw text. The stored ingredient order never leaks through.
  findings.sort((a, b) => {
    const keyA = findingSortKey(a);
    const keyB = findingSortKey(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  const total = findings.length;
  const recognized = findings.reduce((count, finding) => count + (finding.recognized ? 1 : 0), 0);
  const unknown = total - recognized;
  // Confidence = the fraction of the list we could resolve to a known
  // ingredient; unknown ingredients lower it. An empty list has no
  // recognisable content, so 0.
  const confidence = total === 0 ? 0 : Math.round((recognized / total) * 10000) / 10000;

  return { findings, confidence, summary: { total, recognized, unknown } };
}

@Injectable()
export class ClassificationService {
  constructor(private readonly repository: ClassificationRepository) {}

  // ------------------------------------------------- ingestion (ops/tests)

  async ingestIngredients(
    fixtures: IngredientFixture[],
  ): Promise<{ ingredients: number; synonyms: number }> {
    let synonyms = 0;
    for (const fixture of fixtures) {
      const ingredient = await this.repository.upsertIngredient(fixture.name);
      for (const synonym of fixture.synonyms) {
        await this.repository.upsertSynonym(ingredient.id, synonym);
        synonyms += 1;
      }
    }
    return { ingredients: fixtures.length, synonyms };
  }

  /**
   * Ingests a methodology version from a fixture. Idempotent for identical
   * input; once the version is published, any change is rejected
   * (published versions never change).
   */
  async ingestMethodology(fix: MethodologyFixture): Promise<{
    versionId: string;
    slug: string;
    upserted: number;
    unchanged: number;
  }> {
    const existing = await this.repository.findVersion(fix.slug);
    const version = existing ?? (await this.repository.createVersion(fix.slug, fix.name));
    let upserted = 0;
    let unchanged = 0;
    for (const rule of fix.rules) {
      if (rule.kind === 'context' && !rule.context) {
        throw Errors.invalidInput('A context rule requires a context.', { ingredient: rule.ingredient });
      }
      const kind = rule.kind === 'context' ? RuleKind.CONTEXT : RuleKind.BASE;
      const context = rule.kind === 'context' ? (rule.context ?? '') : '';
      const found = await this.repository.findRuleByKeys(version.id, rule.ingredient, kind, context);
      const identical =
        found !== null && found.severity.toLowerCase() === rule.severity && found.source === rule.source;
      if (identical) {
        unchanged += 1;
        continue;
      }
      if (version.status === VersionStatus.PUBLISHED) {
        throw Errors.methodologyImmutable(version.slug, rule.ingredient);
      }
      await this.repository.upsertRule(version.id, rule.ingredient, rule.severity, rule.source, kind, context);
      upserted += 1;
    }
    return { versionId: version.id, slug: version.slug, upserted, unchanged };
  }

  // ------------------------------------------------- lifecycle

  async publish(versionIdOrSlug: string): Promise<{
    versionId: string;
    slug: string;
    newlyPublished: boolean;
    products: number;
  }> {
    const version = await this.repository.findVersion(versionIdOrSlug);
    if (!version) {
      throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
    }
    const newlyPublished = version.status === VersionStatus.DRAFT;
    if (newlyPublished) {
      await this.repository.markVersionPublished(version.id);
    }
    const { products } = await this.rescore(version.id);
    return { versionId: version.id, slug: version.slug, newlyPublished, products };
  }

  /**
   * Re-scores every product under the given methodology version, upserting the
   * stored result keyed by (product, version). Idempotent: running it again
   * produces the same rows, not duplicates, because the key is unique and the
   * payload is deterministic.
   */
  async rescore(versionIdOrSlug: string): Promise<{ versionId: string; products: number }> {
    const version = await this.repository.findVersion(versionIdOrSlug);
    if (!version) {
      throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
    }
    const [products, resolutionMap, rules] = await Promise.all([
      this.repository.listProducts(),
      this.repository.findResolutionMap(),
      this.repository.findRulesByVersion(version.id),
    ]);
    for (const product of products) {
      await this.upsertStoredResult(product, version, resolutionMap, rules);
    }
    return { versionId: version.id, products: products.length };
  }

  async listVersions(): Promise<
    Array<{ id: string; slug: string; name: string; status: string; publishedAt: string | null }>
  > {
    const versions = await this.repository.listVersions();
    return versions.map((version) => ({
      id: version.id,
      slug: version.slug,
      name: version.name,
      status: version.status,
      publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
    }));
  }

  // ------------------------------------------------- products & profiles

  async createProduct(name: string, brand: string | null, ingredients: string[]): Promise<Product> {
    return this.repository.createProduct(name, brand, ingredients);
  }

  async createProfile(name: string, contexts: string[]): Promise<Profile> {
    return this.repository.createProfile(name, contexts);
  }

  async reorderProductIngredients(productId: string, orderedRaws: string[]): Promise<void> {
    const product = await this.repository.findProduct(productId);
    if (!product) {
      throw Errors.resourceNotFound('Product', productId);
    }
    const existing = product.ingredients.map((row) => row.raw).sort();
    const wanted = [...orderedRaws].sort();
    if (existing.length !== wanted.length || existing.some((value, index) => value !== wanted[index])) {
      throw Errors.invalidInput('Reordering must use exactly the same ingredient list as the product.', {
        productId,
      });
    }
    await this.repository.reorderProductIngredients(product.id, orderedRaws);
  }

  // ------------------------------------------------- classification

  /**
   * Classifies a product against the active (latest published) methodology
   * version, optionally tightened by a profile's contextual modifiers.
   *
   * The base findings come from the stored result for (product, active
   * version) — the immutable snapshot written by re-scoring — so a result never
   * changes under a reader. Profile modifiers are applied deterministically on
   * top; the profile is not part of the stored key.
   */
  async classify(productId: string, profileId?: string): Promise<ClassificationOutput> {
    const product = await this.repository.findProduct(productId);
    if (!product) {
      throw Errors.resourceNotFound('Product', productId);
    }
    let profile: Profile | null = null;
    if (profileId) {
      profile = await this.repository.findProfile(profileId);
      if (!profile) {
        throw Errors.resourceNotFound('Profile', profileId);
      }
    }
    const version = await this.repository.findActiveVersion();
    if (!version) {
      throw Errors.noPublishedMethodology();
    }
    const [stored, rules] = await Promise.all([
      this.repository.findResult(product.id, version.id),
      this.repository.findRulesByVersion(version.id),
    ]);
    let storedRow = stored;
    if (!storedRow) {
      // Product created after the version was published: score it lazily under
      // the active version.
      const resolutionMap = await this.repository.findResolutionMap();
      storedRow = await this.upsertStoredResult(product, version, resolutionMap, rules);
    }
    const payload = storedRow.payload as unknown as StoredPayload;
    const modifiers: ModifierRow[] = rules
      .filter((rule) => rule.kind === RuleKind.CONTEXT)
      .map((rule) => ({
        canonicalName: rule.ingredient.name,
        context: rule.context,
        severity: rule.severity.toLowerCase() as Severity,
        source: rule.source,
      }));
    const findings = applyProfileModifiers(payload.findings, modifiers, profile ? profile.contexts : []);
    return {
      productId: product.id,
      methodologyVersion: version.slug,
      profile: profile ? profile.id : null,
      findings,
      confidence: payload.confidence,
      summary: payload.summary,
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Returns the stored result for an explicit (product, methodology version)
   * pair — the exact snapshot written when that version was (re-)scored.
   */
  async getStoredResult(productId: string, versionIdOrSlug: string): Promise<StoredResultView> {
    const product = await this.repository.findProduct(productId);
    if (!product) {
      throw Errors.resourceNotFound('Product', productId);
    }
    const version = await this.repository.findVersion(versionIdOrSlug);
    if (!version) {
      throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
    }
    const stored = await this.repository.findResult(product.id, version.id);
    if (!stored) {
      throw Errors.resourceNotFound('Classification result', `${product.id} under ${version.slug}`);
    }
    const payload = stored.payload as unknown as StoredPayload;
    return {
      productId: product.id,
      methodologyVersion: version.slug,
      findings: payload.findings,
      confidence: payload.confidence,
      summary: payload.summary,
      disclaimer: DISCLAIMER,
    };
  }

  // ------------------------------------------------- internals

  private async upsertStoredResult(
    product: ProductWithIngredients,
    version: Pick<MethodologyVersion, 'id' | 'slug'>,
    resolutionMap: Map<string, ResolutionEntry>,
    rules: RuleWithIngredient[],
  ): Promise<ClassificationResult> {
    const baseRules = new Map<string, { severity: Severity; source: string }>();
    for (const rule of rules) {
      if (rule.kind !== RuleKind.BASE) {
        continue;
      }
      baseRules.set(rule.ingredient.name, {
        severity: rule.severity.toLowerCase() as Severity,
        source: rule.source,
      });
    }
    const { findings, confidence, summary } = buildBaseClassification(
      product.ingredients.map((row) => row.raw),
      resolutionMap,
      baseRules,
    );
    const payload: StoredPayload = {
      schema: 1,
      methodologyVersion: version.slug,
      findings,
      confidence,
      summary,
    };
    return this.repository.upsertResult(product.id, version.id, payload);
  }
}
```
