import { sha256Canonical } from "./canonical";
import type {
  ArcStagnationReport,
  CompiledCausalEffect,
  CompiledCausalTurn,
  MaterialChangeCategory,
  MaterialChangeReport,
  ShadowCausalArcSeed,
  ShadowCausalRuntimeSeed,
  ShadowDecisionAffordanceSeed,
  ShadowRuntimeFixture
} from "./types";

const MATERIAL_CHANGE_KEYS: MaterialChangeCategory[] = [
  "worldStateChanged",
  "relationshipChanged",
  "knowledgeChanged",
  "responsibilityChanged",
  "resourceChanged",
  "commitmentChanged",
  "threadChanged",
  "arcChanged",
  "pendingConsequenceChanged"
];

export function compileCausalTurn(fixture: ShadowRuntimeFixture): CompiledCausalTurn {
  const seed = fixture.causalRuntime || buildCompatibilitySeed(fixture);
  validateSeed(seed, fixture);
  const arcsBefore = structuredClone(seed.arcs);
  const arcsAfter = structuredClone(seed.arcs);
  const appliedEffects: CompiledCausalEffect[] = [];

  for (const rule of seed.rules) {
    if (!ruleMatches(rule.when, fixture)) continue;
    for (const effect of rule.effects) {
      if (applyEffect(effect, arcsAfter)) {
        appliedEffects.push({ ...structuredClone(effect), sourceRuleId: rule.ruleId });
      }
    }
  }

  const deterministicMaterialChange = materialChangeFromCategories(
    appliedEffects.map((effect) => effect.category),
    appliedEffects.map((effect) => effect.effectId)
  );
  const allowedEventEnvelope = {
    allowedEventTypes: seed.eventCatalog.map((event) => event.eventType),
    requiredEventTypes: [...seed.requiredEventTypes],
    allowedActorRefs: [...new Set(seed.eventCatalog.flatMap((event) => event.actorRefs))],
    allowedTargetRefs: [...new Set(seed.eventCatalog.flatMap((event) => event.targetRefs))],
    allowedTactics: [...new Set(seed.eventCatalog.map((event) => event.tactic).filter((value): value is string => Boolean(value)))],
    allowedThreadRefs: [...new Set(arcsAfter.flatMap((arc) => arc.openThreadRefs))],
    allowedStatePaths: [...seed.allowedStatePaths],
    forbiddenStatePaths: [...seed.forbiddenStatePaths],
    maxEventDrafts: seed.maxEventDrafts,
    eventCatalog: structuredClone(seed.eventCatalog)
  };
  const npcReactionEnvelopes = seed.npcReactions.map((reaction) => ({
    ...structuredClone(reaction),
    triggeringActionId: fixture.actionResolution.resolutionId,
    observedPlayerIntent: fixture.playerIntent.objective
  }));
  const decisionAffordances = buildDecisionAffordances(seed.decisionAffordances, fixture);
  const stagnationReports = buildStagnationReports(seed, deterministicMaterialChange, arcsAfter);
  const activePressureSummaries = [...new Set([
    ...fixture.activePressures.map((pressure) => pressure.summary),
    ...appliedEffects.map((effect) => effect.writerVisibleSummary).filter((value): value is string => Boolean(value))
  ])];
  const affordanceSnapshotHash = sha256Canonical(decisionAffordances);
  const allowedEventEnvelopeHash = sha256Canonical(allowedEventEnvelope);
  const snapshotHash = sha256Canonical({
    actionId: fixture.actionResolution.resolutionId,
    sequence: seed.sequence,
    arcsBefore,
    arcsAfter,
    appliedEffects,
    npcReactionEnvelopes,
    allowedEventEnvelopeHash,
    affordanceSnapshotHash,
    stagnationReports
  });

  return {
    schemaVersion: "openovel_causal_turn_v1",
    actionId: fixture.actionResolution.resolutionId,
    sequence: seed.sequence,
    arcsBefore,
    arcsAfter,
    appliedEffects,
    activePressureSummaries,
    npcReactionEnvelopes,
    allowedEventEnvelope,
    decisionAffordances,
    deterministicMaterialChange,
    stagnationReports,
    snapshotHash,
    affordanceSnapshotHash,
    allowedEventEnvelopeHash
  };
}

