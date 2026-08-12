import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  computeSealedActionsHash,
  sha256Canonical,
  validateBeatResolutionV1,
  validateRunRouteSnapshotV1,
  type BeatResolutionV1,
  type ScalarFactValueV1,
  type SeatIdV1,
  type WorkingDeltaV1,
} from "@ai-story/shared";
import {
  assertPressureChapterDefinition,
  buildChapterWorkingSet,
  completePressureBeat,
  contentPolicyHashForChapterV1,
  loadSangtianPressureChapterPackageV1,
  recoverPinnedChapterWorkingSet,
  type BeatResult,
  type ChapterWorkingState,
  type JsonValue,
} from "@ai-story/templates";
import type {
  DecisionBeatResolutionPort,
  DecisionCloseEvaluatorPort,
  FormalActionSubmissionPort,
  WorkingLedgerOpeningPort,
  WorkingProjectionReaderPort,
} from "../orchestrator/contracts";
import type {
  BeatAppliedPayloadV1,
  WorkingActionIntentV1,
  WorkingLedgerEventV1,
  WorkingLedgerPort,
  WorkingLedgerProjectionV1,
} from "../working-ledger/contracts";
import {
  buildWorkingLedgerEvents,
  projectWorkingLedger,
  workingStateHash,
} from "../working-ledger/working-ledger";
import { optionIdForActionTypeV1 } from "./content.adapters";
import { failPressureChapterIntegration } from "./errors";

export class W5FormalActionSubmissionAdapterV1
implements FormalActionSubmissionPort {
  constructor(
    private readonly service: Pick<FormalActionSubmissionPort, "submit">,
  ) {}

  submit(
    command: Parameters<FormalActionSubmissionPort["submit"]>[0],
  ) {
    return this.service.submit(command);
  }
}

export class W5WorkingLedgerOpeningAdapterV1
implements WorkingLedgerOpeningPort {
  constructor(
    private readonly service: Pick<WorkingLedgerOpeningPort, "open">,
  ) {}

  open(command: Parameters<WorkingLedgerOpeningPort["open"]>[0]) {
    return this.service.open(command);
  }
}

export class W5WorkingProjectionReaderAdapterV1
implements WorkingProjectionReaderPort {
  constructor(private readonly ledger: WorkingLedgerPort) {}

  async load(
    input: Parameters<WorkingProjectionReaderPort["load"]>[0],
  ): Promise<WorkingLedgerProjectionV1> {
    return projectWorkingLedger(await this.ledger.read(input));
  }
}

/**
 * The pre-Beat close gate: all REQUIRED seats have sealed/defaulted their
 * authored budget and all referenced actions exist in the durable ledger.
 * The authored close fact is produced by Beat and therefore is not used as a
 * circular prerequisite to run Beat.
 */
export class RequiredSeatsDecisionCloseAdapterV1
implements DecisionCloseEvaluatorPort {
  async isClosed(
    input: Parameters<DecisionCloseEvaluatorPort["isClosed"]>[0],
  ): Promise<boolean> {
    if (input.decision.decisionPointId !== input.active.decisionPointId) {
      failPressureChapterIntegration(
        "INTEGRATION_AUTHORITY_SOURCE_MISMATCH",
        "decisionClose.decisionPointId",
      );
    }
    for (const seat of input.active.seats) {
      const expected = input.decision.seatRequirements[seat.seatId];
      if (seat.requirement !== expected) {
        failPressureChapterIntegration(
          "INTEGRATION_AUTHORITY_SOURCE_MISMATCH",
          `decisionClose.seats.${seat.seatId}.requirement`,
        );
      }
      if (seat.requirement === "NOT_REQUIRED") {
        if (
          seat.completion !== "NOT_REQUIRED"
          || seat.actionIds.length !== 0
          || seat.actionCount !== 0
        ) {
          failPressureChapterIntegration(
            "INTEGRATION_AUTHORITY_SOURCE_MISMATCH",
            `decisionClose.seats.${seat.seatId}`,
          );
        }
        continue;
      }
      if (seat.completion === "PENDING" || seat.actionIds.length === 0) {
        return false;
      }
      const budget = input.decision.execution.perSeatActionBudget[seat.seatId];
      if (
        !budget
        || seat.actionCount !== seat.actionIds.length
        || seat.actionCount > budget
      ) {
        failPressureChapterIntegration(
          "INTEGRATION_AUTHORITY_SOURCE_MISMATCH",
          `decisionClose.seats.${seat.seatId}.budget`,
        );
      }
      for (const actionId of seat.actionIds) {
        const accepted = input.projection.acceptedActions.get(actionId);
        if (
          !accepted
          || accepted.action.seatId !== seat.seatId
          || accepted.action.decisionPointId !== input.decision.decisionPointId
        ) {
          failPressureChapterIntegration(
            "INTEGRATION_AUTHORITY_SOURCE_MISMATCH",
            `decisionClose.actions.${actionId}`,
          );
        }
      }
    }
    return true;
  }
}

