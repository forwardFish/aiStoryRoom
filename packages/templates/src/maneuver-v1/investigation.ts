import {
  EvidenceCardStateV1,
  EvidenceClaimRuleV1,
  EvidenceLevelV1,
  InvestigationResolutionInputV1,
  InvestigationResolutionV1,
} from "./types";

const LEVEL_RANK: Record<EvidenceLevelV1, number> = {
  LEAD: 1,
  CORROBORATION: 2,
  PROOF: 3,
};

function minLevel(a: EvidenceLevelV1, b: EvidenceLevelV1): EvidenceLevelV1 {
  return LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b;
}

function evidenceLevelFromStrength(strength: number): EvidenceLevelV1 {
  if (strength >= 3) return "PROOF";
  if (strength >= 2) return "CORROBORATION";
  return "LEAD";
}

function ensureRouteMatchesTrace(input: InvestigationResolutionInputV1): void {
  if (input.route.traceId !== input.trace.traceId) {
    throw new Error("INVESTIGATION_ROUTE_TRACE_MISMATCH");
  }
  if (!input.trace.routeIds.includes(input.route.routeId)) {
    throw new Error("INVESTIGATION_ROUTE_NOT_ALLOWED");
  }
  if (input.trace.status !== "ACTIVE" && input.trace.status !== "OBSCURED") {
    throw new Error(`INVESTIGATION_TRACE_${input.trace.status}`);
  }
  if (!input.trace.accessRoleIds.includes(input.actorRoleId)) {
    throw new Error("INVESTIGATION_TRACE_NOT_VISIBLE");
  }
}

function ensureCapabilitiesAndResources(input: InvestigationResolutionInputV1): void {
  for (const capability of input.route.requiredCapabilityIds) {
    if (!input.actorCapabilityIds.includes(capability)) {
      throw new Error(`INVESTIGATION_CAPABILITY_REQUIRED:${capability}`);
    }
  }
  for (const cost of input.route.requiredResourceCosts) {
    if ((input.availableResources[cost.resourceId] || 0) < cost.amount) {
      throw new Error(`INVESTIGATION_RESOURCE_REQUIRED:${cost.resourceId}`);
    }
  }
}

export function resolveInvestigationV1(input: InvestigationResolutionInputV1): InvestigationResolutionV1 {
  ensureRouteMatchesTrace(input);
  ensureCapabilitiesAndResources(input);

  const matchedObstruction = input.obstruction && input.route.counterTags.includes(input.obstruction.tag)
    ? input.obstruction
    : null;

  if (matchedObstruction?.effect === "BLOCK") {
    return {
      status: "BLOCKED",
      processNarrative: matchedObstruction.processResult,
      evidence: null,
      observableTrail: input.route.observableTrail,
    };
  }

  const rules = matchedObstruction?.effect === "REVEAL_ALTERNATE" && matchedObstruction.alternateRevealRules
    ? matchedObstruction.alternateRevealRules
    : input.route.revealRules;

  if (rules.length === 0) {
    return {
      status: "PROCESS_ONLY",
      processNarrative: matchedObstruction?.processResult || "这条路线没有提供足以形成证据的新内容，但调查过程本身留下了可追索的变化。",
      evidence: null,
      observableTrail: input.route.observableTrail,
    };
  }

  const supports = rules.map((rule) => ({
    claimKey: rule.claimKey,
    statement: rule.statement,
    strength: rule.strength,
  }));
  const strongest = Math.max(...supports.map((support) => support.strength));
  const level = minLevel(evidenceLevelFromStrength(strongest), input.route.evidenceCeiling);

  const evidence: EvidenceCardStateV1 = {
    schemaVersion: "evidence_card_v1",
    evidenceId: input.evidenceId,
    title: input.evidenceTitle,
    level,
    authenticity: matchedObstruction?.effect === "DISPUTE" ? "DISPUTED" : level === "PROOF" ? "AUTHENTICATED" : "SUPPORTED",
    supports,
    cannotProve: [...input.route.cannotProve],
    source: {
      traceId: input.trace.traceId,
      routeId: input.route.routeId,
      sourceGroupKey: input.trace.sourceGroupKey,
      sourceEventIds: [...input.trace.sourceEventIds],
    },
    ownerRoleId: input.actorRoleId,
    visibility: "PRIVATE",
    sharedWithRoleIds: [],
    acquiredAtRevision: input.acquiredAtRevision,
    derivedFromEvidenceIds: [],
  };

  return {
    status: "EVIDENCE_ACQUIRED",
    processNarrative: matchedObstruction?.processResult || "调查者沿既定路线完成追查，并带回一项只覆盖有限命题的结果。",
    evidence,
    observableTrail: input.route.observableTrail,
  };
}

