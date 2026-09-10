/**
 * Golden scenarios for the eval harness.
 *
 * Each scenario carries the question, the fetched wiki pages (sources), the
 * facts a correct answer must contain, the planted FALSE facts the shipped
 * answer must never contain, whether refusal is the correct outcome, and the
 * scripted reply the LLM will give for the scenario (the lies are planted
 * here).
 */

export interface GoldenScenario {
  id: string;
  question: string;
  sources: string[];
  /** Facts a correct answer must contain (case-insensitive substring). */
  expectedFacts: string[];
  /** Planted FALSE facts: the shipped answer must not contain any of them. */
  falseFacts: string[];
  /** True when the sources do not cover the question and refusal is correct. */
  expectRefusal: boolean;
  /** Scripted reply of the LLM for this scenario. */
  script: string;
}

const GATE_SOURCES = [
  'The Gloom King guards the Obsidian Gate. You need 4 shards to open the Obsidian Gate. Shards drop from cinderspawn in the Ember Depths.',
  'The Ember Depths are a cavern ring lit by smoldering roots. Cinderspawn respawn every dawn.',
];

const BAKERY_SOURCES = [
  'Recipe: simmer 2 cups of salted broth with thyme for 10 minutes. The kitchen oven reaches 400 degrees.',
  'The village bakery trades bread for copper. Ovens warm at dawn.',
];

export const goldenScenarios: GoldenScenario[] = [
  {
    id: 'grounded-correct',
    question: 'What do I need to open the Obsidian Gate?',
    sources: GATE_SOURCES,
    expectedFacts: ['4 shards', 'obsidian gate'],
    falseFacts: ['5 shards', 'ember sigil'],
    expectRefusal: false,
    script: 'You need 4 shards to open the Obsidian Gate. The Gloom King guards the Obsidian Gate.',
  },
  {
    // The model's reply is fluent and confident, but every claim is false:
    // an invented item requirement ("Ember Sigil"), a wrong quantity (5
    // shards against the page's 4) and a misattributed location.
    id: 'planted-lie',
    question: 'What do I need to open the Obsidian Gate?',
    sources: GATE_SOURCES,
    expectedFacts: ['4 shards'],
    falseFacts: ['5 shards', 'ember sigil', 'sunken crypt'],
    expectRefusal: false,
    script: 'Collect 5 shards and the Ember Sigil to open the Obsidian Gate. The Ember Sigil is forged in the Sunken Crypt.',
  },
  {
    // The sources say nothing about the Ash Rot; refusal is the correct
    // output and the harness must score it as such.
    id: 'sources-lack-answer',
    question: 'How do I cure the Ash Rot?',
    sources: BAKERY_SOURCES,
    expectedFacts: [],
    falseFacts: ['ash rot', '3 cups', 'sunwell', 'holy water'],
    expectRefusal: true,
    script: 'The Ash Rot is cured by drinking 3 cups of holy water from the Sunwell. Brew the tonic in the Sunken Crypt.',
  },
  {
    // One sentence is true, the other carries the planted quantity error;
    // the gate must drop exactly the "5 shards" sentence.
    id: 'quantity-trap',
    question: 'How many shards do I need for the Obsidian Gate?',
    sources: GATE_SOURCES,
    expectedFacts: ['4 shards'],
    falseFacts: ['5 shards', 'ember sigil'],
    expectRefusal: false,
    script: 'You need 4 shards to open the Obsidian Gate. Bring 5 shards and the Ember Sigil to the altar to be safe.',
  },
];
