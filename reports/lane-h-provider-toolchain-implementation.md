# Lane H — provider toolchain implementation

日期：2026-08-13。分支：`round/2026-08-13-lane-h`。

## 结论

本轮把应用依赖与环境工具链拆开：应用 workspace 只保留源码真正 import 的
`@getpaseo/client`；`@getpaseo/cli`、它的 frozen lock 和 server patch 进入独立
workspace；OpenCode、Claude Code、Codex 改为由提交进 git 的 exact-version manifest
按不可变 URL、artifact SHA-256、installed-binary SHA-256 填入 stamp-keyed 持久卷。
init 是单写者，staging 完整验过才原子发布，应用容器只读挂载。

Owner 后续指出的 pnpm 根因也已先修：应用 install 使用 BuildKit cache mount，mount
显式归属 uid/gid 1000，并用 `--store-dir /pnpm/store` 保证内容寻址 store 真正在层外。
Paseo server patch 随工具链域走；以后改 patch 不再修改应用 lockfile，也不会触发应用
依赖层失效。

## 代码改动

- `Dockerfile`：应用 install 加 BuildKit pnpm store cache；移除三个 provider npm 安装；
  development image 只复制 toolchain authority/运行解析器。
- `provider-toolchain/`：独立 pnpm workspace、frozen lock、server patch、exact manifest、
  `flock` + staging + atomic release 的 init/status/validate/attach 入口。
- `scripts/dev/docker-compose` / `compose.yaml`：工具链 digest 进入 external volume 名；init
  服务读写，agent/web/runner 只读；进入真实命令前先完成 init。
- `scripts/dev/resolve-provider.mjs`：只按 `PATH`/显式 binary env 解析，不回退
  `node_modules`；Paseo/OpenCode 和四个真实 smoke 的版本证据均走真实 CLI。
- `scripts/dev/paseo-process.mjs`：同 hostname 的 PID 还必须存活且 `/proc` 身份为 Paseo，
  否则删除；不同容器 PID 继续视为易失状态。
- 两个 acceptance carrier 真跑 init、session、checksum、kill、并发和 BuildKit 变异，
  不再用 `node --check` / `bash -n` 或打印命令充当交付证据。

## 六条验收与变异对偶

> 下列内容由 Cube 上的 acceptance carrier 写入。每一步目录均含 `command.txt`、`rc`、
> `output`；此处保留原始关键输出，不把人工写的 PASS 当证据。

完整原始证据已拉回
`tasks/archive/agent-server-implementation-20260722/lane-h/cube-provider/lane-h3-provider-evidence-20260813.tar.gz`，
SHA-256 `bc4fe5c973feb88842ef263c82763ad1da65602ce6050b81c06f19f7dc717ee8`。

### 1. 换 provider 不改 `.ts`

Cube `ab63b1ea…`，真实 `git diff --no-index` + 可 source 配置。正例只改配置，负例额外加入
`.ts` 后 checker 必须红：

```text
$ bash -c <provider-config-checker> ...snapshot-base ...snapshot-positive positive
rc=0
git_diff_rc=1
.../config/real-provider-defaults.env
normalized_files=config/real-provider-defaults.env

$ bash -c <provider-config-checker> ...snapshot-base ...snapshot-negative negative
rc=1
git_diff_rc=1
.../config/real-provider-defaults.env
.../src/acceptance-mutation.ts
normalized_files=config/real-provider-defaults.env
src/acceptance-mutation.ts
provider config checker correctly rejected TypeScript mutation
```

第一次真跑曾抓到 `sed: unterminated 's' command`（`bash -n` 未发现），已修复并保留失败轮
`/tmp/lane-h3-provider-acceptance-failed-runtime-quoting*`。

### 2. 三个 provider 均由 Paseo 创建 session

同一 release 的真实路径是 `openProject → listProviderModels → createAgent →
sendAgentMessage → waitForFinish → fetchAgentTimeline`，不是 `--version`。OpenCode、Claude、
Codex 三条均完整通过。Claude/Codex 使用 OpenCode Go 官方网关和
`deepseek-v4-flash`：Anthropic base URL 为 `https://opencode.ai/zen/go`（SDK 自行拼
`/v1/messages`），Codex base URL 为 `https://opencode.ai/zen/go/v1` 且
`wire_api="responses"`。Claude 的六个模型入口全部由 env 覆写；凭据没有写入 settings、命令行、
日志、workspace、归档或 git。

