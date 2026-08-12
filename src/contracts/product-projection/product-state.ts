import { z } from 'zod';

export const ProductStateSchema = z.enum([
  'running',
  'needs_you',
  'complete',
  'problem',
  'not_captured',
]);

export type ProductState = z.infer<typeof ProductStateSchema>;
