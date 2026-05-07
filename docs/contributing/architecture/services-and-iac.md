# Services + IaC delegation

Real services (Postgres, Redis, mocks, third-party APIs) are defined in the user's own `docker-compose.yml` or Helm chart — saifctl never owns the topology. Saifctl invokes the standard tools (`docker compose -p saifctl-run-<runId> up -d`, `helm install -n saifctl-run-<runId>`) and attaches the coder + staging + test-runner containers to the resulting network.

Configuration lives at `environments.coding` and `environments.staging` in `saifctl/config.ts`. Each is a discriminated union on `engine: 'docker' | 'helm' | 'local'` (`local` only for coding).

Two design principles, both load-bearing:

1. **Saifctl never parses Compose files or Helm charts.** Project-name (`-p`) and namespace are the entire concurrency story. Anything saifctl-specific the user has to learn is one CLI flag, not a new YAML schema.
2. **Per-run uniqueness via `<runId>`.** The shared key across sandbox dir, worktree, Docker network, branch name, and Compose project name. Parallel runs don't collide.

> **Related:** [`sandbox-isolation.md`](./sandbox-isolation.md) · [`extension-points.md`](./extension-points.md) · [`../infra.md`](../infra.md) · [`docspec/products/saifctl/concepts/services.md`](../../../docspec/products/saifctl/concepts/services.md).

## The problem this solves

Real integration tests need real services. Unit tests that mock Postgres tell you the mock works; integration tests against a real Postgres tell you the code works. The factory's value depends on the latter.

Two failure modes "give the agent a Postgres" must avoid:

| Failure mode           | Concrete                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Blast radius**       | Agent drops a real staging DB, corrupts an integration env, hammers a paid third-party API.                                              |
| **Environment sprawl** | Every feature's `tests.json` defines its own Postgres / Redis → hundreds of drift-prone container definitions scattered across the repo. |

Saifctl's fix: **never own the service topology**. Orchestrate around services the user already defines in their own IaC — Docker Compose locally, Helm for Kubernetes (when shipped).

## Macro-orchestrator responsibilities

User defines services in `docker-compose.yml` (or Helm chart). Saifctl:

1. Spins up the topology at run start (`docker compose up -d` or `helm install`).
2. Attaches coder + staging + test-runner containers to the same network.
3. Injects env vars (`DATABASE_URL`, etc.) into the agent so it can reach the services.
4. Tears it all down at run end via [`LiveInfra`](../infra.md).

**Saifctl never parses Compose files or Helm charts.** It only invokes the standard tools. The saifctl-specific learning surface is one CLI flag, not a new YAML schema.

## Configuration: `environments.coding` + `environments.staging`

[`src/config/schema.ts`](../../../src/config/schema.ts) defines the configuration. Two distinct environments per project:

| Environment            | When                                                                    | Contains                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `environments.coding`  | While the agent is writing code (the inner loop in the coder container) | Mocks/stubs the agent's tests run against. Discriminated union: `engine: 'docker' \| 'helm' \| 'local'`.                                                                                         |
| `environments.staging` | While saifctl is validating the agent's diff (outer-loop test runner)   | The "deployed" version of the app + the same services as coding. Discriminated union: `engine: 'docker' \| 'helm'` (no `local` for staging — must be containerized for the test-runner air-gap). |

Both blocks are optional. If absent, saifctl provisions only the core containers (coder, staging, test-runner) on the per-run bridge network — no Compose stack, no extra services. That's the default for simple feature sets.

Concrete example:

