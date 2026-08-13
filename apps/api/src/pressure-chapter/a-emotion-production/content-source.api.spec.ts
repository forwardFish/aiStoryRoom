import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAPTER_IDS_V1,
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  computeDecisionActionRequestFingerprint,
  computeSealedActionsHash,
  nextChapterId,
  sha256Canonical,
  validateSangtianFinaleInputV1,
  type CanonicalJsonObject,
  type DecisionActionV1,
  type FrozenChapterBundleV1,
  type FrozenResultReferenceV1,
  type SeatArcStateV1,
  type SeatIdV1,
  type TerminalResultContextV1,
  type TrackIdV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  buildSangtianFinaleIdempotencyKeyV1,
  compileInitialWorldState,
  compileSangtianContentFinalePolicyV1,
  evaluateContentOwnedChapterPolicyV1,
  evaluateSangtianPressureFinaleV1,
  loadPublishedSangtianAEmotionPolicyV1,
  loadSangtianPressureChapterPackageV1,
} from "@ai-story/templates";
import {
  buildAtomicChapterCommitRecordV1,
  computeChapterSettlementRequestFingerprintV1,
  sealChapterCloseFenceV1,
  sealChapterSettlementSourceV1,
} from "../chapter-settlement/chapter-commit-record";
import { buildAuthorityFirstTerminalRecordV1 } from "../terminal-commit/terminal-record";
import type {
  WorkingActionIntentV1,
  WorkingLedgerEventPayloadV1,
  WorkingLedgerEventV1,
} from "../working-ledger/contracts";
import { computeWorkingActionInputFingerprintV1 } from "../working-ledger/fingerprint";
import {
  buildWorkingLedgerEvents,
  projectWorkingLedger,
  workingStateHash,
} from "../working-ledger/working-ledger";
import { createChapterWorkingState } from "@ai-story/templates";
import { CanonicalAEmotionAuthorityEventCompilerV1 } from "./compiler";
import { FrozenAEmotionPresentationCatalogV1 } from "../a-emotion/presentation";
import { computePressureFormalCommitmentFingerprintV1 } from "../a-emotion-promise";
import {
  SangtianAEmotionContentSourceCompilerV1,
  type AEmotionFinaleChapterAuthorityV1,
} from "./content-source";
import { deriveStateTransitionPresentationV1 } from "./trigger-derivation";

const RUN_ID = "run-a-emotion-content-source";
const ROOM_ID = "room-a-emotion-content-source";
const COMMITTED_AT = "2026-08-12T00:00:00.000Z";
const digest = (label: string): string => sha256Canonical({ label });

function compiler(): SangtianAEmotionContentSourceCompilerV1 {
  return new SangtianAEmotionContentSourceCompilerV1({
    policy: loadPublishedSangtianAEmotionPolicyV1(),
    contentPackage: loadSangtianPressureChapterPackageV1(),
  });
}

test("Genesis emits zero jobs and forbidden UI/Provider/Narrative fields fail closed", () => {
  const subject = compiler();
  assert.deepEqual(subject.compileGenesis(), []);
  for (const forbidden of ["uiState", "providerOutput", "narrativeArtifact"] as const) {
    assert.throws(() => subject.compileBeat({
      sourceKind: "BEAT_COMMITTED",
      roomId: ROOM_ID,
      committedAt: COMMITTED_AT,
      beatEventHash: digest("beat"),
      ledgerEvents: [],
      [forbidden]: "must-not-enter-authority",
    }), /FORBIDDEN_OR_UNKNOWN_FIELD/u);
  }
});

test("committed Beat compiles only source-action-bound mutations and DEFAULT_PASS emits zero", () => {
  const chapterId = "N1" as const;
  const ledger = ledgerFixture(chapterId, { withBeat: true, defaultOnly: false });
  const beatEvent = ledger.events.at(-1)!;
  const emissions = compiler().compileBeat({
    sourceKind: "BEAT_COMMITTED",
    roomId: ROOM_ID,
    committedAt: COMMITTED_AT,
    beatEventHash: beatEvent.eventHash,
    ledgerEvents: ledger.events,
  });
  assert.equal(emissions.length, 1);
  const emission = emissions[0]!;
  assert.equal(emission.dedupeKey, `aemotion:${emission.job.jobHash}`);
  assert.equal(emission.source.sourceCommitHash, beatEvent.eventHash);
  assert.equal(emission.source.sourceActionId, ledger.actions[0]!.actionId);
  assert.deepEqual(emission.source.signal.factRefs, []);
  assert.deepEqual(emission.source.signal.suspectedSeatIds, []);
  assert.equal(emission.source.signal.promiseId, null);
  assert(emission.source.signal.impacts.every((impact) => (
    impact.effectCode.startsWith("SANGTIAN_COMMITMENT_")
    || impact.effectCode === "SANGTIAN_WORKING_ARC_DELTA"
  )));
  const event = new CanonicalAEmotionAuthorityEventCompilerV1().compile(
    emission.job,
    emission.source,
  );
  assert.equal(event.eventCode, "SANGTIAN_BEAT_ACTION_COMMITTED");

  const defaultLedger = ledgerFixture(chapterId, { withBeat: true, defaultOnly: true });
  assert.deepEqual(compiler().compileBeat({
    sourceKind: "BEAT_COMMITTED",
    roomId: ROOM_ID,
    committedAt: COMMITTED_AT,
    beatEventHash: defaultLedger.events.at(-1)!.eventHash,
    ledgerEvents: defaultLedger.events,
  }), []);
});

