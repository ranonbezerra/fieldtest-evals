import { z } from 'zod';

export const createInviteSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
});

export type CreateInviteDto = z.infer<typeof createInviteSchema>;
