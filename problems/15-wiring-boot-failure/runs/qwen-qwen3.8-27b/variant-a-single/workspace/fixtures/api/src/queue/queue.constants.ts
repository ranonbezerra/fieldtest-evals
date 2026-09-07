export const QUEUES = {
  RETRY: 'retries',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
