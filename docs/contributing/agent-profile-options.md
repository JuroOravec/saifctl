# Agent profile options — declaring CLI flags from a profile

Agent profiles can declare their own CLI flags (`--<id>-<name>`) and a hook that translates flag values into container-side artifacts (env vars, staged files). Saifctl picks them up automatically — you don't touch the central CLI definition.

This is what powers `--claude-max` (read host's Claude Max OAuth credentials and stage them into the coder container) without saifctl's CLI core needing claude-specific knowledge.

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

## What's not yet wired (follow-up work)

- **Config-file resolution**. Today only CLI flags carry option values. The plan is to support `agents.<id>.<name>` keys in `saifctl/config.{yaml,json,ts}` with CLI overriding config — not yet implemented.
- **Designer / Indexer profile options**. Same shape would apply to `DesignerProfile` and `IndexerProfile` (`--<designer-id>-*`, `--<indexer-id>-*`) — not yet implemented.

Both are tracked as design follow-ups; the core mechanism is the same as for agents, just hooked at different points in the orchestrator.
