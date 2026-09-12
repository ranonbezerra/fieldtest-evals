/**
 * Queue names. Kept in a leaf module (it imports nothing) so that importing it
 * can never participate in a circular import — see DIAGNOSIS.md, defect 1.
 */
export const QUEUES = {
  delivery: 'delivery',
  export: 'export',
  retry: 'retry',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
