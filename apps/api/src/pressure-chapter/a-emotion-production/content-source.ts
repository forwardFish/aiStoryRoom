import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  chapterSequence,
  compareCanonicalText,
  isSha256,
  sha256Canonical,
  validateFrozenChapterBundleV1,
  type DecisionActionV1,
  type FrozenChapterBundleV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  loadPublishedSangtianAEmotionPolicyV1,
  loadSangtianPressureChapterPackageV1,
  type LoadedSangtianPressureChapterPackageV1,
  type PublishedSangtianAEmotionPolicyV1,
  type SangtianAEmotionEventTemplateV1,
  type SangtianAEmotionFinaleVerdictV1,
  type SangtianAEmotionOutcomeBandV1,
} from "@ai-story/templates";
import {
  validateAtomicChapterCommitRecordV1,
} from "../chapter-settlement/chapter-commit-record";
import type { AtomicChapterCommitRecordV1 } from "../chapter-settlement/types";
import {
  validateAuthorityFirstTerminalRecordV1,
} from "../terminal-commit/terminal-record";
import type { AuthorityFirstTerminalRecordV1 } from "../terminal-commit/types";
import {
  projectWorkingLedger,
} from "../working-ledger/working-ledger";
import type {
  AcceptedFormalActionV1,
  WorkingLedgerEventV1,
  WorkingLedgerProjectionV1,
} from "../working-ledger/contracts";
import type { AEmotionInteractionEventPortV1 } from "../a-emotion/ports";
import {
  sealAEmotionAuthorityOutboxJobV1,
  sealAEmotionCommittedAuthoritySourceV1,
} from "./compiler";
import type {
  AEmotionAuthorityOutboxJobV1,
  AEmotionCommittedAuthoritySourceV1,
} from "./contracts";
import {
  A_EMOTION_PRODUCTION_ERROR_CODES as ERROR,
  failAEmotionProduction,
} from "./errors";
import {
  deriveCrossImpactPresentationV1,
  deriveStateTransitionPresentationV1,
} from "./trigger-derivation";

type ImpactV1 = AEmotionInteractionEventPortV1["impacts"][number];

export interface AEmotionAuthorityEmissionV1 {
  /** The W1 outbox unique key. Replay of the same authority signal is identical. */
  dedupeKey: string;
  job: AEmotionAuthorityOutboxJobV1;
  source: AEmotionCommittedAuthoritySourceV1;
}

export interface CompileAEmotionBeatAuthorityInputV1 {
  sourceKind: "BEAT_COMMITTED";
  roomId: string;
  committedAt: string;
  /** Exact hash of the committed BEAT_APPLIED ledger event to compile. */
  beatEventHash: string;
  /** Complete committed ledger prefix ending at or after beatEventHash. */
  ledgerEvents: WorkingLedgerEventV1[];
}

export interface CompileAEmotionFormalCommitmentAuthorityInputV1 {
  sourceKind: "FORMAL_COMMITMENT_COMMITTED";
  roomId: string;
  committedAt: string;
  /** Exact hash of the committed FORMAL_COMMITMENT_APPLIED ledger event. */
  commitmentEventHash: string;
  /** Complete committed ledger prefix ending at or after commitmentEventHash. */
  ledgerEvents: WorkingLedgerEventV1[];
}

export interface CompileAEmotionChapterAuthorityInputV1 {
  sourceKind: "CHAPTER_SETTLEMENT_COMMITTED";
  roomId: string;
  committedAt: string;
  record: AtomicChapterCommitRecordV1;
  /** Complete committed chapter ledger whose head is record.sealedInput.decisionLedgerHash. */
  ledgerEvents: WorkingLedgerEventV1[];
}

export interface AEmotionFinaleChapterAuthorityV1 {
  bundle: FrozenChapterBundleV1;
  /** Complete committed ledger whose head is bundle.decisionLedgerHash. */
  ledgerEvents: WorkingLedgerEventV1[];
}

export interface CompileAEmotionFinaleAuthorityInputV1 {
  sourceKind: "FINALE_COMMITTED";
  roomId: string;
  record: AuthorityFirstTerminalRecordV1;
  /** N1..N7 frozen authority and their complete ledgers. */
  chapters: AEmotionFinaleChapterAuthorityV1[];
}

export interface AEmotionContentSourceCompilerDependenciesV1 {
  policy: PublishedSangtianAEmotionPolicyV1;
  contentPackage: LoadedSangtianPressureChapterPackageV1;
}

/**
 * Deterministic post-commit source compiler.
 *
 * It consumes only validated authority records and their hash-linked ledgers.
 * It has no repository, Provider, UI, narrative, or authority-write capability.
 */
