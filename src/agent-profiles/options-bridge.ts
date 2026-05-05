/**
 * Agent-profile options bridge.
 *
 * Provides three things:
 *
 *   1. {@link buildProfileCliFlags} — translate a profile's `options[]` into
 *      citty-shaped argument definitions (`--<id>-<name>`). Used by the CLI
 *      to dynamically extend the `feat run` / `sandbox` command schema after
 *      pre-parsing `--agent` from argv.
 *
 *   2. {@link recordProfileOptionsFromArgs} — once citty has parsed argv into
 *      `args`, copy the relevant `--<id>-<name>` values into a process-internal
 *      env-var protocol (`SAIFCTL_AGENT_OPT_<ID>_<NAME>`) so the orchestrator
 *      can read them later without further type plumbing.
 *
 *   3. {@link readProfileOptionsFromEnv} — orchestrator-side counterpart;
 *      reads the env vars and produces the `options` map that the profile's
 *      `prepareAgentEnv` hook expects.
 *
 * Why env vars as the intra-process protocol: avoids threading a new
 * `agentProfileOptions: Record<string,...>` field through `RunOrchestratorOpts`
 * → `RunEngineAttemptOpts` → `runEngineAttempt`, which would touch ~5 files.
 * The CLI and orchestrator run in the same node process, so process.env is
 * a fine in-memory carrier.
 *
 * Conflict prevention is via the `<id>-` prefix on every option's CLI name.
 * {@link assertNoGlobalCollisions} validates that no profile option shadows
 * a global `feat run` / `sandbox` flag at startup time.
 */

import type { AgentPrepareContext, AgentProfile, AgentProfileOption } from './types.js';

/** Citty-shape arg definition (citty's `defineCommand({ args: { ... } })`). */
type CittyArg =
  | { type: 'boolean'; description?: string; default?: boolean }
  | { type: 'string'; description?: string; default?: string }
  | { type: 'number'; description?: string; default?: number };

/**
 * Translate a profile's `options[]` into citty-shaped args.
 * Returns an empty record if the profile declares no options.
 */
export function buildProfileCliFlags(profile: AgentProfile): Record<string, CittyArg> {
  const flags: Record<string, CittyArg> = {};
  for (const opt of profile.options ?? []) {
    const cliName = `${profile.id}-${opt.name}`;
    flags[cliName] = buildSingleFlag(opt);
  }
  return flags;
}

function buildSingleFlag(opt: AgentProfileOption): CittyArg {
  switch (opt.type) {
    case 'boolean':
      return {
        type: 'boolean',
        description: opt.description,
        ...(typeof opt.default === 'boolean' ? { default: opt.default } : {}),
      };
    case 'string':
      return {
        type: 'string',
        description: opt.description,
        ...(typeof opt.default === 'string' ? { default: opt.default } : {}),
      };
    case 'number':
      return {
        type: 'number',
        description: opt.description,
        ...(typeof opt.default === 'number' ? { default: opt.default } : {}),
      };
  }
}

/**
 * After citty has parsed argv, copy any `--<id>-<name>` values into the
 * process-env protocol so the orchestrator can read them later. Skips
 * undefined values (citty doesn't set them when the user didn't pass the flag).
 *
 * Mutates `process.env`. Call once per CLI invocation, after parsing.
 */
export function recordProfileOptionsFromArgs(
  profile: AgentProfile,
  args: Record<string, unknown>,
): void {
  for (const opt of profile.options ?? []) {
    const cliName = `${profile.id}-${opt.name}`;
    const value = args[cliName];
    if (value === undefined || value === null) continue;
    process.env[envKeyFor(profile.id, opt.name)] = String(value);
  }
}

/**
 * Orchestrator-side read. Returns the parsed options map shaped for
 * `prepareAgentEnv({ options, ... })`.
 *
 * Each value is converted from string back to the option's declared type.
 * Options the user didn't pass (and that have no default) come back as
 * `undefined`.
 */
export function readProfileOptionsFromEnv(profile: AgentProfile): AgentPrepareContext['options'] {
  const out: AgentPrepareContext['options'] = {};
  for (const opt of profile.options ?? []) {
    const raw = process.env[envKeyFor(profile.id, opt.name)];
    if (raw === undefined) {
      // Fallback to declared default; allows boolean defaults to flow even
      // when the user didn't pass the flag.
      out[opt.name] = opt.default;
      continue;
    }
    out[opt.name] = parseValue(opt.type, raw);
  }
  return out;
}

