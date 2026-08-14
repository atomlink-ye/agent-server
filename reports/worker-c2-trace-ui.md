# C2 Historical Run Trace UI — worker 收口报告

日期：2026-08-13  
Worker：`4d666c80-7ec9-440b-b50b-448567957b37`

## 结论

C2 生产 UI、recorder-backed browser assertions 与静态 checker 已按任务书完成，本地提交均已落盘，并经同一独立 oracle 最终复审 **ACCEPT**。限定远端证据窗口使用候选 `597386b8e5e6b7bfea962a677eff8d1e0ff0212b`：E5、E7 baseline 及其有效静态红臂成立；E3、E4、E6 与 Work Detail regression 因 runner 没有 Playwright browser executable，均为 **MISSING（exit 1，0 tests）**，不是 FAIL，也不得记 PASS。

本报告写入时共享 frontend 分支 HEAD 已由后续 C3 工作推进至 `eb0c5dd2c1a42191fb7fc14f933dc9101264fe43`。C2 实现收口点为 `e8850f229e31dafa128e97d26c454c4e338c283a`；证据候选 `597386b8…` 包含该收口点。

## Contract hard gate

UI 编辑前已对 Manager B exact SHA `cd57d9d214913f234cdb36552525ed578b21fea5` 执行 hard gate并通过：product-contract export 可解析，以下五个 contract blobs 与 frontend 候选逐一相等。

- `index.ts`: `f179469…`
- `read.ts`: `295bfd…`
- `http.ts`: `e5112…`
- `commands.ts`: `0670…`
- `projection.ts`: `e350…`

真实 Next `15.5.6` build / TypeScript / static resolution 使用 product-contract 成功，exit `0`。权威复核见 `/Volumes/AgentsWorkspace/orgs/0xdtech/tasks/active/agent-server-implementation-20260722/rounds/2026-08-13-refactor-and-web-rebuild/reports/mgr-c-c2-contract-gate.md`。

## C2 commits

- `d1af4d1acd9631508331886e43f73c14c7111d80` — extract Work Detail run trace
- `36cbcfd3731d27f2a80b384ef107dd277ec073d0` — recorder-backed tests/helpers/checkers
- `c06fe9e624e94347be7b896f4d3d166155080a4f` — O-H9 historical trace UI
- `4946eb9fb059e173ad3b31655ea4355c6007d900` — duplicate-sequence-safe Events identity
- `f0023188d6d61e6f17fda740c61b014d460d5bc8` — recorded run/attempt timing context
- `bbba80b289b7910668aebb8a8eb9c1a39ec381ef` — rendered geometry/lane/rework assertions
- `55522021ce806f2bfd10cda0d20702be4ba513c7` — ordinal association and exact timestamp assertions
- `e8850f229e31dafa128e97d26c454c4e338c283a` — exact recorder event status labels

以 Foundation merge `5107b326ecc0b9df102cb69901a23fc5895c4774` 为 base、截止 C2 收口点，并限制到 C2 ownership 的 diffstat：

```text
10 files changed, 1131 insertions(+), 314 deletions(-)
```

未把同区间 Foundation 的 `scripts/foundation/phase-b.mjs` 与 Postgres integration test 计入 C2。

## 限定证据窗口

授权消息：`c347cb92-8cdf-48dd-a41f-9982a9c81a46`。执行前记录 uptime load average `6.56 / 5.85 / 6.20`。候选代码与 contract 只读挂载，使用短命 `docker run --rm`；未 install、未 compose build、未启动 dev server/provider。

| Evidence | 实际结果 | 结论 |
|---|---:|---|
| E3 `run-trace.browser.test.tsx` | exit 1，0 tests | MISSING |
| E4 `events.browser.test.tsx` | exit 1，0 tests | MISSING |
| E5 `check-web-product-identity.ts` | exit 0，`identity_hits=0` | PASS |
| E6 `coverage.browser.test.tsx` | exit 1，0 tests | MISSING |
| E7 `check-trace-coverage-language.ts` | exit 0，`coverage_language_hits=0` | PASS |
| Work Detail regression | exit 1，0 tests | MISSING |

