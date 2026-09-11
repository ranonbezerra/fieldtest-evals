import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { GuideService } from './guide.service.js';
import { LLM_CLIENT, NoOpLlmClient } from './llm-client.js';

@Module({
  providers: [GuideService, { provide: LLM_CLIENT, useClass: NoOpLlmClient }],
  exports: [GuideService],
})
export class GuideModule {}
