# Execution infrastructure: engines and phases

Every saifctl run is split into two phases, and each phase can run on a different engine. Understanding this model tells you where your code actually executes and which guarantees apply at each step.

## The two phases

**Coding phase** — an agent edits code. This is where the AI writes, modifies, or generates files based on the feature spec.

**Staging phase** — tests run against the diff the coding phase produced. Gate checks, the reviewer, and holdout tests all execute here. This phase exists to validate the coding phase output before anything touches your repository.

Each phase has its own `environment` block in the feature config. You can run them on different engines — for example, coding on `docker` and staging on `local` if your test suite has dependencies that are inconvenient to containerize.

## Engine choices

Three engines are available. Engines determine *where* a phase runs, not what it does. Think of it like a test-runner config (jest / vitest) but for the entire pipeline: the same feature spec can be run with different engine setups depending on whether you're iterating locally or running in production.

### `docker` (default)

The phase runs inside an ephemeral Docker container. Cedar policies are enforced via Leash, giving you filesystem, process, and network boundaries. Your host is untouched unless you opt in via `--extract`.

This is the right choice for production runs and for any phase that executes untrusted code. The isolation guarantee is the same one saifctl's sandbox mode provides — the agent cannot reach your host regardless of what it does inside the container. The model is the same as the difference between `docker run` on your laptop and `docker run` in CI: same image, different host, same guarantees.

### `local`

The phase runs directly in the current process with no container boundary. There is no Cedar/Leash isolation.

Use this only for code you trust — for example, your own test suite running against a diff you have already reviewed. The benefit is faster iteration: no container startup, no copy-not-mount overhead (saifctl copies the workspace into the container rather than mounting it directly). Do not use `local` for the coding phase of a production run.

### `helm` (planned)

Remote execution on Kubernetes, dispatched via Helm. This engine is not yet available; the `helm` option is reserved for a future release.

## How engines relate to Hatchet

Engines answer the question "where does a phase run." [Hatchet](./hatchet.md) answers a different question: "how are runs dispatched, resumed, and tracked across processes."

A `docker` engine run can be orchestrated locally (default) or via Hatchet. An engine change gives you isolation; a Hatchet integration gives you durability, distributed workers, and an audit trail. The two are independent settings.

## Choosing an engine

| Situation | Recommended engine |
|---|---|
| Production [`feat run`](./feat-run-loop.md) (Factory-mode agent run), untrusted agent code | `docker` |
| Fast inner-loop iteration, trusted code only | `local` |
| Distributed or remote execution | `helm` (planned) |

When in doubt, leave the engine at the default (`docker`). The isolation guarantees are enforced mechanically — if Cedar blocks a write, the phase fails cleanly rather than silently corrupting your host.

## Related pages

- [Docker isolation](./docker-isolation.md) — what Cedar and Leash enforce inside the container
- [Hatchet: distributed orchestration](./hatchet.md) — run dispatch, durability, and workers
- [feat run loop](./feat-run-loop.md) — how the coding and staging phases connect to gates and the reviewer
