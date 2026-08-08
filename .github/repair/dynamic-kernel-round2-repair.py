from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"replacement target missing: {path}\n{old[:160]}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


# 1. The production regression file must compile and remain in the real suite.
replace_once(
    "apps/openovel-runtime/tests/sangtian-dynamic-kernel-production.spec.ts",
    '''    const resolution = freePrepared.audit.intentResolution
      as Record<string, unknown>;''',
    '''    const resolution = freePrepared.audit.intentResolution as Record<
      string,
      unknown
    >;''',
)

# 2. World-agnostic Requirement continuity is a structural score component.
selector_path = "packages/templates/src/runtime-contract/kernel-selector-lite.ts"
replace_once(
    selector_path,
    '''  PRESENT_PRESSURE_ACTOR: 4,
} as const;''',
    '''  PRESENT_PRESSURE_ACTOR: 4,
  RECENT_REQUIREMENT_CONTINUITY: 20,
} as const;''',
)
replace_once(
    selector_path,
    '''  availablePressureActorCount: number;
  validAffordances: Array<KernelSelectorLiteAffordance<TPayload>>;''',
    '''  availablePressureActorCount: number;
  /** Shared structured Requirements with the most recently settled Kernel. */
  recentRequirementContinuityCount?: number;
  validAffordances: Array<KernelSelectorLiteAffordance<TPayload>>;''',
)
replace_once(
    selector_path,
    '''    + Math.min(candidate.availablePressureActorCount, 3)
      * KERNEL_SELECTOR_LITE_WEIGHTS.PRESENT_PRESSURE_ACTOR;
}''',
    '''    + Math.min(candidate.availablePressureActorCount, 3)
      * KERNEL_SELECTOR_LITE_WEIGHTS.PRESENT_PRESSURE_ACTOR
    + (candidate.recentRequirementContinuityCount || 0)
      * KERNEL_SELECTOR_LITE_WEIGHTS.RECENT_REQUIREMENT_CONTINUITY;
}''',
)

runtime_path = "packages/templates/src/story-package/dynamic-kernel-lite-runtime.ts"
replace_once(
    runtime_path,
    '''        availablePressureActorCount: 0,
        validAffordances: [],''',
    '''        availablePressureActorCount: 0,
        recentRequirementContinuityCount: 0,
        validAffordances: [],''',
)
replace_once(
    runtime_path,
    '''  const present = new Set(state.scene?.presentActorRefs || []);
  if (options.length < 2) rejectionCodes.push("KERNEL_OPTIONS_MISSING");''',
    '''  const present = new Set(state.scene?.presentActorRefs || []);
  const recentRequirementContinuity = countRecentRequirementContinuity(
    pkg,
    state,
    kernel,
  );
  if (options.length < 2) rejectionCodes.push("KERNEL_OPTIONS_MISSING");''',
)
replace_once(
    runtime_path,
    '''      availablePressureActorCount: candidateWorkingSet.decisionPoint.actorRefs
        .filter((actorId) => present.has(actorId)).length,
      validAffordances: previews.map((preview) => ({''',
    '''      availablePressureActorCount: candidateWorkingSet.decisionPoint.actorRefs
        .filter((actorId) => present.has(actorId)).length,
      recentRequirementContinuityCount: recentRequirementContinuity,
      validAffordances: previews.map((preview) => ({''',
)
replace_once(
    runtime_path,
    '''/**
 * Return only obligations explicitly owned by this Kernel through reciprocal
 * Requirement/Decision-Contract links. A candidate's state dependencies,
 * option patches and successful previews prove that it can execute; they do
 * not grant ownership of every path it happens to touch.
 */
function obligationOwnershipPaths(''',
    '''/**
 * Preserve direct causal continuity without consulting prose, authored array
 * position or story-specific IDs. `completedKernelIds` is append-only; its
 * final entry is therefore the most recently settled structured decision.
 */
function countRecentRequirementContinuity(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  kernel: PartOneRuntimeAsset,
) {
  const recentKernelId = [...(state.completedKernelIds || [])].at(-1);
  if (!recentKernelId) return 0;
  const recentKernel = pkg.assets.find((asset) => (
    asset.assetType === "DECISION_KERNEL"
    && asset.assetId === recentKernelId
  ));
  if (!recentKernel) return 0;
  const recentRequirements = new Set(recentKernel.requirementIds);
  return kernel.requirementIds.filter(
    (requirementId) => recentRequirements.has(requirementId),
  ).length;
}

/**
 * Return only obligations explicitly owned by this Kernel through reciprocal
 * Requirement/Decision-Contract links. A candidate's state dependencies,
 * option patches and successful previews prove that it can execute; they do
 * not grant ownership of every path it happens to touch.
 */
function obligationOwnershipPaths(''',
)

