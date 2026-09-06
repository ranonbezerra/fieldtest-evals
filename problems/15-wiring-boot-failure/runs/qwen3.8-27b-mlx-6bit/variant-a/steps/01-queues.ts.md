# 01-queues.ts

## reasoning

```
The task is to write exactly one file: `src/common/queues.ts`. According to the PLAN.md, this file should contain:

1. A `QUEUES` const with `notifications: 'notifications'` and `retries: 'retries'`, using `as const`.
2. A `QueueName` type derived from `QUEUES`.
3. Zero imports (leaf file).
4. No other exports.

This is straightforward. Let me write it exactly as specified.
```

## reply

```ts
export const QUEUES = {
  notifications: 'notifications',
  retries: 'retries',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
```
