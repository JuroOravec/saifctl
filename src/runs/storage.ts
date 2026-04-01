/**
 * Persisted run storage — wraps generic `StorageImpl<RunArtifact>` with run semantics
 * (revision merge, optimistic locking, filters).
 */

import { createStorage } from '../storage/index.js';
import type { StorageFilter, StorageImpl } from '../storage/types.js';
import {
  RunAlreadyRunningError,
  type RunArtifact,
  RunCannotPauseError,
  RunCannotStopError,
  type RunInspectSession,
  type RunSaveOptions,
  type RunStatus,
  StaleArtifactError,
} from './types.js';

const NAMESPACE = 'runs';

/**
 * Creates run storage from a URI or shorthand.
 *
 * @param uriOrShorthand - "local" | "none" | "file:///path" | "s3" | "s3://bucket/prefix"
 * @param projectDir - Used for default local path when uri is "local"
 * @returns `RunStorage` instance, or null for "none" (no persistence)
 */
export function createRunStorage(uriOrShorthand: string, projectDir: string): RunStorage | null {
  const storage = createStorage<RunArtifact>(uriOrShorthand, projectDir, NAMESPACE);
  if (!storage) return null;
  return new RunStorage(storage, uriOrShorthand);
}

function buildFilters(filter?: { taskId?: string; status?: RunStatus }): StorageFilter[] {
  const filters: StorageFilter[] = [];
  if (filter?.taskId != null) {
    filters.push({ type: 'match', field: 'taskId', value: filter.taskId });
  }
  if (filter?.status != null) {
    filters.push({ type: 'match', field: 'status', value: filter.status });
  }
  return filters;
}

/**
 * Persists run artifacts under a namespace, delegating to {@link StorageImpl<RunArtifact>}.
 */
export class RunStorage {
  constructor(
    private readonly storage: StorageImpl<RunArtifact>,
    readonly uri: string,
  ) {}

  /**
   * @returns The new {@link RunArtifact#artifactRevision} after the write.
   */
  /* eslint-disable-next-line max-params */
  async saveRun(runId: string, artifact: RunArtifact, options?: RunSaveOptions): Promise<number> {
    const existing = await this.storage.get(runId);
    const currentRev = existing?.artifactRevision ?? 0;
    if (options?.ifRevisionEquals !== undefined && currentRev !== options.ifRevisionEquals) {
      throw new StaleArtifactError({
        runId,
        expectedRevision: options.ifRevisionEquals,
        actualRevision: currentRev,
      });
    }

    const merged: RunArtifact = {
      ...artifact,
      runId,
      startedAt: existing?.startedAt ?? artifact.startedAt,
      taskId: artifact.taskId ?? existing?.taskId,
      artifactRevision: currentRev + 1,
      updatedAt: artifact.updatedAt,
      liveInfra: artifact.liveInfra,
      inspectSession: artifact.inspectSession ?? null,
    };

    await this.storage.save(runId, merged);
    return merged.artifactRevision!;
  }

  async setStatusRunning(runId: string, artifact: RunArtifact): Promise<number> {
    const existing = await this.storage.get(runId);
    if (existing?.status === 'running' || existing?.status === 'inspecting') {
      throw new RunAlreadyRunningError(runId);
    }
    const currentRev = existing?.artifactRevision ?? 0;
    const merged: RunArtifact = {
      ...artifact,
      runId,
      status: 'running',
      startedAt: existing?.startedAt ?? artifact.startedAt,
      taskId: artifact.taskId ?? existing?.taskId,
      artifactRevision: currentRev + 1,
      updatedAt: artifact.updatedAt,
      liveInfra: artifact.liveInfra,
      inspectSession: null,
    };
    await this.storage.save(runId, merged);
    return merged.artifactRevision!;
  }

  /**
   * Marks the run as {@link RunStatus} `"inspecting"` and records the idle coder container for tooling.
   *
   * @returns New {@link RunArtifact#artifactRevision} after the write.
   */
  async setStatusInspecting(runId: string, session: RunInspectSession): Promise<number> {
    const existing = await this.storage.get(runId);
    if (!existing) {
      throw new Error(`Run not found: ${runId}`);
    }
    if (existing.status === 'inspecting') {
      throw new Error(
        `Run "${runId}" is already in inspect mode. Finish or Ctrl+C the other inspect session first.`,
      );
    }
    const currentRev = existing.artifactRevision ?? 0;
    const merged: RunArtifact = {
      ...existing,
      status: 'inspecting',
      inspectSession: session,
      artifactRevision: currentRev + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.storage.save(runId, merged);
    return merged.artifactRevision!;
  }

  async getRun(runId: string): Promise<RunArtifact | null> {
    const r = await this.storage.get(runId);
    if (r && r.inspectSession === undefined) {
      return { ...r, inspectSession: null };
    }
    return r;
  }

  async listRuns(filter?: { taskId?: string; status?: RunStatus }): Promise<RunArtifact[]> {
    const filters = buildFilters(filter);
    return this.storage.list(filters.length > 0 ? filters : undefined);
  }

  /**
   * Sets {@link RunArtifact#controlSignal} to `pause` so a live orchestrator (polling storage) can pause
   * without tearing down the sandbox or Docker network/compose stack. Last-write-wins with {@link requestStop}.
   *
   * @throws {@link RunCannotPauseError} when the Run is not {@link RunStatus} `"running"`.
   */
  async requestPause(runId: string): Promise<void> {
    const existing = await this.storage.get(runId);
    if (!existing) {
      throw new Error(`Run not found: ${runId}`);
    }
    if (existing.status !== 'running') {
      throw new RunCannotPauseError(runId, existing.status);
    }
    const currentRev = existing.artifactRevision ?? 0;
    const t = new Date().toISOString();
    const next: RunArtifact = {
      ...existing,
      controlSignal: { action: 'pause', requestedAt: t },
      updatedAt: t,
      liveInfra: existing.liveInfra,
    };
    await this.saveRun(runId, next, { ifRevisionEquals: currentRev });
  }

  /**
   * Sets {@link RunArtifact#controlSignal} to `stop` so a live orchestrator tears down like a normal
   * failed exit, or (when already {@link RunStatus} `"paused"`) the caller runs synchronous cleanup.
   * Last-write-wins with {@link requestPause}.
   *
   * @throws {@link RunCannotStopError} when the Run is not `"running"` or `"paused"`.
   */
  async requestStop(runId: string): Promise<void> {
    const existing = await this.storage.get(runId);
    if (!existing) {
      throw new Error(`Run not found: ${runId}`);
    }
    if (existing.status !== 'running' && existing.status !== 'paused') {
      throw new RunCannotStopError(runId, existing.status);
    }
    const currentRev = existing.artifactRevision ?? 0;
    const t = new Date().toISOString();
    const next: RunArtifact = {
      ...existing,
      controlSignal: { action: 'stop', requestedAt: t },
      updatedAt: t,
    };
    await this.saveRun(runId, next, { ifRevisionEquals: currentRev });
  }

  async deleteRun(runId: string): Promise<void> {
    await this.storage.delete(runId);
  }

  async clearRuns(filter?: { taskId?: string; status?: RunStatus }): Promise<void> {
    const filters = buildFilters(filter);
    await this.storage.clear(filters.length > 0 ? filters : undefined);
  }
}
