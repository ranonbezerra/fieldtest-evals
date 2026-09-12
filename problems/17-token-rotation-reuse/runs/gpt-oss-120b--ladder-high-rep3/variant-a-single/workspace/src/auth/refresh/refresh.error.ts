export class RefreshError extends Error {
  constructor(public readonly code: string) {
    super(`Refresh error: ${code}`);
    this.name = 'RefreshError';
  }
}
