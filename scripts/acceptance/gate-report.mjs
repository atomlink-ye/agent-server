// 🔴 独立模块，⛔ 不许 import 任何东西。
// 理由：phase0-browser.mjs 是在浏览器容器里跑的，容器内【没有 git】
// （判据：`docker run --rm agent-server-web-testing:r2 bash -lc 'git --version'`
//  → `git: command not found`），也没有仓库工作树。
// 所以浏览器那道闸门不可能在容器内自己求值 checkPreconditions —— 那需要 git。
// 它改为核验 driver 已经求过值、并挂载进来的那份报告。
//
// ⚠️ 这【不是】把闸门放宽成"信任一个文件"：
// preconditions.mjs 的注释已经写明它本来就不是执行完整性边界（作者自证在那里无效）。
// 这道闸门要挡的是【无意中】把浏览器入口单独拿来跑而绕过前面的检查；
// 现在要绕过它，得同时伪造报告内容与 head，且伪造物会落进证据。

export function assertGateReport(report, expectedHead) {
  if (report === null || typeof report !== 'object') {
    throw new Error('acceptance gate report is not an object — the browser entry point may not issue product commands');
  }
  if (report.ok !== true) {
    throw new Error(
      `acceptance gate report is not ok (HEAD=${report.head ?? '<none>'}, failed=${(report.failed ?? []).join(', ') || '<unreported>'}) — the browser entry point may not issue product commands`,
    );
  }
  if (typeof report.head !== 'string' || report.head.trim() === '' || report.head === 'unavailable') {
    throw new Error(`acceptance gate report carries no usable HEAD (${report.head ?? '<none>'})`);
  }
  if (report.dirty !== 'no') {
    throw new Error(`acceptance gate report was produced against a dirty worktree (dirty=${report.dirty ?? '<none>'})`);
  }
  if (Array.isArray(report.failed) && report.failed.length > 0) {
    throw new Error(`acceptance gate report lists failures: ${report.failed.join(', ')}`);
  }
  if (typeof expectedHead !== 'string' || expectedHead.trim() === '') {
    throw new Error('expected HEAD was not supplied to the browser gate');
  }
  if (report.head !== expectedHead) {
    throw new Error(
      `acceptance gate report HEAD=${report.head} does not match the HEAD this run was launched for (${expectedHead}) — the report belongs to a different device`,
    );
  }
  return report;
}
