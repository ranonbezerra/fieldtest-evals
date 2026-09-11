import { z } from 'zod';

export const createTripSchema = z
  .object({
    name: z.string().min(1).max(120),
    destination: z.string().min(1).max(160),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((dto) => dto.endsAt >= dto.startsAt, {
    message: 'endsAt must be on or after startsAt',
    path: ['endsAt'],
  });

export type CreateTripDto = z.infer<typeof createTripSchema>;
