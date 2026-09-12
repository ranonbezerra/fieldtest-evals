import { ALL_WIKI_PAGES } from '../guide/fixtures.js';
import type { WikiSource } from '../guide/guide.types.js';

/**
 * A golden scenario for the eval harness: the question, the exact sources the
 * assistant may use, the facts a correct answer must contain, and planted
 * FALSE facts (invented requirements) that must never appear.
 */
export interface GoldenScenario {
  id: string;
  question: string;
  sources: WikiSource[];
  /** Phrases a correct answer must contain (case-insensitive, word-bounded). */
  expectedFacts: string[];
  /** Planted false claims the answer must not contain. */
  plantedFalseFacts: string[];
}

export const KINDLE_ALTAR: GoldenScenario = {
  id: 'kindle-altar',
  question: 'How do I kindle the Ember Altar?',
  sources: ALL_WIKI_PAGES,
  expectedFacts: ['4 ember shards'],
  plantedFalseFacts: ['5 ember shards', 'Moonblade'],
};

export const SHARD_HUNT: GoldenScenario = {
  id: 'shard-hunt',
  question: 'I have 2 ember shards so far. What do I do next?',
  sources: ALL_WIKI_PAGES,
  expectedFacts: ['Duskfang Warden', 'ember shards'],
  plantedFalseFacts: ['5 ember shards', 'Moonblade'],
};

export const GOLDEN_SCENARIOS: GoldenScenario[] = [KINDLE_ALTAR, SHARD_HUNT];
