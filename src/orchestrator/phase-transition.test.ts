/**
 * Tests for the per-phase-config phase 7.5 / 7.5b transition detectors
 * (Level-2 + Level-3).
 *
 * Pins the field sets each detector compares, the equality semantics
 * (`undefined === undefined` ⇒ no transition), and the order-stable
 * field path output. Level-2 and Level-3 are kept distinct in the API
 * surface so phase 7.5e can branch on the cost class.
 */

import { describe, expect, it } from 'vitest';

import type { RunTransitionInProgress } from '../runs/types.js';
import {
  buildTransitionSnapshot,
  completeControlledRestart,
  detectLevel2Transition,
  detectLevel3Transition,
  enrichErrorWithTransitionContext,
  requiresLevel2Restart,
  requiresLevel3Restart,
  runControlledRestart,
  type SubtaskWithLevel2Fields,
} from './phase-transition.js';

describe('detectLevel2Transition', () => {
  it('returns an empty diff when both sides are empty', () => {
    expect(detectLevel2Transition({}, {}).fields).toEqual([]);
  });

  it('returns an empty diff when both sides set the SAME values', () => {
    const diff = detectLevel2Transition(
      { agentProfileId: 'claude', dangerousNoLeash: false },
      { agentProfileId: 'claude', dangerousNoLeash: false },
    );
    expect(diff.fields).toEqual([]);
  });

  it('detects a difference on agent.profile', () => {
    const diff = detectLevel2Transition({ agentProfileId: 'claude' }, { agentProfileId: 'aider' });
    expect(diff.fields).toContain('agent.profile');
  });

  it('detects a difference on agent.install', () => {
    const diff = detectLevel2Transition(
      { agentInstallScript: '#!/bin/sh\nv1' },
      { agentInstallScript: '#!/bin/sh\nv2' },
    );
    expect(diff.fields).toContain('agent.install');
  });

  it('detects a difference on container.startup', () => {
    const diff = detectLevel2Transition(
      { startupScript: '#!/bin/sh\necho a' },
      { startupScript: '#!/bin/sh\necho b' },
    );
    expect(diff.fields).toContain('container.startup');
  });

  it('detects a difference on container.cedar', () => {
    const diff = detectLevel2Transition(
      { cedarScript: 'permit(...)' },
      { cedarScript: 'forbid(...)' },
    );
    expect(diff.fields).toContain('container.cedar');
  });

  it('detects a difference on container.no-leash', () => {
    const diff = detectLevel2Transition({ dangerousNoLeash: false }, { dangerousNoLeash: true });
    expect(diff.fields).toContain('container.no-leash');
  });

  it("treats `undefined === undefined` as 'no diff' (silent fields don't trigger)", () => {
    // Both sides leave `agent.profile` undefined; that's not a transition.
    expect(detectLevel2Transition({}, {}).fields).toEqual([]);
  });

  it('returns multiple field paths when several Level-2 fields differ', () => {
    const diff = detectLevel2Transition(
      { agentProfileId: 'claude', dangerousNoLeash: false, startupScript: 'x' },
      { agentProfileId: 'aider', dangerousNoLeash: true, startupScript: 'y' },
    );
    expect(diff.fields).toEqual(
      expect.arrayContaining(['agent.profile', 'container.startup', 'container.no-leash']),
    );
    expect(diff.fields).toHaveLength(3);
  });

  it('emits field paths in stable order across calls (deterministic for log/error messages)', () => {
    const diff1 = detectLevel2Transition(
      { agentProfileId: 'a', dangerousNoLeash: false },
      { agentProfileId: 'b', dangerousNoLeash: true },
    );
    const diff2 = detectLevel2Transition(
      { agentProfileId: 'a', dangerousNoLeash: false },
      { agentProfileId: 'b', dangerousNoLeash: true },
    );
    expect(diff1.fields).toEqual(diff2.fields);
  });

  // Spec.md "Mixed scenario: phase A and phase B share `agent.profile` but
  // phase B overrides `container.startup` → flag set" — pinned at the
  // detector level because the integration-test path through
  // `compile()` is blocked by the validator gate (see
  // `compile.test.ts:requiresLevel2RestartFromPrev flag` rationale).
  it('detects a transition when only ONE field differs while another stays equal (mixed scenario)', () => {
    const diff = detectLevel2Transition(
      { agentProfileId: 'claude', startupScript: 'phase-a-startup' },
      { agentProfileId: 'claude', startupScript: 'phase-b-startup' },
    );
    expect(diff.fields).toEqual(['container.startup']);
  });

  // Review F-I: the spec.md asks the detector to "distinguish Level-2 from
  // Level-3" — i.e. Level-3 differences must NOT show up in the diff.
  // Structurally, `SubtaskWithLevel2Fields` only types Level-2 keys, so
  // a caller can't "pass in" a Level-3 difference. We pin that here by
  // type-cast: any extra keys riding on the `RunSubtaskInput` shape
  // (e.g. the Level-3 `container.image`-equivalent fields when 7.5b
  // lands) must be invisible to this detector.
  it('does NOT include non-Level-2 fields in the diff even when extra keys differ', () => {
    type WithExtras = SubtaskWithLevel2Fields & Record<string, unknown>;
    const a: WithExtras = { agentProfileId: 'claude', containerImage: 'node:18' };
    const b: WithExtras = { agentProfileId: 'claude', containerImage: 'node:20' };
    expect(detectLevel2Transition(a, b).fields).toEqual([]);
  });
});

