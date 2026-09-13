import { z } from 'zod';

export const createTripSchema = z.object({
  name: z.string().min(1).max(100),
  destination: z.string().min(1).max(200),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});

export type CreateTripDto = z.infer<typeof createTripSchema>;