Claude Code 拒绝 root 下的 `bypassPermissions`，最终正例以应用容器相同的 uid 1000 运行；
这不是放宽模式，而是恢复真实运行身份。正向判据除精确回复和 timeline marker 外，还强制
`inputTokens > 0 && outputTokens > 0`，因此“没有报认证错误但实际未调用模型”不能假绿：

```text
$ ./scripts/dev/provider-session-probe.mjs opencode
rc=0
{"outcome":"PASS","provider":"opencode","model":"opencode/laguna-s-2.1-free",...,"status":"idle","exactReply":true,"timelineMarker":true}

$ PROVIDER_SESSION_MODEL=deepseek-v4-flash ./scripts/dev/provider-session-probe.mjs claude
rc=0
{"outcome":"PASS","provider":"claude","model":"deepseek-v4-flash",...,"status":"idle","exactReply":true,"timelineMarker":true,"positiveUsage":true,"usage":{"inputTokens":26658,"outputTokens":86}}

$ PROVIDER_SESSION_MODEL=deepseek-v4-flash ./scripts/dev/provider-session-probe.mjs codex
rc=0
{"outcome":"PASS","provider":"codex","model":"deepseek-v4-flash",...,"status":"idle","exactReply":true,"timelineMarker":true,"positiveUsage":true,"usage":{"inputTokens":10506,"outputTokens":47}}

$ OPENCODE_BIN=/tmp/missing-opencode PROVIDER_SESSION_MUTATION=provider-binary-missing ./scripts/dev/provider-session-probe.mjs opencode
rc=1
Error: provider_environment_invalid: opencode not found in PATH
```

补充凭据轮原始证据在
`tasks/archive/agent-server-implementation-20260722/lane-h/cube-provider-credentials/lane-h-provider-credential-evidence-20260813.tar.gz`，
SHA-256 `668d28d319b6cb45ffbd3065847df84933c7b7ca8732bdfd06f75a310af28e12`。
`environment-verification.txt` 只记录权限、字节数和 SHA-256 前缀；归档、runtime 和 workspace
按真实 key 扫描的命中文件数均为 0。原 OpenCode 正例仍在主验收归档的
`lane-h3-provider-acceptance-final/26-provider-session-opencode`。

### 3. OpenCode 只走 PATH

```text
$ env PATH=<release>/bin:/usr/local/bin:/usr/bin:/bin node --input-type=module -e 'await import(...); resolve opencode/claude/codex and require <release>/bin prefix'
rc=0

$ env PATH=<empty> OPENCODE_BIN= node scripts/dev/resolve-opencode.mjs --check
rc=1
Error: provider_environment_invalid: opencode not found in PATH
```

### 4. checksum 错误必须失败

```text
$ env PROVIDER_ARTIFACT_OPENCODE_SHA256=0000...0000 PROVIDER_VOLUME_ROOT=<bad-volume> node provider-toolchain/scripts/provider-toolchain.mjs init
rc=21
provider artifact checksum mismatch: opencode

$ env PROVIDER_VOLUME_ROOT=<bad-volume> node provider-toolchain/scripts/provider-toolchain.mjs status
rc=0
{"status":"checksum_mismatch","message":"provider artifact checksum mismatch: opencode",...}
```

### 5. 半途 kill 不发布半卷，下一次恢复

最终定向对偶使用真实 `SIGKILL`：hook 在 OpenCode 写入后 `kill -KILL "$PPID"`。没有
`.ready` 的 staging 不会被 validate 接受；同一卷随后完整重填并恢复 ready。

```text
$ env PROVIDER_TOOLCHAIN_KILL_HOOK='kill -KILL "$PPID"' PROVIDER_VOLUME_ROOT=<kill-volume> node provider-toolchain/scripts/provider-toolchain.mjs init
rc=137
$ env PROVIDER_VOLUME_ROOT=<kill-volume> node provider-toolchain/scripts/provider-toolchain.mjs status
rc=0
"status": "not_installed"
"reason": "incomplete_previous_install"
"staleStaging": "staging-13946-..."
$ env PROVIDER_VOLUME_ROOT=<kill-volume> node provider-toolchain/scripts/provider-toolchain.mjs validate
rc=1
provider current release link is missing
$ env PROVIDER_VOLUME_ROOT=<kill-volume> node provider-toolchain/scripts/provider-toolchain.mjs init
rc=0
$ env PROVIDER_VOLUME_ROOT=<kill-volume> node provider-toolchain/scripts/provider-toolchain.mjs validate
rc=0
{"status":"ready","manifestDigest":"ea8c0f99...","toolchainDigest":"fb586855...","release":"<kill-volume>/releases/ea8c0f99..."}
```

