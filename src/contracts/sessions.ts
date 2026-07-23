import { z } from 'zod';
export const WorkspaceCreateSchema = z
  .object({ name: z.string().trim().min(1).max(255) })
  .strict();
export const SessionCreateSchema = z
  .object({
    workspace_id: z.string().uuid(),
    agent_version_id: z.string().trim().min(1),
  })
  .strict();
export const MessageCreateSchema = z
  .object({ text: z.string().trim().min(1).max(65536) })
  .strict();
export type WorkspaceCreate = z.infer<typeof WorkspaceCreateSchema>;
export type SessionCreate = z.infer<typeof SessionCreateSchema>;
