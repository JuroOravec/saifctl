#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';

import { resolveAgentProfile, SUPPORTED_AGENT_PROFILES } from '../agent-profiles/index.js';
import {
  assertNoGlobalCollisions,
  buildProfileCliFlags,
  type ProfileWithOptions,
} from '../agent-profiles/options-bridge.js';
import { getSaifctlPackageVersion } from '../constants.js';
import { resolveDesignerProfile } from '../designer-profiles/index.js';
import { resolveIndexerProfile } from '../indexer-profiles/index.js';
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
 * Pre-parse a single `--<flag> <value>` (or `--<flag>=<value>`, or alias
 * `-<short> <value>`) from argv. Used to extract `--agent`, `--designer`,
 * and `--indexer` before runMain dispatches.
 */
function preParseFlagValue(opts: {
  argv: string[];
  long: string;
  short?: string;
}): string | undefined {
  const { argv, long, short } = opts;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const longSwitch = `--${long}`;
    if (a === longSwitch && i + 1 < argv.length) return argv[i + 1];
    if (a.startsWith(`${longSwitch}=`)) return a.slice(longSwitch.length + 1);
    if (short && a === `-${short}` && i + 1 < argv.length) return argv[i + 1];
  }
  return undefined;
}

/**
 * Type for a citty command's `args` field as a mutable record. Citty's TS
 * types narrow `args` to the exact shape declared at `defineCommand` call
 * time, but `defineCommand` is a runtime passthrough (returns its arg
 * unchanged), so widening for in-place mutation is safe.
 */
type MutableArgs = { args?: Record<string, unknown> };

/**
 * Inject a profile's `options[]` into the given command's `args` record.
 * No-op if the profile is missing or declares no options.
 */
function injectFlagsInto(command: MutableArgs | undefined, profile: ProfileWithOptions): void {
  if (!command) return;
  const flags = buildProfileCliFlags(profile);
  if (Object.keys(flags).length === 0) return;
  command.args = { ...(command.args ?? {}), ...flags };
}

/**
 * Inject options from the active agent / designer / indexer profiles into the
 * citty command schemas before runMain dispatches.
 *
 * Citty's `defineCommand` is a passthrough, so mutating `command.args` here
 * is safe — citty parses against the post-mutation shape. This lets
 * profile-declared flags like `--claude-max`, `--shotgun-foo`, etc. be real
 * CLI flags with type validation and help text without saifctl needing
 * profile-specific knowledge at the central CLI definition site.
 *
 * Per-profile-kind injection mapping:
 *
 *   --agent <id>     → flags injected into `feat run`, `sandbox`
 *   --designer <id>  → flags injected into `feat design`,
 *                       `feat design-specs`, `feat design-discovery`,
 *                       `feat design-tests`, `feat design-fail2pass`
 *   --indexer <id>   → flags injected into `init`, all `feat design*` commands
 *
 * Each profile is independent — saifctl pre-parses each flag separately and
 * only consults the profile relevant to that flag (no cross-pollination
 * between agent + designer + indexer namespaces).
 */
function injectActiveProfileFlags(): void {
  // Startup-time guard: every shipped agent profile's flags use the
  // `<id>-` prefix; nothing collides with reserved global flags. Designer
  // and indexer profiles are validated the same way once they declare
  // options.
  const reservedGlobalFlags = new Set<string>([]);
  assertNoGlobalCollisions(Object.values(SUPPORTED_AGENT_PROFILES), reservedGlobalFlags);

  const argv = process.argv.slice(2);
  type MutableSubCommands = Record<string, MutableArgs>;
  const featSubs = featCommand.subCommands as MutableSubCommands | undefined;

  // 1. Agent profile flags → feat run, sandbox
  const agentId = preParseFlagValue({ argv, long: 'agent', short: 'a' });
  if (agentId) {
    try {
      const agentProfile = resolveAgentProfile(agentId);
      injectFlagsInto(featSubs?.run, agentProfile);
      injectFlagsInto(sandboxCommand as MutableArgs, agentProfile);
    } catch {
      // Invalid --agent value: let citty surface the error during normal parse.
    }
  }

  // 2. Designer profile flags → all feat design* subcommands
  const designerId = preParseFlagValue({ argv, long: 'designer' });
  if (designerId) {
    try {
      const designerProfile = resolveDesignerProfile(designerId);
      for (const sub of [
        'design',
        'design-specs',
        'design-discovery',
        'design-tests',
        'design-fail2pass',
      ] as const) {
        injectFlagsInto(featSubs?.[sub], designerProfile);
      }
    } catch {
      // Invalid --designer value: let citty surface the error during normal parse.
    }
  }

  // 3. Indexer profile flags → init + feat design*
  const indexerId = preParseFlagValue({ argv, long: 'indexer' });
  if (indexerId && indexerId !== 'none') {
    try {
      const indexerProfile = resolveIndexerProfile(indexerId);
      if (indexerProfile) {
        injectFlagsInto(initCommand as MutableArgs, indexerProfile);
        for (const sub of [
          'design',
          'design-specs',
          'design-discovery',
          'design-tests',
          'design-fail2pass',
        ] as const) {
          injectFlagsInto(featSubs?.[sub], indexerProfile);
        }
      }
    } catch {
      // Invalid --indexer value: let citty surface the error during normal parse.
    }
  }
}

const cli = () => {
  injectActiveProfileFlags();
  void runMain(main);
};

cli();
