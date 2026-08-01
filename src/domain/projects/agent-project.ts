import type {
  AgentRef,
  EnvironmentRef,
  MemoryRef,
  SkillRef,
  TeamRef,
  ToolProfileRef,
  WorkspaceRef,
} from './logical-ref.js';
import type { NormalizedLocalToolProfile } from './local-tool-profile.js';
import type { Sha256Fingerprint } from './project-canonicalization.js';

export interface AgentProjectManifest {
  readonly apiVersion: 'agent-server/v1alpha1';
  readonly kind: 'AgentProject';
  readonly metadata: { readonly name: string };
  readonly spec: {
    readonly workspace: { readonly name: string };
    readonly toolProfiles: Readonly<Record<string, { readonly file: string }>>;
    readonly skills: Readonly<
      Record<
        string,
        {
          readonly directory: string;
          readonly requiredTools: readonly string[];
        }
      >
    >;
    readonly environments: Readonly<Record<string, { readonly file: string }>>;
    readonly agents: Readonly<Record<string, { readonly file: string }>>;
    readonly teams: Readonly<Record<string, { readonly file: string }>>;
    readonly memoryStores: Readonly<
      Record<
        string,
        {
          readonly name: string;
          readonly description?: string;
          readonly seeds: readonly {
            readonly path: string;
            readonly file: string;
          }[];
        }
      >
    >;
    readonly entrypoints: readonly TeamRef[];
    readonly defaultEntrypoint: TeamRef;
  };
}

export interface SourceTuple {
  readonly type: string;
  readonly name: string;
  readonly path: string;
  readonly digest: string;
}

export interface NormalizedAgentProject {
  readonly manifest: AgentProjectManifest;
  readonly workspace: WorkspaceRef;
  readonly toolProfiles: ReadonlyMap<
    ToolProfileRef,
    NormalizedLocalToolProfile
  >;
  readonly skills: ReadonlyMap<
    SkillRef,
    {
      readonly name: string;
      readonly directory: string;
      readonly requiredTools: readonly string[];
      readonly digest: string;
      readonly sourceMetadata: string;
      readonly sourceFingerprint: Sha256Fingerprint;
    }
  >;
  readonly environments: ReadonlyMap<
    EnvironmentRef,
    {
      readonly name: string;
      readonly path: string;
      readonly source: string;
      readonly sourceFingerprint: Sha256Fingerprint;
    }
  >;
  readonly agents: ReadonlyMap<
    AgentRef,
    {
      readonly name: string;
      readonly path: string;
      readonly source: string;
      readonly sourceFingerprint: Sha256Fingerprint;
    }
  >;
  readonly teams: ReadonlyMap<
    TeamRef,
    {
      readonly name: string;
      readonly path: string;
      readonly source: string;
      readonly sourceFingerprint: Sha256Fingerprint;
    }
  >;
  readonly memoryStores: ReadonlyMap<
    MemoryRef,
    {
      readonly name: string;
      readonly description?: string;
      readonly seeds: readonly {
        readonly path: string;
        readonly file: string;
        readonly source: string;
        readonly sourceFingerprint: Sha256Fingerprint;
      }[];
    }
  >;
  readonly entrypoints: readonly TeamRef[];
  readonly defaultEntrypoint: TeamRef;
  readonly sourceTuples: readonly SourceTuple[];
  readonly canonicalManifest: string;
  readonly fingerprint: Sha256Fingerprint;
}
