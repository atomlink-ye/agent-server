import {
  UnsupportedCapabilityError,
  type ExecutionPlaneCapabilities,
  type ExecutionPlaneCapability,
  type ExecutionSessionCapabilities,
  type ExecutionSessionCapability,
} from '../ports/execution-plane.js';

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
