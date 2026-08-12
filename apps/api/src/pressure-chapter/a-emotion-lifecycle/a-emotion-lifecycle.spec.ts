import assert from "node:assert/strict";
import test from "node:test";
import {
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  type CanonicalJsonObject,
  type SeatIdV1,
} from "@ai-story/shared";
import type { AEmotionAuthoritySignalV1 } from "../a-emotion-production/contracts";
import {
  PRESSURE_A_EMOTION_LIFECYCLE_AUTHORITY_SCHEMA_V1,
  type PressureAEmotionLifecycleAuthorityV1,
  type PressureCommittedCommitmentMutationV1,
} from "./contracts";
import {
  derivePressureDisclosureUpgradeV1,
  sealPressureDisclosureUpgradeBindingV1,
} from "./disclosure-lifecycle.service";
import {
  derivePressurePromiseBrokenSignalV1,
  sealPressurePromiseAEmotionBindingV1,
} from "./promise-signal.adapter";
import {
  A_EMOTION_LIFECYCLE_ERROR_CODES_V1 as ERROR,
  AEmotionLifecycleError,
} from "./errors";
import { deriveCommittedPressureInvestigationAuthorityV1 } from "./investigation-authority";

const ISSUER: SeatIdV1 = "zhejiang_administration";
const RECEIVER: SeatIdV1 = "zhejiang_governor";
const SUSPECT: SeatIdV1 = "zhejiang_administration";
const RUN_ID = "pressure-lifecycle-run";

test("PROMISE_BROKEN is derived from the existing committed BREAK mutation and frozen binding", () => {
  const binding = promiseBinding();
  const mutation = commitmentMutation();
  const committed = authority({
    sourceActionId: mutation.sourceActionId,
    factCodes: ["PROMISE_LEDGER_BREACH_CONFIRMED"],
    evidenceRefs: ["evidence.ledger.custody", "evidence.ledger.breach"],
  });

  const first = derivePressurePromiseBrokenSignalV1({
    mutation,
    authority: committed,
    binding,
    priorEventId: "aev-promise-created",
    stateVersion: 3,
  });
  const replay = derivePressurePromiseBrokenSignalV1({
    mutation: structuredClone(mutation),
    authority: structuredClone(committed),
    binding: structuredClone(binding),
    priorEventId: "aev-promise-created",
    stateVersion: 3,
  });

  assert.deepEqual(replay, first);
  assert.equal(first.status, "DERIVED");
  if (first.status !== "DERIVED") return;
  assert.equal(first.patch.promiseId, mutation.commitmentId);
  assert.equal(first.patch.sharedObjectId, "original-grain-ledger");
  assert.equal(first.patch.eventCode, "PROMISE_DELIVER_LEDGER_BROKEN");
  assert.equal(first.patch.eventFamily, "LEDGER_FLOW");
  assert.equal(first.patch.disclosure, "CONFIRMED");
  assert.equal(first.patch.revealOfEventId, "aev-promise-created");
  assert.deepEqual(first.patch.audienceSpec, { type: "EXPLICIT", seatIds: [RECEIVER] });
  assert.deepEqual(first.patch.evidenceRefs, ["evidence.ledger.breach", "evidence.ledger.custody"]);
  assert.equal(first.patch.presentation.modalTrigger.stateVersion, 3);
  assert.equal("status" in first.patch, false, "adapter must not project a second promise status");
  assert.equal("deadlineStageIndex" in first.patch, false);
  assert.equal("authorityWrite" in first, false);
  assert.equal("providerRequest" in first, false);
});

test("CREATE, FULFILL, CANCEL and unbound commitments never produce PROMISE_BROKEN", () => {
  const binding = promiseBinding();
  for (const operation of ["CREATE", "FULFILL", "CANCEL"] as const) {
    const result = derivePressurePromiseBrokenSignalV1({
      mutation: commitmentMutation({ operation }),
      authority: authority(),
      binding,
      priorEventId: "aev-prior",
      stateVersion: 2,
    });
    assert.deepEqual(result, { status: "SKIPPED", reason: "NOT_BROKEN" });
  }
  assert.deepEqual(
    derivePressurePromiseBrokenSignalV1({
      mutation: commitmentMutation({ commitmentId: "commitment.other" }),
      authority: authority(),
      binding,
      priorEventId: "aev-prior",
      stateVersion: 2,
    }),
    { status: "SKIPPED", reason: "NOT_BOUND" },
  );
});