# 3. Settlement reaction expression and next-decision routing are separate.
engine_path = "packages/templates/src/story-package/part-one-runtime-engine.ts"
replace_once(
    engine_path,
    '''export function completePartOneActionSettlement(
  pkg: PartOneRuntimePackage,
  current: PartOneCurrentActionSettlement,
  nextWorkingSet: PartOneRuntimeWorkingSet,
): PartOneActionSettlement {
  if (
    nextWorkingSet.packageHash !== pkg.immutableHash
    || nextWorkingSet.section.sectionId !== current.proposedState.sectionId
    || nextWorkingSet.turnNumber !== current.turnNumber
  ) {
    throw new Error("PART_ONE_NEXT_DECISION_SURFACE_MISMATCH");
  }
''',
    '''export function completePartOneActionSettlement(
  pkg: PartOneRuntimePackage,
  current: PartOneCurrentActionSettlement,
  nextWorkingSet: PartOneRuntimeWorkingSet,
  reactionWorkingSet: PartOneRuntimeWorkingSet = nextWorkingSet,
): PartOneActionSettlement {
  if (
    nextWorkingSet.packageHash !== pkg.immutableHash
    || nextWorkingSet.section.sectionId !== current.proposedState.sectionId
    || nextWorkingSet.turnNumber !== current.turnNumber
  ) {
    throw new Error("PART_ONE_NEXT_DECISION_SURFACE_MISMATCH");
  }
  if (
    reactionWorkingSet.packageHash !== pkg.immutableHash
    || reactionWorkingSet.section.sectionId !== current.proposedState.sectionId
    || reactionWorkingSet.turnNumber !== current.turnNumber
  ) {
    throw new Error("PART_ONE_REACTION_SURFACE_MISMATCH");
  }
''',
)
replace_once(
    engine_path,
    '''  const authoritativeNpcReactions = buildAuthoritativeNpcReactions({
    eventId: current.eventId,
    sceneAfter,
    nextWorkingSet,
  });
  const authoritativeWorldMoves = buildAuthoritativeWorldMoves({
    dueConsequences: current.dueConsequences,
    nextWorkingSet,''',
    '''  const authoritativeNpcReactions = buildAuthoritativeNpcReactions({
    eventId: current.eventId,
    sceneAfter,
    reactionWorkingSet,
  });
  const authoritativeWorldMoves = buildAuthoritativeWorldMoves({
    dueConsequences: current.dueConsequences,
    reactionWorkingSet,''',
)
replace_once(
    engine_path,
    '''function buildAuthoritativeWorldMoves(input: {
  dueConsequences: PartOnePendingConsequenceState[];
  nextWorkingSet: PartOneRuntimeWorkingSet;''',
    '''function buildAuthoritativeWorldMoves(input: {
  dueConsequences: PartOnePendingConsequenceState[];
  reactionWorkingSet: PartOneRuntimeWorkingSet;''',
)
replace_once(
    engine_path,
    '''  const pressure = input.nextWorkingSet.nextDecisionPressure;''',
    '''  const pressure = input.reactionWorkingSet.nextDecisionPressure;''',
)
replace_once(
    engine_path,
    '''function buildAuthoritativeNpcReactions(input: {
  eventId: string;
  sceneAfter: PartOneSceneState;
  nextWorkingSet: PartOneRuntimeWorkingSet;
}): PartOneCommittedEvent["authoritativeNpcReactions"] {
  // Continuation pressures are already emitted as authoritative world moves.
  // Emitting the same pressure as an NPC reaction would duplicate the scene
  // stop. A terminal handoff is player navigation, not an NPC action.
  if (
    input.nextWorkingSet.nextDecisionPressure
    || input.nextWorkingSet.decisionPoint.decisionPointId === "PART-02-HANDOFF-PREVIEW"
  ) {
    return [];
  }
  const point = input.nextWorkingSet.decisionPoint;''',
    '''function buildAuthoritativeNpcReactions(input: {
  eventId: string;
  sceneAfter: PartOneSceneState;
  reactionWorkingSet: PartOneRuntimeWorkingSet;
}): PartOneCommittedEvent["authoritativeNpcReactions"] {
  // Current reaction expression is frozen before any finalized-state replan.
  // The final next WorkingSet owns only the next Decision Point.
  if (
    input.reactionWorkingSet.nextDecisionPressure
    || input.reactionWorkingSet.decisionPoint.decisionPointId
      === "PART-02-HANDOFF-PREVIEW"
  ) {
    return [];
  }
  const point = input.reactionWorkingSet.decisionPoint;''',
)

