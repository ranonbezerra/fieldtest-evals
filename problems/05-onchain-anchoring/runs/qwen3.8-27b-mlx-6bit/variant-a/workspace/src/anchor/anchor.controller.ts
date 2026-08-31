import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  AnchorProof,
  AnchorService,
  DuplicateAnchorError,
  ResourceNotFoundError,
  VerifyResult,
} from './anchor.service.js';

// Single error envelope: { error: { code, message, details } } — `code` is the contract.
function errorEnvelope(code: string, message: string, details: Record<string, unknown>): object {
  return { error: { code, message, details } };
}

@Controller('anchors')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post(':documentId/:version/anchor')
  @HttpCode(HttpStatus.CREATED)
  async anchor(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: unknown },
  ): Promise<AnchorProof> {
    const parsedVersion = this.validateInput(documentId, version, body);
    try {
      return await this.anchorService.anchorDocument(documentId, parsedVersion, body.content);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Post(':documentId/:version/verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: unknown },
  ): Promise<VerifyResult> {
    const parsedVersion = this.validateInput(documentId, version, body);
    try {
      return await this.anchorService.verify(documentId, parsedVersion, body.content);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  // Input-shape validation only; all anchoring logic lives in the service.
  private validateInput(documentId: string, version: string, body: { content?: unknown }): number {
    if (documentId.length === 0) {
      throw new BadRequestException(
        errorEnvelope('invalid_input', 'documentId must be a non-empty string', { field: 'documentId' }),
      );
    }
    // ASSUMPTION: the plan fixes `version` as an Int but not the HTTP-level rule; it is accepted here as a base-10 unsigned integer string.
    if (!/^\d+$/.test(version)) {
      throw new BadRequestException(
        errorEnvelope('invalid_input', 'version must be a non-negative integer', { field: 'version' }),
      );
    }
    if (body === null || body === undefined || body.content === null || body.content === undefined) {
      throw new BadRequestException(
        errorEnvelope('invalid_input', 'body.content is required and must not be null', { field: 'content' }),
      );
    }
    return Number.parseInt(version, 10);
  }

  // ASSUMPTION: the plan fixes only the error mappings 404 resource_not_found and 409 duplicate_anchor for service failures; a verify mismatch is returned as a successful VerifyResult body per the plan's signature, and CanonicalizationError cannot arise from a JSON-transported body, so neither is mapped here.
  // ASSUMPTION: success status codes (201 for anchor, 200 for verify) and the `invalid_input` validation code are not fixed by the plan; they follow the repo conventions.
  private toHttpException(error: unknown): never {
    if (error instanceof DuplicateAnchorError) {
      throw new ConflictException(errorEnvelope('duplicate_anchor', error.message, {}));
    }
    if (error instanceof ResourceNotFoundError) {
      throw new NotFoundException(errorEnvelope('resource_not_found', error.message, {}));
    }
    throw error;
  }
}
