import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  validateAEmotionInteractionEventV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  derivePressureDisclosureUpgradeV1,
  derivePressurePromiseBrokenSignalV1,
  type PressureAEmotionLifecycleAuthorityV1,
  type PressureCommittedCommitmentMutationV1,
  type PressureDisclosureUpgradeBindingV1,
  type PressurePromiseAEmotionBindingV1,
} from "../a-emotion-lifecycle";
import {
  sealAEmotionAuthorityOutboxJobV1,
  sealAEmotionCommittedAuthoritySourceV1,
} from "./compiler";
import type { AEmotionAuthorityEmissionV1 } from "./content-source";
import type { AEmotionAuthoritySignalV1 } from "./contracts";
import {
  A_EMOTION_PRODUCTION_ERROR_CODES as ERROR,
  failAEmotionProduction,
} from "./errors";
import { derivePromiseBrokenPresentationV1 } from "./trigger-derivation";

export interface CompilePressureAEmotionLifecycleUpgradeInputV1 {
  roomId: string;
  currentEvent: unknown;
  authority: PressureAEmotionLifecycleAuthorityV1;
  disclosureBinding: PressureDisclosureUpgradeBindingV1;
  promiseMutation?: PressureCommittedCommitmentMutationV1 | null;
  promiseBinding?: PressurePromiseAEmotionBindingV1 | null;
  eventSequence: number;
  stateVersion: number;
  storyDay: number;
  audienceSeatIds: SeatIdV1[];
}

/**
 * Production bridge for HIDDEN -> SUSPECTED -> CONFIRMED. It consumes only
 * committed authority and frozen bindings. When confirmation proves an
 * already-BROKEN Promise, the same CONFIRMED upgrade owns the one modal.
 */
