# Services: real infrastructure for agent-driven validation

When you write code that talks to a database, a queue, or an external API, testing that code against a hand-rolled mock trades correctness for speed. Agents are particularly susceptible to this trade-off: a mock that is just plausible enough will produce a passing test and a broken integration. Services in saifctl exist to close that gap — they give your feature runs real, network-accessible infrastructure without requiring you to manage it manually.

## Why real services instead of mocks

Mocks answer a different question than running code. A mock verifies that your code calls the right methods with the right arguments. A real service verifies that your code produces the right *effect* — that a row lands in the database, that a message is consumed off the queue, that a webhook actually fires.

For agent-generated code, the distinction matters more than it does for human-written code. An agent can learn to satisfy a mock without producing correct behaviour, because the mock rewards the shape of the call, not the outcome. Integration tests that run against real services catch this class of failure mechanically, before the code reaches your repository.

## The Macro-Orchestrator model

saifctl does not implement its own container runtime or service scheduler. Instead, it acts as a **Macro-Orchestrator**: it delegates service lifecycle to standard Infrastructure-as-Code tools — Docker Compose today, Helm on the roadmap — and coordinates when those services are started and torn down relative to the coding and staging phases.

Think of it as `docker compose up` run at the right moment, scoped to a feature run, and torn down when the run completes. You declare a service topology; saifctl ensures it is running when your agent or your tests need it. The IaC layer handles the actual container plumbing.

This delegation choice means you get the full expressiveness of Docker Compose (health checks, named networks, volume mounts, environment variables) without saifctl needing to re-implement any of it. You point saifctl at your existing Compose file via the `file:` config field (e.g. `file: ./docker/docker-compose.dev.yml`) — a standard Compose file you can run directly to inspect or debug the topology outside of saifctl.

## Two phases, two environments

Each feature run is divided into two phases, each with its own environment configuration:

**Coding phase** — the agent's container. This is where the AI edits your code. Services you declare for this environment are available inside the agent's container during the editing loop, so the agent can introspect a live schema, query a seed dataset, or verify a connection string without stubbing anything out.

**Staging phase** — validation against the agent's diff. Gate checks, the reviewer, and holdout tests all run here. Services you declare for the staging environment are started before the test suite runs and torn down after. This is where your integration tests make real network calls.

Because each phase has its own `environment` block, you can run them on different engines and with different service topologies. A coding phase might wire up a lightweight Postgres container and a seed fixture; the staging phase might add a Redis instance and a mock of a third-party webhook endpoint.

## The `engine:` field

The `engine:` field in each environment block selects the infrastructure layer:

- `docker` — services run inside the saifctl-managed container network. This is the default and the right choice for production runs.
- `local` — services are assumed to be already running on the host. No container boundary is enforced. Valid only in the `coding` environment block; the staging environment must use `docker` or `helm`. Use only for trusted code in fast inner-loop iteration.
- `helm` — remote execution on Kubernetes (planned, not yet available).

The engine controls *where* the phase runs; the service declarations control *what* is available when it runs. See [Execution infrastructure: engines and phases](./infra.md) for the full engine comparison.

## Trade-offs: fidelity vs. speed

Think of your service declarations as a test fixture topology rather than a static JSON file — they describe live infrastructure that the agent and your tests share, not a snapshot of expected values. That shift in framing clarifies when real services pay off and when they don't.

Real services cost more than mocks:

| | Real services | Mocks |
|---|---|---|
| Test fidelity | High — actual network I/O, real schema enforcement | Low to medium — depends on mock quality |
| Startup time | Seconds to tens of seconds (container pull + health check) | Milliseconds |
| Maintenance | Compose file + seed data | Mock implementation per dependency |
| Agent over-fitting risk | Low | Higher — agent can game the mock |

For integration and end-to-end tests, the fidelity gain is worth the startup cost. For unit tests that cover pure logic, mocks remain appropriate. saifctl does not force one approach — you declare services only where you need them, and the service block is optional in both environments.

## Related pages

- [Execution infrastructure: engines and phases](./infra.md) — engine choices, Docker vs. local vs. Helm, and how engines relate to Hatchet
- [feat run loop](./feat-run-loop.md) — how coding and staging phases connect to gates and the reviewer
- [Docker isolation](./docker-isolation.md) — Cedar and Leash enforcement inside the container
