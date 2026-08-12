import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  type RunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import { createChapterWorkingState } from "@ai-story/templates";
import type { SubmitFormalInteractionCommandV1 } from "../interaction/contracts";
import type {
  AuthoredChapterContentPort,
  AuthoredChapterRuntimeV1,
  WorkingProjectionReaderPort,
} from "../orchestrator/contracts";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import {
  SangtianDeterministicDefaultActionAdapterV1,
  type DeterministicDefaultAuthorityPortV1,
} from "./deterministic-default.adapter";

const ACTOR: SeatIdV1 = "cabinet_finance";

test("deterministic default submits formal interaction with action-bound system authorization context", async () => {
  const routeSnapshot = routeFixture();
  const content = fakeContentPort();
  const descriptor = await content.load({ routeSnapshot, chapterId: "N1" });
  const decision = descriptor.decisions[0]!;
  const projection = projectionFixture(routeSnapshot.routeHash);
  const captured: SubmitFormalInteractionCommandV1[] = [];
  const adapter = new SangtianDeterministicDefaultActionAdapterV1(
    content,
    {
      load: async () => cloneProjection(projection),
    } as WorkingProjectionReaderPort,
    {
      authorize: async () => ({ subjectId: "pressure-ai:seat", controlEpoch: 7 }),
    } as DeterministicDefaultAuthorityPortV1,
    {
      submit: async (command) => {
        captured.push(structuredClone(command));
        return {
          status: "ACCEPTED" as const,
          event: {
            schemaVersion: "pressure_working_ledger_event_v1" as const,
            runId: routeSnapshot.runId,
            chapterRuntimeId: "runtime-n1",
            chapterId: "N1" as const,
            sequence: 2,
            previousEventHash: digest("prev"),
            payload: {
              eventType: "FORMAL_ACTION_ACCEPTED" as const,
              routeHash: routeSnapshot.routeHash,
              inputFingerprint: command.inputFingerprint,
              action: structuredClone(command.action),
              intent: structuredClone(command.intent),
              audienceSeatIds: [ACTOR],
            },
            eventHash: digest("formal-event"),
          },
        };
      },
    },
  );

  const result = await adapter.submit({
    routeSnapshot,
    chapterRuntimeId: "runtime-n1",
    chapterId: "N1",
    decisionPointId: decision.decisionPointId,
    seatId: ACTOR,
    expectedWorkingRevision: 0,
    policy: decision.execution.absenceDefaultPolicy,
    reason: "DEADLINE",
    idempotencyKey: "default-idem-1",
  });
  assert.equal(result.status, "ACCEPTED");
  assert.equal(captured.length, 1);
  assert.equal(captured[0]!.subjectId, "pressure-ai:seat");
  assert.deepEqual(captured[0]!.authorizationContext, {
    reason: "DEADLINE",
    defaultPolicyRef: decision.execution.absenceDefaultPolicy.policyRef,
    defaultPolicyHash: decision.execution.absenceDefaultPolicy.policyHash,
    canonicalActionPayloadHash: captured[0]!.action.payloadHash,
  });
});

function routeFixture(): RunRouteSnapshotV1 {
  const routeBase = {
    schemaVersion: "pressure_run_route_snapshot_v1" as const,
    runId: "run-default-access",
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: "accepted-content-v1",
    contentPackageSha256: digest("content"),
    orchestrationPackageVersion: "accepted-orchestration-v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "accepted-runtime-v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "accepted-tests-v1",
    testMatrixSha256: digest("tests"),
    runSeed: "default-seed",
    narrativeProfileVersion: "accepted-narrative-v1",
    featureSetVersion: "accepted-feature-v1",
    resultContractRegistryVersion: "accepted-result-v1",
    participantMode: "SOLO" as const,
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [ACTOR],
    controlTopologyVersion: "accepted-control-v1",
    initialRoleControlSnapshotHash: digest("control"),
  };
  return { ...routeBase, routeHash: sha256Canonical(routeBase) };
}

