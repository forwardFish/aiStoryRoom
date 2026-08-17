import {
  compareCanonicalText,
  sha256Canonical,
  validateBeatResolutionV1,
  validateDecisionActionV1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  type ChapterIdV1,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  AcceptedFormalActionV1,
  AppliedBeatV1,
  WorkingLedgerEventPayloadV1,
  WorkingLedgerEventV1,
  WorkingLedgerKeyV1,
  WorkingLedgerProjectionV1,
} from "./contracts";
import {
  WORKING_LEDGER_ERROR_CODES as ERROR,
  failWorkingLedger,
} from "./errors";
import { computeWorkingActionInputFingerprintV1 } from "./fingerprint";

const HASH_PATTERN = /^[a-f0-9]{64}$/;

export function workingStateHash(state: unknown): string {
  assertWorkingOnly(state, "workingState");
  return sha256Canonical(state);
}

export function buildWorkingLedgerEvents(input: {
  key: WorkingLedgerKeyV1;
  chapterId: ChapterIdV1;
  previousEvents: readonly WorkingLedgerEventV1[];
  payloads: readonly WorkingLedgerEventPayloadV1[];
}): WorkingLedgerEventV1[] {
  const existing = input.previousEvents.length
    ? projectWorkingLedger(input.previousEvents)
    : null;
  if (existing && (
    existing.key.runId !== input.key.runId
    || existing.key.chapterRuntimeId !== input.key.chapterRuntimeId
    || existing.chapterId !== input.chapterId
  )) {
    failWorkingLedger(ERROR.CONTEXT_MISMATCH, "append-context");
  }

  let sequence = existing ? existing.headSequence + 1 : 0;
  let previousEventHash = existing?.headHash ?? null;
  return input.payloads.map((payload) => {
    assertWorkingOnly(payload, `ledgerPayload.${payload.eventType}`);
    const body = {
      schemaVersion: "pressure_working_ledger_event_v1" as const,
      runId: input.key.runId,
      chapterRuntimeId: input.key.chapterRuntimeId,
      chapterId: input.chapterId,
      sequence,
      previousEventHash,
      payload: structuredClone(payload),
    };
    const event: WorkingLedgerEventV1 = {
      ...body,
      eventHash: sha256Canonical(body),
    };
    sequence += 1;
    previousEventHash = event.eventHash;
    return event;
  });
}

/**
 * Builds new immutable events from the validated runtime projection cache.
 * This is intentionally narrower than full replay: it is used only after the
 * caller has authority-fenced the cached projection against the runtime row.
 */
export function buildWorkingLedgerEventsFromProjection(input: {
  projection: WorkingLedgerProjectionV1;
  payloads: readonly WorkingLedgerEventPayloadV1[];
}): WorkingLedgerEventV1[] {
  let sequence = input.projection.headSequence + 1;
  let previousEventHash: string | null = input.projection.headHash;
  return input.payloads.map((payload) => {
    assertWorkingOnly(payload, `ledgerPayload.${payload.eventType}`);
    const body = {
      schemaVersion: "pressure_working_ledger_event_v1" as const,
      runId: input.projection.key.runId,
      chapterRuntimeId: input.projection.key.chapterRuntimeId,
      chapterId: input.projection.chapterId,
      sequence,
      previousEventHash,
      payload: structuredClone(payload),
    };
    const event: WorkingLedgerEventV1 = {
      ...body,
      eventHash: sha256Canonical(body),
    };
    sequence += 1;
    previousEventHash = event.eventHash;
    return event;
  });
}

