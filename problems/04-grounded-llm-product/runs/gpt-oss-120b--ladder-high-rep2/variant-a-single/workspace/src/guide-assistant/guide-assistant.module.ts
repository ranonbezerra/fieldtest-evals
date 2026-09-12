import { Module } from '@nestjs/common';
import { GuideAssistantService } from './guide-assistant.service.js';

/**
 * Module that bundles the GuideAssistantService. The LLM client implementation
 * is provided by the importing module (e.g., the test harness) under the token
 * "LLMClient".
 */
@Module({
  providers: [GuideAssistantService],
  exports: [GuideAssistantService],
})
export class GuideAssistantModule {}