describe('requiresLevel2Restart', () => {
  it('returns false when configs match', () => {
    expect(requiresLevel2Restart({ agentProfileId: 'claude' }, { agentProfileId: 'claude' })).toBe(
      false,
    );
  });

  it('returns true when any Level-2 field differs', () => {
    expect(requiresLevel2Restart({ agentProfileId: 'claude' }, { agentProfileId: 'aider' })).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// per-phase-config phase 7.5b (level-3-mirror) — Level-3 detector pinned
// with the same shape as Level-2 above (image / sandbox-profile / engine /
// compose-file). Kept in its own describe block so failures localise to
// the cost class. Phase 7.5e will read the diff to branch on transition
// cost (Level-2 = script refresh; Level-3 = image pull / stack swap).
// ---------------------------------------------------------------------------

describe('detectLevel3Transition', () => {
  it('returns an empty diff when both sides are empty', () => {
    expect(detectLevel3Transition({}, {}).fields).toEqual([]);
  });

  it('returns an empty diff when both sides set the SAME values', () => {
    const diff = detectLevel3Transition(
      { containerImage: 'node:20', containerEngine: 'docker' },
      { containerImage: 'node:20', containerEngine: 'docker' },
    );
    expect(diff.fields).toEqual([]);
  });

  it('detects a difference on container.image', () => {
    const diff = detectLevel3Transition(
      { containerImage: 'node:18' },
      { containerImage: 'node:20' },
    );
    expect(diff.fields).toContain('container.image');
  });

  it('detects a difference on container.sandbox-profile', () => {
    const diff = detectLevel3Transition(
      { containerSandboxProfileId: 'node-pnpm' },
      { containerSandboxProfileId: 'node-pnpm-python' },
    );
    expect(diff.fields).toContain('container.sandbox-profile');
  });

  it('detects a difference on container.engine', () => {
    const diff = detectLevel3Transition({ containerEngine: 'docker' }, { containerEngine: 'helm' });
    expect(diff.fields).toContain('container.engine');
  });

  it('detects a difference on container.compose-file', () => {
    const diff = detectLevel3Transition(
      { containerComposeFile: 'docker-compose.yml' },
      { containerComposeFile: 'docker-compose.gpu.yml' },
    );
    expect(diff.fields).toContain('container.compose-file');
  });

  it("treats `undefined === undefined` as 'no diff'", () => {
    expect(detectLevel3Transition({}, {}).fields).toEqual([]);
  });

  it('returns multiple field paths when several Level-3 fields differ', () => {
    const diff = detectLevel3Transition(
      { containerImage: 'a', containerEngine: 'docker', containerComposeFile: 'x.yml' },
      { containerImage: 'b', containerEngine: 'helm', containerComposeFile: 'y.yml' },
    );
    expect(diff.fields).toEqual(
      expect.arrayContaining(['container.image', 'container.engine', 'container.compose-file']),
    );
    expect(diff.fields).toHaveLength(3);
  });

  it('emits field paths in stable order across calls (deterministic for log/error messages)', () => {
    const diff1 = detectLevel3Transition(
      { containerImage: 'a', containerEngine: 'docker' },
      { containerImage: 'b', containerEngine: 'helm' },
    );
    const diff2 = detectLevel3Transition(
      { containerImage: 'a', containerEngine: 'docker' },
      { containerImage: 'b', containerEngine: 'helm' },
    );
    expect(diff1.fields).toEqual(diff2.fields);
  });

  // Symmetric to the Level-2 "does NOT include non-Level-2 fields" test
  // above — Level-2 fields must NOT show up in a Level-3 diff. Important
  // when phase 7.5e reads both diffs to decide cost class.
  it('does NOT include non-Level-3 fields in the diff even when extra keys differ', () => {
    const a = { containerImage: 'node:20', agentProfileId: 'claude' };
    const b = { containerImage: 'node:20', agentProfileId: 'aider' };
    expect(detectLevel3Transition(a, b).fields).toEqual([]);
  });
});

describe('requiresLevel3Restart', () => {
  it('returns false when configs match', () => {
    expect(
      requiresLevel3Restart({ containerImage: 'node:20' }, { containerImage: 'node:20' }),
    ).toBe(false);
  });

  it('returns true when any Level-3 field differs', () => {
    expect(requiresLevel3Restart({ containerEngine: 'docker' }, { containerEngine: 'helm' })).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// per-phase-config phase 7.5d — `runControlledRestart` orchestration helper.
// Pin the invariants the loop integration relies on:
//   - persist transitionInProgress BEFORE refresh (artifact-write-before-teardown)
//   - on success, clear the flag
//   - on refresh failure, the flag stays set (a `run resume` re-runs the
//     transition from the same cursor → idempotent)
//   - the persisted snapshot carries the cursor + cost class + field set
//     so a crashed transition can be reconstructed
// ---------------------------------------------------------------------------

describe('runControlledRestart', () => {
  /**
   * Build a callback set that records the call order so tests can assert
   * "persist before refresh before clear" without scaffolding a mock library.
   */
  function makeRecorders() {
    const calls: string[] = [];
    const persisted: unknown[] = [];
    const persist = async (snap: unknown): Promise<void> => {
      calls.push('persist');
      persisted.push(snap);
    };
    const refresh = async (): Promise<void> => {
      calls.push('refresh');
    };
    const clear = async (): Promise<void> => {
      calls.push('clear');
    };
    return { calls, persisted, persist, refresh, clear };
  }

  it('drives the sequence persist → refresh → clear on the success path', async () => {
    const r = makeRecorders();
    await runControlledRestart({
      toSubtaskIndex: 3,
      costClass: 'level-2',
      fields: ['agent.profile'],
      persistTransitionInProgress: r.persist,
      refreshSandboxScripts: r.refresh,
      clearTransitionInProgress: r.clear,
      nowIso: () => '2026-05-07T12:00:00.000Z',
    });
    expect(r.calls).toEqual(['persist', 'refresh', 'clear']);
  });

  it('persists a RunTransitionInProgress snapshot containing the cursor + cost class + fields + clock', async () => {
    const r = makeRecorders();
    await runControlledRestart({
      toSubtaskIndex: 7,
      costClass: 'level-2-3',
      fields: ['agent.profile', 'container.image'],
      persistTransitionInProgress: r.persist,
      refreshSandboxScripts: r.refresh,
      clearTransitionInProgress: r.clear,
      nowIso: () => '2026-05-07T12:34:56.000Z',
    });
    expect(r.persisted[0]).toEqual({
      toSubtaskIndex: 7,
      costClass: 'level-2-3',
      fields: ['agent.profile', 'container.image'],
      startedAt: '2026-05-07T12:34:56.000Z',
    });
  });

  it('does NOT clear the flag when refreshSandboxScripts throws (so `run resume` re-runs the transition idempotently)', async () => {
    const r = makeRecorders();
    const refreshErr = new Error('image pull failed: docker daemon unreachable');
    await expect(
      runControlledRestart({
        toSubtaskIndex: 2,
        costClass: 'level-3',
        fields: ['container.image'],
        persistTransitionInProgress: r.persist,
        refreshSandboxScripts: async () => {
          r.calls.push('refresh');
          throw refreshErr;
        },
        clearTransitionInProgress: r.clear,
      }),
    ).rejects.toThrow(/image pull failed/);
    // Persist ran (artifact-before-teardown invariant), refresh ran (then
    // threw), clear MUST NOT have run — the flag stays set so a resume
    // re-runs `runControlledRestart` from the same cursor.
    expect(r.calls).toEqual(['persist', 'refresh']);
  });

  it('does NOT call refresh or clear when persistTransitionInProgress throws (artifact-first invariant)', async () => {
    // Storage write failed before the orchestration even started touching
    // the sandbox. Refresh + clear must NOT run — the run state is exactly
    // what it was before the call (no half-applied transition).
    const calls: string[] = [];
    const persistErr = new Error('storage write failed: permission denied');
    await expect(
      runControlledRestart({
        toSubtaskIndex: 1,
        costClass: 'level-2',
        fields: ['agent.profile'],
        persistTransitionInProgress: async () => {
          calls.push('persist');
          throw persistErr;
        },
        refreshSandboxScripts: async () => {
          calls.push('refresh');
        },
        clearTransitionInProgress: async () => {
          calls.push('clear');
        },
      }),
    ).rejects.toThrow(/storage write failed/);
    expect(calls).toEqual(['persist']);
  });

  it('uses the supplied nowIso clock so persisted snapshots are deterministic in tests', async () => {
    // Clock-injection support is the contract that lets the loop's "we
    // crashed mid-transition" tests pin an exact timestamp on the
    // persisted artifact without monkey-patching `Date`.
    const r = makeRecorders();
    let n = 0;
    await runControlledRestart({
      toSubtaskIndex: 0,
      costClass: 'level-2',
      fields: ['container.startup'],
      persistTransitionInProgress: r.persist,
      refreshSandboxScripts: r.refresh,
      clearTransitionInProgress: r.clear,
      nowIso: () => `2026-01-01T00:00:0${n++}.000Z`,
    });
    const snap = r.persisted[0] as { startedAt: string };
    expect(snap.startedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('preserves the field-set order across the persist boundary (callers expect stable output)', async () => {
    // The detectors emit `fields` in a stable declaration order. Re-ordering
    // here would break the contract that "the same input produces the same
    // persisted snapshot," which the resume idempotency tests rely on.
    const r = makeRecorders();
    const orderA: readonly string[] = ['agent.profile', 'container.startup', 'container.no-leash'];
    await runControlledRestart({
      toSubtaskIndex: 1,
      costClass: 'level-2',
      fields: orderA,
      persistTransitionInProgress: r.persist,
      refreshSandboxScripts: r.refresh,
      clearTransitionInProgress: r.clear,
    });
    const snap = r.persisted[0] as { fields: readonly string[] };
    expect(snap.fields).toEqual(orderA);
  });
});

// ---------------------------------------------------------------------------
// per-phase-config phase 7.5d — `buildTransitionSnapshot`. Pure compute that
// turns a (prev, next, cursor) triple into the persisted snapshot + cost
// class. Used by `loop.ts:onSubtaskComplete` so the two call sites
// (sandbox-complete advance, tests-passed advance) share one detection
// path and one cost-class derivation rule.
// ---------------------------------------------------------------------------

describe('buildTransitionSnapshot', () => {
  it('returns null when neither Level-2 nor Level-3 fields differ', () => {
    expect(
      buildTransitionSnapshot({
        prev: { agentProfileId: 'claude', containerImage: 'node:20' },
        next: { agentProfileId: 'claude', containerImage: 'node:20' },
        toSubtaskIndex: 1,
      }),
    ).toBeNull();
  });

  it('detects a Level-2-only difference and tags costClass: level-2', () => {
    const out = buildTransitionSnapshot({
      prev: { agentProfileId: 'claude' },
      next: { agentProfileId: 'aider' },
      toSubtaskIndex: 1,
      nowIso: () => '2026-05-07T10:00:00.000Z',
    });
    expect(out).not.toBeNull();
    expect(out!.costClass).toBe('level-2');
    expect(out!.fields).toEqual(['agent.profile']);
    expect(out!.snapshot).toEqual({
      toSubtaskIndex: 1,
      costClass: 'level-2',
      fields: ['agent.profile'],
      startedAt: '2026-05-07T10:00:00.000Z',
    });
  });

  it('detects a Level-3-only difference and tags costClass: level-3', () => {
    const out = buildTransitionSnapshot({
      prev: { containerImage: 'node:18' },
      next: { containerImage: 'node:20' },
      toSubtaskIndex: 2,
      nowIso: () => '2026-05-07T10:00:00.000Z',
    });
    expect(out).not.toBeNull();
    expect(out!.costClass).toBe('level-3');
    expect(out!.fields).toEqual(['container.image']);
  });

  it('detects mixed Level-2 + Level-3 and tags costClass: level-2-3', () => {
    // Cost-class branching matters for the loop's logging — `'level-2-3'`
    // tells the user the boundary will pull an image AND restart the
    // container, so the wait could be minutes rather than seconds.
    const out = buildTransitionSnapshot({
      prev: { agentProfileId: 'claude', containerImage: 'node:18' },
      next: { agentProfileId: 'aider', containerImage: 'node:20' },
      toSubtaskIndex: 3,
      nowIso: () => '2026-05-07T10:00:00.000Z',
    });
    expect(out).not.toBeNull();
    expect(out!.costClass).toBe('level-2-3');
    expect(out!.fields).toEqual(['agent.profile', 'container.image']);
  });

  it('emits Level-2 fields BEFORE Level-3 fields in the combined diff (stable concatenation)', () => {
    // The loop reads `fields` to log the boundary; user-facing order should
    // be deterministic regardless of which detector fires first internally.
    const out = buildTransitionSnapshot({
      prev: {
        agentProfileId: 'claude',
        startupScript: 'a',
        containerEngine: 'docker',
        containerImage: 'node:18',
      },
      next: {
        agentProfileId: 'aider',
        startupScript: 'b',
        containerEngine: 'helm',
        containerImage: 'node:20',
      },
      toSubtaskIndex: 1,
    });
    expect(out!.fields).toEqual([
      'agent.profile',
      'container.startup',
      'container.image',
      'container.engine',
    ]);
  });

  it('uses the supplied nowIso clock so callers get deterministic snapshots in tests', () => {
    const out = buildTransitionSnapshot({
      prev: { agentProfileId: 'claude' },
      next: { agentProfileId: 'aider' },
      toSubtaskIndex: 0,
      nowIso: () => '2026-01-01T00:00:00.000Z',
    });
    expect(out!.snapshot.startedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// per-phase-config phase 7.5d — `completeControlledRestart`. Drives the
// post-teardown half (refresh sandbox scripts → clear flag) and pins the
// "refresh failure keeps the flag set" invariant. Called by `loop.ts` from
// both the normal post-teardown branch and the resume-recovery branch.
// ---------------------------------------------------------------------------

describe('completeControlledRestart', () => {
  it('drives the sequence refresh → clear on the success path', async () => {
    const calls: string[] = [];
    await completeControlledRestart({
      refreshSandboxScripts: async () => {
        calls.push('refresh');
      },
      clearTransitionInProgress: async () => {
        calls.push('clear');
      },
    });
    expect(calls).toEqual(['refresh', 'clear']);
  });

  it('does NOT call clearTransitionInProgress when refresh throws (resume idempotency)', async () => {
    // Same invariant as `runControlledRestart`'s refresh-failure branch:
    // a half-finished restart leaves the flag set so `run resume` can
    // re-enter `completeControlledRestart` against the same fresh-container
    // target without double-clearing or losing the recovery path.
    const calls: string[] = [];
    await expect(
      completeControlledRestart({
        refreshSandboxScripts: async () => {
          calls.push('refresh');
          throw new Error('image pull failed');
        },
        clearTransitionInProgress: async () => {
          calls.push('clear');
        },
      }),
    ).rejects.toThrow(/image pull failed/);
    expect(calls).toEqual(['refresh']);
  });

  it('propagates the underlying refresh error unchanged so the caller can format it', async () => {
    // The loop's resume path needs the original error text to log "transition
    // refresh failed; flag stays set, run resume to retry" with the actual
    // engine reason (e.g. "docker daemon unreachable"). Don't wrap.
    const original = new Error('docker daemon unreachable');
    let caught: unknown = null;
    try {
      await completeControlledRestart({
        refreshSandboxScripts: async () => {
          throw original;
        },
        clearTransitionInProgress: async () => {},
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// per-phase-config phase 7.5e — review N2: `enrichErrorWithTransitionContext`.
// When the first runCodingPhase call after a transition fails (e.g., a phase
// declares an unreachable `container.image`), the loop wraps the error with
// the phase id + field set so a user with a typo in `phase.yml` sees which
// YAML field to fix rather than the raw Docker / compose error.
// ---------------------------------------------------------------------------

describe('enrichErrorWithTransitionContext', () => {
  const transition: RunTransitionInProgress = {
    toSubtaskIndex: 3,
    costClass: 'level-3',
    fields: ['container.image'],
    startedAt: '2026-05-07T12:00:00.000Z',
  };

  it('prepends the phaseId + field set to the error message', () => {
    const original = new Error('image not found: my-coder:typo');
    const wrapped = enrichErrorWithTransitionContext({
      err: original,
      transition,
      activeSubtask: { phaseId: '02-deploy' },
    });
    expect(wrapped.message).toContain("phase '02-deploy'");
    expect(wrapped.message).toContain('`container.image`');
    expect(wrapped.message).toContain('image not found: my-coder:typo');
    expect(wrapped.message).toContain('saifctl run resume');
  });

  it('falls back to the subtask title when phaseId is missing', () => {
    const wrapped = enrichErrorWithTransitionContext({
      err: new Error('compose stack failed'),
      transition,
      activeSubtask: { title: 'verify deploy' },
    });
    expect(wrapped.message).toContain("subtask 'verify deploy'");
    expect(wrapped.message).not.toMatch(/phase '/);
  });

  it('falls back to the subtask index when no phaseId or title is set', () => {
    const wrapped = enrichErrorWithTransitionContext({
      err: new Error('docker daemon unreachable'),
      transition,
      activeSubtask: undefined,
    });
    expect(wrapped.message).toContain('subtask index 3');
  });

  it('preserves the original error as `cause` so tooling can walk the chain', () => {
    const original = new Error('image pull failed');
    const wrapped = enrichErrorWithTransitionContext({
      err: original,
      transition,
      activeSubtask: { phaseId: '02-deploy' },
    });
    expect(wrapped.cause).toBe(original);
  });

  it('preserves the original stack so traces still point at the underlying failure site', () => {
    const original = new Error('image pull failed');
    original.stack = 'Error: image pull failed\n    at ImagePuller.pull (image.ts:42)';
    const wrapped = enrichErrorWithTransitionContext({
      err: original,
      transition,
      activeSubtask: { phaseId: '02-deploy' },
    });
    expect(wrapped.stack).toBe(original.stack);
  });

  it('coerces non-Error values via String()', () => {
    // Guard against engines or libraries that throw non-Error objects;
    // the wrap should still produce a coherent enriched message.
    const wrapped = enrichErrorWithTransitionContext({
      err: 'connection refused',
      transition,
      activeSubtask: { phaseId: '02-deploy' },
    });
    expect(wrapped.message).toContain('connection refused');
    expect(wrapped.message).toContain("phase '02-deploy'");
  });

  it('names the cost class so the user knows the cost (level-2 vs level-3 vs level-2-3)', () => {
    const wrapped = enrichErrorWithTransitionContext({
      err: new Error('boom'),
      transition: { ...transition, costClass: 'level-2-3' },
      activeSubtask: { phaseId: '02-deploy' },
    });
    expect(wrapped.message).toContain('level-2-3');
  });
});