export class SangtianAEmotionContentSourceCompilerV1 {
  constructor(private readonly dependencies: Readonly<AEmotionContentSourceCompilerDependenciesV1>) {
    const { policy, contentPackage } = dependencies;
    if (
      policy.policy.sourceBinding.contentPackageVersion !== contentPackage.manifest.packageVersion
      || policy.policy.sourceBinding.contentPackageSha256 !== contentPackage.manifest.contentSha256
    ) {
      invalid("compiler.contentPackage", "POLICY_PACKAGE_MISMATCH");
    }
  }

  /** P0/Genesis establishes state but has no interaction signal. */
  compileGenesis(): readonly [] {
    return Object.freeze([]);
  }

  compileBeat(rawInput: unknown): AEmotionAuthorityEmissionV1[] {
    const input = beatInput(rawInput);
    const projection = projectWorkingLedger(input.ledgerEvents);
    const event = input.ledgerEvents.find((candidate) => candidate.eventHash === input.beatEventHash);
    if (!event || event.payload.eventType !== "BEAT_APPLIED") {
      invalid("input.beatEventHash", "COMMITTED_BEAT_EVENT_NOT_FOUND");
    }
    const beat = event.payload.beatResolution;
    if (
      projection.key.runId !== beat.runId
      || projection.key.chapterRuntimeId !== beat.chapterRuntimeId
      || event.chapterId !== projection.chapterId
    ) {
      invalid("input.ledgerEvents", "BEAT_CONTEXT_MISMATCH");
    }
    // Each action may produce two disclosure cohorts (authority-proven
    // CONFIRMED and conservative HIDDEN), both inside the Beat's 1,000-slot
    // sequence range.
    if (beat.committedWorkingRevision > 9_998 || beat.sealedActionIds.length > 499) {
      invalid("input.ledgerEvents", "EVENT_SEQUENCE_CAPACITY_EXCEEDED");
    }
    const emissions: AEmotionAuthorityEmissionV1[] = [];
    const actions = beat.sealedActionIds.map((actionId) => {
      const accepted = projection.acceptedActions.get(actionId);
      if (!accepted) invalid("input.ledgerEvents", `MISSING_ACTION_${actionId}`);
      return accepted;
    }).sort(compareAcceptedActions);
    actions.forEach((accepted, index) => {
      const template = this.dependencies.policy.compileTemplate({
        sourceKind: "BEAT_COMMITTED",
        chapterId: event.chapterId,
        actionType: accepted.action.actionType,
      });
      if (!template) return;
      const sourceActionId = accepted.action.actionId;
      const evidenceRefs = sortedUnique(accepted.intent.evidenceRefs);
      const impacts = beatImpacts(beat, sourceActionId);
      const commitmentIds = beat.workingDelta.commitmentMutations
        .filter((mutation) => mutation.sourceActionId === sourceActionId)
        .map((mutation) => mutation.commitmentId)
        .sort(compareCanonicalText);
      const audienceSeatIds = canonicalSeats(accepted.audienceSeatIds);
      const confirmedSeats = evidenceRefs.length > 0
        ? audienceSeatIds.filter((seatId) => seatId === accepted.action.seatId)
        : [];
      const hiddenSeats = evidenceRefs.length > 0
        ? audienceSeatIds.filter((seatId) => seatId !== accepted.action.seatId)
        : audienceSeatIds;
      const cohorts = [
        { kind: "CONFIRMED" as const, seatIds: confirmedSeats, evidenceRefs },
        { kind: "HIDDEN" as const, seatIds: hiddenSeats, evidenceRefs: [] as string[] },
      ].filter((cohort) => cohort.seatIds.length > 0);
      cohorts.forEach((cohort, cohortIndex) => {
        const signalId = [
          "beat", event.eventHash, sourceActionId, template.eventCode, cohort.kind.toLowerCase(),
        ].join(":");
        const compiledSignal = signal(template, {
          signalId,
          sharedObjectId: commitmentIds[0] ?? null,
          factRefs: [],
          publicFactRefs: [],
          impacts,
          audienceSpec: {
            type: "EXPLICIT",
            seatIds: cohort.seatIds,
          },
          evidenceRefs: cohort.evidenceRefs,
          milestoneId: null,
          stateVersion: beat.committedWorkingRevision,
        });
        emissions.push(this.emit({
          sourceKind: "BEAT_COMMITTED",
          sourceId: event.eventHash,
          sourceCommitHash: event.eventHash,
          roomId: input.roomId,
          runId: event.runId,
          stageId: event.chapterId,
          sourceActionId,
          sourceSeatId: accepted.action.seatId,
          committedAt: input.committedAt,
          eventSequence: chapterSequence(event.chapterId) * 10_000_000
            + beat.committedWorkingRevision * 1_000 + index * 2 + cohortIndex + 1,
          stateVersion: beat.committedWorkingRevision,
          storyDay: chapterSequence(event.chapterId),
          signal: deriveCrossImpactPresentationV1({
            sourceSeatId: accepted.action.seatId,
            signal: compiledSignal,
          }),
        }));
      });
    });
    return freezeEmissions(emissions);
  }

