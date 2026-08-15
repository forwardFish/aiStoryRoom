import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  withRunRouteHash,
  type CanonicalJsonObject,
  type DecisionActionV1,
  type RunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  assertPressureChapterDefinition,
  createChapterWorkingState,
} from "../src/pressure-chapter/chapter";
import type { PressureChapterDefinition } from "../src/pressure-chapter/types";
import { WorkingBeatApplicationService } from "../../../apps/api/src/pressure-chapter/working-ledger/beat-application.service";
import type {
  WorkingActionIntentV1,
  WorkingLedgerAppendResultV1,
  WorkingLedgerEventV1,
  WorkingLedgerKeyV1,
  WorkingLedgerPort,
} from "../../../apps/api/src/pressure-chapter/working-ledger/contracts";
import { computeWorkingActionInputFingerprintV1 } from "../../../apps/api/src/pressure-chapter/working-ledger/fingerprint";
import {
  buildWorkingLedgerEvents,
  projectWorkingLedger,
} from "../../../apps/api/src/pressure-chapter/working-ledger/working-ledger";
import { WorkingLedgerService } from "../../../apps/api/src/pressure-chapter/working-ledger/working-ledger.service";

interface ContentDecisionV1 {
  decisionPointKey: string;
  ordinal: number;
  purpose: string;
  beatResolutionPolicy: string;
  closeFactRef: string;
  allowedActionTypes: string[];
}

interface AdaptationActionV1 {
  actionType: string;
  workingKnowledgeFactRef: string | null;
}

interface AdaptationDecisionV1 {
  beatId: string;
  decisionPointId: string;
  activation: {
    requiredPreviousCloseFactRef: string | null;
    closeFactRef: string;
  };
  actions: AdaptationActionV1[];
}

interface CompiledActionBindingV1 {
  workingIntent: WorkingActionIntentV1;
}

const REPOSITORY_ROOT = resolve(__dirname, "../../../");
const loadCjs = createRequire(resolve(REPOSITORY_ROOT, "package.json"));
const CONFIG_ROOT = resolve(
  REPOSITORY_ROOT,
  "packages/templates/config/sangtian/pressure-chapter-v1",
);
const RELEASE_ROOT = resolve(CONFIG_ROOT, "release");
const content = readJson(resolve(CONFIG_ROOT, "content.json"));
const adaptation = readJson(
  resolve(CONFIG_ROOT, "authoring/n1-decision-effects-v1.json"),
);
const effectCompiler = loadCjs(resolve(RELEASE_ROOT, "action-effect-compiler.cjs")) as {
  loadSangtianActionEffectPolicyV1(input: { releaseRoot: string }): unknown;
  compileSangtianActionBindingV1(policy: unknown, input: {
    chapterId: "N1";
    decisionPointKey: string;
    seatId: SeatIdV1;
    actionType: string;
  }): CompiledActionBindingV1;
};
const effectPolicy = effectCompiler.loadSangtianActionEffectPolicyV1({
  releaseRoot: RELEASE_ROOT,
});
const n1 = (content.chapters as Array<Record<string, unknown>>)
  .find((chapter) => chapter.chapterId === "N1") as {
    decisionPoints: ContentDecisionV1[];
    closePolicy: { exitPredicate: { factRef: string } };
  };
const authoredDecisions = adaptation.decisions as AdaptationDecisionV1[];
const ACTOR: SeatIdV1 = "cabinet_finance";
const RUN_ID = "run-n1-multibeat-causality";
const CHAPTER_RUNTIME_ID = "runtime-n1-multibeat-causality";

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function optionId(actionType: string): string {
  return `action.${actionType.toLowerCase()}`;
}

function runtimeDefinition(): PressureChapterDefinition {
  const decisionCount = n1.decisionPoints.length;
  return assertPressureChapterDefinition({
    schemaVersion: "pressure_chapter_definition_v1",
    chapterId: "N1",
    sequence: 1,
    decisionPoints: n1.decisionPoints.map((point, index) => ({
      decisionPointId: point.decisionPointKey,
      kernelId: point.beatResolutionPolicy,
      chapterId: "N1",
      sourceOrder: point.ordinal,
      prompt: point.purpose,
      requirementIds: [],
      priority: { duePressureCount: decisionCount - index },
      options: point.allowedActionTypes.map((actionType, optionIndex) => ({
        optionId: optionId(actionType),
        sourceOrder: optionIndex + 1,
        label: `internal:${actionType}`,
        workingDelta: {
          setFacts: { [point.closeFactRef]: true },
        },
      })),
    })),
    requirementDependencies: [],
  });
}