/** Applies only FORMAL_ACTION_ACCEPTED events to an already validated cache. */
export function appendFormalActionEventsToWorkingLedgerProjection(
  source: WorkingLedgerProjectionV1,
  events: readonly WorkingLedgerEventV1[],
): WorkingLedgerProjectionV1 {
  const projection = cloneProjection(source);
  let expectedSequence = projection.headSequence + 1;
  let expectedPreviousHash: string | null = projection.headHash;
  for (const event of events) {
    if (
      event.schemaVersion !== "pressure_working_ledger_event_v1"
      || event.runId !== projection.key.runId
      || event.chapterRuntimeId !== projection.key.chapterRuntimeId
      || event.chapterId !== projection.chapterId
      || event.sequence !== expectedSequence
      || event.previousEventHash !== expectedPreviousHash
      || event.payload.eventType !== "FORMAL_ACTION_ACCEPTED"
    ) failWorkingLedger(ERROR.CORRUPT, `incremental-event-envelope:${expectedSequence}`);
    const body = {
      schemaVersion: event.schemaVersion,
      runId: event.runId,
      chapterRuntimeId: event.chapterRuntimeId,
      chapterId: event.chapterId,
      sequence: event.sequence,
      previousEventHash: event.previousEventHash,
      payload: event.payload,
    };
    if (sha256Canonical(body) !== event.eventHash) {
      failWorkingLedger(ERROR.CORRUPT, `incremental-event-hash:${expectedSequence}`);
    }
    assertWorkingOnly(event.payload, `ledger[${expectedSequence}].payload`);
    if (event.payload.routeHash !== projection.routeHash) {
      failWorkingLedger(ERROR.CONTEXT_MISMATCH, "incremental-action-route");
    }
    const action = validateDecisionActionV1(event.payload.action);
    const multiplayerSeatDecision = event.payload.decisionAuthorityMode === "MULTIPLAYER_SEAT";
    if (
      action.runId !== event.runId
      || action.chapterRuntimeId !== event.chapterRuntimeId
      || action.chapterId !== event.chapterId
      || action.expectedWorkingRevision !== projection.state.revision
      || (!multiplayerSeatDecision
        && projection.nextDecisionPin?.decisionPointId !== action.decisionPointId)
    ) failWorkingLedger(ERROR.CONTEXT_MISMATCH, `incremental-action:${action.actionId}`);
    if (
      !event.payload.audienceSeatIds.includes(action.seatId)
      || new Set(event.payload.audienceSeatIds).size !== event.payload.audienceSeatIds.length
      || event.payload.audienceSeatIds.some((seatId) => !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(seatId))
    ) failWorkingLedger(ERROR.CORRUPT, `incremental-action-audience:${action.actionId}`);
    if (projection.acceptedActions.has(action.actionId)) {
      failWorkingLedger(ERROR.ACTION_DUPLICATE, action.actionId);
    }
    if (projection.actionsByIdempotencyKey.has(action.idempotencyKey)) {
      failWorkingLedger(ERROR.IDEMPOTENCY_MISMATCH, action.idempotencyKey);
    }
    if (
      !HASH_PATTERN.test(event.payload.inputFingerprint)
      || computeWorkingActionInputFingerprintV1({
        routeHash: projection.routeHash,
        action,
        intent: event.payload.intent,
      }) !== event.payload.inputFingerprint
    ) failWorkingLedger(ERROR.CORRUPT, `incremental-action-input:${action.actionId}`);
    const accepted: AcceptedFormalActionV1 = {
      action: structuredClone(action),
      routeHash: projection.routeHash,
      inputFingerprint: event.payload.inputFingerprint,
      intent: structuredClone(event.payload.intent),
      audienceSeatIds: [...event.payload.audienceSeatIds],
      eventHash: event.eventHash,
    };
    projection.acceptedActions.set(action.actionId, accepted);
    projection.actionsByIdempotencyKey.set(action.idempotencyKey, accepted);
    projection.evidenceRefsByAction.set(action.actionId, [...event.payload.intent.evidenceRefs]);
    for (const reservation of event.payload.intent.resourceReservations) {
      if (projection.pendingReservations.has(reservation.reservationKey)) {
        failWorkingLedger(ERROR.CORRUPT, `incremental-reservation:${reservation.reservationKey}`);
      }
      projection.pendingReservations.set(reservation.reservationKey, {
        ...structuredClone(reservation),
        seatId: action.seatId,
        sourceActionId: action.actionId,
        status: "PENDING",
      });
    }
    projection.headHash = event.eventHash;
    projection.headSequence = event.sequence;
    expectedPreviousHash = event.eventHash;
    expectedSequence += 1;
  }
  return projection;
}