export interface SangtianAuthoritativeBeatArtifactV1 {
  schemaVersion: "sangtian_authoritative_beat_artifact_v1";
  contentPackageVersion: string;
  contentPackageHash: string;
  contentPolicyVersion: string;
  contentPolicyHash: string;
  beatResolutionPolicy: string;
  beatPolicyHash: string;
  actionSetHash: string;
  actionIds: string[];
  actionTypes: string[];
  authoredBeatResult: BeatResult;
  artifactHash: string;
}

export interface SangtianAuthoritativeBeatCompilerPort {
  compile(input: Readonly<{
    routeHash: string;
    contentPackageVersion: string;
    contentPackageHash: string;
    chapterDefinition: ReturnType<typeof assertPressureChapterDefinition>;
    chapterRuntimeId: string;
    decisionPointId: string;
    baseState: ChapterWorkingState;
    baseStateFingerprint: string;
    actions: ReadonlyArray<Readonly<{
      actionId: string;
      actionType: string;
      sealedHash: string;
    }>>;
  }>): SangtianAuthoritativeBeatArtifactV1;
}

/**
 * Content-owned, deterministic Beat compiler. It only closes the selected
 * decision in ChapterWorkingState. All commitment/knowledge/reservation/arc
 * mutations are copied later from already validated WorkingActionIntent; no
 * client payload or Provider can assign Working facts here.
 */
