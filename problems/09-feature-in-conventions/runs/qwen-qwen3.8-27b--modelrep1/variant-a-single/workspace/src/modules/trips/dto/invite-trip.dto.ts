import { z } from 'zod';

export const inviteTripSchema = z.object({
  email: z.string().email(),
});

export type InviteTripDto = z.infer<typeof inviteTripSchema>;
