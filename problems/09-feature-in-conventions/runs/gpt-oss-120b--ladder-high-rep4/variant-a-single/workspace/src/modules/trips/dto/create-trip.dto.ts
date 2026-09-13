import { z } from 'zod';

export const createTripSchema = z.object({
  name: z.string().min(1).max(255),
  destination: z.string().min(1).max(255),
  startDate: z
    .string()
    .refine((v) => !isNaN(Date.parse(v)), { message: 'invalid startDate' }),
  endDate: z
    .string()
    .refine((v) => !isNaN(Date.parse(v)), { message: 'invalid endDate' }),
});

export type CreateTripDto = z.infer<typeof createTripSchema>;
