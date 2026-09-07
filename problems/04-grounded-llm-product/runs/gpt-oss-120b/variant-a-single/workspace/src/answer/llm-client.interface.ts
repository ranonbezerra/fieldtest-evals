import { Injectable } from '@nestjs/common';

/**
 * Minimal LLM client contract.
 */
export interface LLMClient {
  /**
   * Generates a response for the given prompt.
   */
  generate(prompt: string): Promise<string>;
}

/**
 * Token used for NestJS injection.
 */
export const LLM_CLIENT = 'LLM_CLIENT';
