export type AnchorStatus = 'PREPARED' | 'BROADCAST_SENT' | 'BROADCAST_UNKNOWN' | 'CONFIRMED' | 'FAILED';

export interface AnchorProof {
  txId: string;
  status: AnchorStatus;
  contentHash: string;
  blockNumber: number | null;
  blockHash: string | null;
  confirmedAt: string | null;
}

export type VerifyResult = 'verified' | 'hash_mismatch' | 'pending_confirmation' | 'no_anchor';

export interface VerifyReport {
  result: VerifyResult;
  documentId: string;
  version: number;
  suppliedContentHash: string;
  anchor: AnchorProof | null;
  detail?: string;
}
