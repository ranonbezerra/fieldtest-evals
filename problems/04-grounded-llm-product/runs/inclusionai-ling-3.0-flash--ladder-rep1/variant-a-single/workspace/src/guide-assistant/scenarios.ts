import type { GoldenScenario } from './eval-harness.js';

/**
 * Golden scenarios with expected facts and planted false facts.
 *
 * Each scenario carries:
 *   - question, sources, expected facts, false facts (invented requirements,
 *     wrong quantities, misattributed locations)
 *   - a scripted LLM response so a confident lie can be planted
 *   - a flag indicating whether the sources actually cover the question
 */
export const scenarios: GoldenScenario[] = [
  // ---- Scenario 1: Correct grounded answer ----
  {
    name: 'correct boss guide',
    question: 'How do I defeat the Shadow Dragon?',
    sources: [
      'The Shadow Dragon is a boss found in the Ember Cave. It has 4 elemental shards.',
      'All 4 shards are needed to enter the battle arena. Bring ice armor to survive its fire attacks.',
    ],
    expectedFacts: ['4 elemental shards', 'Ember Cave', 'ice armor'],
    falseFacts: ['5 shards', 'Fire Sword', 'Sky Temple'],
    scriptedLLMResponse:
      'To defeat the Shadow Dragon, you need all 4 elemental shards and ice armor. The fight takes place in the Ember Cave.',
    sourcesCoverQuestion: true,
  },

  // ---- Scenario 2: Confident lie (5 shards vs 4, invented item & location) ----
  {
    name: 'confident lie with wrong quantity',
    question: 'How do I defeat the Shadow Dragon?',
    sources: [
      'The Shadow Dragon is a boss found in the Ember Cave. It has 4 elemental shards.',
      'All 4 shards are needed to enter the battle arena.',
    ],
    expectedFacts: ['4 elemental shards', 'Ember Cave'],
    falseFacts: ['5 shards', 'Fire Sword', 'Sky Temple'],
    scriptedLLMResponse:
      'To defeat the Shadow Dragon, you need 5 elemental shards and a Fire Sword. Fight it in the Sky Temple.',
    sourcesCoverQuestion: true,
  },

  // ---- Scenario 3: Sources lack the answer entirely ----
  {
    name: 'sources lack the answer',
    question: 'How do I tame a Wild Wyvern?',
    sources: [
      'The Forest Sprite is a gentle creature that loves moonlight.',
      'Forest Sprites can be found near ancient trees in the valley.',
    ],
    expectedFacts: [],
    falseFacts: ['Moon Fruit', 'Ancient Shrine'],
    scriptedLLMResponse:
      'To tame the Wild Wyvern, feed it Moon Fruit at the Ancient Shrine.',
    sourcesCoverQuestion: false,
  },

  // ---- Scenario 4: Quantity error — exactly "5 shards" vs sources "4 shards" ----
  {
    name: 'quantity mismatch exactly five vs four',
    question: 'How many shards does the boss have?',
    sources: [
      'The boss has 4 elemental shards.',
      'Collecting all 4 shards unlocks the final phase.',
    ],
    expectedFacts: ['4 shards'],
    falseFacts: ['5 shards'],
    scriptedLLMResponse: 'The boss has 5 elemental shards.',
    sourcesCoverQuestion: true,
  },
];
