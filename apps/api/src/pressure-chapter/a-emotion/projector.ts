import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import { compareAEmotionCanonicalText } from "./canonical-order";
import {
  A_EMOTION_PROJECTION_ERROR_CODES as ERROR,
  failAEmotionProjection,
} from "./errors";
import {
  A_EMOTION_PROJECTION_VERSION_V1,
  aEmotionAggregationKey,
  aEmotionProjectionIdempotencyKey,
} from "./identity";
import { toVisibleImpact } from "./presentation";
import type {
  AEmotionCategoryPortV1,
  AEmotionInteractionEventPortV1,
  AEmotionObserverResolverPortV1,
  AEmotionPresentationPortV1,
  AEmotionProjectionRecordV1,
  AEmotionViewerContextPortV1,
  AEmotionViewerProjectionPortV1,
} from "./ports";

const SEAT_IDS = new Set<string>(PRESSURE_CHAPTER_SEAT_IDS_V1);

function categoryFor(
  event: AEmotionInteractionEventPortV1,
  prior: AEmotionViewerProjectionPortV1 | null,
): AEmotionCategoryPortV1 {
  if (event.kind === "DIRECT_IMPACT") return "RELATED";
  if (event.kind === "PUBLIC_ACTION") return "PUBLIC";
  if (event.kind === "OBSERVABLE_TRACE") return "SUSPICIOUS";
  if (
    !prior
    || event.revealOfEventId !== prior.eventId
    || prior.roomId !== event.roomId
    || prior.runId !== event.runId
  ) failAEmotionProjection(ERROR.REVEAL_BASE_MISSING, event.eventId);
  return prior.category;
}

export { aEmotionAggregationKey } from "./identity";

function modalPriority(type: "PROMISE_BROKEN" | "CRISIS" | "STAGE_VICTORY"): 100 | 200 | 300 {
  return type === "CRISIS" ? 300 : type === "PROMISE_BROKEN" ? 200 : 100;
}

function statusLabel(disclosure: AEmotionInteractionEventPortV1["disclosure"]): string {
  if (disclosure === "HIDDEN") return "来源未知";
  if (disclosure === "SUSPECTED") return "迹象待核实";
  return "已确认";
}

async function resolveAudience(
  event: AEmotionInteractionEventPortV1,
  resolver: AEmotionObserverResolverPortV1,
): Promise<SeatIdV1[]> {
  let resolved: SeatIdV1[];
  if (event.audienceSpec.type === "OBSERVERS") {
    try {
      resolved = await resolver.resolve({
        roomId: event.roomId,
        runId: event.runId,
        resolverCode: event.audienceSpec.resolverCode,
        contextRefs: [...event.audienceSpec.contextRefs],
      });
    } catch {
      failAEmotionProjection(ERROR.AUDIENCE_RESOLUTION_FAILED, event.eventId);
    }
  } else {
    resolved = [...event.audienceSpec.seatIds];
  }
  if (resolved.some((seatId) => !SEAT_IDS.has(seatId))) {
    failAEmotionProjection(ERROR.UNKNOWN_SEAT, event.eventId);
  }
  return [...new Set(resolved)];
}

/**
 * Server-side projector. Raw event fields are never copied to the returned
 * DTO; the deterministic presentation port receives only already-authorized
 * facts and impacts.
 */
export class AEmotionViewerProjectorV1 {
  constructor(
    private readonly observerResolver: AEmotionObserverResolverPortV1,
    private readonly presentation: AEmotionPresentationPortV1,
  ) {}

