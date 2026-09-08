# Computer 层缺口：落地分析

本篇不重复 `DESIGN-isolation.md`（Cumora 五层隔离设计研读笔记，任务目录
`tasks/active/demo-20260907/`，本仓库外，只读）已经写过的结论——它把
Company/Participant/Computer/Pod/Workspace/Token 六层过了一遍，判断"Computer 层"
是我们缺的、但当前演示用不到、故意不做。本篇的任务是把"以后要做"变成
"下一轮具体做什么"：给出可核实的现状引用、一个能在一轮内做完并验证的最小切片、
以及明确的非目标。

所有 Cumora 引用均于 2026-09-08 用 Explore 子代理逐条核对源码后收录，
行号对应当时的 `refcode/cumora` 状态（只读参考实现，不会随本仓库演进）。

## 一、Cumora 实际怎么做的

### 1.1 `computers` 表

`refcode/cumora/server/src/db/migrate.ts:1578` 起：

```sql
CREATE TABLE IF NOT EXISTS computers (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL,
  owner_user_id     TEXT,                                  -- NULL for the managed Cumora Cloud row
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL,                         -- 'cloud' | 'local' | 'vps'
  available_engines JSONB NOT NULL DEFAULT '[]'::jsonb,
  status            TEXT NOT NULL DEFAULT 'offline',       -- 'online' | 'offline' | 'busy'
  last_seen_at      TIMESTAMP WITH TIME ZONE,
  credential_hash   TEXT,                                  -- SHA256 of the device token; NULL for cloud
  paired_at         TIMESTAMP WITH TIME ZONE,
  revoked_at        TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

`company_id` / `owner_user_id` 都是纯 TEXT 软引用，没有 FK——和该 schema 的一贯风格一致。
后续 `ALTER TABLE`（同文件 1595/1600/1622/1629-1631 行）陆续加了
`daemon_version`、`daemon_supervised`、`pair_token`、`detected_engines`、
`engines_detected_at`、`detect_requested_at`，属于 BYOA 配对协议的实现细节，
不改变核心形状。

### 1.2 Agent → Computer 的绑定点

同文件 1605 行：`ALTER TABLE participants ADD COLUMN IF NOT EXISTS computer_id TEXT;`——
同样没有 FK。约束靠应用层触发器而不是数据库约束：
`refcode/cumora/server/src/db/migrations/0004-agent-runtime-assignment.ts:20,30`
在 `BEFORE UPDATE OF company_id, computer_id, kind, departed_at ON participants` 上挂钩子。
`computer_id` 为 NULL 或指向 kind='cloud' 的行 = 托管 Pod；指向 local/vps 的行 = BYOA，不起 Pod。

### 1.3 放置决策发生在哪一层

**人工调用一个 API，不是调度器自动分配。**
`refcode/cumora/server/src/api/router.ts:1208`：`POST /agents/:id/computer`
（仅 owner/admin，经 `requireCompanyRole`），调用
`refcode/cumora/server/src/agents/computer/registry.ts:976-999` 的
`assignAgentToComputer`，其中引擎/kind 解析委托给 `resolveComputerAssignment`
（929-969 行），落地为 `UPDATE participants SET computer_id = $1, engine = $2, ...`
（991 行）。
另有一条自动路径：配对新机器时，`router.ts:1265-1274` 会把"游离态"的免费层 Agent
自动收编到刚配对的机器上（`WHERE NOT EXISTS (non-cloud, non-revoked computer)`）。
**没有发现基于负载或调度策略的自动再平衡** ——放置决策目前就是"谁配对了谁"，
不是复杂调度系统。这个事实很重要：我们不需要在第一版里设计调度器。

### 1.4 Pod 生命周期由谁拥有

`refcode/cumora/server/src/agents/runtime/pod-agent.ts` 头部注释即生命周期设计
（boot → SSE `/runtime/wake-stream` → 无条件 `drain()` 一次 → 循环等 `wake` 事件 →
idle 计时器到期 `status='resting'` 退出 → SIGTERM 收尾）。
"串行化是进程模型的自然结果"这句话不只是注释，代码上能对上号：
`drain()`（68-91 行）用一个 `state.busy` 标志 + `do…while(state.pendingRerun)` 循环，
同一进程内不存在并发 `runAgentTurn`；SIGTERM/SIGINT 处理在 277-278 行
(`process.on('SIGTERM', () => { void gracefulExit('SIGTERM', null) })`)。

### 1.5 隔离边界落在哪几个文件（对照用）

- `refcode/cumora/server/src/agents/runtime/fs-namespace.ts`：`hydrate()`（44-47 行）
  直接返回 `/workspace`，`commit()`/`teardown()`（52-58 行）是空操作——因为工作区
  是 `agent_workspace` 表行的 FUSE 挂载，"one workspace per agent, not per run"。
- `refcode/cumora/server/src/agents/runtime/authorization.ts`：`isRuntimeAgentAuthorized`
  （12-32 行）用 `participants`/`computers` 的 LEFT JOIN，检查
  `c.revoked_at IS NULL AND p.departed_at IS NULL`——token 只是铸造时的快照，
  真相永远回数据库查活行。

## 二、我们现在实际怎么做的

### 2.1 `RuntimeSession` 绑在什么上

`src/domain/runtime/runtime-session.ts:52-62`：

```ts
export interface RuntimeSession {
  readonly id: RuntimeSessionId;
  readonly owner: RuntimeSessionOwner;
  readonly scope: RuntimeScope;
  readonly desiredSpecRevision: RuntimeSpecRevision;
  readonly currentGenerationId: RuntimeGenerationId | null;
  readonly status: RuntimeSessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
}
```

`RuntimeSessionOwner`（同文件 41-46 行）只有 `tenantId` / `workspaceId` /
`principalType` / `principalId`。`RuntimeScope`（18-39 行）是按 `kind`
（`agent_chat` / `team_member` / `product_session` / `task` / `run`）区分的联合类型。
**没有任何字段表示"这次运行在哪台机器上"**——provider/model 在
`RuntimeSessionSpec`（`src/domain/runtime/runtime-session-spec.ts:20-52`），
generation 状态在 `RuntimeSessionGeneration`
（`src/domain/runtime/runtime-session-generation.ts:11-25`），都不含
host/machine/computer 语义的字段。

### 2.2 provider session 在哪里创建

`src/infrastructure/runtime/paseo/paseo-runtime-provider.ts` 的 `PaseoRuntimeProvider`
（构造函数约 104 行起）组合了 `PaseoConnectionManager` / `PaseoGateway` /
`PaseoTurnRunner` / `PaseoSdkClient`（均在 `src/adapters/paseo/` 下）。
真正"起一个 provider 进程"的调用是 `PaseoGateway.createWorkspace`/`createAgent`
（`src/adapters/paseo/paseo-gateway.ts:40,57`），委托给
`PaseoSdkClient.createWorkspace`/`createAgent`
（`src/adapters/paseo/paseo-sdk-client.ts:70,100,113`）。
这个 SDK client 通过 WebSocket 连接外部 Paseo 守护进程
（`PASEO_WS_URL`，默认 `ws://127.0.0.1:6767/ws`，`src/shared/config.ts:161`）——
**真正的 CLI/进程拉起动作在仓库之外，属于 Paseo 自己**。传给它的只有
`cwd`、`provider`、`model`、`env`，没有"这次跑在哪台机器"的参数。

