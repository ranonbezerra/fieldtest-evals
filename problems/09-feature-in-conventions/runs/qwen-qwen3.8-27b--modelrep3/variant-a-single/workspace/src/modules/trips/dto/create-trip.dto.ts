import { z } from 'zod';

export const createTripSchema = z
  .object({
    name: z.string().min(1).max(120),
    destination: z.string().min(1).max(120),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((dto) => dto.endDate.getTime() > dto.startDate.getTime(), {
    message: 'endDate must be after startDate',
  });

export type CreateTripDto = z.infer<typeof createTripSchema>;
