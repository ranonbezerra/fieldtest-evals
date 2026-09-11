import { z } from 'zod';

export const createTripSchema = z
  .object({
    name: z.string().min(1).max(120),
    destination: z.string().min(1).max(120),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })
  .refine((value) => new Date(value.endsAt) >= new Date(value.startsAt), {
    message: 'endsAt must be on or after startsAt',
  });

export type CreateTripDto = z.infer<typeof createTripSchema>;
