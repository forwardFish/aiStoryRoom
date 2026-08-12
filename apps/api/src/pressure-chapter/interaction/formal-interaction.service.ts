import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  validateDecisionActionV1,
  validateRunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  FormalActionAcceptedPayloadV1,
  WorkingActionIntentV1,
  WorkingLedgerEventV1,
  WorkingLedgerPort,
  WorkingLedgerProjectionV1,
} from "../working-ledger/contracts";
import {
  buildWorkingLedgerEvents,
  projectWorkingLedger,
} from "../working-ledger/working-ledger";
import {
  canonicalizeWorkingActionIntentV1,
  computeWorkingActionInputFingerprintV1,
} from "../working-ledger/fingerprint";
import type {
  PressureInteractionAccessPort,
  PressureInteractionAccessV1,
  SubmitFormalInteractionCommandV1,
  SubmitFormalInteractionResultV1,
} from "./contracts";
import {
  INTERACTION_ERROR_CODES as ERROR,
  failInteraction,
} from "./errors";

export { canonicalizeWorkingActionIntentV1 };

export function computeFormalInteractionInputFingerprint(
  command: Omit<SubmitFormalInteractionCommandV1, "subjectId" | "inputFingerprint">,
): string {
  return computeWorkingActionInputFingerprintV1({
    routeHash: command.routeSnapshot.routeHash,
    action: command.action,
    intent: command.intent,
  });
}

export class FormalPressureInteractionService {
  constructor(
    private readonly accessPort: PressureInteractionAccessPort,
    private readonly ledgerPort: WorkingLedgerPort,
  ) {}

  async submit(
    raw: SubmitFormalInteractionCommandV1,
  ): Promise<SubmitFormalInteractionResultV1> {
    const route = validateRunRouteSnapshotV1(raw.routeSnapshot);
    const action = validateDecisionActionV1(raw.action);
    const intent = canonicalizeWorkingActionIntentV1(raw.intent);
    validateIntent(intent);
    const command: SubmitFormalInteractionCommandV1 = {
      ...raw,
      routeSnapshot: route,
      action,
      intent,
    };
    const expectedFingerprint = computeFormalInteractionInputFingerprint(command);
    if (command.inputFingerprint !== expectedFingerprint) {
      failInteraction(ERROR.INPUT_FINGERPRINT_MISMATCH);
    }
    if (route.runId !== action.runId) failInteraction(ERROR.CONTEXT_MISMATCH, "route-run");

    const key = { runId: action.runId, chapterRuntimeId: action.chapterRuntimeId };
    const events = await this.ledgerPort.read(key);
    const projection = projectWorkingLedger(events);
    assertProjectionBindings(command, projection);
    const access = await this.accessPort.load({
      subjectId: command.subjectId,
      ...key,
      actionContext: {
        decisionPointId: action.decisionPointId,
        seatId: action.seatId,
        controlEpoch: action.controlEpoch,
        actionType: action.actionType,
        payloadHash: action.payloadHash,
        idempotencyKey: action.idempotencyKey,
      },
      systemDefault: command.authorizationContext,
    });
    const replay = findReplay(command, projection, events);
    if (replay) {
      assertReplayAccess(command, access);
      return { status: "REPLAYED", event: replay };
    }
    assertAccess(command, projection, access);
    assertIntentAccess(command.action.seatId, intent, projection, access);
    const audienceSeatIds = computeAudience(action.seatId, intent);
    const payload: FormalActionAcceptedPayloadV1 = {
      eventType: "FORMAL_ACTION_ACCEPTED",
      routeHash: route.routeHash,
      inputFingerprint: command.inputFingerprint,
      action,
      intent,
      audienceSeatIds,
    };
    const [event] = buildWorkingLedgerEvents({
      key,
      chapterId: action.chapterId,
      previousEvents: events,
      payloads: [payload],
    });
    const appended = await this.ledgerPort.append({
      key,
      expectedHeadHash: projection.headHash,
      events: [event!],
    });
    if (appended.status === "APPENDED") return { status: "ACCEPTED", event: event! };

    const concurrentEvents = await this.ledgerPort.read(key);
    const concurrent = projectWorkingLedger(concurrentEvents);
    const concurrentReplay = findReplay(command, concurrent, concurrentEvents);
    if (concurrentReplay) return { status: "REPLAYED", event: concurrentReplay };
    failInteraction(ERROR.APPEND_CONFLICT);
  }
}

