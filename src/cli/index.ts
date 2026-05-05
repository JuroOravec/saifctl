#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';

import { resolveAgentProfile, SUPPORTED_AGENT_PROFILES } from '../agent-profiles/index.js';
import {
  assertNoGlobalCollisions,
  buildProfileCliFlags,
} from '../agent-profiles/options-bridge.js';
import { getSaifctlPackageVersion } from '../constants.js';
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
 * Pre-parse `--agent <id>` (or `-a <id>`, or `--agent=<id>`) from argv. Used
 * to dynamically extend the citty command schema with the active agent
 * profile's options before runMain starts parsing in earnest.
 *
 * Returns `undefined` when no `--agent` is passed (saifctl's runtime then
 * falls back to the default profile, currently openhands).
 */
function preParseAgentId(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if ((a === '--agent' || a === '-a') && i + 1 < argv.length) {
      return argv[i + 1];
    }
    if (a.startsWith('--agent=')) {
      return a.slice('--agent='.length);
    }
  }
  return undefined;
}

/**
 * Inject the active agent profile's `options[]` into the citty command
 * schemas for `feat run` and `sandbox` before runMain dispatches.
 *
 * Citty's `defineCommand` is a passthrough, so mutating `command.args` here
 * is safe — citty parses against the post-mutation shape. This is what
 * lets `--claude-max` (declared in the claude profile) be a real CLI flag
 * with type validation, help text, and value parsing without saifctl needing
 * to know about claude-specific options at the central CLI definition site.
 *
 * Skipped when the user passes `--agent-script` (no profile to consult) or
 * when the resolved profile declares no `options[]` (no-op).
 */
function injectActiveAgentProfileFlags(): void {
  // Reserved global flag names: any flag declared on featRun / sandbox today.
  // We don't enumerate the full set here — assertNoGlobalCollisions takes a
  // set; keep it empty for now and rely on the agent-id prefix as the
  // collision-prevention mechanism. If a profile ever declares an option
  // named exactly the same as a global flag, that's a profile bug to fix.
  const reservedGlobalFlags = new Set<string>([]);
  assertNoGlobalCollisions(Object.values(SUPPORTED_AGENT_PROFILES), reservedGlobalFlags);

  const argv = process.argv.slice(2);
  const requestedAgentId = preParseAgentId(argv);
  if (!requestedAgentId) return;

  let profile;
  try {
    profile = resolveAgentProfile(requestedAgentId);
  } catch {
    // Invalid --agent value: let citty surface the error during normal parse.
    return;
  }
  if (!profile.options || profile.options.length === 0) return;

  const flags = buildProfileCliFlags(profile);
  // `defineCommand` returned its arg unchanged, so `command.args` is mutable
  // — but citty's TS types narrow `args` to the exact shape declared at
  // call time. We bypass that with a wider Record cast. The shape we add
  // (citty arg defs) is structurally compatible at runtime.
  type MutableArgs = { args?: Record<string, unknown> };
  const featRun = (featCommand.subCommands as Record<string, MutableArgs> | undefined)?.run;
  if (featRun) {
    featRun.args = { ...(featRun.args ?? {}), ...flags };
  }
  const sandboxMutable = sandboxCommand as MutableArgs;
  sandboxMutable.args = { ...(sandboxMutable.args ?? {}), ...flags };
}

const cli = () => {
  injectActiveAgentProfileFlags();
  void runMain(main);
};

cli();
