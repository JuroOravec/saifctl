#!/usr/bin/env tsx
/**
 * Cache CLI — manage disposable sandbox dirs under the sandbox base (default: /tmp/saifac/sandboxes/).
 *
 * Usage: pnpm cache <subcommand> [options]
 *   list    List sandbox dirs for this project (--all: all projects)
 *   clear   Remove sandbox entries for this project (--all: everything in the base dir)
 */

import { readdir, rm as rmAsync } from 'node:fs/promises';
import { normalize, resolve } from 'node:path';

import { defineCommand, runMain } from 'citty';

import { consola } from '../../logger.js';
import { resolveSandboxBaseDir } from '../../orchestrator/options.js';
import { DEFAULT_SANDBOX_BASE_DIR, SAIFAC_TEMP_ROOT } from '../../orchestrator/sandbox.js';
import { pathExists } from '../../utils/io.js';
import { projectDirArg, sandboxBaseDirArg } from '../args.js';
import {
  readProjectDirFromCli,
  readSandboxBaseDirFromCli,
  resolveCliProjectDir,
  resolveProjectName,
} from '../utils.js';

function isSaifacTempRoot(dir: string): boolean {
  return normalize(resolve(dir)) === normalize(resolve(SAIFAC_TEMP_ROOT));
}

const listCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List sandbox dirs in the sandbox base dir for this project',
  },
  args: {
    all: { type: 'boolean', description: 'List entries for all projects' },
    project: { type: 'string', alias: 'p', description: 'Project name override' },
    'project-dir': projectDirArg,
    'sandbox-base-dir': sandboxBaseDirArg,
  },
  async run({ args }) {
    const sandboxBase = readSandboxBaseDirFromCli(args) ?? resolveSandboxBaseDir();
    const listAll = args.all === true;

    if (!(await pathExists(sandboxBase))) {
      consola.log(`${sandboxBase} does not exist — no entries found.`);
      return;
    }

    const entries = await readdir(sandboxBase);

    if (listAll) {
      if (entries.length === 0) {
        consola.log(`No entries found in ${sandboxBase}.`);
        return;
      }
      consola.log(`${sandboxBase} (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}):`);
      for (const entry of entries) {
        consola.log(`${sandboxBase}/${entry}`);
      }
      return;
    }

    const projectDir = resolveCliProjectDir(readProjectDirFromCli(args));
    const projName = await resolveProjectName({ project: args.project, projectDir });
    const prefix = `${projName}-`;
    const matching = entries.filter((e) => e.startsWith(prefix));

    if (matching.length === 0) {
      consola.log(`No entries matching "${prefix}*" found in ${sandboxBase}.`);
      return;
    }

    consola.log(
      `${sandboxBase} — ${matching.length} entr${matching.length === 1 ? 'y' : 'ies'} for project "${projName}":`,
    );
    for (const entry of matching) {
      consola.log(`${sandboxBase}/${entry}`);
    }
  },
});

const clearCommand = defineCommand({
  meta: {
    name: 'clear',
    description: 'Remove sandbox entries for this project (--all: everything)',
  },
  args: {
    all: { type: 'boolean', description: 'Remove entries for all projects' },
    project: { type: 'string', alias: 'p', description: 'Project name override' },
    'project-dir': {
      type: 'string',
      description: 'Project directory (default: process.cwd())',
    },
    'sandbox-base-dir': {
      type: 'string',
      description: `Sandbox base directory (default: ${DEFAULT_SANDBOX_BASE_DIR})`,
    },
  },
  async run({ args }) {
    const sandboxBase = readSandboxBaseDirFromCli(args) ?? resolveSandboxBaseDir();
    const clearAll = args.all === true;

    if (clearAll && isSaifacTempRoot(sandboxBase)) {
      throw new Error(
        `Refusing to clear the entire SAIF temp root (${SAIFAC_TEMP_ROOT}): that would remove shared data such as bin/. ` +
          `Use the default sandbox base (${DEFAULT_SANDBOX_BASE_DIR}) or pass --sandbox-base-dir pointing at your sandboxes directory, not the temp root.`,
      );
    }

    if (!(await pathExists(sandboxBase))) {
      consola.log(`${sandboxBase} does not exist — nothing to clear.`);
      return;
    }

    const entries = await readdir(sandboxBase);

    const removeEntries = async (toRemove: string[]) => {
      await Promise.all(
        toRemove.map(async (entry) => {
          // E.g. `/tmp/saifac/crawlee-one-feat-abc1234`
          await rmAsync(`${sandboxBase}/${entry}`, { recursive: true, force: true });
          consola.log(`  removed ${entry}`);
        }),
      );
    };

    if (clearAll) {
      await removeEntries(entries);
      consola.log(
        `\nCleared ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} from ${sandboxBase}.`,
      );
      return;
    }

    const projectDir = resolveCliProjectDir(readProjectDirFromCli(args));
    const projName = await resolveProjectName({ project: args.project, projectDir });
    const prefix = `${projName}-`;
    const matching = entries.filter((e) => e.startsWith(prefix));

    if (matching.length === 0) {
      consola.log(`No entries matching "${prefix}*" found in ${sandboxBase}.`);
      return;
    }

    await removeEntries(matching);
    consola.log(
      `\nCleared ${matching.length} entr${matching.length === 1 ? 'y' : 'ies'} for project "${projName}" from ${sandboxBase}.`,
    );
  },
});

const cacheCommand = defineCommand({
  meta: {
    name: 'cache',
    description: 'Manage factory sandbox entries',
  },
  subCommands: {
    list: listCommand,
    clear: clearCommand,
  },
});

export default cacheCommand; // export for validation

// Allow running directly: tsx src/cli/commands/cache.ts
if (process.argv[1]?.endsWith('cache.ts') || process.argv[1]?.endsWith('cache.js')) {
  await runMain(cacheCommand);
}
