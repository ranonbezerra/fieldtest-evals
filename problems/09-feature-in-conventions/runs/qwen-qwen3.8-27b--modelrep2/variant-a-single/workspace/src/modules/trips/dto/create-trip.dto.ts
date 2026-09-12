import { z } from 'zod';

export const createTripSchema = z
  .object({
    name: z.string().min(1).max(120),
    destination: z.string().min(1).max(120),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((value) => value.endsAt.getTime() > value.startsAt.getTime(), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });

export type CreateTripDto = z.infer<typeof createTripSchema>;
