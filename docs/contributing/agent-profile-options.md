# Profile options — declaring CLI flags from a profile

Agent, designer, and indexer profiles can declare their own CLI flags (`--<id>-<name>`) and a hook that translates flag values into container-side artifacts (env vars, staged files). Saifctl picks them up automatically — you don't touch the central CLI definition.

This is what powers `--claude-max` (read host's Claude Max OAuth credentials and stage them into the coder container) without saifctl's CLI core needing claude-specific knowledge. The same shape works for designer / indexer profiles — `--<designer-id>-*` and `--<indexer-id>-*` get the same treatment.

## Anatomy

A profile lives at `src/agent-profiles/<id>/`. The contract:

```
src/agent-profiles/<id>/
├── profile.ts          ← TS metadata (id, displayName, stdoutStrategy, options[], prepareAgentEnv)
├── agent.sh            ← bash; runs each agent round inside the container
└── agent-install.sh    ← bash; runs once before the loop (install the CLI etc.)
```

### Adding options

In `profile.ts`, declare an `options` array:

```typescript
import type { AgentProfile } from '../types.js';

export const myAgentProfile: AgentProfile = {
  id: 'myagent',
  displayName: 'My Agent',
  stdoutStrategy: null,

  options: [
    {
      name: 'config',                         // → --myagent-config
      type: 'string',
      description: 'Path to a custom my-agent config file',
      validate: async (value) => {
        if (typeof value !== 'string') return;
        // throw to surface a CLI error before container start
        const stats = await stat(value).catch(() => null);
        if (!stats?.isFile()) throw new Error(`config file not found: ${value}`);
      },
    },
    {
      name: 'flag',                           // → --myagent-flag
      type: 'boolean',
      description: 'Toggle some myagent feature',
      default: false,
    },
  ],

  prepareAgentEnv: async ({ options, unprivHome }) => {
    if (options.flag !== true) return {};

    return {
      env: {
        MYAGENT_FEATURE_FLAG: '1',           // visible to agent.sh
      },
      stageFiles: typeof options.config === 'string' ? [
        {
          src: { kind: 'file', path: options.config },
          dst: `${unprivHome}/.myagent/config.yaml`,
          mode: 0o600,
          owner: 'unpriv',
        },
      ] : [],
    };
  },
};
```

### What the user sees

```
saifctl feat run --agent myagent --myagent-flag --myagent-config ./conf.yaml
```

`saifctl feat run --agent myagent --help` includes the two new flags in its output (saifctl pre-parses `--agent` from argv and dynamically extends the citty command schema).

## Naming rules

- Option names are kebab-case suffixes only — saifctl prepends `<agent-id>-`. So `name: 'max'` for the `claude` profile becomes `--claude-max`.
- Names cannot collide with global flags (`--name`, `--model`, `--storage`, etc.); the namespacing prefix prevents most collisions, and saifctl runs a startup-time guard that hard-errors on edge cases (`assertNoGlobalCollisions` in `src/agent-profiles/options-bridge.ts`).
- Names cannot duplicate across profiles via the same suffix when paired with the same `<id>` — the guard catches that too.

## Field reference

| Field | Type | Notes |
|---|---|---|
| `name` | string (kebab-case) | suffix only; saifctl prepends `<id>-` |
| `type` | `'boolean' \| 'string' \| 'number'` | type-checked at parse time |
| `description` | string | shown in `--help` |
| `default` | matches `type` | only for boolean/string/number; strict type match required |
| `secret` | boolean | when true, value is treated as a secret: kept out of run storage, redacted in logs |
| `validate` | `(value) => void \| Promise<void>` | throw to surface a CLI error; runs after parse, before container start |

## `prepareAgentEnv` hook

Called once per coding attempt (in container engines), after CLI parse and before the coder container starts the agent script. Receives:

```typescript
{
  options: Record<string, boolean | string | number | undefined>,
  projectDir: string,           // host project root
  unprivUser: string,           // matches $SAIFCTL_UNPRIV_USER inside container
  unprivHome: string,           // resolved at apply.sh runtime — use `${unprivHome}/...` literally
}
```

Returns:

```typescript
{
  env?: Record<string, string>,        // public env, visible in logs/run-storage
  secrets?: Record<string, string>,    // redacted; routed via existing secret pipeline
  stageFiles?: StagedFile[],           // copied into container before agent-install.sh
}
```

`StagedFile`:

```typescript
{
  src: { kind: 'file'; path: string } | { kind: 'inline'; content: string | Buffer },
  dst: string,                  // container path; supports ~/ and $HOME/ prefixes
  mode?: number,                // default 0o600
  owner?: 'unpriv' | 'root',    // default 'unpriv'
}
```

Saifctl writes each staged file to `<saifctl-host-path>/.stage/<idx>` and emits a generated `apply.sh` that copies + chmods + chowns into place. The bash applier runs in `coder-start.sh` between the startup script and `agent-install.sh`, so install scripts can rely on staged files being in place (e.g. credentials at `~/.claude/.credentials.json`).

## Where things flow

```
argv → src/cli/index.ts injectActiveAgentProfileFlags()    ← pre-parse --agent, extend citty schema
     → citty parse → run handler in feat.ts / sandbox.ts
     → recordProfileOptionsFromArgs(profile, args)         ← write to process.env
     → validateProfileOptions(profile)                     ← run each option's validator
     → orchestrator … runEngineAttempt
     → readProfileOptionsFromEnv(profile)                  ← read back
     → profile.prepareAgentEnv({ options, ... })           ← compute env + stageFiles
     → buildCoderContainerEnv result + result.env merged
     → applyStagedFiles(saifctlPath, result.stageFiles)    ← write .stage/<i> + apply.sh
     → runAgent (container starts; coder-start.sh runs apply.sh)
```

Look at `src/agent-profiles/claude/profile.ts` for a complete worked example (`--claude-max`, `--claude-credentials`).

## Config-file resolution

Profile options can also be set in `saifctl/config.{yaml,json,ts}` under `agents.<id>.<name>`. CLI flags override config; the profile's declared `default` is the final fallback.

```yaml
# saifctl/config.yaml
agents:
  claude:
    max: true
    credentials: ~/work/team-claude-creds.json
```

Equivalent to `--claude-max --claude-credentials ~/work/team-claude-creds.json` on the CLI. Useful for project-pinned credentials or per-team defaults.

Notes:

- Unknown keys in the config map are silently ignored — config files are forwards-compatible with future profile changes.
- `secret: true` options sourced from a config file are not automatically redacted in run storage. If you want a string value kept out of run storage / logs, source it via `agentSecretKeys` (env-var-based) instead.
- The profile's `validate(value)` runs against the merged value regardless of source — so a bad path in config fails at the same point a bad path on the CLI would.

## Designer + indexer profiles

`DesignerProfile` (`src/designer-profiles/types.ts`) and `IndexerProfile` (`src/indexer-profiles/types.ts`) both accept the same `options?: AgentProfileOption[]` field as agents. The CLI dynamic flag injection in `src/cli/index.ts` pre-parses `--designer` and `--indexer` (in addition to `--agent`) and injects each profile's options into the matching command schemas:

| Profile flag | Commands the options are injected into |
|---|---|
| `--agent <id>` | `feat run`, `sandbox` |
| `--designer <id>` | `feat design`, `feat design-specs`, `feat design-discovery`, `feat design-tests`, `feat design-fail2pass` |
| `--indexer <id>` | `init`, all `feat design*` |

Resolution + validation is wired into `feat design` and `init` handlers via `recordAndValidateProfileOptions({ profile, args, configMap })`. Designer/indexer code reads the resolved values via `readProfileOptionsFromEnv(profile)` from inside its own `run()` / `init()` implementation — no `prepareAgentEnv`-style container staging applies because designers and indexers run on the host, not inside a coder container.

Config-file blocks for designers and indexers mirror the agent shape:

```yaml
agents:
  claude:
    max: true
designers:
  shotgun:
    strict: true     # hypothetical --shotgun-strict
indexers:
  shotgun:
    pre-warm: true   # hypothetical --shotgun-pre-warm
```

The respective config-schema fields are `agentOptions`, `designerOptions`, `indexerOptions`. CLI > config > profile.default.

## Wiring follow-up coverage

The standalone `feat design-*` subcommands (`feat design-specs`, `feat design-discovery`, `feat design-tests`, `feat design-fail2pass`) currently get the dynamic CLI flag *injection* (so `--shotgun-foo --help` works) but don't yet call `recordAndValidateProfileOptions` in their handlers — only the top-level `feat design` does. Same for any other entry point that takes `--designer` or `--indexer` outside the design flow. Add the helper call when authoring a profile that needs it; the pattern is one line per handler.