# Settlement, not an authored fallback, is the only authority for a transition.
replace_once(
    engine_path,
    '''  const playerVisibleFallback = {
    ...(input.playerVisibleFallback || {
      PLAYER_RESULT: playerOutcome,
      ...(transitionMove?.action
        ? { SCENE_TRANSITION: transitionMove.action }
        : {}),
      WORLD_PRESSURE: worldPressure
    }),
    DECISION_STOP: decisionStop
  };''',
    '''  const authoredFallback = input.playerVisibleFallback || null;
  const playerVisibleFallback: PartOnePlayerVisibleFallback = {
    PLAYER_RESULT: String(
      authoredFallback?.PLAYER_RESULT || playerOutcome,
    ).trim(),
    ...(authoredFallback?.IMMEDIATE_REACTION
      ? { IMMEDIATE_REACTION: authoredFallback.IMMEDIATE_REACTION }
      : {}),
    ...(transitionMove?.action
      ? { SCENE_TRANSITION: transitionMove.action }
      : {}),
    WORLD_PRESSURE: String(
      authoredFallback?.WORLD_PRESSURE || worldPressure,
    ).trim(),
    DECISION_STOP: decisionStop,
  };''',
)

settlement_path = "packages/templates/src/story-package/dynamic-kernel-lite-settlement.ts"
replace_once(
    settlement_path,
    '''  let plan = planNextTurn(
    pkg,
    causal.proposedState,
    turnNumber,
    recoverySurface,
  );
  let settlement = completeWithRecoverablePlan(
    pkg,
    causal,
    plan,
    recoverySurface,
  );''',
    '''  const reactionPlan = planNextTurn(
    pkg,
    causal.proposedState,
    turnNumber,
    recoverySurface,
  );
  let plan = reactionPlan;
  let settlement = completeWithRecoverablePlan(
    pkg,
    causal,
    plan,
    recoverySurface,
    reactionPlan,
  );''',
)
replace_once(
    settlement_path,
    '''    settlement = completeWithRecoverablePlan(
      pkg,
      causal,
      plan,
      recoverySurface,
    );''',
    '''    settlement = completeWithRecoverablePlan(
      pkg,
      causal,
      plan,
      recoverySurface,
      reactionPlan,
    );''',
)
replace_once(
    settlement_path,
    '''function completeWithRecoverablePlan(
  pkg: PartOneRuntimePackage,
  causal: PartOneCurrentActionSettlement,
  plan: NextTurnPlan,
  recoverySurface: DynamicPartOneRuntimeWorkingSet,
) {
  try {
    return completePartOneActionSettlement(
      pkg,
      causal,
      plan.workingSet,
    );''',
    '''function completeWithRecoverablePlan(
  pkg: PartOneRuntimePackage,
  causal: PartOneCurrentActionSettlement,
  plan: NextTurnPlan,
  recoverySurface: DynamicPartOneRuntimeWorkingSet,
  reactionPlan: NextTurnPlan,
) {
  try {
    return completePartOneActionSettlement(
      pkg,
      causal,
      plan.workingSet,
      reactionPlan.workingSet,
    );''',
)
replace_once(
    settlement_path,
    '''    plan.workingSet = recovered;
    plan.status = "RECOVERED";
    plan.failureCode = failureCode;
    return completePartOneActionSettlement(pkg, causal, recovered);''',
    '''    plan.workingSet = recovered;
    plan.status = "RECOVERED";
    plan.failureCode = failureCode;
    if (plan === reactionPlan) {
      reactionPlan.workingSet = recovered;
      reactionPlan.status = "RECOVERED";
      reactionPlan.failureCode = failureCode;
    }
    return completePartOneActionSettlement(
      pkg,
      causal,
      recovered,
      reactionPlan.workingSet,
    );''',
)