### 6. 并发 init 只有一个写者

```text
$ (init & init & wait) # 同一空卷、同一 flock、同一 writer marker
one.rc=0
two.rc=0
$ writer-count-checker writer-marker
rc=0
opencode
claude
codex
writer_count=3
$ printf 'opencode\n' >> contaminated-marker; writer-count-checker contaminated-marker
rc=1
opencode
claude
codex
opencode
writer count is not three
$ provider-toolchain status
rc=0
"status": "ready"
"reused": true
```

## 改造前基线：Cube `fuse-overlayfs`

旧 Cube `dc6f67005e0f4ac7b823b14d4ef96251` 是控制面的陈旧条目，最终验收改用 Manager 提供并
已绑定本 worktree 的新 Cube `ab63b1ea25844810bbd8dc6b9ab2345d`（5 核、9947 MiB）。两者
Docker storage driver 都是 `fuse-overlayfs`。Manager 随后确认此存储路径即将改为 guest 独立
块设备 + ext4，因此停止在旧架构上跑完整五场景表；绝对时间在改造后会失效，完整表已进入
任务级 `DEFERRED.md`，重入条件是存储改造完成。

已经发生的测量保留为“改造前、未完成基线”，不把中止时间冒充完整构建时间：

```text
measurement_machine=Cube ab63b1ea25844810bbd8dc6b9ab2345d
storage_driver=fuse-overlayfs
is_complete_build=0
interrupted_by_priority_change_utc=2026-08-13T04:06:15Z
base_extract_milestones_seconds=151.3,241.1,349.0,444.2
workdir_layer_seconds=83.9
corepack_and_directories_layer_seconds=138.9
copy_root_manifests_layer_seconds=101.4
copy_web_package_layer_seconds=103.7
```

原始日志归档 `lane-h3-fuse-baseline-20260813.tar.gz`，SHA-256
`f63ced15312ab339e830500f54e0a99343969f6758818f59551d925238a11137`。

这组观测与存储 lane 用另一种方法得到的同 guest A/B 独立交叉验证：跨层
create/delete/rename 从 ext4+overlay2 的 2.513 s 变为 fuse-overlayfs 的 16.670 s（6.63×）；
COPY 6400 KiB 源码 tar 从 1.185 s 变为 6.394 s（5.40×）；497 包离线 pnpm install 从
18.997 s 变为 168.749 s（8.88×）。Lane H 看到“小 COPY 101.4/103.7 s、瓶颈位于层提交而非
下载”，与上述微基准方向一致而测量路径不同。完整五场景耗时必须在 ext4 改造后重测。

## 耗时：contabo 裸宿主受控机制 A/B（最终机制证据）

测量机为 Cube 所在的 contabo 宿主，Docker 29.1.3 `overlayfs`，隔离 builder
`lane-h-contabo-ab-20260813`，输出 `type=cacheonly`。这样 A/B 与最终 Cube 测试位于同一
物理宿主，但裸宿主和 guest 的 storage driver 仍不同，绝对时间依然分表。

```text
build_step=warm rc=0 duration_seconds=120 downloaded=337 reused=0
build_step=lock-comment rc=0 duration_seconds=79 downloaded=0 reused=337
build_step=layer-bust-same-id rc=0 duration_seconds=80 downloaded=0 reused=337
build_step=layer-bust-new-id rc=0 duration_seconds=121 downloaded=337 reused=0
warm_downloaded=337 lock_comment_downloaded=0 layer_bust_same_id_downloaded=0 layer_bust_new_id_downloaded=337 lock_comment_reused=337 layer_bust_same_id_reused=337
cache_metrics=pass
```

| 变异                               | wall time | pnpm 最终 progress         | 解释                           |
| ---------------------------------- | --------: | -------------------------- | ------------------------------ |
| fresh store                        |     120 s | `downloaded 337, reused 0` | 唯一 cache id，冷填充          |
| lockfile 注释                      |      79 s | `downloaded 0, reused 337` | frozen lock 仍校验；store 命中 |
| install-layer bust，同 cache id    |      80 s | `downloaded 0, reused 337` | 排除 Docker install 层缓存假绿 |
| install-layer bust，fresh cache id |     121 s | `downloaded 337, reused 0` | 变异对偶；只有 cache id 改变   |

