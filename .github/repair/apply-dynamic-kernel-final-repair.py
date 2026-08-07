from pathlib import Path


def replace_between(
    text: str,
    start_marker: str,
    end_marker: str,
    replacement: str,
) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"start marker missing: {start_marker}")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"end marker missing: {end_marker}")
    return text[:start] + replacement.rstrip() + "\n\n" + text[end:]


core = Path("packages/templates/src/runtime-contract/kernel-selector-lite.ts")
text = core.read_text(encoding="utf-8")
weight_needle = '  PRESENT_PRESSURE_ACTOR: 4,\n'
if 'EXCLUSIVE_OBLIGATION' not in text:
    if weight_needle not in text:
        raise SystemExit("selector weight insertion point missing")
    text = text.replace(
        weight_needle,
        weight_needle + '  EXCLUSIVE_OBLIGATION: 15,\n',
        1,
    )
field_needle = '  availablePressureActorCount: number;\n'
if 'exclusiveObligationCount?: number;' not in text:
    if field_needle not in text:
        raise SystemExit("candidate field insertion point missing")
    text = text.replace(
        field_needle,
        field_needle + '  exclusiveObligationCount?: number;\n',
        1,
    )
score = '''export function scoreKernelCandidate(
  candidate: KernelSelectorLiteCandidate,
): number {
  return candidate.duePressureCount * KERNEL_SELECTOR_LITE_WEIGHTS.DUE_PRESSURE
    + candidate.unmetExitGateCount * KERNEL_SELECTOR_LITE_WEIGHTS.UNMET_EXIT_GATE
    + candidate.unmetMustEstablishCount * KERNEL_SELECTOR_LITE_WEIGHTS.UNMET_MUST_ESTABLISH
    + candidate.pendingPressureCount * KERNEL_SELECTOR_LITE_WEIGHTS.PENDING_PRESSURE
    + candidate.activeArcCount * KERNEL_SELECTOR_LITE_WEIGHTS.ACTIVE_ARC
    + Math.min(candidate.availablePressureActorCount, 3)
      * KERNEL_SELECTOR_LITE_WEIGHTS.PRESENT_PRESSURE_ACTOR
    + (candidate.exclusiveObligationCount || 0)
      * KERNEL_SELECTOR_LITE_WEIGHTS.EXCLUSIVE_OBLIGATION;
}'''
text = replace_between(
    text,
    'export function scoreKernelCandidate(',
    'export function selectKernelLite<',
    score,
)
core.write_text(text, encoding="utf-8")

runtime = Path(
    "packages/templates/src/story-package/dynamic-kernel-lite-runtime.ts",
)
text = runtime.read_text(encoding="utf-8")
old_call = '''  const coveredPaths = obligationOwnershipPaths(
    pkg,
    section,
    kernel,
  );
  const mustRules = uniqueRules(section.mustEstablish).filter(
    (rule) => coveredPaths.has(rule.statePath),
  );
  const exitRules = uniqueRules(section.exitGates).filter(
    (rule) => coveredPaths.has(rule.statePath),
  );'''
new_call = '''  const obligationOwnership = resolveObligationOwnership(
    pkg,
    section,
    kernel,
    options,
    previews,
  );
  const mustRules = uniqueRules(section.mustEstablish).filter(
    (rule) => obligationOwnership.paths.has(rule.statePath),
  );
  const exitRules = uniqueRules(section.exitGates).filter(
    (rule) => obligationOwnership.paths.has(rule.statePath),
  );'''
if old_call not in text:
    raise SystemExit("obligation ownership call site missing")
text = text.replace(old_call, new_call, 1)
actor_field = '''      availablePressureActorCount: candidateWorkingSet.decisionPoint.actorRefs
        .filter((actorId) => present.has(actorId)).length,
      validAffordances: previews.map((preview) => ({'''
actor_replacement = '''      availablePressureActorCount: candidateWorkingSet.decisionPoint.actorRefs
        .filter((actorId) => present.has(actorId)).length,
      exclusiveObligationCount: [...unmetMust, ...unmetExit]
        .filter((rule) => (
          obligationOwnership.exclusivePaths.has(rule.statePath)
        )).length,
      validAffordances: previews.map((preview) => ({'''
if actor_field not in text:
    raise SystemExit("exclusive obligation candidate insertion point missing")
text = text.replace(actor_field, actor_replacement, 1)
ownership = '''/**
 * Direct Settlement evidence proves that a Kernel can affect a rule.
 * Requirement metadata contributes mainline ownership only when one active
 * Kernel owns that Requirement in the current Section. Shared Requirements
 * therefore cannot copy every obligation onto every candidate, while unique
 * authored responsibility remains explicit and world-agnostic.
 */
function resolveObligationOwnership(
  pkg: PartOneRuntimePackage,
  section: PartOneSectionContract,
  kernel: PartOneRuntimeAsset,
  options: PartOneAffordanceTemplate[],
  previews: Preview[],
) {
  const directPaths = new Set([
    ...kernel.stateDependencies,
    ...options.flatMap((option) => option.stateEffects || []),
    ...options.flatMap((option) => Object.keys(option.statePatch || {})),
    ...previews.flatMap((preview) => preview.changedStatePaths),
  ]);
  const exclusivePaths = new Set<string>();
  for (const requirement of pkg.requirements) {
    if (!requirement.sectionIds.includes(section.sectionId)) continue;
    const owners = new Set([
      ...requirement.decisionKernelIds.filter((kernelId) => (
        section.activeDecisionKernelIds.includes(kernelId)
      )),
      ...section.activeDecisionKernelIds.filter((kernelId) => {
        const candidate = pkg.assets.find((asset) => (
          asset.assetId === kernelId
          && asset.assetType === "DECISION_KERNEL"
        ));
        return Boolean(
          candidate?.requirementIds.includes(requirement.requirementId),
        );
      }),
    ]);
    if (owners.size !== 1 || !owners.has(kernel.assetId)) continue;
    for (const path of asStringArray(requirement.stateEffects)) {
      exclusivePaths.add(path);
    }
  }
  return {
    paths: new Set([...directPaths, ...exclusivePaths]),
    exclusivePaths,
  };
}'''
text = replace_between(
    text,
    'function obligationOwnershipPaths(',
    'function materializeAffordance(',
    ownership,
)
runtime.write_text(text, encoding="utf-8")

