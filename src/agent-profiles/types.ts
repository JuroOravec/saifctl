/**
 * AgentProfile — describes a coding agent and its runtime requirements.
 *
 * Supported profiles: openhands | aider | claude | codex | gemini | qwen | opencode | copilot | kilocode | mini-swe-agent | terminus | forge | deepagents | cursor | debug
 *
 * The profile is mainly used by:
 *   - sandbox.ts                  → writes agent.sh + agent-install.sh to sandbox
 *   - coder-start.sh             → runs agent-install.sh before the loop
 *
 * **Re-used for critics.** Critic discover/fix subtasks (Block 4 of
 * TODO_phases_and_critics) run on the same agent script with the same profile
 * — saifctl spawns a fresh LLM context per critic round and distinguishes
 * implementer vs critic only by the rendered prompt template
 * (`critics/<id>.md`). There is no separate "critic profile"; if a project
 * wants critics on a different model, that's done via per-subtask LLM
 * overrides on the compiled critic subtasks, not via a new profile id here.
 *
 * ## Adding a new agent profile
 *
 * Every new profile dir under `src/agent-profiles/<id>/` must ship at least:
 *   - `profile.ts`         — registers the profile (id, displayName, stdoutStrategy)
 *   - `agent-install.sh`   — runs once at container start; install the CLI
 *   - `agent.sh`           — runs per round; reads `$SAIFCTL_TASK_PATH` and emits a patch
 *
 * **Drop-privileges classification (mandatory).** Each agent must declare
 * whether its `agent.sh` runs as root (default for the container) or drops
 * to the unprivileged `saifctl` user via `runuser`. The decision is enforced
 * at unit-test time by `drop-privileges-contract.test.ts`:
 *
 *   - **Drops privileges** — required when the agent CLI refuses to run as
 *     root (Claude Code 2.x with `--dangerously-skip-permissions` is the
 *     load-bearing case). Add the id to `DROPS_PRIVILEGES` in the contract
 *     test, copy the `runuser -l "$SAIFCTL_UNPRIV_USER"` invocation **and**
 *     the Linux UID-realignment block from `claude/agent.sh`. Both pieces
 *     are required (`runuser` alone breaks on Linux strict UID mapping).
 *
 *   - **Runs as root** — fine for now if the agent CLI works as root and
 *     you're not introducing new least-privilege guarantees in this PR.
 *     Add the id to `ROOT_OK_ALLOWLIST` in the contract test. Adding to
 *     this list is an explicit decision, not a default — the test will
 *     fail with a pointer to this paragraph if a new profile dir lacks
 *     classification.
 *
 * **Symmetric drop-privileges for every agent** is the desired end state
 * (least-privilege default; a bug or prompt-injection in any agent
 * shouldn't have root over `/workspace`). It's tracked as **release-readiness/X-08-P8** in
 * `saifctl/features/release-readiness/specification.md` §4.1, deferred
 * until release-readiness/X-01's smoke matrix exercises every agent end-to-end so each can
 * be migrated and validated together.
 *
 * The Dockerfile-side contract (`SAIFCTL_UNPRIV_USER`,
 * `SAIFCTL_UNPRIV_NPM_PREFIX`) is enforced separately by
 * `src/sandbox-profiles/scaffold-contract.test.ts`. Every Dockerfile.coder
 * already exposes the unprivileged user, so any agent can opt in without
 * waiting for sandbox-profile changes.
 */

import type { AgentStdoutStrategy } from '../orchestrator/logs.js';

/**
 * One profile-specific option that becomes a CLI flag (`--<agent-id>-<name>`).
 *
 * The agent-id prefix is mandatory and saifctl prepends it; the `name` here is
 * just the suffix. e.g. `name: 'max'` for the `claude` profile produces the
 * CLI flag `--claude-max`. This namespacing is the conflict-prevention
 * mechanism — profile options can't collide with global flags or with each
 * other.
 *
 * Future: same `options` array also drives config-file resolution at
 * `agents.<id>.<name>` (CLI overrides config). Not yet wired.
 */
export interface AgentProfileOption {
  /** Suffix only — saifctl prepends `<agent-id>-`. Must be kebab-case. */
  name: string;
  type: 'boolean' | 'string' | 'number';
  description: string;
  default?: boolean | string | number;
  /**
   * When true, the resolved value is treated as a secret: kept out of run
   * storage, redacted in logs (only the option name appears, not the value).
   * Use for credentials / tokens / paths to credential files. The hook's
   * resulting `env` entry will route through `secretEnv` automatically.
   */
  secret?: boolean;
  /**
   * Optional pre-flight validation. Throw to surface a CLI error before
   * the container starts. Runs synchronously after CLI parsing, before
   * `prepareAgentEnv`.
   */
  validate?: (value: unknown) => void | Promise<void>;
}

