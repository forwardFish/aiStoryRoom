import type {
  CustomManeuverAnalysisV1,
  ManeuverCompilerContextV1,
  ManeuverContactOptionV1,
  ManeuverLeverageAssetV1,
  ObservableTraceV1,
} from "@ai-story/templates";
import {
  investigationOutcomesFromContextV1,
  type InvestigationOutcomeDefinitionV1,
} from "./maneuver-v1.evidence";
import { domain, optionalRecord, record, stringArray, text, uniqueStrings } from "./maneuver-v1.prisma-utils";

export type ParsedManeuverContextV1 = {
  compilerContext: ManeuverCompilerContextV1;
  investigationOutcomes: InvestigationOutcomeDefinitionV1[];
};

export function parseManeuverContextV1(
  contextJson: unknown,
  roleAssets: any[],
  revisions: { roleId: string; stateRevision: number; turnRevision: number },
): ParsedManeuverContextV1 {
  const root = record(contextJson, "turn.contextJson");
  const maneuver = optionalRecord(root.maneuverV1) || {};
  const source = optionalRecord(maneuver.compilerContext) || maneuver;
  const investigationOutcomes = investigationOutcomesFromContextV1(contextJson);
  const allowedRouteIds = new Set(investigationOutcomes.map((outcome) => outcome.routeId));
  const contacts = parseContacts(source.contacts);
  const traces = parseTraces(source.traces, allowedRouteIds);
  const leverageAssets = roleAssets.flatMap((asset) => {
    const parsed = parseLeverageAsset(asset);
    return parsed ? [parsed] : [];
  });
  const legalTargetIds = uniqueStrings([
    ...stringArray(source.legalTargetIds),
    ...contacts.map((contact) => contact.id),
    ...traces.map((trace) => trace.traceId),
    ...leverageAssets.flatMap((asset) => asset.legalTargetIds),
  ]);
  return {
    compilerContext: {
      actorRoleId: revisions.roleId,
      stateRevision: revisions.stateRevision,
      turnRevision: revisions.turnRevision,
      contacts,
      traces,
      leverageAssets,
      legalTargetIds,
      ...(source.customAnalysis === undefined ? {} : { customAnalysis: source.customAnalysis as CustomManeuverAnalysisV1 }),
    },
    investigationOutcomes,
  };
}

function parseContacts(value: unknown): ManeuverContactOptionV1[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const row = record(entry, `contacts[${index}]`);
    return {
      id: text(row.id, `contacts[${index}].id`),
      label: text(row.label, `contacts[${index}].label`),
      method: text(row.method, `contacts[${index}].method`),
      guaranteedStart: text(row.guaranteedStart, `contacts[${index}].guaranteedStart`),
      contestedOutcome: text(row.contestedOutcome, `contacts[${index}].contestedOutcome`),
      notGuaranteed: text(row.notGuaranteed, `contacts[${index}].notGuaranteed`),
      visibility: row.visibility === "PUBLIC" ? "PUBLIC" : "TARGETED",
    };
  });
}

function parseTraces(value: unknown, allowedRouteIds: Set<string>): ObservableTraceV1[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    const row = record(entry, `traces[${index}]`);
    const sourceKind = String(row.sourceKind || "");
    if (!["DOCUMENT", "PERSON", "LOCATION", "RESOURCE", "EVENT"].includes(sourceKind)) {
      throw domain("MANEUVER_CONTEXT_INVALID", `traces[${index}].sourceKind is invalid.`, 500, false);
    }
    if (!Array.isArray(row.routeOptions)) {
      throw domain("MANEUVER_CONTEXT_INVALID", `traces[${index}].routeOptions is invalid.`, 500, false);
    }
    const routeOptions = row.routeOptions.flatMap((routeInput, routeIndex) => {
      const route = record(routeInput, `traces[${index}].routeOptions[${routeIndex}]`);
      const routeId = text(route.routeId, `traces[${index}].routeOptions[${routeIndex}].routeId`);
      if (!allowedRouteIds.has(routeId)) return [];
      return [{
        routeId,
        label: text(route.label, `traces[${index}].routeOptions[${routeIndex}].label`),
        method: text(route.method, `traces[${index}].routeOptions[${routeIndex}].method`),
        guaranteedStart: text(route.guaranteedStart, `traces[${index}].routeOptions[${routeIndex}].guaranteedStart`),
        contestedOutcome: text(route.contestedOutcome, `traces[${index}].routeOptions[${routeIndex}].contestedOutcome`),
        notGuaranteed: text(route.notGuaranteed, `traces[${index}].routeOptions[${routeIndex}].notGuaranteed`),
      }];
    });
    if (!routeOptions.length) return [];
    return [{
      traceId: text(row.traceId, `traces[${index}].traceId`),
      label: text(row.label, `traces[${index}].label`),
      description: text(row.description, `traces[${index}].description`),
      sourceKind: sourceKind as ObservableTraceV1["sourceKind"],
      routeOptions,
    }];
  });
}

function parseLeverageAsset(asset: any): ManeuverLeverageAssetV1 | null {
  const state = optionalRecord(asset.stateJson);
  const source = state && optionalRecord(state.maneuverV1);
  if (!source) return null;
  const legalTargetIds = stringArray(source.legalTargetIds);
  if (!legalTargetIds.length) return null;
  return {
    assetId: String(asset.id || asset.assetKey),
    label: text(source.label || asset.assetKey, "leverage.label"),
    effectSummary: text(source.effectSummary, "leverage.effectSummary"),
    primaryEffect: text(source.primaryEffect, "leverage.primaryEffect"),
    method: text(source.method, "leverage.method"),
    legalTargetIds,
    guaranteedStart: text(source.guaranteedStart, "leverage.guaranteedStart"),
    contestedOutcome: text(source.contestedOutcome, "leverage.contestedOutcome"),
    notGuaranteed: text(source.notGuaranteed, "leverage.notGuaranteed"),
    visibility: source.visibility === "PUBLIC" ? "PUBLIC" : source.visibility === "PRIVATE" ? "PRIVATE" : "TARGETED",
  };
}