  /**
   * Compiles an independently committed formal Promise mutation without
   * resolving the current Decision Beat. BREAK stays HIDDEN here: only a
   * later evidence-authorized investigation may upgrade it or show a modal.
   */
  compileFormalCommitment(rawInput: unknown): AEmotionAuthorityEmissionV1[] {
    const input = formalCommitmentInput(rawInput);
    const projection = projectWorkingLedger(input.ledgerEvents);
    const event = input.ledgerEvents.find(
      (candidate) => candidate.eventHash === input.commitmentEventHash,
    );
    if (!event || event.payload.eventType !== "FORMAL_COMMITMENT_APPLIED") {
      invalid("input.commitmentEventHash", "COMMITTED_FORMAL_COMMITMENT_EVENT_NOT_FOUND");
    }
    if (
      projection.key.runId !== event.runId
      || projection.key.chapterRuntimeId !== event.chapterRuntimeId
      || projection.chapterId !== event.chapterId
    ) invalid("input.ledgerEvents", "FORMAL_COMMITMENT_CONTEXT_MISMATCH");
    const committed = projection.commitmentActionsByIdempotencyKey?.get(
      event.payload.action.idempotencyKey,
    );
    if (!committed || committed.eventHash !== event.eventHash) {
      invalid("input.ledgerEvents", "FORMAL_COMMITMENT_NOT_PROJECTED");
    }
    const { action, mutation } = event.payload;
    const operation = formalPromiseOperation(action, mutation.operation);
    if (operation === null) return freezeEmissions([]);
    const isBroken = mutation.operation === "BREAK";
    const evidenceRefs = isBroken ? [] : [event.eventHash];
    const signalId = [
      "formal-commitment", event.eventHash, mutation.commitmentId, mutation.operation,
    ].join(":");
    return freezeEmissions([this.emit({
      sourceKind: "FORMAL_COMMITMENT_COMMITTED",
      sourceId: event.eventHash,
      sourceCommitHash: event.eventHash,
      roomId: input.roomId,
      runId: event.runId,
      stageId: event.chapterId,
      sourceActionId: action.actionId,
      sourceSeatId: action.seatId,
      committedAt: input.committedAt,
      eventSequence: chapterSequence(event.chapterId) * 10_000_000 + 5_000_000 + event.sequence,
      stateVersion: event.sequence,
      storyDay: chapterSequence(event.chapterId),
      signal: deriveCrossImpactPresentationV1({
        sourceSeatId: action.seatId,
        signal: {
          signalId,
          kind: isBroken ? "DIRECT_IMPACT" : "PUBLIC_ACTION",
          eventCode: operation.eventCode,
          eventFamily: isBroken ? "LEDGER_FLOW" : "PROMISE",
          severity: isBroken ? "MAJOR" : "MINOR",
          sharedObjectId: isBroken ? "original-grain-ledger" : mutation.commitmentId,
          factRefs: isBroken ? [] : [operation.factCode],
          publicFactRefs: [],
          impacts: mutation.seatIds.map((seatId) => ({
            targetSeatId: seatId,
            visibility: "TARGET_ONLY" as const,
            type: "SHARED_OBJECT" as const,
            key: mutation.commitmentId,
            before: null,
            after: mutation.operation,
            delta: null,
            effectCode: operation.effectCode,
          })),
          audienceSpec: {
            type: "EXPLICIT",
            seatIds: canonicalSeats(isBroken
              ? [...event.payload.audienceSeatIds, "qingliu_law"]
              : event.payload.audienceSeatIds),
          },
          disclosure: isBroken ? "HIDDEN" : "CONFIRMED",
          suspectedSeatIds: [],
          suspicionBasisRefs: [],
          evidenceRefs,
          revealOfEventId: null,
          promiseId: mutation.commitmentId,
          milestoneId: null,
          metricTransitionId: null,
          presentation: {
            recommendedPresentation: isBroken ? "CENTER_CARD" : "FEED_ONLY",
            centerCardType: isBroken ? "CROSS_IMPACT" : null,
            responseOptions: [],
            modalTrigger: null,
          },
        },
      }),
    })]);
  }

