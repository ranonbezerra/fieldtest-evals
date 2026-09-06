export const QUEUES = {
  notifications: 'notifications',
  retries: 'retries',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