export class SangtianAuthoritativeBeatCompilerV1
implements SangtianAuthoritativeBeatCompilerPort {
  private readonly loaded = loadSangtianPressureChapterPackageV1();

  compile(
    input: Parameters<SangtianAuthoritativeBeatCompilerPort["compile"]>[0],
  ): SangtianAuthoritativeBeatArtifactV1 {
    if (
      input.contentPackageVersion !== this.loaded.manifest.packageVersion
      || input.contentPackageHash !== this.loaded.manifest.contentSha256
    ) {
      invalid("beat.contentPackage", "ACCEPTED_PACKAGE_REQUIRED");
    }
    const definition = assertPressureChapterDefinition(input.chapterDefinition);
    const chapter = this.loaded.chapters.find(
      (candidate) => candidate.chapterId === definition.chapterId,
    );
    const authoredChapter = this.loaded.content.chapters.find(
      (candidate) => candidate.chapterId === definition.chapterId,
    );
    const execution = chapter?.decisionPoints.find(
      (candidate) => candidate.definition.decisionPointKey === input.decisionPointId,
    )?.definition;
    const domainPoint = definition.decisionPoints.find(
      (candidate) => candidate.decisionPointId === input.decisionPointId,
    );
    if (!chapter || !authoredChapter || !execution || !domainPoint) {
      invalid("beat.decisionPoint", "NOT_AUTHORED");
    }
    if (
      domainPoint.kernelId !== execution.beatResolutionPolicy
      || domainPoint.chapterId !== execution.chapterId
    ) {
      invalid("beat.policy", "KERNEL_BINDING_MISMATCH");
    }
    const authoredOptionIds = domainPoint.options
      .map((option) => option.optionId)
      .sort(compareCanonicalText);
    const allowedActionTypes = execution.allowedActionTypes
      .map(optionIdForActionTypeV1)
      .sort(compareCanonicalText);
    if (!sameStrings(authoredOptionIds, allowedActionTypes)) {
      invalid("beat.actionTypes", "DOMAIN_CONTENT_MISMATCH");
    }
    if (!input.actions.length) invalid("beat.actions", "NON_EMPTY_ARRAY");
    const canonicalActions = input.actions.map((action) => {
      if (!execution.allowedActionTypes.includes(action.actionType)) {
        invalid(`beat.actions.${action.actionId}.actionType`, "NOT_ALLOWED");
      }
      hash(action.sealedHash, `beat.actions.${action.actionId}.sealedHash`);
      return {
        actionId: action.actionId,
        actionType: action.actionType,
        sealedHash: action.sealedHash,
      };
    }).sort((left, right) => compareCanonicalText(left.actionId, right.actionId));
    const actionIds = canonicalActions.map((action) => action.actionId);
    const actionTypes = canonicalActions.map((action) => action.actionType)
      .sort(compareCanonicalText);
    assertUnique(actionIds, "beat.actions");
    const actionSetHash = sha256Canonical({
      schemaVersion: "sangtian_authoritative_beat_action_set_v1",
      actions: canonicalActions,
    });
    const closeCondition = execution.closeCondition;
    if (
      closeCondition.op !== "COMPARE"
      || closeCondition.comparator !== "EQ"
      || closeCondition.value !== true
    ) {
      invalid("beat.closeCondition", "BOOLEAN_CLOSE_FACT_REQUIRED");
    }
    const contentPolicyVersion = authoredChapter.settlementPolicy.policyVersion;
    const contentPolicyHash = contentPolicyHashForChapterV1(
      definition.chapterId,
      this.loaded,
    );
    const beatPolicyBody = {
      schemaVersion: "sangtian_authoritative_beat_policy_v1" as const,
      contentPackageVersion: this.loaded.manifest.packageVersion,
      contentPackageHash: this.loaded.manifest.contentSha256,
      contentPolicyVersion,
      contentPolicyHash,
      beatResolutionPolicy: execution.beatResolutionPolicy,
      execution,
    };
    const beatPolicyHash = sha256Canonical(beatPolicyBody);
    const workingDelta = {
      schemaVersion: "pressure_working_delta_v1" as const,
      baseRevision: input.baseState.revision,
      completeDecisionPointId: input.decisionPointId,
      setFacts: { [closeCondition.factRef]: true },
      incrementCounters: {},
      satisfyRequirementIds: [],
      appendSettledReaction: null,
    };
    const resultBody = {
      schemaVersion: "pressure_beat_result_v1" as const,
      beatId: `beat_${sha256Canonical({
        routeHash: input.routeHash,
        chapterRuntimeId: input.chapterRuntimeId,
        actionSetHash,
        beatPolicyHash,
        baseRevision: input.baseState.revision,
        baseFingerprint: input.baseStateFingerprint,
        workingDelta,
      }).slice(0, 24)}`,
      chapterId: definition.chapterId,
      decisionPointId: input.decisionPointId,
      optionId: `aggregate.${actionSetHash.slice(0, 24)}`,
      baseRevision: input.baseState.revision,
      baseFingerprint: input.baseStateFingerprint,
      workingDelta,
    };
    const authoredBeatResult: BeatResult = {
      ...resultBody,
      // The Pressure template Beat contract uses uppercase SHA-256 strings.
      // Keep the shared canonical serializer, but normalize its lowercase
      // digest before handing the result across that contract boundary.
      resultHash: sha256Canonical(resultBody).toUpperCase(),
    };
    const artifactBody = {
      schemaVersion: "sangtian_authoritative_beat_artifact_v1" as const,
      contentPackageVersion: this.loaded.manifest.packageVersion,
      contentPackageHash: this.loaded.manifest.contentSha256,
      contentPolicyVersion,
      contentPolicyHash,
      beatResolutionPolicy: execution.beatResolutionPolicy,
      beatPolicyHash,
      actionSetHash,
      actionIds,
      actionTypes,
      authoredBeatResult,
    };
    return {
      ...artifactBody,
      artifactHash: sha256Canonical(artifactBody),
    };
  }
}

