import {
  computeSealedActionsHash,
  compareCanonicalText,
  sha256Canonical,
  validateBeatResolutionV1,
  validateRunRouteSnapshotV1,
  type BeatResolutionV1,
  type RunRouteSnapshotV1,
  type ScalarFactValueV1,
  type WorkingDeltaV1,
} from "@ai-story/shared";
import {
  assertPressureChapterDefinition,
  buildChapterWorkingSet,
  completePressureBeat,
  recoverPinnedChapterWorkingSet,
  resolvePressureBeat,
  type ChapterWorkingState,
  type JsonValue,
  type PressureChapterDefinition,
} from "@ai-story/templates";
import type {
  BeatAppliedPayloadV1,
  WorkingActionIntentV1,
  WorkingLedgerEventV1,
  WorkingLedgerPort,
  WorkingLedgerProjectionV1,
} from "./contracts";
import {
  buildWorkingLedgerEvents,
  projectWorkingLedger,
  workingStateHash,
} from "./working-ledger";
import {
  WORKING_LEDGER_ERROR_CODES as ERROR,
  failWorkingLedger,
} from "./errors";

export interface ApplyFormalBeatCommandV1 {
  routeSnapshot: RunRouteSnapshotV1;
  chapterRuntimeId: string;
  chapterDefinition: PressureChapterDefinition;
  actionId: string;
  actionInputFingerprint: string;
  resolverVersion: string;
}

export class WorkingBeatApplicationService {
  constructor(private readonly ledgerPort: WorkingLedgerPort) {}

  async apply(command: ApplyFormalBeatCommandV1): Promise<{
    status: "APPLIED" | "REPLAYED";
    event: WorkingLedgerEventV1;
    resolution: BeatResolutionV1;
  }> {
    const route = validateRunRouteSnapshotV1(command.routeSnapshot);
    const definition = assertPressureChapterDefinition(command.chapterDefinition);
    if (!command.chapterRuntimeId.trim() || !command.actionId.trim() || !command.resolverVersion.trim()) {
      failWorkingLedger(ERROR.INVALID_INPUT, "beat-command");
    }
    const key = { runId: route.runId, chapterRuntimeId: command.chapterRuntimeId };
    const events = await this.ledgerPort.read(key);
    const projection = projectWorkingLedger(events);
    assertBeatBindings(route.routeHash, definition, projection);
    const accepted = projection.acceptedActions.get(command.actionId);
    if (!accepted) failWorkingLedger(ERROR.ACTION_MISSING, command.actionId);
    if (accepted.inputFingerprint !== command.actionInputFingerprint) {
      failWorkingLedger(ERROR.IDEMPOTENCY_MISMATCH, command.actionId);
    }
    const commandFingerprint = computeBeatCommandFingerprint({
      routeHash: route.routeHash,
      chapterDefinitionHash: projection.chapterDefinitionHash,
      actionId: command.actionId,
      actionInputFingerprint: command.actionInputFingerprint,
      resolverVersion: command.resolverVersion,
    });
    const prior = projection.appliedBeats.get(command.actionId);
    if (prior) {
      if (
        prior.commandFingerprint !== commandFingerprint
        || prior.actionInputFingerprint !== command.actionInputFingerprint
      ) failWorkingLedger(ERROR.IDEMPOTENCY_MISMATCH, command.actionId);
      const event = events.find((candidate) => candidate.eventHash === prior.eventHash);
      if (!event) failWorkingLedger(ERROR.CORRUPT, "beat-replay-event");
      return { status: "REPLAYED", event: structuredClone(event), resolution: prior.resolution };
    }

    const workingSet = projection.nextDecisionPin
      ? recoverPinnedChapterWorkingSet(definition, projection.state, projection.nextDecisionPin)
      : buildChapterWorkingSet(definition, projection.state);
    if (!workingSet || workingSet.decisionPoint.decisionPointId !== accepted.action.decisionPointId) {
      failWorkingLedger(ERROR.CONTEXT_MISMATCH, "active-decision");
    }
    const optionId = accepted.action.payload.optionId;
    if (typeof optionId !== "string" || !optionId.trim()) {
      failWorkingLedger(ERROR.INVALID_INPUT, "action.payload.optionId");
    }
    const authoredBeatResult = resolvePressureBeat(workingSet, {
      actionId: accepted.action.actionId,
      expectedRevision: projection.state.revision,
      expectedStateFingerprint: workingSet.stateFingerprint,
      decisionPointId: accepted.action.decisionPointId,
      optionId,
    });
    const transition = completePressureBeat(definition, projection.state, authoredBeatResult);
    const workingDelta = compileWorkingDelta(
      projection.state,
      transition.state,
      accepted.action.actionId,
      accepted.intent,
    );
    const reservationMutations = accepted.intent.resourceReservations.map((reservation) => ({
      ...reservation,
      seatId: accepted.action.seatId,
      operation: "RESERVE" as const,
      sourceActionId: accepted.action.actionId,
    })).sort((left, right) => compareCanonicalText(left.reservationKey, right.reservationKey));
    const resolutionBody = {
      schemaVersion: "sangtian_beat_resolution_v1" as const,
      runId: accepted.action.runId,
      chapterRuntimeId: accepted.action.chapterRuntimeId,
      decisionPointId: accepted.action.decisionPointId,
      baseWorkingRevision: projection.state.revision,
      committedWorkingRevision: transition.state.revision,
      inputWorkingStateHash: projection.stateHash,
      sealedActionIds: [accepted.action.actionId],
      sealedActionsHash: computeSealedActionsHash([accepted.action]),
      resolverVersion: command.resolverVersion,
      workingDelta,
      reservationMutations,
      reactionContextRef: transition.currentReaction
        ? { sourceHash: sha256Canonical(transition.currentReaction) }
        : null,
      nextDecisionContextRef: transition.nextDecisionPin
        ? { sourceHash: sha256Canonical(transition.nextDecisionPin) }
        : null,
    };
    const resolution = validateBeatResolutionV1({
      ...resolutionBody,
      resolutionHash: sha256Canonical(resolutionBody),
    }, [accepted.action]);
    const payload: BeatAppliedPayloadV1 = {
      eventType: "BEAT_APPLIED",
      routeHash: route.routeHash,
      commandFingerprint,
      actionInputFingerprint: command.actionInputFingerprint,
      beatResolution: resolution,
      authoredBeatResult,
      stateAfter: transition.state,
      stateAfterHash: workingStateHash(transition.state),
      nextDecisionPin: transition.nextDecisionPin,
    };
    const [event] = buildWorkingLedgerEvents({
      key,
      chapterId: projection.chapterId,
      previousEvents: events,
      payloads: [payload],
    });
    const appended = await this.ledgerPort.append({
      key,
      expectedHeadHash: projection.headHash,
      events: [event!],
    });
    if (appended.status === "APPENDED") {
      return { status: "APPLIED", event: event!, resolution };
    }

    const concurrentEvents = await this.ledgerPort.read(key);
    const concurrent = projectWorkingLedger(concurrentEvents);
    const concurrentBeat = concurrent.appliedBeats.get(command.actionId);
    if (
      concurrentBeat
      && concurrentBeat.commandFingerprint === commandFingerprint
      && concurrentBeat.actionInputFingerprint === command.actionInputFingerprint
    ) {
      const event = concurrentEvents.find((candidate) => candidate.eventHash === concurrentBeat.eventHash);
      if (!event) failWorkingLedger(ERROR.CORRUPT, "concurrent-beat-event");
      return { status: "REPLAYED", event: structuredClone(event), resolution: concurrentBeat.resolution };
    }
    failWorkingLedger(ERROR.HEAD_CONFLICT);
  }
}

