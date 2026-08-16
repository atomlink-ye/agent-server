export type WorkInputProperty =
  | Readonly<{
      type: 'string';
      min_length?: number;
      max_length?: number;
      enum?: readonly string[];
    }>
  | Readonly<{
      type: 'number' | 'integer';
      minimum?: number;
      maximum?: number;
    }>
  | Readonly<{ type: 'boolean' }>;

/**
 * Deliberately small MVE schema for Product Work input. It is JSON-Schema-like
 * but is not advertised as complete JSON Schema support.
 */
export interface WorkInputSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, WorkInputProperty>>;
  readonly required: readonly string[];
  readonly additional_properties: boolean;
}

export type WorkInputSnapshot = Readonly<Record<string, unknown>>;
