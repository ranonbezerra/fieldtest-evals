/**
 * The one error every rejected refresh throws. It deliberately carries no
 * caller-visible detail: all rejection causes produce the same response, and
 * the cause lives in the audit row written just before this is thrown.
 */
export class RefreshRejected extends Error {
  constructor() {
    super('refresh rejected');
    this.name = 'RefreshRejected';
  }
}
