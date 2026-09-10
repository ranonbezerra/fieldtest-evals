import { Controller, Post, Body, Param, ParseIntPipe, HttpException, HttpStatus, ValidationPipe } from '@nestjs/common';
import { AnchorsService } from './anchors.service.js';

interface AnchorRequestDto {
  documentId: string;
  version: number;
}

interface VerifyRequestDto {
  documentId: string;
  version: number;
  content: Record<string, unknown>;
}

interface AnchorResponseDto {
  txId: string;
  status: string;
  blockNumber: number | null;
}

interface VerifyProofDto {
  txId: string;
  blockNumber: number;
  contentHash: string;
}

interface VerifyMismatchDto {
  mismatch: true;
  expectedHash: string;
  actualHash: string;
}

type VerifyResponseDto = VerifyProofDto | VerifyMismatchDto;

@Controller('anchors')
export class AnchorsController {
  constructor(
    private readonly anchorsService: AnchorsService,
  ) {}

  @Post('anchor')
  async anchor(
    @Body(new ValidationPipe({ whitelist: true })) body: AnchorRequestDto,
  ): Promise<AnchorResponseDto> {
    try {
      const result = await this.anchorsService.anchorDocument(body.documentId, body.version);
      return {
        txId: result.txId,
        status: result.status,
        blockNumber: result.blockNumber,
      };
    } catch (error) {
      this.handleServiceError(error);
    }
  }

  @Post('verify')
  async verify(
    @Body(new ValidationPipe({ whitelist: true })) body: VerifyRequestDto,
  ): Promise<VerifyResponseDto> {
    return this.anchorsService.verify(body.documentId, body.version, body.content);
  }

  private handleServiceError(error: unknown): never {
    if (error instanceof DuplicateAnchorError) {
      throw new HttpException({
        error: {
          code: 'duplicate_anchor',
          message: `An anchor already exists for this document and version`,
          details: {},
        },
      }, HttpStatus.CONFLICT);
    }
    throw new HttpException({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred',
        details: {},
      },
    }, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