test("Beat evidence disclosure is split into authorized confirmed and safe hidden cohorts", () => {
  const actor = PRESSURE_CHAPTER_SEAT_IDS_V1[0]!;
  const other = PRESSURE_CHAPTER_SEAT_IDS_V1[1]!;
  const ledger = ledgerFixture("N1", {
    withBeat: true,
    defaultOnly: false,
    additionalAudienceSeatId: other,
  });
  const beatEvent = ledger.events.at(-1)!;

  const emissions = compiler().compileBeat({
    sourceKind: "BEAT_COMMITTED",
    roomId: ROOM_ID,
    committedAt: COMMITTED_AT,
    beatEventHash: beatEvent.eventHash,
    ledgerEvents: ledger.events,
  });

  assert.equal(emissions.length, 2);
  const confirmed = emissions.find((item) => item.source.signal.disclosure === "CONFIRMED")!;
  const hidden = emissions.find((item) => item.source.signal.disclosure === "HIDDEN")!;
  assert.deepEqual(confirmed.source.signal.audienceSpec, { type: "EXPLICIT", seatIds: [actor] });
  assert.deepEqual(confirmed.source.signal.evidenceRefs, ["evidence.N1.cabinet_finance"]);
  assert.deepEqual(hidden.source.signal.audienceSpec, { type: "EXPLICIT", seatIds: [other] });
  assert.deepEqual(hidden.source.signal.evidenceRefs, []);
  assert.notEqual(confirmed.job.signalId, hidden.job.signalId);
  assert.notEqual(confirmed.source.eventSequence, hidden.source.eventSequence);
});

test("committed BREAK stays HIDDEN and non-modal until an authorized REVEAL", () => {
  const ledger = formalPromiseLedger();
  const subject = compiler();
  const broken = subject.compileFormalCommitment({
    sourceKind: "FORMAL_COMMITMENT_COMMITTED",
    roomId: ROOM_ID,
    committedAt: COMMITTED_AT,
    commitmentEventHash: ledger.breakEvent.eventHash,
    ledgerEvents: ledger.events,
  });
  const replay = subject.compileFormalCommitment({
    sourceKind: "FORMAL_COMMITMENT_COMMITTED",
    roomId: ROOM_ID,
    committedAt: COMMITTED_AT,
    commitmentEventHash: ledger.breakEvent.eventHash,
    ledgerEvents: structuredClone(ledger.events),
  });

  assert.deepEqual(replay, broken);
  assert.equal(broken.length, 1);
  const signal = broken[0]!.source.signal;
  assert.equal(signal.disclosure, "HIDDEN");
  assert.equal(signal.promiseId, "promise-ledger-1");
  assert.equal(signal.presentation.recommendedPresentation, "CENTER_CARD");
  assert.equal(signal.presentation.centerCardType, "CROSS_IMPACT");
  assert.equal(signal.presentation.modalTrigger, null);
  assert.equal(broken[0]!.dedupeKey, `aemotion:${broken[0]!.job.jobHash}`);
});

test("real Sangtian N1 ChapterSettlement emits six viewer-safe seat outcomes", () => {
  const fixture = realN1ChapterRecord();
  const emissions = compiler().compileChapter({
    sourceKind: "CHAPTER_SETTLEMENT_COMMITTED",
    roomId: ROOM_ID,
    committedAt: COMMITTED_AT,
    record: fixture.record,
    ledgerEvents: fixture.ledger.events,
  });
  assert.equal(emissions.length, PRESSURE_CHAPTER_SEAT_IDS_V1.length);
  assert.deepEqual(
    emissions.map((item) => item.source.sourceSeatId),
    PRESSURE_CHAPTER_SEAT_IDS_V1,
  );
  for (const emission of emissions) {
    assert.equal(emission.source.signal.eventCode, "SANGTIAN_CHAPTER_HIGH_COMMITTED");
    assert.equal(emission.source.signal.milestoneId, `run:${RUN_ID}:chapter-outcome-victory`);
    assert.deepEqual(emission.source.signal.presentation.modalTrigger, {
      type: "STAGE_VICTORY",
      triggerId: `run:${RUN_ID}:chapter-outcome-victory`,
      stateVersion: 1,
    });
    assert.deepEqual(emission.source.signal.publicFactRefs, ["chapter.N1.outcome_band"]);
    assert.equal(emission.source.signal.audienceSpec.type, "AFFECTED_SEATS");
    assert.equal(emission.source.signal.suspectedSeatIds.length, 0);
    assert.equal(emission.source.signal.promiseId, null);
    assert.equal(emission.source.signal.revealOfEventId, null);
    assert(fixture.ledger.actions.some((action) => action.actionId === emission.source.sourceActionId));
    new CanonicalAEmotionAuthorityEventCompilerV1().compile(emission.job, emission.source);
  }
});

