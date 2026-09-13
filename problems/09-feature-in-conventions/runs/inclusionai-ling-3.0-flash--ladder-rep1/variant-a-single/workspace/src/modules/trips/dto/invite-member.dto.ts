import { z } from 'zod';

export const inviteMemberSchema = z.object({
  email: z.string().email(),
});

export type InviteMemberDto = z.infer<typeof inviteMemberSchema>;