export function materialChangeFromCategories(
  categories: MaterialChangeCategory[],
  sources: string[]
): MaterialChangeReport {
  const unique = new Set(categories);
  const report = Object.fromEntries(MATERIAL_CHANGE_KEYS.map((key) => [key, unique.has(key)])) as Record<MaterialChangeCategory, boolean>;
  return {
    ...report,
    anyMaterialChange: MATERIAL_CHANGE_KEYS.some((key) => report[key]),
    sources: [...new Set(sources)]
  };
}

function buildCompatibilitySeed(fixture: ShadowRuntimeFixture): ShadowCausalRuntimeSeed {
  const entrances = fixture.writerPlan?.decisionEntrances?.length
    ? fixture.writerPlan.decisionEntrances
    : fixture.narrativeFrame.decisionPolicy.allowedClasses
        .map((actionClass) => ({
          actionClass,
          targetRefs: [compatibilityTarget(actionClass, fixture)],
          situation: `处理当前场景中的${compatibilityGoal(actionClass)}`
        }))
        .slice(0, fixture.narrativeFrame.decisionPolicy.minimum);
  const npcPolicies = Object.entries(fixture.npcActionPolicies);
  return {
    sequence: 1,
    arcs: [{
      arcId: `ARC-${fixture.scene.sceneId}`,
      title: fixture.scene.mainlineQuestion,
      stage: "OPEN",
      state: { actionAccepted: false },
      activeActorRefs: fixture.scene.presentCharacterIds,
      openThreadRefs: fixture.scene.mainlineQuestionIds,
      lastMaterialChangeSequence: 0,
      sourceClaimIds: []
    }],
    rules: [{
      ruleId: `RULE-${fixture.actionResolution.resolutionId}`,
      when: { accepted: true },
      effects: [{
        effectId: `EFFECT-${fixture.actionResolution.resolutionId}`,
        arcRef: `ARC-${fixture.scene.sceneId}`,
        operation: "SET",
        stateKey: "actionAccepted",
        value: true,
        category: "worldStateChanged",
        summary: fixture.actionResolution.summary,
        writerVisibleSummary: fixture.actionResolution.costSummary || fixture.actionResolution.summary
      }]
    }],
    npcReactions: npcPolicies.map(([npcRef, policy]) => ({
      npcRef,
      knownFacts: fixture.actionResolution.confirmedEffects,
      unknownFacts: fixture.actionResolution.unresolvedEffects,
      activeGoals: [{ goal: policy.immediateGoal, weight: 100 }],
      threatenedGoals: [policy.publicPosition],
      usableLeverageRefs: policy.leverage,
      allowedTactics: policy.allowedResponses,
      forbiddenOutcomes: policy.mustNotDo,
      allowedEventTypes: [],
      narrativeCeiling: fixture.narrativeFrame.endingBoundary
    })),
    eventCatalog: [],
    requiredEventTypes: [],
    maxEventDrafts: 0,
    allowedStatePaths: [],
    forbiddenStatePaths: Object.keys(fixture.stateLocks).map((group) => `stateLocks.${group}`),
    decisionAffordances: entrances.map((entry, index) => ({
      affordanceId: `AF-${index + 1}`,
      actionClass: entry.actionClass,
      actorRef: fixture.role.characterId,
      targetRef: entry.targetRefs[0] || fixture.decisionAccess.locationRef,
      immediateGoal: entry.situation,
      requiredCapabilityRefs: [],
      requiredResourceRefs: entry.targetRefs.filter((ref) => ref.startsWith("RESOURCE-")),
      allowedVisibility: ["OBSERVABLE"],
      constraints: []
    })),
    stagnationHistory: {
      turnsWithoutMaterialChange: 0,
      repeatedSceneKey: fixture.scene.sceneId,
      repeatedActionClasses: entrances.map((entry) => entry.actionClass),
      consecutiveSameSceneDocumentTurns: 0,
      pendingConsequencesDue: fixture.pendingConsequences.filter((item) => item.dueLabel === "本轮").map((item) => item.consequenceId)
    }
  };
}

function compatibilityTarget(
  actionClass: ShadowDecisionAffordanceSeed["actionClass"],
  fixture: ShadowRuntimeFixture
): string {
  if (actionClass === "authority") {
    return fixture.decisionAccess.availableObjectRefs.find((ref) => ref === "RESOURCE-release-document")
      || fixture.decisionAccess.controllableEntityRefs[0]
      || fixture.decisionAccess.locationRef;
  }
  if (actionClass === "evidence_control") {
    return fixture.decisionAccess.availableObjectRefs.find((ref) => ref === "RESOURCE-secretary-ledger")
      || fixture.decisionAccess.controllableEntityRefs[0]
      || fixture.decisionAccess.locationRef;
  }
  return fixture.decisionAccess.presentEntityRefs[0] || fixture.decisionAccess.locationRef;
}

