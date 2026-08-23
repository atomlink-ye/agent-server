import { describe, expect, it } from 'vitest';

import { UnsupportedCapabilityError } from '../ports/runtime-execution-session.js';
import {
  requirePlaneCapability,
  requireSessionCapability,
} from './execution-capabilities.js';

describe('execution capability negotiation', () => {
  it('accepts advertised Plane and Session capabilities', () => {
    expect(() =>
      requirePlaneCapability(
        { supported: new Set(['streaming']) },
        'streaming',
      ),
    ).not.toThrow();
    expect(() =>
      requireSessionCapability(
        { supported: new Set(['reasoning_stream']) },
        'reasoning_stream',
      ),
    ).not.toThrow();
  });

  it('fails explicitly when a required capability is absent', () => {
    expect(() =>
      requirePlaneCapability({ supported: new Set() }, 'timeline_replay'),
    ).toThrow(UnsupportedCapabilityError);
    expect(() =>
      requireSessionCapability({ supported: new Set() }, 'rewind'),
    ).toThrow(UnsupportedCapabilityError);
  });
});