### 2.3 隔离边界当前落在哪几个文件

- **provider home / HOME 覆盖**：`src/infrastructure/runtime/paseo/paseo-config-mapper.ts:44-63`
  的 `sessionEnvironment()` 构造 `{ CODEX_HOME, HOME: providerHome, CLAUDE_CODE_OAUTH_TOKEN }`，
  取自单一全局配置对象——**不区分 Agent，也不区分租户**。配置来源
  `src/shared/config.ts:176-188`（`CODEX_HOME` / `PASEO_PROVIDER_HOME` /
  `CLAUDE_CODE_OAUTH_TOKEN`），整个部署共用一份值。
- **cwd / 工作目录**：这里需要**修正** `DESIGN-isolation.md` 里"全局共用
  `.local/agent-workspace`"的判断——那是一个已经被修好的历史状态，不是当前状态。
  当前实现是"一个共享根 + 按 `agentDefinitionId` 分子目录"：
  - 根目录默认值 `PASEO_AGENT_CWD = .local/agent-workspace`
    （`src/shared/config.ts:166`，绝对路径解析在 `src/shared/config.ts:468`）。
  - 分目录函数 `agentWorkspaceCwd(root, agentDefinitionId)`——
    `src/application/agents/agent-workspace-cwd.ts:18-24`，返回 `join(root, agentDefinitionId)`。
  - 调用点 `src/adapters/chat/execution-runtime-chat-turn-provider.ts:79`：
    `cwd: agentWorkspaceCwd(this.configuration.cwd, input.agentDefinitionId)`。
  - `agent-workspace-cwd.ts:4-16` 的注释原话就是在描述
    `DESIGN-isolation.md` 提到的那个 bug（"两个 Coworker 同时工作会看到、
    覆盖、引用对方的文件"），并说明修复方式：按 Agent 定义 id 分目录，
    因为这个 id 比 run/version/provider session 都长寿。
  - **但分目录的维度是 `agentDefinitionId`，不是租户或 Computer**。
    两个不同租户的 Agent 之所以落在不同目录，纯粹因为它们的 `agentDefinitionId`
    不同，不是因为有租户级的目录前缀逻辑。这一点在往 Computer 层设计时要注意：
    "一个 Agent 一个目录"已经有了，"一个 Computer 一个命名空间"还没有。
