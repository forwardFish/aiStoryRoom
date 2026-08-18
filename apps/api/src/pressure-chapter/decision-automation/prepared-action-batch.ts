import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  isSha256,
  sha256Canonical,
  validateRunRouteSnapshotV1,
  validateSeatIdV1,
  type SeatIdV1,
} from "@ai-story/shared";
import { loadSangtianPressureChapterBeatAuthoringV1 } from "@ai-story/templates";
import { planBeatSubmitV1 } from "../beat-submit-policy";
import {
  planRecordedActionsV1,
} from "../orchestrator/chapter-orchestrator.service";
import type { ChapterOrchestratorStateV1 } from "../orchestrator/contracts";
import {
  validateOrchestratorStateV1,
  withOrchestratorHashV1,
} from "../orchestrator/validation";
import type {
  FormalActionAcceptedPayloadV1,
  WorkingLedgerEventV1,
  WorkingLedgerProjectionV1,
} from "../working-ledger/contracts";
import {
  appendFormalActionEventsToWorkingLedgerProjection,
  buildWorkingLedgerEventsFromProjection,
} from "../working-ledger/working-ledger";
import type {
  AppendPreparedAutomationActionCommandV1,
  PreparedAutomationActionBatchV1,
  PreparedMcBatchAuthorityV1,
  PreparedNpcDecisionResolutionV1,
  ResolvedBeatSubmitAuthorityV1,
} from "./contracts";

export function createPreparedMcBatchAuthorityV1(input: Readonly<{
  beatSubmit: ResolvedBeatSubmitAuthorityV1;
  npcDecisions: readonly PreparedNpcDecisionResolutionV1[];
}>): PreparedMcBatchAuthorityV1 {
  const body = {
    schemaVersion: "pressure_prepared_mc_batch_authority_v1" as const,
    beatSubmit: structuredClone(input.beatSubmit),
    npcDecisions: input.npcDecisions.map((item) => structuredClone(item)),
  };
  return validatePreparedMcBatchAuthorityV1({
    ...body,
    authorityHash: sha256Canonical(body),
  });
}

export function validatePreparedMcBatchAuthorityV1(
  raw: PreparedMcBatchAuthorityV1,
): PreparedMcBatchAuthorityV1 {
  if (raw?.schemaVersion !== "pressure_prepared_mc_batch_authority_v1") {
    throw new Error("Prepared MC authority schema is invalid");
  }
  validateResolvedBeatSubmitAuthorityV1(raw.beatSubmit);
  const npcDecisions = raw.npcDecisions.map(validatePreparedNpcDecisionResolutionV1);
  const plannedNpcSeats = [...raw.beatSubmit.plan.npcResolutionSeatIds];
  if (
    npcDecisions.length !== plannedNpcSeats.length
    || npcDecisions.some((item, index) => item.seatId !== plannedNpcSeats[index])
  ) throw new Error("Prepared MC NPC decisions do not match MA plan");
  const { authorityHash, ...body } = raw;
  if (!isSha256(authorityHash) || sha256Canonical(body) !== authorityHash) {
    throw new Error("Prepared MC authority hash is invalid");
  }
  return structuredClone({ ...raw, npcDecisions });
}

export function validateResolvedBeatSubmitAuthorityV1(
  raw: ResolvedBeatSubmitAuthorityV1,
): ResolvedBeatSubmitAuthorityV1 {
  if (raw?.schemaVersion !== "pressure_resolved_beat_submit_authority_v1") {
    throw new Error("Prepared MA authority schema is invalid");
  }
  const { inputHash, ...inputBody } = raw.input;
  const expectedPlan = planBeatSubmitV1(raw.input);
  const { authorityHash, ...body } = raw;
  if (
    !isSha256(inputHash)
    || sha256Canonical(inputBody) !== inputHash
    || expectedPlan.planHash !== raw.plan.planHash
    || sha256Canonical(expectedPlan) !== sha256Canonical(raw.plan)
    || !isSha256(authorityHash)
    || sha256Canonical(body) !== authorityHash
  ) throw new Error("Prepared MA authority binding is invalid");
  return structuredClone(raw);
}