test("N1-N7 frozen ledgers plus committed terminal record emit one true-action finale event per seat", () => {
  const fixture = finaleFixture();
  const emissions = compiler().compileFinale({
    sourceKind: "FINALE_COMMITTED",
    roomId: ROOM_ID,
    record: fixture.record,
    chapters: fixture.chapters,
  });
  assert.equal(emissions.length, PRESSURE_CHAPTER_SEAT_IDS_V1.length);
  for (const [index, emission] of emissions.entries()) {
    const seatId = PRESSURE_CHAPTER_SEAT_IDS_V1[index]!;
    assert.equal(emission.source.sourceSeatId, seatId);
    assert.equal(emission.source.stageId, "FINALE");
    assert.equal(emission.source.sourceCommitHash, fixture.record.authorityCommitHash);
    assert.equal(emission.source.signal.disclosure, "HIDDEN");
    assert.deepEqual(emission.source.signal.evidenceRefs, []);
    assert.equal(emission.source.signal.promiseId, null);
    assert.equal(emission.source.signal.presentation.modalTrigger, null);
    assert.notEqual(emission.source.signal.presentation.centerCardType, "CRISIS");
    assert.notEqual(emission.source.signal.presentation.centerCardType, "STAGE_VICTORY");
    assert.equal(emission.source.sourceActionId, `action-N7-${seatId}`);
    new CanonicalAEmotionAuthorityEventCompilerV1().compile(emission.job, emission.source);
  }
});

test("first LOW transition uses an explicit DANGER_ENTERED code while trigger stateVersion is preserved", () => {
  const derived = deriveStateTransitionPresentationV1({
    signal: {
      signalId: "chapter-low-N7",
      kind: "DIRECT_IMPACT",
      eventCode: "SANGTIAN_CHAPTER_LOW_COMMITTED",
      eventFamily: "SANGTIAN_CHAPTER_SETTLEMENT",
      severity: "CRITICAL",
      sharedObjectId: "chapter:N7:outcome:LOW",
      factRefs: ["chapter.N7.outcome_band"],
      publicFactRefs: ["chapter.N7.outcome_band"],
      impacts: [],
      audienceSpec: { type: "AFFECTED_SEATS", seatIds: [PRESSURE_CHAPTER_SEAT_IDS_V1[0]!] },
      disclosure: "CONFIRMED",
      suspectedSeatIds: [],
      suspicionBasisRefs: [],
      evidenceRefs: [digest("evidence-low-N7")],
      revealOfEventId: null,
      promiseId: null,
      milestoneId: null,
      metricTransitionId: null,
      presentation: {
        recommendedPresentation: "KEY_MODAL",
        centerCardType: "CRISIS",
        responseOptions: [],
        modalTrigger: { type: "CRISIS", triggerId: "legacy-template", stateVersion: 1 },
      },
    },
    stateVersion: 7,
    metric: {
      metricTransitionId: `run:${RUN_ID}:chapter-outcome-health`,
      beforeTone: "WARN",
      afterTone: "DANGER",
    },
  });
  assert.equal(derived.eventCode, "SANGTIAN_CHAPTER_LOW_DANGER_ENTERED");
  assert.equal(derived.presentation.modalTrigger?.stateVersion, 7);
});

test("frozen presentation catalog renders every released Sangtian event code", () => {
  const published = loadPublishedSangtianAEmotionPolicyV1();
  const catalog = new FrozenAEmotionPresentationCatalogV1();
  const templates = [
    published.compileTemplate({ sourceKind: "BEAT_COMMITTED", chapterId: "N1", actionType: "ACT" })!,
    ...(["HIGH", "LOW", "MID"] as const).map((outcomeBand) => published.compileTemplate({
      sourceKind: "CHAPTER_SETTLEMENT_COMMITTED" as const,
      chapterId: "N1" as const,
      outcomeBand,
    })!),
    ...(["COSTLY_WIN", "LOSS", "WIN"] as const).map((verdict) => published.compileTemplate({
      sourceKind: "FINALE_COMMITTED" as const,
      verdict,
    })!),
  ];
  for (const template of templates) {
    const rendered = catalog.render({
      eventCode: template.eventCode,
      disclosure: "HIDDEN",
      category: "RELATED",
      cardType: template.presentation.centerCardType,
      visibleImpacts: [],
      knownFactRefs: [],
      responseOptions: template.presentation.responseOptions.map((item) => ({ ...item })),
      eventId: `event:${template.eventCode}`,
    });
    assert(rendered, template.eventCode);
    assert.equal(rendered.card?.type ?? null, template.presentation.centerCardType);
  }
});

