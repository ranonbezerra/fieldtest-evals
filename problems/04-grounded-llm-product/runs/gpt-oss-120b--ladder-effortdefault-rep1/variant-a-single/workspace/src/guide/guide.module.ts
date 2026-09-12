import { Module } from '@nestjs/common';
import { GuideService } from './guide.service.js';
import { LLM_CLIENT, LlmClient } from './llm-client.interface.js';

/**
 * The module wires the `GuideService` with an LLM client.
 *
 * In production a real client would be provided. Tests inject a scripted fake.
 */
@Module({
  providers: [
    GuideService,
    {
      provide: LLM_CLIENT,
      useFactory: (): LlmClient => ({
        // placeholder – real implementation is supplied by the consumer
        async generate(_: string, __: string[]) {
          throw new Error('LLM client not configured');
        },
      }),
    },
  ],
  exports: [GuideService],
})
export class GuideModule {}
