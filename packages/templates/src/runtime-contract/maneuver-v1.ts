export const maneuverDraftKindsV1 = ["CONTACT", "INVESTIGATE", "LEVERAGE", "CUSTOM"] as const;
export type ManeuverDraftKindV1 = (typeof maneuverDraftKindsV1)[number];

export const maneuverCompileDecisionsV1 = ["READY", "REROUTE", "CLARIFY", "BLOCKED"] as const;
export type ManeuverCompileDecisionV1 = (typeof maneuverCompileDecisionsV1)[number];

export const maneuverVisibilitiesV1 = ["PRIVATE", "TARGETED", "PUBLIC"] as const;
export type ManeuverVisibilityV1 = (typeof maneuverVisibilitiesV1)[number];

export type ManeuverDraftV1 = {
  kind: ManeuverDraftKindV1;
  targetId?: string;
  intentKey?: string;
  traceId?: string;
  routeId?: string;
  leverageAssetId?: string;
  rawText?: string;
  expectedTurnRevision: number;
};

export type CompiledManeuverV1 = {
  schemaVersion: "compiled_maneuver_v1";
  kind: "CONVERSATION" | "INVESTIGATION" | "ACTION";
  actorRoleId: string;
  targetRef: string;
  objective: string;
  method: string;
  primaryEffect: string;
  attachedLeverageId?: string;
  visibility: ManeuverVisibilityV1;
  guaranteedStart: string[];
  contestedOutcome: string[];
  notGuaranteed: string[];
  stateRevision: number;
  turnRevision: number;
};

export type ManeuverPreviewPresentationV1 = {
  title: string;
  description: string;
  visibleEffect: string;
  visibleRisk?: string;
  confirmLabel: string;
};

export type ManeuverPreviewV1 = {
  decision: ManeuverCompileDecisionV1;
  previewToken?: string;
  expiresAt?: string;
  presentation?: ManeuverPreviewPresentationV1;
  rerouteTo?: ManeuverDraftKindV1;
  clarificationPrompt?: string;
  errorCode?: ManeuverCompileErrorCodeV1;
};

export type ManeuverPreviewCommandV1 = {
  runId: string;
  actorTurnId: string;
  actorRoleId: string;
  expectedStateRevision: number;
  draft: ManeuverDraftV1;
};

export type ManeuverCommitRequestV1 = {
  previewToken: string;
  idempotencyKey: string;
  expectedStateRevision: number;
};

export type ManeuverCompileErrorCodeV1 =
  | "ACTION_NEEDS_CLARIFICATION"
  | "ACTION_NOT_ALLOWED"
  | "TARGET_UNAVAILABLE"
  | "TRACE_UNAVAILABLE"
  | "LEVERAGE_UNAVAILABLE"
  | "MULTIPLE_PRIMARY_EFFECTS"
  | "SEMANTIC_ANALYSIS_REQUIRED";

export type ManeuverContactOptionV1 = {
  id: string;
  label: string;
  method: string;
  guaranteedStart: string;
  contestedOutcome: string;
  notGuaranteed: string;
  visibility: "TARGETED" | "PUBLIC";
};

export type ObservableTraceV1 = {
  traceId: string;
  label: string;
  description: string;
  sourceKind: "DOCUMENT" | "PERSON" | "LOCATION" | "RESOURCE" | "EVENT";
  routeOptions: Array<{
    routeId: string;
    label: string;
    method: string;
    guaranteedStart: string;
    contestedOutcome: string;
    notGuaranteed: string;
  }>;
};

export type ManeuverLeverageAssetV1 = {
  assetId: string;
  label: string;
  effectSummary: string;
  primaryEffect: string;
  method: string;
  legalTargetIds: string[];
  guaranteedStart: string;
  contestedOutcome: string;
  notGuaranteed: string;
  visibility: ManeuverVisibilityV1;
};

export type CustomManeuverReadyAnalysisV1 = {
  decision: "READY";
  targetId: string;
  objective: string;
  method: string;
  primaryEffects: string[];
  visibility: ManeuverVisibilityV1;
  guaranteedStart: string[];
  contestedOutcome: string[];
  notGuaranteed: string[];
  leverageAssetId?: string;
};

export type CustomManeuverAnalysisV1 =
  | CustomManeuverReadyAnalysisV1
  | { decision: "REROUTE"; rerouteTo: Exclude<ManeuverDraftKindV1, "CUSTOM">; reason: string }
  | { decision: "CLARIFY"; prompt: string; detectedPrimaryEffects?: string[] }
  | { decision: "BLOCKED"; reason: string; code?: ManeuverCompileErrorCodeV1 };

