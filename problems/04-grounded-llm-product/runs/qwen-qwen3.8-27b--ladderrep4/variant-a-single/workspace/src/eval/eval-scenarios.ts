/**
 * Golden scenarios for the guide assistant. Each scenario carries the
 * question, the wiki pages the pipeline was given, the facts a helpful answer
 * should contain, and PLANTED FALSE FACTS — an invented item requirement, a
 * wrong quantity, a misattributed location — that a good answer must not
 * assert. "refusal-correct" has no answer in its sources at all, so a refusal
 * is the correct output.
 */

export interface Fact {
  /** Developer-facing description. Never matched on; markers are. */
  statement: string;
  /** Normalized substrings that identify the fact inside an answer text. */
  markers: string[];
}

export interface GoldenScenario {
  id: string;
  question: string;
  sources: string[];
  /** Facts a helpful answer should contain. */
  expectedFacts: Fact[];
  /** Facts that are false; a faithful answer asserts none of them. */
  falseFacts: Fact[];
  /** What the scripted model returns for this question. */
  scriptedAnswer: string;
  /** True when the sources do not contain the answer at all: refusal is correct. */
  expectsRefusal?: boolean;
}

export const GOLDEN_SCENARIOS: GoldenScenario[] = [
  {
    id: 'grounded-answer',
    question: 'How do I unlock the trial of Gloomwing?',
    sources: [
      'Bring 4 sunshard keys to the altar in Emberfall Hollow to unlock the trial of Gloomwing. The altar will not accept a partial set.',
      'Collect sunshard keys from the vault in Sunspire Cathedral. The vault opens during the blue moon.',
    ],
    scriptedAnswer:
      'Bring 4 sunshard keys to the altar in Emberfall Hollow to unlock the trial of Gloomwing. Collect the sunshard keys from the vault in Sunspire Cathedral.',
    expectedFacts: [
      {
        statement: '4 sunshard keys at the altar in Emberfall Hollow unlock the trial of Gloomwing',
        markers: ['4 sunshard keys', 'altar in emberfall hollow', 'trial of gloomwing'],
      },
      {
        statement: 'sunshard keys come from the vault in Sunspire Cathedral',
        markers: ['vault in sunspire cathedral'],
      },
    ],
    falseFacts: [
      { statement: 'invented item requirement: a Moonstone Sigil is needed', markers: ['moonstone sigil'] },
      { statement: 'wrong quantity: 5 sunshard keys', markers: ['5 sunshard keys'] },
      { statement: 'misattributed location: the vault in Emberfall Hollow', markers: ['vault in emberfall hollow'] },
    ],
  },
  {
    id: 'fluent-lie',
    question: 'Where do I find the sunshard keys?',
    sources: [
      'Sunshard keys are stored in the vault in Sunspire Cathedral. The vault opens during the blue moon.',
      'The lair of Gloomwing is the Emberfall Hollow, a long way from the cathedral.',
    ],
    // Fluent and lexically supported, but the vault is misattributed: the
    // sources put it in Sunspire Cathedral. Only a judge that sees the
    // sources can catch it.
    scriptedAnswer:
      'Sunshard keys are stored in the vault in Emberfall Hollow. The vault opens during the blue moon.',
    expectedFacts: [
      { statement: 'the sunshard keys are kept in a vault', markers: ['sunshard keys', 'vault'] },
      { statement: 'the vault opens during the blue moon', markers: ['vault opens', 'blue moon'] },
    ],
    falseFacts: [
      { statement: 'misattributed location: the vault in Emberfall Hollow', markers: ['vault in emberfall hollow'] },
      { statement: 'invented item requirement: a Moonstone Sigil', markers: ['moonstone sigil'] },
      { statement: 'wrong quantity: 5 sunshard keys', markers: ['5 sunshard keys'] },
    ],
  },
  {
    id: 'refusal-correct',
    question: 'How do I tame the river serpents?',
    sources: [
      'Sunshard keys are stored in the vault in Sunspire Cathedral.',
      'Bring 4 sunshard keys to the altar in Emberfall Hollow to unlock the trial of Gloomwing.',
    ],
    // The sources say nothing about river serpents; a confident guess is the
    // incident from the bug report. Refusal is the correct output here.
    scriptedAnswer: 'You tame the river serpents by feeding them moonlit eels at dawn.',
    expectedFacts: [],
    falseFacts: [
      { statement: 'invented method: feeding moonlit eels tames river serpents', markers: ['moonlit eels'] },
    ],
    expectsRefusal: true,
  },
  {
    id: 'quantity-error',
    question: 'How many sunshard keys does the altar ask for?',
    sources: [
      'The altar in Emberfall Hollow asks for 4 sunshard keys, no more and no less. The altar will not accept a partial set.',
      'Sunshard keys are stored in the vault in Sunspire Cathedral.',
    ],
    // The sources say 4; the model says 5. The failure that looks most like success.
    scriptedAnswer:
      'The altar asks for 5 sunshard keys, no more and no less. The altar will not accept a partial set.',
    expectedFacts: [
      { statement: 'the altar asks for 4 sunshard keys', markers: ['4 sunshard keys'] },
    ],
    falseFacts: [
      { statement: 'wrong quantity: 5 sunshard keys', markers: ['5 sunshard keys'] },
    ],
  },
];