```ts
// saifctl/config.ts
import { defineConfig } from '@saifctl/core';

const isK8s = process.env.SAIF_ENV === 'kubernetes';

export default defineConfig({
  project: 'my-enterprise-app',
  environments: {
    // The agent's test-time environment
    coding: isK8s
      ? {
          engine: 'helm',
          chart: './k8s/charts/saifctl-mocks',
          namespacePrefix: 'saifctl-run',
          agentEnvironment: {
            DATABASE_URL: 'postgres://user:pass@{{ .Release.Name }}-postgres-db:5432/db',
          },
        }
      : {
          engine: 'docker',
          file: './docker/docker-compose.dev.yml',
          agentEnvironment: {
            DATABASE_URL: 'postgres://user:pass@postgres-db:5432/db',
          },
        },
    // The staging environment for the test runner
    staging: isK8s
      ? {
          engine: 'helm',
          chart: './k8s/charts/saifctl-staging',
          namespacePrefix: 'saifctl-run',
          appEnvironment: { DATABASE_URL: '...' },
        }
      : {
          engine: 'docker',
          file: './docker/docker-compose.staging.yml',
          appEnvironment: { DATABASE_URL: '...' },
        },
  },
});
```

**Why TypeScript config (not JSON / YAML)?** Dynamic resolution. Branch on env vars (`SAIF_ENV`), feature flags, or anything else at config-load time. JSON/YAML can't do `isK8s ?` cleanly.

## Why `engine` is a discriminated union

