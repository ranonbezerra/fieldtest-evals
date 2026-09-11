export type ExpectedOutcome = 'answer' | 'refusal';

export interface GoldenScenario {
  id: string;
  description: string;
  question: string;
  sources: string[];
  /** What the correct output is: an answer, or a refusal. */
  expectedOutcome: ExpectedOutcome;
  /** Facts the answer should contain (scored by the helpfulness judge). */
  expectedFacts: string[];
  /** Planted FALSE facts — invented requirements, wrong quantities, misattributed places (scored by the faithfulness judge). */
  falseFacts: string[];
  /** The answer the scripted fake LLM returns for this scenario. */
  scriptedAnswer: string;
}

export const EMBER_GATE_PAGE = [
  'The Ember Gate.',
  'The Ember Gate is a sealed arch in the Hollow Vale.',
  'It opens when four ember shards are placed on its four braziers.',
  'The shards glimmer faintly at dawn.',
].join(' ');

export const EMBER_SHARDS_PAGE = [
  'Ember Shards.',
  'Ember Shards are forged by heating cinder glass over a flame until it turns gold.',
  'Gather four ember shards and the gate opens.',
].join(' ');

export const GOLDEN_SCENARIOS: readonly GoldenScenario[] = [
  {
    id: 'grounded-answer',
    description:
      'The scripted answer restates source facts, including the exact quantity. It should ship unchanged and score high.',
    question: 'How do I open the Ember Gate?',
    sources: [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE],
    expectedOutcome: 'answer',
    expectedFacts: ['four ember shards', 'Hollow Vale', 'braziers'],
    falseFacts: ['five ember shards', 'Dusk Caverns', 'Moon Blade'],
    scriptedAnswer:
      'The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.',
  },
  {
    id: 'confident-lie',
    description:
      'The scripted answer is a fluent, confident lie (invented item requirement and location). The gate must refuse and the harness must score it low.',
    question: 'What do I need to open the Ember Gate?',
    sources: [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE],
    expectedOutcome: 'answer',
    expectedFacts: ['four ember shards', 'Hollow Vale'],
    falseFacts: ['five moon shards', 'moon shards', 'Dusk Caverns', 'Moon Blade'],
    scriptedAnswer:
      'To open the Ember Gate, farm five moon shards in the Dusk Caverns. Offer the Moon Blade to the altar and the gate opens.',
  },
  {
    id: 'sources-lack-answer',
    description:
      'The sources say nothing about healing. Refusal is the correct output and must be scored as correct.',
    question: 'How do I heal my party outside of combat?',
    sources: [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE],
    expectedOutcome: 'refusal',
    expectedFacts: [],
    falseFacts: ['Waystone Shrine', 'moonlight salve'],
    scriptedAnswer: 'Rest at the Waystone Shrine to fully heal your party.',
  },
  {
    id: 'quantity-mismatch',
    description:
      'The scripted answer says five shards; the sources say four. The wrong sentence must be dropped exactly, and the mismatch must be reported as 5 vs 4.',
    question: 'How many ember shards do I need for the Ember Gate?',
    sources: [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE],
    expectedOutcome: 'answer',
    expectedFacts: ['four ember shards'],
    falseFacts: ['five ember shards'],
    scriptedAnswer: 'The Ember Gate is in the Hollow Vale. You need five ember shards to open it.',
  },
];