  compileChapter(rawInput: unknown): AEmotionAuthorityEmissionV1[] {
    const input = chapterInput(rawInput);
    const record = validateAtomicChapterCommitRecordV1(input.record);
    const projection = projectWorkingLedger(input.ledgerEvents);
    assertChapterLedger(record, projection);
    this.assertReleasedChapterPolicy(record);
    const outcome = chapterOutcome(record);
    const template = this.dependencies.policy.compileTemplate({
      sourceKind: "CHAPTER_SETTLEMENT_COMMITTED",
      chapterId: record.chapterId,
      outcomeBand: outcome.band,
    });
    if (!template) invalid("policy.chapter", `MISSING_${outcome.band}`);
    assertPublicChapterOutcome(record, outcome.factRef);
    const emissions: AEmotionAuthorityEmissionV1[] = [];
    const actions = [...projection.acceptedActions.values()].sort(compareAcceptedActions);
    const arcBySeat = new Map(record.settlement.seatArcDeltas.map((delta) => [delta.seatId, delta]));
    PRESSURE_CHAPTER_SEAT_IDS_V1.forEach((seatId, index) => {
      const accepted = actions.find((candidate) => candidate.action.seatId === seatId);
      const arc = arcBySeat.get(seatId);
      if (!accepted || !arc) return;
      const evidenceRefs = record.frozenChapterBundle.frozenWorldState.evidence
        .filter((evidence) => (
          evidence.holderSeatIds.includes(seatId)
          && evidence.supportsFactRefs.includes(outcome.factRef)
        ))
        .map((evidence) => evidence.evidenceId)
        .sort(compareCanonicalText);
      const signalId = [
        "chapter", record.receipt.commitHash, seatId, outcome.band,
      ].join(":");
      const milestoneId = template.milestoneMode === "NONE"
        ? null
        : `chapter:${record.chapterId}:${outcome.band}`;
      let compiledSignal = signal(template, {
        signalId,
        sharedObjectId: `chapter:${record.chapterId}:outcome:${outcome.band}`,
        factRefs: [outcome.factRef],
        publicFactRefs: [outcome.factRef],
        impacts: [{
          targetSeatId: seatId,
          visibility: "TARGET_ONLY",
          type: "GOAL_PROGRESS",
          key: "publicGoalProgress",
          before: null,
          after: arc.afterState.publicGoalProgress,
          delta: null,
          effectCode: `SANGTIAN_CHAPTER_ARC_${outcome.band}`,
        }],
        audienceSpec: { type: "AFFECTED_SEATS", seatIds: [seatId] },
        evidenceRefs,
        milestoneId,
        stateVersion: record.frozenChapterBundle.committedWorldSequence,
      });
      if (outcome.band === "LOW") {
        compiledSignal = deriveStateTransitionPresentationV1({
          signal: compiledSignal,
          stateVersion: record.frozenChapterBundle.committedWorldSequence,
          metric: {
            metricTransitionId: `run:${record.runId}:chapter-outcome-health`,
            beforeTone: priorChapterOutcomeTone(record),
            afterTone: "DANGER",
          },
        });
      } else if (outcome.band === "HIGH" && milestoneId) {
        compiledSignal = deriveStateTransitionPresentationV1({
          signal: compiledSignal,
          stateVersion: record.frozenChapterBundle.committedWorldSequence,
          milestone: {
            milestoneId,
            beforeState: "INACTIVE",
            afterState: "ACHIEVED",
          },
        });
      }
      emissions.push(this.emit({
        sourceKind: "CHAPTER_SETTLEMENT_COMMITTED",
        sourceId: record.receipt.settlementId,
        sourceCommitHash: record.receipt.commitHash,
        roomId: input.roomId,
        runId: record.runId,
        stageId: record.chapterId,
        sourceActionId: accepted.action.actionId,
        sourceSeatId: seatId,
        committedAt: input.committedAt,
        eventSequence: chapterSequence(record.chapterId) * 10_000_000 + 9_999_000 + index + 1,
        stateVersion: record.frozenChapterBundle.committedWorldSequence,
        storyDay: chapterSequence(record.chapterId),
        signal: compiledSignal,
      }));
    });
    return freezeEmissions(emissions);
  }

