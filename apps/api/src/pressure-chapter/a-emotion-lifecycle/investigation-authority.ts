import {
  isSha256,
  validateDecisionActionV1,
} from "@ai-story/shared";
import { uniqueCodes, validatePressureLifecycleAuthorityV1 } from "./authority";
import type {
  PressureAEmotionLifecycleAuthorityV1,
  PressureAEmotionCommittedSourceKindV1,
  PressureDisclosureUpgradeBindingV1,
} from "./contracts";
import { validatePressureDisclosureUpgradeBindingV1 } from "./disclosure-lifecycle.service";
import {
  A_EMOTION_LIFECYCLE_ERROR_CODES_V1 as ERROR,
  failAEmotionLifecycle,
} from "./errors";

export interface DeriveCommittedPressureInvestigationAuthorityInputV1 {
  sourceKind: PressureAEmotionCommittedSourceKindV1;
  sourceId: string;
  sourceCommitHash: string;
  committedAt: string;
  action: unknown;
  committedEvidenceRefs: string[];
  binding: PressureDisclosureUpgradeBindingV1;
}

/**
 * Re-derives lifecycle authority only from a committed, hash-sealed action and
 * its already access-checked Working Ledger evidence refs. Effect/fact codes
 * come from the frozen binding, never from client payload or prose.
 */
export function deriveCommittedPressureInvestigationAuthorityV1(
  input: DeriveCommittedPressureInvestigationAuthorityInputV1,
): { authority: PressureAEmotionLifecycleAuthorityV1; responseToEventId: string } {
  const action = validateDecisionActionV1(input.action);
  const binding = validatePressureDisclosureUpgradeBindingV1(input.binding);
  if (action.seatId !== "qingliu_law") {
    failAEmotionLifecycle(ERROR.CONTEXT_MISMATCH, "action.seatId", "INVESTIGATOR_REQUIRED");
  }
  const payload = action.payload as Record<string, unknown>;
  const keys = ["interactionKind", "investigationCode", "responseToEventId", "sharedObjectId"];
  if (Object.keys(payload).length !== keys.length || keys.some((key) => !(key in payload))) {
    failAEmotionLifecycle(ERROR.INVALID_AUTHORITY, "action.payload", "EXACT_INVESTIGATION_FIELDS");
  }
  if (
    payload.interactionKind !== "A_EMOTION_INVESTIGATION"
    || payload.investigationCode !== binding.actionCode
    || payload.sharedObjectId !== "original-grain-ledger"
    || typeof payload.responseToEventId !== "string"
    || !/\S/u.test(payload.responseToEventId)
  ) failAEmotionLifecycle(ERROR.INVALID_AUTHORITY, "action.payload", "INVESTIGATION_BINDING_MISMATCH");
  if (!isSha256(input.sourceCommitHash) || typeof input.sourceId !== "string" || !/\S/u.test(input.sourceId)) {
    failAEmotionLifecycle(ERROR.INVALID_AUTHORITY, "source");
  }
  const authority = validatePressureLifecycleAuthorityV1({
    schemaVersion: "pressure_a_emotion_lifecycle_authority_v1",
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    sourceCommitHash: input.sourceCommitHash,
    runId: action.runId,
    stageId: action.chapterId,
    sourceActionId: action.actionId,
    sourceSeatId: action.seatId,
    actionCodes: [binding.actionCode],
    effectCodes: [binding.effectCode],
    factCodes: [binding.factCode],
    evidenceRefs: uniqueCodes(input.committedEvidenceRefs),
    committedAt: input.committedAt,
  });
  return { authority, responseToEventId: payload.responseToEventId };
}
