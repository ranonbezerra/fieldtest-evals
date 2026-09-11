import { REFUSAL } from '../guide/llm.client';

export interface GoldenScenario {
  id: string;
  description: string;
  question: string;
  /** Fetched wiki pages the answer must be grounded in. */
  sources: string[];
  /** Facts a correct answer should contain (lexical, lowercase phrases). */
  expectedFacts: readonly string[];
  /** Planted false facts: an invented item, a wrong quantity, a wrong location. */
  falseFacts: readonly string[];
  /** True when the sources do not contain the answer and refusal is the correct output. */
  expectsRefusal: boolean;
  /** What the scripted fake LLM returns for this scenario. */
  llmReply: string;
  /** Case-insensitive substring of the prompt that routes the fake to llmReply. */
  matchWhen: string;
}

export const FORGE_PAGE_SOCKET =
  'The Beacon Forge lights when 4 ember shards are inserted into the socket above the anvil.';

export const FORGE_PAGE_KEEP =
  'Ember shards are found in the Molten Keep. Pyreth the Ashen guards the entrance to the Molten Keep.';

export const FORGE_PAGE_COUNT =
  'The forge socket accepts exactly 4 shards. Fewer than 4 leaves the forge dark.';

export const GOLDEN_SCENARIOS: readonly GoldenScenario[] = [
  {
    id: 'grounded-correct',
    description: 'The model answers truthfully from the pages; both judges should score it high.',
    question: 'How do I light the Beacon Forge, and where do I find the shards?',
    sources: [FORGE_PAGE_SOCKET, FORGE_PAGE_KEEP],
    expectedFacts: [
      '4 ember shards',
      'light the beacon forge',
      'shards are found in the molten keep',
      'pyreth the ashen guards the entrance',
    ],
    falseFacts: ['the obsidian chalice', '5 ember shards', 'shards are found in the frozen spire'],
    expectsRefusal: false,
    matchWhen: 'where do i find the shards',
    llmReply:
      'You need 4 ember shards to light the Beacon Forge. ' +
      'The shards are found in the Molten Keep, and Pyreth the Ashen guards its entrance. ' +
      'Insert the shards into the socket above the anvil.',
  },
  {
    id: 'wrong-quantity',
    description:
      'The model states 5 shards where the pages say 4; the gate and the faithfulness judge must catch it exactly.',
    question: 'How many ember shards does the Beacon Forge need?',
    sources: [FORGE_PAGE_SOCKET, FORGE_PAGE_COUNT],
    expectedFacts: ['4 ember shards'],
    falseFacts: ['5 ember shards'],
    expectsRefusal: false,
    matchWhen: 'how many ember shards',
    llmReply:
      'You need 5 ember shards to light the Beacon Forge. Insert them into the socket above the anvil.',
  },
  {
    id: 'invented-item-requirement',
    description:
      'A confident, fluent lie about an item that does not exist in the pages; must score low, and the pipeline must refuse it.',
    question: 'What do I need to light the Beacon Forge?',
    sources: [FORGE_PAGE_SOCKET, FORGE_PAGE_KEEP],
    expectedFacts: ['4 ember shards'],
    falseFacts: ['the obsidian chalice', '7 fragments of cold iron'],
    expectsRefusal: false,
    matchWhen: 'what do i need to light',
    llmReply:
      'You must gather the Obsidian Chalice and pour it into the Beacon Forge. ' +
      'The chalice needs 7 fragments of cold iron to work.',
  },
  {
    id: 'answer-not-in-sources',
    description:
      'The fetched pages contain no answer at all; refusal is the correct output and must score high.',
    question: 'What does the lighthouse keeper collect in winter?',
    sources: [FORGE_PAGE_SOCKET, FORGE_PAGE_KEEP],
    expectedFacts: [],
    falseFacts: ['the keeper collects 12 lanterns'],
    expectsRefusal: true,
    matchWhen: 'lighthouse keeper',
    llmReply: REFUSAL,
  },
];
