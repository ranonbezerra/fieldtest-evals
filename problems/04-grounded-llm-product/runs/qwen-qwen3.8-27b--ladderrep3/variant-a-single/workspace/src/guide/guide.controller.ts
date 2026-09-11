import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { GuideService } from './guide.service';
import type { GuideAnswerInput, GuideMode, GuideResult } from './guide.service';

interface InputProblem {
  code: 'invalid_input';
  message: string;
  details: Record<string, unknown>;
}

function validateAnswerBody(body: unknown): InputProblem | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { code: 'invalid_input', message: 'The request body must be a JSON object.', details: { field: 'body' } };
  }
  const { question, sources, mode } = body as Record<string, unknown>;
  if (typeof question !== 'string' || question.trim().length === 0) {
    return { code: 'invalid_input', message: 'question must be a non-empty string.', details: { field: 'question' } };
  }
  if (
    !Array.isArray(sources) ||
    sources.length === 0 ||
    sources.length > 3 ||
    sources.some(page => typeof page !== 'string' || page.trim().length === 0)
  ) {
    return {
      code: 'invalid_input',
      message: 'sources must be an array of 1 to 3 non-empty wiki page strings.',
      details: { field: 'sources' },
    };
  }
  if (mode !== undefined && mode !== 'full' && mode !== 'hint') {
    return { code: 'invalid_input', message: "mode must be 'full' or 'hint'.", details: { field: 'mode' } };
  }
  return null;
}

@Controller('guide')
export class GuideController {
  constructor(private readonly guideService: GuideService) {}

  @Post('answers')
  createAnswer(@Body() body: unknown): Promise<GuideResult> {
    const problem = validateAnswerBody(body);
    if (problem) {
      throw new BadRequestException({ error: problem });
    }
    const input = body as { question: string; sources: string[]; mode?: GuideMode };
    return this.guideService.answer({
      question: input.question.trim(),
      sources: input.sources,
      mode: input.mode ?? 'full',
    } satisfies GuideAnswerInput);
  }
}
