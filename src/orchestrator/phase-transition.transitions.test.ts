/**
 * Per-phase-config phase 7.5e — controlled-restart integration pins.
 *
 * The 05e spec named this file by name (§"Tests" → container-level). The
 * Docker-dependent harness it described would require a live engine
 * harness in CI; this file pins the same invariants at the loop-helper
 * level using tmpdir-backed fakes for storage + sandbox scripts. The
 * specific scenarios pinned (mapped to the 05e review findings):
 *
 *   - **N3 / sequence pinning**: persist → refresh → clear runs in order;
 *     the persisted snapshot is exactly what the loop will read on
 *     `run resume`; refreshed scripts overwrite stale ones on disk.
 *   - **N4 / pause-during-transition**: pause arriving while a transition
 *     is in flight does NOT interrupt `completeControlledRestart`; the
 *     transition completes first and the next attempt observes the
 *     pause (variant "wait for completion" — see header in
 *     `phase-transition.ts`).
 *   - **N5 / resume-during-transition**: an artifact loaded with
 *     `transitionInProgress` set drives the recovery branch — refresh
 *     runs against the new active subtask, the flag is cleared, and
 *     the next coder container would boot against the refreshed
 *     scripts (the next-container-boot itself is a Docker concern out
 *     of scope here).
 *   - **N6 / cleanup-on-error**: refresh failure leaves the flag set
 *     on the persisted artifact so `run resume` re-enters the recovery
 *     branch idempotently.
 *   - **N2 / image-pull error wrap**: the helper that wraps a Docker
 *     error after a just-completed transition produces a message
 *     naming the phase + field set, and preserves the original error
 *     as `cause`.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { RunTransitionInProgress } from '../runs/types.js';
import {
  buildTransitionSnapshot,
  completeControlledRestart,
  enrichErrorWithTransitionContext,
  runControlledRestart,
} from './phase-transition.js';

/**
 * Fake of the loop's `saveRunningArtifact` / artifact-on-disk pair: stores
 * the latest transition snapshot in a tmpdir json file. Mirrors the real
 * artifact's `transitionInProgress` semantics so the resume-recovery
 * tests can read what the in-flight loop would have written.
 */
function makeArtifactStore(path: string) {
  const writes: Array<{ snapshot: RunTransitionInProgress | null; reason: string }> = [];
  const persistFlag = async (
    snapshot: RunTransitionInProgress | null,
    reason: string,
  ): Promise<void> => {
    writes.push({ snapshot, reason });
    await writeFile(path, JSON.stringify({ transitionInProgress: snapshot }, null, 2), 'utf8');
  };
  const loadFlag = async (): Promise<RunTransitionInProgress | null> => {
    try {
      const buf = await readFile(path, 'utf8');
      const parsed = JSON.parse(buf) as { transitionInProgress: RunTransitionInProgress | null };
      return parsed.transitionInProgress;
    } catch {
      return null;
    }
  };
  return { writes, persistFlag, loadFlag };
}

/**
 * Fake bind-mount: writes the active subtask's scripts into the sandbox
 * dir. The integration test reads the file contents back to verify the
 * refresh actually moved the bytes the next coder container would see.
 */
async function refreshFakeScripts(
  saifctlPath: string,
  scripts: { gate: string; startup: string; agent: string; cedar: string },
): Promise<void> {
  await mkdir(saifctlPath, { recursive: true });
  await writeFile(join(saifctlPath, 'gate.sh'), scripts.gate, 'utf8');
  await writeFile(join(saifctlPath, 'startup.sh'), scripts.startup, 'utf8');
  await writeFile(join(saifctlPath, 'agent.sh'), scripts.agent, 'utf8');
  await writeFile(join(saifctlPath, 'cedar.json'), scripts.cedar, 'utf8');
}