function ledgerFixture(
  chapterId: (typeof CHAPTER_IDS_V1)[number],
  options: {
    withBeat: boolean;
    defaultOnly: boolean;
    additionalAudienceSeatId?: SeatIdV1;
  },
): { events: WorkingLedgerEventV1[]; actions: DecisionActionV1[] } {
  const chapterRuntimeId = `runtime-${chapterId}`;
  const routeHash = digest(`route:${chapterId}`);
  const initial = createChapterWorkingState({ runId: RUN_ID, chapterId });
  const pin = {
    schemaVersion: "pressure_decision_pin_v1" as const,
    chapterId,
    stateRevision: 0,
    stateFingerprint: workingStateHash(initial),
    decisionPointId: `decision-${chapterId}`,
    kernelId: `kernel-${chapterId}`,
    optionIds: ["ACT", "DEFAULT_PASS"],
  };
  const payloads: WorkingLedgerEventPayloadV1[] = [{
    eventType: "WORKING_LEDGER_OPENED",
    routeHash,
    chapterDefinitionHash: digest(`definition:${chapterId}`),
    initialState: initial,
    initialStateHash: workingStateHash(initial),
    nextDecisionPin: pin,
  }];
  const seats = options.withBeat ? [PRESSURE_CHAPTER_SEAT_IDS_V1[0]!] : [...PRESSURE_CHAPTER_SEAT_IDS_V1];
  const actions = seats.map((seatId, index) => action(chapterId, chapterRuntimeId, seatId, index + 1, options.defaultOnly));
  const intents = actions.map((item) => actionIntent(item, options.withBeat));
  actions.forEach((item, index) => payloads.push({
    eventType: "FORMAL_ACTION_ACCEPTED",
    routeHash,
    inputFingerprint: computeWorkingActionInputFingerprintV1({
      routeHash,
      action: item,
      intent: intents[index]!,
    }),
    action: item,
    intent: intents[index]!,
    audienceSeatIds: [
      item.seatId,
      ...(options.additionalAudienceSeatId === undefined
        || options.additionalAudienceSeatId === item.seatId
        ? []
        : [options.additionalAudienceSeatId]),
    ],
  }));
  let events = buildWorkingLedgerEvents({
    key: { runId: RUN_ID, chapterRuntimeId },
    chapterId,
    previousEvents: [],
    payloads,
  });
  if (options.withBeat) {
    const resolvedAction = actions[0]!;
    const workingDelta = {
      workingFactMutations: [],
      commitmentMutations: options.defaultOnly ? [] : [{
        commitmentId: `commitment-${chapterId}`,
        operation: "CREATE" as const,
        seatIds: [resolvedAction.seatId],
        sourceActionId: resolvedAction.actionId,
      }],
      knowledgeMutations: [],
      seatArcWorkingMutations: options.defaultOnly ? [] : [{
        seatId: resolvedAction.seatId,
        progressDelta: 1,
        sourceActionId: resolvedAction.actionId,
      }],
    };
    const beatWithoutHash = {
      schemaVersion: "sangtian_beat_resolution_v1" as const,
      runId: RUN_ID,
      chapterRuntimeId,
      decisionPointId: resolvedAction.decisionPointId,
      baseWorkingRevision: 0,
      committedWorkingRevision: 1,
      inputWorkingStateHash: workingStateHash(initial),
      sealedActionIds: [resolvedAction.actionId],
      sealedActionsHash: computeSealedActionsHash([resolvedAction]),
      resolverVersion: "fixture-beat-1.0.0",
      workingDelta,
      reservationMutations: [],
      reactionContextRef: null,
      nextDecisionContextRef: null,
    };
    const beatResolution = {
      ...beatWithoutHash,
      resolutionHash: sha256Canonical(beatWithoutHash),
    };
    const stateAfter = {
      ...initial,
      revision: 1,
      completedDecisionPointIds: [resolvedAction.decisionPointId],
      lastBeatId: `beat-${chapterId}`,
    };
    const authoredWithoutHash = {
      schemaVersion: "pressure_beat_result_v1" as const,
      beatId: `beat-${chapterId}`,
      chapterId,
      decisionPointId: resolvedAction.decisionPointId,
      optionId: resolvedAction.actionType,
      baseRevision: 0,
      baseFingerprint: workingStateHash(initial),
      workingDelta: {
        schemaVersion: "pressure_working_delta_v1" as const,
        baseRevision: 0,
        completeDecisionPointId: resolvedAction.decisionPointId,
        setFacts: {},
        incrementCounters: {},
        satisfyRequirementIds: [],
        appendSettledReaction: null,
      },
    };
    const [beatEvent] = buildWorkingLedgerEvents({
      key: { runId: RUN_ID, chapterRuntimeId },
      chapterId,
      previousEvents: events,
      payloads: [{
        eventType: "BEAT_APPLIED",
        routeHash,
        commandFingerprint: digest(`beat-command:${chapterId}`),
        actionInputFingerprint: digest(`beat-input:${chapterId}`),
        beatResolution,
        authoredBeatResult: {
          ...authoredWithoutHash,
          resultHash: sha256Canonical(authoredWithoutHash),
        },
        stateAfter,
        stateAfterHash: workingStateHash(stateAfter),
        nextDecisionPin: null,
      }],
    });
    events = [...events, beatEvent!];
  }
  projectWorkingLedger(events);
  return { events, actions };
}

