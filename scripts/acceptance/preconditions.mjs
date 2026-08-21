import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { latestRuntimeInitialized, assertProviderEffect } from './assertions.mjs';

const run = promisify(execFile);

// P1/P2/P3 运行时闸门。
// 🔴 它取代了"授权书里挂一个 HEAD 快照"的做法：携带 HEAD 的授权是一张证书，
// 而证书必然随装置移动而过期（R4 里连续过期了两次，两次都被 Auditor 抓到）。
// 闸门在每次运行时、在它自己当前的 HEAD 上求值，
// 所以"授权对应的装置"与"实际运行的装置"由构造保证同一。
// ⛔ 不许用"某次跑过了"替代"这一次跑了"。
export async function checkPreconditions(repoRoot) {
  const results = [];
  const record = (id, ok, detail) => { results.push({ id, ok, detail }); return ok; };

  // P1 · parser 对真实 JSON 日志字面串（真实字面串带引号: "event":"runtime.initialized"）
  try {
    const log = ['noise', JSON.stringify({ event: 'runtime.initialized', provider: 'claude', model: 'm1' })].join('\n');
    const r = latestRuntimeInitialized(log);
    record('P1', r.provider === 'claude' && r.model === 'm1', JSON.stringify(r));
  } catch (e) { record('P1', false, `unexpected red: ${e.message}`); }

  // P2(a) · provider 不匹配必须显式红
  const p = { runtime_adapter: 'paseo', runtime_provider: 'opencode', runtime_model: 'x/m1' };
  try {
    assertProviderEffect({ agentServer: p, paseoRuntime: p, runtimeInitialized: { provider: 'opencode', model: 'm1' }, expectedProvider: 'claude' });
    record('P2a', false, 'FALSE-GREEN: provider mismatch was accepted');
  } catch (e) { record('P2a', e.message.includes('provider effect mismatch'), e.message); }

  // P2(b) · 缺失/空 必须红成"未观察到"，⛔ 不许伪装成 json 解析错误
  for (const [label, input] of [['other-event', '{"event":"service.started"}'], ['empty', ''], ['blank', '   \n  ']]) {
    try {
      latestRuntimeInitialized(input);
      record(`P2b/${label}`, false, 'FALSE-GREEN: absence was accepted');
    } catch (e) { record(`P2b/${label}`, e.message.includes('did not observe runtime.initialized'), e.message); }
  }

  // P3 · selftest 必须 rc=0，对偶清单即时读取，⛔ 不引用历史快照
  try {
    const { stdout } = await run('node', ['scripts/acceptance/selftest.mjs'], { cwd: repoRoot });
    const duals = stdout.split('\n').filter((l) => l.startsWith('PASS mutation'));
    record('P3', duals.length > 0, `selftest rc=0, ${duals.length} duals: ${duals.map((d) => d.replace('PASS mutation ', '')).join(', ')}`);
  } catch (e) { record('P3', false, `selftest rc=${e.code ?? 'n/a'}`); }

  let head = 'unavailable';
  try { head = (await run('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD'])).stdout.trim(); } catch { /* 非 git 树时保持 unavailable */ }

  const failed = results.filter((r) => !r.ok);
  return { head, results, ok: failed.length === 0, failed: failed.map((r) => r.id) };
}

export function assertPreconditions(report) {
  if (!report.ok) {
    throw new Error(`acceptance preconditions failed at HEAD=${report.head}: ${report.failed.join(', ')} — no product command may be issued`);
  }
}
