/**
 * Queue names, shared across features.
 *
 * This file must keep importing nothing: it is the bottom of the import
 * graph. When these constants lived in `jobs.module.ts`, importing them
 * dragged the whole jobs module (and, through it, the notifications
 * module) into every importer, creating the jobs -> notifications -> jobs
 * evaluation cycle that crashed the process at startup.
 */
export const QUEUES = {
  delivery: 'delivery',
  export: 'export',
  retry: 'retry',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