function action(
  chapterId: (typeof CHAPTER_IDS_V1)[number],
  chapterRuntimeId: string,
  seatId: SeatIdV1,
  ordinal: number,
  defaultOnly = false,
): DecisionActionV1 {
  const payload: CanonicalJsonObject = defaultOnly
    ? { reason: "ABSENT" }
    : { optionCode: `ACT_${seatId}` };
  const base = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: `action-${chapterId}-${seatId}`,
    runId: RUN_ID,
    chapterRuntimeId,
    chapterId,
    decisionPointId: `decision-${chapterId}`,
    seatId,
    actionOrdinal: ordinal,
    actionRevision: 1,
    controlEpoch: 1,
    expectedWorkingRevision: 0,
    status: "SEALED" as const,
    actionType: defaultOnly ? "DEFAULT_PASS" : `ACT_${seatId}`,
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey: `idempotency-${chapterId}-${seatId}`,
  };
  const requested = { ...base, requestFingerprint: computeDecisionActionRequestFingerprint(base) };
  return { ...requested, sealedHash: sha256Canonical(requested) };
}

function actionIntent(item: DecisionActionV1, withImpacts: boolean): WorkingActionIntentV1 {
  return {
    visibility: "PRIVATE",
    targetSeatIds: [item.seatId],
    evidenceRefs: withImpacts ? [`evidence.${item.chapterId}.${item.seatId}`] : [],
    resourceReservations: [],
    commitmentMutations: withImpacts ? [{
      commitmentId: `commitment-${item.chapterId}`,
      operation: "CREATE",
      seatIds: [item.seatId],
    }] : [],
    knowledgeGrants: [],
    seatArcProgress: withImpacts ? [{ seatId: item.seatId, progressDelta: 1 }] : [],
  };
}

function formalPromiseLedger(): {
  events: WorkingLedgerEventV1[];
  breakEvent: WorkingLedgerEventV1;
} {
  const opened = ledgerFixture("N1", { withBeat: false, defaultOnly: false }).events[0]!;
  const createAction = formalPromiseAction("CREATE_SIMPLE_PROMISE_DELIVER_ORIGINAL", "create");
  const createMutation = {
    commitmentId: "promise-ledger-1",
    operation: "CREATE" as const,
    seatIds: ["zhejiang_governor", "jiangnan_merchant"] as SeatIdV1[],
    sourceActionId: createAction.actionId,
  };
  const audienceSeatIds = [...createMutation.seatIds];
  const [createEvent] = buildWorkingLedgerEvents({
    key: { runId: RUN_ID, chapterRuntimeId: "runtime-N1" },
    chapterId: "N1",
    previousEvents: [opened],
    payloads: [{
      eventType: "FORMAL_COMMITMENT_APPLIED",
      routeHash: opened.payload.routeHash,
      inputFingerprint: computePressureFormalCommitmentFingerprintV1({
        routeHash: opened.payload.routeHash,
        action: createAction,
        mutation: createMutation,
        audienceSeatIds,
      }),
      action: createAction,
      mutation: createMutation,
      audienceSeatIds,
    }],
  });
  const breakAction = formalPromiseAction("PROMISE_DELIVER_COPY_BREAK", "break");
  const breakMutation = {
    ...createMutation,
    operation: "BREAK" as const,
    sourceActionId: breakAction.actionId,
  };
  const prior = [opened, createEvent!];
  const [breakEvent] = buildWorkingLedgerEvents({
    key: { runId: RUN_ID, chapterRuntimeId: "runtime-N1" },
    chapterId: "N1",
    previousEvents: prior,
    payloads: [{
      eventType: "FORMAL_COMMITMENT_APPLIED",
      routeHash: opened.payload.routeHash,
      inputFingerprint: computePressureFormalCommitmentFingerprintV1({
        routeHash: opened.payload.routeHash,
        action: breakAction,
        mutation: breakMutation,
        audienceSeatIds,
      }),
      action: breakAction,
      mutation: breakMutation,
      audienceSeatIds,
    }],
  });
  const events = [...prior, breakEvent!];
  projectWorkingLedger(events);
  return { events, breakEvent: breakEvent! };
}

