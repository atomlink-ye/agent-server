import { z } from 'zod';

export const AuthCredentialsSchema = z
  .object({
    username: z.string().trim().min(1).max(80),
    password: z.string().min(1).max(256),
  })
  .strict();

export const AuthIdentitySchema = z
  .object({
    user_id: z.string().uuid(),
    username: z.string().min(1),
    display_name: z.string().min(1),
  })
  .strict();
