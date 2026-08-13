import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  type DecisionActionV1,
  type RunRouteSnapshotV1,
} from "@ai-story/shared";
import {
  buildChapterWorkingSet,
  createChapterWorkingState,
  loadSangtianPressureChapterPackageV1,
  pinChapterWorkingSet,
} from "@ai-story/templates";
import type { WorkingActionIntentV1 } from "../working-ledger/contracts";
import { computeWorkingActionInputFingerprintV1 } from "../working-ledger/fingerprint";
import {
  appendBeatEventToWorkingLedgerProjection,
  buildWorkingLedgerEvents,
  projectWorkingLedger,
  workingStateHash,
} from "../working-ledger/working-ledger";
import { workingLedgerProjectionCacheHashV1 } from "../working-ledger/projection-cache";
import { SangtianAuthoredChapterContentAdapterV1 } from "./content.adapters";
import {
  SangtianAuthoritativeBeatCompilerV1,
  planSynchronizedDecisionBeatV1,
  type SangtianAuthoritativeBeatArtifactV1,
} from "./working-ledger.adapters";

const RUN_ID = "run-synchronized-beat-plan";
const CHAPTER_RUNTIME_ID = "runtime-synchronized-beat-plan";
const RESOLVER_VERSION = "resolver-plan-v1";
const ACTOR = "cabinet_finance" as const;
const digest = (label: string): string => sha256Canonical({ label });

test("synchronized Beat plan is deterministic and binds route, policy, resolution, and event hashes", async () => {
  const routeSnapshot = routeFixture();
  const descriptor = await new SangtianAuthoredChapterContentAdapterV1().load({
    routeSnapshot,
    chapterId: "N1",
  });
  const state = createChapterWorkingState({ runId: RUN_ID, chapterId: "N1" });
  const workingSet = buildChapterWorkingSet(descriptor.definition, state);
  assert.ok(workingSet);
  const decision = descriptor.decisions[0]!;
  const action = actionFixture(
    decision.decisionPointId,
    decision.execution.allowedActionTypes[0]!,
  );
  const intent: WorkingActionIntentV1 = {
    visibility: "PRIVATE",
    targetSeatIds: [],
    evidenceRefs: [],
    resourceReservations: [],
    commitmentMutations: [],
    knowledgeGrants: [],
    seatArcProgress: [],
  };
  const inputFingerprint = computeWorkingActionInputFingerprintV1({
    routeHash: routeSnapshot.routeHash,
    action,
    intent,
  });
  const key = { runId: RUN_ID, chapterRuntimeId: CHAPTER_RUNTIME_ID };
  const opened = buildWorkingLedgerEvents({
    key,
    chapterId: "N1",
    previousEvents: [],
    payloads: [{
      eventType: "WORKING_LEDGER_OPENED",
      routeHash: routeSnapshot.routeHash,
      chapterDefinitionHash: sha256Canonical(descriptor.definition),
      initialState: state,
      initialStateHash: workingStateHash(state),
      nextDecisionPin: pinChapterWorkingSet(workingSet),
    }],
  });
  const accepted = buildWorkingLedgerEvents({
    key,
    chapterId: "N1",
    previousEvents: opened,
    payloads: [{
      eventType: "FORMAL_ACTION_ACCEPTED",
      routeHash: routeSnapshot.routeHash,
      inputFingerprint,
      action,
      intent,
      audienceSeatIds: [ACTOR],
    }],
  });
  const previousEvents = [...opened, ...accepted];
  const projection = projectWorkingLedger(previousEvents);
  const compiler = new SangtianAuthoritativeBeatCompilerV1();
  let compiledPolicy: SangtianAuthoritativeBeatArtifactV1 | undefined;
  const planInput = {
    routeSnapshot,
    chapterDefinition: descriptor.definition,
    chapterRuntimeId: CHAPTER_RUNTIME_ID,
    actionIds: [action.actionId],
    resolverVersion: RESOLVER_VERSION,
    previousEvents,
    projection,
    decisionPolicy: {
      compile: (input: Parameters<typeof compiler.compile>[0]) => {
        compiledPolicy = compiler.compile(input);
        return compiledPolicy;
      },
    },
  };

  const first = planSynchronizedDecisionBeatV1(planInput);
  const second = planSynchronizedDecisionBeatV1(planInput);
  assert.deepEqual(second, first);
  assert.equal(first.status, "PLANNED");
  assert.ok(compiledPolicy);

  const expectedActionInputFingerprint = sha256Canonical({
    schemaVersion: "pressure_synchronized_action_inputs_v1",
    actions: [{
      actionId: action.actionId,
      actionType: action.actionType,
      inputFingerprint,
      sealedHash: action.sealedHash,
    }],
  });
  assert.equal(first.actionInputFingerprint, expectedActionInputFingerprint);
  assert.equal(first.commandFingerprint, sha256Canonical({
    schemaVersion: "pressure_synchronized_beat_command_v1",
    routeHash: routeSnapshot.routeHash,
    chapterDefinitionHash: projection.chapterDefinitionHash,
    chapterRuntimeId: CHAPTER_RUNTIME_ID,
    decisionPointId: decision.decisionPointId,
    actionIds: [action.actionId],
    actionInputFingerprint: expectedActionInputFingerprint,
    resolverVersion: RESOLVER_VERSION,
    contentPolicyVersion: compiledPolicy.contentPolicyVersion,
    contentPolicyHash: compiledPolicy.contentPolicyHash,
    beatResolutionPolicy: compiledPolicy.beatResolutionPolicy,
    beatPolicyHash: compiledPolicy.beatPolicyHash,
    actionSetHash: compiledPolicy.actionSetHash,
    authorityBeatArtifactHash: compiledPolicy.artifactHash,
  }));
  const { resolutionHash, ...resolutionBody } = first.resolution;
  assert.equal(resolutionHash, sha256Canonical(resolutionBody));
  const { eventHash, ...eventBody } = first.event;
  assert.equal(eventHash, sha256Canonical(eventBody));
  assert.equal(first.payload.routeHash, routeSnapshot.routeHash);
  assert.deepEqual(first.event.payload, first.payload);
  assert.equal(
    workingLedgerProjectionCacheHashV1(
      appendBeatEventToWorkingLedgerProjection(projection, first.event),
    ),
    workingLedgerProjectionCacheHashV1(
      projectWorkingLedger([...previousEvents, first.event]),
    ),
  );

  const rebound = planSynchronizedDecisionBeatV1({
    ...planInput,
    decisionPolicy: {
      compile: (input) => rebindPolicyHash(compiler.compile(input)),
    },
  });
  assert.equal(rebound.resolution.resolutionHash, first.resolution.resolutionHash);
  assert.notEqual(rebound.commandFingerprint, first.commandFingerprint);
  assert.notEqual(rebound.event.eventHash, first.event.eventHash);
});