function formalPromiseAction(actionType: string, suffix: string): DecisionActionV1 {
  const payload: CanonicalJsonObject = { promiseId: "promise-ledger-1", operation: suffix };
  const base = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: `action-formal-${suffix}`,
    runId: RUN_ID,
    chapterRuntimeId: "runtime-N1",
    chapterId: "N1" as const,
    decisionPointId: "decision-N1",
    seatId: "zhejiang_governor" as const,
    actionOrdinal: suffix === "create" ? 1 : 2,
    actionRevision: 1,
    controlEpoch: 1,
    expectedWorkingRevision: 0,
    status: "SEALED" as const,
    actionType,
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey: `idempotency-formal-${suffix}`,
  };
  const requested = { ...base, requestFingerprint: computeDecisionActionRequestFingerprint(base) };
  return { ...requested, sealedHash: sha256Canonical(requested) };
}

function realN1ChapterRecord() {
  const loaded = loadSangtianPressureChapterPackageV1();
  const initialWorld = compileInitialWorldState(loaded);
  const { stateHash: _initialStateHash, ...initialWorldWithoutHash } = initialWorld;
  void _initialStateHash;
  const worldWithoutHash = {
    ...initialWorldWithoutHash,
    factValues: {
      ...initialWorld.factValues,
      "chapter.N1.outcome_band": null,
    },
  };
  const baseWorld = {
    ...worldWithoutHash,
    stateHash: sha256Canonical(worldWithoutHash),
  };
  const ledger = ledgerFixture("N1", { withBeat: false, defaultOnly: false });
  const projection = projectWorkingLedger(ledger.events);
  const chapter = loaded.content.chapters.find((candidate) => candidate.chapterId === "N1")!;
  const inputWithoutHash = {
    schemaVersion: "sangtian_chapter_settlement_input_v1" as const,
    runId: RUN_ID,
    chapterRuntimeId: "runtime-N1",
    chapterId: "N1" as const,
    baseWorldSequence: 0,
    baseWorldStateHash: baseWorld.stateHash,
    runRouteHash: digest("route:N1"),
    previousFrozenHash: digest("genesis"),
    decisionLedgerHash: projection.headHash,
    finalWorkingStateHash: projection.stateHash,
    sealedDecisionActionIds: ledger.actions.map((item) => item.actionId).sort(),
    reservationLedgerHash: sha256Canonical([]),
    contentPolicyVersion: chapter.settlementPolicy.policyVersion,
    contentPolicyHash: sha256Canonical(chapter.settlementPolicy),
    settlementContractVersion: "pressure-settlement-contract-1.0.0",
    settlementContractHash: digest("settlement-contract"),
  };
  const sealedInput = { ...inputWithoutHash, inputHash: sha256Canonical(inputWithoutHash) };
  const closeFence = sealChapterCloseFenceV1({
    schemaVersion: "pressure_chapter_close_fence_v1",
    runId: RUN_ID,
    chapterRuntimeId: "runtime-N1",
    chapterId: "N1",
    lifecycleState: "CHAPTER_SETTLING",
    closedWorkingRevision: 0,
    observedWorkingRevision: 0,
    closedWorkingStateHash: projection.stateHash,
    observedWorkingStateHash: projection.stateHash,
    closedDecisionLedgerHash: projection.headHash,
    observedDecisionLedgerHash: projection.headHash,
    closedActionCount: ledger.actions.length,
    observedActionCount: ledger.actions.length,
    baseWorldSequenceAtClose: 0,
    observedWorldSequence: 0,
    baseWorldStateHashAtClose: baseWorld.stateHash,
    observedWorldStateHash: baseWorld.stateHash,
    runRouteHashAtClose: sealedInput.runRouteHash,
    previousFrozenHashAtClose: sealedInput.previousFrozenHash,
    reservationLedgerHashAtClose: sealedInput.reservationLedgerHash,
    contentPolicyVersionAtClose: sealedInput.contentPolicyVersion,
    contentPolicyHashAtClose: sealedInput.contentPolicyHash,
    settlementContractVersionAtClose: sealedInput.settlementContractVersion,
    settlementContractHashAtClose: sealedInput.settlementContractHash,
  });
  const source = sealChapterSettlementSourceV1({
    schemaVersion: "pressure_chapter_settlement_source_v1",
    closeFence,
    sealedInput,
    settlementMaterial: {
      seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
        seatId,
        requirement: "REQUIRED" as const,
        completion: "SEALED_ACTIONS" as const,
        defaultCodes: [],
      })),
      resources: Object.entries(baseWorld.resources).map(([resourceId, quantity]) => ({
        resourceId,
        quantity,
        version: 0,
      })),
      actions: ledger.actions.map((item) => ({
        actionId: item.actionId,
        decisionPointId: item.decisionPointId,
        seatId: item.seatId,
        source: "HUMAN" as const,
        actionType: item.actionType,
        payload: item.payload,
        resourceCommitments: [],
        evidenceRefs: [],
      })),
    },
    baseWorldState: baseWorld,
  });
  const settlement = evaluateContentOwnedChapterPolicyV1({
    settlementInput: source.sealedInput,
    currentWorldState: baseWorld,
    settlementFacts: {
      evacuationCoveragePct: 80,
      criticalWeirsSecuredCount: 2,
      verifiedBreachRecordCount: 1,
      disasterSeverity: 1,
    },
    package: loaded,
  });
  const idempotencyKey = "settle-a-emotion-N1";
  const command = {
    authorityTrigger: "CHAPTER_CLOSE" as const,
    runId: RUN_ID,
    chapterRuntimeId: "runtime-N1",
    idempotencyKey,
    requestFingerprint: computeChapterSettlementRequestFingerprintV1({
      runId: RUN_ID,
      chapterRuntimeId: "runtime-N1",
      idempotencyKey,
      sealedInputHash: source.sealedInput.inputHash,
    }),
  };
  return {
    ledger,
    record: buildAtomicChapterCommitRecordV1({
      command,
      source,
      settlement,
      b0SettlementId: "settlement-a-emotion-N1",
    }),
  };
}

