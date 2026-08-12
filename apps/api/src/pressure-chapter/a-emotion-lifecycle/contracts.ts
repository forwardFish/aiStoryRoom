import type { SeatIdV1 } from "@ai-story/shared";
import type { AEmotionAuthoritySignalV1 } from "../a-emotion-production/contracts";

export const PRESSURE_A_EMOTION_LIFECYCLE_AUTHORITY_SCHEMA_V1 =
  "pressure_a_emotion_lifecycle_authority_v1" as const;

export type PressureAEmotionCommittedSourceKindV1 =
  | "BEAT_COMMITTED"
  | "FORMAL_COMMITMENT_COMMITTED"
  | "CHAPTER_SETTLEMENT_COMMITTED"
  | "FINALE_COMMITTED";

/**
 * Narrow post-commit evidence. This value is read-only input, never a second
 * commitment, disclosure, or world-state authority.
 */
export interface PressureAEmotionLifecycleAuthorityV1 {
  schemaVersion: typeof PRESSURE_A_EMOTION_LIFECYCLE_AUTHORITY_SCHEMA_V1;
  sourceKind: PressureAEmotionCommittedSourceKindV1;
  sourceId: string;
  sourceCommitHash: string;
  runId: string;
  stageId: string;
  sourceActionId: string;
  sourceSeatId: SeatIdV1;
  actionCodes: string[];
  effectCodes: string[];
  factCodes: string[];
  evidenceRefs: string[];
  committedAt: string;
}

/** The existing Working Ledger mutation is the sole promise lifecycle authority. */
export interface PressureCommittedCommitmentMutationV1 {
  commitmentId: string;
  operation: "CREATE" | "FULFILL" | "BREAK" | "CANCEL";
  seatIds: SeatIdV1[];
  sourceActionId: string;
}

/**
 * Frozen content binding. It identifies which existing commitment IDs are
 * formal, preset promises; it does not own or advance their state.
 */
export interface PressurePromiseAEmotionBindingV1 {
  schemaVersion: "pressure_promise_a_emotion_binding_v1";
  bindingId: string;
  promiseCode:
    | "DELIVER_ORIGINAL_LEDGER"
    | "DO_NOT_PUBLICLY_BLAME"
    | "TESTIFY_FOR_TARGET";
  commitmentId: string;
  sharedObjectId: "original-grain-ledger";
  issuerSeatId: SeatIdV1;
  receiverSeatId: SeatIdV1;
  revealEvidenceFactCodes: string[];
  bindingHash: string;
}

export interface PressurePromiseBrokenSignalPatchV1 {
  kind: "REVEAL";
  eventCode: "PROMISE_DELIVER_LEDGER_BROKEN";
  eventFamily: "LEDGER_FLOW";
  severity: "CRITICAL";
  sharedObjectId: "original-grain-ledger";
  factRefs: string[];
  publicFactRefs: string[];
  audienceSpec: { type: "EXPLICIT"; seatIds: SeatIdV1[] };
  disclosure: "CONFIRMED";
  suspectedSeatIds: [];
  suspicionBasisRefs: [];
  evidenceRefs: string[];
  revealOfEventId: string;
  promiseId: string;
  brokenByActionId: string;
  milestoneId: null;
  metricTransitionId: null;
  presentation: {
    recommendedPresentation: "KEY_MODAL";
    centerCardType: "PROMISE_BROKEN";
    responseOptions: Array<{
      code: string;
      preferredEntry: "TALK" | "PLAN" | "DEFER";
      consumesManeuverOnSubmit: false;
    }>;
    modalTrigger: {
      type: "PROMISE_BROKEN";
      triggerId: string;
      stateVersion: number;
    };
  };
}

export interface PressureDisclosureUpgradeBindingV1 {
  schemaVersion: "pressure_disclosure_upgrade_binding_v1";
  bindingId: string;
  fromDisclosure: "HIDDEN" | "SUSPECTED";
  toDisclosure: "SUSPECTED" | "CONFIRMED";
  actionCode: string;
  effectCode: string;
  factCode: string;
  suspectedSeatIds: SeatIdV1[];
  bindingHash: string;
}

export type PressureDisclosureSignalPatchV1 = Pick<
  AEmotionAuthoritySignalV1,
  | "kind"
  | "disclosure"
  | "suspectedSeatIds"
  | "suspicionBasisRefs"
  | "evidenceRefs"
  | "revealOfEventId"
>;

export type PressureAEmotionDerivationResultV1<T> =
  | { status: "SKIPPED"; reason: "NOT_BOUND" | "NOT_BROKEN" | "BASIS_NOT_MATCHED" | "EVIDENCE_NOT_AUTHORIZED" }
  | { status: "DERIVED"; patch: T; derivationHash: string };
