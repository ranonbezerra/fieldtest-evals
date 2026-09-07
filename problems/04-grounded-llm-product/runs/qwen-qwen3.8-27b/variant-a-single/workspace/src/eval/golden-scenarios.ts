import type { GoldenScenario } from './eval-harness.js';

/** Wiki page fixtures shared by the scenarios. */
export const CELLAR_PAGES = [
  'The Gravel Wretch is the guardian of the cellar. It can only be weakened by a shard of glass. Four shards are required to seal the cellar door.',
  'The cellar lies behind the bakery. The door has no keyhole. Shards of glass can be found in broken windows.',
];

/** A fully grounded reply. */
export const GROUNDED_REPLY =
  'The cellar lies behind the bakery. Weaken the Gravel Wretch with a shard of glass. Four shards are required to seal the cellar door.';

/** A confident lie: invented item requirement + wrong quantity + invented name. */
export const CONFIDENT_LIE_REPLY =
  'The cellar door opens with a Moonlight Shard. You need five shards and the Rusted Key to proceed.';

export const GOLDEN_SCENARIOS: GoldenScenario[] = [
  {
    id: 'grounded-answer-high',
    description: 'A fully grounded answer must score high on both judges.',
    question: 'How do I get past the cellar door?',
    sources: CELLAR_PAGES,
    mode: 'answer',
    llmReply: GROUNDED_REPLY,
    expectedFacts: ['behind the bakery', 'gravel wretch', 'four shards are required'],
    plantedFalseFacts: ['moonlight shard', 'rusted key', 'five shards'],
  },
  {
    id: 'confident-lie-low',
    description: 'A confident but unsupported answer must score low.',
    question: 'How do I get past the cellar door?',
    sources: CELLAR_PAGES,
    mode: 'answer',
    llmReply: CONFIDENT_LIE_REPLY,
    expectedFacts: ['gravel wretch', 'four shards'],
    plantedFalseFacts: ['moonlight shard', 'rusted key', 'five shards'],
  },
  {
    id: 'uncovered-refusal',
    description: 'Sources that lack the answer yield a refusal, even when the LLM hallucinates.',
    question: 'What does the Moonlight Shrine do?',
    sources: CELLAR_PAGES,
    mode: 'answer',
    llmReply: 'The Moonlight Shrine restores health. A Rusted Key glows beside it.',
    expectedFacts: [],
    expectRefusal: true,
    plantedFalseFacts: ['moonlight shrine', 'rusted key'],
  },
  {
    id: 'quantity-mismatch-dropped',
    description: 'A wrong quantity (five vs four shards) is caught exactly: the sentence is dropped, the correct one kept.',
    question: 'How do I get past the cellar door?',
    sources: CELLAR_PAGES,
    mode: 'answer',
    llmReply: 'Four shards are required. Bring five shards to the door.',
    expectedFacts: ['four shards are required'],
    plantedFalseFacts: ['five shards'],
  },
  {
    id: 'hint-redacted',
    description: 'Hint mode redacts names, item locations and quantities from the grounded answer.',
    question: 'How do I get past the cellar door?',
    sources: CELLAR_PAGES,
    mode: 'hint',
    llmReply: GROUNDED_REPLY,
    expectedFacts: ['several shards are required', 'hidden place', 'hidden name'],
    plantedFalseFacts: ['gravel wretch', 'bakery', 'four shards'],
  },
];