export function validatePreparedNpcDecisionResolutionV1(
  raw: PreparedNpcDecisionResolutionV1,
): PreparedNpcDecisionResolutionV1 {
  if (raw?.schemaVersion !== "pressure_prepared_npc_decision_resolution_v1") {
    throw new Error("Prepared NPC decision schema is invalid");
  }
  validateSeatIdV1(raw.seatId, "preparedNpcDecision.seatId");
  const { inputHash, ...inputBody } = raw.input;
  const { resolutionHash, ...resolutionBody } = raw.resolution;
  const { bindingHash, ...bindingBody } = raw;
  if (
    raw.input.schemaVersion !== "sangtian_npc_decision_policy_input_v1"
    || raw.resolution.schemaVersion !== "sangtian_npc_decision_resolution_v1"
    || raw.input.seatId !== raw.seatId
    || raw.resolution.inputHash !== raw.input.inputHash
    || raw.resolution.providerCallCount !== 0
    || !raw.input.eligibleActionTypes.includes(raw.resolution.actionType)
    || !isSha256(inputHash)
    || sha256Canonical(inputBody) !== inputHash
    || !isSha256(resolutionHash)
    || sha256Canonical(resolutionBody) !== resolutionHash
    || !isSha256(bindingHash)
    || sha256Canonical(bindingBody) !== bindingHash
  ) throw new Error("Prepared NPC decision binding is invalid");
  return structuredClone(raw);
}

export function planMcRecordedActionsV1(input: Readonly<{
  state: ChapterOrchestratorStateV1;
  actions: ReadonlyArray<Readonly<{
    seatId: SeatIdV1;
    actionId: string;
    defaultCode: string | null;
    actionBudget: number;
  }>>;
  mcAuthority: PreparedMcBatchAuthorityV1;
}>): ChapterOrchestratorStateV1 {
  const authority = validatePreparedMcBatchAuthorityV1(input.mcAuthority);
  const state = validateOrchestratorStateV1(input.state);
  if (state.phase !== "ACTIVE" || !state.activeDecision) {
    throw new Error("Prepared MC action fold requires ACTIVE decision authority");
  }
  const participants = new Set<SeatIdV1>([
    ...authority.beatSubmit.plan.humanSubmissionSeatIds,
    ...authority.beatSubmit.plan.npcResolutionSeatIds,
  ]);
  const actionSeatIds = input.actions.map((item) => item.seatId);
  if (
    actionSeatIds.length !== participants.size
    || new Set(actionSeatIds).size !== actionSeatIds.length
    || actionSeatIds.some((seatId) => !participants.has(seatId))
  ) throw new Error("Prepared MC actions do not match MA participant plan");

  const activeDecision = structuredClone(state.activeDecision);
  const chapterSeatSummaries = structuredClone(state.chapterSeatSummaries);
  for (const seat of activeDecision.seats) {
    if (participants.has(seat.seatId)) continue;
    if (
      seat.completion === "PENDING"
      && seat.actionCount === 0
      && seat.actionIds.length === 0
    ) {
      seat.requirement = "NOT_REQUIRED";
      seat.completion = "NOT_REQUIRED";
      seat.defaultCode = null;
      const summary = chapterSeatSummaries.find((item) => item.seatId === seat.seatId);
      if (!summary) throw new Error(`MC seat summary is missing: ${seat.seatId}`);
      summary.requirement = "NOT_REQUIRED";
      continue;
    }
    if (
      seat.completion !== "SEALED_ACTIONS"
      && seat.completion !== "DEFAULTED"
      && seat.completion !== "NOT_REQUIRED"
    ) throw new Error(`MA omitted seat has invalid Beat authority: ${seat.seatId}`);
  }

  const newActions = input.actions.filter((item) => {
    const seat = activeDecision.seats.find((candidate) => candidate.seatId === item.seatId);
    if (!seat || seat.requirement !== "REQUIRED") {
      throw new Error(`MA participant seat is not required: ${item.seatId}`);
    }
    if (seat.actionIds.includes(item.actionId)) {
      if (
        seat.completion !== "SEALED_ACTIONS"
        || seat.actionCount !== seat.actionIds.length
      ) throw new Error(`MC replayed action has invalid W4 authority: ${item.actionId}`);
      return false;
    }
    if (
      seat.completion !== "PENDING"
      || seat.actionCount !== 0
      || seat.actionIds.length !== 0
    ) throw new Error(`MC action conflicts with existing W4 authority: ${item.actionId}`);
    return true;
  });
  const { orchestratorHash: _ignored, ...stateBody } = state;
  const effectiveState = withOrchestratorHashV1({
    ...stateBody,
    activeDecision,
    chapterSeatSummaries,
  });
  const recorded = planRecordedActionsV1(effectiveState, newActions, true);
  if (recorded.phase !== "RESOLVING_BEAT") {
    throw new Error("Prepared MC actions did not claim Beat resolution");
  }
  return recorded;
}