function finaleFixture() {
  const genesisHash = digest("finale-genesis");
  let previousHash = genesisHash;
  const bundles: FrozenChapterBundleV1[] = [];
  const chapters: AEmotionFinaleChapterAuthorityV1[] = [];
  for (const [index, chapterId] of CHAPTER_IDS_V1.entries()) {
    const sequence = index + 1;
    const ledger = ledgerFixture(chapterId, { withBeat: false, defaultOnly: false });
    const projection = projectWorkingLedger(ledger.events);
    const world = finaleWorld(sequence);
    const carryWithoutHash = {
      nextChapterId: nextChapterId(chapterId),
      unlockedContentRefs: chapterId === "N7" ? [] : [`content.${nextChapterId(chapterId)}`],
      unresolvedCommitmentRefs: [],
      pendingConsequenceRefs: [],
    };
    const withoutHash = {
      schemaVersion: "sangtian_frozen_chapter_bundle_v1" as const,
      runId: RUN_ID,
      chapterId,
      chapterSequence: sequence as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      baseWorldSequence: sequence - 1,
      committedWorldSequence: sequence,
      previousFrozenHash: previousHash,
      decisionLedgerHash: projection.headHash,
      finalWorkingStateHash: projection.stateHash,
      settlementPolicyVersion: `sangtian.${chapterId}.settlement_v1`,
      worldDelta: { factMutations: [], resourceMutations: [] },
      committedWorldStateHash: world.stateHash,
      frozenWorldState: world,
      causalEdges: [],
      carryForward: {
        ...carryWithoutHash,
        carryForwardHash: sha256Canonical(carryWithoutHash),
      },
    };
    const bundle = { ...withoutHash, bundleHash: sha256Canonical(withoutHash) };
    bundles.push(bundle);
    chapters.push({ bundle, ledgerEvents: ledger.events });
    previousHash = bundle.bundleHash;
  }
  const loaded = loadSangtianPressureChapterPackageV1();
  const policy = compileSangtianContentFinalePolicyV1({
    contentPackageVersion: loaded.manifest.packageVersion,
    contentPackageSha256: loaded.manifest.contentSha256,
  });
  const routeHash = digest("finale-route");
  const inputWithoutHash = {
    schemaVersion: "sangtian_finale_input_v1" as const,
    runId: RUN_ID,
    routeHash,
    runSeed: "seed-a-emotion-finale",
    genesisHash,
    frozenChapterBundles: bundles,
    finalWorldState: bundles[6]!.frozenWorldState,
    causalEdges: [],
    policyVersion: policy.policyVersion,
    policyHash: policy.policyHash,
  };
  const input = validateSangtianFinaleInputV1({
    ...inputWithoutHash,
    inputHash: sha256Canonical(inputWithoutHash),
  });
  const decision = evaluateSangtianPressureFinaleV1({
    input,
    policy,
    decidedAt: COMMITTED_AT,
    idempotencyKey: buildSangtianFinaleIdempotencyKeyV1({
      inputHash: input.inputHash,
      policyHash: policy.policyHash,
      decidedAt: COMMITTED_AT,
    }),
  });
  const terminalResultContext = finaleContext(decision, bundles[6]!, policy.contentPackageVersion, policy.contentPackageSha256, routeHash);
  const record = buildAuthorityFirstTerminalRecordV1({
    idempotencyKey: `terminal:${RUN_ID}`,
    requestFingerprint: digest("terminal-request"),
    input,
    policy,
    decision,
    terminalResultContext,
  });
  return { record, chapters };
}

