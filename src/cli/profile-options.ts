/**
 * CLI-side helpers for wiring profile options into the env-var protocol
 * read by orchestrator (`readProfileOptionsFromEnv` →
 * `prepareAgentEnv({ options, ... })`).
 *
 * The agent option-bridge has to run AFTER the active agent profile is
 * resolved with full precedence (CLI > feature.yml > saifctl/config.ts >
 * built-in default — see {@link pickAgentProfile}). Earlier versions of
 * the CLI gated the bridge on `args.agent` being non-empty, which silently
 * dropped `agentOptions.<id>.*` blocks declared in `saifctl/config.ts`
 * when the user relied on config to select the agent. This helper runs the
 * full chain (`recordProfileOptionsFromArgs` → `applyConfigToProfileOptionsEnv`
 * → `validateProfileOptions`) against the resolved profile regardless of
 * how that profile was selected.
 */

import type { AgentProfile } from '../agent-profiles/index.js';
import {
  applyConfigToProfileOptionsEnv,
  recordProfileOptionsFromArgs,
  validateProfileOptions,
} from '../agent-profiles/options-bridge.js';
import type { SaifctlConfig } from '../config/schema.js';
import { pickAgentProfile } from '../orchestrator/options.js';
import type { FeatureConfig } from '../specs/phases/schema.js';

/**
 * Resolve the active agent profile via {@link pickAgentProfile}, then wire
 * its options into the env-var protocol that `prepareAgentEnv` reads later.
 *
 * Order (per {@link recordAndValidateProfileOptions} doc), most-specific
 * wins — every step is "fill gaps only":
 *
 *   1. {@link recordProfileOptionsFromArgs}    ← CLI `--<id>-<name>` flags
 *   2. {@link applyConfigToProfileOptionsEnv}  ← feature.yml `agent.options.<name>`
 *   3. {@link applyConfigToProfileOptionsEnv}  ← `defaults.agentOptions.<id>.<name>`
 *   4. {@link validateProfileOptions}          ← validate merged result
 *
 * Feature-level wins over project-level because the CLI fills gaps in
 * order — calling with feature config first locks feature values into
 * the env-var protocol before the project-level call gets a chance to
 * fill them. Profile-declared defaults are the final fallback (read in
 * `readProfileOptionsFromEnv`).
 *
 * Per-phase `agent.options` is NOT wired here — that lives on each
 * subtask's `agentProfileOptions` field (resolved in
 * `compilePhasesToSubtasks`) and reaches the agent via the per-subtask
 * env file (`subtask-env.sh`), sourced fresh on every inner round. The
 * value baked into the env-var protocol here is the run-wide baseline
 * the phase overrides flow on top of.
 *
 * Returns the resolved profile so callers don't have to re-pick.
 *
 * @param opts.args - Citty-parsed argv as a plain record (for the
 *   `--<id>-<name>` CLI flag values).
 * @param opts.config - Loaded `saifctl/config.ts` (for
 *   `defaults.agentProfile` + `defaults.agentOptions.<id>`).
 * @param opts.featureCfg - Loaded `feature.yml` (for `agent.profile` +
 *   `agent.options.<name>`); pass `null` / `undefined` when the call
 *   site has no feature context (e.g. `saifctl sandbox`).
 */
export async function wireAgentProfileOptions(opts: {
  args: Record<string, unknown>;
  config: SaifctlConfig | undefined;
  featureCfg?: FeatureConfig | null;
}): Promise<AgentProfile> {
  const cliId = typeof opts.args.agent === 'string' ? opts.args.agent : undefined;
  const profile = pickAgentProfile(cliId, opts.config, opts.featureCfg ?? null);

  recordProfileOptionsFromArgs(profile, opts.args);
  // Feature-level options layer above project-level (per agentConfigSchema
  // `options` doc). `applyConfigToProfileOptionsEnv` fills gaps only, so
  // calling with feature config first ensures feature.yml wins on every
  // key it sets.
  applyConfigToProfileOptionsEnv(profile, opts.featureCfg?.agent?.options);
  applyConfigToProfileOptionsEnv(profile, opts.config?.defaults?.agentOptions?.[profile.id]);
  await validateProfileOptions(profile);

  return profile;
}
