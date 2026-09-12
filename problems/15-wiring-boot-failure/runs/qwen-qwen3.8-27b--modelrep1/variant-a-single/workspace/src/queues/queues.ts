/**
 * Queue names, shared by every feature that enqueues work.
 *
 * Deliberately a leaf module: it imports nothing, so any file may read a
 * name here without creating a module-evaluation cycle. (Keeping constants
 * in `*.module.ts` files is what caused the boot crash — see DIAGNOSIS.md.)
 */
export const QUEUES = {
  delivery: 'delivery',
  export: 'export',
  retry: 'retry',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
