import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  loadPublishedSangtianAEmotionLifecycleBindingsV1,
  type PublishedSangtianAEmotionLifecycleBindingsV1,
} from "@ai-story/templates";
import {
  deriveCommittedPressureInvestigationAuthorityV1,
  sealPressureDisclosureUpgradeBindingV1,
  sealPressurePromiseAEmotionBindingV1,
} from "../a-emotion-lifecycle";
import {
  decodeAggregateEnvelope,
  decodeDeliveryMark,
  decodeInteractionEnvelope,
} from "../a-emotion-persistence/codec";
import type { AEmotionInteractionEventPortV1 } from "../a-emotion/ports";
import { pressureSimplePromiseIdV1 } from "../a-emotion-promise/policy";
import type {
  WorkingLedgerEventV1,
  WorkingLedgerProjectionV1,
} from "../working-ledger/contracts";
import type { AEmotionAuthorityEmissionV1 } from "./content-source";
import { compilePressureAEmotionLifecycleUpgradeV1 } from "./lifecycle-source";

const INTERACTION_EVENT_TYPE = "PRESSURE_A_EMOTION_INTERACTION_V1";
const AGGREGATE_EVENT_TYPE = "PRESSURE_A_EMOTION_AGGREGATE_V1";
const DELIVERY_MARK_EVENT_TYPE = "PRESSURE_A_EMOTION_DELIVERY_MARK_V1";
const INVESTIGATOR_SEAT: SeatIdV1 = "qingliu_law";

interface LifecycleStoryEventRowV1 {
  payloadJson: unknown;
}

export interface PressureInvestigationLifecycleReadTransactionV1 {
  storyEvent: {
    findMany(input: Record<string, unknown>): Promise<LifecycleStoryEventRowV1[]>;
  };
}

/**
 * Read-only bridge from one already committed Beat to A-Emotion outbox input.
 * It never trusts prose or client supplied effect/fact/evidence authority.
 */
export async function compileCommittedInvestigationLifecycleEmissionsV1(input: Readonly<{
  tx: PressureInvestigationLifecycleReadTransactionV1;
  beatEvent: WorkingLedgerEventV1;
  projection: WorkingLedgerProjectionV1;
  committedAt: string;
  release?: PublishedSangtianAEmotionLifecycleBindingsV1;
}>): Promise<AEmotionAuthorityEmissionV1[]> {
  if (input.beatEvent.payload.eventType !== "BEAT_APPLIED") return [];
  const beat = input.beatEvent.payload.beatResolution;
  const published = input.release ?? loadPublishedSangtianAEmotionLifecycleBindingsV1();
  const bindings = published.bindings;
  if (
    bindings.authorityBoundary.providerCallsAllowed
    || bindings.authorityBoundary.freeTextInferenceAllowed
    || bindings.authorityBoundary.frozenWorldFactMutationAllowed
  ) return [];

  const candidates = beat.sealedActionIds
    .map((actionId) => input.projection.acceptedActions.get(actionId))
    .filter((accepted): accepted is NonNullable<typeof accepted> => Boolean(accepted))
    .filter((accepted) => accepted.action.seatId === INVESTIGATOR_SEAT)
    .sort((left, right) => left.action.actionId.localeCompare(right.action.actionId, "en"));
  if (candidates.length > 1) return [];
  const emissions: AEmotionAuthorityEmissionV1[] = [];
  for (const accepted of candidates) {
    const frozen = bindings.disclosureLifecycle.transitions.find(
      (transition) => transition.actionCode === accepted.action.actionType,
    );
    if (!frozen) continue;
    const disclosureBinding = sealPressureDisclosureUpgradeBindingV1({
      bindingId: frozen.bindingId,
      fromDisclosure: frozen.fromDisclosure,
      toDisclosure: frozen.toDisclosure,
      actionCode: frozen.actionCode,
      effectCode: frozen.effectCode,
      factCode: frozen.factCode,
      suspectedSeatIds: [...frozen.suspectedSeatIds],
    });
    const derived = deriveCommittedPressureInvestigationAuthorityV1({
      sourceKind: "BEAT_COMMITTED",
      sourceId: input.beatEvent.eventHash,
      sourceCommitHash: input.beatEvent.eventHash,
      committedAt: input.committedAt,
      action: accepted.action,
      committedEvidenceRefs: [...accepted.intent.evidenceRefs],
      binding: disclosureBinding,
    });
    const current = await readAcknowledgedCurrentEvent(input.tx, {
      runId: input.beatEvent.runId,
      stageId: input.beatEvent.chapterId,
      responseToEventId: derived.responseToEventId,
    });
    if (!current) continue;
    if (current.audienceSpec.type !== "EXPLICIT") continue;
    const audienceSeatIds = canonicalSeats([
      bindings.canonicalRoles.promiseReceiverSeatId,
    ]);

    const promiseId = pressureSimplePromiseIdV1({
      runId: input.beatEvent.runId,
      issuerSeatId: bindings.canonicalRoles.promiseIssuerSeatId,
    });
    const promiseMutation = input.projection.commitments.get(promiseId);
    const promiseBinding = promiseMutation?.operation === "BREAK"
      ? sealPressurePromiseAEmotionBindingV1({
          bindingId: "deliver-original-ledger",
          promiseCode: "DELIVER_ORIGINAL_LEDGER",
          commitmentId: promiseId,
          sharedObjectId: bindings.formalPromise.sharedObjectId,
          issuerSeatId: bindings.canonicalRoles.promiseIssuerSeatId,
          receiverSeatId: bindings.canonicalRoles.promiseReceiverSeatId,
          revealEvidenceFactCodes: [frozen.factCode],
        })
      : null;
    emissions.push(...compilePressureAEmotionLifecycleUpgradeV1({
      roomId: input.beatEvent.runId,
      currentEvent: current,
      authority: derived.authority,
      disclosureBinding,
      promiseMutation: promiseMutation?.operation === "BREAK"
        ? structuredClone(promiseMutation)
        : null,
      promiseBinding,
      eventSequence: Math.max(
        current.eventSequence + 1,
        Number(input.beatEvent.chapterId.slice(1)) * 10_000_000
          + beat.committedWorkingRevision * 1_000 + 999,
      ),
      stateVersion: Math.max(current.stateVersion + 1, beat.committedWorkingRevision),
      storyDay: Number(input.beatEvent.chapterId.slice(1)),
      audienceSeatIds,
    }));
  }
  return emissions.sort((left, right) => left.dedupeKey.localeCompare(right.dedupeKey, "en"));
}

