import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import { AnswerService } from './answer.service';
import type { AnswerMode, AnswerResult } from './answer.types';

interface ParsedAnswerRequest {
  question: string;
  sources: string[];
  mode: AnswerMode;
}

function parseAnswerRequest(body: unknown): ParsedAnswerRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('request body must be a JSON object with question, sources and mode');
  }
  const { question, sources, mode } = body as Record<string, unknown>;
  if (typeof question !== 'string' || question.trim() === '') {
    throw new BadRequestException('question must be a non-empty string');
  }
  if (
    !Array.isArray(sources) ||
    sources.length < 2 ||
    sources.length > 3 ||
    sources.some((source) => typeof source !== 'string' || source.trim() === '')
  ) {
    throw new BadRequestException('sources must be an array of 2 to 3 non-empty wiki page texts');
  }
  if (mode !== 'full' && mode !== 'hint') {
    throw new BadRequestException("mode must be 'full' or 'hint'");
  }
  return { question: question.trim(), sources: sources as string[], mode };
}

@Controller('answers')
export class AnswerController {
  constructor(@Inject(AnswerService) private readonly answerService: AnswerService) {}

  @Post()
  answer(@Body() body: unknown): Promise<AnswerResult> {
    const { question, sources, mode } = parseAnswerRequest(body);
    return this.answerService.answer(question, sources, mode);
  }
}