  compileFinale(rawInput: unknown): AEmotionAuthorityEmissionV1[] {
    const input = finaleInput(rawInput);
    const record = validateAuthorityFirstTerminalRecordV1(input.record);
    if (record.decision.packageSha256 !== this.dependencies.policy.policy.sourceBinding.contentPackageSha256) {
      invalid("input.record.decision.packageSha256", "POLICY_PACKAGE_MISMATCH");
    }
    const actions = this.finalRunActions(record, input.chapters);
    const emissions: AEmotionAuthorityEmissionV1[] = [];
    PRESSURE_CHAPTER_SEAT_IDS_V1.forEach((seatId, index) => {
      const seatOutcome = record.decision.seats.find((candidate) => candidate.seatId === seatId);
      if (!seatOutcome) invalid("input.record.decision.seats", `MISSING_${seatId}`);
      const accepted = [...actions.values()]
        .filter((candidate) => candidate.action.seatId === seatId)
        .sort(compareAcceptedActions)
        .at(-1);
      if (!accepted) return;
      const template = this.dependencies.policy.compileTemplate({
        sourceKind: "FINALE_COMMITTED",
        verdict: seatOutcome.verdict,
      });
      if (!template) invalid("policy.finale", `MISSING_${seatOutcome.verdict}`);
      const signalId = [
        "finale", record.authorityCommitHash, seatId, seatOutcome.verdict,
      ].join(":");
      emissions.push(this.emit({
        sourceKind: "FINALE_COMMITTED",
        sourceId: record.authorityCommitHash,
        sourceCommitHash: record.authorityCommitHash,
        roomId: input.roomId,
        runId: record.runId,
        stageId: "FINALE",
        sourceActionId: accepted.action.actionId,
        sourceSeatId: seatId,
        committedAt: record.decision.decidedAt,
        eventSequence: 80_000_000 + index + 1,
        stateVersion: 8,
        storyDay: 8,
        signal: signal(template, {
          signalId,
          sharedObjectId: `finale:${record.decision.worldOutcome.outcomeId}:seat:${seatId}`,
          factRefs: [],
          publicFactRefs: [],
          impacts: [{
            targetSeatId: seatId,
            visibility: "TARGET_ONLY",
            type: seatOutcome.verdict === "WIN" ? "GOAL_PROGRESS" : "RISK",
            key: "finaleVerdict",
            before: null,
            after: seatOutcome.verdict,
            delta: null,
            effectCode: `SANGTIAN_FINALE_VERDICT_${seatOutcome.verdict}`,
          }],
          audienceSpec: { type: "AFFECTED_SEATS", seatIds: [seatId] },
          // FinaleDecision has cause/result refs, but no seat-authorized evidence
          // grant. Keep the source hidden instead of upgrading disclosure.
          evidenceRefs: [],
          milestoneId: template.milestoneMode === "NONE"
            ? null
            : `finale:${record.decision.worldOutcome.outcomeId}:${seatId}:${seatOutcome.verdict}`,
          stateVersion: 8,
        }),
      }));
    });
    return freezeEmissions(emissions);
  }

  private finalRunActions(
    record: AuthorityFirstTerminalRecordV1,
    rawChapters: AEmotionFinaleChapterAuthorityV1[],
  ): Map<string, AcceptedFormalActionV1> {
    if (rawChapters.length !== 7) invalid("input.chapters", "EXPECTED_N1_TO_N7");
    let previousHash = record.decision.genesisHash;
    const actions = new Map<string, AcceptedFormalActionV1>();
    for (let index = 0; index < rawChapters.length; index += 1) {
      const raw = rawChapters[index]!;
      const bundle = validateFrozenChapterBundleV1(raw.bundle, previousHash);
      const expectedHash = record.decision.frozenChapterBundleHashes[index];
      if (
        bundle.chapterSequence !== index + 1
        || bundle.bundleHash !== expectedHash
        || bundle.runId !== record.runId
      ) {
        invalid(`input.chapters[${index}]`, "TERMINAL_BUNDLE_MISMATCH");
      }
      const projection = projectWorkingLedger(raw.ledgerEvents);
      if (
        projection.key.runId !== record.runId
        || projection.chapterId !== bundle.chapterId
        || projection.headHash !== bundle.decisionLedgerHash
      ) {
        invalid(`input.chapters[${index}].ledgerEvents`, "BUNDLE_LEDGER_MISMATCH");
      }
      for (const [actionId, accepted] of projection.acceptedActions) {
        if (actions.has(actionId)) invalid("input.chapters", `DUPLICATE_ACTION_${actionId}`);
        actions.set(actionId, accepted);
      }
      previousHash = bundle.bundleHash;
    }
    return actions;
  }

  private assertReleasedChapterPolicy(record: AtomicChapterCommitRecordV1): void {
    const chapter = this.dependencies.contentPackage.content.chapters.find(
      (candidate) => candidate.chapterId === record.chapterId,
    );
    if (
      !chapter
      || record.sealedInput.contentPolicyVersion !== chapter.settlementPolicy.policyVersion
      || record.sealedInput.contentPolicyHash !== sha256Canonical(chapter.settlementPolicy)
      || record.frozenChapterBundle.settlementPolicyVersion !== chapter.settlementPolicy.policyVersion
    ) {
      invalid("input.record.sealedInput.contentPolicyHash", "RELEASED_POLICY_MISMATCH");
    }
  }

