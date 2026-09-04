# dsh-cron

[English](README.md) | 中文

DSH Automation 的持久化日历 Trigger 适配器。它把一次性或周期性计划 occurrence 转成幂等 fresh-Session Run，自身不再执行 Agent turn。

## 责任边界

- dsh-cron 负责计划解析、时区计算、持久化 occurrence 身份、catch-up 策略与任务中心 UI；
- dsh-automation 负责 Run 队列、canonical fresh Session、跨 Worker 并发、取消、显式重试、事件历史、retention 与崩溃恢复；
- dsh-webhook 是对应的事件驱动 Trigger 适配器，并可选提供终态回调。

## 安装

需要 Node.js 24 或更新版本、DSH `0.1.2-rc.1` 或更新的 `0.1.x` 版本，以及 dsh-automation `0.2.x`。

```sh
dsh plugin --profile web add github:cofy-x/dsh-automation
dsh plugin --profile web add github:omdsh-dev/dsh-cron
```

插件通过 `dsh.client` manifest 提供浏览器任务中心，在 headless profile 中也可通过工具、命令与 RPC 使用。

## 计划语义

支持：

- 五段 cron：分、时、日、月、周；
- 带显式 offset 或 `Z` 的 RFC 3339 一次性 `at`；
- 支持夏令时的 IANA 时区。

每个日历 occurrence 都会先持久化 run record 并推进计划，再提交 Automation。稳定身份和幂等键由 job id 与 scheduled instant 确定性生成。如果进程在 Automation 已提交、但本地尚未记录 Run id 时崩溃，重启后会使用同一幂等键取回同一 Run。

错过的周期使用明确的 latest-only catch-up：只执行最新已到期时刻一次，不回放旧积压。一次性 job 执行后作为历史保留。暂停保留计划；恢复周期 job 时会把 next occurrence 推进到当前时间之后。

每个 job 使用并发键 `cron:<job-id>`，默认 limit 为 1，由 dsh-automation 在所有 Worker 和进程之间事务性执行。

## 使用

模型工具：`cron_add`、`cron_update`、`cron_list`、`cron_remove`。

```text
/cron add 0 9 * * 1-5 总结项目状态
/cron add tz=Asia/Shanghai 30 18 * * 5 准备周报
/cron add-at 2026-09-01T09:00:00+08:00 执行发布检查清单
/cron pause cron-1
/cron resume cron-1
/cron remove cron-1
```

命令或模型工具创建的 job 会捕获创建 Session 的绝对工作目录，作为 fresh Automation target。浏览器/API job 必须携带 `cwd` 或继承 `defaultCwd`。无法得到 fresh target 的旧 job 会安全暂停并记录 `migrationIssue`，等待重新设置目标。

## 持久化对账

Occurrence record 从 `submitting` 推进到关联 Automation state 与终态投影，保留：

- 确定性 `occurrenceId`、`scheduledAt` 与 `idempotencyKey`；
- `automationRunId` 与当前 Run state；
- 终态时间、outcome、结果摘要或错误。

适配器使用持久化 checkpoint `cron.adapter.v1` 消费 Automation 事件流。cursor 过期时，它会逐个刷新所有已关联 Run，并从 prune watermark 继续。可选 callback 集成只在首次终态结算时发出。

源 store 只裁剪终态历史，活跃 occurrence 绝不因历史上限被删除。schema v1 在加载时迁移到 v2，旧 `lastRun` 保留为 `legacy` occurrence。

## 配置

| 键 | 默认 | 含义 |
|:---|:---|:---|
| `dataDir` | `$DSH_HOME/cron` | 持久化 job store 与 scheduler lock |
| `defaultTimeZone` | 主机时区 | cron 未指定时的默认 IANA 时区 |
| `maxJobs` | `64` | 最大活跃 job 数 |
| `minIntervalMinutes` | `1` | 周期计划最小间隔 |
| `defaultCwd` | 无 | 浏览器/API job 的 fresh Session 工作目录 |
| `reconcilePollMs` | `1000` | Automation 事件流轮询间隔 |
| `maxRunHistory` | `100` | 每 job 保留的终态 occurrence 数 |

只有持有 scheduler lock 的进程会设置 timer、提交 pending occurrence 并对账事件流。其他共享 Harness home 的进程提供管理服务，并可在主进程退出后接管。

管理写入使用独立的短期跨进程 lock、无冲突 sequence sidecar 和 record-level 三方合并。进程会接纳 peer 新增记录和未在本地修改的编辑，不会复活已删除记录；长时间 lock 竞争必须 fail closed，不得覆盖 peer 状态。

本适配器仅依赖公开的 `dsh-automation >=0.2.0-alpha.0 <0.3.0` service contract，不引入私有源码，也不需要修改 deepseek-harness。

## 开发

```sh
pnpm install
pnpm run verify:self-contained
pnpm run typecheck
pnpm test
pnpm run build
pnpm run prepare
```

## 许可证

[MIT](LICENSE)