test("promise projection requires confirmed matching evidence and preserves the earlier broken action reference", () => {
  const mutation = commitmentMutation();
  const binding = promiseBinding();
  const noEvidence = derivePressurePromiseBrokenSignalV1({
    mutation,
    authority: authority({ sourceActionId: mutation.sourceActionId }),
    binding,
    priorEventId: "aev-prior",
    stateVersion: 2,
  });
  assert.deepEqual(noEvidence, { status: "SKIPPED", reason: "EVIDENCE_NOT_AUTHORIZED" });

  const revealed = derivePressurePromiseBrokenSignalV1({
      mutation,
      authority: authority({
        sourceActionId: "different-action",
        factCodes: ["PROMISE_LEDGER_BREACH_CONFIRMED"],
        evidenceRefs: ["evidence.ledger.breach"],
      }),
      binding,
      priorEventId: "aev-prior",
      stateVersion: 2,
    });
  assert.equal(revealed.status, "DERIVED");
  if (revealed.status === "DERIVED") {
    assert.equal(revealed.patch.brokenByActionId, mutation.sourceActionId);
  }
});

test("disclosure derivation is monotonic HIDDEN to SUSPECTED to CONFIRMED with no owned state", () => {
  const suspectedBinding = sealPressureDisclosureUpgradeBindingV1({
    bindingId: "ledger-suspected",
    fromDisclosure: "HIDDEN",
    toDisclosure: "SUSPECTED",
    actionCode: "INVESTIGATE_LEDGER",
    effectCode: "LEDGER_TRACE_OBSERVED",
    factCode: "LEDGER_SOURCE_SUSPECTED",
    suspectedSeatIds: [ISSUER, SUSPECT],
  });
  const suspected = derivePressureDisclosureUpgradeV1({
    current: currentSignal("HIDDEN", "aev-hidden"),
    authority: authority({
      actionCodes: ["INVESTIGATE_LEDGER"],
      effectCodes: ["LEDGER_TRACE_OBSERVED"],
      factCodes: ["LEDGER_SOURCE_SUSPECTED"],
    }),
    binding: suspectedBinding,
  });
  assert.equal(suspected.status, "DERIVED");
  if (suspected.status !== "DERIVED") return;
  assert.deepEqual(suspected.patch, {
    kind: "REVEAL",
    disclosure: "SUSPECTED",
    suspectedSeatIds: [ISSUER, SUSPECT],
    suspicionBasisRefs: ["LEDGER_SOURCE_SUSPECTED"],
    evidenceRefs: [],
    revealOfEventId: "aev-hidden",
  });

  const confirmedBinding = sealPressureDisclosureUpgradeBindingV1({
    bindingId: "ledger-confirmed",
    fromDisclosure: "SUSPECTED",
    toDisclosure: "CONFIRMED",
    actionCode: "CONFIRM_LEDGER_SOURCE",
    effectCode: "LEDGER_SOURCE_REVEALED",
    factCode: "LEDGER_SOURCE_CONFIRMED",
    suspectedSeatIds: [],
  });
  const confirmed = derivePressureDisclosureUpgradeV1({
    current: currentSignal("SUSPECTED", "aev-suspected"),
    authority: authority({
      actionCodes: ["CONFIRM_LEDGER_SOURCE"],
      effectCodes: ["LEDGER_SOURCE_REVEALED"],
      factCodes: ["LEDGER_SOURCE_CONFIRMED"],
      evidenceRefs: ["evidence.ledger.seal"],
    }),
    binding: confirmedBinding,
  });
  assert.equal(confirmed.status, "DERIVED");
  if (confirmed.status !== "DERIVED") return;
  assert.deepEqual(confirmed.patch, {
    kind: "REVEAL",
    disclosure: "CONFIRMED",
    suspectedSeatIds: [],
    suspicionBasisRefs: [],
    evidenceRefs: ["evidence.ledger.seal"],
    revealOfEventId: "aev-suspected",
  });
  assert.equal("stateVersion" in confirmed.patch, false);
});

test("disclosure derivation rejects skipped transitions and unauthorized confirmation", () => {
  const confirmBinding = sealPressureDisclosureUpgradeBindingV1({
    bindingId: "ledger-confirmed",
    fromDisclosure: "SUSPECTED",
    toDisclosure: "CONFIRMED",
    actionCode: "CONFIRM_LEDGER_SOURCE",
    effectCode: "LEDGER_SOURCE_REVEALED",
    factCode: "LEDGER_SOURCE_CONFIRMED",
    suspectedSeatIds: [],
  });
  assertLifecycleError(
    () => derivePressureDisclosureUpgradeV1({
      current: currentSignal("HIDDEN", "aev-hidden"),
      authority: authority(),
      binding: confirmBinding,
    }),
    ERROR.DISCLOSURE_SKIP_FORBIDDEN,
  );
  assert.deepEqual(
    derivePressureDisclosureUpgradeV1({
      current: currentSignal("SUSPECTED", "aev-suspected"),
      authority: authority({
        actionCodes: ["CONFIRM_LEDGER_SOURCE"],
        effectCodes: ["LEDGER_SOURCE_REVEALED"],
        factCodes: ["LEDGER_SOURCE_CONFIRMED"],
      }),
      binding: confirmBinding,
    }),
    { status: "SKIPPED", reason: "EVIDENCE_NOT_AUTHORIZED" },
  );
});