/** Applies one BEAT_APPLIED event to an authority-fenced projection cache. */
export function appendBeatEventToWorkingLedgerProjection(
  source: WorkingLedgerProjectionV1,
  event: WorkingLedgerEventV1,
): WorkingLedgerProjectionV1 {
  const projection = cloneProjection(source);
  if (
    event.schemaVersion !== "pressure_working_ledger_event_v1"
    || event.runId !== projection.key.runId
    || event.chapterRuntimeId !== projection.key.chapterRuntimeId
    || event.chapterId !== projection.chapterId
    || event.sequence !== projection.headSequence + 1
    || event.previousEventHash !== projection.headHash
    || event.payload.eventType !== "BEAT_APPLIED"
  ) failWorkingLedger(ERROR.CORRUPT, `incremental-beat-envelope:${event.sequence}`);
  const body = {
    schemaVersion: event.schemaVersion,
    runId: event.runId,
    chapterRuntimeId: event.chapterRuntimeId,
    chapterId: event.chapterId,
    sequence: event.sequence,
    previousEventHash: event.previousEventHash,
    payload: event.payload,
  };
  if (sha256Canonical(body) !== event.eventHash) {
    failWorkingLedger(ERROR.CORRUPT, `incremental-beat-hash:${event.sequence}`);
  }
  assertWorkingOnly(event.payload, `ledger[${event.sequence}].payload`);
  if (event.payload.routeHash !== projection.routeHash) {
    failWorkingLedger(ERROR.CONTEXT_MISMATCH, "incremental-beat-route");
  }
  const actions = event.payload.beatResolution.sealedActionIds.map((actionId) => {
    const accepted = projection.acceptedActions.get(actionId);
    if (!accepted) failWorkingLedger(ERROR.ACTION_MISSING, actionId);
    if (projection.appliedBeats.has(actionId)) {
      failWorkingLedger(ERROR.ACTION_ALREADY_RESOLVED, actionId);
    }
    return accepted.action;
  });
  const beat = validateBeatResolutionV1(event.payload.beatResolution, actions);
  if (
    beat.runId !== event.runId
    || beat.chapterRuntimeId !== event.chapterRuntimeId
    || beat.baseWorkingRevision !== projection.state.revision
    || beat.inputWorkingStateHash !== projection.stateHash
    || event.payload.stateAfter.runId !== event.runId
    || event.payload.stateAfter.chapterId !== event.chapterId
    || event.payload.stateAfter.revision !== beat.committedWorkingRevision
  ) failWorkingLedger(ERROR.REVISION_MISMATCH, beat.resolutionHash);
  const afterHash = workingStateHash(event.payload.stateAfter);
  if (afterHash !== event.payload.stateAfterHash) {
    failWorkingLedger(ERROR.CORRUPT, "incremental-beat-state-after-hash");
  }
  for (const mutation of beat.reservationMutations) {
    const pending = projection.pendingReservations.get(mutation.reservationKey);
    if (
      mutation.operation === "RESERVE"
      && (!pending
        || pending.sourceActionId !== mutation.sourceActionId
        || pending.resourceId !== mutation.resourceId
        || pending.amount !== mutation.amount
        || pending.seatId !== mutation.seatId)
    ) failWorkingLedger(ERROR.CORRUPT, `incremental-reservation:${mutation.reservationKey}`);
    if (mutation.operation !== "RESERVE" && !pending) {
      failWorkingLedger(ERROR.CORRUPT, `incremental-reservation-missing:${mutation.reservationKey}`);
    }
    if (mutation.operation === "RESERVE") {
      projection.pendingReservations.set(mutation.reservationKey, { ...pending!, status: "RESERVED" });
    } else {
      projection.pendingReservations.delete(mutation.reservationKey);
    }
  }
  for (const mutation of beat.workingDelta.commitmentMutations) {
    projection.commitments.set(mutation.commitmentId, structuredClone(mutation));
  }
  for (const mutation of beat.workingDelta.knowledgeMutations) {
    const known = new Set(projection.knowledgeBySeat.get(mutation.seatId) ?? []);
    mutation.addFactRefs.forEach((factRef) => known.add(factRef));
    mutation.removeFactRefs.forEach((factRef) => known.delete(factRef));
    projection.knowledgeBySeat.set(mutation.seatId, [...known].sort(compareCanonicalText));
  }
  for (const mutation of beat.workingDelta.seatArcWorkingMutations) {
    projection.seatArcProgressBySeat.set(
      mutation.seatId,
      (projection.seatArcProgressBySeat.get(mutation.seatId) ?? 0) + mutation.progressDelta,
    );
  }
  const applied: AppliedBeatV1 = {
    actionIds: [...beat.sealedActionIds],
    commandFingerprint: event.payload.commandFingerprint,
    actionInputFingerprint: event.payload.actionInputFingerprint,
    resolution: structuredClone(beat),
    eventHash: event.eventHash,
  };
  for (const actionId of beat.sealedActionIds) projection.appliedBeats.set(actionId, applied);
  projection.state = structuredClone(event.payload.stateAfter);
  projection.stateHash = afterHash;
  projection.nextDecisionPin = structuredClone(event.payload.nextDecisionPin);
  projection.headHash = event.eventHash;
  projection.headSequence = event.sequence;
  return projection;
}