- **凭据/密钥作用域**：没有发现按 Agent 或按租户的 vault 查找。
  只有全局环境变量注入的 `CLAUDE_CODE_OAUTH_TOKEN`（同一份值注入每个 session，
  `paseo-config-mapper.ts:56-58`）。`src/infrastructure/runtime` 和
  `src/adapters/paseo` 下没有 `vault` / 按租户区分的 `apiKey` 逻辑。

上述隔离边界分散在这些文件里（`DESIGN-isolation.md` 没有点名，这里补上）：
`src/shared/config.ts`、`src/infrastructure/runtime/paseo/paseo-config-mapper.ts`、
`src/infrastructure/runtime/paseo/paseo-runtime-provider.ts`、
`src/application/agents/agent-workspace-cwd.ts`、
`src/adapters/chat/execution-runtime-chat-turn-provider.ts`、
`src/infrastructure/runtime/agent-workspace-root.ts`。
另外 `src/domain/agents/agent-home.ts` 是一个容易混淆但完全不同的"home"概念——
一个带命名空间的键值存储（definition/organization/space/agent-shared/user/
conversation/work/scratch），用于 Agent 记忆类内容，跟 provider 进程的
`HOME` 环境变量或文件系统 cwd 无关，写 Computer 层设计时不要把两者混在一起。

### 2.4 schema/domain 里目前完全没有"机器"概念

对 `src/infrastructure/postgres/migrations/*.sql`（0001-0071 全部）和
`src/domain/**` 做大小写不敏感检索 `machine|host|computer|node|vm|hypervisor`
——**零命中**。当前最大 migration 编号是 `0071`
（`src/infrastructure/postgres/migrations/0071_workspace_member_display_name.sql`）。

Agent 的稳定身份定义在 `agent_definitions` 表
（`src/infrastructure/postgres/migrations/0003_sequential_team_mvp.sql:3-14`）：

```sql
CREATE TABLE IF NOT EXISTS agent_definitions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  name text NOT NULL,
  description text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT agent_definitions_updated_after_created_check CHECK (updated_at >= created_at),
  UNIQUE (id, tenant_id, workspace_id, principal_type, principal_id)
);
```

