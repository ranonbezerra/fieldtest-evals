/**
 * Queue names. Imported all over the application.
 *
 * This file intentionally imports nothing. `QUEUES` used to live inside
 * `jobs.module.ts`, which put `jobs` and `notifications` in an import cycle
 * and crashed the process at module evaluation (see DIAGNOSIS.md). Keeping
 * this file a leaf of the module graph is what makes that cycle impossible.
 */
export const QUEUES = {
  delivery: 'delivery',
  export: 'export',
  retry: 'retry',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