运行期间记录到 load1 约 6.39–9.98，available 内存 18–20GiB；没有 PostgreSQL exit 2 /
connection terminated，没有 agent-server/PostgreSQL 容器退出。按 Manager 修正后的闸门，
load 只记录，不再作为故障代理量误杀正常构建。

原始证据归档于任务 archive 的 `lane-h/contabo/cache/`。
受控实验结束后已删除 lane 专属 builder、容器、镜像、卷和 `/tmp`，复核均为 0；没有触碰
Cube 沙箱生命周期。

## 历史：daytona-vps 裸机（协调前，不用于最终承诺）

测量机为 `daytona-vps`，Docker `overlayfs`。Owner 随后把该机划给存储层 lane；它的
底层行为将被修改。因此这些协调前历史数只保留为发现过程和交叉证据，不进入最终耗时
承诺。lane-h 的容器/镜像/卷/tmp/进程已清到 0 并核实。

| 变异                               | wall time | pnpm 最终 progress         | 解释                                                               |
| ---------------------------------- | --------: | -------------------------- | ------------------------------------------------------------------ |
| 无 cache mount 的基线冷构建        |  170.72 s | `reused 0, downloaded 497` | 层与 store 都冷                                                    |
| 只 mount `/pnpm`、未显式 store-dir |  175.82 s | `reused 0, downloaded 497` | 反例：`PNPM_HOME` 不等于 store 路径                                |
| 上述错误方案的 lock 注释重建       |  163.64 s | `reused 0, downloaded 497` | 反例复现；mount 没承载 store                                       |
| 显式 `/pnpm/store`，fresh cache id | 160.839 s | `reused 0, downloaded 497` | 正确方案的冷填充                                                   |
| lock 注释，同 cache id             | 156.772 s | `reused 497, downloaded 0` | store 命中；不是 install 层命中                                    |
| install-layer bust，同 cache id    |  58.077 s | `reused 497, downloaded 0` | 只作废 install 层，保留 cache mount；`type=cacheonly` 隔离导出成本 |
| install-layer bust，fresh cache id |  60.921 s | `reused 0, downloaded 497` | 变异对偶；`type=cacheonly`，只有 cache id 改变                     |

一次额外反例很重要：Buildx 0.30.1 / BuildKit 0.32.2 下整次 `--no-cache` 即便沿用同一
cache id，本轮观察到 mount 从空开始、`reused 0, downloaded 497`。所以最终归因不用
整次 `--no-cache`，而用 `PNPM_INSTALL_CACHE_BUST` 只改变 install RUN cache key；否则
判据会把“清掉 mount”误当“保留 mount”。

BuildKit cache mount 和 Docker local volume 都不跨主机。全新沙箱/新宿主第一次仍付
全价；同机 warm 结果不代表“以后任何机器都不卡”。

## readiness 与供应链边界

- `status` 明确区分 `not_installed`、`download_failed`、`checksum_mismatch`；被 kill 后若
  没有活跃锁，`installing` 降为 `not_installed / incomplete_previous_install`。
- artifact URL 禁止 `latest`，版本是单一来源且版本输出做 exact token 匹配，不接受
  `1.18.40` 冒充 `1.18.4`。
- attach 重新检查 manifest/toolchain digest、provider 集合、每个 installed binary hash、
  Paseo version、patch hash 与四个 server 输出 marker。
- Cube 真跑 stale PID 对偶：同 hostname + 死 PID 得到
  `{"case":"same-host-dead","removed":true,"exists":false}`；不可解析 marker 得到
  `{"case":"ambiguous-marker","removed":false,"exists":true}`，既能跨 restart 清死状态，
  又不会把不确定状态静默当成安全删除。
- cache mount 不进入 image layer；`--frozen-lockfile` 仍由 pnpm 正常校验 lock，mount 只
  提供内容寻址 store。RUN 明确断言 uid 1000 且 `/pnpm` 可写，避免权限错误静默退化。

## Deferred

T4.3 跨主机预热编排、T4.4 真实 GC dry-run、以及 ext4 存储改造后的完整五场景耗时表，
均已写入任务级 `DEFERRED.md`，包含 owner、证据、重入条件与禁止操作。它们不伪装成本轮
已完成。

## 交付元数据

- 实现 HEAD：`d51a9e6ea9c5064c073a61450493eb63a4d85d4d`
- 实现 diffstat：`28 files changed, 6946 insertions(+), 317 deletions(-)`
- 本报告作为紧随实现提交的 report-only handoff commit 提交；最终分支 HEAD 由交付回执给出，
  避免在提交内容里递归声称自身 SHA。
