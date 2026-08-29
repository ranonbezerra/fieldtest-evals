# Reference solution — annotated core

## Crux 1: grounding gate (per sentence, exact on numbers)

```ts
export function groundingCheck(answer: string, sources: string[]) {
  const corpus = normalize(sources.join('\n'));
  return splitSentences(answer).map((s) => {
    const tokens = contentTokens(s);                 // stopwords out, stems in
    const overlap = tokens.filter(t => corpus.includes(t)).length / tokens.length;
    // Numbers are facts, not vibes: every numeral must appear verbatim in sources.
    const numbersOk = extractNumbers(s).every(n => corpus.includes(n));
    return { sentence: s, grounded: overlap >= 0.6 && numbersOk };
  });
}
```

Production path: drop ungrounded sentences; if what's left doesn't answer the
question, refuse ("not covered by my sources") — the model's priors never fill
the gap (M3, M5).

## Crux 2: two judges, min-combined

```ts
// Judge 1 (helpfulness): sees question + answer. Judge 2 (faithfulness):
// sees question + answer + SOURCES, and is instructed to score ONLY whether
// every claim is supported — helpfulness explicitly out of scope.
const helpful  = await judgeHelpfulness(q, answer);
const faithful = await judgeFaithfulness(q, answer, sources);
const score = Math.min(helpful, faithful);   // M2: confidence can't buy back a lie
```

A single judge that sees sources but scores "overall quality" regresses to
grading confidence — separation of criteria is the point (why M1 alone is not
enough).

## Crux 3: planted false facts (the gabarito)

```ts
// scenario.falseFacts: statements that are NOT true per the sources.
// Asserting any of them fails the scenario outright, whatever the judges say.
const asserted = scenario.falseFacts.filter(f => asserts(answer, f));
if (asserted.length) return { pass: false, reason: `asserted: ${asserted[0]}` };
```

This is what catches the original bug: the confident hallucinated requirement is
in the gabarito, so no judge generosity can pass it.

## Crux 4: hint/restricted mode by redaction

```ts
// Derive the constrained output FROM the full grounded answer:
// full -> classify spans (entity names, locations, quantities, roles)
//      -> redact spans beyond the allowed scope -> rewrite for fluency.
// Never "please be vague" prompting: that's a request, not a guarantee.
```

## Common wrong answers

- Source-blind judge as the quality signal — grades confidence, not truth.
- Averaging helpful+faithful — a 9-helpful/3-faithful lie scores 6 and survives.
- Fuzzy matching numbers — "5 shards" vs "4 shards" passes token overlap; exact
  numeral check is mandatory.
- Prompt-only spoiler/role control — restriction must be enforced in code.
