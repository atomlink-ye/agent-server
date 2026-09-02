export type CoworkerRuntimeStatus =
  'available' | 'draining' | 'unavailable' | 'working' | 'thinking';

export interface Coworker {
  readonly id: string;
  readonly displayName: string;
  readonly roleLabel: string | null;
  readonly summary: string | null;
  readonly activeAgentVersionId: string;
  readonly runtimeStatus: CoworkerRuntimeStatus;
}

export type CapabilityInputProperty =
  | {
      readonly type: 'string';
      readonly minLength?: number;
      readonly maxLength?: number;
      readonly choices?: readonly string[];
    }
  | {
      readonly type: 'number' | 'integer';
      readonly minimum?: number;
      readonly maximum?: number;
    }
  | { readonly type: 'boolean' };

export interface CapabilityInputSchema {
  readonly properties: Readonly<Record<string, CapabilityInputProperty>>;
  readonly required: readonly string[];
  readonly additionalProperties: boolean;
}

export interface CoworkerCapability {
  readonly definitionId: string;
  readonly definitionVersionId: string;
  readonly name: string;
  readonly description: string | null;
  readonly inputSchema: CapabilityInputSchema;
}
