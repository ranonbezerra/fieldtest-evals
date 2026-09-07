// ASSUMPTION: 'msw' is not installed in this workspace, so 'msw/browser'
// cannot be imported or augmented. Browser-side MSW setup is a no-op stub.

export function startMockServiceWorker(): void {
  // no-op: msw/browser is unavailable
}
