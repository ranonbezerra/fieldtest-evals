import { Body, Controller, HttpStatus, Inject, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AnchoringService } from './anchoring.service.js';
import type { VerifyReport } from './anchoring.service.js';
import { ValidationError } from '../errors.js';

@Controller('anchors')
export class AnchoringController {
  constructor(@Inject(AnchoringService) private readonly service: AnchoringService) {}

  /** POST /anchors — anchor one (document, version). Idempotent per pair. */
  @Post()
  async anchor(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const { documentId, version } = this.parseAnchorBody(body);
    const outcome = await this.service.anchorDocument(documentId, version);
    res.status(outcome.status === 'confirmed' ? HttpStatus.OK : HttpStatus.ACCEPTED).json(outcome);
  }

  /** POST /anchors/verify — recompute the hash; proof or a mismatch report. */
  @Post('verify')
  async verify(@Body() body: unknown): Promise<VerifyReport> {
    const { documentId, version, content } = this.parseVerifyBody(body);
    return this.service.verify(documentId, version, content);
  }

  private parseAnchorBody(body: unknown): { documentId: string; version: number } {
    const issues: string[] = [];
    if (!isPlainObject(body)) {
      issues.push('body must be a JSON object');
    } else {
      this.checkDocumentVersion(body, issues);
    }
    if (issues.length > 0) throw new ValidationError(issues);
    const b = body as { documentId: string; version: number };
    return { documentId: b.documentId, version: b.version };
  }

  private parseVerifyBody(body: unknown): { documentId: string; version: number; content: Record<string, unknown> } {
    const issues: string[] = [];
    if (!isPlainObject(body)) {
      issues.push('body must be a JSON object');
    } else {
      this.checkDocumentVersion(body, issues);
      if (!isPlainObject(body.content)) {
        issues.push('content must be a JSON object');
      }
    }
    if (issues.length > 0) throw new ValidationError(issues);
    const b = body as { documentId: string; version: number; content: Record<string, unknown> };
    return { documentId: b.documentId, version: b.version, content: b.content };
  }

  private checkDocumentVersion(body: Record<string, unknown>, issues: string[]): void {
    if (typeof body.documentId !== 'string' || body.documentId.length === 0) {
      issues.push('documentId must be a non-empty string');
    }
    if (typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 1) {
      issues.push('version must be a positive integer');
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