这张表对应的领域类型是 `AgentDefinition`（`src/domain/agents/managed-agent-definition.ts:4-12`），
这是唯一一个"活得比 run/version/provider session 都长"的身份——也正是
`agentWorkspaceCwd` 已经在用来分目录的那个 id。**这意味着 Computer 层最自然的
挂载点是 `agent_definitions`，不是 `RuntimeSession`**：RuntimeSession 随
generation 走马灯式重建，`agent_definitions` 才是 Cumora 里 `participants` 的
对应物。

## 三、最小可落地的第一步（MVE，一轮内可验证）

**目标**：让"Computer"从"零概念"变成"一个真实存在、可查询、并且真的影响一个
可观察路径的类型"——但不做配对协议、不做真实 VPS、不做调度。

### 改什么

1. **新 migration** `src/infrastructure/postgres/migrations/0072_agent_computers.sql`：
   ```sql
   BEGIN;

   CREATE TABLE IF NOT EXISTS computers (
     id uuid PRIMARY KEY,
     tenant_id text NOT NULL,
     workspace_id text NOT NULL,
     kind text NOT NULL CHECK (kind IN ('cloud', 'local', 'vps')),
     name text NOT NULL,
     status text NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'offline')),
     created_at timestamptz NOT NULL,
     updated_at timestamptz NOT NULL,
     CONSTRAINT computers_updated_after_created_check CHECK (updated_at >= created_at)
   );

   ALTER TABLE agent_definitions
     ADD COLUMN computer_id uuid NULL REFERENCES computers(id);

   COMMIT;
   ```
   跟随本仓库既有风格：`tenant_id`/`workspace_id` 为文本软字段（对齐
   `agent_definitions` 自己的写法），用 `updated_after_created` check 约束
   （对齐 0003/0071 的既有约定），不在 migration 里塞种子数据。
   `computer_id` 允许为 NULL——代表"未分配，走默认共享 runtime"，向后兼容现有行。

2. **新领域类型** `src/domain/runtime/computer.ts`：
   ```ts
   export type ComputerKind = 'cloud' | 'local' | 'vps';
   export interface Computer {
     readonly id: string;
     readonly tenantId: string;
     readonly workspaceId: string;
     readonly kind: ComputerKind;
     readonly name: string;
     readonly status: 'online' | 'offline';
     readonly createdAt: string;
     readonly updatedAt: string;
   }
   ```
   `AgentDefinition`（`src/domain/agents/managed-agent-definition.ts:4-12`）
   增加 `readonly computerId: string | null;`。

3. **让它影响一个真实可观察的行为**：把 `agentWorkspaceCwd`
   （`src/application/agents/agent-workspace-cwd.ts:18-24`）的签名从
   `(root, agentDefinitionId)` 改成 `(root, agentDefinitionId, computerId)`，
   返回 `join(root, computerId ?? 'default', agentDefinitionId)`。
   这一步直接对应 Cumora 语义里"Computer 决定 Agent 的执行落点"——
   即使我们仍然只有一个物理 runtime，目录命名空间也应该先按 Computer 分层，
   这样以后接入真实多机时不需要再动路径结构。
   调用点 `src/adapters/chat/execution-runtime-chat-turn-provider.ts:79`
   同步传入 `input.computerId ?? null`。

### 怎么证明它真的生效

```bash
pnpm typecheck 2>&1 | tail -20
pnpm db:migrate 2>&1 | tail -20   # 若仓库脚本名不同，用 psql -f 直接跑该 migration
psql "$DATABASE_URL" -c "\d agent_definitions" | grep computer_id
psql "$DATABASE_URL" -c "\d computers"
pnpm vitest run src/application/agents/agent-workspace-cwd.test.ts
```
新增一个 `agent-workspace-cwd.test.ts` 用例：断言
`agentWorkspaceCwd('/root', 'agent-1', 'computer-1') === '/root/computer-1/agent-1'`
且 `agentWorkspaceCwd('/root', 'agent-1', null) === '/root/default/agent-1'`。
这是一个纯函数测试，不需要数据库、不需要起 dev server，一轮内可以跑完并给出
确定性的 pass/fail。

