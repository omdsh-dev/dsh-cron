# dsh-cron

English | [中文](README.zh.md)

A durable calendar Trigger adapter for DSH Automation. It turns one-shot or recurring schedule occurrences into idempotent fresh-Session Runs. It never executes an Agent turn itself.

## Responsibility boundary

- dsh-cron owns schedule parsing, timezone calculation, durable occurrence identity, catch-up policy, and the task-center UI.
- dsh-automation owns the Run queue, canonical fresh Sessions, cross-worker concurrency, cancellation, explicit retries, event history, retention, and crash recovery.
- dsh-webhook is the equivalent event-driven Trigger adapter and optionally provides outbound settlement callbacks.

## Install

Requires Node.js 24 or newer, DSH `0.1.5-rc.1` or newer within the `0.1.x` line, and dsh-automation `0.2.x`.

Install dsh-automation first, then the adapter:

```sh
dsh plugin --profile web add dsh-automation@next
dsh plugin --profile web add @cofy-x/dsh-cron
```

To test unreleased source revisions, install from GitHub instead:

```sh
dsh plugin --profile web add github:cofy-x/dsh-automation
dsh plugin --profile web add github:cofy-x/dsh-cron
```

The plugin contributes a browser task center through its `dsh.client` manifest and works in headless profiles through tools, commands, and RPC.

## Scheduling semantics

Supported schedules:

- five-field cron: minute, hour, day-of-month, month, day-of-week;
- one-shot RFC 3339 `at` timestamps with an explicit offset or `Z`;
- IANA time zones with daylight-saving-aware occurrence calculation.

For every calendar occurrence, the scheduler persists a run record and advances the schedule before submitting Automation. The stable identity and key are derived from the job id and scheduled instant. If the process dies after Automation commits but before the source store records its Run id, restart submits the same key and receives the same Run.

Missed recurring occurrences use an explicit latest-only catch-up policy: the newest due instant runs once, older backlog is not replayed. A one-shot remains as durable history after it fires. Pausing preserves the schedule; resuming advances recurring schedules past the current time.

Each job uses concurrency key `cron:<job-id>` with a configurable limit (currently one by default). dsh-automation enforces the limit transactionally across every worker and process.

## Usage

Model tools:

- `cron_add` — create a recurring or one-shot job;
- `cron_update` — pause or resume;
- `cron_list` — inspect schedules, occurrences, linked Runs, and outcomes;
- `cron_remove` — delete a job.

Commands:

```text
/cron add 0 9 * * 1-5 Summarize the project status
/cron add tz=Asia/Shanghai 30 18 * * 5 Prepare the weekly report
/cron add-at 2026-09-01T09:00:00+08:00 Run the release checklist
/cron pause cron-1
/cron resume cron-1
/cron remove cron-1
```

Jobs created by a command or model tool capture the creating Session's absolute workspace as a fresh Automation target. Browser/API jobs must send `cwd` or inherit `defaultCwd`. Migrated legacy jobs without either are safely paused with a `migrationIssue` until retargeted.

## Durable reconciliation

Occurrence records progress from `submitting` to the linked Automation state and terminal projection. They retain:

- deterministic `occurrenceId`, `scheduledAt`, and `idempotencyKey`;
- linked `automationRunId` and current Run state;
- terminal completion time, outcome, result excerpt, or error.

The adapter consumes the durable Automation feed with checkpoint `cron.adapter.v1`. On an expired cursor, it refreshes every linked Run by id and resumes at the published prune watermark. Terminal settlement is emitted only once for optional callback integration.

The source store keeps bounded terminal history but never trims active occurrence records. Schema v1 migrates to v2 on load; old `lastRun` data remains readable as a `legacy` occurrence.

## Configuration

| Key | Default | Meaning |
|:---|:---|:---|
| `dataDir` | `$DSH_HOME/cron` | durable job store and scheduler lock directory |
| `defaultTimeZone` | host zone | zone used when a cron expression omits one |
| `maxJobs` | `64` | maximum active jobs |
| `minIntervalMinutes` | `1` | minimum recurring interval |
| `defaultCwd` | none | absolute fallback workspace for browser/API jobs |
| `reconcilePollMs` | `1000` | Automation event-feed poll interval |
| `maxRunHistory` | `100` | retained terminal occurrences per job |

Only the scheduler-lock holder arms timers, submits pending occurrences, and reconciles the feed. Other processes sharing the same Harness home expose management services and can take over after the holder exits.

Management writes use a separate short-lived cross-process lock, collision-free sequence sidecar, and record-level three-way merge. A process adopts peer additions and untouched edits without resurrecting deletions; prolonged lock contention fails closed instead of overwriting peer state.

The adapter requires the public `dsh-automation >=0.2.0-alpha.0 <0.3.0` service contract. It does not import private dsh-automation source and requires no deepseek-harness modification.

## Development

```sh
pnpm install
pnpm run verify:self-contained
pnpm run typecheck
pnpm test
pnpm run build
pnpm run prepare
```

## License

[MIT](LICENSE)
