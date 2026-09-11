// Golden fixtures for the eval harness: the fetched wiki pages (sources) and
// four scenarios. Each scenario carries the question, the sources, the facts
// a helpful answer must contain, and facts that are FALSE — planted lies a
// weak pipeline would happily emit. `expectedRefusal` marks the scenario
// whose sources do not contain the answer at all: refusal is the correct
// output there, and the harness must score it as such.

export const WIKI_PAGES = {
  emberSanctum:
    "The Ember Sanctum lies behind the Cinder Gate. Four Ember Shards power the sanctum's altar. Place the four Ember Shards on the altar to open the Cinder Gate.",
  hollowKing:
    'The Hollow King guards the inner Ember Sanctum. Defeat the Hollow King to earn the Ashen Key. The Ashen Key opens the Ashen Crypt.',
  cinderGate:
    'The Cinder Gate seals the Ember Sanctum. The gate requires four Ember Shards. No other offering is accepted.',
} as const;

export interface GoldenScenario {
  id: string;
  question: string;
  sources: string[];
  /** Facts a helpful answer must contain (normalized substring match). */
  expectedFacts: string[];
  /** Planted false facts that must never appear in a passing output. */
  falseFacts: string[];
  /** true -> the sources lack the answer; refusal is the correct output. */
  expectedRefusal?: boolean;
}

export const GOLDEN_SCENARIOS: GoldenScenario[] = [
  {
    id: 'shards-for-gate',
    question: 'How many Ember Shards do I need for the Cinder Gate?',
    sources: [WIKI_PAGES.emberSanctum, WIKI_PAGES.cinderGate],
    expectedFacts: ['four ember shards', 'cinder gate'],
    falseFacts: ['two ashen keys'],
  },
  {
    id: 'invented-item-lie',
    question: 'What does the Cinder Gate require?',
    sources: [WIKI_PAGES.emberSanctum, WIKI_PAGES.cinderGate],
    expectedFacts: ['four ember shards', 'cinder gate'],
    falseFacts: ['moonstone amulets'],
  },
  {
    id: 'not-covered-by-sources',
    question: 'What does the Ashen Warden drop after the third act?',
    sources: [WIKI_PAGES.hollowKing, WIKI_PAGES.cinderGate],
    expectedFacts: [],
    falseFacts: ['ashen warden', 'golden blade'],
    expectedRefusal: true,
  },
  {
    id: 'quantity-trap',
    question: 'How many Ember Shards power the altar?',
    sources: [WIKI_PAGES.emberSanctum, WIKI_PAGES.cinderGate],
    expectedFacts: ['four ember shards'],
    falseFacts: ['five ember shards'],
  },
];

// Canned model outputs for the scripted LLM fake, keyed by question. These
// plant the confident lies the pipeline has to catch.
export const CANNED_ANSWERS: Record<string, string> = {
  'How many Ember Shards do I need for the Cinder Gate?':
    'Four Ember Shards are required. The Cinder Gate accepts no other offering. Bring two Ashen Keys to the shrine.',
  'What does the Cinder Gate require?':
    'Feed three Moonstone Amulets to the altar. It takes exactly three Moonstone Amulets.',
  'What does the Ashen Warden drop after the third act?':
    'The Ashen Warden drops two Ember Shards and a golden blade.',
  'How many Ember Shards power the altar?':
    "Five Ember Shards power the sanctum's altar.",
};