function compatibilityGoal(actionClass: ShadowDecisionAffordanceSeed["actionClass"]): string {
  switch (actionClass) {
    case "authority": return "文书处置";
    case "responsibility": return "责任归属";
    case "evidence_control": return "现场记录";
    case "scope_change": return "执行范围";
    case "secrecy": return "信息公开边界";
    case "negotiation": return "协商条件";
    default: return "可执行行动";
  }
}

function ruleMatches(rule: ShadowCausalRuntimeSeed["rules"][number]["when"], fixture: ShadowRuntimeFixture): boolean {
  if (rule.accepted !== undefined && rule.accepted !== fixture.actionResolution.accepted) return false;
  if (rule.targetId !== undefined && rule.targetId !== fixture.playerIntent.targetId) return false;
  return true;
}

function applyEffect(effect: ShadowCausalRuntimeSeed["rules"][number]["effects"][number], arcs: ShadowCausalArcSeed[]): boolean {
  if (!effect.arcRef) return effect.operation === "ADD_PENDING_CONSEQUENCE";
  const arc = arcs.find((candidate) => candidate.arcId === effect.arcRef);
  if (!arc) throw new Error(`CAUSAL_EFFECT_ARC_UNKNOWN: ${effect.effectId} -> ${effect.arcRef}`);
  if (effect.operation === "TRANSITION") {
    const next = String(effect.value) as ShadowCausalArcSeed["stage"];
    if (arc.stage === next) return false;
    arc.stage = next;
    return true;
  }
  if (effect.operation === "ADD_THREAD") {
    const threadRef = String(effect.value);
    if (arc.openThreadRefs.includes(threadRef)) return false;
    arc.openThreadRefs.push(threadRef);
    return true;
  }
  if (effect.operation === "ADD_PENDING_CONSEQUENCE") return true;
  if (!effect.stateKey) throw new Error(`CAUSAL_EFFECT_STATE_KEY_REQUIRED: ${effect.effectId}`);
  if (effect.operation === "SET") {
    if (Object.is(arc.state[effect.stateKey], effect.value)) return false;
    arc.state[effect.stateKey] = effect.value;
    return true;
  }
  const current = arc.state[effect.stateKey];
  if (typeof current !== "number" || typeof effect.value !== "number") {
    throw new Error(`CAUSAL_EFFECT_NUMERIC_VALUE_REQUIRED: ${effect.effectId}`);
  }
  if (effect.value === 0) return false;
  arc.state[effect.stateKey] = effect.operation === "INC" ? current + effect.value : current - effect.value;
  return true;
}

function buildDecisionAffordances(
  seeds: ShadowDecisionAffordanceSeed[],
  fixture: ShadowRuntimeFixture
): ShadowDecisionAffordanceSeed[] {
  const immediateRefs = new Set([
    fixture.role.characterId,
    ...fixture.decisionAccess.presentEntityRefs,
    ...fixture.decisionAccess.controllableEntityRefs,
    ...fixture.decisionAccess.reachableInstitutionRefs,
    ...fixture.decisionAccess.availableObjectRefs
  ]);
  return seeds.filter((affordance) =>
    affordance.actorRef === fixture.role.characterId
    && immediateRefs.has(affordance.targetRef)
    && fixture.narrativeFrame.decisionPolicy.allowedClasses.includes(affordance.actionClass)
    && affordance.requiredCapabilityRefs.every((capability) => fixture.role.permissions.includes(capability))
    && affordance.requiredResourceRefs.every((resource) => fixture.decisionAccess.availableObjectRefs.includes(resource))
  );
}

