export function managedAgentYaml() {
  return `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: managed-environment-smoke
spec:
  description: Platform Extension Smoke
  instructions: When asked to read Memory, use the authorized platform Tool and return only the Tool content with no label, explanation, quotes, markdown, or punctuation.
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools:
    - ref: agent-server/memory-read
      kind: tool
  skills:
    - ref: agent-server/memory-api
  input:
    schema:
      type: object
      properties: {}
      additionalProperties: false
    prompt: "Use the authorized memory extension."
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 0
  permissions:
    network: read_only
    filesystem: workspace_read
  completion:
    type: executable
    command: "done"
`;
}

export function managedEnvironmentYaml() {
  return `apiVersion: agent-server/v1alpha1
kind: ManagedEnvironment
metadata:
  name: managed-environment-smoke
spec:
  adapter: paseo
  provider: opencode
  modelPolicyRef: free-only
  runtimeCellPolicy: per_runtime_session
`;
}
