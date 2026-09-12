import { BadRequestException, Body, Controller, Post } from '@nestjs/common';

import {
  AssistantService,
  type AnswerMode,
  type AssistantAnswer,
} from './assistant.service.js';

/**
 * Thin HTTP surface for the answer pipeline: validate the request shape, then
 * delegate to AssistantService. All behaviour lives in the service.
 */
@Controller('answers')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post()
  async answer(@Body() body: unknown): Promise<AssistantAnswer> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw this.invalidRequest('request body must be a JSON object', {});
    }
    const payload = body as Record<string, unknown>;

    const question = payload.question;
    if (typeof question !== 'string' || question.trim().length === 0) {
      throw this.invalidRequest('question must be a non-empty string', { field: 'question' });
    }

    const sources = payload.sources;
    if (
      !Array.isArray(sources) ||
      sources.length < 2 ||
      sources.length > 3 ||
      !sources.every((page) => typeof page === 'string' && page.trim().length > 0)
    ) {
      throw this.invalidRequest('sources must be an array of 2-3 non-empty wiki page texts', {
        field: 'sources',
      });
    }

    const mode: unknown = payload.mode ?? 'full';
    if (mode !== 'full' && mode !== 'hint') {
      throw this.invalidRequest("mode must be 'full' or 'hint'", { field: 'mode' });
    }

    return this.assistant.answer(question, sources as string[], mode as AnswerMode);
  }

  /** Single error envelope: { error: { code, message, details } }. */
  private invalidRequest(message: string, details: Record<string, unknown>): BadRequestException {
    return new BadRequestException({ error: { code: 'invalid_request', message, details } });
  }
}
