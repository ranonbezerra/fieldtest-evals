/**
 * Queue names. This file intentionally imports nothing: it is a leaf, so any
 * module may take a name from it without creating an evaluation cycle.
 */
export const QUEUES = {
  delivery: 'delivery',
  export: 'export',
  retry: 'retry',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
