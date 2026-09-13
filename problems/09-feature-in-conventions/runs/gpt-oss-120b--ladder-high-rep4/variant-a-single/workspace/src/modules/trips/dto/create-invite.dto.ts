import { z } from 'zod';

export const createInviteSchema = z.object({
  email: z.string().email(),
});

export type CreateInviteDto = z.infer<typeof createInviteSchema>;
