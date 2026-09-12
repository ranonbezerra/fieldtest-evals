import { Module } from '@nestjs/common';

import { AssistantController } from './assistant.controller.js';
import { AssistantService, REFUSAL_MESSAGE } from './assistant.service.js';
import { LLM_CLIENT, ScriptedLlmClient } from './llm-client.js';

@Module({
  controllers: [AssistantController],
  providers: [
    AssistantService,
    {
      provide: LLM_CLIENT,
      // ASSUMPTION: the task permits a scripted fake as the injected LLM
      // client and no real provider is specified, so the module wires the
      // fake by default (it always elicits the refusal). Swap this provider
      // to inject a real client.
      useValue: new ScriptedLlmClient(() => REFUSAL_MESSAGE),
    },
  ],
  exports: [AssistantService],
})
export class AssistantModule {}