export function projectWorkingLedger(
  events: readonly WorkingLedgerEventV1[],
): WorkingLedgerProjectionV1 {
  if (!events.length) failWorkingLedger(ERROR.EMPTY);

  let previousHash: string | null = null;
  let routeHash = "";
  let chapterDefinitionHash = "";
  let state = null as WorkingLedgerProjectionV1["state"] | null;
  let stateHash = "";
  let nextDecisionPin = null as WorkingLedgerProjectionV1["nextDecisionPin"];
  const acceptedActions = new Map<string, AcceptedFormalActionV1>();
  const actionsByIdempotencyKey = new Map<string, AcceptedFormalActionV1>();
  const commitmentActionsByIdempotencyKey = new Map<string, {
    action: ReturnType<typeof validateDecisionActionV1>;
    inputFingerprint: string;
    eventHash: string;
    mutation: Extract<WorkingLedgerEventPayloadV1, { eventType: "FORMAL_COMMITMENT_APPLIED" }>["mutation"];
  }>();
  const appliedBeats = new Map<string, AppliedBeatV1>();
  const pendingReservations = new Map<
    string,
    WorkingLedgerProjectionV1["pendingReservations"] extends Map<string, infer V> ? V : never
  >();
  const commitments = new Map<string, WorkingLedgerProjectionV1["commitments"] extends Map<string, infer V> ? V : never>();
  const evidenceRefsByAction = new Map<string, string[]>();
  const knowledgeBySeat = new Map<SeatIdV1, string[]>();
  const seatArcProgressBySeat = new Map<SeatIdV1, number>();

  const first = events[0]!;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    assertEventEnvelope(event, first, index, previousHash);
    assertWorkingOnly(event.payload, `ledger[${index}].payload`);

    if (event.payload.eventType === "WORKING_LEDGER_OPENED") {
      if (index !== 0 || state) failWorkingLedger(ERROR.ALREADY_OPEN);
      if (!HASH_PATTERN.test(event.payload.routeHash)
        || !HASH_PATTERN.test(event.payload.chapterDefinitionHash)) {
        failWorkingLedger(ERROR.CORRUPT, "open-hash");
      }
      if (
        event.payload.initialState.runId !== event.runId
        || event.payload.initialState.chapterId !== event.chapterId
        || event.payload.initialState.revision !== 0
      ) {
        failWorkingLedger(ERROR.CONTEXT_MISMATCH, "initial-state");
      }
      const computed = workingStateHash(event.payload.initialState);
      if (computed !== event.payload.initialStateHash) {
        failWorkingLedger(ERROR.CORRUPT, "initial-state-hash");
      }
      routeHash = event.payload.routeHash;
      chapterDefinitionHash = event.payload.chapterDefinitionHash;
      state = structuredClone(event.payload.initialState);
      stateHash = computed;
      nextDecisionPin = structuredClone(event.payload.nextDecisionPin);
    } else if (event.payload.eventType === "FORMAL_ACTION_ACCEPTED") {
      if (!state) failWorkingLedger(ERROR.CORRUPT, "action-before-open");
      if (event.payload.routeHash !== routeHash) {
        failWorkingLedger(ERROR.CONTEXT_MISMATCH, "action-route");
      }
      const action = validateDecisionActionV1(event.payload.action);
      const multiplayerSeatDecision = event.payload.decisionAuthorityMode === "MULTIPLAYER_SEAT";
      if (
        action.runId !== event.runId
        || action.chapterRuntimeId !== event.chapterRuntimeId
        || action.chapterId !== event.chapterId
      ) {
        failWorkingLedger(ERROR.CONTEXT_MISMATCH, "action-context");
      }
      if (action.expectedWorkingRevision !== state.revision) {
        failWorkingLedger(ERROR.REVISION_MISMATCH, action.actionId);
      }
      if (!multiplayerSeatDecision
        && nextDecisionPin?.decisionPointId !== action.decisionPointId) {
        failWorkingLedger(ERROR.CONTEXT_MISMATCH, `action-decision:${action.actionId}`);
      }
      if (
        !event.payload.audienceSeatIds.includes(action.seatId)
        || new Set(event.payload.audienceSeatIds).size !== event.payload.audienceSeatIds.length
        || event.payload.audienceSeatIds.some((seatId) => (
          !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(seatId)
        ))
      ) failWorkingLedger(ERROR.CORRUPT, `action-audience:${action.actionId}`);
      if (acceptedActions.has(action.actionId)) {
        failWorkingLedger(ERROR.ACTION_DUPLICATE, action.actionId);
      }
      const priorKey = actionsByIdempotencyKey.get(action.idempotencyKey);
      if (priorKey) failWorkingLedger(ERROR.IDEMPOTENCY_MISMATCH, action.idempotencyKey);
      const accepted: AcceptedFormalActionV1 = {
        action: structuredClone(action),
        routeHash,
        inputFingerprint: event.payload.inputFingerprint,
        intent: structuredClone(event.payload.intent),
        audienceSeatIds: [...event.payload.audienceSeatIds],
        eventHash: event.eventHash,
      };
      if (
        !HASH_PATTERN.test(event.payload.inputFingerprint)
        || computeWorkingActionInputFingerprintV1({
          routeHash,
          action,
          intent: event.payload.intent,
        }) !== event.payload.inputFingerprint
      ) failWorkingLedger(ERROR.CORRUPT, `action-input-fingerprint:${action.actionId}`);
      acceptedActions.set(action.actionId, accepted);
      actionsByIdempotencyKey.set(action.idempotencyKey, accepted);
      evidenceRefsByAction.set(action.actionId, [...event.payload.intent.evidenceRefs]);
      for (const reservation of event.payload.intent.resourceReservations) {
        if (pendingReservations.has(reservation.reservationKey)) {
          failWorkingLedger(ERROR.CORRUPT, `reservation:${reservation.reservationKey}`);
        }
        pendingReservations.set(reservation.reservationKey, {
          ...structuredClone(reservation),
          seatId: action.seatId,
          sourceActionId: action.actionId,
          status: "PENDING",
        });
      }
    } else if (event.payload.eventType === "FORMAL_COMMITMENT_APPLIED") {
      if (!state) failWorkingLedger(ERROR.CORRUPT, "commitment-before-open");
      if (event.payload.routeHash !== routeHash) {
        failWorkingLedger(ERROR.CONTEXT_MISMATCH, "commitment-route");
      }
      const action = validateDecisionActionV1(event.payload.action);
      const mutation = event.payload.mutation;
      if (
        action.runId !== event.runId
        || action.chapterRuntimeId !== event.chapterRuntimeId
        || action.chapterId !== event.chapterId
        || action.expectedWorkingRevision !== state.revision
        || mutation.sourceActionId !== action.actionId
        || !mutation.commitmentId.trim()
        || !["CREATE", "FULFILL", "BREAK", "CANCEL"].includes(mutation.operation)
        || mutation.seatIds.length < 2
        || new Set(mutation.seatIds).size !== mutation.seatIds.length
        || mutation.seatIds.some((seatId) => !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(seatId))
        || !mutation.seatIds.includes(action.seatId)
        || !event.payload.audienceSeatIds.includes(action.seatId)
        || new Set(event.payload.audienceSeatIds).size !== event.payload.audienceSeatIds.length
        || event.payload.audienceSeatIds.some((seatId) => !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(seatId))
      ) failWorkingLedger(ERROR.CORRUPT, `formal-commitment:${action.actionId}`);
      const expectedFingerprint = sha256Canonical({
        commandType: "APPLY_PRESSURE_FORMAL_COMMITMENT_V1",
        routeHash,
        actionRequestFingerprint: action.requestFingerprint,
        sealedActionHash: action.sealedHash,
        mutation,
        audienceSeatIds: event.payload.audienceSeatIds,
      });
      if (event.payload.inputFingerprint !== expectedFingerprint) {
        failWorkingLedger(ERROR.CORRUPT, `formal-commitment-fingerprint:${action.actionId}`);
      }
      if (commitmentActionsByIdempotencyKey.has(action.idempotencyKey)) {
        failWorkingLedger(ERROR.IDEMPOTENCY_MISMATCH, action.idempotencyKey);
      }
      const current = commitments.get(mutation.commitmentId);
      if (
        (mutation.operation === "CREATE" && current)
        || (mutation.operation !== "CREATE" && current?.operation !== "CREATE")
      ) failWorkingLedger(ERROR.CORRUPT, `formal-commitment-state:${mutation.commitmentId}`);
      commitments.set(mutation.commitmentId, structuredClone(mutation));
      evidenceRefsByAction.set(action.actionId, []);
      commitmentActionsByIdempotencyKey.set(action.idempotencyKey, {
        action: structuredClone(action),
        inputFingerprint: event.payload.inputFingerprint,
        eventHash: event.eventHash,
        mutation: structuredClone(mutation),
      });
    } else {
      if (!state) failWorkingLedger(ERROR.CORRUPT, "beat-before-open");
      if (event.payload.routeHash !== routeHash) {
        failWorkingLedger(ERROR.CONTEXT_MISMATCH, "beat-route");
      }
      const actions = event.payload.beatResolution.sealedActionIds.map((actionId) => {
        const accepted = acceptedActions.get(actionId);
        if (!accepted) failWorkingLedger(ERROR.ACTION_MISSING, actionId);
        if (appliedBeats.has(actionId)) {
          failWorkingLedger(ERROR.ACTION_ALREADY_RESOLVED, actionId);
        }
        return accepted.action;
      });
      const beat = validateBeatResolutionV1(event.payload.beatResolution, actions);
      if (
        beat.runId !== event.runId
        || beat.chapterRuntimeId !== event.chapterRuntimeId
        || beat.baseWorkingRevision !== state.revision
        || beat.inputWorkingStateHash !== stateHash
      ) {
        failWorkingLedger(ERROR.REVISION_MISMATCH, beat.resolutionHash);
      }
      if (
        event.payload.stateAfter.runId !== event.runId
        || event.payload.stateAfter.chapterId !== event.chapterId
        || event.payload.stateAfter.revision !== beat.committedWorkingRevision
      ) {
        failWorkingLedger(ERROR.CONTEXT_MISMATCH, "beat-state-after");
      }
      const afterHash = workingStateHash(event.payload.stateAfter);
      if (afterHash !== event.payload.stateAfterHash) {
        failWorkingLedger(ERROR.CORRUPT, "beat-state-after-hash");
      }
      for (const mutation of beat.reservationMutations) {
        const pending = pendingReservations.get(mutation.reservationKey);
        if (
          mutation.operation === "RESERVE"
          && (!pending
            || pending.sourceActionId !== mutation.sourceActionId
            || pending.resourceId !== mutation.resourceId
            || pending.amount !== mutation.amount
            || pending.seatId !== mutation.seatId)
        ) {
          failWorkingLedger(ERROR.CORRUPT, `reservation-mutation:${mutation.reservationKey}`);
        }
        if (mutation.operation !== "RESERVE" && !pending) {
          failWorkingLedger(ERROR.CORRUPT, `reservation-missing:${mutation.reservationKey}`);
        }
        if (mutation.operation === "RESERVE") {
          pendingReservations.set(mutation.reservationKey, { ...pending!, status: "RESERVED" });
        } else {
          pendingReservations.delete(mutation.reservationKey);
        }
      }
      for (const mutation of beat.workingDelta.commitmentMutations) {
        commitments.set(mutation.commitmentId, structuredClone(mutation));
      }
      for (const mutation of beat.workingDelta.knowledgeMutations) {
        const known = new Set(knowledgeBySeat.get(mutation.seatId) ?? []);
        mutation.addFactRefs.forEach((factRef) => known.add(factRef));
        mutation.removeFactRefs.forEach((factRef) => known.delete(factRef));
        knowledgeBySeat.set(mutation.seatId, [...known].sort(compareCanonicalText));
      }
      for (const mutation of beat.workingDelta.seatArcWorkingMutations) {
        seatArcProgressBySeat.set(
          mutation.seatId,
          (seatArcProgressBySeat.get(mutation.seatId) ?? 0) + mutation.progressDelta,
        );
      }
      const applied: AppliedBeatV1 = {
        actionIds: [...beat.sealedActionIds],
        commandFingerprint: event.payload.commandFingerprint,
        actionInputFingerprint: event.payload.actionInputFingerprint,
        resolution: structuredClone(beat),
        eventHash: event.eventHash,
      };
      for (const actionId of beat.sealedActionIds) appliedBeats.set(actionId, applied);
      state = structuredClone(event.payload.stateAfter);
      stateHash = afterHash;
      nextDecisionPin = structuredClone(event.payload.nextDecisionPin);
    }
    previousHash = event.eventHash;
  }

  if (!state) failWorkingLedger(ERROR.CORRUPT, "missing-open");
  return {
    key: { runId: first.runId, chapterRuntimeId: first.chapterRuntimeId },
    chapterId: first.chapterId,
    routeHash,
    chapterDefinitionHash,
    headHash: events.at(-1)!.eventHash,
    headSequence: events.at(-1)!.sequence,
    state,
    stateHash,
    nextDecisionPin,
    acceptedActions,
    actionsByIdempotencyKey,
    commitmentActionsByIdempotencyKey,
    appliedBeats,
    pendingReservations,
    commitments,
    evidenceRefsByAction,
    knowledgeBySeat,
    seatArcProgressBySeat,
  };
}

