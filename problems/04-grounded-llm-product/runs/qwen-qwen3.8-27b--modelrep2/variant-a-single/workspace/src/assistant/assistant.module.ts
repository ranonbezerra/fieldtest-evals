import { Module } from '@nestjs/common';

import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';
import { LLM_CLIENT, ScriptedLlmClient } from './llm-client.js';

@Module({
  controllers: [AssistantController],
  providers: [
    AssistantService,
    {
      provide: LLM_CLIENT,
      useFactory: (): ScriptedLlmClient => {
        // No real LLM integration ships with this build; the task allows a
        // scripted fake. ASSISTANT_LLM_SCRIPT (env var only) overrides its
        // canned reply; the default replies with the refusal so the API can
        // never emit ungrounded content.
        const script = process.env['ASSISTANT_LLM_SCRIPT'];
        return new ScriptedLlmClient(() => script ?? 'not covered by my sources');
      },
    },
  ],
  exports: [AssistantService],
})
export class AssistantModule {}