function findReplay(
  command: SubmitFormalInteractionCommandV1,
  projection: WorkingLedgerProjectionV1,
  events: readonly WorkingLedgerEventV1[],
): WorkingLedgerEventV1 | null {
  const prior = projection.actionsByIdempotencyKey.get(command.action.idempotencyKey);
  if (!prior) return null;
  if (
    prior.inputFingerprint !== command.inputFingerprint
    || prior.action.requestFingerprint !== command.action.requestFingerprint
    || prior.action.sealedHash !== command.action.sealedHash
  ) {
    failInteraction(ERROR.IDEMPOTENCY_MISMATCH, command.action.idempotencyKey);
  }
  const event = events.find((candidate) => candidate.eventHash === prior.eventHash);
  if (!event) failInteraction(ERROR.CONTEXT_MISMATCH, "replay-event-missing");
  return structuredClone(event);
}

function assertProjectionBindings(
  command: SubmitFormalInteractionCommandV1,
  projection: WorkingLedgerProjectionV1,
): void {
  const { action, routeSnapshot } = command;
  if (
    projection.key.runId !== action.runId
    || projection.key.chapterRuntimeId !== action.chapterRuntimeId
    || projection.chapterId !== action.chapterId
    || projection.routeHash !== routeSnapshot.routeHash
  ) {
    failInteraction(ERROR.CONTEXT_MISMATCH, "ledger-binding");
  }
}

function assertAccess(
  command: SubmitFormalInteractionCommandV1,
  projection: WorkingLedgerProjectionV1,
  access: PressureInteractionAccessV1,
): void {
  const { action, routeSnapshot } = command;
  if (
    access.routeHash !== routeSnapshot.routeHash
    || access.runId !== action.runId
    || access.chapterRuntimeId !== action.chapterRuntimeId
    || access.chapterId !== action.chapterId
  ) failInteraction(ERROR.ROUTE_MISMATCH);
  if (!access.controlledSeatIds.includes(action.seatId)) {
    failInteraction(ERROR.SEAT_NOT_CONTROLLED, action.seatId);
  }
  if (access.controlEpochBySeat[action.seatId] !== action.controlEpoch) {
    failInteraction(ERROR.CONTROL_EPOCH_MISMATCH, action.seatId);
  }
  if (
    access.workingRevision !== projection.state.revision
    || access.workingStateHash !== projection.stateHash
    || action.expectedWorkingRevision !== projection.state.revision
  ) failInteraction(ERROR.CONTEXT_MISMATCH, "working-state");
  if (
    access.activeDecisionPointId !== action.decisionPointId
    || projection.nextDecisionPin?.decisionPointId !== action.decisionPointId
  ) failInteraction(ERROR.DECISION_NOT_ACTIVE, action.decisionPointId);
  if (!access.allowedActionTypes.includes(action.actionType)) {
    failInteraction(ERROR.ACTION_TYPE_FORBIDDEN, action.actionType);
  }
}

function assertReplayAccess(
  command: SubmitFormalInteractionCommandV1,
  access: PressureInteractionAccessV1,
): void {
  const { action, routeSnapshot } = command;
  if (
    access.routeHash !== routeSnapshot.routeHash
    || access.runId !== action.runId
    || access.chapterRuntimeId !== action.chapterRuntimeId
    || access.chapterId !== action.chapterId
  ) failInteraction(ERROR.ROUTE_MISMATCH, "replay");
  if (!access.controlledSeatIds.includes(action.seatId)) {
    failInteraction(ERROR.SEAT_NOT_CONTROLLED, action.seatId);
  }
  if (access.controlEpochBySeat[action.seatId] !== action.controlEpoch) {
    failInteraction(ERROR.CONTROL_EPOCH_MISMATCH, action.seatId);
  }
}

