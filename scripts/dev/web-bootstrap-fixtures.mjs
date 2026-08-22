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

const mixedTeamModelPolicies = Object.freeze({
  lead: 'free-only',
  fixer: 'claude/deepseek-v4-flash',
  reviewer: 'codex/deepseek-v4-flash',
});

function mixedTeamInstructions(name) {
  if (name === 'lead')
    return `Act directly as Lead using only canonical Team tools. Never spawn, delegate, use provider subagents, or call shell/filesystem tools. Use board_list to read the board first and perform the exact next legal control action, then stop. On an empty board, in this one kickoff turn, use board_create to create exactly two independent Work items in this order and with no dependency_refs: first create exactly one Work assigned to fixer with subject "Implement mixed_team_rework.py" and description exactly "Create a useful self-contained Python utility in repo-root relative mixed_team_rework.py. The first attempt must be 90-130 lines, executable, manually run, and submit marker FIXER_SUBMIT_V1 while deliberately retaining one explicit empty-input acceptance defect for review."; then create exactly one Work assigned to reviewer with subject "Review mixed_team_rework.py" and description exactly "Read and run mixed_team_rework.v1.py, genuinely detect the declared empty-input acceptance defect, and submit marker REVIEW_REJECT with the exact blocking reason." Never call board_create again after this kickoff turn. Do not use board_accept, board_request_changes, or collaboration_finish on the kickoff turn. When reviewer Work is completed with REVIEW_REJECT, use board_accept on reviewer Work and board_request_changes on fixer Work in the same turn, passing the reviewer's exact blocking feedback as feedback. When fixer has a completed FIXER_SUBMIT_V2 attempt, use board_accept on fixer Work. When every Work is accepted and no active attempts remain, call collaboration_finish exactly once. Never repeat successful mutations, invent refs, or substitute prose for a canonical action.`;
  if (name === 'fixer')
    return `HARD GATE: A prose-only turn is invalid; the first assistant block must be a workspace terminal tool call, with no text emitted before tool use. Do not end until both required relative files, mixed_team_rework.py and mixed_team_rework.v1.py, exist and the canonical board_submit call returns success. Act directly as the assigned fixer using canonical Team tools plus the available workspace terminal. Do not create or mutate another Work and do not use provider subagents. Build a useful self-contained JSON token-summary CLI that accepts --text and emits deterministic JSON with count and first_token. Starting from the current working directory, walk parent directories until package.json has name @atomlink-ye/agent-server; never use version-control commands or print an absolute path. For attempt 1, write it to repo-root relative mixed_team_rework.py with about 100 lines (accepted range 90-130), and intentionally implement the acceptance defect by indexing tokens[0], so running --text '' fails with IndexError. Manually run it, copy that exact defective file to mixed_team_rework.v1.py before submitting, compute lines and sha256 for both, and use board_submit with marker FIXER_SUBMIT_V1. After the first submit, stop. On request_changes, locate the same workspace without absolute paths, edit the same file so --text '' succeeds with JSON {"count":0,"first_token":null}, run non-empty and empty cases, recompute line count and sha256, and use board_submit with marker FIXER_SUBMIT_V2. Never use absolute paths in prompts or results, never send messages, and never repeat a successful submit.`;
  return `Act directly as the assigned reviewer using canonical Team tools plus the available workspace terminal. Do not create or mutate another Work and do not use provider subagents. Starting from the current working directory, walk parent directories until package.json has name @atomlink-ye/agent-server; never use version-control commands or print an absolute path. Then read and run repo-root relative mixed_team_rework.v1.py (the preserved first attempt) with --text ''. Genuinely verify the declared tokens[0] defect produces an IndexError, and use board_submit to submit a completed result containing marker REVIEW_REJECT and exact blocking reason: "empty input is mishandled: the utility indexes the first token instead of returning an empty result." Include the relative path and safe run observation. Do not edit either file, do not accept Work, never send messages, and stop after one submit.`;
}

export function mixedTeamAgentYaml(name) {
  // Team collaboration is composed by the runtime, not declared by the author:
  // agent-run-executor strips collaboration refs out of a member's declared
  // tools, and SUPPORTED_MANAGED_AGENT_TOOL_REFS deliberately excludes them.
  // Declaring them here produced Agents that published successfully and then
  // failed to resolve in Chat.
  const refs = [];
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedAgent\nmetadata:\n  name: ${name}\nspec:\n  description: Mixed-provider TeamRun proof role\n  instructions: ${JSON.stringify(mixedTeamInstructions(name))}\n  runtime:\n    provider: paseo\n    modelPolicyRef: ${mixedTeamModelPolicies[name]}\n    mode: isolated\n  tools:${refs.length ? `\n${refs.map((ref) => `    - ref: agent-server/${ref}\n      kind: tool`).join('\n')}` : ' []'}\n  skills: []\n  input:\n    schema:\n      type: object\n      properties: {}\n      additionalProperties: false\n    prompt: "Execute exactly the next legal Team transition for your role."\n  session:\n    invocation: fresh_per_invocation\n    followUps: queued\n    binding: reusable\n  memory:\n    policy: workspace_snapshot\n    proposalLimit: 0\n  permissions:\n    network: read_only\n    filesystem: workspace_read\n  completion:\n    type: executable\n    command: "done"\n`;
}

export function mixedTeamEnvironmentYaml() {
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedEnvironment\nmetadata:\n  name: mixed-provider-proof\nspec:\n  adapter: paseo\n  provider: opencode\n  modelPolicyRef: free-only\n  runtimeCellPolicy: per_runtime_session\n`;
}

export function mixedTeamYaml(lead, fixer, reviewer, environment) {
  return `apiVersion: agent-server/v1alpha1\nkind: ManagedTeam\nmetadata:\n  name: mixed-provider-proof-team\nspec:\n  environmentVersionId: ${environment}\n  lead:\n    name: lead\n    agentVersionId: ${lead}\n  roster:\n    - name: fixer\n      agentVersionId: ${fixer}\n    - name: reviewer\n      agentVersionId: ${reviewer}\n  coordination:\n    taskAssignment: lead_or_self_claim\n`;
}
