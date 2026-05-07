/**
 * Helpers for {@link RunSubtask} — ids, inputs → runtime rows, and artifact normalization.
 */

import { randomBytes } from 'node:crypto';

import type { RunSubtask, RunSubtaskInput } from '../types.js';

/** Short stable id: 6 lowercase hex characters (3 random bytes). */
function newRunSubtaskId(): string {
  return randomBytes(3).toString('hex');
}

/**
 * Turns persisted / manifest inputs into runtime {@link RunSubtask} rows (assigns id, status, timestamps).
 */
export function runSubtasksFromInputs(
  inputs: readonly RunSubtaskInput[],
  nowIso = (): string => new Date().toISOString(),
): RunSubtask[] {
  const t = nowIso();
  return inputs.map((input) => ({
    id: newRunSubtaskId(),
    title: input.title,
    content: input.content,
    status: 'pending' as const,
    createdAt: t,
    gateScript: input.gateScript,
    agentScript: input.agentScript,
    gateRetries: input.gateRetries,
    reviewerEnabled: input.reviewerEnabled,
    agentEnv: input.agentEnv,
    // per-phase-config v1 (phase 7.4 — Level-1.5)
    agentSecretKeys: input.agentSecretKeys,
    llmOverrides: input.llmOverrides,
    testScope: input.testScope,
    phaseId: input.phaseId,
    criticPrompt: input.criticPrompt,
    // per-phase-config v1 (phase 7.3 — Level-4)
    testProfile: input.testProfile,
    testImage: input.testImage,
    testScript: input.testScript,
    stageScript: input.stageScript,
    resolveAmbiguity: input.resolveAmbiguity,
    testRetries: input.testRetries,
    noRunner: input.noRunner,
    // per-phase-config v1 (phase 7.5 — Level-2 controlled coder restart)
    agentProfileId: input.agentProfileId,
    agentInstallScript: input.agentInstallScript,
    startupScript: input.startupScript,
    cedarScript: input.cedarScript,
    dangerousNoLeash: input.dangerousNoLeash,
    requiresLevel2RestartFromPrev: input.requiresLevel2RestartFromPrev,
    // per-phase-config v1 (phase 7.5b — Level-3 manifest threading)
    containerImage: input.containerImage,
    containerSandboxProfileId: input.containerSandboxProfileId,
    containerEngine: input.containerEngine,
    containerComposeFile: input.containerComposeFile,
    requiresLevel3RestartFromPrev: input.requiresLevel3RestartFromPrev,
    // per-phase-config v1 (phase 7.6 — per-phase max-attempts)
    limits: input.limits,
  }));
}

/** Strips runtime-only fields for persisting subtask shape inside {@link SerializedLoopOpts#subtasks}. */
export function runSubtasksToInputs(subtasks: readonly RunSubtask[]): RunSubtaskInput[] {
  return subtasks.map((s) => ({
    title: s.title,
    content: s.content,
    gateScript: s.gateScript,
    agentScript: s.agentScript,
    gateRetries: s.gateRetries,
    reviewerEnabled: s.reviewerEnabled,
    agentEnv: s.agentEnv,
    // per-phase-config v1 (phase 7.4 — Level-1.5)
    agentSecretKeys: s.agentSecretKeys,
    llmOverrides: s.llmOverrides,
    testScope: s.testScope,
    phaseId: s.phaseId,
    criticPrompt: s.criticPrompt,
    // per-phase-config v1 (phase 7.3 — Level-4)
    testProfile: s.testProfile,
    testImage: s.testImage,
    testScript: s.testScript,
    stageScript: s.stageScript,
    resolveAmbiguity: s.resolveAmbiguity,
    testRetries: s.testRetries,
    noRunner: s.noRunner,
    // per-phase-config v1 (phase 7.5 — Level-2 controlled coder restart)
    agentProfileId: s.agentProfileId,
    agentInstallScript: s.agentInstallScript,
    startupScript: s.startupScript,
    cedarScript: s.cedarScript,
    dangerousNoLeash: s.dangerousNoLeash,
    requiresLevel2RestartFromPrev: s.requiresLevel2RestartFromPrev,
    // per-phase-config v1 (phase 7.5b — Level-3 manifest threading)
    containerImage: s.containerImage,
    containerSandboxProfileId: s.containerSandboxProfileId,
    containerEngine: s.containerEngine,
    containerComposeFile: s.containerComposeFile,
    requiresLevel3RestartFromPrev: s.requiresLevel3RestartFromPrev,
    // per-phase-config v1 (phase 7.6 — per-phase max-attempts)
    limits: s.limits,
  }));
}