/**
 * Apply config-file values for the active profile to the env-var protocol,
 * but ONLY for options that the CLI did not already set.
 *
 * Call sequence per CLI invocation:
 *
 *   1. {@link recordProfileOptionsFromArgs}(profile, args)   ← CLI flags win
 *   2. applyConfigToProfileOptionsEnv(profile, configMap)    ← config fills gaps
 *   3. {@link validateProfileOptions}(profile)               ← validate the merged result
 *
 * Precedence is CLI > config > profile.default. Step 1 only writes when CLI
 * provided a value; this step only writes when (a) CLI did not provide
 * (env var unset), AND (b) config provides one.
 *
 * `configMap` is the per-agent record from `agents.<id>` in
 * `saifctl/config.{yaml,json,ts}` — i.e. the value of `agentOptions[profile.id]`.
 * Pass `undefined` when the user has no agent-specific config block; this is
 * a no-op in that case.
 *
 * Unknown keys in `configMap` (options the profile does not declare) are
 * silently ignored — no error. This keeps the config forwards-compatible
 * with future profile changes.
 */
export function applyConfigToProfileOptionsEnv(
  profile: AgentProfile,
  configMap: Record<string, string | number | boolean> | undefined,
): void {
  if (!configMap) return;
  for (const opt of profile.options ?? []) {
    const envKey = envKeyFor(profile.id, opt.name);
    if (process.env[envKey] !== undefined) continue; // CLI already set it
    const configValue = configMap[opt.name];
    if (configValue === undefined) continue;
    process.env[envKey] = String(configValue);
  }
}

/**
 * Run all per-option `validate(value)` hooks for the active profile. Throws on
 * the first failure with a CLI-friendly message. Call after CLI parsing and
 * before container start.
 */
export async function validateProfileOptions(profile: AgentProfile): Promise<void> {
  const resolved = readProfileOptionsFromEnv(profile);
  for (const opt of profile.options ?? []) {
    if (!opt.validate) continue;
    const value = resolved[opt.name];
    try {
      await opt.validate(value);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Invalid value for --${profile.id}-${opt.name}: ${msg}`);
    }
  }
}

/**
 * Startup-time guard: no profile option's CLI name may collide with a known
 * global flag. The `<id>-` prefix prevents most collisions; this catches edge
 * cases (e.g. an agent id that happens to match a global flag prefix).
 *
 * Pass the set of reserved global flag names here from the CLI module. Throws
 * a descriptive Error on the first collision.
 */
export function assertNoGlobalCollisions(
  profiles: AgentProfile[],
  reservedGlobalFlags: ReadonlySet<string>,
): void {
  const seen = new Map<string, string>(); // cliName → owner profile id
  for (const profile of profiles) {
    for (const opt of profile.options ?? []) {
      const cliName = `${profile.id}-${opt.name}`;
      if (reservedGlobalFlags.has(cliName)) {
        throw new Error(
          `Profile option ${profile.id}.${opt.name} produces CLI flag --${cliName} which collides with a reserved global flag.`,
        );
      }
      const prevOwner = seen.get(cliName);
      if (prevOwner && prevOwner !== profile.id) {
        throw new Error(
          `Profile option collision: ${profile.id}.${opt.name} and ${prevOwner}.${opt.name} both produce --${cliName}.`,
        );
      }
      seen.set(cliName, profile.id);
    }
  }
}

/**
 * Env-var name carrying the parsed value of `--<id>-<name>`.
 *
 * Format: `SAIFCTL_AGENT_OPT_<ID>_<NAME>` with id/name uppercased and
 * `-` replaced with `_`. Stable across CLI invocations.
 */
export function envKeyFor(profileId: string, optionName: string): string {
  const norm = (s: string): string => s.toUpperCase().replace(/-/g, '_');
  return `SAIFCTL_AGENT_OPT_${norm(profileId)}_${norm(optionName)}`;
}

function parseValue(type: AgentProfileOption['type'], raw: string): boolean | string | number {
  switch (type) {
    case 'boolean':
      return raw === 'true';
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new Error(`Cannot parse ${JSON.stringify(raw)} as number`);
      }
      return n;
    }
    case 'string':
      return raw;
  }
}
