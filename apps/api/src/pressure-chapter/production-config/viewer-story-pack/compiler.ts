import { sha256Canonical } from "@ai-story/shared";
import {
  PRESSURE_VIEWER_STORY_PACK_ERROR_CODES_V1 as ERROR,
  type CompilePressureViewerStoryPackInputV1,
  type PressureViewerStoryPackV1,
} from "./contracts";
import {
  assertViewerVisible,
  deepFreezeStoryPack,
  sameStringSet,
  storyFail,
  storyHash,
  storyInteger,
  storySeat,
  storyStrings,
  storyText,
} from "./validation";

/**
 * Pure viewer compiler. The caller must supply one already-authorized snapshot;
 * this function has no persistence, Provider, clock, network or progression
 * capability and therefore cannot change gameplay authority.
 */
export function compilePressureViewerStoryPackV1(
  input: Readonly<CompilePressureViewerStoryPackInputV1>,
): Readonly<PressureViewerStoryPackV1> {
  const runId = storyText(input.runId, "input.runId");
  const routeHash = storyHash(input.routeHash, "input.routeHash");
  const chapterRuntimeId = storyText(input.chapterRuntimeId, "input.chapterRuntimeId");
  const chapterId = storyText(input.chapterId, "input.chapterId");
  const beatId = storyText(input.beatId, "input.beatId");
  const previousBeatId = input.previousBeatId === null
    ? null
    : storyText(input.previousBeatId, "input.previousBeatId");
  const viewerSeatId = storySeat(input.viewerSeatId, "input.viewerSeatId");
  const authorityRevision = storyInteger(input.authorityRevision, "input.authorityRevision");
  const stateAfterHash = storyHash(input.stateAfterHash, "input.stateAfterHash");
  assertBeatBinding(input, chapterId, beatId);

  const previousAction = compilePreviousAction(input, {
    runId,
    chapterRuntimeId,
    previousBeatId,
    viewerSeatId,
    authorityRevision,
  });
  const visibleSeatResults = input.visibleSeatResults.map((item, index) => {
    const path = `input.visibleSeatResults[${index}]`;
    assertPriorIdentity(item, { runId, chapterRuntimeId, previousBeatId, authorityRevision }, path);
    assertViewerVisible(item, viewerSeatId, path);
    return {
      sourceSeatId: storySeat(item.sourceSeatId, `${path}.sourceSeatId`),
      actionId: storyText(item.actionId, `${path}.actionId`),
      summary: storyText(item.summary, `${path}.summary`),
      resultFactRefs: storyStrings(item.resultFactRefs, `${path}.resultFactRefs`),
    };
  });
  uniqueBy(
    visibleSeatResults.map((item) => `${item.sourceSeatId}:${item.actionId}`),
    "input.visibleSeatResults",
  );

  const facts = input.authority.facts.map((item, index) => {
    const path = `input.authority.facts[${index}]`;
    assertViewerVisible(item, viewerSeatId, path);
    if (!["SETTLEMENT", "WORKING_LEDGER", "CATALOG"].includes(item.source)) {
      storyFail(ERROR.AUTHORITY_MISMATCH, `${path}.source`, "UNKNOWN_SOURCE");
    }
    return {
      factRef: storyText(item.factRef, `${path}.factRef`),
      text: storyText(item.text, `${path}.text`),
      source: item.source,
    };
  });
  const metrics = input.authority.metrics.map((item, index) => {
    const path = `input.authority.metrics[${index}]`;
    assertViewerVisible(item, viewerSeatId, path);
    return {
      metricRef: storyText(item.metricRef, `${path}.metricRef`),
      label: storyText(item.label, `${path}.label`),
      displayValue: storyText(item.displayValue, `${path}.displayValue`),
    };
  });
  uniqueBy(facts.map((item) => item.factRef), "input.authority.facts.factRef");
  uniqueBy(metrics.map((item) => item.metricRef), "input.authority.metrics.metricRef");
  const authorityRefs = new Set([
    ...facts.map((item) => item.factRef),
    ...metrics.map((item) => item.metricRef),
    ...visibleSeatResults.flatMap((item) => item.resultFactRefs),
  ]);
  const allowedClaims = input.authority.allowedClaims.map((item, index) => {
    const path = `input.authority.allowedClaims[${index}]`;
    assertViewerVisible(item, viewerSeatId, path);
    const refId = storyText(item.refId, `${path}.refId`);
    if (!authorityRefs.has(refId)) {
      storyFail(ERROR.AUTHORITY_MISMATCH, `${path}.refId`, "UNKNOWN_AUTHORITY_REF");
    }
    if (!["FACT", "METRIC", "RESULT"].includes(item.kind)) {
      storyFail(ERROR.AUTHORITY_MISMATCH, `${path}.kind`, "UNKNOWN_KIND");
    }
    return {
      kind: item.kind,
      refId,
      statement: storyText(item.statement, `${path}.statement`),
      required: item.required === true,
    };
  });
  uniqueBy(
    allowedClaims.map((item) => `${item.kind}:${item.refId}`),
    "input.authority.allowedClaims",
  );

  const declaredMaterials = new Set(input.beat.sourceMaterialRefs);
  const authorialMaterials = input.authorialMaterials.map((item, index) => {
    const path = `input.authorialMaterials[${index}]`;
    assertViewerVisible(item, viewerSeatId, path);
    const materialRef = storyText(item.materialRef, `${path}.materialRef`);
    if (!declaredMaterials.has(materialRef)) {
      storyFail(ERROR.AUTHORITY_MISMATCH, `${path}.materialRef`, "NOT_DECLARED_BY_BEAT");
    }
    const factRefs = storyStrings(item.factRefs, `${path}.factRefs`);
    for (const factRef of factRefs) {
      if (!authorityRefs.has(factRef)) {
        storyFail(ERROR.AUTHORITY_MISMATCH, `${path}.factRefs`, factRef);
      }
    }
    return {
      materialRef,
      title: storyText(item.title, `${path}.title`),
      text: storyText(item.text, `${path}.text`),
      factRefs,
      stopCondition: item.stopCondition === null
        ? null
        : storyText(item.stopCondition, `${path}.stopCondition`),
    };
  });
  if (authorialMaterials.length === 0) {
    storyFail(ERROR.INVALID, "input.authorialMaterials", "NON_EMPTY");
  }
  uniqueBy(authorialMaterials.map((item) => item.materialRef), "input.authorialMaterials");

  const decision = compileDecision(input);
  const identity = {
    runId,
    routeHash,
    chapterRuntimeId,
    chapterId,
    beatId,
    previousBeatId,
    viewerSeatId,
    authorityRevision,
    stateAfterHash,
  };
  const cacheKey = sha256Canonical({
    schemaVersion: "pressure_viewer_story_pack_cache_key_v1",
    ...identity,
    decisionContractRef: decision.decisionContractRef,
    decisionPointRef: decision.decisionPointRef,
    previousActionId: previousAction?.actionId ?? null,
  });
  const body = {
    schemaVersion: "pressure_viewer_story_pack_v1" as const,
    identity,
    previousAction,
    visibleSeatResults,
    authority: { facts, metrics, allowedClaims },
    authorialMaterials,
    decision,
    cacheKey,
  };
  return deepFreezeStoryPack({
    ...body,
    packHash: sha256Canonical(body),
  });
}

