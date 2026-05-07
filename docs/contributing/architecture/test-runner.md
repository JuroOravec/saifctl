# Test runner — contract + sidecar protocol

The test-runner container is one of three in [`sandbox-isolation.md`](./sandbox-isolation.md). It runs tests against the staging container over HTTP — no Docker socket, no shared memory.

Three contracts on this page:

1. **Host ↔ Test Runner** — bind-mounts + env vars in, JUnit XML out.
2. **Test Runner ↔ Staging** — HTTP, either via the Go sidecar (CLI projects) or directly to the app's web endpoints.
3. **Override surface** — `--test-image`, `--test-script`, `--test-profile` for custom languages / frameworks.

> **Related:** [`sandbox-isolation.md`](./sandbox-isolation.md) · [`gate-and-reviewer.md`](./gate-and-reviewer.md) · [`installation-scripts.md`](./installation-scripts.md) · [`security-threats.md`](./security-threats.md).

## Three-party contract

```
                 ┌─────────────────────┐
                 │     Host (Node.js)  │
                 │     Orchestrator    │
                 └──────────┬──────────┘
              creates,       │           reads
              bind-mounts,   │           results.xml
              passes env     ▼
       ┌──────────────────────────────────────┐
       │            Docker Network            │
       │   saifctl-net-<proj>-<feat>-<runId>  │
       │                                      │
       │  ┌─────────┐   HTTP    ┌──────────┐  │
       │  │  Test   │ ◄───────► │ Staging  │  │
       │  │ Runner  │           │ + sidecar│  │
       │  └─────────┘           └────┬─────┘  │
       │                             │        │
       │                ┌────────────┴────┐   │
       │                │ optional extra  │   │
       │                │ services        │   │
       │                │ (postgres, …)   │   │
       │                └─────────────────┘   │
       └──────────────────────────────────────┘
```

Three communication channels:

- **Host ↔ Test Runner**: file-based. Host bind-mounts test files into the container; Test Runner writes JUnit XML to a bind-mounted output dir; Host parses the XML after the container exits.
- **Test Runner ↔ Staging**: HTTP-only over the per-run bridge network. Either an HTTP sidecar (`POST /exec`) for CLI execution, or direct HTTP requests to the app's web endpoints, or both. **No shared memory, no Docker socket, no `docker exec`.**
- **Staging ↔ extra services**: same bridge network, used for digital twins (postgres, redis, mocks).

## Contract: Host ↔ Test Runner

### Required environment variables