function routeSnapshot(): RunRouteSnapshotV1 {
  const digest = (label: string): string => sha256Canonical({ label });
  return withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: RUN_ID,
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: "1.0.2",
    contentPackageSha256: digest("content"),
    orchestrationPackageVersion: "sangtian-orchestration-1.0.2",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "pressure-runtime-contract-1.0.2",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "pressure-tests-v1",
    testMatrixSha256: digest("tests"),
    runSeed: "seed-n1-multibeat-causality",
    narrativeProfileVersion: "openovel-pressure-v1",
    featureSetVersion: "pressure-feature-v1",
    resultContractRegistryVersion: "pressure-result-registry-v1",
    participantMode: "SOLO",
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [ACTOR],
    controlTopologyVersion: "pressure-control-v1",
    initialRoleControlSnapshotHash: digest("control"),
  });
}

function sealedAction(input: {
  route: RunRouteSnapshotV1;
  decision: ContentDecisionV1;
  actionType: string;
  revision: number;
  ordinal: number;
}): DecisionActionV1 {
  const payload: CanonicalJsonObject = { optionId: optionId(input.actionType) };
  const body = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: `action-${input.ordinal}-${input.actionType.toLowerCase()}`,
    runId: input.route.runId,
    chapterRuntimeId: CHAPTER_RUNTIME_ID,
    chapterId: "N1" as const,
    decisionPointId: input.decision.decisionPointKey,
    seatId: ACTOR,
    actionOrdinal: input.ordinal,
    actionRevision: 1,
    controlEpoch: 1,
    expectedWorkingRevision: input.revision,
    status: "SEALED" as const,
    actionType: input.actionType,
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey: `idem-${input.ordinal}-${input.actionType.toLowerCase()}`,
  };
  const requested = {
    ...body,
    requestFingerprint: computeDecisionActionRequestFingerprint(body),
  };
  return {
    ...requested,
    sealedHash: sha256Canonical(requested),
  };
}

class MemoryLedger implements WorkingLedgerPort {
  private readonly records = new Map<string, WorkingLedgerEventV1[]>();

  async read(key: WorkingLedgerKeyV1): Promise<WorkingLedgerEventV1[]> {
    return structuredClone(this.records.get(keyOf(key)) ?? []);
  }

  async append(input: {
    key: WorkingLedgerKeyV1;
    expectedHeadHash: string | null;
    events: WorkingLedgerEventV1[];
  }): Promise<WorkingLedgerAppendResultV1> {
    const current = this.records.get(keyOf(input.key)) ?? [];
    if ((current.at(-1)?.eventHash ?? null) !== input.expectedHeadHash) {
      return { status: "HEAD_MISMATCH", events: structuredClone(current) };
    }
    this.records.set(
      keyOf(input.key),
      [...current, ...structuredClone(input.events)],
    );
    return { status: "APPENDED", events: structuredClone(input.events) };
  }
}

function keyOf(key: WorkingLedgerKeyV1): string {
  return `${key.runId}|${key.chapterRuntimeId}`;
}

