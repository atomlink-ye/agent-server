export type LocalEnvironmentName =
  'in-process' | 'postgres' | 'core' | 'runtime' | 'full';

export type ComposeTransport = 'raw' | 'repository';

export interface RuntimeProfile {
  readonly enabled: boolean;
  readonly adapter: string;
  readonly provider?: string;
  readonly model?: string;
}

export interface RuntimeOverrides {
  readonly adapter?: string;
  readonly provider?: string;
  readonly model?: string;
}

export interface ComposeProfile {
  readonly transport: ComposeTransport;
  readonly files: readonly string[];
}

export interface LocalEnvironmentProfile {
  readonly name: LocalEnvironmentName;
  readonly providerToolchain: 'disabled' | 'required';
  readonly services: readonly string[];
  readonly runtime: RuntimeProfile;
  readonly compose: ComposeProfile;
}

export interface EnvironmentPorts {
  readonly postgres?: number;
  readonly api?: number;
  readonly web?: number;
}

export interface LocalEnvironmentState {
  readonly profile: LocalEnvironmentName;
  readonly projectName: string;
  readonly testMode: boolean;
  readonly ports: EnvironmentPorts;
  readonly runtimeOverrides?: RuntimeOverrides;
}

export interface LocalEnvironmentUrls {
  readonly postgres?: string;
  readonly api?: string;
  readonly web?: string;
}