function assertBeatBinding(
  input: Readonly<CompilePressureViewerStoryPackInputV1>,
  chapterId: string,
  beatId: string,
): void {
  if (input.beat.beatId !== beatId) {
    storyFail(ERROR.IDENTITY_MISMATCH, "input.beat.beatId", `EXPECTED_${beatId}`);
  }
  if (!input.beat.decisionContractRef?.trim() || !input.beat.catalogDecisionPointRef?.trim()) {
    storyFail(ERROR.INVALID, "input.beat", "RESOLVED_BEAT_REQUIRED");
  }
  if (input.beat.closesChapter && input.beat.advanceCondition.kind !== "CHAPTER_SUMMARY_READY") {
    storyFail(ERROR.DECISION_MISMATCH, "input.beat.advanceCondition.kind", "TERMINAL_SUMMARY_REQUIRED");
  }
  if (!input.beat.closesChapter && input.beat.advanceCondition.kind !== "AUTHORITY_NEXT_DECISION_PIN") {
    storyFail(ERROR.DECISION_MISMATCH, "input.beat.advanceCondition.kind", "NEXT_PIN_REQUIRED");
  }
  if (!beatId.startsWith(`${chapterId}.`)) {
    storyFail(ERROR.IDENTITY_MISMATCH, "input.beatId", "CHAPTER_PREFIX");
  }
}

