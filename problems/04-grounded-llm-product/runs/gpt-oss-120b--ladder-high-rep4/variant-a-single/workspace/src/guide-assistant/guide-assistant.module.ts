import { Module } from '@nestjs/common';
import { AnswerService } from './answer.service.js';
import { LLMClient } from './llm-client.interface.js';

/**
 * NestJS module that provides the guide‑assistant service.
 *
 * In a production environment the `LLMClient` provider would be bound to a real
 * implementation. For tests a mock client is injected directly when constructing
 * `AnswerService`.
 */
@Module({
  providers: [
    AnswerService,
    {
      provide: 'LLMClient',
      useFactory: (): LLMClient => ({
        async generate(_: string): Promise<string> {
          // Placeholder – overridden in tests or by a real implementation.
          return '';
        },
      }),
    },
  ],
  exports: [AnswerService],
})
export class GuideAssistantModule {}
