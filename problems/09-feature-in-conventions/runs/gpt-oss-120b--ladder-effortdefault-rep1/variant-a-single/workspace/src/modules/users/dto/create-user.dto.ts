import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(80),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;