export function visibleFormalActionsForSeat(
  projection: WorkingLedgerProjectionV1,
  seatId: SeatIdV1,
): AcceptedFormalActionV1[] {
  return [...projection.acceptedActions.values()]
    .filter((accepted) => accepted.audienceSeatIds.includes(seatId))
    .map((accepted) => structuredClone(accepted));
}

function cloneProjection(source: WorkingLedgerProjectionV1): WorkingLedgerProjectionV1 {
  const cloneMap = <K, V>(value: ReadonlyMap<K, V>): Map<K, V> => new Map(
    [...value.entries()].map(([key, item]) => [key, structuredClone(item)] as [K, V]),
  );
  return {
    key: structuredClone(source.key),
    chapterId: source.chapterId,
    routeHash: source.routeHash,
    chapterDefinitionHash: source.chapterDefinitionHash,
    headHash: source.headHash,
    headSequence: source.headSequence,
    state: structuredClone(source.state),
    stateHash: source.stateHash,
    nextDecisionPin: structuredClone(source.nextDecisionPin),
    acceptedActions: cloneMap(source.acceptedActions),
    actionsByIdempotencyKey: cloneMap(source.actionsByIdempotencyKey),
    commitmentActionsByIdempotencyKey: cloneMap(
      source.commitmentActionsByIdempotencyKey ?? new Map(),
    ),
    appliedBeats: cloneMap(source.appliedBeats),
    pendingReservations: cloneMap(source.pendingReservations),
    commitments: cloneMap(source.commitments),
    evidenceRefsByAction: cloneMap(source.evidenceRefsByAction),
    knowledgeBySeat: cloneMap(source.knowledgeBySeat),
    seatArcProgressBySeat: cloneMap(source.seatArcProgressBySeat),
  };
}

