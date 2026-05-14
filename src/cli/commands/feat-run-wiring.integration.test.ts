/**
 * Integration test for `feat run` → `parseRunArgs` agent option-bridge wiring.
 *
 * The regression we're guarding against: before the fix, agent option-bridge
 * wiring was gated on `args.agent` being non-empty on the CLI. When the
 * user relied on `saifctl/config.ts` (`defaults.agentProfile: 'claude'` +
 * `defaults.agentOptions.claude.max: true`) to select the agent, the bridge
 * silently dropped the `agentOptions.<id>.*` block — `SAIFCTL_AGENT_OPT_CLAUDE_MAX`
 * stayed unset, `prepareAgentEnv` saw `options.max = false`, and the run
 * fell through to the ANTHROPIC_API_KEY path even though the user expected
 * Claude Max OAuth.
 *
 * Unit tests for the wiring helper itself live in `profile-options.test.ts`.
 * This file goes a layer deeper: it exercises the actual `parseRunArgs`
 * function (the same one the `feat run` handler calls) against a real
 * `saifctl/config.ts` + `feature.yml` on disk, and asserts the env-var
 * protocol that `prepareAgentEnv` reads downstream is populated.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseRunArgs } from './feat.js';

// Env keys mutated by the wiring path; cleared per-test to keep state
// from leaking between cases.
const trackedEnvKeys = [
  'SAIFCTL_AGENT_OPT_CLAUDE_MAX',
  'SAIFCTL_AGENT_OPT_CLAUDE_CREDENTIALS',
  'SAIFCTL_AGENT_OPT_GEMINI_MAX',
];

describe('parseRunArgs → agent option-bridge wiring (integration)', () => {
  let tmpRoot: string;
  let projectDir: string;
  let saifctlDir: string;

  beforeEach(async () => {
    for (const k of trackedEnvKeys) delete process.env[k];
    tmpRoot = await import('node:fs/promises').then((fs) =>
      fs.mkdtemp(join(tmpdir(), 'saifctl-feat-run-wiring-')),
    );
    projectDir = tmpRoot;
    saifctlDir = 'saifctl';
    await mkdir(join(projectDir, saifctlDir, 'features', 'demo', 'phases'), { recursive: true });
    // Minimal phase so parseRunArgs's phased-feature pre-flight passes.
    await mkdir(join(projectDir, saifctlDir, 'features', 'demo', 'phases', '01-noop'), {
      recursive: true,
    });
    await writeFile(
      join(projectDir, saifctlDir, 'features', 'demo', 'phases', '01-noop', 'spec.md'),
      '# noop\n',
      'utf8',
    );
    await writeFile(
      join(projectDir, saifctlDir, 'features', 'demo', 'plan.md'),
      '# demo\n',
      'utf8',
    );
    // resolveProjectName reads package.json#name from projectDir. Saifctl's
    // pre-flight bombs without it; the test cares about wiring, not naming.
    await writeFile(
      join(projectDir, 'package.json'),
      JSON.stringify({ name: 'wiring-test', version: '0.0.0' }),
      'utf8',
    );
    // `--subtasks` accepts a JSON-array file path with stub subtask entries.
    // Set so parseRunArgs bypasses phase compilation; we don't care about
    // the downstream orchestrator-opts shape, only the env-var mutations.
    await writeFile(
      join(projectDir, 'subtasks.json'),
      JSON.stringify([{ content: 'stub' }]),
      'utf8',
    );
  });

  afterEach(async () => {
    for (const k of trackedEnvKeys) delete process.env[k];
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  });

  it('regression: applies agentOptions.claude.max from saifctl/config.ts when no --agent on CLI', async () => {
    // Write the exact shape the user's bug hit: agentProfile + agentOptions
    // in saifctl/config.ts, nothing on the CLI side.
    await writeFile(
      join(projectDir, saifctlDir, 'config.ts'),
      `import type { SaifctlConfig } from '@safe-ai-factory/saifctl';
const config: SaifctlConfig = {
  defaults: {
    agentProfile: 'claude',
    agentOptions: { claude: { max: true } },
  },
};
export default config;
`,
      'utf8',
    );

    const args = {
      feature: 'demo',
      'project-dir': projectDir,
      'saifctl-dir': saifctlDir,
      // Bypass the phases pre-flight to keep this test focused on the
      // wiring path (we're not testing phase compilation here).
      subtasks: 'subtasks.json',
    } as Parameters<typeof parseRunArgs>[0];

    const opts = await parseRunArgs(args);

    expect(opts.agentProfileId).toBe('claude');
    expect(process.env.SAIFCTL_AGENT_OPT_CLAUDE_MAX).toBe('true');
  });

  it('applies agent.profile from feature.yml when saifctl/config.ts picks a different default', async () => {
    await writeFile(
      join(projectDir, saifctlDir, 'config.ts'),
      `import type { SaifctlConfig } from '@safe-ai-factory/saifctl';
const config: SaifctlConfig = {
  defaults: {
    agentProfile: 'openhands',
    agentOptions: { claude: { max: true } },
  },
};
export default config;
`,
      'utf8',
    );
    await writeFile(
      join(projectDir, saifctlDir, 'features', 'demo', 'feature.yml'),
      `agent:
  profile: claude
`,
      'utf8',
    );

    const args = {
      feature: 'demo',
      'project-dir': projectDir,
      'saifctl-dir': saifctlDir,
      subtasks: 'subtasks.json',
    } as Parameters<typeof parseRunArgs>[0];

    const opts = await parseRunArgs(args);

    // feature.yml beats saifctl/config.ts.
    expect(opts.agentProfileId).toBe('claude');
    // agentOptions.claude.max should still apply once claude is the active profile.
    expect(process.env.SAIFCTL_AGENT_OPT_CLAUDE_MAX).toBe('true');
  });

  it('CLI --agent wins over config + feature.yml', async () => {
    await writeFile(
      join(projectDir, saifctlDir, 'config.ts'),
      `import type { SaifctlConfig } from '@safe-ai-factory/saifctl';
const config: SaifctlConfig = {
  defaults: {
    agentProfile: 'claude',
    agentOptions: { claude: { max: true } },
  },
};
export default config;
`,
      'utf8',
    );
    await writeFile(
      join(projectDir, saifctlDir, 'features', 'demo', 'feature.yml'),
      `agent:
  profile: claude
`,
      'utf8',
    );

    const args = {
      feature: 'demo',
      agent: 'gemini',
      'project-dir': projectDir,
      'saifctl-dir': saifctlDir,
      subtasks: 'subtasks.json',
    } as Parameters<typeof parseRunArgs>[0];

    const opts = await parseRunArgs(args);

    expect(opts.agentProfileId).toBe('gemini');
    // claude's options block does NOT leak onto gemini.
    expect(process.env.SAIFCTL_AGENT_OPT_CLAUDE_MAX).toBeUndefined();
  });
});