  private emit(
    draft: Omit<AEmotionCommittedAuthoritySourceV1, "schemaVersion" | "sourceBindingHash">,
  ): AEmotionAuthorityEmissionV1 {
    const job = sealAEmotionAuthorityOutboxJobV1({
      schemaVersion: "a_emotion_authority_outbox_job_v1",
      sourceKind: draft.sourceKind,
      runId: draft.runId,
      sourceId: draft.sourceId,
      sourceCommitHash: draft.sourceCommitHash,
      signalId: draft.signal.signalId,
    });
    const source = sealAEmotionCommittedAuthoritySourceV1({
      schemaVersion: "a_emotion_committed_authority_source_v1",
      ...draft,
    }, job);
    return Object.freeze({
      dedupeKey: `aemotion:${job.jobHash}`,
      job,
      source,
    });
  }
}

export function createSangtianAEmotionContentSourceCompilerV1(
  options: Readonly<{ releaseRoot?: string; packageRoot?: string }> = {},
): SangtianAEmotionContentSourceCompilerV1 {
  return new SangtianAEmotionContentSourceCompilerV1({
    policy: loadPublishedSangtianAEmotionPolicyV1({ releaseRoot: options.releaseRoot }),
    contentPackage: loadSangtianPressureChapterPackageV1(options.packageRoot),
  });
}

function signal(
  template: SangtianAEmotionEventTemplateV1,
  value: {
    signalId: string;
    sharedObjectId: string | null;
    factRefs: string[];
    publicFactRefs: string[];
    impacts: ImpactV1[];
    audienceSpec: AEmotionInteractionEventPortV1["audienceSpec"];
    evidenceRefs: string[];
    milestoneId: string | null;
    stateVersion: number;
  },
): AEmotionCommittedAuthoritySourceV1["signal"] {
  const modalTrigger = template.presentation.modalType === null ? null : {
    type: template.presentation.modalType,
    triggerId: `${value.signalId}:modal`,
    stateVersion: value.stateVersion,
  };
  return {
    signalId: value.signalId,
    kind: template.kind,
    eventCode: template.eventCode,
    eventFamily: template.eventFamily,
    severity: template.severity,
    sharedObjectId: value.sharedObjectId,
    factRefs: sortedUnique(value.factRefs),
    publicFactRefs: sortedUnique(value.publicFactRefs),
    impacts: [...value.impacts].sort((left, right) => (
      compareCanonicalText(sha256Canonical(left), sha256Canonical(right))
    )),
    audienceSpec: structuredClone(value.audienceSpec),
    disclosure: value.evidenceRefs.length > 0 ? "CONFIRMED" : "HIDDEN",
    suspectedSeatIds: [],
    suspicionBasisRefs: [],
    evidenceRefs: sortedUnique(value.evidenceRefs),
    revealOfEventId: null,
    promiseId: null,
    milestoneId: value.milestoneId,
    metricTransitionId: null,
    presentation: {
      recommendedPresentation: template.presentation.recommendedPresentation,
      centerCardType: template.presentation.centerCardType,
      responseOptions: template.presentation.responseOptions.map((option) => ({ ...option })),
      modalTrigger,
    },
  };
}

function beatImpacts(
  beat: Extract<WorkingLedgerEventV1["payload"], { eventType: "BEAT_APPLIED" }>["beatResolution"],
  actionId: string,
): ImpactV1[] {
  const impacts: ImpactV1[] = [];
  for (const mutation of beat.workingDelta.commitmentMutations) {
    if (mutation.sourceActionId !== actionId) continue;
    for (const seatId of canonicalSeats(mutation.seatIds)) {
      impacts.push({
        targetSeatId: seatId,
        visibility: "TARGET_ONLY",
        type: "SHARED_OBJECT",
        key: mutation.commitmentId,
        before: null,
        after: mutation.operation,
        delta: null,
        effectCode: `SANGTIAN_COMMITMENT_${mutation.operation}`,
      });
    }
  }
  for (const mutation of beat.workingDelta.seatArcWorkingMutations) {
    if (mutation.sourceActionId !== actionId) continue;
    impacts.push({
      targetSeatId: mutation.seatId,
      visibility: "TARGET_ONLY",
      type: "GOAL_PROGRESS",
      key: "workingGoalProgress",
      before: null,
      after: null,
      delta: mutation.progressDelta,
      effectCode: "SANGTIAN_WORKING_ARC_DELTA",
    });
  }
  for (const mutation of beat.reservationMutations) {
    if (mutation.sourceActionId !== actionId) continue;
    impacts.push({
      targetSeatId: mutation.seatId,
      visibility: "TARGET_ONLY",
      type: "RESOURCE",
      key: mutation.resourceId,
      before: null,
      after: mutation.operation,
      delta: null,
      effectCode: `SANGTIAN_RESERVATION_${mutation.operation}`,
    });
  }
  return impacts;
}