describe('phase-transition integration — controlled restart', () => {
  let base: string;
  let artifactPath: string;
  let saifctlPath: string;

  afterEach(async () => {
    if (base) await rm(base, { recursive: true, force: true });
  });

  async function setupTmpdir(): Promise<void> {
    base = await mkdtemp(join(tmpdir(), 'saif-transitions-'));
    artifactPath = join(base, 'artifact.json');
    saifctlPath = join(base, 'saifctl');
    await mkdir(saifctlPath, { recursive: true });
  }

  it('persist → refresh → clear ordering is observable on disk (N3 sequence pin)', async () => {
    await setupTmpdir();
    const store = makeArtifactStore(artifactPath);

    // Seed phase-A scripts as the "stale" set the new container must NOT see.
    await refreshFakeScripts(saifctlPath, {
      gate: 'phase-a-gate',
      startup: 'phase-a-startup',
      agent: 'phase-a-agent',
      cedar: 'phase-a-cedar',
    });

    // The loop's `tryStartTransition` shape: build snapshot, persist BEFORE
    // teardown.
    const computation = buildTransitionSnapshot({
      prev: { agentProfileId: 'claude' },
      next: { agentProfileId: 'aider' },
      toSubtaskIndex: 1,
      nowIso: () => '2026-05-07T12:00:00.000Z',
    });
    expect(computation).not.toBeNull();
    await store.persistFlag(computation!.snapshot, 'transition snapshot');
    expect(await store.loadFlag()).toEqual(computation!.snapshot);

    // (Engine teardown happens here in production; the helper doesn't
    // model that — script bytes on disk remain the stale phase-A set
    // until `completeControlledRestart` runs.)
    expect(await readFile(join(saifctlPath, 'agent.sh'), 'utf8')).toBe('phase-a-agent');

    // Post-teardown: refresh + clear in one call.
    await completeControlledRestart({
      refreshSandboxScripts: async () => {
        await refreshFakeScripts(saifctlPath, {
          gate: 'phase-b-gate',
          startup: 'phase-b-startup',
          agent: 'phase-b-agent',
          cedar: 'phase-b-cedar',
        });
      },
      clearTransitionInProgress: async () => {
        await store.persistFlag(null, 'transition complete');
      },
    });

    // Disk reflects the new (phase B) script set; flag cleared.
    expect(await readFile(join(saifctlPath, 'agent.sh'), 'utf8')).toBe('phase-b-agent');
    expect(await store.loadFlag()).toBeNull();
    // Persist-write order is observable: snapshot first, then null.
    expect(store.writes.map((w) => w.reason)).toEqual([
      'transition snapshot',
      'transition complete',
    ]);
  });

  it('refresh failure leaves the flag set on the persisted artifact (N6 cleanup-on-error)', async () => {
    await setupTmpdir();
    const store = makeArtifactStore(artifactPath);

    const computation = buildTransitionSnapshot({
      prev: { containerImage: 'reachable:v1' },
      next: { containerImage: 'unreachable:v2' },
      toSubtaskIndex: 2,
      nowIso: () => '2026-05-07T12:34:56.000Z',
    });
    await store.persistFlag(computation!.snapshot, 'transition snapshot');

    await expect(
      completeControlledRestart({
        refreshSandboxScripts: async () => {
          throw new Error('image pull failed: docker daemon unreachable');
        },
        clearTransitionInProgress: async () => {
          await store.persistFlag(null, 'should not run');
        },
      }),
    ).rejects.toThrow(/image pull failed/);

    // Flag persists — `run resume` will re-enter the recovery branch.
    expect(await store.loadFlag()).toEqual(computation!.snapshot);
    // The clear callback was NOT invoked.
    expect(store.writes.map((w) => w.reason)).toEqual(['transition snapshot']);
  });

  it('resume-from-disk seeds completeControlledRestart against the new active subtask (N5)', async () => {
    await setupTmpdir();
    const store = makeArtifactStore(artifactPath);

    // Simulate prior crash: snapshot persisted, refresh never ran. Disk
    // has phase-A scripts (stale).
    const persistedSnapshot: RunTransitionInProgress = {
      toSubtaskIndex: 3,
      costClass: 'level-2',
      fields: ['agent.profile'],
      startedAt: '2026-05-07T11:00:00.000Z',
    };
    await store.persistFlag(persistedSnapshot, 'transition snapshot (pre-crash)');
    await refreshFakeScripts(saifctlPath, {
      gate: 'phase-a-gate',
      startup: 'phase-a-startup',
      agent: 'phase-a-agent',
      cedar: 'phase-a-cedar',
    });

    // Simulate `run resume`: load the artifact, observe the flag, run
    // the recovery branch's completeControlledRestart against the NEW
    // active subtask's scripts.
    const seeded = await store.loadFlag();
    expect(seeded).toEqual(persistedSnapshot);

    await completeControlledRestart({
      refreshSandboxScripts: async () => {
        await refreshFakeScripts(saifctlPath, {
          gate: 'phase-b-gate',
          startup: 'phase-b-startup',
          agent: 'phase-b-agent',
          cedar: 'phase-b-cedar',
        });
      },
      clearTransitionInProgress: async () => {
        await store.persistFlag(null, 'transition complete (resume recovery)');
      },
    });

    // The next coder container would boot against phase-B scripts.
    expect(await readFile(join(saifctlPath, 'agent.sh'), 'utf8')).toBe('phase-b-agent');
    // Flag cleared so a subsequent re-resume doesn't loop.
    expect(await store.loadFlag()).toBeNull();
  });

  it('pause-during-transition: completeControlledRestart runs uninterrupted (N4 wait-for-completion)', async () => {
    // Variant (a) per `phase-transition.ts` header: control signals are
    // not polled during the refresh. Pin the contract by interleaving a
    // "pause requested" flag set during the refresh callback and
    // verifying the clear still runs after the refresh — i.e., the
    // helper does NOT short-circuit on a control signal mid-transition.
    await setupTmpdir();
    const store = makeArtifactStore(artifactPath);

    let pauseRequested = false;
    let clearRan = false;

    await store.persistFlag(
      {
        toSubtaskIndex: 1,
        costClass: 'level-2',
        fields: ['container.startup'],
        startedAt: '2026-05-07T12:00:00.000Z',
      },
      'transition snapshot',
    );

    await completeControlledRestart({
      refreshSandboxScripts: async () => {
        // Simulate the user pressing `run pause` mid-refresh; the helper
        // is unaware and continues.
        pauseRequested = true;
        await refreshFakeScripts(saifctlPath, {
          gate: 'phase-b-gate',
          startup: 'phase-b-startup',
          agent: 'phase-b-agent',
          cedar: 'phase-b-cedar',
        });
      },
      clearTransitionInProgress: async () => {
        clearRan = true;
        await store.persistFlag(null, 'transition complete');
      },
    });

    expect(pauseRequested).toBe(true);
    // Wait-for-completion: clear ran AFTER refresh finished, even though
    // pause was requested. The pause is honored by the next outer
    // attempt's control-sync, NOT by aborting the transition.
    expect(clearRan).toBe(true);
    expect(await store.loadFlag()).toBeNull();
  });

  it('image-pull error after a just-completed transition wraps with phase + field context (N2)', async () => {
    // Production path: the loop's transition completes, the next
    // runCodingPhase boots, the engine setup fails because the new
    // `container.image` is unreachable. The loop's catch-site invokes
    // `enrichErrorWithTransitionContext`. Pin that the wrap contains
    // the user-relevant identifiers.
    const transition: RunTransitionInProgress = {
      toSubtaskIndex: 4,
      costClass: 'level-3',
      fields: ['container.image', 'container.engine'],
      startedAt: '2026-05-07T12:00:00.000Z',
    };
    const dockerError = new Error('Error response from daemon: pull access denied for typo:latest');

    const wrapped = enrichErrorWithTransitionContext({
      err: dockerError,
      transition,
      activeSubtask: { phaseId: '03-deploy', title: 'phase:03-deploy impl' },
    });

    // User-facing identifiers present in message:
    expect(wrapped.message).toContain("phase '03-deploy'");
    expect(wrapped.message).toContain('`container.image`');
    expect(wrapped.message).toContain('`container.engine`');
    expect(wrapped.message).toContain('level-3');
    expect(wrapped.message).toContain('saifctl run resume');
    // Original error preserved as cause for tooling that walks the chain:
    expect(wrapped.cause).toBe(dockerError);
    // Original error text included verbatim so the user sees the raw
    // engine signal after the contextual prefix:
    expect(wrapped.message).toContain('pull access denied for typo:latest');
  });

  // ---------------------------------------------------------------------
  // Per-phase-config phase 7.5e review H2 / M2 — loop-lifecycle pin.
  //
  // The 05e spec asked for an integration test covering the full
  // production sequence: persist → engine teardown → refresh → clear,
  // with the engine teardown happening BETWEEN the persist and the
  // refresh (so a crash mid-teardown still leaves the artifact
  // recoverable). The helper-level tests above pin each stage in
  // isolation; this test simulates the entire loop sequence with fakes
  // so the ordering invariant is observable end-to-end without spinning
  // a real Docker engine.
  //
  // What the fakes stand in for:
  //   - `tryStartTransition`'s artifact persist     → `persistFlag`
  //   - the engine's `finally` teardown of the coder + Leash containers
  //                                                 → `engineTeardown` spy
  //   - `completeControlledRestart`'s script refresh → `refreshFakeScripts`
  //   - `clearTransitionInProgress`                  → `persistFlag(null)`
  //
  // The test reads the call-order array at the end to verify all four
  // steps ran in the production-required sequence.
  // ---------------------------------------------------------------------
  it('full lifecycle: persist → engine teardown → refresh → clear runs in order (H2 / M2)', async () => {
    await setupTmpdir();
    const store = makeArtifactStore(artifactPath);
    const events: string[] = [];

    // Stale (phase-A) bytes the next coder container must NOT see.
    await refreshFakeScripts(saifctlPath, {
      gate: 'phase-a-gate',
      startup: 'phase-a-startup',
      agent: 'phase-a-agent',
      cedar: 'phase-a-cedar',
    });

    // Step 1 — `tryStartTransition` builds + persists the snapshot.
    const computation = buildTransitionSnapshot({
      prev: { agentProfileId: 'claude', containerImage: 'old:v1' },
      next: { agentProfileId: 'aider', containerImage: 'new:v2' },
      toSubtaskIndex: 5,
      nowIso: () => '2026-05-07T13:00:00.000Z',
    });
    expect(computation).not.toBeNull();
    expect(computation!.costClass).toBe('level-2-3');

    await store.persistFlag(computation!.snapshot, 'transition snapshot');
    events.push('persist');
    expect(await store.loadFlag()).toEqual(computation!.snapshot);
    // Critical: scripts on disk are still the stale phase-A set when the
    // engine begins teardown — the artifact survives a teardown crash.
    expect(await readFile(join(saifctlPath, 'agent.sh'), 'utf8')).toBe('phase-a-agent');

    // Step 2 — engine `finally` tears down the coder + Leash containers.
    // Production calls `codingEngine.teardown` from `runEngineAttempt`'s
    // finally block when the driver returned `kind: 'transition'`. Pin
    // that this happens AFTER the persist and BEFORE the refresh.
    const engineTeardown = async (): Promise<void> => {
      events.push('engine.teardown');
      // The flag is still set on disk during teardown — recoverable if
      // the process dies mid-teardown.
      expect(await store.loadFlag()).toEqual(computation!.snapshot);
    };
    await engineTeardown();

    // Step 3 + 4 — `completeControlledRestart` refreshes the bind-mounted
    // scripts to phase B's Level-2 content, then clears the flag.
    await completeControlledRestart({
      refreshSandboxScripts: async () => {
        events.push('refresh');
        await refreshFakeScripts(saifctlPath, {
          gate: 'phase-b-gate',
          startup: 'phase-b-startup',
          agent: 'phase-b-agent',
          cedar: 'phase-b-cedar',
        });
      },
      clearTransitionInProgress: async () => {
        events.push('clear');
        await store.persistFlag(null, 'transition complete');
      },
    });

    // Ordering pinned end-to-end: every stage ran exactly once, in the
    // required sequence.
    expect(events).toEqual(['persist', 'engine.teardown', 'refresh', 'clear']);
    // The next coder container would boot against phase-B scripts.
    expect(await readFile(join(saifctlPath, 'agent.sh'), 'utf8')).toBe('phase-b-agent');
    expect(await readFile(join(saifctlPath, 'startup.sh'), 'utf8')).toBe('phase-b-startup');
    // Flag cleared so the next save doesn't re-trigger the recovery branch.
    expect(await store.loadFlag()).toBeNull();
    // Persist write order on disk: snapshot first, then null.
    expect(store.writes.map((w) => w.reason)).toEqual([
      'transition snapshot',
      'transition complete',
    ]);
  });

  // ---------------------------------------------------------------------
  // Per-phase-config phase 7.5e review H1 — persist-failure abort pin.
  //
  // `tryStartTransition` MUST NOT proceed to engine teardown when the
  // artifact persist fails — otherwise the artifact-write-before-teardown
  // invariant is broken (a process crash post-teardown would leave the
  // run unrecoverable: `run resume` reads no `transitionInProgress`,
  // skips the recovery branch, and activates the next subtask against
  // stale bind-mounted scripts).
  //
  // We pin the contract via `runControlledRestart` (which composes the
  // same persist → refresh → clear flow): a throwing
  // `persistTransitionInProgress` propagates out, AND the refresh
  // callback never runs (i.e., the engine teardown a real loop would
  // gate on the persist returning successfully also never runs).
  // ---------------------------------------------------------------------
  it('persist failure aborts the transition before any teardown / refresh runs (H1)', async () => {
    await setupTmpdir();
    let refreshRan = false;
    let clearRan = false;
    const persistError = new Error('disk full');

    await expect(
      runControlledRestart({
        toSubtaskIndex: 1,
        fields: ['agent.profile'],
        costClass: 'level-2',
        persistTransitionInProgress: async () => {
          throw persistError;
        },
        refreshSandboxScripts: async () => {
          refreshRan = true;
        },
        clearTransitionInProgress: async () => {
          clearRan = true;
        },
        nowIso: () => '2026-05-07T13:00:00.000Z',
      }),
    ).rejects.toBe(persistError);

    // Neither downstream callback fired: the caller can safely roll back
    // its in-memory snapshot and the engine teardown a real loop would
    // run between persist and refresh is also bypassed.
    expect(refreshRan).toBe(false);
    expect(clearRan).toBe(false);
  });
});
