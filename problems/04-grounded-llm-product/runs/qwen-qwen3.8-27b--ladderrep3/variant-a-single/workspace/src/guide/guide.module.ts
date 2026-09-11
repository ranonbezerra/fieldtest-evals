import { Module } from '@nestjs/common';
import { GuideController } from './guide.controller';
import { LlmClient, ScriptedLlmClient } from './llm.client';
import { GuideService } from './guide.service';

@Module({
  controllers: [GuideController],
  providers: [GuideService, { provide: LlmClient, useClass: ScriptedLlmClient }],
  exports: [GuideService],
})
export class GuideModule {}
