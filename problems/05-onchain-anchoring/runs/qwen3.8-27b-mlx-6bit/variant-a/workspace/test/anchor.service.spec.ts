class FakeAnchorRepository {
  rows: AnchorRecord[] = [];
  private nextId = 1;

  async create(input: NewAnchor): Promise<AnchorRecord> {
    const existing = this.rows.find(r => r.documentId === input.documentId && r.version === input.version);
    if (existing) throw new DuplicateAnchorError('duplicate anchor');
    const row: AnchorRecord = { id: `row_${this.nextId++}`, blockNumber: null, ...input };
    this.rows.push(row);
    return row;
  }

  async findUnique(documentId: string, version: number): Promise<AnchorRecord | null> {
    return this.rows.find(r => r.documentId === documentId && r.version === version) ?? null;
  }

  async findByState(state: AnchorState, limit?: number): Promise<AnchorRecord[]> {
    const found = this.rows.filter(r => r.state === state);
    return limit === undefined ? found : found.slice(0, limit);
  }

  async updateState(id: string, patch: { state?: AnchorState; txId?: string; blockNumber?: number | null }): Promise<AnchorRecord> {
    const row = this.rows.find(r => r.id === id);
    if (!row) throw new Error(`unknown anchor row: ${id}`);
    if (patch.state !== undefined) row.state = patch.state;
    if (patch.txId !== undefined) row.txId = patch.txId;
    if (patch.blockNumber !== undefined) row.blockNumber = patch.blockNumber;
    return row;
  }
}
