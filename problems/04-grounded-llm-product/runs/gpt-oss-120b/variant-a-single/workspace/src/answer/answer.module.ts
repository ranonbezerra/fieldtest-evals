import { Module } from '@nestjs/common';
import { AnswerService } from './answer.service';
import { EvalService } from './eval.service';
import { FakeLLMClient } from './fake-llm-client.service';
import { LLM_CLIENT } from './llm-client.interface';

@Module({
  providers: [
    AnswerService,
    EvalService,
    {
      provide: LLM_CLIENT,
      useClass: FakeLLMClient,
    },
  ],
  exports: [AnswerService, EvalService],
})
export class AnswerModule {}