function assertChapterLedger(
  record: AtomicChapterCommitRecordV1,
  projection: WorkingLedgerProjectionV1,
): void {
  const expectedIds = [...record.sealedInput.sealedDecisionActionIds].sort(compareCanonicalText);
  const actualIds = [...projection.acceptedActions.keys()].sort(compareCanonicalText);
  if (
    projection.key.runId !== record.runId
    || projection.key.chapterRuntimeId !== record.chapterRuntimeId
    || projection.chapterId !== record.chapterId
    || projection.headHash !== record.sealedInput.decisionLedgerHash
    || sha256Canonical(actualIds) !== sha256Canonical(expectedIds)
  ) {
    invalid("input.ledgerEvents", "CHAPTER_AUTHORITY_MISMATCH");
  }
}

function chapterOutcome(record: AtomicChapterCommitRecordV1): {
  factRef: string;
  band: SangtianAEmotionOutcomeBandV1;
} {
  const factRef = `chapter.${record.chapterId}.outcome_band`;
  const matches = record.settlement.worldDelta.factMutations.filter(
    (mutation) => mutation.factRef === factRef,
  );
  const after = matches[0]?.after;
  if (matches.length !== 1 || !["HIGH", "LOW", "MID"].includes(String(after))) {
    invalid("input.record.settlement.worldDelta", "CHAPTER_OUTCOME_MISSING");
  }
  return { factRef, band: after as SangtianAEmotionOutcomeBandV1 };
}

function assertPublicChapterOutcome(record: AtomicChapterCommitRecordV1, factRef: string): void {
  const world = record.frozenChapterBundle.frozenWorldState;
  if (
    world.factValues[factRef] === undefined
    || PRESSURE_CHAPTER_SEAT_IDS_V1.some(
      (seatId) => !world.knowledgeBySeat[seatId].knownFactRefs.includes(factRef),
    )
  ) {
    invalid("input.record.frozenChapterBundle.frozenWorldState", "OUTCOME_NOT_PUBLIC");
  }
}

function priorChapterOutcomeTone(
  record: AtomicChapterCommitRecordV1,
): "DEFAULT" | "DANGER" {
  const sequence = chapterSequence(record.chapterId);
  if (sequence === 1) return "DEFAULT";
  const priorFactRef = `chapter.N${sequence - 1}.outcome_band`;
  const priorBand = record.frozenChapterBundle.frozenWorldState.factValues[priorFactRef];
  if (!["HIGH", "MID", "LOW"].includes(String(priorBand))) {
    invalid("input.record.frozenChapterBundle.frozenWorldState", "PRIOR_OUTCOME_MISSING");
  }
  return priorBand === "LOW" ? "DANGER" : "DEFAULT";
}

function beatInput(value: unknown): CompileAEmotionBeatAuthorityInputV1 {
  const input = exactInput(value, [
    "sourceKind", "roomId", "committedAt", "beatEventHash", "ledgerEvents",
  ]);
  literal(input.sourceKind, "BEAT_COMMITTED", "input.sourceKind");
  common(input.roomId, input.committedAt);
  hash(input.beatEventHash, "input.beatEventHash");
  if (!Array.isArray(input.ledgerEvents)) invalid("input.ledgerEvents", "ARRAY");
  return structuredClone(input) as unknown as CompileAEmotionBeatAuthorityInputV1;
}

function formalCommitmentInput(value: unknown): CompileAEmotionFormalCommitmentAuthorityInputV1 {
  const input = exactInput(value, [
    "sourceKind", "roomId", "committedAt", "commitmentEventHash", "ledgerEvents",
  ]);
  literal(input.sourceKind, "FORMAL_COMMITMENT_COMMITTED", "input.sourceKind");
  common(input.roomId, input.committedAt);
  hash(input.commitmentEventHash, "input.commitmentEventHash");
  if (!Array.isArray(input.ledgerEvents)) invalid("input.ledgerEvents", "ARRAY");
  return structuredClone(input) as unknown as CompileAEmotionFormalCommitmentAuthorityInputV1;
}

