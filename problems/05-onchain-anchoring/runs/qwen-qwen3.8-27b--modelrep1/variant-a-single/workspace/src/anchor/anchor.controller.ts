import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Res } from '@nestjs/common';
import { AnchorService } from './anchor.service.js';
import { InvalidInputError } from '../errors.js';

interface AnchorRequest {
  documentId: string;
  version: number;
  content: Record<string, unknown>;
}

@Controller('document-anchors')
export class AnchorController {
  constructor(@Inject(AnchorService) private readonly anchorService: AnchorService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async anchorDocument(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: { status(code: number): unknown },
  ): Promise<unknown> {
    const input = this.readInput(body);
    const { view, created } = await this.anchorService.anchor(input.documentId, input.version, input.content);
    if (!created) {
      res.status(HttpStatus.OK); // idempotent hit: the anchor already existed
    }
    return view;
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(@Body() body: unknown): Promise<unknown> {
    const input = this.readInput(body);
    return this.anchorService.verify(input.documentId, input.version, input.content);
  }

  private readInput(body: unknown): AnchorRequest {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new InvalidInputError({ field: 'body' }, 'Request body must be a JSON object');
    }
    const candidate = body as Record<string, unknown>;
    const { documentId, version, content } = candidate;

    if (typeof documentId !== 'string' || documentId.length === 0) {
      throw new InvalidInputError({ field: 'documentId' }, 'documentId must be a non-empty string');
    }
    if (typeof version !== 'number' || !Number.isInteger(version)) {
      throw new InvalidInputError({ field: 'version' }, 'version must be an integer');
    }
    // The structured JSON report is the source of truth; the PDF is only a
    // rendering and is not what gets anchored.
    if (typeof content !== 'object' || content === null || Array.isArray(content)) {
      throw new InvalidInputError({ field: 'content' }, 'content must be a structured JSON object');
    }

    return { documentId, version, content: content as Record<string, unknown> };
  }
}
