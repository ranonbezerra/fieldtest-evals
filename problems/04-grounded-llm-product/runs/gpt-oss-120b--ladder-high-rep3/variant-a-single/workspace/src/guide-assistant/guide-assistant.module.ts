import { Module } from '@nestjs/common';
import { GuideAssistantService } from './guide-assistant.service.js';

@Module({
  providers: [GuideAssistantService],
  exports: [GuideAssistantService],
})
export class GuideAssistantModule {}