  async project(input: {
    event: AEmotionInteractionEventPortV1;
    viewer: AEmotionViewerContextPortV1;
    priorProjection?: AEmotionViewerProjectionPortV1 | null;
    priorAggregationKey?: string | null;
  }): Promise<AEmotionProjectionRecordV1 | null> {
    const { event, viewer } = input;
    if (viewer.roomId !== event.roomId || viewer.runId !== event.runId || !SEAT_IDS.has(viewer.viewerSeatId)) {
      failAEmotionProjection(ERROR.CONTEXT_MISMATCH, event.eventId);
    }
    const audience = await resolveAudience(event, this.observerResolver);
    if (!audience.includes(viewer.viewerSeatId)) return null;

    if (input.priorProjection && input.priorProjection.viewerSeatId !== viewer.viewerSeatId) {
      failAEmotionProjection(ERROR.CONTEXT_MISMATCH, `${event.eventId}:PRIOR_VIEWER`);
    }
    if ((event.kind === "REVEAL") !== Boolean(input.priorProjection && input.priorAggregationKey)) {
      failAEmotionProjection(ERROR.REVEAL_BASE_MISSING, `${event.eventId}:PRIOR_AGGREGATE`);
    }
    if (input.priorProjection) {
      const expectedDisclosure = input.priorProjection.disclosure === "HIDDEN"
        ? "SUSPECTED"
        : input.priorProjection.disclosure === "SUSPECTED"
          ? "CONFIRMED"
          : null;
      if (event.disclosure !== expectedDisclosure) {
        failAEmotionProjection(ERROR.REVEAL_BASE_MISSING, `${event.eventId}:DISCLOSURE_ORDER`);
      }
    }

    const category = categoryFor(event, input.priorProjection ?? null);
    const knownSet = new Set([...event.publicFactRefs, ...viewer.knownFactRefs]);
    const knownFactRefs = event.factRefs.filter((factRef) => knownSet.has(factRef));
    const evidenceSet = new Set(viewer.authorizedEvidenceRefs);
    if (event.disclosure === "SUSPECTED" && !event.suspicionBasisRefs.some((factRef) => knownSet.has(factRef))) {
      failAEmotionProjection(ERROR.DISCLOSURE_BASIS_MISSING, `${event.eventId}:SUSPECTED`);
    }
    if (event.disclosure === "CONFIRMED" && !event.evidenceRefs.some((evidenceRef) => evidenceSet.has(evidenceRef))) {
      failAEmotionProjection(ERROR.DISCLOSURE_BASIS_MISSING, `${event.eventId}:CONFIRMED`);
    }

    const visibleImpacts = event.impacts
      .filter((impact) => impact.visibility === "PUBLIC" || impact.targetSeatId === viewer.viewerSeatId)
      .map(toVisibleImpact);
    const rendered = this.presentation.render({
      eventCode: event.eventCode,
      disclosure: event.disclosure,
      category,
      cardType: event.presentation.centerCardType,
      visibleImpacts,
      knownFactRefs,
      responseOptions: event.presentation.responseOptions.map((option) => ({ ...option })),
      eventId: event.eventId,
    });
    if (!rendered) failAEmotionProjection(ERROR.PRESENTATION_UNSUPPORTED, event.eventCode);
    if ((event.presentation.centerCardType === null) !== (rendered.card === null)) {
      failAEmotionProjection(ERROR.PRESENTATION_UNSUPPORTED, `${event.eventCode}:CARD_MISMATCH`);
    }

    const projectionWithoutHash: Omit<AEmotionViewerProjectionPortV1, "projectionHash"> = {
      schemaVersion: "a_emotion_viewer_projection_v1",
      eventId: event.eventId,
      projectionVersion: (input.priorProjection?.projectionVersion ?? 0) + 1,
      roomId: event.roomId,
      runId: event.runId,
      viewerSeatId: viewer.viewerSeatId,
      category,
      disclosure: event.disclosure,
      severity: event.severity,
      title: rendered.title,
      safeSummary: rendered.safeSummary,
      statusLabel: statusLabel(event.disclosure),
      visibleImpacts,
      knownFactRefs,
      responseOptions: rendered.actions,
      recommendedPresentation: event.presentation.recommendedPresentation,
      centerCard: rendered.card,
      keyModal: null,
      eventSequence: event.eventSequence,
      occurredAt: event.occurredAt,
    };
    if (event.disclosure === "SUSPECTED") {
      projectionWithoutHash.visibleSuspectedSeatIds = [...event.suspectedSeatIds];
    } else if (event.disclosure === "CONFIRMED") {
      projectionWithoutHash.visibleSourceSeatId = event.sourceSeatId;
    }
    if (event.presentation.modalTrigger) {
      const trigger = event.presentation.modalTrigger;
      if (!rendered.card || rendered.card.type !== trigger.type) {
        failAEmotionProjection(ERROR.PRESENTATION_UNSUPPORTED, `${event.eventCode}:MODAL_CARD_MISMATCH`);
      }
      projectionWithoutHash.keyModal = {
        id: `modal:${viewer.viewerSeatId}:${trigger.type}:${trigger.triggerId}:${trigger.stateVersion}`,
        type: trigger.type,
        priority: modalPriority(trigger.type),
        triggerId: trigger.triggerId,
        stateVersion: trigger.stateVersion,
        dedupeKey: [viewer.viewerSeatId, trigger.type, trigger.triggerId, trigger.stateVersion].join(":"),
        card: rendered.card,
      };
    }
    const projection: AEmotionViewerProjectionPortV1 = {
      ...projectionWithoutHash,
      projectionHash: sha256Canonical(projectionWithoutHash),
    };
    const aggregationKey = input.priorAggregationKey ?? aEmotionAggregationKey({
      roomId: event.roomId,
      runId: event.runId,
      viewerSeatId: viewer.viewerSeatId,
      eventId: event.eventId,
    });
    return {
      aggregationKey,
      latestEventId: event.eventId,
      idempotencyKey: aEmotionProjectionIdempotencyKey({
        eventId: event.eventId,
        viewerSeatId: viewer.viewerSeatId,
      }),
      inputFingerprint: sha256Canonical({
        eventHash: event.eventHash,
        viewerSeatId: viewer.viewerSeatId,
        knownFactRefs,
        evidenceRefs: event.evidenceRefs.filter((item) => evidenceSet.has(item)),
        priorProjectionHash: input.priorProjection?.projectionHash ?? null,
        projectionHash: projection.projectionHash,
      }),
      stageId: event.stageId,
      sharedObjectId: event.sharedObjectId,
      eventFamily: event.eventFamily,
      projection: structuredClone(projection),
    };
  }
}

const CARD_PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  DECISION: 0,
  CROSS_IMPACT: 100,
  STAGE_VICTORY: 200,
  PROMISE_BROKEN: 300,
  CRISIS: 400,
});

export function selectAEmotionCenterStateV1<T extends { type: string }>(states: readonly T[]): T | null {
  return states.reduce<T | null>((best, current) => {
    if (!(current.type in CARD_PRIORITY)) return best;
    if (!best || (CARD_PRIORITY[current.type] ?? -1) > (CARD_PRIORITY[best.type] ?? -1)) return current;
    return best;
  }, null);
}

export function orderAEmotionModalQueueV1<T extends { priority: number; id: string }>(modals: readonly T[]): T[] {
  return [...new Map(modals.map((modal) => [modal.id, modal])).values()]
    .sort((left, right) => right.priority - left.priority || compareAEmotionCanonicalText(left.id, right.id));
}