The orchestrator passes these into the Test Runner container ([`src/engines/docker/index.ts:414-418`](../../../src/engines/docker/index.ts#L414)):

| Variable               | Source / value                                                                                                      | Purpose                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `SAIFCTL_TARGET_URL`   | Set from the staging container's resolved `targetUrl` (sidecar URL for CLI projects, web base URL for web projects) | The "thing tests should hit". For CLI projects = sidecar URL. For web projects = app base URL (e.g. `http://staging:3000`). |
| `SAIFCTL_SIDECAR_URL`  | Always set, even for web projects (every staging container runs the sidecar)                                        | The HTTP sidecar URL: `http://staging:<port><path>` (e.g. `http://staging:8080/exec`).                                      |
| `SAIFCTL_FEATURE_NAME` | Feature name from the run                                                                                           | Surfaces the active feature to the test runner / helpers.                                                                   |
| `SAIFCTL_TESTS_DIR`    | Container path where tests are mounted (default `/tests`)                                                           | Where the runner reads spec files from.                                                                                     |
| `SAIFCTL_OUTPUT_FILE`  | Container path where the runner writes JUnit XML (default `/test-runner-output/results.xml`)                        | Where the host reads results from.                                                                                          |

### Required volume mounts

| Host path                       | Container path           | Mode  | Notes                                                                                      |
| ------------------------------- | ------------------------ | ----- | ------------------------------------------------------------------------------------------ |
| `<feature>/tests/public/`       | `/tests/public/`         | `:ro` | Visible specs (also visible to the agent)                                                  |
| `<feature>/tests/hidden/`       | `/tests/hidden/`         | `:ro` | Holdout specs — never staged into the agent's sandbox; mounted _only_ into the test runner |
| `<feature>/tests/helpers.ts`    | `/tests/helpers.ts`      | `:ro` | Shared transport helpers (`execSidecar`, `baseUrl`, `httpRequest`)                         |
| `<feature>/tests/infra.spec.ts` | `/tests/infra.spec.ts`   | `:ro` | Sidecar health check — always mounted; runs first                                          |
| `<sandbox>/test.sh`             | `/usr/local/bin/test.sh` | `:ro` | The runner entrypoint — **always** bind-mounted, never baked into the image                |
| `<sandbox>/`                    | `/test-runner-output/`   | `:rw` | Where the runner writes the JUnit XML report                                               |

Each per-test file mount only fires if the file exists; `test.sh` and `reportDir` are always present. The single-source layout (just `/tests/public`, `/tests/hidden`, etc.) is what most projects see; multi-source layouts (when saifctl merges feature/tests with project-level `saifctl/tests/`) use per-label subtrees — see [`src/test-profiles/node-vitest/test.sh`](../../../src/test-profiles/node-vitest/test.sh) for the disambiguation logic.

### Exit-code + output-file contract

| Exit code | Meaning                                    |
| --------- | ------------------------------------------ |
| `0`       | All tests passed.                          |
| non-zero  | One or more tests failed, OR runner error. |

Output:

- Format: **JUnit XML**.
- Path: `$SAIFCTL_OUTPUT_FILE` (default `/test-runner-output/results.xml`).
- The host's [`parseJUnitXmlString`](../../../src/engines/utils/test-parser.ts) reads the file post-exit. JUnit XML is the universal format — Vitest, pytest, go-test, cargo-test, and most CI systems support it.
- If the runner crashes before producing output, the file may be absent; the host falls back to exit-code-only reporting.

The orchestrator parses individual test cases out of the XML for per-suite analysis (e.g. `hasFeatureSuccessfullyFailed` in fail2pass mode — distinguishing "infra broken" from "feature tests legitimately fail" — see [`src/orchestrator/loop.ts`](../../../src/orchestrator/loop.ts)).

## Contract: Test Runner ↔ Staging

The test runner reaches the staging container _only_ over HTTP. Two transport patterns, depending on project type.

### Sidecar (CLI projects)

The Go binary at [`src/orchestrator/sidecars/cli-over-http/main.go`](../../../src/orchestrator/sidecars/cli-over-http/main.go) runs inside every staging container, listening on a TCP port (default 8080, `SIDECAR_PATH=/exec`). The orchestrator injects the binary via `putArchive` ([`security-threats.md` #3](./security-threats.md#3-root-privilege-escalation-via-docker-socket-mount)).

**Request:** `POST $SAIFCTL_SIDECAR_URL`:

```json
{
  "cmd": "pnpm",
  "args": ["run", "greet", "Alice"],
  "env": { "GREETING": "Hi" },
  "timeout": 60000
}
```

Fields:

- `cmd` — executable to run (resolved via PATH inside the staging container).
- `args` — array of arguments (NOT shell-interpolated — the sidecar uses `exec.Command(cmd, args...)`).
- `env` — extra env vars for the spawned process; merged with the staging container's env.
- `timeout` — milliseconds. Default 60000; clamped to 1000–600000.

**Response:** `200 OK` with JSON:

```json
{
  "stdout": "Hello, Alice! Welcome to the agents framework.\n",
  "stderr": "",
  "exitCode": 0
}
```

Avoids the `docker exec` antipattern, which would require mounting `/var/run/docker.sock` into the test runner — finding #3 in the [threat model](./security-threats.md#3-root-privilege-escalation-via-docker-socket-mount). Sidecar gives `docker exec`-equivalent execution surface inside HTTP/JSON, with no shared memory and no daemon access.

Sidecar binary: ~5MB statically-linked Go, no external deps, runs in any Linux container regardless of installed runtime.

### Web app (web projects)

`tests.json` declares `containers.staging.baseUrl` (e.g. `http://staging:3000`); orchestrator forwards as `SAIFCTL_TARGET_URL`. Tests hit the app's endpoints directly — no sidecar needed for primary tests.

The sidecar is still running, so tests can `execSidecar(...)` to inspect logs, run a CLI command, or check container state on top of HTTP testing.

### Helpers contract

Each profile's `helpers.ts` (or `.py`, `.go`) reads `SAIFCTL_*` env vars and exposes:

```ts
execSidecar({ cmd, args, env?, timeout? }): Promise<{ stdout, stderr, exitCode }>
baseUrl(): string                                                              // web projects
httpRequest({ method, path, body?, headers? }): Promise<{ status, body }>      // web projects
```

Templates live at `src/test-profiles/<id>/templates/` (`node-vitest/templates/helpers.ts`, `python-pytest/templates/helpers.py`, …). Tests `import { execSidecar } from '../helpers'`; orchestrator wires `SAIFCTL_*` env underneath.

## Directory layout: `<feature>/tests/`

```
tests/
├── tests.json        # Test catalog (visibility, entrypoints, containers config)
├── tests.md          # Human-readable test plan (design phase output)
├── helpers.ts        # execSidecar, baseUrl, httpRequest
├── infra.spec.ts     # Sidecar health checks (CLI projects)
├── public/           # Visible specs (also exposed to agent)
│   └── *.spec.ts
└── hidden/           # Holdout specs — agent never sees these
    └── *.spec.ts
```

The orchestrator mounts:

- All four sibling files (`tests.json`, `tests.md`, `helpers.ts`, `infra.spec.ts`) into the test runner.
- `public/` AND `hidden/` mounted into the test runner.
- `public/` only mounted into the agent's sandbox (`hidden/` is recursively stripped — see [`sandbox-isolation.md`](./sandbox-isolation.md#the-copy-not-mount-workspace)).

The default `test-default.sh` runs Vitest with `--root "${SAIFCTL_TESTS_DIR}"` and `--outputFile="${SAIFCTL_OUTPUT_FILE}"`. Test profiles for other languages do the equivalent.

## Test profiles

Pre-built test-runner images, one per language + framework combination, published to GHCR:

| Profile                 | Image                                                                   |
| ----------------------- | ----------------------------------------------------------------------- |
| `node-vitest` (default) | `ghcr.io/safe-ai-factory/saifctl/saifctl-test-node-vitest:latest`       |
| `node-playwright`       | `ghcr.io/safe-ai-factory/saifctl/saifctl-test-node-playwright:latest`   |
| `python-pytest`         | `ghcr.io/safe-ai-factory/saifctl/saifctl-test-python-pytest:latest`     |
| `python-playwright`     | `ghcr.io/safe-ai-factory/saifctl/saifctl-test-python-playwright:latest` |
| `go-gotest`             | `ghcr.io/safe-ai-factory/saifctl/saifctl-test-go-gotest:latest`         |
| `go-playwright`         | `ghcr.io/safe-ai-factory/saifctl/saifctl-test-go-playwright:latest`     |
| `rust-rusttest`         | `ghcr.io/safe-ai-factory/saifctl/saifctl-test-rust-rusttest:latest`     |
| `rust-playwright`       | `ghcr.io/safe-ai-factory/saifctl/saifctl-test-rust-playwright:latest`   |

Profile inventory at [`src/test-profiles/`](../../../src/test-profiles/) (one dir per profile, each with `Dockerfile`, `profile.ts`, `test.sh`, `templates/`). The `--test-profile <name>` CLI flag picks the profile; default is `node-vitest`.

Docker pulls the image automatically when not present locally. Build manually with `pnpm docker build test --test-profile <name>` — see [`docs/contributing/docker.md`](../docker.md) for the full build matrix.

## Override surface

| Knob                                         | Purpose                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--test-image <ref>`                         | Replace the published image with a custom one. Image must implement the contract above (read env vars, write JUnit XML to `SAIFCTL_OUTPUT_FILE`). |
| `--test-script <path>`                       | Replace `test.sh` with a custom entrypoint. Always bind-mounted at `/usr/local/bin/test.sh:ro`, never baked into the image.                       |
| `--test-profile <name>`                      | Pick a different pre-built profile (`node-vitest`, `python-pytest`, `go-gotest`, `rust-rusttest`, etc.).                                          |
| `containers.staging.baseUrl` in `tests.json` | Web-project endpoint resolution. Sets `SAIFCTL_TARGET_URL`.                                                                                       |
| `tests.json` `visibility` field per case     | Public vs hidden split per test.                                                                                                                  |

The custom-runner pattern: write a `test.sh` that obeys the env-var contract and exit-code semantics; bring any image you want via `--test-image`. The orchestrator only sees the bytes of the JUnit XML output.

## Validation tests

[`src/engines/utils/test-parser.test.ts`](../../../src/engines/utils/test-parser.test.ts) validates the JUnit XML parser end-to-end against fixtures from each profile. If a profile's test runner produces incompatible XML, that test fails — keeps the contract honest.

## See also

- [`sandbox-isolation.md`](./sandbox-isolation.md) — why the test runner is in a separate container; full three-container model.
- [`gate-and-reviewer.md`](./gate-and-reviewer.md) — how holdout tests slot into the gauntlet; what happens on failure (Vague Specs Checker).
- [`installation-scripts.md`](./installation-scripts.md) — `stage.sh` lifecycle (the staging container's startup that the test runner depends on).
- [`security-threats.md`](./security-threats.md#3-root-privilege-escalation-via-docker-socket-mount) — finding #3: why we don't mount the Docker socket.
- [`../docker.md`](../docker.md) — image inventory, build commands, GHCR publishing, custom images.
- [`docspec/references/test-profiles.md`](../../../docspec/references/test-profiles.md) — user-facing reference page (CLI surface for profile choice).
