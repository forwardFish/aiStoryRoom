import assert from "node:assert/strict";
import test from "node:test";
import { sha256Canonical } from "@ai-story/shared";
import {
  sealPressureDisclosureUpgradeBindingV1,
  sealPressurePromiseAEmotionBindingV1,
  type PressureAEmotionLifecycleAuthorityV1,
} from "../a-emotion-lifecycle";
import {
  CanonicalAEmotionAuthorityEventCompilerV1,
  sealAEmotionAuthorityOutboxJobV1,
  sealAEmotionCommittedAuthoritySourceV1,
} from "./compiler";
import { compilePressureAEmotionLifecycleUpgradeV1 } from "./lifecycle-source";

test("committed investigation upgrades one ledger aggregate and only confirmed evidence owns PromiseBroken modal", () => {
  const root = hiddenRoot();
  const suspectedAuthority = authority({
    sourceId: "settlement-suspected",
    action: "INVESTIGATE_LEDGER_SOURCE",
    effect: "SANGTIAN_LEDGER_SOURCE_SUSPECTED",
    fact: "fact.formal-promise.ledger-source-suspected",
    evidenceRefs: [],
  });
  const suspectedBinding = sealPressureDisclosureUpgradeBindingV1({
    bindingId: "original-grain-ledger-hidden-to-suspected",
    fromDisclosure: "HIDDEN",
    toDisclosure: "SUSPECTED",
    actionCode: "INVESTIGATE_LEDGER_SOURCE",
    effectCode: "SANGTIAN_LEDGER_SOURCE_SUSPECTED",
    factCode: "fact.formal-promise.ledger-source-suspected",
    suspectedSeatIds: ["zhejiang_administration"],
  });
  const suspectedEmission = compilePressureAEmotionLifecycleUpgradeV1({
    roomId: root.roomId,
    currentEvent: root,
    authority: suspectedAuthority,
    disclosureBinding: suspectedBinding,
    eventSequence: root.eventSequence + 1,
    stateVersion: 2,
    storyDay: 6,
    audienceSeatIds: ["zhejiang_governor"],
  })[0]!;
  const compiler = new CanonicalAEmotionAuthorityEventCompilerV1();
  const suspected = compiler.compile(suspectedEmission.job, suspectedEmission.source);
  assert.equal(suspected.disclosure, "SUSPECTED");
  assert.equal(suspected.revealOfEventId, root.eventId);
  assert.equal(suspected.sharedObjectId, root.sharedObjectId);
  assert.equal(suspected.eventFamily, root.eventFamily);
  assert.equal(suspected.presentation.modalTrigger, null);

  const confirmedAuthority = authority({
    sourceId: "settlement-confirmed",
    action: "CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE",
    effect: "SANGTIAN_LEDGER_SOURCE_CONFIRMED",
    fact: "fact.formal-promise.ledger-source-confirmed",
    evidenceRefs: ["evidence.formal-promise.custody-chain"],
  });
  const confirmedBinding = sealPressureDisclosureUpgradeBindingV1({
    bindingId: "original-grain-ledger-suspected-to-confirmed",
    fromDisclosure: "SUSPECTED",
    toDisclosure: "CONFIRMED",
    actionCode: "CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE",
    effectCode: "SANGTIAN_LEDGER_SOURCE_CONFIRMED",
    factCode: "fact.formal-promise.ledger-source-confirmed",
    suspectedSeatIds: [],
  });
  const promiseBinding = sealPressurePromiseAEmotionBindingV1({
    bindingId: "deliver-original-ledger",
    promiseCode: "DELIVER_ORIGINAL_LEDGER",
    commitmentId: "simple-promise-1",
    sharedObjectId: "original-grain-ledger",
    issuerSeatId: "zhejiang_administration",
    receiverSeatId: "zhejiang_governor",
    revealEvidenceFactCodes: ["fact.formal-promise.ledger-source-confirmed"],
  });
  const confirmedEmission = compilePressureAEmotionLifecycleUpgradeV1({
    roomId: root.roomId,
    currentEvent: suspected,
    authority: confirmedAuthority,
    disclosureBinding: confirmedBinding,
    promiseMutation: {
      commitmentId: "simple-promise-1",
      operation: "BREAK",
      seatIds: ["zhejiang_administration", "zhejiang_governor"],
      sourceActionId: "action-explicit-copy-delivery",
    },
    promiseBinding,
    eventSequence: suspected.eventSequence + 1,
    stateVersion: 3,
    storyDay: 6,
    audienceSeatIds: ["zhejiang_governor"],
  })[0]!;
  const confirmed = compiler.compile(confirmedEmission.job, confirmedEmission.source);
  assert.equal(confirmed.disclosure, "CONFIRMED");
  assert.equal(confirmed.revealOfEventId, suspected.eventId);
  assert.equal(confirmed.eventCode, "PROMISE_DELIVER_LEDGER_BROKEN");
  assert.equal(confirmed.promiseId, "simple-promise-1");
  assert.equal(confirmed.presentation.modalTrigger?.type, "PROMISE_BROKEN");
  assert.equal(confirmed.sharedObjectId, root.sharedObjectId);
  assert.equal(confirmed.eventFamily, root.eventFamily);
  assert.doesNotMatch(JSON.stringify([suspectedEmission, confirmedEmission]), /provider|prompt|narrative/iu);
});

