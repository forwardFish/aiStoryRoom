import {
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  validateDecisionActionV1,
  validateDeterministicDefaultPolicyV1,
  validateRunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import type { FormalActionSubmissionPort } from "../orchestrator/contracts";
import type {
  AuthoredChapterContentPort,
  DeterministicDefaultActionPort,
  WorkingProjectionReaderPort,
} from "../orchestrator/contracts";
import {
  canonicalizeWorkingActionIntentV1,
  computeFormalInteractionInputFingerprint,
} from "../interaction/formal-interaction.service";
import { failPressureChapterIntegration } from "./errors";

/**
 * W7/control seam for the reserved system actor. A production implementation
 * must authorize the default against current durable seat control; this
 * adapter never impersonates a player or invents a control epoch.
 */
export interface DeterministicDefaultAuthorityPortV1 {
  authorize(input: Readonly<{
    runId: string;
    routeHash: string;
    chapterRuntimeId: string;
    decisionPointId: string;
    seatId: SeatIdV1;
    reason: "DEADLINE" | "AI_FAILURE";
  }>): Promise<Readonly<{
    subjectId: string;
    controlEpoch: number;
  }> | null>;
}

/**
 * Frozen-content mechanical default. It submits the exact authored default
 * policy through the same FormalAction path as every other authority action.
 */
export class SangtianDeterministicDefaultActionAdapterV1
implements DeterministicDefaultActionPort {
  constructor(
    private readonly content: AuthoredChapterContentPort,
    private readonly working: WorkingProjectionReaderPort,
    private readonly authority: DeterministicDefaultAuthorityPortV1,
    private readonly formal: FormalActionSubmissionPort,
  ) {}

  async submit(
    input: Parameters<DeterministicDefaultActionPort["submit"]>[0],
  ): Promise<{ status: "ACCEPTED" | "REPLAYED"; actionId: string }> {
    const route = validateRunRouteSnapshotV1(input.routeSnapshot);
    const policy = validateDeterministicDefaultPolicyV1(input.policy);
    const descriptor = await this.content.load({
      routeSnapshot: route,
      chapterId: input.chapterId,
    });
    const decision = descriptor.decisions.find(
      (candidate) => candidate.decisionPointId === input.decisionPointId,
    );
    if (!decision || decision.seatRequirements[input.seatId] !== "REQUIRED") {
      invalid("default.decision", "SEAT_OR_DECISION_NOT_REQUIRED");
    }
    const expectedPolicy = input.reason === "DEADLINE"
      ? decision.execution.absenceDefaultPolicy
      : decision.execution.aiFailureDefaultPolicy;
    if (
      policy.policyRef !== expectedPolicy.policyRef
      || policy.actionType !== expectedPolicy.actionType
      || policy.policyHash !== expectedPolicy.policyHash
      || sha256Canonical(policy.payload) !== sha256Canonical(expectedPolicy.payload)
      || !decision.execution.allowedActionTypes.includes(policy.actionType)
    ) {
      invalid("default.policy", "FROZEN_CONTENT_MISMATCH");
    }
    const projection = await this.working.load({
      runId: route.runId,
      chapterRuntimeId: input.chapterRuntimeId,
    });
    if (
      projection.key.runId !== route.runId
      || projection.key.chapterRuntimeId !== input.chapterRuntimeId
      || projection.routeHash !== route.routeHash
      || projection.chapterId !== input.chapterId
      || projection.state.revision !== input.expectedWorkingRevision
      || projection.nextDecisionPin?.decisionPointId !== input.decisionPointId
    ) {
      invalid("default.workingProjection", "STALE_OR_WRONG_DECISION");
    }
    const existing = projection.actionsByIdempotencyKey.get(input.idempotencyKey);
    if (existing) {
      if (
        existing.action.runId !== route.runId
        || existing.action.chapterRuntimeId !== input.chapterRuntimeId
        || existing.action.chapterId !== input.chapterId
        || existing.action.decisionPointId !== input.decisionPointId
        || existing.action.seatId !== input.seatId
        || existing.action.actionType !== policy.actionType
        || sha256Canonical(existing.action.payload) !== sha256Canonical(policy.payload)
      ) {
        invalid("default.idempotencyKey", "REUSED_WITH_DIFFERENT_DEFAULT");
      }
      return { status: "REPLAYED", actionId: existing.action.actionId };
    }
    const actionOrdinal = [...projection.acceptedActions.values()].filter(
      (accepted) =>
        accepted.action.decisionPointId === input.decisionPointId
        && accepted.action.seatId === input.seatId,
    ).length + 1;
    const budget = decision.execution.perSeatActionBudget[input.seatId];
    if (!budget || actionOrdinal > budget) {
      invalid("default.actionOrdinal", "BUDGET_EXCEEDED");
    }
    const system = await this.authority.authorize({
      runId: route.runId,
      routeHash: route.routeHash,
      chapterRuntimeId: input.chapterRuntimeId,
      decisionPointId: input.decisionPointId,
      seatId: input.seatId,
      reason: input.reason,
    });
    if (
      !system
      || !system.subjectId.trim()
      || !Number.isSafeInteger(system.controlEpoch)
      || system.controlEpoch < 1
    ) {
      invalid("default.authority", "SYSTEM_ACTOR_NOT_AUTHORIZED");
    }
    const payload = structuredClone(policy.payload);
    const actionId = `default_${sha256Canonical({
      schemaVersion: "pressure_deterministic_default_identity_v1",
      runId: route.runId,
      chapterRuntimeId: input.chapterRuntimeId,
      decisionPointId: input.decisionPointId,
      seatId: input.seatId,
      policyHash: policy.policyHash,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    })}`;
    const actionBase = {
      schemaVersion: "sangtian_decision_action_v1" as const,
      actionId,
      runId: route.runId,
      chapterRuntimeId: input.chapterRuntimeId,
      chapterId: input.chapterId,
      decisionPointId: input.decisionPointId,
      seatId: input.seatId,
      actionOrdinal,
      actionRevision: 1,
      controlEpoch: system.controlEpoch,
      expectedWorkingRevision: input.expectedWorkingRevision,
      status: "SEALED" as const,
      actionType: policy.actionType,
      payload,
      payloadHash: sha256Canonical(payload),
      idempotencyKey: input.idempotencyKey,
    };
    const withRequest = {
      ...actionBase,
      requestFingerprint: computeDecisionActionRequestFingerprint(actionBase),
    };
    const action = validateDecisionActionV1({
      ...withRequest,
      sealedHash: sha256Canonical(withRequest),
    });
    const intent = canonicalizeWorkingActionIntentV1({
      visibility: "PRIVATE",
      targetSeatIds: [],
      evidenceRefs: [],
      resourceReservations: [],
      commitmentMutations: [],
      knowledgeGrants: [],
      seatArcProgress: [],
    });
    const inputFingerprint = computeFormalInteractionInputFingerprint({
      routeSnapshot: route,
      action,
      intent,
    });
    const submitted = await this.formal.submit({
      routeSnapshot: route,
      subjectId: system.subjectId,
      action,
      intent,
      inputFingerprint,
      authorizationContext: {
        reason: input.reason,
        defaultPolicyRef: policy.policyRef,
        defaultPolicyHash: policy.policyHash,
        canonicalActionPayloadHash: action.payloadHash,
      },
    });
    if (
      submitted.event.payload.eventType !== "FORMAL_ACTION_ACCEPTED"
      || submitted.event.payload.action.sealedHash !== action.sealedHash
      || submitted.event.payload.inputFingerprint !== inputFingerprint
    ) {
      invalid("default.formalSubmission", "RECEIPT_MISMATCH");
    }
    return { status: submitted.status, actionId };
  }
}

function invalid(path: string, detail?: string): never {
  return failPressureChapterIntegration(
    "INTEGRATION_CONTENT_MISMATCH",
    path,
    detail,
  );
}