function assertEventEnvelope(
  event: WorkingLedgerEventV1,
  first: WorkingLedgerEventV1,
  expectedSequence: number,
  expectedPreviousHash: string | null,
): void {
  if (
    event.schemaVersion !== "pressure_working_ledger_event_v1"
    || event.runId !== first.runId
    || event.chapterRuntimeId !== first.chapterRuntimeId
    || event.chapterId !== first.chapterId
    || event.sequence !== expectedSequence
    || event.previousEventHash !== expectedPreviousHash
  ) {
    failWorkingLedger(ERROR.CORRUPT, `event-envelope:${expectedSequence}`);
  }
  const body = {
    schemaVersion: event.schemaVersion,
    runId: event.runId,
    chapterRuntimeId: event.chapterRuntimeId,
    chapterId: event.chapterId,
    sequence: event.sequence,
    previousEventHash: event.previousEventHash,
    payload: event.payload,
  };
  if (sha256Canonical(body) !== event.eventHash) {
    failWorkingLedger(ERROR.CORRUPT, `event-hash:${expectedSequence}`);
  }
}

const AUTHORITATIVE_KEYS = new Set([
  "worldsequence",
  "worldstate",
  "frozenchapterbundle",
  "chaptersettlement",
  "finaledecision",
  "seatverdicts",
]);

function assertWorkingOnly(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertWorkingOnly(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (AUTHORITATIVE_KEYS.has(key.toLowerCase())) {
      failWorkingLedger(ERROR.AUTHORITY_FIELD_FORBIDDEN, `${path}.${key}`);
    }
    assertWorkingOnly(entry, `${path}.${key}`);
  }
}