# 4. OpenNovel fallback projection drops any slot not authorized by Manifest.
base_path = "apps/openovel-runtime/src/sangtian-decisions-base.ts"
replace_once(
    base_path,
    '''  return {
    ...(planned || {}),
    ...(authored || {}),
    PLAYER_RESULT: playerResult,
    WORLD_PRESSURE: worldPressure,
    // The planner owns the current stop point. An authored fallback cannot
    // carry an older decision into a newly selected continuation Kernel.
    DECISION_STOP: decisionStop,
  };
}''',
    '''  const merged: PlayerVisibleFallbackSurface = {
    ...(planned || {}),
    ...(authored || {}),
    PLAYER_RESULT: playerResult,
    WORLD_PRESSURE: worldPressure,
    // The planner owns the current stop point. An authored fallback cannot
    // carry an older decision into a newly selected continuation Kernel.
    DECISION_STOP: decisionStop,
  };
  // Settlement also exclusively owns scene movement. An authored surface from
  // an older sequence cannot introduce a transition absent from the current
  // planner projection.
  const sceneTransition = String(planned?.SCENE_TRANSITION || "").trim();
  if (sceneTransition) merged.SCENE_TRANSITION = sceneTransition;
  else delete merged.SCENE_TRANSITION;
  return merged;
}

function projectFallbackSlotsToManifest(
  fallback: PlayerVisibleFallbackSurface,
  manifest: BeatManifest,
): PlayerVisibleFallbackSurface {
  const projected: Partial<Record<
    (typeof narrativeSlotIds)[number],
    string
  >> = {};
  for (const slot of narrativeSlotIds) {
    const tickets = manifest.tickets.filter((ticket) => ticket.slot === slot);
    if (!tickets.length) continue;
    const protectedTexts = [...new Set(tickets
      .filter((ticket) => ticket.expressionOwner === "PROTECTED")
      .map((ticket) => String(ticket.protectedText || "").trim())
      .filter(Boolean))];
    if (protectedTexts.length > 1) {
      throw new Error(`FALLBACK_PROTECTED_TEXT_CONFLICT:${slot}`);
    }
    const text = protectedTexts[0]
      || String(fallback[slot] || "").trim();
    if (text) projected[slot] = text;
  }
  return projected as PlayerVisibleFallbackSurface;
}''',
)
replace_once(
    base_path,
    '''    const surfaceSourceRef = beatContract.sourceRef || `part-one-event:${event.eventId}`;
    const surfaceProvenance = Object.fromEntries(
      narrativeSlotIds
        .filter((slot) => fallbackSlots[slot])
        .map((slot) => [slot, {
          surfaceSource: "STORY_PACKAGE" as const,
          sourceRef: surfaceSourceRef,
          coveredTicketIds: beatManifest.tickets
            .filter((ticket) => ticket.slot === slot)
            .map((ticket) => ticket.ticketId),
        }]),
    );
    const fallbackDraft = bindProtectedFallbackDraft({
      schemaVersion: SCENE_DRAFT_SCHEMA,
      draftId: `${event.eventId}.fallback`,
      owner: "FALLBACK",
      slots: fallbackSlots,
      surfaceProvenance,
    }, beatManifest);''',
    '''    const projectedFallbackSlots = projectFallbackSlotsToManifest(
      fallbackSlots,
      beatManifest,
    );
    const surfaceSourceRef = beatContract.sourceRef || `part-one-event:${event.eventId}`;
    const surfaceProvenance = Object.fromEntries(
      narrativeSlotIds
        .filter((slot) => projectedFallbackSlots[slot])
        .map((slot) => [slot, {
          surfaceSource: "STORY_PACKAGE" as const,
          sourceRef: surfaceSourceRef,
          coveredTicketIds: beatManifest.tickets
            .filter((ticket) => ticket.slot === slot)
            .map((ticket) => ticket.ticketId),
        }]),
    );
    const fallbackDraft = bindProtectedFallbackDraft({
      schemaVersion: SCENE_DRAFT_SCHEMA,
      draftId: `${event.eventId}.fallback`,
      owner: "FALLBACK",
      slots: projectedFallbackSlots,
      surfaceProvenance,
    }, beatManifest);''',
)