function formalPromiseOperation(
  action: DecisionActionV1,
  mutation: "CREATE" | "FULFILL" | "BREAK" | "CANCEL",
): { eventCode: string; factCode: string; effectCode: string } | null {
  const type = action.actionType;
  if (mutation === "CANCEL") return null;
  if (mutation === "CREATE") {
    if (!type.startsWith("CREATE_SIMPLE_PROMISE_")) {
      invalid("input.ledgerEvents.action.actionType", "EXPLICIT_PROMISE_CREATE_REQUIRED");
    }
    return {
      eventCode: "FORMAL_PROMISE_CREATED",
      factCode: "fact.formal-promise.created",
      effectCode: "SANGTIAN_FORMAL_PROMISE_CREATED",
    };
  }
  if (mutation === "FULFILL" && type === "PROMISE_DELIVER_ORIGINAL_FULFILL") {
    return {
      eventCode: "PROMISE_DELIVER_LEDGER_FULFILLED",
      factCode: "fact.formal-promise.fulfilled",
      effectCode: "SANGTIAN_FORMAL_PROMISE_FULFILLED",
    };
  }
  if (
    mutation === "BREAK"
    && (type === "PROMISE_DELIVER_COPY_BREAK" || type === "PROMISE_HIDE_OR_DELAY_BREAK")
  ) {
    return {
      eventCode: "LEDGER_DELIVERY_ANOMALY",
      factCode: "fact.formal-promise.broken-hidden",
      effectCode: "SANGTIAN_FORMAL_PROMISE_BROKEN_HIDDEN",
    };
  }
  invalid("input.ledgerEvents.action.actionType", "EXPLICIT_PROMISE_OPERATION_REQUIRED");
}

function chapterInput(value: unknown): CompileAEmotionChapterAuthorityInputV1 {
  const input = exactInput(value, [
    "sourceKind", "roomId", "committedAt", "record", "ledgerEvents",
  ]);
  literal(input.sourceKind, "CHAPTER_SETTLEMENT_COMMITTED", "input.sourceKind");
  common(input.roomId, input.committedAt);
  if (!Array.isArray(input.ledgerEvents)) invalid("input.ledgerEvents", "ARRAY");
  return structuredClone(input) as unknown as CompileAEmotionChapterAuthorityInputV1;
}

function finaleInput(value: unknown): CompileAEmotionFinaleAuthorityInputV1 {
  const input = exactInput(value, ["sourceKind", "roomId", "record", "chapters"]);
  literal(input.sourceKind, "FINALE_COMMITTED", "input.sourceKind");
  nonEmpty(input.roomId, "input.roomId");
  if (!Array.isArray(input.chapters)) invalid("input.chapters", "ARRAY");
  input.chapters.forEach((candidate, index) => {
    const chapter = record(candidate, `input.chapters[${index}]`);
    exactKeys(chapter, ["bundle", "ledgerEvents"], `input.chapters[${index}]`);
    if (!Array.isArray(chapter.ledgerEvents)) invalid(`input.chapters[${index}].ledgerEvents`, "ARRAY");
  });
  return structuredClone(input) as unknown as CompileAEmotionFinaleAuthorityInputV1;
}

function exactInput(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const input = record(value, "input");
  exactKeys(input, keys, "input");
  return input;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path, "OBJECT");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  const missing = keys.find((key) => !(key in value));
  if (unknown) invalid(`${path}.${unknown}`, "FORBIDDEN_OR_UNKNOWN_FIELD");
  if (missing) invalid(`${path}.${missing}`, "MISSING_FIELD");
}

function common(roomId: unknown, committedAt: unknown): void {
  nonEmpty(roomId, "input.roomId");
  nonEmpty(committedAt, "input.committedAt");
  if (!Number.isFinite(Date.parse(committedAt as string)) || new Date(committedAt as string).toISOString() !== committedAt) {
    invalid("input.committedAt", "ISO_8601_UTC");
  }
}

function nonEmpty(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) invalid(path, "NON_EMPTY_STRING");
}

function hash(value: unknown, path: string): asserts value is string {
  if (!isSha256(value)) invalid(path, "SHA256_LOWER_HEX");
}

function literal(value: unknown, expected: string, path: string): void {
  if (value !== expected) invalid(path, `EXPECTED_${expected}`);
}

function compareAcceptedActions(left: AcceptedFormalActionV1, right: AcceptedFormalActionV1): number {
  const chapter = chapterSequence(left.action.chapterId) - chapterSequence(right.action.chapterId);
  if (chapter !== 0) return chapter;
  return left.action.actionOrdinal - right.action.actionOrdinal
    || left.action.actionRevision - right.action.actionRevision
    || compareCanonicalText(left.action.actionId, right.action.actionId);
}

function canonicalSeats(values: readonly SeatIdV1[]): SeatIdV1[] {
  const indexes = new Map(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => [seatId, index]));
  return [...new Set(values)].sort((left, right) => indexes.get(left)! - indexes.get(right)!);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalText);
}

function freezeEmissions(values: AEmotionAuthorityEmissionV1[]): AEmotionAuthorityEmissionV1[] {
  return Object.freeze(values.map((value) => Object.freeze(value))) as unknown as AEmotionAuthorityEmissionV1[];
}

function invalid(path: string, detail?: string): never {
  return failAEmotionProduction(ERROR.AUTHORITY_SOURCE_INVALID, path, detail);
}
