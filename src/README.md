# Source Layout

The baseline source entries are:

- `src/index.ts`: Loader-facing plugin namespace and public exports;
- `src/config.ts`: serializable schema, resolved defaults, and configuration types;
- `src/runtime.ts`: fakeable host boundary and Cordis activation;
- `src/cron.ts`: five-field cron parsing and timezone-aware occurrence computation (pure, zero-dependency);
- `src/store.ts`: the durable JSON job store (the source of truth);
- `src/scheduler.ts`: timers, due dispatch, and the `ctx.cron` service view;
- `src/tools.ts`: the `cron_add` / `cron_list` / `cron_remove` model tools;
- `src/command.ts`: the `/cron` human command.

Keep the baseline files focused. Extend `src/config.ts` rather than hiding deployment choices in implementation constants; extend `src/runtime.ts` with fakeable process, clock, transport, or UI boundaries.