export function createPreparedAutomationActionBatchV1(input: Readonly<{
  batchId: string;
  snapshotHash: string;
  routeSnapshot: AppendPreparedAutomationActionCommandV1["command"]["routeSnapshot"];
  chapterRuntimeId: string;
  chapterId: PreparedAutomationActionBatchV1["chapterId"];
  decisionPointId: string;
  expectedOrchestratorRevision: number;
  expectedOrchestratorHash: string;
  expectedWorkingRevision: number;
  expectedWorkingStateHash: string;
  expectedLedgerHeadHash: string;
  expectedSeatAuthorityStateHash: string;
  actions: readonly AppendPreparedAutomationActionCommandV1[];
  chapterDescriptor: PreparedAutomationActionBatchV1["chapterDescriptor"];
  nextOrchestratorState: PreparedAutomationActionBatchV1["nextOrchestratorState"];
  mcAuthority?: PreparedMcBatchAuthorityV1;
  beatPlan: PreparedAutomationActionBatchV1["beatPlan"];
}>): PreparedAutomationActionBatchV1 {
  const route = validateRunRouteSnapshotV1(input.routeSnapshot);
  const actions = canonicalizePreparedAutomationActionsV1(route, input.actions);
  if (!actions.length) throw new Error("Prepared automation batch cannot be empty");
  if (!input.batchId.trim() || !isSha256(input.snapshotHash)) {
    throw new Error("Prepared automation batch identity is invalid");
  }
  if (actions.some((item) => (
    item.command.routeSnapshot.routeHash !== route.routeHash
    || item.command.action.runId !== route.runId
    || item.command.action.chapterRuntimeId !== input.chapterRuntimeId
    || item.command.action.chapterId !== input.chapterId
    || item.command.action.decisionPointId !== input.decisionPointId
    || item.authority.snapshotHash !== input.snapshotHash
    || item.authority.expectedLedgerHeadHash !== input.expectedLedgerHeadHash
  ))) throw new Error("Prepared automation batch authority binding is invalid");
  const mcAuthority = input.mcAuthority
    ? validatePreparedMcBatchAuthorityV1(input.mcAuthority)
    : undefined;
  if (mcAuthority) {
    assertMcBatchBinding(
      mcAuthority,
      actions,
      input.beatPlan,
      input.chapterId,
      input.decisionPointId,
    );
  }
  const body = {
    schemaVersion: "pressure_prepared_automation_action_batch_v1" as const,
    batchId: input.batchId,
    snapshotHash: input.snapshotHash,
    runId: route.runId,
    routeHash: route.routeHash,
    chapterRuntimeId: input.chapterRuntimeId,
    chapterId: input.chapterId,
    decisionPointId: input.decisionPointId,
    expectedOrchestratorRevision: input.expectedOrchestratorRevision,
    expectedOrchestratorHash: input.expectedOrchestratorHash,
    expectedWorkingRevision: input.expectedWorkingRevision,
    expectedWorkingStateHash: input.expectedWorkingStateHash,
    expectedLedgerHeadHash: input.expectedLedgerHeadHash,
    expectedSeatAuthorityStateHash: input.expectedSeatAuthorityStateHash,
    frozenSeatOrder: route.seatIds.map((seatId, index) =>
      validateSeatIdV1(seatId, `routeSnapshot.seatIds[${index}]`)),
    actions,
    chapterDescriptor: structuredClone(input.chapterDescriptor),
    nextOrchestratorState: structuredClone(input.nextOrchestratorState),
    ...(mcAuthority ? { mcAuthority } : {}),
    beatPlan: structuredClone(input.beatPlan),
  };
  return { ...body, batchHash: computePreparedAutomationActionBatchHashV1(body) };
}

