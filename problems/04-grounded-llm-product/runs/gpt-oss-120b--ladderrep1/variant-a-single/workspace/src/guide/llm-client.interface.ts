import { Injectable } from '@nestjs/common';

/**
 * Minimal LLM client contract.
 *
 * The real implementation would call an external model. For tests a scripted fake
 * implementation is injected.
 */
export interface LlmClient {
  /**
   * Generate an answer given the player question and the retrieved source texts.
   *
   * @param question Player's raw question.
   * @param sources  Array of source page texts.
   * @returns A single string containing the model's answer (may contain multiple sentences).
   */
  generate(question: string, sources: string[]): Promise<string>;
}

/**
 * Token used by Nest to inject a custom LLM client.
 */
export const LLM_CLIENT = 'LLM_CLIENT';