test("confirmation without authorized evidence emits nothing", () => {
  const root = hiddenRoot();
  const suspicionBinding = sealPressureDisclosureUpgradeBindingV1({
    bindingId: "suspect",
    fromDisclosure: "HIDDEN",
    toDisclosure: "SUSPECTED",
    actionCode: "INVESTIGATE_LEDGER_SOURCE",
    effectCode: "SANGTIAN_LEDGER_SOURCE_SUSPECTED",
    factCode: "fact.formal-promise.ledger-source-suspected",
    suspectedSeatIds: ["zhejiang_administration"],
  });
  const suspicionEmission = compilePressureAEmotionLifecycleUpgradeV1({
    roomId: root.roomId,
    currentEvent: root,
    authority: authority({
      sourceId: "suspect-no-evidence-test",
      action: suspicionBinding.actionCode,
      effect: suspicionBinding.effectCode,
      fact: suspicionBinding.factCode,
      evidenceRefs: [],
    }),
    disclosureBinding: suspicionBinding,
    eventSequence: root.eventSequence + 1,
    stateVersion: 2,
    storyDay: 6,
    audienceSeatIds: ["zhejiang_governor"],
  })[0]!;
  const suspected = new CanonicalAEmotionAuthorityEventCompilerV1()
    .compile(suspicionEmission.job, suspicionEmission.source);
  const binding = sealPressureDisclosureUpgradeBindingV1({
    bindingId: "confirm",
    fromDisclosure: "SUSPECTED",
    toDisclosure: "CONFIRMED",
    actionCode: "CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE",
    effectCode: "SANGTIAN_LEDGER_SOURCE_CONFIRMED",
    factCode: "fact.formal-promise.ledger-source-confirmed",
    suspectedSeatIds: [],
  });
  assert.deepEqual(compilePressureAEmotionLifecycleUpgradeV1({
    roomId: root.roomId,
    currentEvent: suspected,
    authority: authority({
      sourceId: "no-evidence",
      action: binding.actionCode,
      effect: binding.effectCode,
      fact: binding.factCode,
      evidenceRefs: [],
    }),
    disclosureBinding: binding,
    eventSequence: suspected.eventSequence + 1,
    stateVersion: 3,
    storyDay: 6,
    audienceSeatIds: ["zhejiang_governor"],
  }), []);
});

function authority(input: {
  sourceId: string;
  action: string;
  effect: string;
  fact: string;
  evidenceRefs: string[];
}): PressureAEmotionLifecycleAuthorityV1 {
  return {
    schemaVersion: "pressure_a_emotion_lifecycle_authority_v1",
    sourceKind: "CHAPTER_SETTLEMENT_COMMITTED",
    sourceId: input.sourceId,
    sourceCommitHash: sha256Canonical({ sourceId: input.sourceId }),
    runId: "run-lifecycle-production",
    stageId: "N6",
    sourceActionId: `action-${input.sourceId}`,
    sourceSeatId: "qingliu_law",
    actionCodes: [input.action],
    effectCodes: [input.effect],
    factCodes: [input.fact],
    evidenceRefs: input.evidenceRefs,
    committedAt: "2026-08-12T08:10:00.000Z",
  };
}

function hiddenRoot() {
  const hash = sha256Canonical({ hidden: "ledger-anomaly" });
  const job = sealAEmotionAuthorityOutboxJobV1({
    schemaVersion: "a_emotion_authority_outbox_job_v1",
    sourceKind: "FORMAL_COMMITMENT_COMMITTED",
    runId: "run-lifecycle-production",
    sourceId: hash,
    sourceCommitHash: hash,
    signalId: "hidden-ledger-root",
  });
  const source = sealAEmotionCommittedAuthoritySourceV1({
    schemaVersion: "a_emotion_committed_authority_source_v1",
    sourceKind: job.sourceKind,
    sourceId: hash,
    sourceCommitHash: hash,
    roomId: job.runId,
    runId: job.runId,
    stageId: "N6",
    sourceActionId: "action-copy-delivery",
    sourceSeatId: "zhejiang_administration",
    committedAt: "2026-08-12T08:00:00.000Z",
    eventSequence: 65_000_001,
    stateVersion: 1,
    storyDay: 6,
    signal: {
      signalId: job.signalId,
      kind: "DIRECT_IMPACT",
      eventCode: "LEDGER_DELIVERY_ANOMALY",
      eventFamily: "LEDGER_FLOW",
      severity: "MAJOR",
      sharedObjectId: "original-grain-ledger",
      factRefs: [], publicFactRefs: [], impacts: [],
      audienceSpec: { type: "EXPLICIT", seatIds: ["zhejiang_governor"] },
      disclosure: "HIDDEN", suspectedSeatIds: [], suspicionBasisRefs: [], evidenceRefs: [],
      revealOfEventId: null, promiseId: "simple-promise-1", milestoneId: null, metricTransitionId: null,
      presentation: {
        recommendedPresentation: "CENTER_CARD", centerCardType: "CROSS_IMPACT",
        responseOptions: [], modalTrigger: null,
      },
    },
  }, job);
  return new CanonicalAEmotionAuthorityEventCompilerV1().compile(job, source);
}
