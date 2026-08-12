import {
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  validateDecisionActionV1,
  validateRunRouteSnapshotV1,
  type CanonicalJsonObject,
} from "@ai-story/shared";
import {
  canonicalizeWorkingActionIntentV1,
  computeFormalInteractionInputFingerprint,
} from "../interaction/formal-interaction.service";
import type { SubmitOrchestratedActionCommandV1 } from "../orchestrator/contracts";
import { validateOrchestratorStateV1 } from "../orchestrator/validation";
import type { ServerDecisionWorkingIntentCompilerPortV1 } from "../integration/decision-command.compiler";
import {
  DECISION_AUTOMATION_ERROR_CODES as ERROR,
  failDecisionAutomation,
} from "./errors";
import type {
  AiDecisionAutomationPayloadV1,
  DecisionAutomationCommandCompilerPortV1,
  DecisionAutomationCompilationResultV1,
} from "./contracts";

export function buildDecisionAutomationIdempotencyKeyV1(input: Readonly<{
  runId: string;
  chapterRuntimeId: string;
  decisionPointId: string;
  seatId: string;
  controlEpoch: number;
}>): string {
  return [
    "pressure-ai-action-v1",
    input.runId,
    input.chapterRuntimeId,
    input.decisionPointId,
    input.seatId,
    String(input.controlEpoch),
  ].join(":");
}

/**
 * Server-only compiler for AI controllers. It reuses the exact published
 * WorkingIntent compiler used by public decisions, but accepts no HTTP JSON,
 * custom text, Provider output, or client-supplied rule facts.
 */
export class PressureAiDecisionCommandCompilerV1
implements DecisionAutomationCommandCompilerPortV1 {
  constructor(
    private readonly intents: ServerDecisionWorkingIntentCompilerPortV1,
  ) {}

  compile(
    input: Parameters<DecisionAutomationCommandCompilerPortV1["compile"]>[0],
  ): DecisionAutomationCompilationResultV1 {
    const route = validateRunRouteSnapshotV1(input.routeSnapshot);
    const chapter = validateOrchestratorStateV1(input.chapter);
    const active = chapter.activeDecision;
    if (
      chapter.runId !== route.runId
      || chapter.routeHash !== route.routeHash
      || chapter.phase !== "ACTIVE"
      || !active
      || input.projection.key.runId !== route.runId
      || input.projection.key.chapterRuntimeId !== chapter.chapterRuntimeId
      || input.projection.routeHash !== route.routeHash
      || input.projection.chapterId !== chapter.currentChapterId
      || input.projection.nextDecisionPin?.decisionPointId !== active.decisionPointId
    ) {
      invalid("compiler.context", "ACTIVE_ROUTE_PROJECTION_REQUIRED");
    }
    const seat = active.seats.find(
      (candidate) => candidate.seatId === input.seatAuthority.seatId,
    );
    if (
      !seat
      || seat.requirement !== "REQUIRED"
      || seat.completion !== "PENDING"
      || seat.actionCount !== 0
      || seat.actionIds.length !== 0
    ) {
      invalid("compiler.seat", "PENDING_REQUIRED_SEAT_REQUIRED");
    }
    if (
      !input.seatAuthority.activeControllerId.trim()
      || input.seatAuthority.controlEpoch < 1
      || !/^[a-f0-9]{64}$/.test(input.seatAuthority.submissionFenceToken)
    ) {
      invalid("compiler.seatAuthority", "INVALID_AI_AUTHORITY");
    }
    const idempotencyKey = buildDecisionAutomationIdempotencyKeyV1({
      runId: route.runId,
      chapterRuntimeId: chapter.chapterRuntimeId,
      decisionPointId: active.decisionPointId,
      seatId: seat.seatId,
      controlEpoch: input.seatAuthority.controlEpoch,
    });
    const payload: AiDecisionAutomationPayloadV1 = {
      source: "CONTENT_OWNED_AI_POLICY",
      policyRef: input.selection.policyRef,
      policyVersion: input.selection.policyVersion,
      policyHash: input.selection.policyHash,
      selectionHash: input.selection.selectionHash,
    };
    const payloadHash = sha256Canonical(payload);
    const prior = input.projection.actionsByIdempotencyKey.get(idempotencyKey);
    if (prior) {
      if (
        prior.action.runId !== route.runId
        || prior.action.chapterRuntimeId !== chapter.chapterRuntimeId
        || prior.action.chapterId !== chapter.currentChapterId
        || prior.action.decisionPointId !== active.decisionPointId
        || prior.action.seatId !== seat.seatId
        || prior.action.controlEpoch !== input.seatAuthority.controlEpoch
        || prior.action.actionType !== input.selection.actionType
        || prior.action.payloadHash !== payloadHash
        || sha256Canonical(prior.action.payload) !== payloadHash
      ) {
        invalid("compiler.idempotencyKey", "REUSED_WITH_DIFFERENT_ACTION");
      }
      return {
        kind: "ALREADY_ACCEPTED",
        actionId: prior.action.actionId,
        idempotencyKey,
        inputFingerprint: prior.inputFingerprint,
      };
    }
    const actionId = `action_${sha256Canonical({
      schemaVersion: "pressure_ai_action_identity_v1",
      runId: route.runId,
      chapterRuntimeId: chapter.chapterRuntimeId,
      decisionPointId: active.decisionPointId,
      seatId: seat.seatId,
      controlEpoch: input.seatAuthority.controlEpoch,
      idempotencyKey,
    })}`;
    const actionBase = {
      schemaVersion: "sangtian_decision_action_v1" as const,
      actionId,
      runId: route.runId,
      chapterRuntimeId: chapter.chapterRuntimeId,
      chapterId: chapter.currentChapterId,
      decisionPointId: active.decisionPointId,
      seatId: seat.seatId,
      actionOrdinal: 1,
      actionRevision: 1,
      controlEpoch: input.seatAuthority.controlEpoch,
      expectedWorkingRevision: input.projection.state.revision,
      status: "SEALED" as const,
      actionType: input.selection.actionType,
      payload: payload as CanonicalJsonObject,
      payloadHash,
      idempotencyKey,
    };
    const requestFingerprint = computeDecisionActionRequestFingerprint(actionBase);
    const sealedBase = { ...actionBase, requestFingerprint };
    const action = validateDecisionActionV1({
      ...sealedBase,
      sealedHash: sha256Canonical(sealedBase),
    });
    let intent;
    try {
      intent = canonicalizeWorkingActionIntentV1(this.intents.compile({
        routeHash: route.routeHash,
        chapterRuntimeId: chapter.chapterRuntimeId,
        chapterId: chapter.currentChapterId,
        decisionPointId: active.decisionPointId,
        seatId: seat.seatId,
        actionType: input.selection.actionType,
      }));
    } catch (error) {
      invalid(
        "compiler.workingIntent",
        error instanceof Error ? error.message : "COMPILATION_FAILED",
      );
    }
    const commandWithoutFingerprint = {
      routeSnapshot: route,
      subjectId: input.seatAuthority.activeControllerId,
      action,
      intent,
      nowMs: input.nowMs,
    };
    const command: SubmitOrchestratedActionCommandV1 = {
      ...commandWithoutFingerprint,
      inputFingerprint: computeFormalInteractionInputFingerprint(
        commandWithoutFingerprint,
      ),
    };
    return { kind: "COMMAND", command: structuredClone(command) };
  }
}

function invalid(path: string, detail: string): never {
  return failDecisionAutomation(
    ERROR.COMPILER_INVALID,
    `AI decision command compilation failed at ${path}`,
    { path, detail },
  );
}
