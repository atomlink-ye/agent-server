import {
  type ExecutionPlaneCapabilities,
  type ExecutionPlaneCapability,
} from '../ports/execution-plane.js';
import {
  UnsupportedCapabilityError,
  type ExecutionSessionCapabilities,
  type ExecutionSessionCapability,
} from '../ports/runtime-execution-session.js';

export function requirePlaneCapability(
  capabilities: ExecutionPlaneCapabilities,
  capability: ExecutionPlaneCapability,
): void {
  if (!capabilities.supported.has(capability))
    throw new UnsupportedCapabilityError(
      `Execution Plane capability ${capability} is unavailable.`,
    );
}

export function requireSessionCapability(
  capabilities: ExecutionSessionCapabilities,
  capability: ExecutionSessionCapability,
): void {
  if (!capabilities.supported.has(capability))
    throw new UnsupportedCapabilityError(
      `Execution Session capability ${capability} is unavailable.`,
    );
}
