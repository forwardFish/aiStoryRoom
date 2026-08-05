import {
  ContactDefinitionV1,
  EvidenceCardStateV1,
  InvestigationRouteV1,
  RuleCardDefinitionV1,
  RuleCardHoldingV1,
  WorldTraceV1,
} from "./types";
import { projectEvidenceForRoleV1, evidenceLevelLabel, settlementMomentLabel } from "./index-internal";

export interface ContactProjectionV1 {
  actorId: string;
  roleId?: string;
  displayName: string;
  publicIdentity: string;
  currentAccess: string;
  whyRelevant: string;
  canReceiveEvidence: boolean;
  visibilityOptions: Array<"LIMITED" | "PUBLIC">;
}

export interface InvestigationLeadProjectionV1 {
  traceId: string;
  title: string;
  narrativeHook: string;
  urgency: "NOW" | "THIS_TURN" | "PERSISTENT";
  expiresAtLabel: string | null;
  knownBecause: string;
  routeCount: number;
  visibleToCurrentRole: true;
  routes: Array<{
    routeId: string;
    label: string;
    narrativeMethod: string;
    mayLearn: string[];
    cannotProve: string[];
    costLabels: string[];
    returnLabel: string;
    possibleTrail: string | null;
  }>;
}

export interface RuleCardProjectionV1 {
  cardAssetKey: string;
  cardKey: string;
  label: string;
  status: RuleCardHoldingV1["status"];
  timing: RuleCardDefinitionV1["timing"];
  guaranteedEffects: string[];
  limitations: string[];
  counterTags: string[];
}

export interface EvidenceCardProjectionV1 {
  evidenceId: string;
  title: string;
  level: string;
  authenticity: string;
  supports: string[];
  cannotProve: string[];
  visibility: EvidenceCardStateV1["visibility"];
  sourceLabel: string;
}

export function projectContactsV1(contacts: ContactDefinitionV1[], roleId: string): ContactProjectionV1[] {
  return contacts
    .filter((contact) => contact.accessibleByRoleIds.includes(roleId))
    .map(({ accessibleByRoleIds: _hidden, ...contact }) => ({ ...contact }));
}

export function projectInvestigationLeadsV1(input: {
  traces: WorldTraceV1[];
  routes: InvestigationRouteV1[];
  roleId: string;
  currentStage: number;
}): InvestigationLeadProjectionV1[] {
  return input.traces
    .filter((trace) => trace.accessRoleIds.includes(input.roleId) && (trace.status === "ACTIVE" || trace.status === "OBSCURED"))
    .map((trace) => {
      const routes = input.routes.filter((route) => route.traceId === trace.traceId && trace.routeIds.includes(route.routeId));
      return {
        traceId: trace.traceId,
        title: trace.title,
        narrativeHook: trace.narrativeHook,
        urgency: trace.expiresAtStage === undefined
          ? "PERSISTENT" as const
          : trace.expiresAtStage <= input.currentStage
            ? "NOW" as const
            : "THIS_TURN" as const,
        expiresAtLabel: trace.expiresAtStage === undefined ? null : `第 ${trace.expiresAtStage} 阶段结束前`,
        knownBecause: trace.visibility.scope === "PUBLIC" ? "公开局势" : "你的角色已经察觉到这条痕迹",
        routeCount: routes.length,
        visibleToCurrentRole: true as const,
        routes: routes.map((route) => ({
          routeId: route.routeId,
          label: route.label,
          narrativeMethod: route.narrativeMethod,
          mayLearn: [...route.mayLearn],
          cannotProve: [...route.cannotProve],
          costLabels: route.requiredResourceCosts.map((cost) => `${cost.label} ${cost.amount}`),
          returnLabel: settlementMomentLabel(route),
          possibleTrail: route.observableTrail?.summary || null,
        })),
      };
    });
}

export function projectRuleCardsV1(input: {
  cards: RuleCardDefinitionV1[];
  holdings: RuleCardHoldingV1[];
  roleId: string;
}): RuleCardProjectionV1[] {
  return input.holdings
    .filter((holding) => holding.ownerRoleId === input.roleId)
    .flatMap((holding) => {
      const card = input.cards.find((item) => item.cardKey === holding.cardKey);
      if (!card) return [];
      return [{
        cardAssetKey: holding.cardAssetKey,
        cardKey: card.cardKey,
        label: card.label,
        status: holding.status,
        timing: [...card.timing],
        guaranteedEffects: [...card.guaranteedEffects],
        limitations: [...card.playerFacingLimitations],
        counterTags: [...card.counterTags],
      }];
    });
}

export function projectEvidenceHandV1(cards: EvidenceCardStateV1[], roleId: string): EvidenceCardProjectionV1[] {
  return cards.flatMap((card) => {
    const projected = projectEvidenceForRoleV1(card, roleId);
    if (!projected) return [];
    return [{
      evidenceId: projected.evidenceId,
      title: projected.title,
      level: evidenceLevelLabel(projected.level),
      authenticity: projected.authenticity,
      supports: projected.supports.map((support) => support.statement),
      cannotProve: [...projected.cannotProve],
      visibility: projected.visibility,
      sourceLabel: projected.source.routeId,
    }];
  });
}