function assertIntentAccess(
  actorSeatId: SeatIdV1,
  intent: WorkingActionIntentV1,
  projection: WorkingLedgerProjectionV1,
  access: PressureInteractionAccessV1,
): void {
  const allowedSeats = new Set([actorSeatId, ...access.interactableSeatIds]);
  const referencedSeats = [
    ...intent.targetSeatIds,
    ...intent.commitmentMutations.flatMap((item) => item.seatIds),
    ...intent.knowledgeGrants.map((item) => item.seatId),
    ...intent.seatArcProgress.map((item) => item.seatId),
  ];
  if (intent.visibility === "PRIVATE" && referencedSeats.some((seatId) => seatId !== actorSeatId)) {
    failInteraction(ERROR.TARGET_FORBIDDEN, "private-cross-seat");
  }
  for (const seatId of referencedSeats) {
    if (!allowedSeats.has(seatId)) failInteraction(ERROR.TARGET_FORBIDDEN, seatId);
  }
  const visibleEvidence = new Set(access.visibleEvidenceRefs);
  for (const evidenceRef of intent.evidenceRefs) {
    if (!visibleEvidence.has(evidenceRef)) {
      failInteraction(ERROR.EVIDENCE_FORBIDDEN, evidenceRef);
    }
  }
  const pendingCommitmentIds = new Set(
    [...projection.acceptedActions.values()]
      .filter((accepted) => !projection.appliedBeats.has(accepted.action.actionId))
      .flatMap((accepted) => accepted.intent.commitmentMutations.map((item) => item.commitmentId)),
  );
  for (const mutation of intent.commitmentMutations) {
    const current = projection.commitments.get(mutation.commitmentId);
    if (
      (mutation.operation === "CREATE" && (current || pendingCommitmentIds.has(mutation.commitmentId)))
      || (mutation.operation !== "CREATE" && current?.operation !== "CREATE")
    ) failInteraction(ERROR.INVALID_INTENT, `commitment-state:${mutation.commitmentId}`);
  }
  const availability = new Map(
    access.resourceAvailability.map((item) => [item.resourceId, item.availableAmount]),
  );
  const alreadyReserved = new Map<string, number>();
  for (const reservation of projection.pendingReservations.values()) {
    alreadyReserved.set(
      reservation.resourceId,
      (alreadyReserved.get(reservation.resourceId) ?? 0) + reservation.amount,
    );
  }
  const requested = new Map<string, number>();
  for (const reservation of intent.resourceReservations) {
    if (projection.pendingReservations.has(reservation.reservationKey)) {
      failInteraction(ERROR.RESERVATION_DUPLICATE, reservation.reservationKey);
    }
    requested.set(
      reservation.resourceId,
      (requested.get(reservation.resourceId) ?? 0) + reservation.amount,
    );
  }
  for (const [resourceId, amount] of requested) {
    const remaining = (availability.get(resourceId) ?? 0) - (alreadyReserved.get(resourceId) ?? 0);
    if (amount > remaining) failInteraction(ERROR.RESOURCE_UNAVAILABLE, resourceId);
  }
}

function validateIntent(intent: WorkingActionIntentV1): void {
  if (!["PUBLIC", "PARTICIPANTS", "PRIVATE"].includes(intent.visibility)) {
    failInteraction(ERROR.INVALID_INTENT, "visibility");
  }
  const reservationKeys = new Set<string>();
  for (const reservation of intent.resourceReservations) {
    if (
      !reservation.reservationKey.trim()
      || !reservation.resourceId.trim()
      || !Number.isFinite(reservation.amount)
      || reservation.amount <= 0
      || reservationKeys.has(reservation.reservationKey)
    ) failInteraction(ERROR.INVALID_INTENT, "resource-reservation");
    reservationKeys.add(reservation.reservationKey);
  }
  if (new Set(intent.commitmentMutations.map((item) => item.commitmentId)).size
    !== intent.commitmentMutations.length) {
    failInteraction(ERROR.INVALID_INTENT, "commitment-duplicate");
  }
  for (const item of intent.commitmentMutations) {
    if (
      !item.commitmentId.trim()
      || !item.seatIds.length
      || !["CREATE", "FULFILL", "BREAK", "CANCEL"].includes(item.operation)
    ) {
      failInteraction(ERROR.INVALID_INTENT, "commitment");
    }
  }
  if (new Set(intent.knowledgeGrants.map((item) => item.seatId)).size
    !== intent.knowledgeGrants.length) {
    failInteraction(ERROR.INVALID_INTENT, "knowledge-seat-duplicate");
  }
  if (intent.knowledgeGrants.some((item) => (
    !item.factRefs.length || item.factRefs.some((factRef) => !factRef.trim())
  ))) failInteraction(ERROR.INVALID_INTENT, "knowledge-facts");
  if (intent.evidenceRefs.some((evidenceRef) => !evidenceRef.trim())) {
    failInteraction(ERROR.INVALID_INTENT, "evidence-ref");
  }
  if (new Set(intent.seatArcProgress.map((item) => item.seatId)).size
    !== intent.seatArcProgress.length) {
    failInteraction(ERROR.INVALID_INTENT, "arc-seat-duplicate");
  }
  if (intent.seatArcProgress.some((item) => !Number.isFinite(item.progressDelta))) {
    failInteraction(ERROR.INVALID_INTENT, "arc-progress");
  }
}

function computeAudience(
  actorSeatId: SeatIdV1,
  intent: WorkingActionIntentV1,
): SeatIdV1[] {
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
