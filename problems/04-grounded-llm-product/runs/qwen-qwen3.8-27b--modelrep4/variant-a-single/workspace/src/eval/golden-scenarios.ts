import type { GoldenScenario } from './eval-harness.js';

/** Fixture wiki pages, as the product "fetches" them (2-3 per scenario). */
export const OBSIDIAN_GATE_PAGE =
  'To open the Obsidian Gate, insert four Ember Shards into the four braziers. The gate then dissolves into light.';

export const EMBER_VAULT_PAGE =
  'Beyond the gate lies the Ember Vault, guarded by the Warden of Coals. The Warden is weak to frost damage. Fire magic only enrages him.';

export const CAVERNS_PAGE =
  'Malgrath, the frost wyrm, is weak to frost damage. He is immune to fire magic. The Caverns of Sigh hide the Coaltide Key near the third ember brazier.';

/**
 * Golden scenarios for the eval harness. `scriptedAnswer` is what the
 * scripted LLM returns for the scenario; `plantedFalseFacts` are the false
 * statements planted in it that the faithfulness judge must catch if they
 * survive to the final answer.
 */
export const GOLDEN_SCENARIOS: GoldenScenario[] = [
  {
    id: 'grounded-correct',
    question: 'What do I need to open the Obsidian Gate?',
    sources: [OBSIDIAN_GATE_PAGE, EMBER_VAULT_PAGE],
    expectedFacts: ['4 Ember Shards', 'Obsidian Gate'],
    plantedFalseFacts: ['5 Dragon Fangs'],
    scriptedAnswer: 'You need 4 Ember Shards to open the Obsidian Gate.',
  },
  {
    id: 'confident-lie',
    question: 'How do I defeat Malgrath?',
    sources: [CAVERNS_PAGE, EMBER_VAULT_PAGE],
    expectedFacts: ['Malgrath is weak to frost damage'],
    plantedFalseFacts: ['Malgrath is weak to fire'],
    scriptedAnswer: 'Malgrath is weak to fire. You can stun him with 5 Dragon Fangs.',
  },
  {
    id: 'no-coverage',
    question: 'Where is the Amulet of Dawn?',
    sources: [OBSIDIAN_GATE_PAGE, EMBER_VAULT_PAGE],
    expectedFacts: [],
    plantedFalseFacts: ['The Amulet of Dawn hangs in the Vault of Whispers'],
    expectedRefusal: true,
    scriptedAnswer: 'The Amulet of Dawn hangs in the Vault of Whispers on the second floor.',
  },
  {
    id: 'quantity-hallucination',
    question: 'What do I need to open the Obsidian Gate?',
    sources: [OBSIDIAN_GATE_PAGE, EMBER_VAULT_PAGE],
    expectedFacts: ['4 Ember Shards'],
    plantedFalseFacts: ['5 Ember Shards'],
    scriptedAnswer: 'You need 5 Ember Shards to open the Obsidian Gate.',
  },
];