function routeFixture(): RunRouteSnapshotV1 {
  const loaded = loadSangtianPressureChapterPackageV1();
  const body = {
    schemaVersion: "pressure_run_route_snapshot_v1" as const,
    runId: RUN_ID,
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: loaded.manifest.packageVersion,
    contentPackageSha256: loaded.manifest.contentSha256,
    orchestrationPackageVersion: "orchestration-plan-v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "runtime-plan-v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "tests-plan-v1",
    testMatrixSha256: digest("tests"),
    runSeed: "synchronized-beat-plan-seed",
    narrativeProfileVersion: "narrative-plan-v1",
    featureSetVersion: "features-plan-v1",
    resultContractRegistryVersion: "results-plan-v1",
    participantMode: "SOLO" as const,
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [ACTOR],
    controlTopologyVersion: "control-plan-v1",
    initialRoleControlSnapshotHash: digest("control"),
  };
  return { ...body, routeHash: sha256Canonical(body) };
}

function actionFixture(
  decisionPointId: string,
  actionType: string,
): DecisionActionV1 {
  const payload = { optionCode: actionType };
  const body = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: "action-synchronized-beat-plan",
    runId: RUN_ID,
    chapterRuntimeId: CHAPTER_RUNTIME_ID,
    chapterId: "N1" as const,
    decisionPointId,
    seatId: ACTOR,
    actionOrdinal: 1,
    actionRevision: 1,
    controlEpoch: 1,
    expectedWorkingRevision: 0,
    status: "SEALED" as const,
    actionType,
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey: "idem-synchronized-beat-plan",
  };
  const withRequest = {
    ...body,
    requestFingerprint: computeDecisionActionRequestFingerprint(body),
  };
  return { ...withRequest, sealedHash: sha256Canonical(withRequest) };
}

function rebindPolicyHash(
  value: SangtianAuthoritativeBeatArtifactV1,
): SangtianAuthoritativeBeatArtifactV1 {
  const { artifactHash: _artifactHash, ...body } = value;
  const reboundBody = { ...body, beatPolicyHash: digest("rebound-policy") };
  return { ...reboundBody, artifactHash: sha256Canonical(reboundBody) };
}