function assertMcBatchBinding(
  authority: PreparedMcBatchAuthorityV1,
  actions: readonly AppendPreparedAutomationActionCommandV1[],
  beatPlan: PreparedAutomationActionBatchV1["beatPlan"],
  chapterId: PreparedAutomationActionBatchV1["chapterId"],
  decisionPointId: string,
): void {
  const plan = authority.beatSubmit.plan;
  const participants = new Set<SeatIdV1>([
    ...plan.humanSubmissionSeatIds,
    ...plan.npcResolutionSeatIds,
  ]);
  const actionSeatIds = actions.map((item) => item.command.action.seatId);
  const authoredBeat = loadSangtianPressureChapterBeatAuthoringV1(chapterId).beats.find(
    (candidate) => candidate.beatId === plan.beatId,
  );
  if (
    !authoredBeat
    || authoredBeat.catalogDecisionPointRef !== decisionPointId
    || actions.length !== participants.size
    || new Set(actionSeatIds).size !== actionSeatIds.length
    || actionSeatIds.some((seatId) => !participants.has(seatId))
    || beatPlan.event.payload.eventType !== "BEAT_APPLIED"
    || beatPlan.resolution.decisionPointId !== decisionPointId
    || beatPlan.event.payload.authoredBeatResult.decisionPointId !== decisionPointId
  ) throw new Error("Prepared MC batch does not match MA plan");
  const npcBySeat = new Map(authority.npcDecisions.map((item) => [item.seatId, item]));
  for (const item of actions) {
    const seatId = item.command.action.seatId;
    const npc = npcBySeat.get(seatId);
    if (plan.humanSubmissionSeatIds.includes(seatId)) {
      if (
        item.authority.actorKind !== "HUMAN"
        || item.authority.expectedAiPolicyHash !== null
        || item.authority.expectedNpcResolutionHash != null
      ) throw new Error("Prepared MC human authority is invalid");
      continue;
    }
    const payload = item.command.action.payload as Record<string, unknown>;
    if (
      !npc
      || item.authority.actorKind !== "AI"
      || item.authority.expectedAiPolicyHash !== npc.resolution.policyHash
      || item.authority.expectedNpcResolutionHash !== npc.resolution.resolutionHash
      || payload.source !== "IDENTITY_NPC_DECISION_POLICY"
      || payload.policyRef !== npc.resolution.policyRef
      || payload.policyVersion !== npc.resolution.policyVersion
      || payload.policyHash !== npc.resolution.policyHash
      || payload.identityPolicyRef !== npc.resolution.identityPolicyRef
      || payload.identityPolicyVersion !== npc.resolution.identityPolicyVersion
      || payload.identityPolicyHash !== npc.resolution.identityPolicyHash
      || payload.identityPolicyArtifactSha256
        !== npc.resolution.identityPolicyArtifactSha256
      || payload.resolutionHash !== npc.resolution.resolutionHash
      || payload.inputHash !== npc.input.inputHash
      || payload.providerCallCount !== 0
      || item.command.action.actionType !== npc.resolution.actionType
    ) throw new Error("Prepared MC NPC action is not bound to final MB");
  }
  if (plan.mode === "INTERMEDIATE_ACTION_ONLY") {
    if (
      plan.npcResolutionSeatIds.length !== 0
      || plan.invokeSettlement
      || beatPlan.settlementInput !== null
      || beatPlan.postBeatOrchestratorState.phase !== "ACTIVE"
    ) throw new Error("Intermediate MC batch contains forbidden council authority");
  } else if (
    !plan.invokeSettlement
    || beatPlan.settlementInput === null
    || beatPlan.postBeatOrchestratorState.phase !== "SETTLING"
  ) throw new Error("Final MC batch is missing settlement authority");
}

