import { AnswerService } from './answer.service.js';
import { Scenario, helpfulnessJudge, faithfulnessJudge } from './judges.js';

/**
 * Evaluate a single scenario using a pre‑configured `AnswerService`.
 *
 * The service must already be wired with an `LLMClient` that returns the
 * `scenario.llmAnswer` string (the test harness creates such a client).
 *
 * @param svc    Instance of `AnswerService`.
 * @param scenario Golden scenario definition.
 * @param mode   "full" for a complete answer, "hint" for the redacted hint.
 * @returns      Scores and the generated answer.
 */
export async function evaluateScenario(
  svc: AnswerService,
  scenario: Scenario,
  mode: 'full' | 'hint' = 'full',
): Promise<{
  helpful: number;
  faithful: number;
  final: number;
  answer: string;
}> {
  const answer = await svc.answer(scenario.question, scenario.sources, mode);
  const helpful = helpfulnessJudge(
    answer,
    scenario.expectedFacts,
    scenario.falseFacts,
  );
  const faithful = faithfulnessJudge(answer, scenario.sources);
  const final = Math.min(helpful, faithful);
  return { helpful, faithful, final, answer };
}

/**
 * A collection of golden scenarios used by the evaluation harness.
 *
 * The scenarios cover:
 *   - A correct, fully grounded answer.
 *   - A confident hallucination (should score low).
 *   - A missing answer (service should refuse).
 *   - A quantity mismatch (e.g., "5 shards" vs. source "4 shards").
 *   - A hint‑mode example that must redact bosses, locations and unmentioned quantities.
 */
export const GOLDEN_SCENARIOS: Scenario[] = [
  {
    id: 'correct',
    question: 'How many shards do I need to craft the Crystal Sword?',
    sources: [
      'You need 4 shards of light to craft the Crystal Sword.',
    ],
    expectedFacts: ['4 shards'],
    falseFacts: [],
    llmAnswer:
      'You need 4 shards of light to craft the Crystal Sword.',
  },
  {
    id: 'confident_lie',
    question: 'How many shards do I need to craft the Crystal Sword?',
    sources: [
      'You need 4 shards of light to craft the Crystal Sword.',
    ],
    expectedFacts: ['4 shards'],
    falseFacts: ['5 shards'],
    llmAnswer:
      'You need 5 shards of light to craft the Crystal Sword.',
  },
  {
    id: 'refusal',
    question: 'Where can I find the Mystic Key?',
    sources: [
      'The ancient ruins hold many secrets, but no key is mentioned here.',
    ],
    expectedFacts: [],
    falseFacts: [],
    llmAnswer:
      'The Mystic Key is located in the Whispering Tower.',
  },
  {
    id: 'quantity_error',
    question: 'How many shards do I need to craft the Crystal Sword?',
    sources: [
      'You need 4 shards of light to craft the Crystal Sword.',
    ],
    expectedFacts: ['4 shards'],
    falseFacts: ['5 shards'],
    llmAnswer:
      'You need 5 shards of light to craft the Crystal Sword.',
  },
  {
    id: 'hint',
    question: 'What do I need to defeat the final boss?',
    sources: [
      'To defeat Lord of Shadows, you must collect 3 Shadow Orbs and venture into the Dark Forest.',
    ],
    expectedFacts: ['Shadow Orbs', 'Dark Forest'],
    falseFacts: [],
    llmAnswer:
      'To defeat Lord of Shadows, you must collect 3 Shadow Orbs and venture into the Dark Forest.',
  },
];