function buildStagnationReports(
  seed: ShadowCausalRuntimeSeed,
  materialChange: MaterialChangeReport,
  arcs: ShadowCausalArcSeed[]
): ArcStagnationReport[] {
  const turnsWithoutMaterialChange = materialChange.anyMaterialChange
    ? 0
    : seed.stagnationHistory.turnsWithoutMaterialChange + 1;
  const repeatedDocuments = seed.stagnationHistory.consecutiveSameSceneDocumentTurns >= 3;
  const noChange = turnsWithoutMaterialChange >= 2;
  return arcs.map((arc) => ({
    arcId: arc.arcId,
    turnsWithoutMaterialChange,
    ...(seed.stagnationHistory.repeatedSceneKey ? { repeatedSceneKey: seed.stagnationHistory.repeatedSceneKey } : {}),
    repeatedActionClasses: [...seed.stagnationHistory.repeatedActionClasses],
    pendingConsequencesDue: [...seed.stagnationHistory.pendingConsequencesDue],
    shouldForceProgression: noChange || repeatedDocuments,
    reason: noChange
      ? "连续两轮没有实质变化，必须兑现既有后果或推进既有压力。"
      : repeatedDocuments
        ? "连续三轮停留在同一场景处理同类文书动作，必须切换压力、信息入口、主动角色或时间阶段。"
        : null
  }));
}

function validateSeed(seed: ShadowCausalRuntimeSeed, fixture: ShadowRuntimeFixture): void {
  const knownRefs = new Set([
    fixture.role.characterId,
    fixture.role.roleId,
    fixture.decisionAccess.locationRef,
    ...fixture.availableTargets.map((target) => target.id),
    ...fixture.scene.presentCharacterIds
  ]);
  const arcIds = new Set<string>();
  for (const arc of seed.arcs) {
    if (!arc.arcId || arcIds.has(arc.arcId)) throw new Error(`CAUSAL_ARC_ID_INVALID: ${arc.arcId || "empty"}`);
    arcIds.add(arc.arcId);
  }
  const eventTypes = new Set<string>();
  for (const event of seed.eventCatalog) {
    if (!event.eventType || eventTypes.has(event.eventType)) throw new Error(`CAUSAL_EVENT_TYPE_INVALID: ${event.eventType || "empty"}`);
    eventTypes.add(event.eventType);
    for (const ref of [...event.actorRefs, ...event.targetRefs]) {
      if (!knownRefs.has(ref)) throw new Error(`CAUSAL_EVENT_REF_UNKNOWN: ${event.eventType} -> ${ref}`);
    }
    if (!event.narrativeEvidencePatterns.length) throw new Error(`CAUSAL_EVENT_EVIDENCE_PATTERN_REQUIRED: ${event.eventType}`);
    for (const pattern of event.narrativeEvidencePatterns) new RegExp(pattern, "u");
  }
  for (const type of seed.requiredEventTypes) {
    if (!eventTypes.has(type)) throw new Error(`CAUSAL_REQUIRED_EVENT_UNKNOWN: ${type}`);
  }
  if (seed.maxEventDrafts < seed.requiredEventTypes.length || seed.maxEventDrafts > seed.eventCatalog.length) {
    throw new Error("CAUSAL_EVENT_DRAFT_LIMIT_INVALID");
  }
  const reactionEvents = new Set(seed.npcReactions.flatMap((reaction) => reaction.allowedEventTypes));
  for (const reaction of seed.npcReactions) {
    if (!knownRefs.has(reaction.npcRef)) throw new Error(`NPC_REACTION_REF_UNKNOWN: ${reaction.npcRef}`);
    const known = new Set(reaction.knownFacts.map((fact) => fact.trim()));
    const overlap = reaction.unknownFacts.map((fact) => fact.trim()).find((fact) => known.has(fact));
    if (overlap) throw new Error(`NPC_REACTION_KNOWLEDGE_CONFLICT: ${reaction.npcRef} -> ${overlap}`);
  }
  for (const type of reactionEvents) {
    if (!eventTypes.has(type)) throw new Error(`NPC_REACTION_EVENT_UNKNOWN: ${type}`);
  }
  const affordanceIds = new Set<string>();
  for (const affordance of seed.decisionAffordances) {
    if (!affordance.affordanceId || affordanceIds.has(affordance.affordanceId)) {
      throw new Error(`CAUSAL_AFFORDANCE_ID_INVALID: ${affordance.affordanceId || "empty"}`);
    }
    affordanceIds.add(affordance.affordanceId);
  }
  const built = buildDecisionAffordances(seed.decisionAffordances, fixture);
  if (built.length < fixture.narrativeFrame.decisionPolicy.minimum) {
    throw new Error(`CAUSAL_AFFORDANCES_INSUFFICIENT: ${built.length} < ${fixture.narrativeFrame.decisionPolicy.minimum}`);
  }
}
