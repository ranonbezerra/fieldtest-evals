/**
 * Tracks whether the active session has unsaved notes. This mirrors the
 * SessionDetailScreen's dirty flag (local draft vs cached server value) so
 * other screens — like the list — can act on it. It is not a second source
 * of truth: the detail screen is the source, and this is its signal.
 */
let activeSessionDirty = false;

export function setActiveSessionDirty(dirty: boolean): void {
  activeSessionDirty = dirty;
}

export function getActiveSessionDirty(): boolean {
  return activeSessionDirty;
}