[`src/config/schema.ts:75-83`](../../../src/config/schema.ts#L75) makes `coding` + `staging` Zod discriminated unions on `engine`:

- **TypeScript exhaustiveness checks** — adding `engine: 'podman'` forces every consumer that switches on `engine` to handle the new case at compile time.
- **Engine-specific fields without pollution** — Helm has `chart` + `namespacePrefix`; Docker has `file`; local has neither.
- **Intent at call sites** — `engine: 'helm'` signals which adapter takes over.

Runtime adapters at [`src/engines/<engine>/`](../../../src/engines/).

## Why not "containers" natively in saifctl JSON

A custom schema (`containers: [{ image: 'postgres', port: 5432 }]`) was rejected because:

- Real stacks need volume mounts, healthchecks, `depends_on` sequencing, named networks, aliases. Docker Compose already does all of this.
- Reimplementing Compose's surface in saifctl-specific JSON = shipping a worse Compose.
- Platform teams already have governance on Compose / Helm (CI checks, security scans, cost controls). Saifctl-specific schemas bypass those controls.

## Network isolation and concurrency

Two developers running `saifctl feat run` simultaneously can't share the same Postgres. Saifctl achieves per-run isolation differently per engine:

### Docker Compose

Saifctl invokes:

```bash
docker compose -p saifctl-run-<runId> -f <file> up -d
```

The `-p` flag is **the entire concurrency story**. Docker Compose generates an isolated network named `saifctl-run-<runId>_default` per project. Saifctl then attaches the coder + staging + test-runner containers to that network. **Zero parsing of the Compose file is required for isolation** — Compose's project-name semantics give it for free.

### Kubernetes (Helm)

Saifctl creates a dedicated Namespace per run (e.g. `saifctl-run-<runId>`), then runs `helm install mocks ./chart -n saifctl-run-<runId>`. The agent Pod is deployed into the same namespace. Namespaces give Kubernetes the same isolation guarantee.

In both cases, the per-run uniqueness of `<runId>` is what makes parallel runs safe — see [`git-and-patches.md` "Parallel-run safety"](./git-and-patches.md#parallel-run-safety) for the full set of saifctl resources keyed by runId.

## `agentEnvironment` injection

The agent's container is dynamically created by saifctl, not defined in the user's `docker-compose.yml` / Helm chart. Saifctl injects env vars (`DATABASE_URL`, etc.) so the agent can reach the services.

| Engine     | Templating                                                                                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Docker** | `agentEnvironment` is flat `Record<string, string>`. Saifctl injects `KEY=value` as-is. Compose's static service hostnames (`postgres-db`, `redis`, …) work because all containers join the same `saifctl-run-<runId>_default` network.                                                                       |
| **Helm**   | User writes `agentEnvironment` values with Helm's native `{{ }}` syntax (e.g. `'postgres://user:pass@{{ .Release.Name }}-postgres-db:5432/db'`). Saifctl drops the raw string into a temp `ConfigMap.yaml`; `helm install` compiles it through Helm's Go-templating. Saifctl never templates anything itself. |

The Helm path uses Helm to do the work it was already designed for. Saifctl just dispatches.

## Edge cases — implementation gotchas

### Compose host-port collision

`docker-compose.yml` binding `ports: ["5432:5432"]` → second concurrent saifctl run crashes (host port 5432 already taken). `-p` isolates Docker networks but **not host ports**.

Mitigations:

- The agent doesn't need host-mapped ports — it runs _inside_ the Docker network.
- **Recommend**: Compose files passed to saifctl avoid host-port bindings.
- **Future**: saifctl could parse YAML before `up -d` and warn / strip `ports:` arrays. Not implemented.

### `.env` priority shadowing

Next.js / Django / Rails sometimes prefer `.env.local` over shell env. Saifctl injects via shell env (`agentEnvironment`); the framework may silently ignore it.

Mitigations:

- Document that test runners should respect shell env over `.env` files.
- Or: saifctl generates `.env.saifctl` inside the agent's workspace + wraps test commands with `dotenv -e .env.saifctl --`. Per-project plumbing.

### Custom Compose networks

`docker-compose.yml` declaring `networks: [backend-net, frontend-net]` → Compose skips the default bridge. Breaks saifctl's "everything on `saifctl-run-<runId>_default`" assumption.

Mitigation: the **God Network** pattern. After `docker compose up`:

1. Create a single bridge `saifctl-net-<proj>-<feat>-<runId>` ([`src/engines/docker/index.ts:161`](../../../src/engines/docker/index.ts#L161)).
2. Iterate every Compose service; `docker network connect` it to the God Network.
3. Boot agent + staging + test-runner onto the God Network.

Result: saifctl sees the full mock topology regardless of how the user's YAML is networked. Trades one extra network per service for portability.

### Kubernetes readiness vs completeness

Config schema, discriminated union, and `Engine` interface are all designed for Helm. **v0.1 status**: docker engine complete; helm engine partially scaffolded. `engine: 'helm'` parses cleanly but the runtime adapter fails on dispatch. v1.0 target.

## Engine selection — `--engine` CLI flag vs config

`--engine docker | local | helm` overrides **only the coder phase**. Staging engine comes from `environments.staging.engine` in config, not the CLI.

Why split: `--engine local` is for saifctl-developer iteration (skip the coder container; test changes without Docker round-trip). It's not a per-feature deployment knob. Staging is a deployment-shape decision; lives in version-controlled config.

## Lifecycle: when each phase fires

[`runIterativeLoop`](../../../src/orchestrator/loop.ts#L703) drives:

1. **Run start** — read `environments.coding`. Run engine adapter (`docker compose up -d -p saifctl-run-<runId>` etc.). Resources tracked in [`LiveInfra`](../infra.md).
2. **Coding phase** — agent's container runs with `agentEnvironment` injected. Agent's tests can hit `DATABASE_URL` etc.
3. **Verification phase** — read `environments.staging`. Bring up staging stack on the same network.
4. **Test runner** — runs against staging via HTTP sidecar or web base URL ([`test-runner.md`](./test-runner.md)).
5. **Per-iteration teardown** — staging container destroyed; staging Compose stack torn down. Coding services **persist** across iterations (part of the agent's working environment, not per-test state).
6. **Run end** — `LiveInfra` tears everything down. `docker compose down -p saifctl-run-<runId>` (or `helm uninstall` + namespace delete).

Coding-services-persist + staging-fresh-per-iteration is intentional: agent's mocks are part of its dev env; staging validation has to be reproducible.

## See also

- [`sandbox-isolation.md`](./sandbox-isolation.md) — the three-container architecture this layer plugs services into.
- [`extension-points.md`](./extension-points.md) — engine choice as part of the broader profile system.
- [`../infra.md`](../infra.md) — `LiveInfra` resource tracker (deterministic teardown for everything saifctl provisioned).
- [`../docker.md`](../docker.md) — image inventory, including how Compose-managed services interact with saifctl's per-run network.
- [`docspec/products/saifctl/concepts/services.md`](../../../docspec/products/saifctl/concepts/services.md) — user-facing concept (what services are, when to define them).
- [`docspec/products/saifctl/concepts/infra.md`](../../../docspec/products/saifctl/concepts/infra.md) — user-facing engine choice + trade-offs.
