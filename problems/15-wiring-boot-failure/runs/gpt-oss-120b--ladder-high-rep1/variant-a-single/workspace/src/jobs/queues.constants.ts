/** Queue names used across the application.
 * This file has no imports, so it can be safely imported by any module without
 * creating a circular dependency.
 */
export const QUEUES = {
  delivery: 'delivery',
  export: 'export',
  retry: 'retry',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
