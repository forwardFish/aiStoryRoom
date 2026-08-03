import {
  OPENOVEL_ROLE_RUNTIME_MODE,
  ROLE_IMPACT_SYNC_SCHEMA_VERSION,
  ROLE_NARRATIVE_INPUT_SCHEMA_VERSION,
  type RoleImpactSyncV1,
  type RoleNarrativeInputV1,
  type RoleVisibleEventV1,
  type RoleVisibleInteractionV1
} from "@ai-story/shared";
import type { StoryContextSnapshotV2 } from "../continuous-story-v2/story-context";
import { ModelCallBudget } from "./model-call-budget";

export type RoleProjectionExtras = {
  turnKind: "OPENING" | "RESULT";
  turnIndex: number;
  budgetKind?: "NORMAL" | "AI_TARGET" | "CONVERGENCE" | "UNAFFECTED";
  baseWorldSequence?: number;
  appliedWorldSequence: number | null;
  readerAction?: string;
  confirmedResolution?: string;
  visibleWorldEvents?: RoleVisibleEventV1[];
  pendingInteractions?: RoleVisibleInteractionV1[];
  previousCanonHash?: string;
  idempotencyKey: string;
};

/** Builds the complete and intentionally narrow payload crossing the API/runtime boundary. */
export function projectRoleNarrativeInput(snapshot: StoryContextSnapshotV2, extras: RoleProjectionExtras): RoleNarrativeInputV1 {
  if (snapshot.contextReport.status !== "READY" || snapshot.contextReport.roleId !== snapshot.identity.roleId) {
    throw new Error("ROLE_CONTEXT_NOT_READY");
  }
  return {
    schemaVersion: ROLE_NARRATIVE_INPUT_SCHEMA_VERSION,
    runtimeMode: OPENOVEL_ROLE_RUNTIME_MODE,
    turnKind: extras.turnKind,
    roomId: snapshot.identity.runId,
    roleId: snapshot.identity.roleId,
    actorTurnId: snapshot.identity.actorTurnId,
    turnIndex: extras.turnIndex,
    baseWorldSequence: extras.baseWorldSequence ?? snapshot.identity.worldSequence,
    appliedWorldSequence: extras.appliedWorldSequence,
    contextSnapshotHash: snapshot.identity.snapshotHash,
    renderedWorkingSet: snapshot.renderedWorkingSet,
    ...(extras.readerAction ? { readerAction: extras.readerAction } : {}),
    ...(extras.confirmedResolution ? { confirmedResolution: extras.confirmedResolution } : {}),
    visibleWorldEvents: extras.visibleWorldEvents || [],
    pendingInteractions: extras.pendingInteractions || [],
    ...(extras.previousCanonHash ? { previousCanonHash: extras.previousCanonHash } : {}),
    modelCallBudget: new ModelCallBudget(extras.budgetKind || "NORMAL").snapshot(),
    idempotencyKey: extras.idempotencyKey
  };
}

export function projectRoleImpactSync(input: RoleNarrativeInputV1): RoleImpactSyncV1 {
  if (input.appliedWorldSequence === null) throw new Error("ROLE_IMPACT_APPLIED_SEQUENCE_REQUIRED");
  return {
    schemaVersion: ROLE_IMPACT_SYNC_SCHEMA_VERSION,
    runtimeMode: input.runtimeMode,
    roomId: input.roomId,
    roleId: input.roleId,
    actorTurnId: input.actorTurnId,
    baseWorldSequence: input.baseWorldSequence,
    appliedWorldSequence: input.appliedWorldSequence,
    contextSnapshotHash: input.contextSnapshotHash,
    renderedWorkingSet: input.renderedWorkingSet,
    visibleWorldEvents: input.visibleWorldEvents,
    pendingInteractions: input.pendingInteractions,
    ...(input.previousCanonHash ? { previousCanonHash: input.previousCanonHash } : {}),
    idempotencyKey: input.idempotencyKey
  };
}
