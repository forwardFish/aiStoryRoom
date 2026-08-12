import { isSha256, sha256Canonical } from "@ai-story/shared";
import { isPressureSeatId, uniqueCodes, validatePressureLifecycleAuthorityV1 } from "./authority";
import type {
  PressureAEmotionDerivationResultV1,
  PressureCommittedCommitmentMutationV1,
  PressurePromiseAEmotionBindingV1,
  PressurePromiseBrokenSignalPatchV1,
} from "./contracts";
import {
  A_EMOTION_LIFECYCLE_ERROR_CODES_V1 as ERROR,
  failAEmotionLifecycle,
} from "./errors";

const PROMISE_CODES = new Set([
  "DELIVER_ORIGINAL_LEDGER",
  "DO_NOT_PUBLICLY_BLAME",
  "TESTIFY_FOR_TARGET",
]);

/**
 * Projects PROMISE_BROKEN from the existing committed Working Ledger mutation.
 * The mutation remains the only status/lifecycle authority.
 */
export function derivePressurePromiseBrokenSignalV1(input: {
  mutation: unknown;
  authority: unknown;
  binding: unknown;
  priorEventId: string;
  stateVersion: number;
}): PressureAEmotionDerivationResultV1<PressurePromiseBrokenSignalPatchV1> {
  const mutation = validateMutation(input.mutation);
  const authority = validatePressureLifecycleAuthorityV1(input.authority);
  const binding = validatePromiseBinding(input.binding);
  if (mutation.commitmentId !== binding.commitmentId) return { status: "SKIPPED", reason: "NOT_BOUND" };
  if (mutation.operation !== "BREAK") return { status: "SKIPPED", reason: "NOT_BROKEN" };
  if (
    !mutation.seatIds.includes(binding.issuerSeatId)
    || !mutation.seatIds.includes(binding.receiverSeatId)
  ) failAEmotionLifecycle(ERROR.CONTEXT_MISMATCH, "promise.mutation");
  const matchedFacts = authority.factCodes.filter((code) => binding.revealEvidenceFactCodes.includes(code));
  if (matchedFacts.length === 0 || authority.evidenceRefs.length === 0) {
    return { status: "SKIPPED", reason: "EVIDENCE_NOT_AUTHORIZED" };
  }
  if (typeof input.priorEventId !== "string" || !/\S/u.test(input.priorEventId) || !Number.isSafeInteger(input.stateVersion) || input.stateVersion < 1) {
    failAEmotionLifecycle(ERROR.INVALID_STATE, "promise.signalContext");
  }
  const evidenceRefs = uniqueCodes(authority.evidenceRefs);
  const patch: PressurePromiseBrokenSignalPatchV1 = {
    kind: "REVEAL",
    eventCode: "PROMISE_DELIVER_LEDGER_BROKEN",
    eventFamily: "LEDGER_FLOW",
    severity: "CRITICAL",
    sharedObjectId: binding.sharedObjectId,
    factRefs: uniqueCodes(matchedFacts),
    publicFactRefs: [],
    audienceSpec: { type: "EXPLICIT", seatIds: [binding.receiverSeatId] },
    disclosure: "CONFIRMED",
    suspectedSeatIds: [],
    suspicionBasisRefs: [],
    evidenceRefs,
    revealOfEventId: input.priorEventId,
    promiseId: mutation.commitmentId,
    brokenByActionId: mutation.sourceActionId,
    milestoneId: null,
    metricTransitionId: null,
    presentation: {
      recommendedPresentation: "KEY_MODAL",
      centerCardType: "PROMISE_BROKEN",
      responseOptions: [
        { code: "RESPOND_TO_PROMISE_BREAK", preferredEntry: "TALK", consumesManeuverOnSubmit: false },
        { code: "PRESERVE_PROMISE_EVIDENCE", preferredEntry: "PLAN", consumesManeuverOnSubmit: false },
        { code: "DEFER_PROMISE_RESPONSE", preferredEntry: "DEFER", consumesManeuverOnSubmit: false },
      ],
      modalTrigger: {
        type: "PROMISE_BROKEN",
        triggerId: mutation.commitmentId,
        stateVersion: input.stateVersion,
      },
    },
  };
  return {
    status: "DERIVED",
    patch,
    derivationHash: sha256Canonical({
      schemaVersion: "pressure_promise_broken_signal_derivation_v1",
      sourceCommitHash: authority.sourceCommitHash,
      bindingHash: binding.bindingHash,
      mutation,
      priorEventId: input.priorEventId,
      stateVersion: input.stateVersion,
      patch,
    }),
  };
}

export function sealPressurePromiseAEmotionBindingV1(
  input: Omit<PressurePromiseAEmotionBindingV1, "schemaVersion" | "bindingHash">,
): PressurePromiseAEmotionBindingV1 {
  const withoutHash = {
    schemaVersion: "pressure_promise_a_emotion_binding_v1" as const,
    ...input,
    revealEvidenceFactCodes: [...input.revealEvidenceFactCodes],
  };
  return validatePromiseBinding({ ...withoutHash, bindingHash: sha256Canonical(withoutHash) });
}

function validateMutation(value: unknown): PressureCommittedCommitmentMutationV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) failAEmotionLifecycle(ERROR.INVALID_STATE, "mutation");
  const mutation = value as PressureCommittedCommitmentMutationV1;
  if (
    typeof mutation.commitmentId !== "string"
    || !/\S/u.test(mutation.commitmentId)
    || !["CREATE", "FULFILL", "BREAK", "CANCEL"].includes(mutation.operation)
    || typeof mutation.sourceActionId !== "string"
    || !/\S/u.test(mutation.sourceActionId)
    || !Array.isArray(mutation.seatIds)
    || mutation.seatIds.some((seatId) => !isPressureSeatId(seatId))
  ) failAEmotionLifecycle(ERROR.INVALID_STATE, "mutation");
  return structuredClone(mutation);
}

function validatePromiseBinding(value: unknown): PressurePromiseAEmotionBindingV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) failAEmotionLifecycle(ERROR.INVALID_POLICY, "binding");
  const binding = value as PressurePromiseAEmotionBindingV1;
  if (
    binding.schemaVersion !== "pressure_promise_a_emotion_binding_v1"
    || typeof binding.bindingId !== "string"
    || !/\S/u.test(binding.bindingId)
    || !PROMISE_CODES.has(binding.promiseCode)
    || typeof binding.commitmentId !== "string"
    || !/\S/u.test(binding.commitmentId)
    || binding.sharedObjectId !== "original-grain-ledger"
    || !isPressureSeatId(binding.issuerSeatId)
    || !isPressureSeatId(binding.receiverSeatId)
    || binding.issuerSeatId === binding.receiverSeatId
    || !Array.isArray(binding.revealEvidenceFactCodes)
    || binding.revealEvidenceFactCodes.length === 0
  ) failAEmotionLifecycle(ERROR.INVALID_POLICY, "binding");
  const { bindingHash, ...withoutHash } = binding;
  if (!isSha256(bindingHash) || sha256Canonical(withoutHash) !== bindingHash) failAEmotionLifecycle(ERROR.INVALID_POLICY, "binding.bindingHash");
  return structuredClone(binding);
}