export type ManeuverCompilerContextV1 = {
  actorRoleId: string;
  stateRevision: number;
  turnRevision: number;
  contacts: ManeuverContactOptionV1[];
  traces: ObservableTraceV1[];
  leverageAssets: ManeuverLeverageAssetV1[];
  legalTargetIds: string[];
  customAnalysis?: CustomManeuverAnalysisV1;
};

export type ManeuverCompileResultV1 =
  | { decision: "READY"; compiled: CompiledManeuverV1 }
  | { decision: "REROUTE"; rerouteTo: Exclude<ManeuverDraftKindV1, "CUSTOM">; reason: string }
  | { decision: "CLARIFY"; clarificationPrompt: string; errorCode: ManeuverCompileErrorCodeV1 }
  | { decision: "BLOCKED"; reason: string; errorCode: ManeuverCompileErrorCodeV1 };

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,199}$/;
const DRAFT_FIELDS = [
  "kind",
  "targetId",
  "intentKey",
  "traceId",
  "routeId",
  "leverageAssetId",
  "rawText",
  "expectedTurnRevision",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertExactFields(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`MANEUVER_UNKNOWN_FIELD:${path}.${key}`);
  }
}

function requireIdentifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new Error(`MANEUVER_ID_INVALID:${path}`);
  return value;
}

function optionalIdentifier(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return requireIdentifier(value, path);
}

