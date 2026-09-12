import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a YYYY-MM-DD date')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'expected a real calendar date');

export const createTripSchema = z
  .object({
    name: z.string().min(1).max(120),
    destination: z.string().min(1).max(160),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });

export type CreateTripDto = z.infer<typeof createTripSchema>;