四项 browser 命令在收集到任何 test 前即失败。runner 中 Playwright `1.62.1` 期望：

```text
/opt/playwright-browsers/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell
```

检查的现存 runner images 为 `b0bb4ad4fa4c`、`a1ca5f8d5718`，browser executables 均为 `0`。因此 browser baseline 与对应 browser 红臂保持 MISSING；本轮没有伪报 PASS。

## 静态红臂

- E5：注入 `activity.source_refs.run_id`，checker exit `1`，命中 `technical_identity`。
- E5：注入手写 `"/api/v1/runs/" + runId + "/events"`，checker exit `1`，命中 `handwritten_run_events_path`。
- E7：注入 `Full execution history`，checker exit `1`，命中 forbidden language。
- E7 empty table 首次用 `sed` 的 mutation 误截断 TypeScript，得到 transform/syntax exit `1`；这是**无效 mutation，不计红臂**。
- E7 empty table 精确 retry 将表替换为 `[]`，checker exit `2`，`scanned_files=0`、`missing_inputs=true`；有效红臂成立。

## Raw logs 状态

以下四份机器日志目前**仍仅位于既有 remote sandbox workspace**，本地授权 `artifacts/c2-trace-ui/` 没有这些文件；本报告没有创建空文件或摘要冒充 raw evidence。

- `artifacts/c2-trace-ui/baseline.log`
- `artifacts/c2-trace-ui/red-arms-static.log`
- `artifacts/c2-trace-ui/red-arm-e7-empty-table-retry.log`
- `artifacts/c2-trace-ui/evidence-ledger.txt`

远端窗口结束后曾尝试一次精确宿主机 `scp`，四个路径均返回 `No such file or directory`，未复制任何文件、未启动远端测试。随后已停止研究/尝试 pull。待下一次明确授权窗口，用绑定 `8174cc0c35a44a568688d8492fe15745` 的 `sandbox-ctl pull` artifact-transfer 通道取得；在此之前不得声称本地已有 raw logs。

## Worker 自裁

1. **首次 baseline 日志权限恢复**  
   触发事实：第一次容器命令因 `/evidence/baseline.log: Permission denied` 全部未执行。理由：这是 evidence 目录权限，不是产品失败。对象：仅既有远端授权目录 `/root/workspace/mgr-frontend/artifacts/c2-trace-ui`。恢复：将该目录 chmod `0777` 后重跑一次 baseline。边界：未改候选、contract、依赖或系统其他路径；首次未执行结果不计。

2. **browser 证据停止**  
   触发事实：四个 browser targets 均在 0 tests 时报告同一缺失 executable，两个现存 runner image 也没有 browser。理由：当时窗口明确禁止 install，继续重试不会产生产品证据。对象：E3/E4/E6/detail 与对应 browser 红臂。恢复条件：Manager C 在 W-REC 结束、实测 load 合格后明确触发已授权的 browser 安装窗口；按仓库声明版本安装 browser，不升级 Playwright、不改 package/lock，再先跑每项 red arm 非零，随后才允许 baseline 从 MISSING 转 PASS。边界：既有四项 MISSING 记录不追溯改写。

3. **raw logs 未本地化**  
   触发事实：远端窗口关闭且后续仲裁明确“当前仅继续本地报告/证据收口，不连接或占用远端”。理由：artifact transfer 也需要连接既有 sandbox。对象：上述四份 raw logs。恢复：下一明确授权窗口只做安全 pull。边界：本报告只记已观察摘要，不伪造本地机器证据。

## 未做 / Deferred

- E3/E4/E6/detail baseline 与对应 browser 红臂：MISSING，等待 Manager C 明确触发后续安装/执行窗口。
- 四份 raw logs 本地 pull：等待下一明确远端访问授权。
- 第三份 recorder：按 O-H2 保持 MISSING；未将 `oi38` 负向记录投影为 UI 事实。
- 未 push、未开 PR、未 merge。

## 收口检查

- C2 scoped diff `git diff --check`: exit `0`。
- 独立 oracle 最终结论：**ACCEPT**。
- 报告收口期间未运行 contabo 命令、Docker、测试、build、dev server 或 install。