/** Freezes every batch planner and writer to the route's canonical seat order. */
export function canonicalizePreparedAutomationActionsV1(
  routeSnapshot: AppendPreparedAutomationActionCommandV1["command"]["routeSnapshot"],
  actions: readonly AppendPreparedAutomationActionCommandV1[],
): AppendPreparedAutomationActionCommandV1[] {
  const route = validateRunRouteSnapshotV1(routeSnapshot);
  const seatOrder = new Map(route.seatIds.map((seatId, index) => [seatId, index]));
  return [...actions]
    .map((item) => structuredClone(item))
    .sort((left, right) => (
      requireSeatOrder(seatOrder, left.command.action.seatId)
      - requireSeatOrder(seatOrder, right.command.action.seatId)
    ));
}

export function computePreparedAutomationActionBatchHashV1(
  batch: Omit<PreparedAutomationActionBatchV1, "batchHash">,
): string {
  return sha256Canonical({
    ...batch,
    actions: batch.actions.map((item) => ({
      command: item.command,
      authority: item.authority,
    })),
  });
}

export interface PreparedActionLedgerPlanV1 {
  payloads: FormalActionAcceptedPayloadV1[];
  events: WorkingLedgerEventV1[];
  projection: WorkingLedgerProjectionV1;
}

/** Pure W5 action-event plan over one already validated authority projection. */
export function planPreparedActionLedgerV1(input: Readonly<{
  projection: WorkingLedgerProjectionV1;
  actions: readonly AppendPreparedAutomationActionCommandV1[];
}>): PreparedActionLedgerPlanV1 {
  if (input.actions.length === 0) {
    return {
      payloads: [],
      events: [],
      projection: structuredClone(input.projection),
    };
  }
  const payloads = input.actions.map(({ command }) => ({
    eventType: "FORMAL_ACTION_ACCEPTED" as const,
    routeHash: command.routeSnapshot.routeHash,
    inputFingerprint: command.inputFingerprint,
    action: structuredClone(command.action),
    intent: structuredClone(command.intent),
    audienceSeatIds: formalActionAudience(command.action.seatId, command.intent),
  }));
  if (payloads.length === 0) {
    return {
      payloads: [],
      events: [],
      projection: structuredClone(input.projection),
    };
  }
  const events = buildWorkingLedgerEventsFromProjection({
    projection: input.projection,
    payloads,
  });
  return {
    payloads,
    events,
    projection: appendFormalActionEventsToWorkingLedgerProjection(input.projection, events),
  };
}

function formalActionAudience(
  actorSeatId: AppendPreparedAutomationActionCommandV1["command"]["action"]["seatId"],
  intent: AppendPreparedAutomationActionCommandV1["command"]["intent"],
) {
  if (intent.visibility === "PUBLIC") return [...PRESSURE_CHAPTER_SEAT_IDS_V1];
  if (intent.visibility === "PRIVATE") return [actorSeatId];
  const participants = [
    actorSeatId,
    ...intent.targetSeatIds,
    ...intent.commitmentMutations.flatMap((item) => item.seatIds),
    ...intent.knowledgeGrants.map((item) => item.seatId),
  ];
  return PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) => participants.includes(seatId));
}

function requireSeatOrder(order: ReadonlyMap<string, number>, seatId: string): number {
  const index = order.get(seatId);
  if (index === undefined) {
    throw new Error(`Prepared automation seat is not in frozen route: ${seatId}`);
  }
  return index;
}
