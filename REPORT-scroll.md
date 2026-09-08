# 桌面端滚动与中文文案修订报告

根因是固定高度且 `overflow: hidden` 的 `.app-shell` 内，`.sidebar`、`.chat-panel` 与 Work 主区等 grid/flex 子项沿途缺少 `min-height: 0`，默认 `min-height: auto` 让长内容撑出可用高度后被根壳裁剪。

布局约定：根壳继续负责裁剪；受限高度链路上的 grid/flex 子项必须允许收缩（`min-width: 0; min-height: 0`）；唯一承接滚动的局部面板使用 `.scroll-region`（`min-width: 0; min-height: 0; overflow: auto`）。网格的可伸缩列使用 `minmax(0, 1fr)`，避免不可断行内容撑破主区。

改动面板与滚动证据：

- Conversations：`.sidebar-section` 与 `.chat-transcript`。
- Agents：`.agents-list`、`.agents-main`。
- Files：`.files-scope-list`、`.files-file-list`、`.files-main`，并将文件预览网格主列改为 `minmax(0, 1fr)`。
- Work：`.work-list`、`.work-main`、`.work-main-content`；后者覆盖 detail、Run transcript 与 Definition 内容。
- Observe：复用 Work 壳的 `.work-main-content`。
- Tasks 与 Boards：`.work-org-list` 和 `.work-org-content`。
- Whispers：`.whispers-list` 和 `.whisper-message-log`。

浏览器测试固定使用 Chromium 的 1440×900 视口。`apps/web/src/features/work/components/work-list.browser.test.tsx` 将真实 AppShell 挂载到 `/work`，用 48 条真实 Work fixture 断言 `.work-list` 溢出、`scrollTop` 改变，且最终 Work 条目进入可视区。`apps/web/src/features/whispers/WhispersPage.browser.test.tsx` 在真实 WhispersPage 中以 48 个频道和 48 条消息断言 `.whispers-list` 与 `.whisper-message-log` 的同一行为，并验证最后一条真实消息可见。视觉证据为已忽略的 `.local/whispers-scroll-desktop.png`，不提交。旧的 class-only 测试已删除。Settings 页面在当前路由与实现中不存在，因此没有虚构该页面或测试。
`apps/web/src/features/conversations/components/ChatTranscript.browser.test.tsx` 在真实 `.chat-panel` 高度链中渲染 48 条真实对话消息，断言 `.chat-transcript` 溢出、`scrollTop` 变化且最后消息可见；视觉证据为 `.local/conversations-scroll-desktop.png`。`apps/web/src/features/agents/AgentsPage.browser.test.tsx` 在真实 AppShell 中渲染 48 位 Coworker，断言 `.agents-main` 溢出、`scrollTop` 变化且最后一位 Coworker 可见；视觉证据为 `.local/agents-scroll-desktop.png`。截图均已忽略、不提交。

`apps/web/src/features/files/FilesPage.browser.test.tsx` 在真实 FilesPage 中使用 48 个 coworker scope 和 48 个 file entry fixture，按实际 `Request.url`/GET method 匹配 transport 请求，断言 `.files-scope-list` 与 `.files-file-list` 都发生溢出、`scrollTop` 可变，并验证最后一个真实 scope/file 条目进入可视区。视觉证据为已忽略的 `.local/files-scroll-desktop.png`，不提交。
`apps/web/src/features/observe/ObservePage.browser.test.tsx` 在真实 `AppShell → ObservePage` 中使用 `rework-once` Product recording 作为 Trace/Run 基底，并提供 48 个合法 Work/Run 列表项及真实 session-transcripts API mock；按实际 `Request.url`/GET method 匹配 transport 请求，断言 `.work-list` 与真实 `.work-main-content` 都发生溢出、`scrollTop` 可变，且最后一个 Trace 与最终结果内容进入可视区。视觉证据为已忽略的 `.local/observe-scroll-desktop.png`，不提交。

`apps/web/src/features/work-organization/TasksPage.browser.test.tsx` 在真实 `AppShell`/`MemoryRouter`/`TasksPage` 中使用 48 个实际 WorkItem detail 响应，断言 `.work-org-list` 的 `scrollHeight > clientHeight`、`scrollTop` 可变，并验证最后一个真实 Task 进入列表可视区。视觉证据为已忽略的 `.local/tasks-scroll-desktop.png`，不提交。

`apps/web/src/features/work-organization/BoardsPage.browser.test.tsx` 在真实 `AppShell`/`MemoryRouter`/`BoardsPage` 中使用 48 个 Board 响应及 8 个真实列/Card placement 响应，断言 Board 列表的 `scrollHeight > clientHeight`、`scrollTop` 可变并验证最后一个真实 Board 可见；同时断言 `.work-board-canvas` 的 `scrollWidth > clientWidth`、`scrollLeft` 可变，并验证末列的真实 Card 可见。视觉证据为已忽略的 `.local/boards-scroll-desktop.png`，不提交。

中文文案按三组修订：一是统一保留 Work、Run、Board、Workspace、Agent、Coworker、Definition、Capability 等产品对象，同时去除重复或不自然的拼接；二是把任务、Board、Work 状态、Trace 与 Observe 的操作说明改为直接、可执行的中文；三是重写 Coworker 创建、Capability 编写和验证错误提示，减少机译式句法并明确用户下一步。英文词典键和中英文键结构未变。

实际运行的命令：

- `pnpm exec vitest run --config vitest.web.config.ts apps/web/src/features/work-organization/TasksPage.browser.test.tsx apps/web/src/features/work-organization/BoardsPage.browser.test.tsx`：通过，25 个 Chromium 测试（Tasks 10、Boards 15）；生成已忽略的 `.local/tasks-scroll-desktop.png` 与 `.local/boards-scroll-desktop.png`。
- `pnpm typecheck`：通过，包含根类型检查和 Web 类型检查。
- `pnpm exec vitest run --config vitest.web.config.ts apps/web/src/features/whispers/WhispersPage.browser.test.tsx apps/web/src/features/work/components/work-list.browser.test.tsx`：通过，6 个 Chromium 测试。
- `pnpm exec vitest run --config vitest.web.config.ts apps/web/src/features/conversations/components/ChatTranscript.browser.test.tsx apps/web/src/features/agents/AgentsPage.browser.test.tsx`：通过，11 个 Chromium 测试；生成已忽略的 `.local/conversations-scroll-desktop.png` 与 `.local/agents-scroll-desktop.png`。
- `pnpm exec vitest run --config vitest.web.config.ts apps/web/src/features/files/FilesPage.browser.test.tsx`：通过，1 个 Chromium 测试；生成已忽略的 `.local/files-scroll-desktop.png`。
- `pnpm exec vitest run --config vitest.web.config.ts apps/web/src/features/observe/ObservePane.browser.test.tsx apps/web/src/features/observe/ObserveDetail.browser.test.tsx apps/web/src/features/observe/ObservePage.browser.test.tsx`：通过，6 个 Chromium 测试；生成已忽略的 `.local/observe-scroll-desktop.png`。
- `pnpm typecheck`：通过。
- `pnpm web:check:types`：通过。
- `pnpm test:web`：通过，49 个测试文件、266 个测试；运行时输出了既有 BoardCanvas 和 AdvancedDefinitionAuthoring 的 `act(...)` 警告，但无失败。实际基线不是要求中提到的 43 个文件、252 个测试。