function compilePreviousAction(
  input: Readonly<CompilePressureViewerStoryPackInputV1>,
  identity: Readonly<{
    runId: string;
    chapterRuntimeId: string;
    previousBeatId: string | null;
    viewerSeatId: CompilePressureViewerStoryPackInputV1["viewerSeatId"];
    authorityRevision: number;
  }>,
) {
  if (identity.previousBeatId === null) {
    if (input.sealedViewerAction !== null || input.visibleSeatResults.length !== 0) {
      storyFail(ERROR.IDENTITY_MISMATCH, "input.previousBeatId", "OPENING_HAS_PRIOR_RESULT");
    }
    return null;
  }
  const action = input.sealedViewerAction;
  if (!action) storyFail(ERROR.IDENTITY_MISMATCH, "input.sealedViewerAction", "REQUIRED");
  assertPriorIdentity(action, identity, "input.sealedViewerAction");
  if (action.viewerSeatId !== identity.viewerSeatId) {
    storyFail(ERROR.SCOPE_VIOLATION, "input.sealedViewerAction.viewerSeatId", "OTHER_SEAT");
  }
  return {
    actionId: storyText(action.actionId, "input.sealedViewerAction.actionId"),
    actionType: storyText(action.actionType, "input.sealedViewerAction.actionType"),
    summary: storyText(action.summary, "input.sealedViewerAction.summary"),
  };
}

function assertPriorIdentity(
  value: Readonly<{
    runId: string;
    chapterRuntimeId: string;
    sourceBeatId: string;
    authorityRevision: number;
  }>,
  identity: Readonly<{
    runId: string;
    chapterRuntimeId: string;
    previousBeatId: string | null;
    authorityRevision: number;
  }>,
  path: string,
): void {
  if (
    value.runId !== identity.runId
    || value.chapterRuntimeId !== identity.chapterRuntimeId
    || value.sourceBeatId !== identity.previousBeatId
    || value.authorityRevision !== identity.authorityRevision
  ) storyFail(ERROR.IDENTITY_MISMATCH, path, "RUN_CHAPTER_BEAT_REVISION");
}

function compileDecision(input: Readonly<CompilePressureViewerStoryPackInputV1>) {
  const decisionPointRef = storyText(
    input.nextDecision.decisionPointRef,
    "input.nextDecision.decisionPointRef",
  );
  if (decisionPointRef !== input.beat.catalogDecisionPointRef) {
    storyFail(ERROR.DECISION_MISMATCH, "input.nextDecision.decisionPointRef", "BEAT_CATALOG_REF");
  }
  const legalActionRefs = storyStrings(
    input.nextDecision.legalActionRefs,
    "input.nextDecision.legalActionRefs",
  );
  if (!sameStringSet(legalActionRefs, input.beat.legalActionRefs)) {
    storyFail(ERROR.DECISION_MISMATCH, "input.nextDecision.legalActionRefs", "BEAT_ACTION_SET");
  }
  const catalogActions = input.nextDecision.catalogActions.map((item, index) => {
    const path = `input.nextDecision.catalogActions[${index}]`;
    return {
      actionRef: storyText(item.actionRef, `${path}.actionRef`),
      actionType: storyText(item.actionType, `${path}.actionType`),
      label: storyText(item.label, `${path}.label`),
      description: storyText(item.description, `${path}.description`),
      preferredEntry: storyText(item.preferredEntry, `${path}.preferredEntry`),
    };
  });
  uniqueBy(catalogActions.map((item) => item.actionRef), "input.nextDecision.catalogActions");
  if (!sameStringSet(catalogActions.map((item) => item.actionRef), legalActionRefs)) {
    storyFail(ERROR.DECISION_MISMATCH, "input.nextDecision.catalogActions", "LEGAL_ACTION_SET");
  }
  return {
    decisionContractRef: input.beat.decisionContractRef,
    decisionPointRef,
    legalActionRefs,
    catalogActions,
  };
}

function uniqueBy(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) storyFail(ERROR.INVALID, path, "DUPLICATE");
}
