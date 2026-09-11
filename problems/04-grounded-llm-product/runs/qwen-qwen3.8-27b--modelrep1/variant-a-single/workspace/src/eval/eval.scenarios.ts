import type { EvalScenario } from './eval.harness';
import type { WikiPage } from '../assistant/assistant.types';

/**
 * Fixture wiki pages: the only world the assistant knows. Three scenarios ask
 * about the Sun Gate (answerable, with planted FALSE facts); one asks about a
 * dragon's hoard that no page mentions (unanswerable).
 */
export const SUN_GATE_PAGES: WikiPage[] = [
  {
    id: 'sun-gate',
    title: 'Sun Gate',
    text:
      'The Sun Gate stands at the end of the Ashen Road. It is sealed by a lock with four sockets. ' +
      'You need 4 shards to open the Sun Gate. The Ashen Warden guards the gate while it is sealed.',
  },
  {
    id: 'ember-shards',
    title: 'Ember Shards',
    text:
      'Ember Shards fall from ashfall crows on the Ashen Road. Four shards are required to open the Sun Gate. ' +
      'A fifth shard is rumoured to exist, but none has ever been found.',
  },
];

const SUN_GATE_QUESTION = 'How do I open the Sun Gate?';
const SUN_GATE_EXPECTED_FACTS = [
  'You need 4 shards to open the Sun Gate',
  'The Ashen Warden guards the gate',
];
const SUN_GATE_FORBIDDEN_FACTS = [
  'You need 5 shards to open the Sun Gate',
  'The Ashen Key is required to open the Sun Gate',
];

export const GOLDEN_SCENARIOS: EvalScenario[] = [
  {
    id: 'sun-gate-grounded',
    question: SUN_GATE_QUESTION,
    sources: SUN_GATE_PAGES,
    expectedFacts: SUN_GATE_EXPECTED_FACTS,
    forbiddenFacts: SUN_GATE_FORBIDDEN_FACTS,
  },
  {
    id: 'sun-gate-confident-lie',
    question: SUN_GATE_QUESTION,
    sources: SUN_GATE_PAGES,
    expectedFacts: SUN_GATE_EXPECTED_FACTS,
    forbiddenFacts: SUN_GATE_FORBIDDEN_FACTS,
  },
  {
    id: 'sun-gate-invented-requirement',
    question: SUN_GATE_QUESTION,
    sources: SUN_GATE_PAGES,
    expectedFacts: SUN_GATE_EXPECTED_FACTS,
    forbiddenFacts: SUN_GATE_FORBIDDEN_FACTS,
  },
  {
    id: 'dragon-hoard-unanswerable',
    question: "Where is the dragon's hoard hidden?",
    sources: SUN_GATE_PAGES,
    expectedFacts: [],
    forbiddenFacts: [],
  },
];

/**
 * Scripted model answers, one per scenario, fed to the fake LLM client:
 * a correct grounded answer, a confident quantity lie, a lie that invents an
 * item requirement, and a confident answer to an unanswerable question.
 */
export const SCRIPTED_ANSWERS: Record<string, string> = {
  'sun-gate-grounded':
    'You need 4 shards to open the Sun Gate. The Ashen Warden guards the gate on the Ashen Road.',
  'sun-gate-confident-lie': 'You need 5 shards to open the Sun Gate.',
  'sun-gate-invented-requirement': 'You need 4 shards and the Ashen Key to open the Sun Gate.',
  'dragon-hoard-unanswerable': "The dragon's hoard is hidden in the Crypt of Echoes behind the waterfall.",
};