function requireText(value: unknown, path: string, maximum = 500): string {
  if (typeof value !== "string") throw new Error(`MANEUVER_TEXT_INVALID:${path}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(`MANEUVER_TEXT_INVALID:${path}`);
  return normalized;
}

function optionalText(value: unknown, path: string, maximum = 500): string | undefined {
  if (value === undefined) return undefined;
  return requireText(value, path, maximum);
}

function requireRevision(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`MANEUVER_REVISION_INVALID:${path}`);
  return Number(value);
}

function requireStringArray(value: unknown, path: string, maximumItems = 8): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) throw new Error(`MANEUVER_ARRAY_INVALID:${path}`);
  return value.map((entry, index) => requireText(entry, `${path}[${index}]`, 300));
}

function requireVisibility(value: unknown, path: string): ManeuverVisibilityV1 {
  if (typeof value !== "string" || !maneuverVisibilitiesV1.includes(value as ManeuverVisibilityV1)) {
    throw new Error(`MANEUVER_VISIBILITY_INVALID:${path}`);
  }
  return value as ManeuverVisibilityV1;
}

export function validateManeuverDraftV1(input: unknown): ManeuverDraftV1 {
  if (!isRecord(input)) throw new Error("MANEUVER_DRAFT_INVALID:draft");
  assertExactFields(input, DRAFT_FIELDS, "draft");
  if (typeof input.kind !== "string" || !maneuverDraftKindsV1.includes(input.kind as ManeuverDraftKindV1)) {
    throw new Error("MANEUVER_KIND_INVALID:draft.kind");
  }

  const draft: ManeuverDraftV1 = {
    kind: input.kind as ManeuverDraftKindV1,
    expectedTurnRevision: requireRevision(input.expectedTurnRevision, "draft.expectedTurnRevision"),
  };

  const targetId = optionalIdentifier(input.targetId, "draft.targetId");
  const intentKey = optionalIdentifier(input.intentKey, "draft.intentKey");
  const traceId = optionalIdentifier(input.traceId, "draft.traceId");
  const routeId = optionalIdentifier(input.routeId, "draft.routeId");
  const leverageAssetId = optionalIdentifier(input.leverageAssetId, "draft.leverageAssetId");
  const rawText = optionalText(input.rawText, "draft.rawText");

  if (targetId) draft.targetId = targetId;
  if (intentKey) draft.intentKey = intentKey;
  if (traceId) draft.traceId = traceId;
  if (routeId) draft.routeId = routeId;
  if (leverageAssetId) draft.leverageAssetId = leverageAssetId;
  if (rawText) draft.rawText = rawText;

  switch (draft.kind) {
    case "CONTACT":
      if (!draft.targetId) throw new Error("MANEUVER_DRAFT_INVALID:CONTACT.targetId");
      if (!draft.intentKey && !draft.rawText) throw new Error("MANEUVER_DRAFT_INVALID:CONTACT.intent");
      if (draft.traceId || draft.routeId) throw new Error("MANEUVER_DRAFT_INVALID:CONTACT.trace");
      break;
    case "INVESTIGATE":
      if (!draft.traceId || !draft.routeId) throw new Error("MANEUVER_DRAFT_INVALID:INVESTIGATE.route");
      if (draft.targetId || draft.intentKey) throw new Error("MANEUVER_DRAFT_INVALID:INVESTIGATE.target");
      break;
    case "LEVERAGE":
      if (!draft.targetId || !draft.leverageAssetId) throw new Error("MANEUVER_DRAFT_INVALID:LEVERAGE.selection");
      if (draft.traceId || draft.routeId) throw new Error("MANEUVER_DRAFT_INVALID:LEVERAGE.trace");
      break;
    case "CUSTOM":
      if (!draft.rawText) throw new Error("MANEUVER_DRAFT_INVALID:CUSTOM.rawText");
      if (draft.intentKey || draft.traceId || draft.routeId) throw new Error("MANEUVER_DRAFT_INVALID:CUSTOM.structuredFields");
      break;
  }

  return draft;
}

export function validateManeuverPreviewCommandV1(input: unknown): ManeuverPreviewCommandV1 {
  if (!isRecord(input)) throw new Error("MANEUVER_PREVIEW_COMMAND_INVALID:command");
  assertExactFields(input, ["runId", "actorTurnId", "actorRoleId", "expectedStateRevision", "draft"], "command");
  return {
    runId: requireIdentifier(input.runId, "command.runId"),
    actorTurnId: requireIdentifier(input.actorTurnId, "command.actorTurnId"),
    actorRoleId: requireIdentifier(input.actorRoleId, "command.actorRoleId"),
    expectedStateRevision: requireRevision(input.expectedStateRevision, "command.expectedStateRevision"),
    draft: validateManeuverDraftV1(input.draft),
  };
}

export function validateManeuverCommitRequestV1(input: unknown): ManeuverCommitRequestV1 {
  if (!isRecord(input)) throw new Error("MANEUVER_COMMIT_REQUEST_INVALID:command");
  assertExactFields(input, ["previewToken", "idempotencyKey", "expectedStateRevision"], "command");
  const previewToken = requireText(input.previewToken, "command.previewToken", 4096);
  const idempotencyKey = requireText(input.idempotencyKey, "command.idempotencyKey", 200);
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new Error("MANEUVER_IDEMPOTENCY_KEY_INVALID:command.idempotencyKey");
  return {
    previewToken,
    idempotencyKey,
    expectedStateRevision: requireRevision(input.expectedStateRevision, "command.expectedStateRevision"),
  };
}

export function validateCustomManeuverAnalysisV1(input: unknown): CustomManeuverAnalysisV1 {
  if (!isRecord(input)) throw new Error("MANEUVER_ANALYSIS_INVALID:analysis");
  const decision = input.decision;
  if (decision === "READY") {
    assertExactFields(input, [
      "decision",
      "targetId",
      "objective",
      "method",
      "primaryEffects",
      "visibility",
      "guaranteedStart",
      "contestedOutcome",
      "notGuaranteed",
      "leverageAssetId",
    ], "analysis");
    const leverageAssetId = optionalIdentifier(input.leverageAssetId, "analysis.leverageAssetId");
    return {
      decision,
      targetId: requireIdentifier(input.targetId, "analysis.targetId"),
      objective: requireText(input.objective, "analysis.objective", 300),
      method: requireText(input.method, "analysis.method", 300),
      primaryEffects: requireStringArray(input.primaryEffects, "analysis.primaryEffects", 4),
      visibility: requireVisibility(input.visibility, "analysis.visibility"),
      guaranteedStart: requireStringArray(input.guaranteedStart, "analysis.guaranteedStart"),
      contestedOutcome: requireStringArray(input.contestedOutcome, "analysis.contestedOutcome"),
      notGuaranteed: requireStringArray(input.notGuaranteed, "analysis.notGuaranteed"),
      ...(leverageAssetId ? { leverageAssetId } : {}),
    };
  }
  if (decision === "REROUTE") {
    assertExactFields(input, ["decision", "rerouteTo", "reason"], "analysis");
    if (typeof input.rerouteTo !== "string" || !["CONTACT", "INVESTIGATE", "LEVERAGE"].includes(input.rerouteTo)) {
      throw new Error("MANEUVER_ANALYSIS_INVALID:analysis.rerouteTo");
    }
    return { decision, rerouteTo: input.rerouteTo as Exclude<ManeuverDraftKindV1, "CUSTOM">, reason: requireText(input.reason, "analysis.reason") };
  }
  if (decision === "CLARIFY") {
    assertExactFields(input, ["decision", "prompt", "detectedPrimaryEffects"], "analysis");
    return {
      decision,
      prompt: requireText(input.prompt, "analysis.prompt"),
      ...(input.detectedPrimaryEffects === undefined
        ? {}
        : { detectedPrimaryEffects: requireStringArray(input.detectedPrimaryEffects, "analysis.detectedPrimaryEffects", 8) }),
    };
  }
  if (decision === "BLOCKED") {
    assertExactFields(input, ["decision", "reason", "code"], "analysis");
    const code = input.code;
    if (code !== undefined && (typeof code !== "string" || ![
      "ACTION_NEEDS_CLARIFICATION",
      "ACTION_NOT_ALLOWED",
      "TARGET_UNAVAILABLE",
      "TRACE_UNAVAILABLE",
      "LEVERAGE_UNAVAILABLE",
      "MULTIPLE_PRIMARY_EFFECTS",
      "SEMANTIC_ANALYSIS_REQUIRED",
    ].includes(code))) throw new Error("MANEUVER_ANALYSIS_INVALID:analysis.code");
    return {
      decision,
      reason: requireText(input.reason, "analysis.reason"),
      ...(code ? { code: code as ManeuverCompileErrorCodeV1 } : {}),
    };
  }
  throw new Error("MANEUVER_ANALYSIS_INVALID:analysis.decision");
}

function findLeverage(context: ManeuverCompilerContextV1, assetId: string | undefined): ManeuverLeverageAssetV1 | undefined {
  if (!assetId) return undefined;
  return context.leverageAssets.find((asset) => asset.assetId === assetId);
}

function block(reason: string, errorCode: ManeuverCompileErrorCodeV1): ManeuverCompileResultV1 {
  return { decision: "BLOCKED", reason, errorCode };
}

function clarify(clarificationPrompt: string, errorCode: ManeuverCompileErrorCodeV1 = "ACTION_NEEDS_CLARIFICATION"): ManeuverCompileResultV1 {
  return { decision: "CLARIFY", clarificationPrompt, errorCode };
}

function baseCompiled(
  context: ManeuverCompilerContextV1,
  input: Omit<CompiledManeuverV1, "schemaVersion" | "actorRoleId" | "stateRevision" | "turnRevision">,
): CompiledManeuverV1 {
  return {
    schemaVersion: "compiled_maneuver_v1",
    actorRoleId: context.actorRoleId,
    stateRevision: context.stateRevision,
    turnRevision: context.turnRevision,
    ...input,
  };
}

function verifyOptionalLeverage(
  context: ManeuverCompilerContextV1,
  assetId: string | undefined,
  targetId: string,
): ManeuverLeverageAssetV1 | ManeuverCompileResultV1 | undefined {
  if (!assetId) return undefined;
  const asset = findLeverage(context, assetId);
  if (!asset || !asset.legalTargetIds.includes(targetId)) {
    return block("The selected leverage is not owned or is not legal for this target.", "LEVERAGE_UNAVAILABLE");
  }
  return asset;
}

export function compileManeuverV1(
  draftInput: ManeuverDraftV1 | unknown,
  context: ManeuverCompilerContextV1,
): ManeuverCompileResultV1 {
  const draft = validateManeuverDraftV1(draftInput);
  if (draft.expectedTurnRevision !== context.turnRevision) {
    return block("The turn changed before this maneuver could be compiled.", "ACTION_NOT_ALLOWED");
  }

  switch (draft.kind) {
    case "CONTACT": {
      const contact = context.contacts.find((candidate) => candidate.id === draft.targetId);
      if (!contact) return block("The selected contact is not currently available.", "TARGET_UNAVAILABLE");
      const leverage = verifyOptionalLeverage(context, draft.leverageAssetId, contact.id);
      if (leverage && "decision" in leverage) return leverage;
      return {
        decision: "READY",
        compiled: baseCompiled(context, {
          kind: "CONVERSATION",
          targetRef: contact.id,
          objective: draft.rawText ?? String(draft.intentKey),
          method: contact.method,
          primaryEffect: "OPEN_INTERACTION",
          ...(leverage ? { attachedLeverageId: leverage.assetId } : {}),
          visibility: contact.visibility,
          guaranteedStart: [contact.guaranteedStart],
          contestedOutcome: [contact.contestedOutcome],
          notGuaranteed: [contact.notGuaranteed],
        }),
      };
    }
    case "INVESTIGATE": {
      const trace = context.traces.find((candidate) => candidate.traceId === draft.traceId);
      if (!trace) return block("The selected trace is not visible or no longer available.", "TRACE_UNAVAILABLE");
      const route = trace.routeOptions.find((candidate) => candidate.routeId === draft.routeId);
      if (!route) return block("The selected investigation route is not available.", "TRACE_UNAVAILABLE");
      const leverage = verifyOptionalLeverage(context, draft.leverageAssetId, trace.traceId);
      if (leverage && "decision" in leverage) return leverage;
      return {
        decision: "READY",
        compiled: baseCompiled(context, {
          kind: "INVESTIGATION",
          targetRef: trace.traceId,
          objective: `Investigate: ${trace.label}`,
          method: route.method,
          primaryEffect: "START_INVESTIGATION",
          ...(leverage ? { attachedLeverageId: leverage.assetId } : {}),
          visibility: "PRIVATE",
          guaranteedStart: [route.guaranteedStart],
          contestedOutcome: [route.contestedOutcome],
          notGuaranteed: [route.notGuaranteed],
        }),
      };
    }
    case "LEVERAGE": {
      const asset = findLeverage(context, draft.leverageAssetId);
      if (!asset) return block("The selected leverage is not owned by the current role.", "LEVERAGE_UNAVAILABLE");
      if (!draft.targetId || !asset.legalTargetIds.includes(draft.targetId)) {
        return block("The selected leverage cannot be applied to this target.", "LEVERAGE_UNAVAILABLE");
      }
      return {
        decision: "READY",
        compiled: baseCompiled(context, {
          kind: "ACTION",
          targetRef: draft.targetId,
          objective: draft.rawText ?? asset.effectSummary,
          method: asset.method,
          primaryEffect: asset.primaryEffect,
          attachedLeverageId: asset.assetId,
          visibility: asset.visibility,
          guaranteedStart: [asset.guaranteedStart],
          contestedOutcome: [asset.contestedOutcome],
          notGuaranteed: [asset.notGuaranteed],
        }),
      };
    }
    case "CUSTOM": {
      if (!context.customAnalysis) {
        return clarify("Describe one target and one action so the plan can be interpreted safely.", "SEMANTIC_ANALYSIS_REQUIRED");
      }
      const analysis = validateCustomManeuverAnalysisV1(context.customAnalysis);
      if (analysis.decision === "REROUTE") {
        return { decision: "REROUTE", rerouteTo: analysis.rerouteTo, reason: analysis.reason };
      }
      if (analysis.decision === "CLARIFY") {
        return clarify(analysis.prompt, analysis.detectedPrimaryEffects && analysis.detectedPrimaryEffects.length > 1
          ? "MULTIPLE_PRIMARY_EFFECTS"
          : "ACTION_NEEDS_CLARIFICATION");
      }
      if (analysis.decision === "BLOCKED") {
        return block(analysis.reason, analysis.code ?? "ACTION_NOT_ALLOWED");
      }
      if (analysis.primaryEffects.length !== 1) {
        return clarify("Choose exactly one primary action before previewing this plan.", "MULTIPLE_PRIMARY_EFFECTS");
      }
      if (!context.legalTargetIds.includes(analysis.targetId)) {
        return block("The selected target is not available to the current role.", "TARGET_UNAVAILABLE");
      }
      const leverage = verifyOptionalLeverage(context, analysis.leverageAssetId ?? draft.leverageAssetId, analysis.targetId);
      if (leverage && "decision" in leverage) return leverage;
      return {
        decision: "READY",
        compiled: baseCompiled(context, {
          kind: "ACTION",
          targetRef: analysis.targetId,
          objective: analysis.objective,
          method: analysis.method,
          primaryEffect: analysis.primaryEffects[0],
          ...(leverage ? { attachedLeverageId: leverage.assetId } : {}),
          visibility: analysis.visibility,
          guaranteedStart: [...analysis.guaranteedStart],
          contestedOutcome: [...analysis.contestedOutcome],
          notGuaranteed: [...analysis.notGuaranteed],
        }),
      };
    }
  }
}
