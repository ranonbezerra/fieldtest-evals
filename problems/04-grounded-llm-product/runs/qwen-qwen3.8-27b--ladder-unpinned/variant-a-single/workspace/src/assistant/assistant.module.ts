import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { LlmClient } from './assistant.llm-client';

@Module({
  controllers: [AssistantController],
  providers: [AssistantService, LlmClient],
  exports: [AssistantService],
})
export class AssistantModule {}
