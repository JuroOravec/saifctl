/**
 * Per-subtask env file (per-phase-config phase 7.4 — Level 1.5).
 *
 * Bridges per-phase env / model / reviewer / secret overrides into a
 * bash-sourcable file that `coder-start.sh` re-`source`s on every inner
 * round. The file lives at `<saifctlPath>/subtask-env.sh`, is bind-mounted
 * read-only into the container at `/saifctl/subtask-env.sh`, and is
 * rewritten by the host at each subtask transition.
 *
 * Why this and not `docker exec -e VAR=VAL`: the agent runs as a
 * descendant of the long-lived `coder-start.sh` process (not via
 * `docker exec`), so a separate exec wouldn't see the new env. The
 * file-source pattern matches what we already do for `gate.sh`,
 * `agent.sh`, and `stage.sh` — bind-mounted, rewritten between subtasks.
 *
 * **Cross-phase transition correctness (full-resolved + shadow-keys).**
 * The naïve "write only the per-phase delta" approach silently leaks state
 * across phase boundaries: subtask N (phase A) writes `export FOO='bar'`
 * → shell has `FOO=bar`; subtask N+1 (phase B, no override) writes an
 * empty file → sourcing is a no-op → `FOO=bar` from phase A persists,
 * but should have reverted to the run-level baseline. Same shape as the
 * agent.sh / stage.sh leak bugs caught in the 7.2 / 7.3 reviews. The fix
 * here:
 *   1. Always write the **full resolved env** (run-level baseline +
 *      active overrides), not the delta — so a non-overriding phase
 *      gets the baseline values back.
 *   2. Pass a **shadow-keys** set listing every key that any subtask in
 *      the run might set; emit `unset KEY` for any shadow key that is
 *      *not* in the active subtask's resolved env. This handles
 *      phase-A-only-added keys (`agent.env: {PHASE_A_VAR: x}` followed
 *      by a phase-B without that key): phase-B's file emits
 *      `unset PHASE_A_VAR`, restoring the shell to a clean state.
 * Sourcing then brings the shell to the correct state regardless of
 * what was sourced before.
 *
 * **`agent.secrets` allow-list.** A phase config can name any host env
 * var via `agent.secrets`. Without a policy, that's an exfiltration
 * vector — `agent.secrets: [HOME, AWS_SECRET_ACCESS_KEY]` would copy
 * those values into the bind-mounted env file. The allow-list permits
 * only names that the operator already approved at run-level
 * (`defaults.agentSecretKeys` / `--agent-secret`) plus a built-in
 * pattern set (`*_API_KEY`, `*_TOKEN`) that captures the common case
 * of agent-provider tokens. Anything else is dropped with a warning.
 * Per-phase-config design.md §7.4.
 *
 * Two stages:
 * 1. {@link computeSubtaskEnv} — merge run-level baseline with the
 *    active subtask's overrides into a flat `Record<string, string | null>`.
 *    `null` values render as `unset VAR`, so a phase-level
 *    `agent.reviewer: false` cleanly flips a run-level `true`.
 * 2. {@link renderSubtaskEnvFile} — render the resolved map as a
 *    bash-sourcable script with shell-quoted values.
 *
 * Plus {@link writeSubtaskEnvFile} which marries them and writes the file
 * with mode `0o600` via temp+rename atomic swap (no readable partial
 * file mid-rewrite — secret values live here).
 */

import { chmod, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  type LlmConfig,
  type LlmOverrides,
  resolveAgentLlmConfigForContainer,
} from '../llm-config.js';
import { consola } from '../logger.js';
import type { RunSubtask, RunSubtaskInput } from '../runs/types.js';

/** File name written next to `gate.sh` / `agent.sh` / `stage.sh` in the sandbox saifctl dir. */
export const SUBTASK_ENV_FILENAME = 'subtask-env.sh';

/**
 * Resolved env for a single subtask. Values:
 * - `string` → rendered as `export KEY='value'`.
 * - `null`   → rendered as `unset KEY`. Used to override a run-level
 *   true with a phase-level false (e.g. `agent.reviewer: false` over a
 *   run-level reviewer-enabled).
 *
 * Reserved factory keys (`SAIFCTL_*`, `LLM_*`, etc.) are filtered at
 * write time only when they originate from user-supplied `agent.env` —
 * compile-derived `LLM_*` and `SAIFCTL_REVIEWER_ENABLED` entries are
 * intentionally written by us.
 */
export type SubtaskEnvMap = Record<string, string | null>;