/** Context passed to `prepareAgentEnv`. Saifctl populates this from the run's resolved state. */
export interface AgentPrepareContext {
  /** Parsed option values, keyed by option `name` (without the agent-id prefix). */
  options: Record<string, boolean | string | number | undefined>;
  /** Project root on the host. */
  projectDir: string;
  /** The unprivileged user the agent runs as inside the container (matches `SAIFCTL_UNPRIV_USER`). */
  unprivUser: string;
  /** `$HOME` of the unprivileged user inside the container (used to resolve `~` in `dst`). */
  unprivHome: string;
}

/**
 * One file to stage into the coder container before agent-install.sh runs.
 *
 * Saifctl's current bind-mount-based engine implements staging by writing the
 * file into a per-run host tmpdir, bind-mounting that tmpdir into the
 * container at a fixed path, and having `staging-start.sh` (or equivalent)
 * copy each entry to its `dst` with the requested mode/owner. RO mount on
 * the host side; RW copy inside the container so refresh-tokens-style
 * write-back doesn't fail mid-run.
 */
export interface StagedFile {
  src: { kind: 'file'; path: string } | { kind: 'inline'; content: string | Buffer };
  /** Container path. Tokens `~/` and `$HOME/` resolve to `unprivHome`. */
  dst: string;
  mode?: number; // default 0o600
  owner?: 'unpriv' | 'root'; // default 'unpriv'
}

/** Return value of `prepareAgentEnv`. All fields optional; saifctl merges into the run's container env. */
export interface AgentPrepareResult {
  /** Public env vars; visible in logs and persisted in run storage. */
  env?: Record<string, string>;
  /** Secret env vars; redacted in logs, kept out of run storage. */
  secrets?: Record<string, string>;
  /** Files to stage into the container before agent-install.sh runs. */
  stageFiles?: StagedFile[];
}

/** Describes a coding agent and its runtime requirements (id, display name, stdout strategy). */
export interface AgentProfile {
  /**
   * Profile identifier used in --agent CLI flag.
   * One of the SUPPORTED_AGENT_PROFILE_IDS.
   */
  id: SupportedAgentProfileId;

  /** Human-readable display name (e.g. "OpenHands", "Aider"). */
  displayName: string;

  /**
   * Structured stdout handling inside the `[SAIFCTL:AGENT_*]` window (segment split + per-segment CLI formatting).
   * Use `null` when the agent emits plain line-oriented output (line-wise events + `[prefix]` formatting).
   */
  stdoutStrategy: AgentStdoutStrategy | null;

  /**
   * Profile-specific CLI options. Each becomes `--<id>-<option.name>`. Saifctl
   * pre-parses `--agent` from argv, looks up the profile, and dynamically
   * extends the citty command with these options before final parsing —
   * the help text for `saifctl feat run --agent <id> --help` includes them.
   *
   * Names must be kebab-case and must NOT collide with any global flag
   * (`--name`, `--model`, `--storage`, etc.); the namespacing prefix prevents
   * most collisions but a startup-time guard catches edge cases.
   */
  options?: AgentProfileOption[];

  /**
   * Hook called after CLI parsing and before the coder container starts.
   * Returns artifacts saifctl applies to the run: env vars (public + secret)
   * and files staged into the container at known paths.
   *
   * Pure / no side-effects expected — saifctl may call this twice
   * (preflight validation + actual run).
   *
   * Only invoked when the profile is the active `--agent`. Profiles with no
   * options or no per-run state to inject can omit this.
   */
  prepareAgentEnv?: (ctx: AgentPrepareContext) => Promise<AgentPrepareResult>;
}

/** Tuple of all agent profile ids accepted by the `--agent` CLI flag. */
export const SUPPORTED_AGENT_PROFILE_IDS = [
  'openhands',
  'aider',
  'claude',
  'codex',
  'gemini',
  'qwen',
  'opencode',
  'copilot',
  'kilocode',
  'mini-swe-agent',
  'terminus',
  'forge',
  'deepagents',
  'cursor',
  'debug',
] as const;
/** Union of all valid agent profile ids (derived from {@link SUPPORTED_AGENT_PROFILE_IDS}). */
export type SupportedAgentProfileId = (typeof SUPPORTED_AGENT_PROFILE_IDS)[number];