# 5. Permanent regressions: generic selector continuity and two-surface contract.
selector_test_path = "packages/templates/tests/kernel-selector-lite.test.ts"
selector_test = '''test("recent structured Requirement continuity outranks a later outcome-distance tie", () => {
  const [base] = neutralCandidates();
  assert.ok(base);
  const direct = structuredClone(base);
  direct.kernelId = "kernel.direct-continuation";
  direct.recentRequirementContinuityCount = 2;

  const adjacent = structuredClone(base);
  adjacent.kernelId = "kernel.adjacent-conflict";
  adjacent.recentRequirementContinuityCount = 1;

  const normal = selectKernelLite([adjacent, direct], "STATE-CONTINUITY");
  const reversed = selectKernelLite([direct, adjacent], "STATE-CONTINUITY");
  assert.equal(normal.selected?.kernelId, direct.kernelId);
  assert.equal(reversed.selected?.kernelId, direct.kernelId);
});

'''
replace_once(
    selector_test_path,
    'test("duplicate outcomes are traced and cannot form a valid option pair", () => {',
    selector_test + 'test("duplicate outcomes are traced and cannot form a valid option pair", () => {',
)

part_one_test_path = "packages/templates/tests/part-one-dynamic-kernel-lite.test.ts"
replace_once(
    part_one_test_path,
    '''  createInitialPartOneState,
  partOneSceneForSection,
} from "../src/story-package/part-one-runtime-engine.js";''',
    '''  completePartOneActionSettlement,
  createInitialPartOneState,
  partOneSceneForSection,
  settlePartOneCurrentAction,
} from "../src/story-package/part-one-runtime-engine.js";''',
)
reaction_test = '''test("reaction WorkingSet cannot be overwritten by the final next-decision WorkingSet", () => {
  const pkg = packageUnderTest();
  const initial = createInitialPartOneState(pkg);
  const current = settlePartOneCurrentAction(
    pkg,
    initial,
    {
      source: "RECOMMENDED",
      decisionId: "opening_d1",
      actionText: "opening_d1",
    },
    1,
  );
  const reactionWorkingSet = buildDynamicPartOneRuntimeWorkingSet(
    pkg,
    current.proposedState,
    1,
    {
      pin: {
        decisionKernelId: "DK-P1-EXECUTION-SCOPE",
        decisionPointId: "DK-P1-EXECUTION-SCOPE",
      },
    },
  );
  const nextWorkingSet = buildDynamicPartOneRuntimeWorkingSet(
    pkg,
    current.proposedState,
    1,
    {
      pin: {
        decisionKernelId: "DK-P1-RESPONSIBILITY-RECORD",
        decisionPointId: "DK-P1-RESPONSIBILITY-RECORD",
      },
    },
  );
  assert.notEqual(
    reactionWorkingSet.decisionPoint.prompt,
    nextWorkingSet.decisionPoint.prompt,
  );

  const settlement = completePartOneActionSettlement(
    pkg,
    current,
    nextWorkingSet,
    reactionWorkingSet,
  );
  assert.equal(
    settlement.event.authoritativeNpcReactions[0]?.action,
    reactionWorkingSet.decisionPoint.prompt,
  );
  assert.equal(
    settlement.event.nextDecisionPoint.decisionPointId,
    nextWorkingSet.decisionPoint.decisionPointId,
  );
});

'''
replace_once(
    part_one_test_path,
    'test("one malformed candidate is isolated instead of aborting another valid dynamic kernel", () => {',
    reaction_test + 'test("one malformed candidate is isolated instead of aborting another valid dynamic kernel", () => {',
)

