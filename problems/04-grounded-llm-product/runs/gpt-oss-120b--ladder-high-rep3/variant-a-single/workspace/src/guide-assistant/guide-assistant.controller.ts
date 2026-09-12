import { Controller, Post, Body, Query } from '@nestjs/common';
import { GuideAssistantService } from './guide-assistant.service.js';

type AnswerMode = 'full' | 'hint';

@Controller('guide')
export class GuideAssistantController {
  constructor(private readonly guideService: GuideAssistantService) {}

  @Post('answer')
  async answer(
    @Body('question') question: string,
    @Body('sources') sources: string[],
    @Query('mode') mode: AnswerMode = 'full',
  ): Promise<{ answer: string }> {
    const answer = await this.guideService.answer(question, sources, mode);
    return { answer };
  }
}