test("B01-B08 commit action-specific Working knowledge into the durable ledger before advancing the generic next-decision pin", async () => {
  assert.equal(n1.decisionPoints.length, 8);
  assert.equal(authoredDecisions.length, 8);

  const definition = runtimeDefinition();
  const route = routeSnapshot();
  const ledger = new MemoryLedger();
  const key = { runId: RUN_ID, chapterRuntimeId: CHAPTER_RUNTIME_ID };
  await new WorkingLedgerService(ledger).open({
    routeSnapshot: route,
    chapterRuntimeId: CHAPTER_RUNTIME_ID,
    chapterDefinition: definition,
    initialState: createChapterWorkingState({ runId: RUN_ID, chapterId: "N1" }),
  });
  const beatService = new WorkingBeatApplicationService(ledger);
  const committedKnowledgeRefs: string[] = [];

  for (let index = 0; index < n1.decisionPoints.length; index += 1) {
    const decision = n1.decisionPoints[index]!;
    const authored = authoredDecisions[index]!;
    const beforeEvents = await ledger.read(key);
    const before = projectWorkingLedger(beforeEvents);
    assert.equal(before.nextDecisionPin?.decisionPointId, decision.decisionPointKey);
    assert.equal(authored.decisionPointId, decision.decisionPointKey);
    if (index > 0) {
      assert.equal(
        before.state.facts[authored.activation.requiredPreviousCloseFactRef!],
        true,
      );
    }

    const actionType = decision.allowedActionTypes.find(
      (candidate) => candidate !== "DEFAULT_PASS",
    );
    assert.ok(actionType);
    const authoredAction = authored.actions.find(
      (candidate) => candidate.actionType === actionType,
    );
    assert.ok(authoredAction?.workingKnowledgeFactRef);
    const workingFactRef = authoredAction.workingKnowledgeFactRef;
    assert.equal(committedKnowledgeRefs.includes(workingFactRef), false);

    const compiled = effectCompiler.compileSangtianActionBindingV1(effectPolicy, {
      chapterId: "N1",
      decisionPointKey: decision.decisionPointKey,
      seatId: ACTOR,
      actionType,
    });
    const intent = compiled.workingIntent;
    assert.deepEqual(
      intent.knowledgeGrants.map((grant) => grant.seatId),
      PRESSURE_CHAPTER_SEAT_IDS_V1,
    );
    assert.deepEqual(
      [...new Set(intent.knowledgeGrants.flatMap((grant) => grant.factRefs))],
      [workingFactRef],
    );

    const action = sealedAction({
      route,
      decision,
      actionType,
      revision: before.state.revision,
      ordinal: index + 1,
    });
    const actionInputFingerprint = computeWorkingActionInputFingerprintV1({
      routeHash: route.routeHash,
      action,
      intent,
    });
    const [acceptedEvent] = buildWorkingLedgerEvents({
      key,
      chapterId: "N1",
      previousEvents: beforeEvents,
      payloads: [{
        eventType: "FORMAL_ACTION_ACCEPTED",
        routeHash: route.routeHash,
        inputFingerprint: actionInputFingerprint,
        action,
        intent,
        audienceSeatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
      }],
    });
    assert.ok(acceptedEvent);
    const accepted = await ledger.append({
      key,
      expectedHeadHash: before.headHash,
      events: [acceptedEvent],
    });
    assert.equal(accepted.status, "APPENDED");

    const applied = await beatService.apply({
      routeSnapshot: route,
      chapterRuntimeId: CHAPTER_RUNTIME_ID,
      chapterDefinition: definition,
      actionId: action.actionId,
      actionInputFingerprint,
      resolverVersion: "working-beat-n1-multibeat-v1",
    });
    assert.equal(applied.status, "APPLIED");
    assert.equal(
      applied.resolution.workingDelta.knowledgeMutations.length,
      PRESSURE_CHAPTER_SEAT_IDS_V1.length,
    );

    const afterEvents = await ledger.read(key);
    const after = projectWorkingLedger(afterEvents);
    assert.notEqual(after.stateHash, before.stateHash);
    assert.equal(after.state.facts[decision.closeFactRef], true);
    for (const seatId of PRESSURE_CHAPTER_SEAT_IDS_V1) {
      assert.equal(after.knowledgeBySeat.get(seatId)?.includes(workingFactRef), true);
      for (const priorRef of committedKnowledgeRefs) {
        assert.equal(after.knowledgeBySeat.get(seatId)?.includes(priorRef), true);
      }
    }
    committedKnowledgeRefs.push(workingFactRef);

    if (index < n1.decisionPoints.length - 1) {
      assert.equal(
        after.nextDecisionPin?.decisionPointId,
        n1.decisionPoints[index + 1]!.decisionPointKey,
      );
      assert.equal(after.state.facts[n1.closePolicy.exitPredicate.factRef], undefined);
    } else {
      assert.equal(after.nextDecisionPin, null);
      assert.equal(after.state.facts[n1.closePolicy.exitPredicate.factRef], true);
    }

    const eventCount = afterEvents.length;
    const replay = await beatService.apply({
      routeSnapshot: route,
      chapterRuntimeId: CHAPTER_RUNTIME_ID,
      chapterDefinition: definition,
      actionId: action.actionId,
      actionInputFingerprint,
      resolverVersion: "working-beat-n1-multibeat-v1",
    });
    assert.equal(replay.status, "REPLAYED");
    assert.equal((await ledger.read(key)).length, eventCount);
  }

  const finalProjection = projectWorkingLedger(await ledger.read(key));
  assert.equal(finalProjection.nextDecisionPin, null);
  assert.equal(committedKnowledgeRefs.length, 8);
  for (const seatId of PRESSURE_CHAPTER_SEAT_IDS_V1) {
    assert.deepEqual(
      finalProjection.knowledgeBySeat.get(seatId),
      [...committedKnowledgeRefs].sort(),
    );
  }
});
