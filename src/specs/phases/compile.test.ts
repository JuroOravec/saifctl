/**
 * Tests for the phase → subtasks compiler (Block 3 of TODO_phases_and_critics).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  compilePhasesToSubtasks,
  PhaseCompileError,
  type RunLevelLevel2Baseline,
} from './compile.js';

let projectDir: string;
let featureDir: string;

const FEATURE_NAME = 'auth';
const SAIFCTL_DIR = 'saifctl';

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'compile-block3-'));
  featureDir = join(projectDir, SAIFCTL_DIR, 'features', FEATURE_NAME);
  await mkdir(featureDir, { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

async function makePhase(
  id: string,
  opts: { spec?: string; tests?: boolean } = {},
): Promise<string> {
  const phaseDir = join(featureDir, 'phases', id);
  await mkdir(phaseDir, { recursive: true });
  await writeFile(join(phaseDir, opts.spec ?? 'spec.md'), `# ${id} spec`, 'utf8');
  if (opts.tests !== false) {
    await mkdir(join(phaseDir, 'tests'), { recursive: true });
  }
  return phaseDir;
}

async function makeCritic(id: string, body: string): Promise<string> {
  const dir = join(featureDir, 'critics');
  await mkdir(dir, { recursive: true });
  const p = join(dir, `${id}.md`);
  await writeFile(p, body, 'utf8');
  return p;
}

async function compile(): Promise<ReturnType<typeof compilePhasesToSubtasks>> {
  return compilePhasesToSubtasks({
    featureAbsolutePath: featureDir,
    featureName: FEATURE_NAME,
    saifctlDir: SAIFCTL_DIR,
    projectDir,
    gateScript: '#!/bin/sh\nexit 0',
    agentScript: '#!/bin/sh\necho agent',
    stageScript: '#!/bin/sh\necho stage',
  });
}

describe('compilePhasesToSubtasks — basic shape', () => {
  it('emits one implementer subtask per phase in lexicographic order when no critics defined', async () => {
    await makePhase('01-core');
    await makePhase('02-trigger');

    const out = await compile();
    expect(out).toHaveLength(2);
    expect(out[0]?.title).toBe('phase:01-core impl');
    expect(out[1]?.title).toBe('phase:02-trigger impl');
  });

  it('respects feature.yml.phases.order over lexicographic', async () => {
    await makePhase('01-core');
    await makePhase('02-trigger');
    await writeFile(
      join(featureDir, 'feature.yml'),
      `phases:\n  order: [02-trigger, 01-core]\n`,
      'utf8',
    );

    const out = await compile();
    expect(out.map((s) => s.title)).toEqual(['phase:02-trigger impl', 'phase:01-core impl']);
  });

  it('threads gateScript onto every emitted subtask', async () => {
    await makePhase('01-core');
    const out = await compile();
    expect(out[0]?.gateScript).toBe('#!/bin/sh\nexit 0');
  });
});

describe('compilePhasesToSubtasks — critics', () => {
  it('emits two critic subtasks (discover + fix) per phase per critic per round (§6 split)', async () => {
    await makePhase('01-core');
    await makePhase('02-trigger');
    await makeCritic('strict', 'be strict');
    await makeCritic('paranoid', 'be paranoid');
    await writeFile(
      join(featureDir, 'feature.yml'),
      `critics:\n  - { id: strict, rounds: 1 }\n  - { id: paranoid, rounds: 2 }\n`,
      'utf8',
    );

    const out = await compile();
    // 2 phases × (1 impl + 2*(1 strict round + 2 paranoid rounds)) = 14
    // discover + fix per round = 2 subtasks each
    expect(out).toHaveLength(14);
    expect(out.map((s) => s.title)).toEqual([
      'phase:01-core impl',
      'phase:01-core critic:strict round:1/1 discover',
      'phase:01-core critic:strict round:1/1 fix',
      'phase:01-core critic:paranoid round:1/2 discover',
      'phase:01-core critic:paranoid round:1/2 fix',
      'phase:01-core critic:paranoid round:2/2 discover',
      'phase:01-core critic:paranoid round:2/2 fix',
      'phase:02-trigger impl',
      'phase:02-trigger critic:strict round:1/1 discover',
      'phase:02-trigger critic:strict round:1/1 fix',
      'phase:02-trigger critic:paranoid round:1/2 discover',
      'phase:02-trigger critic:paranoid round:1/2 fix',
      'phase:02-trigger critic:paranoid round:2/2 discover',
      'phase:02-trigger critic:paranoid round:2/2 fix',
    ]);
  });

  it('per-phase phase.yml replaces the inherited critic list (no key-level merge)', async () => {
    await makePhase('01-core');
    await makePhase('02-edge');
    await makeCritic('strict', 'strict');
    await makeCritic('paranoid', 'paranoid');
    await makeCritic('security', 'security');
    await writeFile(
      join(featureDir, 'feature.yml'),
      `critics:\n  - { id: strict }\n  - { id: paranoid }\n`,
      'utf8',
    );
    await writeFile(
      join(featureDir, 'phases', '02-edge', 'phase.yml'),
      `critics:\n  - { id: security }\n`,
      'utf8',
    );

    const out = await compile();
    const phase02CriticTitles = out
      .filter((s) => s.title?.startsWith('phase:02-edge'))
      .map((s) => s.title);
    expect(phase02CriticTitles).toEqual([
      'phase:02-edge impl',
      'phase:02-edge critic:security round:1/1 discover',
      'phase:02-edge critic:security round:1/1 fix',
    ]);
  });

  it('phase with explicit empty critics list runs no critics', async () => {
    await makePhase('00-spike');
    await makePhase('01-core');
    await makeCritic('strict', 'strict');
    await writeFile(join(featureDir, 'feature.yml'), `critics:\n  - { id: strict }\n`, 'utf8');
    await writeFile(join(featureDir, 'phases', '00-spike', 'phase.yml'), `critics: []\n`, 'utf8');

    const out = await compile();
    expect(out.filter((s) => s.title?.startsWith('phase:00-spike'))).toHaveLength(1);
    // 01-core: 1 impl + 1 strict round × 2 (discover+fix) = 3
    expect(out.filter((s) => s.title?.startsWith('phase:01-core'))).toHaveLength(3);
  });

  it('runs all discovered critics alphabetically when no critic list declared anywhere', async () => {
    await makePhase('01-core');
    // Note: written in non-alphabetical order to verify sort.
    await makeCritic('strict', 'strict');
    await makeCritic('paranoid', 'paranoid');

    const out = await compile();
    expect(out.map((s) => s.title)).toEqual([
      'phase:01-core impl',
      'phase:01-core critic:paranoid round:1/1 discover',
      'phase:01-core critic:paranoid round:1/1 fix',
      'phase:01-core critic:strict round:1/1 discover',
      'phase:01-core critic:strict round:1/1 fix',
    ]);
  });

  it('discover subtask content is the raw user template (loop renders via mustache at runtime)', async () => {
    await makePhase('01-core');
    await makeCritic('strict', 'AUDIT_BODY_TOKEN — phase {{phase.id}} round {{critic.round}}');
    await writeFile(join(featureDir, 'feature.yml'), `critics:\n  - { id: strict }\n`, 'utf8');

    const out = await compile();
    const discover = out.find((s) => s.title === 'phase:01-core critic:strict round:1/1 discover');
    // Raw body — mustache tokens are still literals here. Block 4's loop
    // renderer expands them just before invoking the agent.
    expect(discover?.content).toBe('AUDIT_BODY_TOKEN — phase {{phase.id}} round {{critic.round}}');
  });

  it('fix subtask content is the saifctl-owned BUILTIN_FIX_TEMPLATE (not the user critic body)', async () => {
    await makePhase('01-core');
    await makeCritic('strict', 'USER_TEMPLATE_TOKEN — phase {{phase.id}}');
    await writeFile(join(featureDir, 'feature.yml'), `critics:\n  - { id: strict }\n`, 'utf8');

    const out = await compile();
    const fix = out.find((s) => s.title === 'phase:01-core critic:strict round:1/1 fix');
    // The user template token must NOT appear in the fix subtask — fix uses
    // the saifctl-owned built-in template.
    expect(fix?.content).not.toContain('USER_TEMPLATE_TOKEN');
    // Built-in template references the findings file path it should read.
    expect(fix?.content).toContain('{{critic.findingsPath}}');
    expect(fix?.content).toContain('{{phase.id}}');
  });

  it('critic subtasks carry criticPrompt metadata with step + findingsPath', async () => {
    await makePhase('01-core');
    await makeCritic('paranoid', 'body');
    await writeFile(
      join(featureDir, 'feature.yml'),
      `critics:\n  - { id: paranoid, rounds: 2 }\n`,
      'utf8',
    );

    const out = await compile();
    const r1d = out.find((s) => s.title === 'phase:01-core critic:paranoid round:1/2 discover');
    const r1f = out.find((s) => s.title === 'phase:01-core critic:paranoid round:1/2 fix');
    const r2d = out.find((s) => s.title === 'phase:01-core critic:paranoid round:2/2 discover');

    expect(r1d?.phaseId).toBe('01-core');
    expect(r1d?.criticPrompt?.criticId).toBe('paranoid');
    expect(r1d?.criticPrompt?.round).toBe(1);
    expect(r1d?.criticPrompt?.totalRounds).toBe(2);
    expect(r1d?.criticPrompt?.step).toBe('discover');
    expect(r1f?.criticPrompt?.step).toBe('fix');
    expect(r2d?.criticPrompt?.round).toBe(2);

    // discover and fix from the same round share the same findingsPath
    // (so fix can read what discover wrote). Different rounds have
    // different paths so re-runs don't collide.
    expect(r1d?.criticPrompt?.findingsPath).toBe(
      '/workspace/.saifctl/critic-findings/01-core--paranoid--r1.md',
    );
    expect(r1f?.criticPrompt?.findingsPath).toBe(r1d?.criticPrompt?.findingsPath);
    expect(r2d?.criticPrompt?.findingsPath).toBe(
      '/workspace/.saifctl/critic-findings/01-core--paranoid--r2.md',
    );
    expect(r2d?.criticPrompt?.findingsPath).not.toBe(r1d?.criticPrompt?.findingsPath);

    // Pre-bound mustache vars (everything except phase.baseRef, which is
    // a runtime concern captured by the loop).
    expect(r1d?.criticPrompt?.vars.feature.name).toBe(FEATURE_NAME);
    expect(r1d?.criticPrompt?.vars.feature.dir).toBe(`${SAIFCTL_DIR}/features/${FEATURE_NAME}`);
    expect(r1d?.criticPrompt?.vars.feature.plan).toBe(
      `/workspace/${SAIFCTL_DIR}/features/${FEATURE_NAME}/plan.md`,
    );
    expect(r1d?.criticPrompt?.vars.phase.id).toBe('01-core');
    expect(r1d?.criticPrompt?.vars.phase.spec).toBe(
      `/workspace/${SAIFCTL_DIR}/features/${FEATURE_NAME}/phases/01-core/spec.md`,
    );
    expect(r1d?.criticPrompt?.vars.phase.tests).toBe(
      `/workspace/${SAIFCTL_DIR}/features/${FEATURE_NAME}/phases/01-core/tests`,
    );
  });

  it('discover and fix in the same round share testScope (both gate on phase tests)', async () => {
    await makePhase('01-core');
    await makeCritic('strict', 'strict');
    await writeFile(join(featureDir, 'feature.yml'), `critics:\n  - { id: strict }\n`, 'utf8');

    const out = await compile();
    const discover = out.find((s) => s.title === 'phase:01-core critic:strict round:1/1 discover');
    const fix = out.find((s) => s.title === 'phase:01-core critic:strict round:1/1 fix');
    // Both gate on the same cumulative test set as the impl that wrote the code.
    expect(discover?.testScope).toEqual(fix?.testScope);
  });

  it('impl subtask carries phaseId but no criticPrompt', async () => {
    await makePhase('01-core');
    const out = await compile();
    const impl = out[0]!;
    expect(impl.phaseId).toBe('01-core');
    expect(impl.criticPrompt).toBeUndefined();
  });
});

describe('compilePhasesToSubtasks — testScope (cumulative gate)', () => {
  it('every subtask emits cumulative=true with its own phase tests dir', async () => {
    await makePhase('01-core');
    await makePhase('02-trigger');
    await makeCritic('strict', 'strict');
    await writeFile(join(featureDir, 'feature.yml'), `critics:\n  - { id: strict }\n`, 'utf8');

    const out = await compile();
    for (const s of out) {
      expect(s.testScope?.cumulative).toBe(true);
      expect(s.testScope?.include?.[0]).toMatch(/phases\/(01-core|02-trigger)\/tests$/);
    }
  });

  it('phase 1 testScope includes only its own phase tests dir', async () => {
    await makePhase('01-core');
    await makePhase('02-trigger');

    const out = await compile();
    const phase1 = out.find((s) => s.title === 'phase:01-core impl');
    expect(phase1?.testScope?.include).toEqual([join(featureDir, 'phases', '01-core', 'tests')]);
  });

  it('LAST phase additionally includes <feature>/tests/ and <saifctlDir>/tests/', async () => {
    await makePhase('01-core');
    await makePhase('02-trigger'); // last

    const out = await compile();
    const lastImpl = out.find((s) => s.title === 'phase:02-trigger impl');
    expect(lastImpl?.testScope?.include).toEqual([
      join(featureDir, 'phases', '02-trigger', 'tests'),
      join(featureDir, 'tests'),
      join(projectDir, SAIFCTL_DIR, 'tests'),
    ]);
  });

  it('LAST phase critics share the same expanded testScope as the last impl', async () => {
    await makePhase('01-core');
    await makePhase('02-trigger');
    await makeCritic('strict', 'strict');
    await writeFile(join(featureDir, 'feature.yml'), `critics:\n  - { id: strict }\n`, 'utf8');

    const out = await compile();
    const lastImpl = out.find((s) => s.title === 'phase:02-trigger impl');
    const lastDiscover = out.find(
      (s) => s.title === 'phase:02-trigger critic:strict round:1/1 discover',
    );
    const lastFix = out.find((s) => s.title === 'phase:02-trigger critic:strict round:1/1 fix');
    expect(lastDiscover?.testScope?.include).toEqual(lastImpl?.testScope?.include);
    expect(lastFix?.testScope?.include).toEqual(lastImpl?.testScope?.include);
  });
});

describe('compilePhasesToSubtasks — implementer prompt', () => {
  it('links to spec + plan, mentions phase id, warns about saifctl/', async () => {
    await makePhase('01-core');
    const out = await compile();
    const impl = out[0]!;
    expect(impl.content).toContain("phase '01-core'");
    expect(impl.content).toContain(`feature '${FEATURE_NAME}'`);
    expect(impl.content).toContain(`spec.md`);
    expect(impl.content).toContain(`plan.md`);
    expect(impl.content).toContain(`/${SAIFCTL_DIR}/`);
    // link-only — must not embed plan / spec contents
    expect(impl.content).not.toContain('# 01-core spec');
  });

  it('emits container-side workspace paths for plan / spec, not host-absolute paths', async () => {
    await makePhase('01-core');
    const out = await compile();
    const impl = out[0]!;
    // Container-visible paths under /workspace/...
    expect(impl.content).toContain(
      `/workspace/${SAIFCTL_DIR}/features/${FEATURE_NAME}/phases/01-core/spec.md`,
    );
    expect(impl.content).toContain(`/workspace/${SAIFCTL_DIR}/features/${FEATURE_NAME}/plan.md`);
    // The host-absolute prefix (the temp project dir) must not appear — that
    // path doesn't exist in the agent's container.
    expect(impl.content).not.toContain(projectDir);
  });

  it('uses phase.yml.spec override for the spec link', async () => {
    await makePhase('01-core', { spec: 'SPEC.md' });
    await writeFile(join(featureDir, 'phases', '01-core', 'phase.yml'), `spec: SPEC.md\n`, 'utf8');
    const out = await compile();
    expect(out[0]?.content).toContain('SPEC.md');
    expect(out[0]?.content).not.toMatch(/\bspec\.md\b/);
  });

  it('critic prompt vars use workspace-relative paths, not host-absolute', async () => {
    await makePhase('01-core');
    await makeCritic('strict', 'BODY');
    await writeFile(join(featureDir, 'feature.yml'), `critics:\n  - { id: strict }\n`, 'utf8');
    const out = await compile();
    const critic = out.find((s) => s.title === 'phase:01-core critic:strict round:1/1 discover');
    // Paths live on criticPrompt.vars now (Block 4); content is the raw body.
    expect(critic?.criticPrompt?.vars.phase.spec).toBe(
      `/workspace/${SAIFCTL_DIR}/features/${FEATURE_NAME}/phases/01-core/spec.md`,
    );
    expect(critic?.criticPrompt?.vars.feature.plan).toBe(
      `/workspace/${SAIFCTL_DIR}/features/${FEATURE_NAME}/plan.md`,
    );
    // Prompt-facing fields (content + criticPrompt.vars) must be free of
    // host-absolute paths. testScope.include is host-side by design and is
    // not surfaced to the agent.
    expect(critic?.content).not.toContain(projectDir);
    expect(JSON.stringify(critic?.criticPrompt?.vars)).not.toContain(projectDir);
  });
});

describe('compilePhasesToSubtasks — error paths', () => {
  it('throws PhaseCompileError when phases/ has no valid phase dirs', async () => {
    await mkdir(join(featureDir, 'phases'), { recursive: true });
    await expect(compile()).rejects.toBeInstanceOf(PhaseCompileError);
  });

  it('throws PhaseCompileError when feature.yml references unknown critic', async () => {
    await makePhase('01-core');
    await writeFile(join(featureDir, 'feature.yml'), `critics:\n  - { id: ghost }\n`, 'utf8');
    await expect(compile()).rejects.toMatchObject({
      name: 'PhaseCompileError',
      message: expect.stringContaining("unknown critic 'ghost'"),
    });
  });

  it('throws PhaseCompileError when feature.yml.phases.order references unknown phase', async () => {
    await makePhase('01-core');
    await writeFile(
      join(featureDir, 'feature.yml'),
      `phases:\n  order: [01-core, 99-ghost]\n`,
      'utf8',
    );
    await expect(compile()).rejects.toMatchObject({
      name: 'PhaseCompileError',
      message: expect.stringContaining("unknown phase '99-ghost'"),
    });
  });

  it('throws PhaseCompileError when tests.enforce: read-only is set anywhere', async () => {
    await makePhase('01-core');
    await writeFile(join(featureDir, 'feature.yml'), `tests:\n  enforce: read-only\n`, 'utf8');
    await expect(compile()).rejects.toMatchObject({
      name: 'PhaseCompileError',
      message: expect.stringContaining('read-only'),
    });
  });
});

// ---------------------------------------------------------------------------
// per-phase-config phase 7.2 — Level-1 per-phase script threading
// ---------------------------------------------------------------------------

describe('compilePhasesToSubtasks — per-phase Level-1 overrides (phase 7.2)', () => {
  it('threads per-phase gate.script content onto every subtask in that phase', async () => {
    const phaseDir = await makePhase('01-core');
    await writeFile(join(phaseDir, 'gate.sh'), 'phase-gate\n', 'utf8');
    await writeFile(join(phaseDir, 'phase.yml'), `gate:\n  script: gate.sh\n`, 'utf8');
    await makeCritic('strict', '# strict critic');

    const out = await compile();
    // 01-core impl + 1 critic round (discover + fix) = 3 subtasks
    expect(out).toHaveLength(3);
    for (const st of out) {
      expect(st.gateScript).toBe('phase-gate\n');
    }
  });

  it('falls back to run-level gateScript when the phase has no override', async () => {
    await makePhase('01-core');
    const out = await compile();
    // No override on 01-core → should use the run-level one passed to compile()
    expect(out[0]?.gateScript).toBe('#!/bin/sh\nexit 0');
  });

  it('mixes overridden and non-overridden phases correctly', async () => {
    const a = await makePhase('01-with-override');
    await makePhase('02-without-override');
    await writeFile(join(a, 'gate.sh'), 'override-content\n', 'utf8');
    await writeFile(join(a, 'phase.yml'), `gate:\n  script: gate.sh\n`, 'utf8');

    const out = await compile();
    expect(out).toHaveLength(2);
    expect(out[0]?.title).toBe('phase:01-with-override impl');
    expect(out[0]?.gateScript).toBe('override-content\n');
    expect(out[1]?.title).toBe('phase:02-without-override impl');
    expect(out[1]?.gateScript).toBe('#!/bin/sh\nexit 0');
  });

  it('threads per-phase agent.script content (overrides the run-level fallback)', async () => {
    const phaseDir = await makePhase('01-core');
    await writeFile(join(phaseDir, 'agent.sh'), 'phase-agent\n', 'utf8');
    await writeFile(join(phaseDir, 'phase.yml'), `agent:\n  script: agent.sh\n`, 'utf8');

    const out = await compile();
    expect(out[0]?.agentScript).toBe('phase-agent\n');
  });

  // F-D regression test for the per-phase-config phase 7.2 review finding:
  // when one phase overrides `agent.script` and the next doesn't, every
  // emitted subtask must still carry an explicit `agentScript`, with the
  // overriding phase's subtasks showing the override and the non-overriding
  // phase's subtasks showing the run-level fallback. Before the fix,
  // non-overriding subtasks had `agentScript: undefined`, which caused the
  // runtime to leave the previous phase's `agent.sh` on disk.
  it('mixes overridden and non-overridden agent.script across phases (every subtask explicit)', async () => {
    const aDir = await makePhase('01-with-override');
    await makePhase('02-without-override');
    await writeFile(join(aDir, 'phase-agent.sh'), 'phase-a-agent\n', 'utf8');
    await writeFile(join(aDir, 'phase.yml'), `agent:\n  script: phase-agent.sh\n`, 'utf8');

    const out = await compile();
    expect(out).toHaveLength(2);
    // Phase A subtask: override applied.
    expect(out[0]?.title).toBe('phase:01-with-override impl');
    expect(out[0]?.agentScript).toBe('phase-a-agent\n');
    // Phase B subtask: NOT undefined — falls back to the run-level value
    // passed in via `compile()`. This is the contract that prevents
    // phase A's override from persisting into phase B at runtime.
    expect(out[1]?.title).toBe('phase:02-without-override impl');
    expect(out[1]?.agentScript).toBe('#!/bin/sh\necho agent');
  });

  it('resolves agent.script via feature dir when not in phase dir', async () => {
    await makePhase('01-core');
    await writeFile(join(featureDir, 'shared-agent.sh'), 'feature-shared-agent\n', 'utf8');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `agent:\n  script: shared-agent.sh\n`,
      'utf8',
    );

    const out = await compile();
    expect(out[0]?.agentScript).toBe('feature-shared-agent\n');
  });

  it('threads per-phase gate.retries onto every subtask in that phase', async () => {
    const phaseDir = await makePhase('01-core');
    await writeFile(join(phaseDir, 'phase.yml'), `gate:\n  retries: 7\n`, 'utf8');
    await makeCritic('strict', '# strict');

    const out = await compile();
    for (const st of out) {
      expect(st.gateRetries).toBe(7);
    }
  });

  it('falls back to the run-level agentScript on every subtask when no per-phase override is set', async () => {
    // Per-phase-config phase 7.2 fix: when a phase has no `agent.script`
    // override, the emitted subtask still carries the run-level agentScript
    // explicitly (not undefined). This is what makes phase boundaries
    // idempotent — transitioning from a phase that did override to one
    // that didn't restores the run-level script instead of leaking the
    // previous override into the next phase. `gateRetries` stays
    // undefined because there's no run-level fallback at the compile
    // layer (the orchestrator's run-level value applies).
    await makePhase('01-core');
    const out = await compile();
    expect(out[0]?.agentScript).toBe('#!/bin/sh\necho agent');
    expect(out[0]?.gateRetries).toBeUndefined();
  });

  it('resolves gate.script via feature dir when not in phase dir', async () => {
    await makePhase('01-core');
    await writeFile(join(featureDir, 'shared-gate.sh'), 'feature-shared\n', 'utf8');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `gate:\n  script: shared-gate.sh\n`,
      'utf8',
    );

    const out = await compile();
    expect(out[0]?.gateScript).toBe('feature-shared\n');
  });

  it('resolves gate.script via project dir when not in phase or feature dir', async () => {
    await makePhase('01-core');
    await mkdir(join(projectDir, 'scripts'), { recursive: true });
    await writeFile(join(projectDir, 'scripts', 'lint.sh'), 'project-lint\n', 'utf8');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `gate:\n  script: scripts/lint.sh\n`,
      'utf8',
    );

    const out = await compile();
    expect(out[0]?.gateScript).toBe('project-lint\n');
  });

  it('throws PhaseCompileError when gate.script does not resolve', async () => {
    await makePhase('01-core');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `gate:\n  script: missing.sh\n`,
      'utf8',
    );

    await expect(compile()).rejects.toMatchObject({
      name: 'PhaseCompileError',
      message: expect.stringContaining('gate.script'),
    });
  });

  it('feature-top-level gate config applies to every phase that does not override', async () => {
    await makePhase('01-a');
    await makePhase('02-b');
    await writeFile(join(featureDir, 'shared.sh'), 'shared-feature-gate\n', 'utf8');
    await writeFile(join(featureDir, 'feature.yml'), `gate:\n  script: shared.sh\n`, 'utf8');

    const out = await compile();
    expect(out).toHaveLength(2);
    expect(out[0]?.gateScript).toBe('shared-feature-gate\n');
    expect(out[1]?.gateScript).toBe('shared-feature-gate\n');
  });
});

// ---------------------------------------------------------------------------
// per-phase-config phase 7.3 — Level-4 routing + tests.none bypass
// ---------------------------------------------------------------------------

describe('compilePhasesToSubtasks — per-phase Level-4 overrides (phase 7.3)', () => {
  it('threads runner.test-profile / test-image / resolve-ambiguity / test-retries onto every subtask in the phase', async () => {
    await makePhase('01-core');
    await makeCritic('strict', 'be strict');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `runner:\n  test-profile: pytest\n  test-image: custom-runner:v1\n  resolve-ambiguity: prompt\n  test-retries: 5\n`,
      'utf8',
    );

    const out = await compile();
    // 1 impl + 1 strict round (discover + fix) = 3
    expect(out).toHaveLength(3);
    for (const st of out) {
      expect(st.testProfile).toBe('pytest');
      expect(st.testImage).toBe('custom-runner:v1');
      expect(st.resolveAmbiguity).toBe('prompt');
      expect(st.testRetries).toBe(5);
    }
  });

  it('reads runner.test-script / runner.stage-script content via the script-resolver', async () => {
    const phaseDir = await makePhase('01-core');
    await writeFile(join(phaseDir, 'custom-test.sh'), 'phase-test-content\n', 'utf8');
    await writeFile(join(phaseDir, 'custom-stage.sh'), 'phase-stage-content\n', 'utf8');
    await writeFile(
      join(phaseDir, 'phase.yml'),
      `runner:\n  test-script: custom-test.sh\n  stage-script: custom-stage.sh\n`,
      'utf8',
    );

    const out = await compile();
    expect(out[0]?.testScript).toBe('phase-test-content\n');
    expect(out[0]?.stageScript).toBe('phase-stage-content\n');
  });

  it('throws PhaseCompileError when runner.test-script does not resolve', async () => {
    await makePhase('01-core');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `runner:\n  test-script: missing.sh\n`,
      'utf8',
    );
    await expect(compile()).rejects.toMatchObject({
      name: 'PhaseCompileError',
      message: expect.stringContaining('runner.test-script'),
    });
  });

  it('falls back to run-level stageScript and leaves other runner overrides unset when the phase declares none', async () => {
    // Per-phase-config phase 7.3 fix (F-A regression): every subtask carries
    // an explicit `stageScript` (override-or-run-level) so transitions out
    // of an overriding phase don't leak the previous override into the
    // staging container's bind-mount. The other runner.* knobs stay
    // undefined when no override is set — they're routed only via the
    // `pickRunnerOptsForSubtask` helper at runtime.
    await makePhase('01-core');
    const out = await compile();
    expect(out[0]?.stageScript).toBe('#!/bin/sh\necho stage');
    expect(out[0]?.testProfile).toBeUndefined();
    expect(out[0]?.testImage).toBeUndefined();
    expect(out[0]?.testScript).toBeUndefined();
    expect(out[0]?.resolveAmbiguity).toBeUndefined();
    expect(out[0]?.testRetries).toBeUndefined();
  });

  // F-A regression: same pattern as the 7.2 agent.sh fix. Phase A overrides
  // runner.stage-script; phase B does not. Each phase's subtasks must carry
  // an explicit stageScript on the manifest so the runtime never has to
  // "leave stage.sh unchanged" between subtasks.
  it('mixes overridden and non-overridden runner.stage-script across phases', async () => {
    const aDir = await makePhase('01-with-override');
    await makePhase('02-without-override');
    await writeFile(join(aDir, 'phase-stage.sh'), 'phase-a-stage\n', 'utf8');
    await writeFile(join(aDir, 'phase.yml'), `runner:\n  stage-script: phase-stage.sh\n`, 'utf8');

    const out = await compile();
    expect(out).toHaveLength(2);
    expect(out[0]?.title).toBe('phase:01-with-override impl');
    expect(out[0]?.stageScript).toBe('phase-a-stage\n');
    expect(out[1]?.title).toBe('phase:02-without-override impl');
    expect(out[1]?.stageScript).toBe('#!/bin/sh\necho stage');
  });

  // F-C regression: bad runner.test-image must fail compile, not surface
  // later when the runner first spins up. The regex matches the run-level
  // `validateImageTag` charset (letters, digits, `_.-:/@`); a tag with a
  // space or `$` violates that.
  it('throws PhaseCompileError when runner.test-image is malformed (compile-time validation)', async () => {
    await makePhase('01-core');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `runner:\n  test-image: 'bad image:tag'\n`,
      'utf8',
    );
    await expect(compile()).rejects.toMatchObject({
      name: 'PhaseCompileError',
      message: expect.stringContaining('runner.test-image'),
    });
  });

  it('does NOT fail compile for a valid runner.test-image', async () => {
    await makePhase('01-core');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `runner:\n  test-image: my-runner:v1.2.3\n`,
      'utf8',
    );
    const out = await compile();
    expect(out[0]?.testImage).toBe('my-runner:v1.2.3');
  });
});

describe('compilePhasesToSubtasks — tests.none / scope handling (phase 7.3)', () => {
  it('emits noRunner: true on every subtask of a phase with tests.none: true', async () => {
    await makePhase('01-emit');
    await makePhase('02-final');
    await makeCritic('strict', 'be strict');
    await writeFile(
      join(featureDir, 'phases', '01-emit', 'phase.yml'),
      `tests:\n  none: true\ncritics:\n  - { id: strict, rounds: 1 }\n`,
      'utf8',
    );

    const out = await compile();
    const phase01 = out.filter((s) => s.title?.startsWith('phase:01-emit'));
    expect(phase01).toHaveLength(3); // impl + strict (discover + fix)
    for (const st of phase01) {
      expect(st.noRunner).toBe(true);
    }
    const phase02 = out.filter((s) => s.title?.startsWith('phase:02-final'));
    for (const st of phase02) {
      expect(st.noRunner).toBeUndefined();
    }
  });

  it('drops phase-own tests/ from testScope.include when tests.none: true on a non-last phase', async () => {
    await makePhase('01-emit');
    await makePhase('02-real');
    await writeFile(
      join(featureDir, 'phases', '01-emit', 'phase.yml'),
      `tests:\n  none: true\n`,
      'utf8',
    );

    const out = await compile();
    const phase01Impl = out.find((s) => s.title === 'phase:01-emit impl');
    expect(phase01Impl?.testScope?.include).toBeDefined();
    // Non-last phase + tests.none ⇒ no own tests/, no feature/project tests
    // either (those only land on the LAST phase).
    expect(phase01Impl?.testScope?.include).toEqual([]);
  });

  it('keeps feature/project tests in scope on the last phase even when tests.none: true (§6.5(b))', async () => {
    await makePhase('01-real');
    await makePhase('02-emit');
    await writeFile(
      join(featureDir, 'phases', '02-emit', 'phase.yml'),
      `tests:\n  none: true\n`,
      'utf8',
    );

    const out = await compile();
    const phase02Impl = out.find((s) => s.title === 'phase:02-emit impl');
    const includes = phase02Impl?.testScope?.include ?? [];
    // Last phase + tests.none ⇒ phase-own tests/ dropped, but feature/project
    // tests still gate the run's terminal state.
    expect(includes.some((p) => p.endsWith('phases/02-emit/tests'))).toBe(false);
    expect(includes.some((p) => p.endsWith('/features/auth/tests'))).toBe(true);
    expect(includes.some((p) => p.endsWith('/saifctl/tests'))).toBe(true);
  });

  // §6.5(b) "last phase" rule: the COMPILER decides which phase is last
  // and populates that phase's `testScope.include` with feature- and
  // project-level test paths. The runtime gate (`scope.sources.length === 0`)
  // then naturally lets the runner spin up on those sources even when the
  // phase declares `tests.none: true`. No explicit per-subtask "this is
  // the last phase" flag is needed.
  it("the last phase's testScope.include carries feature/ + project-level tests; earlier phases do not", async () => {
    await makePhase('01-a');
    await makePhase('02-b');

    const out = await compile();
    const phase01 = out.find((s) => s.title === 'phase:01-a impl');
    const phase02 = out.find((s) => s.title === 'phase:02-b impl');
    const includes01 = phase01?.testScope?.include ?? [];
    const includes02 = phase02?.testScope?.include ?? [];
    expect(includes01.some((p) => p.endsWith('phases/01-a/tests'))).toBe(true);
    expect(includes01.some((p) => p.endsWith('/features/auth/tests'))).toBe(false);
    expect(includes01.some((p) => p.endsWith('/saifctl/tests'))).toBe(false);
    expect(includes02.some((p) => p.endsWith('phases/02-b/tests'))).toBe(true);
    expect(includes02.some((p) => p.endsWith('/features/auth/tests'))).toBe(true);
    expect(includes02.some((p) => p.endsWith('/saifctl/tests'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// per-phase-config phase 7.4 — Level-1.5 emission
// ---------------------------------------------------------------------------

describe('compilePhasesToSubtasks — per-phase Level-1.5 overrides (phase 7.4)', () => {
  it('threads agent.env onto every subtask in the phase', async () => {
    await makePhase('01-core');
    await makeCritic('strict', 'be strict');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `agent:\n  env:\n    FOO: bar\n    BAZ: qux\n`,
      'utf8',
    );
    const out = await compile();
    // 1 impl + 1 strict round (discover + fix) = 3
    expect(out).toHaveLength(3);
    for (const st of out) {
      expect(st.agentEnv).toEqual({ FOO: 'bar', BAZ: 'qux' });
    }
  });

  it('threads agent.secrets onto every subtask in the phase (compile-time records names; runtime resolves values)', async () => {
    await makePhase('01-core');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `agent:\n  secrets:\n    - API_KEY\n    - DATABASE_URL\n`,
      'utf8',
    );
    const out = await compile();
    expect(out[0]?.agentSecretKeys).toEqual(['API_KEY', 'DATABASE_URL']);
  });

  it('threads agent.reviewer (true / false) onto every subtask in the phase', async () => {
    await makePhase('01-core');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `agent:\n  reviewer: false\n`,
      'utf8',
    );
    const out = await compile();
    expect(out[0]?.reviewerEnabled).toBe(false);
  });

  it('threads agent.model + agent.base-url as llmOverrides.globalModel / .globalBaseUrl', async () => {
    await makePhase('01-core');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `agent:\n  model: openai/gpt-4o-mini\n  base-url: https://api.openai.com/v1\n`,
      'utf8',
    );
    const out = await compile();
    expect(out[0]?.llmOverrides?.globalModel).toBe('openai/gpt-4o-mini');
    expect(out[0]?.llmOverrides?.globalBaseUrl).toBe('https://api.openai.com/v1');
  });

  // Per-phase-config 7.4 review F-D: spec.md requires the same shape as
  // the run-level `--model` / `--base-url` CLI — single global, comma-
  // separated `agent=value` pairs, or one global mixed with per-agent
  // entries. The earlier impl silently treated everything as a global
  // (would fail later as a malformed model string); we now parse both
  // forms and emit `llmOverrides.agentModels` / `agentBaseUrls`.
  it('parses agent.model with comma-separated agent=value form into llmOverrides.agentModels', async () => {
    await makePhase('01-core');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `agent:\n  model: 'coder=openai/gpt-4o-mini,reviewer=openai/gpt-4o'\n`,
      'utf8',
    );
    const out = await compile();
    expect(out[0]?.llmOverrides?.globalModel).toBeUndefined();
    expect(out[0]?.llmOverrides?.agentModels).toEqual({
      coder: 'openai/gpt-4o-mini',
      reviewer: 'openai/gpt-4o',
    });
  });

  it('parses agent.model mixing one bare global with per-agent entries', async () => {
    await makePhase('01-core');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `agent:\n  model: 'openai/gpt-4o-mini,reviewer=openai/gpt-4o'\n`,
      'utf8',
    );
    const out = await compile();
    expect(out[0]?.llmOverrides?.globalModel).toBe('openai/gpt-4o-mini');
    expect(out[0]?.llmOverrides?.agentModels).toEqual({ reviewer: 'openai/gpt-4o' });
  });

  it('parses agent.base-url comma-separated agent=url form into llmOverrides.agentBaseUrls', async () => {
    await makePhase('01-core');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `agent:\n  base-url: 'coder=https://api.openai.com/v1,reviewer=https://anthropic.example/v1'\n`,
      'utf8',
    );
    const out = await compile();
    expect(out[0]?.llmOverrides?.agentBaseUrls).toEqual({
      coder: 'https://api.openai.com/v1',
      reviewer: 'https://anthropic.example/v1',
    });
  });

  it('throws PhaseCompileError when agent.model names an unknown agent', async () => {
    await makePhase('01-core');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `agent:\n  model: 'no-such-agent=openai/gpt-4o-mini'\n`,
      'utf8',
    );
    await expect(compile()).rejects.toMatchObject({
      name: 'PhaseCompileError',
      message: expect.stringContaining('agent.model'),
    });
  });

  it('throws PhaseCompileError when agent.model has duplicate agent keys', async () => {
    await makePhase('01-core');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `agent:\n  model: 'coder=foo/bar,coder=baz/qux'\n`,
      'utf8',
    );
    await expect(compile()).rejects.toMatchObject({
      name: 'PhaseCompileError',
      message: expect.stringContaining('duplicate agent key'),
    });
  });

  it('throws PhaseCompileError when agent.model has multiple bare globals', async () => {
    await makePhase('01-core');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `agent:\n  model: 'openai/gpt-4o-mini,anthropic/claude-haiku-4-5'\n`,
      'utf8',
    );
    await expect(compile()).rejects.toMatchObject({
      name: 'PhaseCompileError',
      message: expect.stringContaining('multiple bare model values'),
    });
  });

  it('does not set Level-1.5 fields when the phase declares none (back-compat)', async () => {
    await makePhase('01-core');
    const out = await compile();
    expect(out[0]?.agentEnv).toBeUndefined();
    expect(out[0]?.agentSecretKeys).toBeUndefined();
    expect(out[0]?.reviewerEnabled).toBeUndefined();
    expect(out[0]?.llmOverrides).toBeUndefined();
  });

  it('feature-top-level agent.env applies to every phase that does not override (sub-key merge)', async () => {
    await makePhase('01-a');
    await makePhase('02-b');
    await writeFile(
      join(featureDir, 'feature.yml'),
      `agent:\n  env:\n    SHARED: feature-value\n`,
      'utf8',
    );
    await writeFile(
      join(featureDir, 'phases', '01-a', 'phase.yml'),
      `agent:\n  env:\n    PHASE_ONLY: phase-value\n`,
      'utf8',
    );
    const out = await compile();
    const phase01Impl = out.find((s) => s.title === 'phase:01-a impl');
    const phase02Impl = out.find((s) => s.title === 'phase:02-b impl');
    // Phase 01: sub-key merge → both keys present.
    expect(phase01Impl?.agentEnv).toEqual({ SHARED: 'feature-value', PHASE_ONLY: 'phase-value' });
    // Phase 02: only feature-top-level keys.
    expect(phase02Impl?.agentEnv).toEqual({ SHARED: 'feature-value' });
  });
});

// ---------------------------------------------------------------------------
// per-phase-config phase 7.5 — Level-2 emission + transition flag
// ---------------------------------------------------------------------------

describe('compilePhasesToSubtasks — per-phase Level-2 overrides (phase 7.5)', () => {
  it('threads agent.profile onto every subtask in the phase', async () => {
    await makePhase('01-core');
    await makeCritic('strict', 'be strict');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `agent:\n  profile: claude\n`,
      'utf8',
    );
    const out = await compile();
    expect(out).toHaveLength(3); // impl + strict (discover + fix)
    for (const st of out) {
      expect(st.agentProfileId).toBe('claude');
    }
  });

  it('reads agent.install / container.startup / container.cedar content via script-resolver', async () => {
    const phaseDir = await makePhase('01-core');
    await writeFile(join(phaseDir, 'install.sh'), 'phase-install\n', 'utf8');
    await writeFile(join(phaseDir, 'startup.sh'), 'phase-startup\n', 'utf8');
    await writeFile(join(phaseDir, 'cedar.cedar'), 'permit(...)', 'utf8');
    // `no-leash: false` is required when `cedar` is set — §6.9.1 lockstep
    // rejects `cedar` + `no-leash: true` because Cedar is meaningless
    // without Leash.
    await writeFile(
      join(phaseDir, 'phase.yml'),
      `agent:\n  install: install.sh\ncontainer:\n  startup: startup.sh\n  cedar: cedar.cedar\n  no-leash: false\n`,
      'utf8',
    );
    const out = await compile();
    expect(out[0]?.agentInstallScript).toBe('phase-install\n');
    expect(out[0]?.startupScript).toBe('phase-startup\n');
    expect(out[0]?.cedarScript).toBe('permit(...)');
    expect(out[0]?.dangerousNoLeash).toBe(false);
  });

  it('does not set Level-2 fields when the phase declares none (back-compat)', async () => {
    await makePhase('01-core');
    const out = await compile();
    expect(out[0]?.agentProfileId).toBeUndefined();
    expect(out[0]?.agentInstallScript).toBeUndefined();
    expect(out[0]?.startupScript).toBeUndefined();
    expect(out[0]?.cedarScript).toBeUndefined();
    expect(out[0]?.dangerousNoLeash).toBeUndefined();
  });
});

describe('compilePhasesToSubtasks — requiresLevel2RestartFromPrev flag', () => {
  it('does NOT set the flag on the first phase (no prior phase to compare)', async () => {
    await makePhase('01-a');
    await writeFile(
      join(featureDir, 'phases', '01-a', 'phase.yml'),
      `agent:\n  profile: claude\n`,
      'utf8',
    );
    const out = await compile();
    expect(out[0]?.requiresLevel2RestartFromPrev).toBeUndefined();
  });

  // Flag-set / flag-on-impl-only end-to-end behaviour is exercised at the
  // detector level (`phase-transition.test.ts`: positive diff cases for
  // each Level-2 field, including the spec.md "share profile but differ
  // on container.startup → flag fires" mixed-scenario test). Phase 7.5e
  // removed the validator gate, so the integration paths below now
  // exercise `compile()` end-to-end against the flag-set code.

  it('does NOT set the flag when adjacent phases share the same Level-2 (feature top-level case)', async () => {
    await makePhase('01-a');
    await makePhase('02-b');
    await writeFile(join(featureDir, 'feature.yml'), `agent:\n  profile: claude\n`, 'utf8');
    const out = await compile();
    for (const st of out) {
      expect(st.requiresLevel2RestartFromPrev).toBeUndefined();
    }
  });

  // Phase 7.5e: validator gate removed; the flag IS now reachable
  // through `compile()`. Pin the integration: phase B's first impl
  // subtask carries `requiresLevel2RestartFromPrev: true`, every other
  // subtask carries the flag absent. The runtime side
  // (`loop.ts:runIterativeLoop`) reads this flag at the boundary and
  // drives `runControlledRestart`.
  it('sets the flag on phase B impl when Level-2 differs across adjacent phases (post-7.5e)', async () => {
    await makePhase('01-a');
    await makePhase('02-b');
    await writeFile(
      join(featureDir, 'phases', '01-a', 'phase.yml'),
      `agent:\n  profile: claude\n`,
      'utf8',
    );
    await writeFile(
      join(featureDir, 'phases', '02-b', 'phase.yml'),
      `agent:\n  profile: aider\n`,
      'utf8',
    );
    const out = await compile();
    const phaseAImpl = out.find((s) => s.title === 'phase:01-a impl');
    const phaseBImpl = out.find((s) => s.title === 'phase:02-b impl');
    expect(phaseAImpl?.requiresLevel2RestartFromPrev).toBeUndefined();
    expect(phaseBImpl?.requiresLevel2RestartFromPrev).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// per-phase-config phase 7.5b (level-3-mirror) — Level-3 emission + flag.
// Same shape as the Level-2 block above: pin field threading, pin the
// no-transition top-level case, and pin the flag-fires-on-impl case
// (post-7.5e the validator gate is gone, so the integration is reachable
// through `compile()`).
// ---------------------------------------------------------------------------

describe('compilePhasesToSubtasks — per-phase Level-3 overrides (phase 7.5b — level-3-mirror)', () => {
  it('threads container.image onto every subtask in the phase', async () => {
    await makePhase('01-core');
    await makeCritic('strict', 'be strict');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `container:\n  image: my-coder:v2\n`,
      'utf8',
    );
    const out = await compile();
    expect(out).toHaveLength(3); // impl + strict (discover + fix)
    for (const st of out) {
      expect(st.containerImage).toBe('my-coder:v2');
    }
  });

  it('threads container.engine and container.compose-file onto every subtask', async () => {
    const phaseDir = await makePhase('01-core');
    // The script-resolver path checks the compose file exists on disk
    // (same rule as gate.script / agent.install / etc.).
    await writeFile(join(phaseDir, 'docker-compose.gpu.yml'), 'services: {}\n', 'utf8');
    await writeFile(
      join(phaseDir, 'phase.yml'),
      `container:\n  engine: docker\n  compose-file: docker-compose.gpu.yml\n`,
      'utf8',
    );
    const out = await compile();
    expect(out[0]?.containerEngine).toBe('docker');
    expect(out[0]?.containerComposeFile).toBe('docker-compose.gpu.yml');
  });

  it('threads container.sandbox-profile onto every subtask', async () => {
    await makePhase('01-core');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `container:\n  sandbox-profile: python-uv\n`,
      'utf8',
    );
    const out = await compile();
    expect(out[0]?.containerSandboxProfileId).toBe('python-uv');
  });

  it('does not set Level-3 fields when the phase declares none (back-compat)', async () => {
    await makePhase('01-core');
    const out = await compile();
    expect(out[0]?.containerImage).toBeUndefined();
    expect(out[0]?.containerSandboxProfileId).toBeUndefined();
    expect(out[0]?.containerEngine).toBeUndefined();
    expect(out[0]?.containerComposeFile).toBeUndefined();
  });

  // Review M5: per-phase overrides must validate the same way the
  // run-level baseline does. Without this, a malformed image tag /
  // unknown sandbox-profile id silently rides on every subtask of a
  // phase and reaches `docker run` arguments once 7.5e wires the
  // runtime side. The Level-4 helper already does this for
  // `runner.test-image` (per-phase-config 7.3 F-C); these mirror.
  it('rejects an invalid container.image tag at compile time', async () => {
    await makePhase('01-core');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `container:\n  image: 'bad tag with spaces'\n`,
      'utf8',
    );
    await expect(compile()).rejects.toThrow(/invalid tag.*bad tag with spaces/);
  });

  it('rejects an unknown container.sandbox-profile id at compile time', async () => {
    await makePhase('01-core');
    await writeFile(
      join(featureDir, 'phases', '01-core', 'phase.yml'),
      `container:\n  sandbox-profile: definitely-not-a-real-profile\n`,
      'utf8',
    );
    await expect(compile()).rejects.toThrow(/unsupported.*sandbox-profile.*definitely-not-a-real/);
  });
});

describe('compilePhasesToSubtasks — requiresLevel3RestartFromPrev flag', () => {
  it('does NOT set the flag on the first phase (no prior phase to compare)', async () => {
    await makePhase('01-a');
    await writeFile(
      join(featureDir, 'phases', '01-a', 'phase.yml'),
      `container:\n  image: my-coder:v2\n`,
      'utf8',
    );
    const out = await compile();
    expect(out[0]?.requiresLevel3RestartFromPrev).toBeUndefined();
  });

  // Phase 7.5e: validator gate removed; the Level-3 flag is reachable
  // through `compile()`. Same shape as the Level-2 case above.

  it('sets the flag on phase B impl when Level-3 differs across adjacent phases (post-7.5e)', async () => {
    await makePhase('01-a');
    await makePhase('02-b');
    await writeFile(
      join(featureDir, 'phases', '01-a', 'phase.yml'),
      `container:\n  image: my-coder:v1\n`,
      'utf8',
    );
    await writeFile(
      join(featureDir, 'phases', '02-b', 'phase.yml'),
      `container:\n  image: my-coder:v2\n`,
      'utf8',
    );
    const out = await compile();
    const phaseAImpl = out.find((s) => s.title === 'phase:01-a impl');
    const phaseBImpl = out.find((s) => s.title === 'phase:02-b impl');
    expect(phaseAImpl?.requiresLevel3RestartFromPrev).toBeUndefined();
    expect(phaseBImpl?.requiresLevel3RestartFromPrev).toBe(true);
  });

  it('does NOT set the flag when adjacent phases share the same Level-3 (feature top-level case)', async () => {
    await makePhase('01-a');
    await makePhase('02-b');
    await writeFile(join(featureDir, 'feature.yml'), `container:\n  image: my-coder:v2\n`, 'utf8');
    const out = await compile();
    for (const st of out) {
      expect(st.requiresLevel3RestartFromPrev).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// per-phase-config phase 7.5 — always-emit / idempotency invariant when a
// run-level Level-2 baseline IS supplied (the production `feat run` path).
//
// The blocks above (`per-phase Level-2 overrides`, `requiresLevel2RestartFromPrev`)
// exercise the no-baseline preview path used by `feat phases compile`. In
// production, `resolveSubtasks` always passes a baseline through
// `compilePhasesToSubtasks`, and the contract there is **stricter**:
//
//   - Every emitted subtask carries the fully-resolved Level-2 set
//     (override OR run-level fallback) on every field, even when the
//     phase declares no override. Required so 7.5b's per-attempt opts
//     derivation can read each subtask's manifest without falling
//     through to the prior phase's leftover state.
//   - Critic subtasks share the phase's resolved Level-2 (no diff
//     flag), matching the impl's row.
//   - Diff comparison uses the fully-resolved values, so a phase
//     declaration that happens to match the baseline produces no
//     transition flag.
//
// Without these tests, a regression that drops the baseline-fallback for
// non-overriding phases passes the existing suite (every assertion is
// `toBeUndefined()` either way) and silently breaks the 7.5b runtime.
// ---------------------------------------------------------------------------
describe('compilePhasesToSubtasks — Level-2 always-emit with baseline (production path)', () => {
  const BASELINE: RunLevelLevel2Baseline = {
    agentProfileId: 'openhands',
    agentInstallScript: '#!/bin/sh\nbaseline-install',
    startupScript: '#!/bin/sh\nbaseline-startup',
    cedarScript: 'permit(principal, action, resource);',
    dangerousNoLeash: false,
  };

  async function compileWithBaseline(): Promise<ReturnType<typeof compilePhasesToSubtasks>> {
    return compilePhasesToSubtasks({
      featureAbsolutePath: featureDir,
      featureName: FEATURE_NAME,
      saifctlDir: SAIFCTL_DIR,
      projectDir,
      gateScript: '#!/bin/sh\nexit 0',
      agentScript: '#!/bin/sh\necho agent',
      stageScript: '#!/bin/sh\necho stage',
      runLevelLevel2Baseline: BASELINE,
    });
  }

  it('fills every Level-2 field on every subtask from the baseline when the phase declares no override', async () => {
    await makePhase('01-core');
    await makeCritic('strict', 'be strict');
    const out = await compileWithBaseline();
    expect(out).toHaveLength(3); // impl + strict (discover + fix)
    for (const st of out) {
      expect(st.agentProfileId).toBe('openhands');
      expect(st.agentInstallScript).toBe('#!/bin/sh\nbaseline-install');
      expect(st.startupScript).toBe('#!/bin/sh\nbaseline-startup');
      expect(st.cedarScript).toBe('permit(principal, action, resource);');
      expect(st.dangerousNoLeash).toBe(false);
    }
  });

  it('mixes phase override + baseline fallback per-field on the same subtask', async () => {
    // Phase declares `agent.profile` only; the other four fields must
    // fall back to baseline. This is the exact shape that proves
    // resolvePhaseLevel2Overrides doesn't leave undefined holes when
    // baseline is supplied.
    const phaseDir = await makePhase('01-core');
    await writeFile(join(phaseDir, 'phase.yml'), `agent:\n  profile: claude\n`, 'utf8');
    const out = await compileWithBaseline();
    const impl = out[0]!;
    expect(impl.agentProfileId).toBe('claude');
    // Profile-default resolution synthesises the bundled install script
    // for `claude` (review F-D); content comes from the on-disk
    // bundled script, not the baseline. Just assert it's NOT the
    // baseline (i.e. the override path overrode the install too).
    expect(impl.agentInstallScript).not.toBe(BASELINE.agentInstallScript);
    expect(impl.agentInstallScript).toBeDefined();
    // The other three fields had no override → baseline.
    expect(impl.startupScript).toBe(BASELINE.startupScript);
    expect(impl.cedarScript).toBe(BASELINE.cedarScript);
    expect(impl.dangerousNoLeash).toBe(BASELINE.dangerousNoLeash);
  });

  // Phase 7.5e removed the validator gate (and its YAML-only
  // `toLevel2Snapshot` projection). The compiler's baseline-aware diff
  // is now the only authority — see the detector-level coverage in
  // `phase-transition.test.ts` for the "explicit-matches-baseline" case
  // which now compiles cleanly (no flag, no error).

  it('critic subtasks carry the same resolved Level-2 set as their parent impl, never the flag', async () => {
    // Pin the spec.md "critic subtasks share the phase's Level-2 config —
    // they don't need a transition mid-phase" rule.
    const phaseDir = await makePhase('01-core');
    await writeFile(
      join(phaseDir, 'phase.yml'),
      `agent:\n  profile: claude\ncritics:\n  - id: strict\n`,
      'utf8',
    );
    await makeCritic('strict', 'be strict');
    const out = await compileWithBaseline();
    expect(out.length).toBeGreaterThanOrEqual(3);
    const impl = out.find((s) => s.title?.endsWith('impl'))!;
    const critics = out.filter((s) => s.criticPrompt);
    for (const c of critics) {
      expect(c.agentProfileId).toBe(impl.agentProfileId);
      expect(c.agentInstallScript).toBe(impl.agentInstallScript);
      expect(c.startupScript).toBe(impl.startupScript);
      expect(c.cedarScript).toBe(impl.cedarScript);
      expect(c.dangerousNoLeash).toBe(impl.dangerousNoLeash);
      expect(c.requiresLevel2RestartFromPrev).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// per-phase-config phase 7.6 — per-phase max-attempts. The compiler emits
// `limits.maxAttempts` on every subtask of a phase that declares
// `limits.max-attempts` so the loop's per-phase-budget check reads the
// same cap regardless of which subtask (impl + critic rounds) is active.
// ---------------------------------------------------------------------------

describe('compilePhasesToSubtasks — per-phase limits.max-attempts (phase 7.6)', () => {
  it('threads limits.maxAttempts onto every subtask in the phase (impl + critic rounds)', async () => {
    const phaseDir = await makePhase('01-core');
    await writeFile(
      join(phaseDir, 'phase.yml'),
      `limits:\n  max-attempts: 3\ncritics:\n  - id: strict\n`,
      'utf8',
    );
    await makeCritic('strict', 'be strict');
    const out = await compile();
    expect(out).toHaveLength(3); // impl + strict (discover + fix)
    for (const st of out) {
      expect(st.limits?.maxAttempts).toBe(3);
    }
  });

  it('does not set limits when the phase declares no max-attempts (back-compat)', async () => {
    await makePhase('01-core');
    const out = await compile();
    expect(out[0]?.limits).toBeUndefined();
  });

  it('feature.yml top-level max-attempts propagates to every phase that does not override', async () => {
    await makePhase('01-core');
    await makePhase('02-trigger');
    await writeFile(join(featureDir, 'feature.yml'), `limits:\n  max-attempts: 4\n`, 'utf8');
    const out = await compile();
    expect(out).toHaveLength(2);
    for (const st of out) {
      expect(st.limits?.maxAttempts).toBe(4);
    }
  });

  it('per-phase override takes precedence over feature top-level', async () => {
    const phaseA = await makePhase('01-a');
    await makePhase('02-b');
    await writeFile(join(featureDir, 'feature.yml'), `limits:\n  max-attempts: 4\n`, 'utf8');
    await writeFile(join(phaseA, 'phase.yml'), `limits:\n  max-attempts: 2\n`, 'utf8');
    const out = await compile();
    const a = out.find((s) => s.title === 'phase:01-a impl')!;
    const b = out.find((s) => s.title === 'phase:02-b impl')!;
    expect(a.limits?.maxAttempts).toBe(2);
    expect(b.limits?.maxAttempts).toBe(4);
  });

  it('a phase with only feature.yml-side declaration carries the cap on its critics too', async () => {
    const phaseDir = await makePhase('01-core');
    await writeFile(join(phaseDir, 'phase.yml'), `critics:\n  - id: strict\n`, 'utf8');
    await writeFile(join(featureDir, 'feature.yml'), `limits:\n  max-attempts: 7\n`, 'utf8');
    await makeCritic('strict', 'be strict');
    const out = await compile();
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (const st of out) {
      expect(st.limits?.maxAttempts).toBe(7);
    }
  });
});
