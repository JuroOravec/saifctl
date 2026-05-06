# Hatchet integration

Two paths share a single code path:

- **Local mode (default)** — in-process Hatchet mock client. No external services, no setup.
- **Hatchet mode** — `HATCHET_CLIENT_TOKEN` set + `SAIFCTL_EXPERIMENTAL_HATCHET=1` (per Decision **D-04**). Real Hatchet server, durability, dashboard.

Both run the same workflow at [`src/hatchet/workflows/feat-run.workflow.ts`](../../src/hatchet/workflows/feat-run.workflow.ts). User-facing setup (token, dashboard URL, env vars): [`docspec/products/saifctl/concepts/hatchet.md`](../../docspec/products/saifctl/concepts/hatchet.md). Architecture context: [`architecture/orchestrator.md` Hatchet integration](./architecture/orchestrator.md#hatchet-integration).

## Local mode (in-process mock client)

Local mode runs Hatchet workflows in-process via [`src/hatchet/utils/local.ts`](../../src/hatchet/utils/local.ts). DAG ordering, `parentOutput`, `runChild`, `onFailure` semantics match the real Hatchet — single code path means feature-run logic stays tested without standing up a server.

| Path | Role |
|---|---|
| `src/hatchet/utils/local.ts` | Runner + `HatchetLike`, `WorkflowDeclaration`, `LocalContext` |
| `src/hatchet/utils/local.test.ts` | DAG, children, failures, `onFailure`, abort coverage |
| `src/hatchet/client.ts` | `getHatchetClient()`, `_resetHatchetClient()` (tests) |
| `src/hatchet/workflows/feat-run.workflow.ts` | Production workflow; uses `getHatchetClient()` for declarations |

Not implemented vs real Hatchet (intentional): persistence, retries, distributed workers, dashboard, server-side scheduling, anything assuming an external engine. Failures surface synchronously in-process.

## Distributed mode — phased rollout

Per **Decision D-04** + spec section 3.5. Goal: durable, distributed `feat run` execution where saifctl drives runs across multiple worker machines, with a dashboard surfacing run state to operators.

| Phase | Status | What it adds |
|---|---|---|
| **Phase 1 — Local Hatchet (single machine, optional local server)** | 🟡 in progress, **experimental in v0.1** (gated behind `SAIFCTL_EXPERIMENTAL_HATCHET=1`) | Real Hatchet server runs on the user's machine; saifctl talks to it via gRPC. Durability across saifctl crashes. Local dashboard. Same `feat-run.workflow.ts` driving the run. |
| **Phase 2 — Remote workers** | ➡️ future | Workers run on separate machines; saifctl host dispatches via Hatchet, results stream back. Useful for CI farms and shared compute pools. |
| **Phase 3 — Control plane server** | ➡️ future | A saifctl-specific REST API in front of Hatchet for project / feature / run / worker management. Multi-tenant. |
| **Phase 4 — GitHub App + webhook triggers** | ➡️ future | `feat run` triggers from GitHub PR events; AI agents fix CI failures, propose changes, etc. |

The full design (data schemas, control-plane REST API, worker-node provisioning, dashboard features, storage backends) is roadmap material for Phases 2-4. When those phases ship, this doc gets the detail. The earlier design draft is preserved in `git log` (commit before the DOC-09 architecture restructure).

## Phase 1 — local Hatchet quickstart (developer-only)

For saifctl maintainers wanting to test the Hatchet path locally:

```bash
# 1. Start a local Hatchet server (one-time bootstrap)
hatchet server start

# 2. Set credentials
export HATCHET_CLIENT_TOKEN=<token from `hatchet token create`>
export SAIFCTL_EXPERIMENTAL_HATCHET=1

# 3. Run anything that goes through feat-run.workflow.ts
saifctl feat run --feature my-feature
```

Without `SAIFCTL_EXPERIMENTAL_HATCHET=1`, setting `HATCHET_CLIENT_TOKEN` triggers an explicit error with the gate message — see [`assertHatchetReady()`](../../src/orchestrator/modes.ts) and the spec's NPM-03 row.

`saifctl doctor` checks the Hatchet config in three states: token absent (local mode, warning only), token + flag (server mode, success), token without flag (gated, hard failure).

## Why a single workflow drives both modes

Initial implementation had separate Hatchet and in-process loop paths. They drifted — bug fixes in one didn't reach the other. Re-implementing the relevant Hatchet SDK surface in-process means the production workflow runs identically in both modes; tests cover the same code path that ships to users.

This is what `src/hatchet/utils/local.ts` is for: it's not a "Hatchet stub for tests", it's the runtime that all local-mode runs use.

## See also

- [`architecture/orchestrator.md` Hatchet integration](./architecture/orchestrator.md#hatchet-integration) — where the convergence loop dispatches into Hatchet.
- [`docspec/products/saifctl/concepts/hatchet.md`](../../docspec/products/saifctl/concepts/hatchet.md) — user-facing concept page.
- Decision **D-04** in [`saifctl/features/release-readiness/specification.md`](../../saifctl/features/release-readiness/specification.md) — the experimental-flag rationale.
