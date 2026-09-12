/**
 * Queue name constants shared across the application.
 * This file has no imports from other feature modules,
 * which prevents circular module dependencies.
 */
export const QUEUES = {
  delivery: 'delivery',
  export: 'export',
  retry: 'retry',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
