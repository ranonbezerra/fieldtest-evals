import { z } from 'zod';

export const inviteDtoSchema = z.object({
  email: z.string().email(),
});

export type InviteDto = z.infer<typeof inviteDtoSchema>;
