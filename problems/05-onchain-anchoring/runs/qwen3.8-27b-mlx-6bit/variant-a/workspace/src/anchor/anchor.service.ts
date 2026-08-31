async anchorDocument(documentId: string, version: number, content: unknown): Promise<AnchorProof> {
  // 1. Canonical hash, outside any transaction.
  const contentHash = hashContent(content);          // throws CanonicalizationError
  const canonicalContent = canonicalize(content);    // stored as source of truth

  // 2. Persist intent BEFORE any chain call (insert only).
  const newAnchor: NewAnchor = {
    documentId, version, contentHash, content: canonicalContent,
    txId: null, state: 'pending',
  };
  const created = await this.repo.create(newAnchor); // throws DuplicateAnchorError

  // 3. Local deterministic prepare.
  const { txId, signedTx } = this.chain.prepare({ documentId, version, contentHash });

  // 4. Persist tx identity BEFORE broadcast (ordering rule).
  const broadcasting = await this.repo.updateState(created.id, { txId, state: 'broadcasting' });

  // 5. Broadcast; unknown outcome on rejection — leave in broadcasting (limbo).
  try {
    await this.chain.broadcast(signedTx);
  } catch {
    // outcome unknown; recovery sweep will resolve. Do not mark failed.
  }

  // 6. Return proof with current known fields; worker completes confirmation.
  return {
    documentId, version, contentHash,
    txId: broadcasting.txId ?? txId,
    blockNumber: null,
  };
}
