/**
 * End-to-end check for the minimal `tests.none` walkthrough at
 * `saifctl/features/_phases-pure-output-example/`.
 *
 * Pins the per-phase-config v1 contract for the smallest interesting
 * shape: one phase, `tests.none: true`, `gate.script` pointing at an
 * assertion script, and an empty critic list. The compiled output is
 * the smoke test — if any of the per-phase-config plumbing regresses
 * (compile path resolution, runner-bypass routing, gate-script content
 * threading), this test catches it.
 *
 * Underscore prefix ⇒ feature discovery skips it (see
 * `src/specs/discover.ts`); this isn't a real production feature.
 */

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { compilePhasesToSubtasks } from './compile.js';

const PROJECT_DIR = resolve(__dirname, '../../..');
const FEATURE_DIR = resolve(PROJECT_DIR, 'saifctl/features/_phases-pure-output-example');

describe('_phases-pure-output-example minimal walkthrough', () => {
  it('compiles to exactly one impl subtask (no critics, no runner)', async () => {
    const out = await compilePhasesToSubtasks({
      featureAbsolutePath: FEATURE_DIR,
      featureName: '_phases-pure-output-example',
      saifctlDir: 'saifctl',
      projectDir: PROJECT_DIR,
      gateScript: '#!/bin/sh\necho run-level-gate',
      agentScript: '#!/bin/sh\necho agent',
      stageScript: '#!/bin/sh\necho stage',
    });

    expect(out.map((s) => s.title)).toEqual(['phase:01-emit impl']);
  });

  it('threads the per-phase gate.script content (assert-emitted.sh) onto the impl subtask, not the run-level gate', async () => {
    const out = await compilePhasesToSubtasks({
      featureAbsolutePath: FEATURE_DIR,
      featureName: '_phases-pure-output-example',
      saifctlDir: 'saifctl',
      projectDir: PROJECT_DIR,
      gateScript: '#!/bin/sh\necho run-level-gate',
      agentScript: '#!/bin/sh\necho agent',
      stageScript: '#!/bin/sh\necho stage',
    });
    const impl = out[0]!;
    expect(impl.gateScript).toContain('manifest.json');
    expect(impl.gateScript).toContain('gate:');
    expect(impl.gateScript).not.toBe('#!/bin/sh\necho run-level-gate');
  });

  it('flags noRunner=true on the impl subtask (Level-4 tests.none routing)', async () => {
    const out = await compilePhasesToSubtasks({
      featureAbsolutePath: FEATURE_DIR,
      featureName: '_phases-pure-output-example',
      saifctlDir: 'saifctl',
      projectDir: PROJECT_DIR,
      gateScript: '#!/bin/sh\nexit 0',
      agentScript: '#!/bin/sh\necho agent',
      stageScript: '#!/bin/sh\necho stage',
    });
    expect(out[0]?.noRunner).toBe(true);
  });

  it('disables the reviewer at the run level (feature.yml agent.reviewer: false)', async () => {
    // The reviewer toggle lives at the per-subtask level (Level-1.5);
    // a feature.yml-top-level declaration propagates onto every subtask
    // via the resolver's inheritance chain.
    const out = await compilePhasesToSubtasks({
      featureAbsolutePath: FEATURE_DIR,
      featureName: '_phases-pure-output-example',
      saifctlDir: 'saifctl',
      projectDir: PROJECT_DIR,
      gateScript: '#!/bin/sh\nexit 0',
      agentScript: '#!/bin/sh\necho agent',
      stageScript: '#!/bin/sh\necho stage',
    });
    expect(out[0]?.reviewerEnabled).toBe(false);
  });
});
