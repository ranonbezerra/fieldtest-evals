import { z } from 'zod';

export const createInviteSchema = z.object({
  email: z
    .string()
    .email()
    .transform((value) => value.trim().toLowerCase()),
});

export type CreateInviteDto = z.infer<typeof createInviteSchema>;
