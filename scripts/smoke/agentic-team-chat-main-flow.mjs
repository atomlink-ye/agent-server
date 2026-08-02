// Real retained smoke entry point. It delegates to the existing provisioned
// API harness until the Agentic scheduler is wired into server construction.
import { spawn } from 'node:child_process';
const child = spawn(
  process.execPath,
  ['scripts/smoke/self-learning-team-phase3-main-flow.mjs'],
  { stdio: 'inherit', env: { ...process.env, AGENTIC_TEAM_SMOKE: '1' } },
);
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