production_test_path = "apps/openovel-runtime/tests/sangtian-dynamic-kernel-production.spec.ts"
fallback_test = '''test("an authored fallback cannot project a scene transition rejected by Settlement", async () => {
  const pkg = packageUnderTest();
  const opening = settleDynamicPartOneAction(
    pkg,
    templatesPackage.createInitialPartOneState(pkg),
    {
      source: "RECOMMENDED",
      decisionId: "opening_d1",
      actionText: "opening_d1",
    },
    1,
  );
  const state = structuredClone(opening.proposedState);
  const eventId = "EVENT-FALLBACK-SCENE-AUTHORITY";
  state.lastCommittedEventId = eventId;
  const responsibility = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    1,
    {
      mode: "DYNAMIC_LITE",
      pin: {
        decisionKernelId: "DK-P1-RESPONSIBILITY-RECORD",
        decisionPointId: "DK-P1-RESPONSIBILITY-RECORD",
      },
    },
  );
  const event = {
    eventId,
    turnNumber: state.turnNumber,
    sectionIdAfter: state.sectionId,
    nextDecisionPoint: responsibility.decisionPoint,
    nextKernelSelection: responsibility.kernelSelection,
  };
  const fixture = await workspaceFixture(state, event);
  try {
    const options = await currentSangtianOptions(
      fixture.workspace,
      "run.fallback-scene-authority",
    );
    assert.ok(options);
    fixture.setPreviousOptions(options);
    const selected = options.find(
      (option) => option.id === "DK-P1-RESPONSIBILITY-RECORD-OPT-02",
    );
    assert.ok(selected);
    const prepared = await sangtianDecisionAdapter.prepare(
      fixture.workspace,
      {
        runId: "run.fallback-scene-authority",
        turnNumber: 2,
        action: selected.label,
        selectedOption: selected,
      },
    );
    assert.ok(prepared);
    assert.equal(prepared.beatManifest.transition.transitionRequired, false);
    assert.equal(prepared.fallbackDraft.slots.SCENE_TRANSITION, undefined);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

'''
replace_once(
    production_test_path,
    'test("observe-only capability turns preserve the open Kernel and freeze their next dynamic pair", async () => {',
    fallback_test + 'test("observe-only capability turns preserve the open Kernel and freeze their next dynamic pair", async () => {',
)