function fakeContentPort(): AuthoredChapterContentPort {
  const descriptor: AuthoredChapterRuntimeV1 = {
    schemaVersion: "pressure_authored_chapter_runtime_v1",
    chapterId: "N1",
    definition: {
      schemaVersion: "pressure_chapter_definition_v1",
      chapterId: "N1",
      sequence: 1,
      requirementDependencies: [],
      decisionPoints: [],
    },
    decisions: [{
      decisionPointId: "N1.weir_crisis",
      seatRequirements: Object.fromEntries(
        PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [
          seatId,
          seatId === ACTOR ? "REQUIRED" : "NOT_REQUIRED",
        ]),
      ) as AuthoredChapterRuntimeV1["decisions"][number]["seatRequirements"],
      execution: {
        decisionPointKey: "N1.weir_crisis",
        chapterId: "N1",
        ordinal: 1,
        mode: "SOLO_BEAT",
        purpose: "Fallback default action test fixture",
        requiredSeatIds: [ACTOR],
        allowedActionTypes: ["DEFAULT_PASS"],
        absenceDefaultPolicy: defaultPolicy("deadline-default"),
        aiFailureDefaultPolicy: defaultPolicy("ai-failure-default"),
        perSeatActionBudget: { [ACTOR]: 1 },
        closeCondition: { op: "ALL", clauses: [] },
        deadlinePolicy: null,
        beatResolutionPolicy: "fixture-beat-policy",
        allowedWorkingDeltaTypes: [],
        feedbackVisibilityPolicy: "PRIVATE_ONLY",
        reactionPolicy: {
          enabled: false,
          eligibleSeatIds: [],
          trigger: null,
          maxDepth: 0,
        },
      },
    }],
    chapterClosePolicy: {
      kind: "ALL_AUTHORED_DECISION_POINTS_COMPLETED",
      decisionPointIds: ["N1.weir_crisis"],
    },
    contentPolicyVersion: "content-policy-v1",
    contentPolicyHash: digest("content-policy"),
    settlementContractVersion: "settlement-contract-v1",
    settlementContractHash: digest("settlement-contract"),
    descriptorHash: digest("descriptor"),
  };
  return {
    load: async () => structuredClone(descriptor),
  };
}

function defaultPolicy(policyRef: string) {
  const base = {
    policyRef,
    actionType: "DEFAULT_PASS",
    payload: { reason: "ABSENT" },
  };
  return { ...base, policyHash: sha256Canonical(base) };
}

function projectionFixture(routeHash: string): WorkingLedgerProjectionV1 {
  const state = createChapterWorkingState({ runId: "run-default-access", chapterId: "N1" });
  return {
    key: { runId: "run-default-access", chapterRuntimeId: "runtime-n1" },
    chapterId: "N1",
    routeHash,
    chapterDefinitionHash: digest("chapter-definition"),
    headHash: digest("head"),
    headSequence: 1,
    state,
    stateHash: digest("working-state"),
    nextDecisionPin: {
      schemaVersion: "pressure_decision_pin_v1",
      chapterId: "N1",
      stateRevision: 0,
      stateFingerprint: digest("pin-state"),
      decisionPointId: "N1.weir_crisis",
      kernelId: "kernel-default",
      optionIds: ["DEFAULT_PASS"],
    },
    acceptedActions: new Map(),
    actionsByIdempotencyKey: new Map(),
    appliedBeats: new Map(),
    pendingReservations: new Map(),
    commitments: new Map(),
    evidenceRefsByAction: new Map(),
    knowledgeBySeat: new Map(),
    seatArcProgressBySeat: new Map(),
  };
}

function cloneProjection(value: WorkingLedgerProjectionV1): WorkingLedgerProjectionV1 {
  return {
    ...structuredClone({
      ...value,
      acceptedActions: undefined,
      actionsByIdempotencyKey: undefined,
      appliedBeats: undefined,
      pendingReservations: undefined,
      commitments: undefined,
      evidenceRefsByAction: undefined,
      knowledgeBySeat: undefined,
      seatArcProgressBySeat: undefined,
    }),
    acceptedActions: new Map(value.acceptedActions),
    actionsByIdempotencyKey: new Map(value.actionsByIdempotencyKey),
    appliedBeats: new Map(value.appliedBeats),
    pendingReservations: new Map(value.pendingReservations),
    commitments: new Map(value.commitments),
    evidenceRefsByAction: new Map(value.evidenceRefsByAction),
    knowledgeBySeat: new Map(value.knowledgeBySeat),
    seatArcProgressBySeat: new Map(value.seatArcProgressBySeat),
  } as WorkingLedgerProjectionV1;
}

function digest(label: string): string {
  return sha256Canonical({ label });
}