test("authority validator excludes Provider, narrative and authority-writer payloads", () => {
  for (const forbidden of ["providerOutput", "narrativeText", "authorityWriter"] as const) {
    assertLifecycleError(
      () => derivePressurePromiseBrokenSignalV1({
        mutation: commitmentMutation(),
        authority: { ...authority(), [forbidden]: "forbidden" },
        binding: promiseBinding(),
        priorEventId: "aev-prior",
        stateVersion: 2,
      }),
      ERROR.FORBIDDEN_INPUT,
    );
  }
});

test("committed investigation authority derives effect and fact only from frozen binding", () => {
  const binding = sealPressureDisclosureUpgradeBindingV1({
    bindingId: "ledger-source-suspected",
    fromDisclosure: "HIDDEN",
    toDisclosure: "SUSPECTED",
    actionCode: "INVESTIGATE_LEDGER_SOURCE",
    effectCode: "SANGTIAN_LEDGER_SOURCE_SUSPECTED",
    factCode: "fact.formal-promise.ledger-source-suspected",
    suspectedSeatIds: [ISSUER],
  });
  const payload: CanonicalJsonObject = {
    interactionKind: "A_EMOTION_INVESTIGATION",
    investigationCode: binding.actionCode,
    responseToEventId: "aev-ledger-hidden-root",
    sharedObjectId: "original-grain-ledger",
  };
  const base = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: "action-investigate-ledger-source",
    runId: RUN_ID,
    chapterRuntimeId: "chapter-runtime-N6",
    chapterId: "N6" as const,
    decisionPointId: "N6.ledger_exchange",
    seatId: "qingliu_law" as const,
    actionOrdinal: 1,
    actionRevision: 1,
    controlEpoch: 2,
    expectedWorkingRevision: 3,
    status: "SEALED" as const,
    actionType: binding.actionCode,
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey: "investigate-ledger-source-1",
  };
  const requestFingerprint = computeDecisionActionRequestFingerprint(base);
  const sealed = { ...base, requestFingerprint };
  const result = deriveCommittedPressureInvestigationAuthorityV1({
    sourceKind: "BEAT_COMMITTED",
    sourceId: "beat-investigation-1",
    sourceCommitHash: sha256Canonical({ beat: "investigation-1" }),
    committedAt: "2026-08-12T08:20:00.000Z",
    action: { ...sealed, sealedHash: sha256Canonical(sealed) },
    committedEvidenceRefs: ["evidence.authorized.custody"],
    binding,
  });
  assert.equal(result.responseToEventId, "aev-ledger-hidden-root");
  assert.deepEqual(result.authority.actionCodes, [binding.actionCode]);
  assert.deepEqual(result.authority.effectCodes, [binding.effectCode]);
  assert.deepEqual(result.authority.factCodes, [binding.factCode]);
  assert.deepEqual(result.authority.evidenceRefs, ["evidence.authorized.custody"]);
  assert.equal(result.authority.sourceSeatId, "qingliu_law");
});

function promiseBinding() {
  return sealPressurePromiseAEmotionBindingV1({
    bindingId: "promise-ledger-delivery",
    promiseCode: "DELIVER_ORIGINAL_LEDGER",
    commitmentId: "commitment.deliver-original-ledger",
    sharedObjectId: "original-grain-ledger",
    issuerSeatId: ISSUER,
    receiverSeatId: RECEIVER,
    revealEvidenceFactCodes: ["PROMISE_LEDGER_BREACH_CONFIRMED"],
  });
}

function commitmentMutation(
  overrides: Partial<PressureCommittedCommitmentMutationV1> = {},
): PressureCommittedCommitmentMutationV1 {
  return {
    commitmentId: "commitment.deliver-original-ledger",
    operation: "BREAK",
    seatIds: [ISSUER, RECEIVER],
    sourceActionId: "action-break-promise",
    ...overrides,
  };
}

function authority(
  overrides: Partial<PressureAEmotionLifecycleAuthorityV1> = {},
): PressureAEmotionLifecycleAuthorityV1 {
  const sourceId = overrides.sourceId ?? "beat-authority";
  return {
    schemaVersion: PRESSURE_A_EMOTION_LIFECYCLE_AUTHORITY_SCHEMA_V1,
    sourceKind: "BEAT_COMMITTED",
    sourceId,
    sourceCommitHash: sha256Canonical(`commit:${sourceId}`),
    runId: RUN_ID,
    stageId: "N2",
    sourceActionId: "action-break-promise",
    sourceSeatId: ISSUER,
    actionCodes: [],
    effectCodes: [],
    factCodes: [],
    evidenceRefs: [],
    committedAt: "2026-08-12T02:00:00.000Z",
    ...overrides,
  };
}

function currentSignal(
  disclosure: AEmotionAuthoritySignalV1["disclosure"],
  eventId: string,
) {
  return { eventId, runId: RUN_ID, stageId: "N2", disclosure };
}

function assertLifecycleError(operation: () => unknown, code: string): void {
  assert.throws(
    operation,
    (error: unknown) => error instanceof AEmotionLifecycleError && error.code === code,
  );
}
