# Source Layout

The baseline source entries are:

- `src/index.ts`: Loader-facing plugin namespace and public exports;
- `src/config.ts`: serializable schema, resolved defaults, and configuration types;
- `src/runtime.ts`: fakeable host boundary and Cordis activation;
- `src/cron.ts`: five-field cron parsing and timezone-aware occurrence computation (pure, zero-dependency);
- `src/store.ts`: the durable JSON job store (the source of truth);
- `src/filelock.ts` / `src/store-merge.ts`: cross-process write coordination, monotonic ids, and record-level merge policy;
- `src/scheduler.ts`: occurrence persistence, timers, catch-up policy, and the `ctx.cron` service view;
- `src/adapter.ts`: idempotent Automation submission and durable Run-event reconciliation;
- `src/automation.ts`: the structural public service boundary consumed from dsh-automation;
- `src/target.ts`: fresh Session target extraction at creation boundaries;
- `src/lock.ts`: the single-instance scheduler lock for shared Harness homes;
- `src/tools.ts`: the `cron_add` / `cron_list` / `cron_remove` model tools;
- `src/command.ts`: the `/cron` human command;
- `src/rpc.ts`: the loopback `/cron` RPC channel for the browser panel;
- `src/client/`: the browser half (sidebar footer panel), discovered through the `dsh.client` manifest.

Keep the baseline files focused. Extend `src/config.ts` rather than hiding deployment choices in implementation constants; extend `src/runtime.ts` with fakeable process, clock, transport, or UI boundaries.
