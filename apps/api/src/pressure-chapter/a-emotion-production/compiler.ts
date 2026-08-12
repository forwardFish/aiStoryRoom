import { hashWithoutField, sha256Canonical } from "@ai-story/shared";
import {
  validateAEmotionInteractionEventV1,
} from "@ai-story/shared/pressure-chapter/a-emotion";
import type { AEmotionInteractionEventPortV1 } from "../a-emotion/ports";
import type {
  AEmotionAuthorityOutboxJobV1,
  AEmotionCommittedAuthoritySourceV1,
} from "./contracts";
import {
  validateAEmotionAuthorityOutboxJobV1,
  validateAEmotionCommittedAuthoritySourceV1,
} from "./validation";

export function sealAEmotionAuthorityOutboxJobV1(
  draft: Omit<AEmotionAuthorityOutboxJobV1, "jobHash">,
): AEmotionAuthorityOutboxJobV1 {
  return validateAEmotionAuthorityOutboxJobV1({
    ...structuredClone(draft),
    jobHash: sha256Canonical(draft),
  });
}

export function sealAEmotionCommittedAuthoritySourceV1(
  draft: Omit<AEmotionCommittedAuthoritySourceV1, "sourceBindingHash">,
  job: Readonly<AEmotionAuthorityOutboxJobV1>,
): AEmotionCommittedAuthoritySourceV1 {
  return validateAEmotionCommittedAuthoritySourceV1({
    ...structuredClone(draft),
    sourceBindingHash: sha256Canonical(draft),
  }, job);
}

/** Converts one frozen authority signal into the canonical shared event. */
export class CanonicalAEmotionAuthorityEventCompilerV1 {
  compile(
    rawJob: unknown,
    rawSource: unknown,
  ): AEmotionInteractionEventPortV1 {
    const job = validateAEmotionAuthorityOutboxJobV1(rawJob);
    const source = validateAEmotionCommittedAuthoritySourceV1(rawSource, job);
    const identityHash = sha256Canonical({
      schemaVersion: "a_emotion_authority_event_identity_v1",
      sourceKind: source.sourceKind,
      sourceId: source.sourceId,
      sourceCommitHash: source.sourceCommitHash,
      signalId: source.signal.signalId,
    });
    const eventWithoutHash: Omit<AEmotionInteractionEventPortV1, "eventHash"> = {
      schemaVersion: "a_emotion_interaction_event_v1",
      eventId: `aemotion:${identityHash}`,
      roomId: source.roomId,
      runId: source.runId,
      stageId: source.stageId,
      sourceCommitHash: source.sourceCommitHash,
      sourceActionId: source.sourceActionId,
      sourceSeatId: source.sourceSeatId,
      kind: source.signal.kind,
      eventCode: source.signal.eventCode,
      eventFamily: source.signal.eventFamily,
      severity: source.signal.severity,
      sharedObjectId: source.signal.sharedObjectId,
      factRefs: [...source.signal.factRefs],
      publicFactRefs: [...source.signal.publicFactRefs],
      impacts: source.signal.impacts.map((impact) => ({ ...impact })),
      audienceSpec: structuredClone(source.signal.audienceSpec),
      disclosure: source.signal.disclosure,
      suspectedSeatIds: [...source.signal.suspectedSeatIds],
      suspicionBasisRefs: [...source.signal.suspicionBasisRefs],
      evidenceRefs: [...source.signal.evidenceRefs],
      revealOfEventId: source.signal.revealOfEventId,
      promiseId: source.signal.promiseId,
      milestoneId: source.signal.milestoneId,
      metricTransitionId: source.signal.metricTransitionId,
      presentation: structuredClone(source.signal.presentation),
      occurredAt: source.committedAt,
      eventSequence: source.eventSequence,
      stateVersion: source.stateVersion,
      idempotencyKey: `aemotion-authority:${identityHash}`,
    };
    const event = validateAEmotionInteractionEventV1({
      ...eventWithoutHash,
      eventHash: sha256Canonical(eventWithoutHash),
    });
    // The canonical contract owns its self-hash; keep this explicit so a
    // future validator cannot silently accept an alternate hash convention.
    if (event.eventHash !== hashWithoutField(event as unknown as Record<string, unknown>, "eventHash")) {
      throw new Error("A-Emotion canonical event hash convention drifted");
    }
    return structuredClone(event) as unknown as AEmotionInteractionEventPortV1;
  }
}
