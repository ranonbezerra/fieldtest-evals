import type { OrderStatus } from '@prisma/client';

// Must mirror the `OrderStatus` enum in prisma/schema.prisma.
export const ORDER_STATUSES = ['pending', 'approved', 'disputed', 'cancelled'] as const satisfies readonly OrderStatus[];
