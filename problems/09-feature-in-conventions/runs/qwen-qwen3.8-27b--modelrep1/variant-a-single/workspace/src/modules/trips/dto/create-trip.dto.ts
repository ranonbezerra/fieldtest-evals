import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const createTripSchema = z
  .object({
    name: z.string().min(1).max(100),
    destination: z.string().min(1).max(120),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });

export type CreateTripDto = z.infer<typeof createTripSchema>;
