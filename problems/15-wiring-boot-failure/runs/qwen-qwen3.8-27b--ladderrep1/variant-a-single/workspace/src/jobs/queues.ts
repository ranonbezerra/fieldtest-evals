/**
 * Queue names, shared across the application.
 *
 * This file must import nothing: it is the leaf that keeps the jobs and
 * notifications modules from importing each other. See DIAGNOSIS.md.
 */
export const QUEUES = {
  delivery: 'delivery',
  export: 'export',
  retry: 'retry',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