/** Run-level baseline env values relevant to per-subtask resolution. */
export interface SubtaskEnvBaseline {
  /**
   * Run-level `--agent-env` map. Always re-emitted in the resolved env
   * so a phase that overrides a baseline key correctly reverts to the
   * baseline value when a subsequent phase doesn't override.
   */
  agentEnv: Record<string, string>;
  /**
   * Run-level secret-key names. Always re-emitted (resolved against
   * `hostEnv`) for the same cross-phase-revert reason as `agentEnv`.
   * Acts as the implicit "operator-approved" allow-list for any
   * per-phase `agent.secrets` declarations — see {@link computeSubtaskEnv}.
   */
  agentSecretKeys: readonly string[];
  /** Run-level `LlmOverrides` (CLI > config > built-ins, already merged). */
  llm: LlmOverrides;
  /** Run-level reviewer flag. Per-phase `agent.reviewer` overrides this. */
  reviewerEnabled: boolean;
  /**
   * Source of host env values. Defaulted to `process.env` so callers
   * don't have to plumb it through; tests inject a fixture.
   */
  hostEnv?: NodeJS.ProcessEnv;
}

/** Subset of the subtask shape this resolver reads. Accepts manifest + runtime rows. */
export type SubtaskWithLevel1_5Overrides = Pick<
  RunSubtask | RunSubtaskInput,
  | 'agentEnv'
  | 'agentSecretKeys'
  | 'llmOverrides'
  | 'reviewerEnabled'
  | 'agentProfileId'
  | 'agentProfileOptions'
>;

/**
 * Translate an agent-profile option name to its env-var protocol key
 * (`SAIFCTL_AGENT_OPT_<ID>_<NAME>` with id/name uppercased and `-`
 * replaced with `_`). Mirrors `agent-profiles/options-bridge.ts:envKeyFor`
 * — inlined here to avoid a cross-cutting import for one function.
 */
function profileOptEnvKey(profileId: string, optionName: string): string {
  const norm = (s: string): string => s.toUpperCase().replace(/-/g, '_');
  return `SAIFCTL_AGENT_OPT_${norm(profileId)}_${norm(optionName)}`;
}

/**
 * Reserved factory env keys we never let user-supplied `agent.env`
 * shadow. Mirrors `agent-env.ts:RESERVED_ENV_KEYS` semantics — we don't
 * import that constant directly because the per-subtask path only
 * filters user-provided `agent.env` (the LLM_* / SAIFCTL_REVIEWER_ENABLED
 * entries we WRITE here are not user-supplied).
 */
const USER_ENV_RESERVED_PREFIXES = ['SAIFCTL_', 'LLM_', 'REVIEWER_LLM_'];

