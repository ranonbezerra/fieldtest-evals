import type { WikiSource } from '../assistant/types.js';
import type { GoldenScenario } from './types.js';

const SUN_GATE_PAGE: WikiSource = {
  id: 'sun-gate',
  title: 'Sun Gate',
  text: [
    'The Sun Gate stands at the top of the Ember Cliffs.',
    'Collect 4 shards and place them on the four plinths to open the Sun Gate.',
    'The gate hums when all the shards are set.',
  ].join(' '),
};

const ASHEN_HOLLOW_PAGE: WikiSource = {
  id: 'ashen-hollow',
  title: 'Ashen Hollow',
  text: [
    'Shards drop from ember wisps in the Ashen Hollow.',
    'Warden Kael guards the path beyond the gate.',
    'The Hollow is dark and the wisps burn pale blue.',
  ].join(' '),
};

const GATE_SOURCES: WikiSource[] = [SUN_GATE_PAGE, ASHEN_HOLLOW_PAGE];

export const GOLDEN_SCENARIOS: GoldenScenario[] = [
  {
    id: 'gate-open-good',
    description: 'A fully grounded answer covering every expected fact.',
    question: 'How do I open the Sun Gate?',
    sources: GATE_SOURCES,
    expectedFacts: [
      'Collect 4 shards and place them on the four plinths to open the Sun Gate.',
      'Shards drop from ember wisps in the Ashen Hollow.',
    ],
    plantedFalseFacts: [],
    scriptedAnswer:
      'To open the Sun Gate, place 4 shards on the four plinths. ' +
      'Shards drop from ember wisps in the Ashen Hollow. ' +
      'Warden Kael guards the path beyond the gate.',
  },
  {
    id: 'gate-open-confident-lie',
    description: 'The model confidently states wrong requirements, including an invented item.',
    question: 'What do I need to open the Sun Gate?',
    sources: GATE_SOURCES,
    expectedFacts: ['Collect 4 shards and place them on the four plinths to open the Sun Gate.'],
    plantedFalseFacts: [
      'You need 5 shards to open the Sun Gate.',
      'The gate also requires the Amber Key.',
    ],
    scriptedAnswer:
      'You need 5 shards to open the Sun Gate. ' +
      'The gate also requires the Amber Key.',
  },
  {
    id: 'uncovered-final-boss',
    description: 'The sources say nothing about the final boss; the pipeline must refuse.',
    question: 'How do I defeat the final boss, Gorbash?',
    sources: GATE_SOURCES,
    expectedFacts: [],
    plantedFalseFacts: [],
    scriptedAnswer: 'Defeat Gorbash in the Vault of Echoes. He carries the Ember Crown.',
    expectRefusal: true,
  },
  {
    id: 'quantity-error-shards',
    description: 'The model states 5 shards where the sources state 4.',
    question: 'How many shards do I need for the Sun Gate?',
    sources: GATE_SOURCES,
    expectedFacts: ['Collect 4 shards and place them on the four plinths to open the Sun Gate.'],
    plantedFalseFacts: ['Collect 5 shards to open the Sun Gate.'],
    scriptedAnswer: 'Collect 5 shards to open the Sun Gate.',
  },
];