async function readAcknowledgedCurrentEvent(
  tx: PressureInvestigationLifecycleReadTransactionV1,
  input: Readonly<{ runId: string; stageId: string; responseToEventId: string }>,
): Promise<AEmotionInteractionEventPortV1 | null> {
  const [eventRows, aggregateRows, markRows] = await Promise.all([
    tx.storyEvent.findMany({ where: { runId: input.runId, type: INTERACTION_EVENT_TYPE } }),
    tx.storyEvent.findMany({ where: { runId: input.runId, type: AGGREGATE_EVENT_TYPE } }),
    tx.storyEvent.findMany({ where: { runId: input.runId, type: DELIVERY_MARK_EVENT_TYPE } }),
  ]);
  const events = eventRows
    .map((row) => decodeInteractionEnvelope(row.payloadJson).event)
    .filter((event) => event.eventId === input.responseToEventId);
  if (events.length !== 1) return null;
  const current = events[0]!;
  if (
    current.runId !== input.runId
    || current.stageId !== input.stageId
    || current.sharedObjectId !== "original-grain-ledger"
    || current.audienceSpec.type !== "EXPLICIT"
    || !current.audienceSpec.seatIds.includes(INVESTIGATOR_SEAT)
  ) return null;
  const allAggregates = aggregateRows
    .map((row) => decodeAggregateEnvelope(row.payloadJson).commit.aggregate)
    .filter((aggregate) => (
      aggregate.runId === input.runId
      && aggregate.stageId === input.stageId
      && aggregate.viewerSeatId === INVESTIGATOR_SEAT
  ));
  const aggregates = allAggregates
    .filter((aggregate) => (
      aggregate.latestEventId === input.responseToEventId
      && aggregate.projection.eventId === input.responseToEventId
    ))
    .sort((left, right) => right.projectionVersion - left.projectionVersion);
  const aggregate = aggregates[0];
  if (!aggregate) return null;
  const latestVersion = allAggregates
    .filter((candidate) => candidate.aggregationKey === aggregate.aggregationKey)
    .reduce((maximum, candidate) => Math.max(maximum, candidate.projectionVersion), 0);
  if (aggregate.projectionVersion !== latestVersion) return null;
  const acknowledged = markRows
    .map((row) => decodeDeliveryMark(row.payloadJson))
    .some((mark) => (
      mark.runId === input.runId
      && mark.viewerSeatId === INVESTIGATOR_SEAT
      && mark.eventId === input.responseToEventId
      && mark.projectionVersion === aggregate.projectionVersion
      && mark.operation === "ACKNOWLEDGED"
    ));
  return acknowledged ? structuredClone(current) : null;
}

function canonicalSeats(values: readonly SeatIdV1[]): SeatIdV1[] {
  const selected = new Set(values);
  return PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) => selected.has(seatId));
}