compiler = Path("apps/api/src/solo-story-engine/context-compiler.ts")
text = compiler.read_text(encoding="utf-8")
projection = '''function partOneSettlementPromptProjection(
  item: import("@ai-story/templates").PartOneCommittedEvent,
) {
  const plan = item.narrativePlan;
  const nextBeat = plan.nextStoryBeat;
  const scene = (value: typeof item.sceneBefore) => ({
    sceneId: value.sceneId,
    timeLabel: value.timeLabel,
    locationLabel: value.locationLabel,
    presentActorRefs: value.presentActorRefs,
    documentStates: value.documentStates,
    objectStates: value.objectStates,
  });
  return {
    eventId: item.eventId,
    turnNumber: item.turnNumber,
    sectionIdBefore: item.sectionIdBefore,
    sectionIdAfter: item.sectionIdAfter,
    actionSource: item.actionSource,
    actionText: item.actionText,
    authoritativeObservableFacts: item.authoritativeObservableFacts,
    authoritativeNpcReactions: item.authoritativeNpcReactions.map(
      (reaction) => ({
        actorRefs: reaction.actorRefs,
        action: reaction.action,
      }),
    ),
    sceneBefore: scene(item.sceneBefore),
    sceneAfter: scene(item.sceneAfter),
    authoritativeWorldMoves: item.authoritativeWorldMoves.map(
      (move) => ({
        sourceType: move.sourceType,
        actorRefs: move.actorRefs,
        action: move.action,
        resultCeiling: move.resultCeiling,
      }),
    ),
    sectionTransitioned: item.sectionTransitioned,
    narrativePlan: {
      sceneStart: scene(plan.sceneStart),
      sceneEnd: scene(plan.sceneEnd),
      sceneStartActorLabels: plan.sceneStartActorLabels,
      sceneEndActorLabels: plan.sceneEndActorLabels,
      transitionAllowed: plan.transitionAllowed,
      authorizedActorArrivals: plan.authorizedActorArrivals,
      authorizedActorDepartures: plan.authorizedActorDepartures,
      dramaticTask: plan.dramaticTask,
      actionAlreadyOccurred: plan.actionAlreadyOccurred,
      playerSpeechMode: plan.playerSpeechMode,
      authorizedPlayerSpeech: plan.authorizedPlayerSpeech,
      settledActionNarrative: plan.settledActionNarrative,
      confirmedEffects: plan.confirmedEffects,
      unresolvedFacts: plan.unresolvedFacts,
      sceneBlocking: plan.sceneBlocking,
      incidentalTextureAllowances: plan.incidentalTextureAllowances,
      sceneBeats: plan.sceneBeats,
      requiredEndChange: plan.requiredEndChange,
      narrativeCeiling: plan.narrativeCeiling,
      nextStoryBeat: {
        presentMoves: nextBeat.presentMoves,
        playerOutcome: nextBeat.playerOutcome,
        npcOrWorldPressure: nextBeat.npcOrWorldPressure,
        visibleConsequence: nextBeat.visibleConsequence,
        stopCondition: nextBeat.stopCondition,
        playerVisibleFallback: nextBeat.playerVisibleFallback,
      },
    },
  };
}'''
text = replace_between(
    text,
    'function partOneSettlementPromptProjection(',
    'function partOnePromptProjection(',
    projection,
)
compiler.write_text(text, encoding="utf-8")

tests = Path("packages/templates/tests/kernel-selector-lite.test.ts")
text = tests.read_text(encoding="utf-8")
if (
    "exclusive obligation ownership outranks otherwise equal shared capability"
    not in text
):
    marker = (
        'test("duplicate outcomes are traced and cannot form a valid option pair", '
        '() => {'
    )
    index = text.find(marker)
    if index < 0:
        raise SystemExit("selector test insertion point missing")
    test_case = '''test("exclusive obligation ownership outranks otherwise equal shared capability", () => {
  const [base] = neutralCandidates();
  assert.ok(base);
  const shared = structuredClone(base);
  shared.kernelId = "kernel.shared-capability";
  const exclusive = structuredClone(base);
  exclusive.kernelId = "kernel.exclusive-obligation";
  exclusive.exclusiveObligationCount = 1;
  const normal = selectKernelLite([shared, exclusive], "STATE-OWNERSHIP");
  const reversed = selectKernelLite([exclusive, shared], "STATE-OWNERSHIP");
  assert.equal(normal.selected?.kernelId, exclusive.kernelId);
  assert.equal(reversed.selected?.kernelId, exclusive.kernelId);
});

'''
    text = text[:index] + test_case + text[index:]
tests.write_text(text, encoding="utf-8")