**判据**：这一步做完后，"Computer"从"文档里的概念"变成"schema 里一张真实的表
+ 一个真实分叉的文件系统路径"，但完全不涉及配对协议、不涉及真实多机、
不改变任何运行时行为（默认路径行为不变，只是多了一层 `default/` 目录）。
这是故意的——先把类型形状和挂载点定下来，下一轮再谈真正的放置逻辑。

## 四、明确的非目标（这一版不做，及原因）

- **真实 VPS / 本地设备配对（BYOA 配对协议）**：Cumora 用 `pair_token` +
  `credential_hash` + 守护进程做设备配对（`db/migrate.ts` 1600/1622 行附近的
  ALTER TABLE）。我们目前没有任何用户会把自己的机器接进来，做这层没有真实用户
  验证，纯粹是猜测接口形状——违反 MVE 原则。
- **Pod / 进程编排（一 Agent 一常驻进程）**：Cumora 的串行化是"一 Agent 一 K8s
  Pod"这个进程模型的自然结果（1.4 节）。我们跑在 Paseo 共享 runtime 上，
  要不要、以及如何让"串行化"也变成进程模型的自然结果，是一个运行时提供方层面
  的决策，跟"有没有 Computer 表"是两个独立问题，混在一轮里做风险太大。
  **本文没有验证我们当前的 RuntimeSession/generation 机制是否已经在语义上保证了
  同一 Agent 的串行化**——这是需要单独确认的假设，见下节。
- **跨机调度 / 自动再平衡**：连 Cumora 自己都没有这个——1.3 节确认了它的放置
  决策就是"谁配对了谁"，没有发现负载调度逻辑。我们不应该在参考实现都还没做的
  地方抢跑。
- **放置 API/UI**（对应 Cumora 的 `POST /agents/:id/computer`）：第一步只加
  schema 和类型，不加可写路径。开放一个能改变 Agent 执行位置的 API 需要认证/
  权限设计和端到端测试，是下一轮的工作，不属于"一轮内可验证的最小切片"。
- **按 Computer 做凭据/密钥隔离**：Cumora 的 `credential_hash` 是配对协议的一
  部分。我们现在全局共用 `CLAUDE_CODE_OAUTH_TOKEN`（2.3 节），要不要因为
  Computer 概念的引入而重新设计凭据作用域，属于安全设计问题，不应该顺带在一个
  schema 切片里做掉。

## 我没验证到的部分 / 我的假设

- **读代码推断，未实跑**：本文第三节提出的 migration SQL、领域类型、
  `agentWorkspaceCwd` 签名改动均未在本次任务中实际写入 `src/`（任务边界要求
  只产出这一份 markdown，不改产品代码），因此没有跑过
  `pnpm typecheck` / `pnpm vitest` 来验证这段代码本身。已跑过的是本文档
  自身的 `pnpm typecheck` 和 `pnpm docs:check`（结果见交付说明）。
- **`RuntimeSession` 是否已经保证同 Agent 串行化**：读了
  `runtime-session.ts` / `runtime-session-generation.ts` 的类型定义，
  但没有读执行调度那一层（`PaseoTurnRunner` 内部）去确认两个并发到达的
  turn 请求是否会被序列化。这是"非目标"一节里提到的假设，留给下一轮验证，
  不应该被当作已确认的事实。
- **Cumora 的 6 条引用**：由 Explore 子代理逐条读取源码验证，行号和代码片段
  与 `DESIGN-isolation.md` 原文完全一致，无出入。
- **本仓库的隔离边界文件清单（2.3 节）**：由 Explore 子代理检索 + 我本人抽查
  `runtime-session.ts`、`agent-workspace-cwd.ts`、`0071` migration 三个文件
  核实无误。`agentWorkspaceCwd` 已经修复"全局共享目录"这一点是本文与
  `DESIGN-isolation.md` 唯一的事实性修正，务必在下一轮设计时采用本文的现状
  描述而不是旧笔记的描述。
