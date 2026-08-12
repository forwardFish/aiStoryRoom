import type {
  PartOneRuntimeAsset,
  PartOneSceneState,
  PartOneState,
} from "../../src/story-package/part-one-runtime-types.js";

export const neutralScene: PartOneSceneState = {
  sceneId: "scene.harbor-office",
  timeLabel: "morning",
  locationLabel: "harbor office",
  locationRef: "location.harbor-office",
  presentActorRefs: ["actor.harbor-master", "actor.cargo-clerk"],
  situation: "A routine cargo discrepancy is awaiting a documented response.",
  observableFacts: ["The manifest discrepancy is visible to both actors."],
  documentStates: [],
  objectStates: [],
};

export const neutralState = {
  partId: "PART-01",
  sectionId: "section.harbor",
  turnNumber: 1,
  durableState: {
    worldId: "neutral-harbor",
    revision: 0,
    predicates: [],
    pendingRuleIds: [],
  },
  scene: neutralScene,
  reform: { executionMode: "UNSET", scopeStatus: "UNSET", progress: "UNSET" },
  review: { initiationStatus: "UNSET", authority: "OPEN", procedureStatus: "UNSET" },
  evidence: { chainStatus: "UNSET", primaryCustodianRef: null, copyStatus: "UNSET", archiveSealStatus: "UNSET" },
  witness: { accessStatus: "UNSET" },
  grain: { immediatePressure: "UNSET", officialStockStatus: "UNSET", reliefChannel: "UNSET" },
  merchant: { entryStatus: "UNSET", grantedRights: [] },
  land: { riskLevel: "UNSET", safeguardStatus: "UNSET" },
  report: { authorshipMode: "UNSET", firstNarrativeController: "UNSET", attachmentStrength: "UNSET", dispatchStatus: "UNSET" },
  responsibility: { firstRecordStatus: "UNSET", governorExposure: 0, xunfuExposure: 0 },
  relations: { governorXunfu: 0 },
  knowledgeTransfers: [],
  pendingConsequences: [],
  completedKernelIds: [],
  sectionTurnNumber: 0,
  causalArcStages: {},
  lastCommittedEventId: null,
  partCompletionStatus: "IN_PROGRESS",
} as unknown as PartOneState;

export const neutralActorPolicies: PartOneRuntimeAsset[] = [{
  schemaVersion: "runtime-story-asset-v1",
  assetId: "policy.cargo-clerk",
  assetType: "ACTOR_POLICY",
  partIds: ["PART-01"],
  sectionIds: ["section.harbor"],
  requirementIds: ["requirement.cargo-review"],
  decisionKernelIds: [],
  causalArcIds: [],
  actorRefs: ["actor.cargo-clerk"],
  stateDependencies: [],
  visibilityRules: [{
    visibilityClass: "SERVER_AUTHORITATIVE",
    rule: "Only validated current-scene behavior is visible.",
  }],
  sourceClaimIds: [],
  adaptationDecisionIds: [],
  retrievalTags: ["neutral-harbor", "actor-policy"],
  payload: {
    goal: "Preserve an auditable manifest without inventing cargo facts.",
  },
}];