export interface CombineEvidenceResultV1 {
  accepted: boolean;
  reason?: string;
  evidence?: EvidenceCardStateV1;
}

export function combineEvidenceV1(input: {
  evidenceId: string;
  title: string;
  ownerRoleId: string;
  acquiredAtRevision: number;
  cards: EvidenceCardStateV1[];
  rule: EvidenceClaimRuleV1;
}): CombineEvidenceResultV1 {
  if (input.cards.length < 2) {
    return { accepted: false, reason: "至少需要两份证据才能组合。" };
  }
  if (input.cards.some((card) => card.ownerRoleId !== input.ownerRoleId && !card.sharedWithRoleIds.includes(input.ownerRoleId) && card.visibility !== "PUBLIC")) {
    return { accepted: false, reason: "组合中包含当前角色无权使用的证据。" };
  }

  const supports = input.cards.flatMap((card) => card.supports.filter((support) => support.claimKey === input.rule.claimKey));
  const sourceGroups = new Set(
    input.cards
      .filter((card) => card.supports.some((support) => support.claimKey === input.rule.claimKey))
      .map((card) => card.source.sourceGroupKey),
  );
  const totalStrength = supports.reduce((sum, support) => sum + support.strength, 0);

  if (input.rule.forbiddenSameSourceStacking && sourceGroups.size < input.rule.requiredIndependentSourceGroups) {
    return { accepted: false, reason: "这些证据来自同一来源，不能当作相互独立的佐证。" };
  }
  if (sourceGroups.size < input.rule.requiredIndependentSourceGroups) {
    return { accepted: false, reason: "独立来源数量不足。" };
  }
  if (totalStrength < input.rule.minimumTotalStrength) {
    return { accepted: false, reason: "现有证据强度不足以确认这项有限命题。" };
  }

  const cannotProve = Array.from(new Set(input.cards.flatMap((card) => card.cannotProve)));
  const result: EvidenceCardStateV1 = {
    schemaVersion: "evidence_card_v1",
    evidenceId: input.evidenceId,
    title: input.title,
    level: input.rule.resultingLevel,
    authenticity: input.rule.resultingLevel === "PROOF" ? "AUTHENTICATED" : "SUPPORTED",
    supports: [{
      claimKey: input.rule.claimKey,
      statement: input.rule.resultingStatement,
      strength: input.rule.resultingLevel === "PROOF" ? 3 : input.rule.resultingLevel === "CORROBORATION" ? 2 : 1,
    }],
    cannotProve,
    source: {
      traceId: `combined:${input.rule.claimKey}`,
      routeId: "combined_evidence",
      sourceGroupKey: `combined:${Array.from(sourceGroups).sort().join("+")}`,
      sourceEventIds: Array.from(new Set(input.cards.flatMap((card) => card.source.sourceEventIds))),
    },
    ownerRoleId: input.ownerRoleId,
    visibility: "PRIVATE",
    sharedWithRoleIds: [],
    acquiredAtRevision: input.acquiredAtRevision,
    derivedFromEvidenceIds: input.cards.map((card) => card.evidenceId),
  };
  return { accepted: true, evidence: result };
}

export function projectEvidenceForRoleV1(card: EvidenceCardStateV1, roleId: string): EvidenceCardStateV1 | null {
  const canRead = card.ownerRoleId === roleId || card.visibility === "PUBLIC" || card.sharedWithRoleIds.includes(roleId);
  if (!canRead) return null;
  return {
    ...card,
    supports: card.supports.map((support) => ({ ...support })),
    cannotProve: [...card.cannotProve],
    source: {
      ...card.source,
      sourceEventIds: card.ownerRoleId === roleId ? [...card.source.sourceEventIds] : [],
    },
    sharedWithRoleIds: card.ownerRoleId === roleId ? [...card.sharedWithRoleIds] : [],
    derivedFromEvidenceIds: card.ownerRoleId === roleId ? [...card.derivedFromEvidenceIds] : [],
  };
}
