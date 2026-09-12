import { z } from 'zod';

export const createTripSchema = z.object({
  name: z.string().min(1).max(100),
  destination: z.string().min(1).max(100),
  startDate: z
    .string()
    .refine((v) => !isNaN(Date.parse(v)), { message: 'invalid date' }),
  endDate: z
    .string()
    .refine((v) => !isNaN(Date.parse(v)), { message: 'invalid date' }),
});

export type CreateTripDto = z.infer<typeof createTripSchema>;