/**
 * W4-to-W5 production Beat bridge. It consumes all sealed actions for one
 * decision and appends exactly one BEAT_APPLIED event through WorkingLedgerPort.
 * No Provider, Result, DB client or world authority is reachable here.
 */
export class SynchronizedDecisionBeatResolutionAdapterV1
implements DecisionBeatResolutionPort {
  constructor(
    private readonly ledger: WorkingLedgerPort,
    private readonly compiler: SangtianAuthoritativeBeatCompilerPort,
  ) {}

  async resolve(
    input: Parameters<DecisionBeatResolutionPort["resolve"]>[0],
  ): Promise<Awaited<ReturnType<DecisionBeatResolutionPort["resolve"]>>> {
    const route = validateRunRouteSnapshotV1(input.routeSnapshot);
    const definition = assertPressureChapterDefinition(input.chapterDefinition);
    const actionIds = canonicalActionIds(input.actionIds);
    if (!input.chapterRuntimeId.trim() || !input.resolverVersion.trim()) {
      invalid("beat.command", "NON_EMPTY_RUNTIME_AND_RESOLVER");
    }
    const key = {
      runId: route.runId,
      chapterRuntimeId: input.chapterRuntimeId,
    };
    const events = await this.ledger.read(key);
    const projection = projectWorkingLedger(events);
    assertProjectionBindings(route.routeHash, definition, projection);
    const accepted = actionIds.map((actionId) => {
      const item = projection.acceptedActions.get(actionId);
      if (!item) invalid(`beat.actions.${actionId}`, "NOT_ACCEPTED");
      return item;
    });
    const decisionPointIds = new Set(
      accepted.map((item) => item.action.decisionPointId),
    );
    if (decisionPointIds.size !== 1) {
      invalid("beat.actions", "MULTIPLE_DECISION_POINTS");
    }
    const decisionPointId = accepted[0]!.action.decisionPointId;
    const workingSet = projection.nextDecisionPin
      ? recoverPinnedChapterWorkingSet(
          definition,
          projection.state,
          projection.nextDecisionPin,
        )
      : buildChapterWorkingSet(definition, projection.state);
    if (!workingSet || workingSet.decisionPoint.decisionPointId !== decisionPointId) {
      invalid("beat.activeDecision", "PIN_MISMATCH");
    }

    const actionInputFingerprint = sha256Canonical({
      schemaVersion: "pressure_synchronized_action_inputs_v1",
      actions: accepted.map((item) => ({
        actionId: item.action.actionId,
        actionType: item.action.actionType,
        inputFingerprint: item.inputFingerprint,
        sealedHash: item.action.sealedHash,
      })),
    });
    const authorityBeat = this.compiler.compile({
      routeHash: route.routeHash,
      contentPackageVersion: route.contentPackageVersion,
      contentPackageHash: route.contentPackageSha256,
      chapterDefinition: definition,
      chapterRuntimeId: input.chapterRuntimeId,
      decisionPointId,
      baseState: projection.state,
      baseStateFingerprint: workingSet.stateFingerprint,
      actions: accepted.map((item) => ({
        actionId: item.action.actionId,
        actionType: item.action.actionType,
        sealedHash: item.action.sealedHash,
      })),
    });
    const commandFingerprint = sha256Canonical({
      schemaVersion: "pressure_synchronized_beat_command_v1",
      routeHash: route.routeHash,
      chapterDefinitionHash: projection.chapterDefinitionHash,
      chapterRuntimeId: input.chapterRuntimeId,
      decisionPointId,
      actionIds,
      actionInputFingerprint,
      resolverVersion: input.resolverVersion,
      contentPolicyVersion: authorityBeat.contentPolicyVersion,
      contentPolicyHash: authorityBeat.contentPolicyHash,
      beatResolutionPolicy: authorityBeat.beatResolutionPolicy,
      beatPolicyHash: authorityBeat.beatPolicyHash,
      actionSetHash: authorityBeat.actionSetHash,
      authorityBeatArtifactHash: authorityBeat.artifactHash,
    });
    const replay = replayedBeat(
      projection,
      events,
      actionIds,
      commandFingerprint,
      actionInputFingerprint,
    );
    if (replay) {
      return {
        status: "REPLAYED",
        resolution: replay.resolution,
        projection,
      };
    }
    if (actionIds.some((actionId) => projection.appliedBeats.has(actionId))) {
      failPressureChapterIntegration(
        "INTEGRATION_BEAT_REPLAY_MISMATCH",
        "beat.actions",
        "PARTIALLY_APPLIED_SET",
      );
    }

    const authoredBeatResult = authorityBeat.authoredBeatResult;
    const transition = completePressureBeat(
      definition,
      projection.state,
      authoredBeatResult,
    );
    const workingDelta = compileAggregateWorkingDelta(
      projection.state,
      transition.state,
      accepted.map((item) => ({
        actionId: item.action.actionId,
        seatId: item.action.seatId,
        intent: item.intent,
      })),
    );
    const reservationMutations = accepted
      .flatMap((item) => item.intent.resourceReservations.map((reservation) => ({
        ...structuredClone(reservation),
        seatId: item.action.seatId,
        operation: "RESERVE" as const,
        sourceActionId: item.action.actionId,
      })))
      .sort((left, right) => compareCanonicalText(
        left.reservationKey,
        right.reservationKey,
      ));
    assertUnique(
      reservationMutations.map((item) => item.reservationKey),
      "beat.reservations",
    );
    const resolutionBody = {
      schemaVersion: "sangtian_beat_resolution_v1" as const,
      runId: route.runId,
      chapterRuntimeId: input.chapterRuntimeId,
      decisionPointId,
      baseWorkingRevision: projection.state.revision,
      committedWorkingRevision: transition.state.revision,
      inputWorkingStateHash: projection.stateHash,
      sealedActionIds: actionIds,
      sealedActionsHash: computeSealedActionsHash(
        accepted.map((item) => item.action),
      ),
      resolverVersion: input.resolverVersion,
      workingDelta,
      reservationMutations,
      reactionContextRef: transition.currentReaction
        ? { sourceHash: sha256Canonical(transition.currentReaction) }
        : null,
      nextDecisionContextRef: transition.nextDecisionPin
        ? { sourceHash: sha256Canonical(transition.nextDecisionPin) }
        : null,
    };
    const resolution = validateBeatResolutionV1(
      {
        ...resolutionBody,
        resolutionHash: sha256Canonical(resolutionBody),
      },
      accepted.map((item) => item.action),
    );
    const payload: BeatAppliedPayloadV1 = {
      eventType: "BEAT_APPLIED",
      routeHash: route.routeHash,
      commandFingerprint,
      actionInputFingerprint,
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
    const appended = await this.ledger.append({
      key,
      expectedHeadHash: projection.headHash,
      events: [event!],
    });
    if (appended.status === "APPENDED") {
      return {
        status: "APPLIED",
        resolution,
        projection: projectWorkingLedger([...events, event!]),
      };
    }
    const concurrentEvents = await this.ledger.read(key);
    const concurrentProjection = projectWorkingLedger(concurrentEvents);
    const concurrentReplay = replayedBeat(
      concurrentProjection,
      concurrentEvents,
      actionIds,
      commandFingerprint,
      actionInputFingerprint,
    );
    if (!concurrentReplay) {
      failPressureChapterIntegration(
        "INTEGRATION_PERSISTENCE_CONFLICT",
        "beat.ledgerHead",
      );
    }
    return {
      status: "REPLAYED",
      resolution: concurrentReplay.resolution,
      projection: concurrentProjection,
    };
  }
}

function compileAggregateWorkingDelta(
  before: ChapterWorkingState,
  after: ChapterWorkingState,
  actionInputs: Array<{
    actionId: string;
    seatId: SeatIdV1;
    intent: WorkingActionIntentV1;
  }>,
): WorkingDeltaV1 {
  const workingFactMutations: WorkingDeltaV1["workingFactMutations"] = [];
  const factRefs = [...new Set([
    ...Object.keys(before.facts),
    ...Object.keys(after.facts),
  ])].sort(compareCanonicalText);
  for (const factRef of factRefs) {
    // Missing facts are represented as null in the WorkingDelta contract.
    // Normalize before hashing because strict canonical JSON deliberately
    // rejects JavaScript undefined values.
    const beforeFact = before.facts[factRef] ?? null;
    const afterFact = after.facts[factRef] ?? null;
    if (sha256Canonical(beforeFact) === sha256Canonical(afterFact)) {
      continue;
    }
    workingFactMutations.push({
      factRef,
      before: scalar(beforeFact, `${factRef}.before`),
      after: scalar(afterFact, `${factRef}.after`),
    });
  }
  const counters = [...new Set([
    ...Object.keys(before.counters),
    ...Object.keys(after.counters),
  ])].sort(compareCanonicalText);
  for (const counter of counters) {
    const prior = before.counters[counter] ?? 0;
    const next = after.counters[counter] ?? 0;
    if (prior === next) continue;
    workingFactMutations.push({
      factRef: `counter.${counter}`,
      before: prior,
      after: next,
    });
  }
  workingFactMutations.sort((left, right) =>
    compareCanonicalText(left.factRef, right.factRef),
  );

  const commitmentMutations = actionInputs
    .flatMap((item) => item.intent.commitmentMutations.map((mutation) => ({
      ...structuredClone(mutation),
      seatIds: canonicalSeats(mutation.seatIds),
      sourceActionId: item.actionId,
    })))
    .sort((left, right) => compareCanonicalText(
      left.commitmentId,
      right.commitmentId,
    ));
  assertUnique(
    commitmentMutations.map((item) => item.commitmentId),
    "beat.commitments",
  );

  const knowledge = new Map<SeatIdV1, { add: Set<string>; remove: Set<string> }>();
  const arcs = new Map<SeatIdV1, { progress: number; actionIds: string[] }>();
  for (const item of actionInputs) {
    for (const grant of item.intent.knowledgeGrants) {
      const current = knowledge.get(grant.seatId) ?? {
        add: new Set<string>(),
        remove: new Set<string>(),
      };
      grant.factRefs.forEach((factRef) => current.add.add(factRef));
      knowledge.set(grant.seatId, current);
    }
    for (const mutation of item.intent.seatArcProgress) {
      const current = arcs.get(mutation.seatId) ?? { progress: 0, actionIds: [] };
      current.progress += mutation.progressDelta;
      current.actionIds.push(item.actionId);
      arcs.set(mutation.seatId, current);
    }
  }
  const knowledgeMutations = PRESSURE_CHAPTER_SEAT_IDS_V1
    .filter((seatId) => knowledge.has(seatId))
    .map((seatId) => {
      const item = knowledge.get(seatId)!;
      return {
        seatId,
        addFactRefs: [...item.add].sort(compareCanonicalText),
        removeFactRefs: [...item.remove].sort(compareCanonicalText),
      };
    });
  const seatArcWorkingMutations = PRESSURE_CHAPTER_SEAT_IDS_V1
    .filter((seatId) => arcs.has(seatId))
    .map((seatId) => {
      const item = arcs.get(seatId)!;
      return {
        seatId,
        progressDelta: item.progress,
        sourceActionId: item.actionIds.length === 1
          ? item.actionIds[0]!
          : `aggregate.${sha256Canonical(
              [...item.actionIds].sort(compareCanonicalText),
            ).slice(0, 24)}`,
      };
    });
  return {
    workingFactMutations,
    commitmentMutations,
    knowledgeMutations,
    seatArcWorkingMutations,
  };
}

function replayedBeat(
  projection: WorkingLedgerProjectionV1,
  events: WorkingLedgerEventV1[],
  actionIds: string[],
  commandFingerprint: string,
  actionInputFingerprint: string,
): { resolution: BeatResolutionV1; event: WorkingLedgerEventV1 } | null {
  const beats = actionIds.map((actionId) => projection.appliedBeats.get(actionId));
  if (beats.every((beat) => beat === undefined)) return null;
  if (beats.some((beat) => beat === undefined)) {
    failPressureChapterIntegration(
      "INTEGRATION_BEAT_REPLAY_MISMATCH",
      "beat.replay",
      "PARTIAL_ACTION_SET",
    );
  }
  const first = beats[0]!;
  if (
    beats.some((beat) =>
      beat!.eventHash !== first.eventHash
      || beat!.commandFingerprint !== commandFingerprint
      || beat!.actionInputFingerprint !== actionInputFingerprint,
    )
    || first.commandFingerprint !== commandFingerprint
    || first.actionInputFingerprint !== actionInputFingerprint
  ) {
    failPressureChapterIntegration(
      "INTEGRATION_BEAT_REPLAY_MISMATCH",
      "beat.replay",
      "FINGERPRINT_MISMATCH",
    );
  }
  const event = events.find((candidate) => candidate.eventHash === first.eventHash);
  if (!event) {
    failPressureChapterIntegration(
      "INTEGRATION_BEAT_REPLAY_MISMATCH",
      "beat.replay.event",
      "MISSING",
    );
  }
  return { resolution: first.resolution, event };
}

function assertProjectionBindings(
  routeHash: string,
  definition: ReturnType<typeof assertPressureChapterDefinition>,
  projection: WorkingLedgerProjectionV1,
): void {
  if (
    projection.routeHash !== routeHash
    || projection.chapterDefinitionHash !== sha256Canonical(definition)
    || projection.chapterId !== definition.chapterId
  ) {
    failPressureChapterIntegration(
      "INTEGRATION_AUTHORITY_SOURCE_MISMATCH",
      "beat.projection",
    );
  }
}

function canonicalActionIds(values: string[]): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    invalid("beat.actionIds", "NON_EMPTY_ARRAY");
  }
  const result = values.map((value, index) => {
    if (typeof value !== "string" || !value.trim()) {
      invalid(`beat.actionIds[${index}]`);
    }
    return value;
  }).sort(compareCanonicalText);
  assertUnique(result, "beat.actionIds");
  return result;
}

function assertUnique(values: string[], path: string): void {
  if (new Set(values).size !== values.length) {
    failPressureChapterIntegration(
      "INTEGRATION_BEAT_CONFLICT",
      path,
      "DUPLICATE",
    );
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function hash(value: string, path: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) invalid(path, "SHA256_LOWER_HEX");
}

function canonicalSeats(values: SeatIdV1[]): SeatIdV1[] {
  const set = new Set(values);
  return PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) => set.has(seatId));
}

function sortedRecord<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) =>
      compareCanonicalText(left, right),
    ),
  );
}

function scalar(value: JsonValue, path: string): ScalarFactValueV1 {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  ) {
    return value as ScalarFactValueV1;
  }
  return invalid(path, "SCALAR_REQUIRED");
}

function invalid(path: string, detail?: string): never {
  return failPressureChapterIntegration(
    "INTEGRATION_INPUT_INVALID",
    path,
    detail,
  );
}
