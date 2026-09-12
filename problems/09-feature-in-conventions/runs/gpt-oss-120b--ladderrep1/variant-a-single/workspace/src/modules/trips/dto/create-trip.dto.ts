import { z } from 'zod';

export const createTripSchema = z.object({
  name: z.string().min(1).max(120),
  destination: z.string().min(1).max(120),
  startDate: z.string().refine((s) => !isNaN(Date.parse(s)), {
    message: 'invalid date',
  }),
  endDate: z.string().refine((s) => !isNaN(Date.parse(s)), {
    message: 'invalid date',
  }),
});

export type CreateTripDto = z.infer<typeof createTripSchema>;
