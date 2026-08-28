import type { ExecutionPlaneHealth } from '../../../src/application/ports/execution-plane.js';
import type {
  ExecutionOutput,
  ExecutionResult,
  ExecutionSession,
  ExecutionSessionCapabilities,
} from '../../../src/application/ports/runtime-execution-session.js';
import type {
  ProviderRuntimeSpec,
  ProviderSessionBinding,
  ProviderSessionHandle,
  RuntimeExecutionProvider,
  RuntimeProviderInspection,
} from '../../../src/application/ports/runtime-execution-provider.js';
import type { RuntimeTurnId } from '../../../src/domain/runtime/runtime-session.js';
import type { RuntimeProviderCapabilities } from '../../../src/domain/runtime/runtime-provider-capabilities.js';

import {
  loadProviderFixture,
  type ProviderFixture,
} from './load-provider-fixture.js';
import { recordExecutionTrace } from '../../../src/shared/observability/execution-trace.js';

export type FixtureReplayReport = Readonly<{
  mode: 'fixture_replay';
  live_provider: false;
  fixture_id: string;
  schema_version: 1;
}>;

const capabilities: RuntimeProviderCapabilities = {
  canReconfigure: false,
  canCloseSession: true,
  canInspectBootstrapDigestComponents: false,
};

const sessionCapabilities: ExecutionSessionCapabilities = {
  supported: new Set(),
};

/** A deterministic RuntimeExecutionProvider with no live-provider fallback. */
export class FixtureRuntimeProvider implements RuntimeExecutionProvider {
  public readonly name = 'fixture-replay';
  public readonly replayReport: FixtureReplayReport;
  readonly #fixture: ProviderFixture;

  public constructor(fixtureId: string) {
    this.#fixture = loadProviderFixture(fixtureId);
    this.replayReport = {
      mode: 'fixture_replay',
      live_provider: false,
      fixture_id: this.#fixture.fixture_id,
      schema_version: this.#fixture.schema_version,
    };
  }

  public capabilities(): RuntimeProviderCapabilities {
    return capabilities;
  }

  public async ensureReady(): Promise<boolean> {
    return true;
  }

  public async health(): Promise<ExecutionPlaneHealth> {
    return {
      ready: true,
      plane: this.name,
      provider: this.#fixture.provider.family,
      model: this.#fixture.provider.model_class,
      checks: [{ name: 'fixture_replay', ready: true }],
    };
  }

  public async create(
    desired: ProviderRuntimeSpec,
  ): Promise<ProviderSessionHandle> {
    recordExecutionTrace({
      module: 'FixtureRuntimeProvider',
      fixtureId: this.#fixture.fixture_id,
    });
    return this.handle(desired);
  }

  public async inspect(
    _binding: ProviderSessionBinding,
  ): Promise<RuntimeProviderInspection> {
    return {
      status: 'missing',
      reason: 'Fixture replay creates a deterministic session.',
    };
  }

  public async reconfigure(): Promise<never> {
    throw new Error('fixture_replay_reconfigure_unreachable');
  }

  public async open(
    _binding: ProviderSessionBinding,
    command: ProviderRuntimeSpec,
  ): Promise<ExecutionSession> {
    return new FixtureExecutionSession(this.#fixture, command);
  }

  public async closeSession(_binding: ProviderSessionBinding): Promise<void> {}
  public async cancelTurn(
    _binding: ProviderSessionBinding,
    _turnId: RuntimeTurnId,
  ): Promise<void> {}
  public async close(): Promise<void> {}

  public async completeOneShot(): Promise<ExecutionOutput> {
    return this.output();
  }

  private handle(desired: ProviderRuntimeSpec): ProviderSessionHandle {
    return {
      provider: this.#fixture.provider.family,
      model: this.#fixture.provider.model_class,
      providerWorkspaceId: 'fixture-workspace',
      providerSessionId: 'fixture-session',
      session: new FixtureExecutionSession(this.#fixture, desired),
    };
  }

  private output(): ExecutionOutput {
    return {
      provider: this.#fixture.provider.family,
      model: this.#fixture.provider.model_class,
      text: this.#fixture.completion.text,
    };
  }
}

class FixtureExecutionSession implements ExecutionSession {
  public readonly capabilities = sessionCapabilities;
  public constructor(
    private readonly fixture: ProviderFixture,
    _desired: ProviderRuntimeSpec,
  ) {}
  public async run(_input: {
    readonly runId: string;
    readonly prompt: string;
  }): Promise<ExecutionResult> {
    // ExecutionRunInput.runId is the runtime *turn* id, not the product Run id.
    // Record it as turnId so the trace never conflates the two identities.
    recordExecutionTrace({
      module: 'ExecutionSession.run',
      turnId: _input.runId,
      fixtureId: this.fixture.fixture_id,
    });
    return {
      status: 'completed',
      output: {
        provider: this.fixture.provider.family,
        model: this.fixture.provider.model_class,
        text: this.fixture.completion.text,
      },
    };
  }
  public async close(): Promise<void> {}
}
