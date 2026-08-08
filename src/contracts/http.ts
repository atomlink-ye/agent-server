import { z } from 'zod';

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    request_id: z.string().min(1),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export class HttpError extends Error {
  public constructor(
    public readonly status: 400 | 403 | 404 | 409 | 413 | 422 | 503,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
