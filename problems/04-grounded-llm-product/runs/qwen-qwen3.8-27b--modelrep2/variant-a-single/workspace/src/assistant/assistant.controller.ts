import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';

import { AssistantService } from './assistant.service.js';
import type { AnswerMode, WikiSource } from './types.js';

/**
 * Validates input and delegates to the service.
 * A refusal is a product outcome (200 with status 'refused'), not an HTTP error.
 */
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('answers')
  async answer(@Body() body: unknown) {
    const input = (body ?? {}) as Record<string, unknown>;

    const question = input['question'];
    if (typeof question !== 'string' || question.trim() === '') {
      throw badRequest('question must be a non-empty string', { field: 'question' });
    }

    const rawSources = input['sources'];
    if (!Array.isArray(rawSources) || rawSources.length === 0) {
      throw badRequest('sources must be a non-empty array of wiki pages', { field: 'sources' });
    }

    const sources: WikiSource[] = [];
    for (let i = 0; i < rawSources.length; i += 1) {
      const raw = rawSources[i];
      if (typeof raw !== 'object' || raw === null) {
        throw badRequest(`sources[${i}] must be an object with a text field`, { field: `sources[${i}]` });
      }
      const page = raw as Record<string, unknown>;
      const text = page['text'];
      if (typeof text !== 'string' || text.trim() === '') {
        throw badRequest(`sources[${i}].text must be a non-empty string`, { field: `sources[${i}].text` });
      }
      sources.push({
        id: typeof page['id'] === 'string' ? page['id'] : `page-${i + 1}`,
        title: typeof page['title'] === 'string' ? page['title'] : `Page ${i + 1}`,
        text,
      });
    }

    const mode = (input['mode'] ?? 'full') as AnswerMode;
    if (mode !== 'full' && mode !== 'hint') {
      throw badRequest("mode must be 'full' or 'hint'", { field: 'mode' });
    }

    return this.assistant.answer(question, sources, mode);
  }
}

function badRequest(message: string, details: Record<string, unknown>): HttpException {
  return new HttpException(
    { error: { code: 'invalid_input', message, details } },
    HttpStatus.BAD_REQUEST,
  );
}
