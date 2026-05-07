# Hatchet: distributed orchestration for saifctl

By default, saifctl runs entirely in-process — no external services, no configuration beyond your environment. For most single-developer workflows, that is the right choice. Hatchet is an opt-in upgrade that adds durability and distributed execution when you need them.

## How saifctl runs without Hatchet

When you haven't set `HATCHET_CLIENT_TOKEN`, saifctl orchestrates agents directly in the local process. Tasks start, run, and complete (or fail) within the same process. If the process exits mid-run, the run does not resume.

This is analogous to `setTimeout` in JavaScript: it works, it is immediate, and there is no broker in the way. For a single developer running `saifctl feat run` on a local repo, this is the fastest path to a result.

## What Hatchet adds

Setting `HATCHET_CLIENT_TOKEN` routes your task orchestration through a [Hatchet](https://hatchet.run) server. This changes three things:

- **Durability.** Runs survive process crashes. Tasks that have already completed don't run again — but if a task is interrupted mid-execution, that task restarts from the beginning.
- **Distributed execution.** Multiple worker processes can pick up tasks from the same queue, enabling parallelism across machines.
- **Dashboard.** The Hatchet UI shows run history, task status, and retry logs.

Think of the difference between running `vitest` locally and running the same tests in CI: same tests, same assertions, but the execution model changes — results persist, failures are auditable, and multiple agents can work in parallel.

## Status in v0.1: experimental

Hatchet integration is gated behind the `SAIFCTL_EXPERIMENTAL_HATCHET=1` flag (Decision release-readiness/D-04).

- If you set `HATCHET_CLIENT_TOKEN` **without** `SAIFCTL_EXPERIMENTAL_HATCHET=1`, saifctl raises an error. To check your environment, run `saifctl doctor`. Local mode is unaffected.
- If you set both, saifctl connects to the Hatchet server at startup. Ensure gRPC connectivity to the server before starting workers.

This gate exists because the Hatchet integration is not yet available in v0.1.0. It will be promoted out of experimental in a future release.

## When to use Hatchet

Use the default in-process mode unless you have a specific reason not to. Consider opting in when:

- You need runs to survive restarts (long-running factory jobs, flaky environments).
- You want to scale out to multiple worker processes.
- You want a persistent audit trail of which phases ran, retried, or failed.

If none of those apply, skip the setup. The in-process mode gives you the same correctness guarantees — gates, reviewer, holdout tests — with no external dependencies.

## What you need to run Hatchet

- A running Hatchet server (self-hosted or managed).
- A `HATCHET_CLIENT_TOKEN` issued by that server.
- gRPC connectivity from each worker to the server.
- `HATCHET_SERVER_URL` pointing at your server's gRPC address (optional if the server is on the default `localhost:7077`, required otherwise).
- `SAIFCTL_EXPERIMENTAL_HATCHET=1` in your environment.

See the Hatchet documentation for server setup. saifctl-specific worker configuration is covered in the Hatchet how-to guide (not yet published).