function finaleWorld(sequence: number): WorldStateV1 {
  const tracksWithoutHash = {
    schemaVersion: "sangtian_track_state_v1" as const,
    values: Object.fromEntries(TRACK_IDS_V1.map((trackId) => [trackId, 0])) as Record<TrackIdV1, number>,
  };
  const knowledgeBySeat = Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const withoutHash = { seatId, knownFactRefs: [], secretRefs: [], disclosedToSeatIds: [] as SeatIdV1[] };
    return [seatId, { ...withoutHash, stateHash: sha256Canonical(withoutHash) }];
  })) as unknown as WorldStateV1["knowledgeBySeat"];
  const seatArcs = Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const withoutHash = {
      seatId,
      arcStage: `stage-${sequence}`,
      publicGoalProgress: sequence,
      privateGoalProgress: sequence,
      gainRefs: [],
      lossRefs: [],
      costRefs: [],
    };
    return [seatId, { ...withoutHash, stateHash: sha256Canonical(withoutHash) }];
  })) as unknown as Record<SeatIdV1, SeatArcStateV1>;
  const withoutHash = {
    schemaVersion: "sangtian_world_state_v1" as const,
    worldSequence: sequence,
    factValues: {},
    resources: {},
    tracks: { ...tracksWithoutHash, stateHash: sha256Canonical(tracksWithoutHash) },
    objects: [],
    knowledgeBySeat,
    evidence: [],
    responsibilities: [],
    seatArcs,
  };
  return { ...withoutHash, stateHash: sha256Canonical(withoutHash) };
}

function finaleContext(
  decision: ReturnType<typeof evaluateSangtianPressureFinaleV1>,
  finalBundle: FrozenChapterBundleV1,
  contentPackageVersion: string,
  contentPackageSha256: string,
  routeHash: string,
): TerminalResultContextV1 {
  const referenceIds = [...new Set([
    ...decision.tracks.flatMap((track) => track.evidenceRefs),
    ...decision.seats.flatMap((seat) => [...seat.gainRefs, ...seat.lossRefs, ...seat.causeRefs]),
    ...decision.objectOutcomeRefs,
    ...decision.evidenceAndResponsibilityRefs,
  ])].sort();
  const references: FrozenResultReferenceV1[] = referenceIds.map((referenceId) => ({
    referenceId,
    kind: decision.objectOutcomeRefs.includes(referenceId) ? "OBJECT" : "RULE",
    title: `Fixture ${referenceId}`,
    summary: `Frozen summary ${referenceId}`,
    sourceRefs: ["fixture.authority"],
    visibility: "PUBLIC",
    authorizedSeatIds: [],
    privateOriginSeatId: null,
    sourceStageId: "N7",
    sourceKind: "CHAPTER_SETTLEMENT",
    chapterSettlementId: finalBundle.bundleHash,
    frozenSourceHash: finalBundle.bundleHash,
    sourceDecisionActionIds: [],
    revealEligible: false,
    revealText: null,
  }));
  const catalogWithoutHash = {
    schemaVersion: "frozen_sangtian_result_catalog_v1" as const,
    locale: "zh-CN" as const,
    worldOutcomes: [{
      outcomeId: decision.worldOutcome.outcomeId,
      sourceRuleRef: "fixture.world.outcome",
      title: "Fixture world outcome",
      verdictLine: "Fixture verdict",
      summary: "Fixture summary",
    }],
    tracks: TRACK_IDS_V1.map((trackId) => ({
      trackId,
      label: `Track ${trackId}`,
      summaries: { LOW: "low", MID: "mid", HIGH: "high" },
    })),
    seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      roleKey: `role.${seatId}`,
      roleName: `Role ${seatId}`,
      verdictLabels: { WIN: "Win", COSTLY_WIN: "Costly win", LOSS: "Loss" },
    })),
    references,
    replayHint: "Replay with different formal actions.",
  };
  const catalog = { ...catalogWithoutHash, catalogHash: sha256Canonical(catalogWithoutHash) };
  const withoutHash = {
    schemaVersion: "terminal_result_context_v1" as const,
    roomId: ROOM_ID,
    runId: RUN_ID,
    worldId: "sangtian" as const,
    participantMode: "MULTIPLAYER" as const,
    completedAt: COMMITTED_AT,
    frozenRoute: PRESSURE_CHAPTER_ROUTE_V1,
    frozenRouteHash: routeHash,
    resultContractRegistryVersion: "result-contract-registry-1.0.0",
    payloadSchemaVersion: "sangtian_pressure_result_v1" as const,
    presentationSchemaVersion: "sangtian_pressure_result_v1" as const,
    rendererKey: "sangtian_pressure_endgame_v1" as const,
    contentPackageVersion,
    contentPackageSha256,
    narrativeProfileVersion: "openovel-pressure-1.0.0",
    catalog,
  };
  return { ...withoutHash, contextHash: sha256Canonical(withoutHash) };
}
