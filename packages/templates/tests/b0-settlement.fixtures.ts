import type {
  B0ActionContractV1,
  B0CausalEdgeV1,
  B0SettlementBatchV1,
  B0SettlementResolutionV1,
  B0SettlementSnapshotV1,
  B0SettlementWindowV1,
} from "@ai-story/shared";
import { createB0RoomRulesetV1 } from "../src/runtime-contract/b0-settlement";

export const windowedRuleset = () => createB0RoomRulesetV1({
  rulesetVersion: "b0-rules-v1", settlementMode: "WINDOWED", totalWindows: 6,
  windowDurationSeconds: 300, maxHumanPlayers: 5,
});
export const immediateRuleset = () => createB0RoomRulesetV1({
  rulesetVersion: "b0-solo-v1", settlementMode: "IMMEDIATE", totalWindows: 6,
  windowDurationSeconds: 1, maxHumanPlayers: 1,
});
export const validWindow = (): B0SettlementWindowV1 => ({
  schemaVersion: "b0-settlement-window-v1", id: "window.1", roomId: "room.1",
  runId: "run.1", mode: "WINDOWED", ordinal: 1, situationId: "situation.1",
  baseWorldSequence: 7, expectedActorIds: ["actor.a", "actor.b"],
  readyActorIds: ["actor.a"], openedAt: "2026-08-06T00:00:00.000Z",
  locksAt: "2026-08-06T00:05:00.000Z", lockedAt: null, committedAt: null,
  completedAt: null, status: "OPEN", lockReason: null,
  rulesetVersion: "b0-rules-v1", schemaRevision: 1,
});
export const validAction = (): B0ActionContractV1 => ({
  schemaVersion: "b0-action-contract-v1", id: "intent.a", windowId: "window.1",
  roomId: "room.1", runId: "run.1", actorId: "actor.a", baseWorldSequence: 7,
  revision: 1, kind: "INFLUENCE",
  rawPlayerText: "Ask the archivist to state which record was handled.",
  normalizedSummary: "Request a bounded answer from the archivist.",
  targetRefs: [{ type: "ACTOR", id: "actor.b" }],
  primaryEffect: { effectTypeId: "influence.request_response", direction: "CREATE", requestedMagnitude: "MINOR" },
  method: { methodTypeId: "contact.private_message", description: "Send one bounded private request." },
  resourceCommitments: [], evidenceRefs: [], capabilityRefs: [],
  propositionRefs: ["proposition.record_origin"],
  visibilityIntent: { type: "PRIVATE", declaredRecipientRefs: ["actor.b"] },
  reactionPolicy: "IF_OBSERVED", requestedTiming: "CURRENT_WINDOW", riskTags: ["attention"],
  compilerVersion: "compiler.v1", validationVersion: "validator.v1", clientRequestId: "client.1",
  status: "LOCKED", createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:01:00.000Z", confirmedAt: "2026-08-06T00:01:00.000Z",
  lockedAt: "2026-08-06T00:05:00.000Z",
});
export const validSnapshot = (): B0SettlementSnapshotV1 => ({
  schemaVersion: "b0-settlement-snapshot-v1", id: "snapshot.1", windowId: "window.1",
  roomId: "room.1", runId: "run.1", baseWorldSequence: 7,
  rulesetVersion: "b0-rules-v1", rulesetHash: "a".repeat(64), worldState: { phase: "open" },
  actorStates: [{ actorId: "actor.a" }, { actorId: "actor.b" }], roleBindings: [],
  knowledgeState: {}, relationshipState: {}, resourceState: {}, activeCapabilities: [],
  dueSystemIntents: [], worldStateHash: "b".repeat(64), roleSetHash: "c".repeat(64),
  knowledgeStateHash: "d".repeat(64), relationshipStateHash: "e".repeat(64),
  createdAt: "2026-08-06T00:05:00.000Z",
});
export const validBatch = (): B0SettlementBatchV1 => ({
  schemaVersion: "b0-settlement-batch-v1", id: "batch.1", windowId: "window.1",
  snapshotId: "snapshot.1", roomId: "room.1", runId: "run.1", baseWorldSequence: 7,
  lockedIntentIds: ["intent.a"], dueSystemIntentIds: [], status: "PREPARED", attempt: 0,
  inputHash: "f".repeat(64), relationGraphHash: null, resolutionHash: null,
  createdAt: "2026-08-06T00:05:00.000Z", resolvedAt: null, committedAt: null, completedAt: null,
});
export const validEdge = (): B0CausalEdgeV1 => ({
  schemaVersion: "b0-causal-edge-v1", id: "edge.1", batchId: "batch.1",
  from: { type: "INTENT", id: "intent.a" }, to: { type: "INTENT_OUTCOME", id: "outcome.a" },
  relation: "CAUSED",
});
export const validResolution = (): B0SettlementResolutionV1 => ({
  schemaVersion: "b0-settlement-resolution-v1", batchId: "batch.1", roomId: "room.1",
  runId: "run.1", windowId: "window.1", baseWorldSequence: 7, intentRelations: [],
  conflictGroups: [{ conflictGroupId: "group.1", intentIds: ["intent.a"] }],
  intentOutcomes: [{ outcomeId: "outcome.a", intentId: "intent.a", actorId: "actor.a",
    status: "PARTIAL_SUCCESS", summary: "The request is delivered without forcing agreement.",
    causalEdgeIds: ["edge.1"] }],
  worldDelta: { mutations: [] },
  structuredResults: [{ resultId: "result.a", resultKind: "PERSONAL_OUTCOME",
    originIntentIds: ["intent.a"], originActorIds: ["actor.a"], targetActorIds: ["actor.a"],
    summary: "The request is now pending.", durableMutationIds: [],
    audience: { type: "ACTOR_ONLY", actorRef: "actor.a" } }],
  pendingEffects: [], causalEdges: [validEdge()], resolutionVersion: "resolution.v1",
  resolutionHash: "0".repeat(64),
});
