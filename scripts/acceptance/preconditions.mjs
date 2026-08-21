import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { latestRuntimeInitialized, assertProviderEffect } from './assertions.mjs';

const run = promisify(execFile);

// P1/P2/P3 运行时闸门。
//
// 🔴 这个闸门【不是】执行完整性边界，⛔ 不要这样描述它（Auditor finding-1-8861bd03）。
// Auditor 实测：把 assertPreconditions 改成 return 而不是 throw 之后，
// checkPreconditions 照样报 ok=false failed=[CLEAN]，但没有任何东西阻止后续产品调用。
// git status 是【对已跟踪文件的篡改证据】，不是执行完整性边界：
// 被 ignore 的依赖/配置、以及被改写的执行函数本身，都在它能阻止的范围之外。
//
// 它能做的：防止【无意中】拿一套过期或未提交的装置去跑产品命令，并把当次求值的
// HEAD/dirty 状态写进证据。它不能做的：抵抗对装置本身的修改。
// ⇒ 真正的完整性控制是【外部审计】，不是这段代码。作者自证在这里无效。
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

  // 🔴 脏树守卫（Auditor finding-1-24209abe(1)）：不查 git status 时，
  // report 里的 HEAD 对一棵脏树就是【谎话】—— 它记 HEAD=X，实际求值的是被改过的字节。
  // 一个保留 P1/P2/P3 的脏改动会得到 ok=true + head=X，为另一套装置背书。
  let head = 'unavailable';
  let dirty = 'unknown';
  try {
    head = (await run('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD'])).stdout.trim();
    const st = (await run('git', ['-C', repoRoot, 'status', '--porcelain'])).stdout.trim();
    dirty = st === '' ? 'no' : st.split('\n').length + ' path(s)';
    record('CLEAN', st === '', st === '' ? 'worktree clean' : `worktree dirty: HEAD is not what runs — ${dirty}`);
  } catch (e) {
    record('CLEAN', false, `cannot determine worktree state: ${e.message}`);
  }

  const failed = results.filter((r) => !r.ok);
  return { head, dirty, results, ok: failed.length === 0, failed: failed.map((r) => r.id) };
}

export function assertPreconditions(report) {
  if (!report.ok) {
    throw new Error(`acceptance preconditions failed at HEAD=${report.head}: ${report.failed.join(', ')} — no product command may be issued`);
  }
}