function isReservedKey(key: string): boolean {
  return USER_ENV_RESERVED_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Built-in allow-patterns for per-phase `agent.secrets` host env names.
 * A phase can declare any name matching one of these (`OPENAI_API_KEY`,
 * `GITHUB_TOKEN`, …) without an explicit run-level allow entry —
 * captures the common agent-provider-token case while still rejecting
 * arbitrary host vars (`HOME`, `SSH_AUTH_SOCK`, `AWS_SECRET_ACCESS_KEY`,
 * …). Operator-approved names (run-level `defaults.agentSecretKeys` /
 * `--agent-secret`) are also allowed; see {@link isAllowedSecretName}.
 */
const SECRET_NAME_ALLOW_PATTERNS: readonly RegExp[] = [/_API_KEY$/, /_TOKEN$/];

function isAllowedSecretName(name: string, runLevelApproved: readonly string[]): boolean {
  if (runLevelApproved.includes(name)) return true;
  return SECRET_NAME_ALLOW_PATTERNS.some((re) => re.test(name));
}

/** Always-managed env keys derived from non-`agent.env` baseline state (LLM, reviewer). */
const ALWAYS_MANAGED_KEYS: readonly string[] = [
  'SAIFCTL_REVIEWER_ENABLED',
  'LLM_MODEL',
  'LLM_MODEL_ID',
  'LLM_PROVIDER',
  'LLM_BASE_URL',
  'LLM_API_KEY',
];

/**
 * Build the cross-subtask shadow-keys set: every env key any subtask in
 * the run might set, including run-level baseline + every per-subtask
 * `agent.env` / `agent.secrets` declaration.
 *
 * Used by {@link computeSubtaskEnv} to emit explicit `unset KEY` for any
 * shadow key not in the active subtask's resolved env. That makes phase
 * boundaries idempotent: a key added by phase A but absent in phase B
 * is unset on the way into phase B, so phase B doesn't inherit the
 * stale export. Reviewed in per-phase-config phase 7.4 review F-A.
 */
export function buildSubtaskEnvShadowKeys(opts: {
  baseline: SubtaskEnvBaseline;
  subtasks: readonly SubtaskWithLevel1_5Overrides[];
}): ReadonlySet<string> {
  const out = new Set<string>();
  // Always-managed keys (LLM_*, SAIFCTL_REVIEWER_ENABLED).
  for (const k of ALWAYS_MANAGED_KEYS) out.add(k);
  // Run-level baseline.
  for (const k of Object.keys(opts.baseline.agentEnv)) {
    if (!isReservedKey(k)) out.add(k);
  }
  for (const k of opts.baseline.agentSecretKeys) {
    if (!isReservedKey(k)) out.add(k);
  }
  // Per-subtask overrides — union across the whole run so phase-only
  // keys land in the shadow set even when not the active subtask.
  for (const st of opts.subtasks) {
    for (const k of Object.keys(st.agentEnv ?? {})) {
      if (!isReservedKey(k)) out.add(k);
    }
    for (const k of st.agentSecretKeys ?? []) {
      if (!isReservedKey(k)) out.add(k);
    }
  }
  return out;
}

/**
 * Compute the resolved per-subtask env. Writes the **full resolved
 * state** (run-level baseline + active overrides), not a delta — see
 * the file-header note on cross-phase transition correctness.
 *
 * Layering (last-wins per key):
 *
 * 1. Run-level `agentEnv` (always re-emitted; reserved keys filtered).
 * 2. Run-level `agentSecretKeys` (resolved from `hostEnv`; missing host
 *    values silently skipped — matches container `docker run -e`
 *    behavior). Acts as the implicit allow-list for step 4.
 * 3. Active subtask `agent.env` overrides (reserved keys warned +
 *    dropped). Replaces step-1 keys.
 * 4. Active subtask `agent.secrets` (additive over baseline; allow-list
 *    enforced via {@link isAllowedSecretName}). Names rejected by the
 *    allow-list are dropped with a warning.
 * 5. `agent.reviewer` → `SAIFCTL_REVIEWER_ENABLED` (string `'1'` or
 *    `null` for unset). Active overrides baseline.
 * 6. `agent.model` / `agent.base-url` merged with baseline `llm`,
 *    resolved via {@link resolveAgentLlmConfigForContainer}. Emits
 *    `LLM_MODEL`, `LLM_MODEL_ID`, `LLM_PROVIDER`, `LLM_BASE_URL`,
 *    `LLM_API_KEY`.
 * 7. Shadow-keys sweep: any key in `shadowKeys` not present in the
 *    resolved set above is emitted as `null` (unset). Without this,
 *    phase-A-only-added keys leak into phase B.
 */
export function computeSubtaskEnv(opts: {
  active: SubtaskWithLevel1_5Overrides | undefined;
  baseline: SubtaskEnvBaseline;
  /**
   * Cross-subtask shadow-keys set (see {@link buildSubtaskEnvShadowKeys}).
   * When omitted, the resolver emits the resolved set without `unset`
   * directives — useful for tests that inspect just the active layer
   * without tracking the run-wide key space.
   */
  shadowKeys?: ReadonlySet<string>;
}): SubtaskEnvMap {
  const out: SubtaskEnvMap = {};
  const a = opts.active;
  const baseline = opts.baseline;
  const hostEnv = baseline.hostEnv ?? process.env;

  // 1. Run-level agent.env (always re-emitted so phase-overridden keys
  // revert correctly when a subsequent phase doesn't override).
  for (const [k, v] of Object.entries(baseline.agentEnv)) {
    if (isReservedKey(k)) continue;
    out[k] = v;
  }

  // 2. Run-level agent.secrets (resolve from host env).
  for (const name of baseline.agentSecretKeys) {
    if (isReservedKey(name)) continue;
    const v = hostEnv[name];
    if (v !== undefined) out[name] = v;
  }

  // 3. Active subtask agent.env (filtered; overrides baseline).
  for (const [key, val] of Object.entries(a?.agentEnv ?? {})) {
    if (isReservedKey(key)) {
      consola.warn(
        `[per-subtask-env] WARNING: phase agent.env key '${key}' shadows a reserved factory variable and will be ignored.`,
      );
      continue;
    }
    out[key] = val;
  }

  // 4. Active subtask agent.secrets (additive; allow-list enforced).
  for (const name of a?.agentSecretKeys ?? []) {
    if (isReservedKey(name)) {
      consola.warn(
        `[per-subtask-env] WARNING: phase agent.secrets entry '${name}' shadows a reserved factory variable and will be ignored.`,
      );
      continue;
    }
    if (!isAllowedSecretName(name, baseline.agentSecretKeys)) {
      consola.warn(
        `[per-subtask-env] WARNING: phase agent.secrets entry '${name}' is not in the allow-list and will be skipped. ` +
          `Allow-list: run-level \`--agent-secret\` / \`defaults.agentSecretKeys\` plus names matching ` +
          `${SECRET_NAME_ALLOW_PATTERNS.map((p) => p.source).join(', ')}.`,
      );
      continue;
    }
    const v = hostEnv[name];
    if (v === undefined) {
      // Match run-level behavior: silently skip names not present on the
      // host. The agent's CLI is responsible for failing loudly when a
      // missing secret is actually required for inference.
      continue;
    }
    out[name] = v;
  }

  // 5. Reviewer toggle (active overrides baseline).
  const reviewerEffective =
    a?.reviewerEnabled !== undefined ? a.reviewerEnabled : baseline.reviewerEnabled;
  out.SAIFCTL_REVIEWER_ENABLED = reviewerEffective ? '1' : null;

  // 6. Agent-profile options (per-phase `agent.options` deltas). When the
  // active subtask declares overrides, emit them as
  // `SAIFCTL_AGENT_OPT_<ID>_<NAME>=value` so the inner round (and any
  // profile-aware agent.sh that reads the env-var protocol) sees the
  // per-phase value. The active subtask's `agentProfileId` determines
  // the env-var prefix.
  //
  // **Cross-phase leak — known limitation.** The run-wide baseline
  // values for `SAIFCTL_AGENT_OPT_*` are set on the coder container at
  // startup (from `prepareAgentEnv` reading `readProfileOptionsFromEnv`).
  // When a phase declares an override and a subsequent phase does NOT,
  // the override survives in the container's shell across the phase
  // boundary because we don't include `SAIFCTL_AGENT_OPT_*` in the
  // shadow-keys sweep below. Run-wide + feature-level usage is correct;
  // proper per-phase isolation needs a follow-up (track + emit the
  // run-wide baseline + shadow-keys for this prefix, same pattern as
  // SAIFCTL_REVIEWER_ENABLED). Documented at
  // saifctl/features/per-phase-config/design.md (followup) and the
  // agentConfigSchema `options` doc.
  if (a?.agentProfileOptions && a.agentProfileId) {
    for (const [name, value] of Object.entries(a.agentProfileOptions)) {
      const key = profileOptEnvKey(a.agentProfileId, name);
      out[key] = typeof value === 'string' ? value : String(value);
    }
  }

  // 7. LLM config (baseline merged with active overrides). ALWAYS emit
  // the resolved env, regardless of whether overrides are present.
  //
  // Why unconditional: `LLM_*` is in {@link ALWAYS_MANAGED_KEYS}, so the
  // shadow-keys sweep would unset any LLM_* the active set doesn't
  // include. Skipping emission here when both baseline and active have
  // no deltas would let the sweep wipe the container's LLM_* values
  // (which `agent-env.ts:buildCoderContainerEnv` set at `docker run -e`
  // time from the agent profile's default model). This is the same
  // shape as the cross-phase leak bugs the file-header note guards
  // against — except inverted: the leak would be from container env
  // *into* the file's unset directive. Emitting unconditionally keeps
  // the sourced shell aligned with the container baseline whenever no
  // phase overrides apply.
  const mergedLlm = mergeLlmOverridesLocal(baseline.llm, a?.llmOverrides ?? {});
  const llmConfig = resolveAgentLlmConfigForContainer('coder', mergedLlm);
  Object.assign(out, llmEnvFromConfig(llmConfig));

  // 8. Shadow-keys sweep. Any key the run might touch but the active
  // subtask doesn't resolve gets an explicit `unset`, so prior subtasks'
  // exports don't survive into the active shell. See file header
  // (cross-phase transition correctness). NOTE: `SAIFCTL_AGENT_OPT_*`
  // keys are intentionally NOT in the shadow set today — see the leak
  // comment in step 6.
  if (opts.shadowKeys) {
    for (const k of opts.shadowKeys) {
      if (!(k in out)) out[k] = null;
    }
  }

  return out;
}

/**
 * Local two-layer merge of {@link LlmOverrides} — baseline below,
 * delta on top. Mirrors `options.ts:mergeLlmOverridesLayers` but is
 * inlined here to avoid a `sandbox.ts → per-subtask-env.ts → options.ts
 * → sandbox.ts` import cycle (the cycle's late-init order leaves
 * sandbox-exported constants unset when transitively-imported modules
 * read them at top level).
 *
 * Per-field winner: `delta` overrides `baseline`. Map-valued fields
 * (`agentModels`, `agentBaseUrls`) merge by key — same as the
 * canonical helper.
 */
function mergeLlmOverridesLocal(baseline: LlmOverrides, delta: LlmOverrides): LlmOverrides {
  const out: LlmOverrides = { ...baseline };
  if (delta.globalModel !== undefined) out.globalModel = delta.globalModel;
  if (delta.globalBaseUrl !== undefined) out.globalBaseUrl = delta.globalBaseUrl;
  if (delta.agentModels) out.agentModels = { ...out.agentModels, ...delta.agentModels };
  if (delta.agentBaseUrls) out.agentBaseUrls = { ...out.agentBaseUrls, ...delta.agentBaseUrls };
  return out;
}

function llmEnvFromConfig(c: LlmConfig): Record<string, string> {
  const env: Record<string, string> = {
    LLM_MODEL: c.fullModelString,
    LLM_MODEL_ID: c.modelId,
  };
  if (c.provider) env.LLM_PROVIDER = c.provider;
  if (c.baseURL) env.LLM_BASE_URL = c.baseURL;
  // ALWAYS write LLM_API_KEY, including the `'sk-none'` sentinel.
  //
  // Why: with the shadow-keys sweep emitting `unset` for any LLM_*
  // not in the resolved set, skipping LLM_API_KEY (the previous
  // "don't overwrite a real run-level key with 'sk-none'" heuristic)
  // would let the sweep delete the key entirely from the shell. The
  // result was worse than the original concern — phase B's file
  // would unset LLM_API_KEY, leaving the agent without auth. By
  // always writing the resolver's value, the sourced shell stays
  // aligned with the resolved provider: if the host had a key, it's
  // exported; if not, `'sk-none'` produces a clear 401 from the
  // provider rather than a confusing missing-key error. See
  // per-phase-config 7.4 review F-A.
  env.LLM_API_KEY = c.apiKey;
  return env;
}

/**
 * Render a {@link SubtaskEnvMap} as a bash-sourcable script. Values are
 * single-quote-escaped so any byte sequence (incl. newlines, `$`,
 * backticks, `'`) renders safely. `null` values render as `unset KEY`.
 *
 * Output ends with a trailing newline. Keys are emitted in lexicographic
 * order so the file is diff-stable across re-renders with the same input.
 */
export function renderSubtaskEnvFile(env: SubtaskEnvMap): string {
  const keys = Object.keys(env).sort();
  const lines: string[] = [
    '#!/bin/bash',
    '# Auto-generated by saifctl (per-phase-config phase 7.4).',
    "# Sourced by coder-start.sh on every inner round. Don't edit by hand.",
    '',
  ];
  for (const k of keys) {
    const v = env[k];
    if (v === null) {
      lines.push(`unset ${k}`);
    } else {
      lines.push(`export ${k}=${shellSingleQuote(v)}`);
    }
  }
  lines.push(''); // trailing newline
  return lines.join('\n');
}

/**
 * POSIX shell single-quote escape: wrap in `'…'`, with embedded `'`
 * rendered as `'\''` (close, escape, reopen). Handles every byte
 * including newlines and binary garbage. Matches what GNU `printf %q`
 * produces in `shquote` mode.
 */
function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Write the rendered env file at `<saifctlPath>/subtask-env.sh` with
 * mode `0o600`. Uses temp+rename so a coder reading the file mid-write
 * sees either old or new, never partial. Mode is set BEFORE the rename
 * so the file's first appearance at its final path already has the
 * correct permissions.
 */
export async function writeSubtaskEnvFile(opts: {
  saifctlPath: string;
  env: SubtaskEnvMap;
}): Promise<void> {
  const finalPath = join(opts.saifctlPath, SUBTASK_ENV_FILENAME);
  const tempPath = `${finalPath}.tmp`;
  const content = renderSubtaskEnvFile(opts.env);
  await writeFile(tempPath, content, 'utf8');
  await chmod(tempPath, 0o600);
  await rename(tempPath, finalPath);
}
