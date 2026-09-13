export type AnchorStatus = 'PREPARED' | 'BROADCAST_SENT' | 'BROADCAST_LIMBO' | 'CONFIRMED' | 'FAILED';

export interface AnchorRecord {
  id: string;
  documentId: string;
  version: string;
  contentHash: string;
  txId: string;
  signedTx: string;
  status: AnchorStatus;
  block: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAnchorInput {
  documentId: string;
  version: string;
  contentHash: string;
  txId: string;
  signedTx: string;
}

export interface AnchorProof {
  txId: string;
  block: number;
}

export interface ContentMismatch {
  mismatch: true;
  expectedHash: string;
  actualHash: string;
}

export type VerifyResult = AnchorProof | ContentMismatch;
