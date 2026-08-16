import { describe, expect, it } from 'vitest';

import { projectRuntimeSessionState } from './runtime-session-projection.js';

describe('projectRuntimeSessionState', () => {
  it('projects binding, activity and observed availability independently', () => {
    expect(
      projectRuntimeSessionState({
        workspaceBinding: null,
        sessionBinding: null,
        activeRunId: null,
      }),
    ).toEqual({
      binding: 'unbound',
      activity: 'idle',
      availability: 'unknown',
    });

    expect(
      projectRuntimeSessionState({
        workspaceBinding: {
          plane: 'paseo',
          externalWorkspaceId: 'workspace-1',
        },
        sessionBinding: { plane: 'paseo', externalSessionId: 'session-1' },
        activeRunId: 'run-1',
        observedAvailable: true,
      }),
    ).toEqual({
      binding: 'bound',
      activity: 'running',
      availability: 'available',
    });
  });

  it('surfaces partial binding as invalid projection data instead of inventing lifecycle state', () => {
    expect(
      projectRuntimeSessionState({
        workspaceBinding: {
          plane: 'paseo',
          externalWorkspaceId: 'workspace-1',
        },
        sessionBinding: null,
        activeRunId: null,
        observedAvailable: false,
      }),
    ).toEqual({
      binding: 'partial',
      activity: 'idle',
      availability: 'unavailable',
    });
  });
});
