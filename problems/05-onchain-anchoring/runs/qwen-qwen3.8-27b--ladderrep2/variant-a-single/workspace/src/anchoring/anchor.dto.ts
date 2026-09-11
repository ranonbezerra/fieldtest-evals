import { IsDefined, IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';
import type { AnchorRecord } from './anchoring.repository.js';
import type { AnchorStatus, VerifyReport } from './types.js';

export class AnchorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  documentId!: string;

  @IsInt()
  @Min(1)
  version!: number;

  @IsDefined()
  content!: unknown;
}

export class VerifyAnchorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  documentId!: string;

  @IsInt()
  @Min(1)
  version!: number;

  @IsDefined()
  content!: unknown;
}

const API_STATUS: Record<AnchorStatus, string> = {
  PREPARED: 'prepared',
  BROADCAST_SENT: 'broadcast_sent',
  BROADCAST_UNKNOWN: 'broadcast_unknown',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
};

function toApiStatus(status: AnchorStatus): string {
  return API_STATUS[status];
}

export function toAnchorResponse(a: AnchorRecord) {
  return {
    id: a.id,
    documentId: a.documentId,
    version: a.version,
    contentHash: a.contentHash,
    txId: a.txId,
    status: toApiStatus(a.status),
    broadcastAttempts: a.broadcastAttempts,
  };
}

export function toVerifyResponse(report: VerifyReport) {
  return {
    result: report.result,
    documentId: report.documentId,
    version: report.version,
    suppliedContentHash: report.suppliedContentHash,
    anchor: report.anchor
      ? {
          txId: report.anchor.txId,
          status: toApiStatus(report.anchor.status),
          contentHash: report.anchor.contentHash,
          blockNumber: report.anchor.blockNumber,
          blockHash: report.anchor.blockHash,
          confirmedAt: report.anchor.confirmedAt,
        }
      : null,
    ...(report.detail ? { detail: report.detail } : {}),
  };
}