export function computeBeatCommandFingerprint(input: {
  routeHash: string;
  chapterDefinitionHash: string;
  actionId: string;
  actionInputFingerprint: string;
  resolverVersion: string;
}): string {
  return sha256Canonical({ commandType: "APPLY_PRESSURE_BEAT_V1", ...input });
}

function assertBeatBindings(
  routeHash: string,
  definition: PressureChapterDefinition,
  projection: WorkingLedgerProjectionV1,
): void {
  if (
    projection.routeHash !== routeHash
    || projection.chapterDefinitionHash !== sha256Canonical(definition)
    || projection.chapterId !== definition.chapterId
  ) failWorkingLedger(ERROR.DEFINITION_MISMATCH);
}

function compileWorkingDelta(
  before: ChapterWorkingState,
  after: ChapterWorkingState,
  sourceActionId: string,
  intent: WorkingActionIntentV1,
): WorkingDeltaV1 {
  const workingFactMutations: WorkingDeltaV1["workingFactMutations"] = [];
  for (const factRef of Object.keys(after.facts).sort(compareCanonicalText)) {
    if (before.facts[factRef] === after.facts[factRef]) continue;
    workingFactMutations.push({
      factRef,
      before: scalar(before.facts[factRef] ?? null, `facts.${factRef}.before`),
      after: scalar(after.facts[factRef]!, `facts.${factRef}.after`),
    });
  }
  for (const counter of unique([...Object.keys(before.counters), ...Object.keys(after.counters)]).sort(compareCanonicalText)) {
    const prior = before.counters[counter] ?? 0;
    const next = after.counters[counter] ?? 0;
    if (prior !== next) workingFactMutations.push({
      factRef: `counter.${counter}`,
      before: prior,
      after: next,
    });
  }
  workingFactMutations.sort((left, right) => compareCanonicalText(left.factRef, right.factRef));
  return {
    workingFactMutations,
    commitmentMutations: intent.commitmentMutations.map((mutation) => ({
      ...mutation,
      sourceActionId,
    })),
    knowledgeMutations: intent.knowledgeGrants.map((grant) => ({
      seatId: grant.seatId,
      addFactRefs: [...grant.factRefs],
      removeFactRefs: [],
    })),
    seatArcWorkingMutations: intent.seatArcProgress.map((mutation) => ({
      ...mutation,
      sourceActionId,
    })),
  };
}

function scalar(value: JsonValue, path: string): ScalarFactValueV1 {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return value as ScalarFactValueV1;
  }
  failWorkingLedger(ERROR.INVALID_INPUT, `${path}:non-scalar`);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