export function compilePressureAEmotionLifecycleUpgradeV1(
  input: CompilePressureAEmotionLifecycleUpgradeInputV1,
): AEmotionAuthorityEmissionV1[] {
  const current = validateAEmotionInteractionEventV1(input.currentEvent);
  const authority = input.authority;
  if (
    current.runId !== authority.runId
    || current.stageId !== authority.stageId
    || current.sharedObjectId !== "original-grain-ledger"
    || input.roomId !== current.roomId
    || !Number.isSafeInteger(input.eventSequence) || input.eventSequence <= current.eventSequence
    || !Number.isSafeInteger(input.stateVersion) || input.stateVersion < 1
    || !Number.isSafeInteger(input.storyDay) || input.storyDay < 1
    || input.audienceSeatIds.length !== 1
    || input.audienceSeatIds[0] !== "zhejiang_governor"
  ) failAEmotionProduction(ERROR.AUTHORITY_BINDING_MISMATCH, "lifecycleUpgrade.context");
  const derived = derivePressureDisclosureUpgradeV1({
    current: {
      eventId: current.eventId,
      runId: current.runId,
      stageId: current.stageId,
      disclosure: current.disclosure,
    },
    authority,
    binding: input.disclosureBinding,
  });
  if (derived.status === "SKIPPED") return [];
  let presentation: AEmotionAuthoritySignalV1["presentation"] = {
    recommendedPresentation: "CENTER_CARD" as const,
    centerCardType: "CROSS_IMPACT" as const,
    responseOptions: derived.patch.disclosure === "SUSPECTED" ? [{
      code: "CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE",
      preferredEntry: "INVESTIGATE" as const,
      consumesManeuverOnSubmit: false as const,
    }] : [],
    modalTrigger: null,
  };
  let eventCode = derived.patch.disclosure === "SUSPECTED"
    ? "LEDGER_SOURCE_SUSPECTED"
    : "LEDGER_SOURCE_CONFIRMED";
  let promiseId: string | null = null;
  let brokenByActionId: string | null = null;
  if (
    derived.patch.disclosure === "CONFIRMED"
    && input.promiseMutation
    && input.promiseBinding
  ) {
    const promise = derivePressurePromiseBrokenSignalV1({
      mutation: input.promiseMutation,
      authority,
      binding: input.promiseBinding,
      priorEventId: current.eventId,
      stateVersion: input.stateVersion,
    });
    if (promise.status === "DERIVED") {
      eventCode = promise.patch.eventCode;
      promiseId = promise.patch.promiseId;
      brokenByActionId = promise.patch.brokenByActionId;
      presentation = derivePromiseBrokenPresentationV1({
        signal: {
          signalId: "promise-presentation-derivation",
          kind: "REVEAL",
          eventCode,
          eventFamily: current.eventFamily,
          severity: "CRITICAL",
          sharedObjectId: current.sharedObjectId,
          factRefs: [], publicFactRefs: [], impacts: [],
          audienceSpec: { type: "EXPLICIT", seatIds: canonicalSeats(input.audienceSeatIds) },
          disclosure: derived.patch.disclosure,
          suspectedSeatIds: [], suspicionBasisRefs: [],
          evidenceRefs: [...derived.patch.evidenceRefs],
          revealOfEventId: current.eventId,
          promiseId, milestoneId: null, metricTransitionId: null,
          presentation: promise.patch.presentation,
        },
        stateVersion: input.stateVersion,
        transition: {
          promiseId,
          beforeDisclosure: current.disclosure as "HIDDEN" | "SUSPECTED",
          afterDisclosure: derived.patch.disclosure,
          authorizedEvidence: derived.patch.evidenceRefs.length > 0,
        },
      }).presentation;
    }
  }
  const signalId = [
    "lifecycle", authority.sourceCommitHash, current.eventId, derived.patch.disclosure,
    promiseId ?? "no-promise",
  ].join(":");
  const job = sealAEmotionAuthorityOutboxJobV1({
    schemaVersion: "a_emotion_authority_outbox_job_v1",
    sourceKind: authority.sourceKind,
    runId: authority.runId,
    sourceId: authority.sourceId,
    sourceCommitHash: authority.sourceCommitHash,
    signalId,
  });
  const source = sealAEmotionCommittedAuthoritySourceV1({
    schemaVersion: "a_emotion_committed_authority_source_v1",
    sourceKind: authority.sourceKind,
    sourceId: authority.sourceId,
    sourceCommitHash: authority.sourceCommitHash,
    roomId: input.roomId,
    runId: authority.runId,
    stageId: authority.stageId,
    sourceActionId: authority.sourceActionId,
    sourceSeatId: authority.sourceSeatId,
    committedAt: authority.committedAt,
    eventSequence: input.eventSequence,
    stateVersion: input.stateVersion,
    storyDay: input.storyDay,
    signal: {
      signalId,
      kind: "REVEAL",
      eventCode,
      eventFamily: current.eventFamily,
      severity: promiseId ? "CRITICAL" : "MAJOR",
      sharedObjectId: current.sharedObjectId,
      factRefs: [...authority.factCodes].sort(),
      publicFactRefs: [],
      impacts: brokenByActionId === null ? [] : [{
        targetSeatId: input.promiseBinding!.receiverSeatId,
        visibility: "TARGET_ONLY",
        type: "SHARED_OBJECT",
        key: "brokenByActionId",
        before: null,
        after: brokenByActionId,
        delta: null,
        effectCode: "SANGTIAN_PROMISE_BREAK_CONFIRMED",
      }],
      audienceSpec: { type: "EXPLICIT", seatIds: canonicalSeats(input.audienceSeatIds) },
      disclosure: derived.patch.disclosure,
      suspectedSeatIds: [...derived.patch.suspectedSeatIds],
      suspicionBasisRefs: [...derived.patch.suspicionBasisRefs],
      evidenceRefs: [...derived.patch.evidenceRefs],
      revealOfEventId: current.eventId,
      promiseId,
      milestoneId: null,
      metricTransitionId: null,
      presentation,
    },
  }, job);
  return Object.freeze([Object.freeze({
    dedupeKey: `aemotion:${job.jobHash}`,
    job,
    source,
  })]) as unknown as AEmotionAuthorityEmissionV1[];
}

function canonicalSeats(values: readonly SeatIdV1[]): SeatIdV1[] {
  const set = new Set(values);
  return PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) => set.has(seatId));
}

export function pressureAEmotionLifecycleUpgradeFingerprintV1(
  input: CompilePressureAEmotionLifecycleUpgradeInputV1,
): string {
  return sha256Canonical(input);
}
