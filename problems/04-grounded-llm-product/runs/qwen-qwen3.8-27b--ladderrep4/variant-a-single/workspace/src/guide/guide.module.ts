import { Module } from '@nestjs/common';
import { AnswerController } from './answer.controller';
import { AnswerService } from './answer.service';
import { LLM_CLIENT } from './llm.client';
import { ScriptedLlmClient } from './scripted-llm.client';
import type { LlmClient } from './answer.types';

function llmClientFromEnv(): LlmClient {
  // ASSUMPTION: no LLM vendor is specified and the task sanctions a scripted
  // fake, so the running app wires ScriptedLlmClient from the LLM_SCRIPT env
  // var (a JSON object mapping questions to scripted answers). A real client
  // would read its configuration the same way: environment variables only.
  const raw = process.env.LLM_SCRIPT;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('LLM_SCRIPT must be a JSON object mapping questions to scripted answers');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('LLM_SCRIPT must be a JSON object mapping questions to scripted answers');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('LLM_SCRIPT must be a JSON object mapping questions to scripted answers');
  }
  const script: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error('LLM_SCRIPT values must be strings');
    }
    script[key] = value;
  }
  return new ScriptedLlmClient(script);
}

@Module({
  controllers: [AnswerController],
  providers: [
    AnswerService,
    { provide: LLM_CLIENT, useFactory: llmClientFromEnv },
  ],
})
export class GuideModule {}
