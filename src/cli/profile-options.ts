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
 * Order (per {@link recordAndValidateProfileOptions} doc):
 *   1. {@link recordProfileOptionsFromArgs}    ← CLI `--<id>-<name>` flags win
 *   2. {@link applyConfigToProfileOptionsEnv}  ← `agentOptions.<id>.*` fills gaps
 *   3. {@link validateProfileOptions}          ← validate merged result
 *
 * Returns the resolved profile so callers don't have to re-pick.
 *
 * @param opts.args - Citty-parsed argv as a plain record (for the
 *   `--<id>-<name>` CLI flag values).
 * @param opts.config - Loaded `saifctl/config.ts` (for
 *   `defaults.agentProfile` + `defaults.agentOptions.<id>`).
 * @param opts.featureCfg - Loaded `feature.yml` (for `agent.profile`);
 *   pass `null` / `undefined` when the call site has no feature context
 *   (e.g. `saifctl sandbox`).
 */
export async function wireAgentProfileOptions(opts: {
  args: Record<string, unknown>;
  config: SaifctlConfig | undefined;
  featureCfg?: FeatureConfig | null;
}): Promise<AgentProfile> {
  const cliId = typeof opts.args.agent === 'string' ? opts.args.agent : undefined;
  const profile = pickAgentProfile(cliId, opts.config, opts.featureCfg ?? null);

  recordProfileOptionsFromArgs(profile, opts.args);
  applyConfigToProfileOptionsEnv(profile, opts.config?.defaults?.agentOptions?.[profile.id]);
  await validateProfileOptions(profile);

  return profile;
}
