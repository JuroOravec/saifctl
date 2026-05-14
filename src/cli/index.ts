#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';

import { SUPPORTED_AGENT_PROFILES } from '../agent-profiles/index.js';
import {
  assertNoGlobalCollisions,
  buildProfileCliFlags,
  type ProfileWithOptions,
} from '../agent-profiles/options-bridge.js';
import { getSaifctlPackageVersion } from '../constants.js';
import { SUPPORTED_DESIGNER_PROFILES } from '../designer-profiles/index.js';
import { SUPPORTED_INDEXER_PROFILES } from '../indexer-profiles/index.js';
import cacheCommand from './commands/cache.js';
import doctorCommand from './commands/doctor.js';
import { default as featCommand, featureCommand } from './commands/feat.js';
import initCommand from './commands/init.js';
import runCommand from './commands/run.js';
import sandboxCommand from './commands/sandbox.js';
import versionCommand from './commands/version.js';

const main = defineCommand({
  meta: {
    name: 'saifctl',
    version: getSaifctlPackageVersion(),
    description:
      'SaifCTL: spec-driven AI factory. Use with any agentic CLI. Language-agnostic. Safe by design.',
  },
  subCommands: {
    cache: cacheCommand,
    doctor: doctorCommand,
    feat: featCommand,
    feature: featureCommand,
    init: initCommand,
    run: runCommand,
    sandbox: sandboxCommand,
    version: versionCommand,
  },
});

/**
 * Type for a citty command's `args` field as a mutable record. Citty's TS
 * types narrow `args` to the exact shape declared at `defineCommand` call
 * time, but `defineCommand` is a runtime passthrough (returns its arg
 * unchanged), so widening for in-place mutation is safe.
 */
type MutableArgs = { args?: Record<string, unknown> };

/**
 * Inject every profile's `options[]` into the given command's `args` record.
 * No-op for profiles that declare no options.
 *
 * Profile option names are prefixed with `<profile.id>-` (per
 * {@link buildProfileCliFlags}), so flag namespaces are isolated per profile
 * and won't collide across profile kinds. `assertNoGlobalCollisions`
 * verifies this at startup over the full set.
 */
function injectAllFlagsInto(
  command: MutableArgs | undefined,
  profiles: readonly ProfileWithOptions[],
): void {
  if (!command) return;
  for (const profile of profiles) {
    const flags = buildProfileCliFlags(profile);
    if (Object.keys(flags).length === 0) continue;
    command.args = { ...(command.args ?? {}), ...flags };
  }
}

/**
 * Inject options from every agent / designer / indexer profile into the
 * relevant citty command schemas before runMain dispatches.
 *
 * Citty's `defineCommand` is a passthrough, so mutating `command.args` here
 * is safe — citty parses against the post-mutation shape. This lets
 * profile-declared flags like `--claude-max`, `--shotgun-foo`, etc. be real
 * CLI flags with type validation and help text without saifctl needing
 * profile-specific knowledge at the central CLI definition site.
 *
 * Why always-inject instead of pre-parsing the selected profile id: the
 * active profile is resolved with full precedence (CLI > feature.yml >
 * saifctl/config.ts > built-in) inside the handler, not from argv alone.
 * Injecting only the CLI-selected profile's flags would silently drop
 * config- or feature.yml-selected profiles' options. Cost: `--help` lists
 * a handful of extra `--<id>-<name>` flags per command. Safety: flags for
 * a profile that doesn't end up being the active one are silently ignored
 * by {@link readProfileOptionsFromEnv} (it only iterates the active
 * profile's option set).
 *
 * Per-profile-kind injection mapping:
 *
 *   agent     → `feat run`, `sandbox`
 *   designer  → `feat design`, `feat design-specs`, `feat design-discovery`,
 *               `feat design-tests`, `feat design-fail2pass`
 *   indexer   → `init`, all `feat design*` commands
 */
function injectAllProfileFlags(): void {
  const agentProfiles = Object.values(SUPPORTED_AGENT_PROFILES);
  const designerProfiles = Object.values(SUPPORTED_DESIGNER_PROFILES);
  const indexerProfiles = Object.values(SUPPORTED_INDEXER_PROFILES);

  // Startup-time guard: no profile option's CLI name may collide with a
  // reserved global flag or with another profile's option (different ids
  // could in principle pick the same `<id>-<name>` if ids weren't unique,
  // but they are — kept as a defence-in-depth check).
  const reservedGlobalFlags = new Set<string>([]);
  assertNoGlobalCollisions(
    [...agentProfiles, ...designerProfiles, ...indexerProfiles],
    reservedGlobalFlags,
  );

  type MutableSubCommands = Record<string, MutableArgs>;
  const featSubs = featCommand.subCommands as MutableSubCommands | undefined;

  // 1. Agent profile flags → feat run, sandbox
  injectAllFlagsInto(featSubs?.run, agentProfiles);
  injectAllFlagsInto(sandboxCommand as MutableArgs, agentProfiles);

  // 2. Designer profile flags → all feat design* subcommands
  const designSubs = [
    'design',
    'design-specs',
    'design-discovery',
    'design-tests',
    'design-fail2pass',
  ] as const;
  for (const sub of designSubs) {
    injectAllFlagsInto(featSubs?.[sub], designerProfiles);
  }

  // 3. Indexer profile flags → init + feat design*
  injectAllFlagsInto(initCommand as MutableArgs, indexerProfiles);
  for (const sub of designSubs) {
    injectAllFlagsInto(featSubs?.[sub], indexerProfiles);
  }
}

const cli = () => {
  injectAllProfileFlags();
  void runMain(main);
};

cli();
