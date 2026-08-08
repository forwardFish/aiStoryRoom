from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


path = Path("packages/templates/src/story-package/part-one-runtime-engine.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
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
    '''  const authoredFallback = input.playerVisibleFallback || null;
  // Settlement and BeatManifest own whether a transition is authorized. Once
  // it is authorized, prefer the package-authored player surface; the typed
  // transition move is the deterministic fallback for worlds without one.
  const sceneTransition = String(
    authoredFallback?.SCENE_TRANSITION || transitionMove?.action || "",
  ).trim();
  const playerVisibleFallback: PartOnePlayerVisibleFallback = {
    PLAYER_RESULT: String(
      authoredFallback?.PLAYER_RESULT || playerOutcome,
    ).trim(),
    ...(authoredFallback?.IMMEDIATE_REACTION
      ? { IMMEDIATE_REACTION: authoredFallback.IMMEDIATE_REACTION }
      : {}),
    ...(sceneTransition ? { SCENE_TRANSITION: sceneTransition } : {}),
    WORLD_PRESSURE: String(
      authoredFallback?.WORLD_PRESSURE || worldPressure,
    ).trim(),
    DECISION_STOP: decisionStop,
  };''',
    "authored transition surface precedence",
)
path.write_text(text, encoding="utf-8")

path = Path("packages/templates/tests/part-one-dynamic-kernel-lite.test.ts")
text = path.read_text(encoding="utf-8")
marker = '''test("dependency selection is invariant to Requirement, dependency and active Kernel ordering", () => {'''
insert = '''test("an authorized section change preserves the authored transition surface while rebinding the dynamic stop", () => {
  const pkg = packageUnderTest();
  const state = createInitialPartOneState(pkg);
  state.completedKernelIds = [
    "DK-P1-REVIEW-INITIATION",
    "DK-P1-EXECUTION-SCOPE",
  ];
  state.review.initiationStatus = "GOVERNOR_PRELIMINARY_INQUIRY";
  state.reform.executionMode = "LIMITED_TRIAL";
  state.reform.progress = "STARTED";
  state.reform.scopeStatus = "QINGLIU_ONLY";
  state.land.safeguardStatus = "WRITTEN_NO_DISTRESS_PURCHASE";
  const current = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 2, {
    pin: {
      decisionKernelId: "DK-P1-RESPONSIBILITY-RECORD",
      decisionPointId: "DK-P1-RESPONSIBILITY-RECORD",
    },
  });
  const chosen = current.decisionAffordances.find((affordance) => (
    affordance.affordanceTemplateId
      === "DK-P1-RESPONSIBILITY-RECORD-OPT-03"
  ));
  assert.ok(chosen);
  assert.ok(chosen.playerVisibleFallback?.SCENE_TRANSITION);

  const settlement = settleDynamicPartOneAction(
    pkg,
    state,
    {
      source: "RECOMMENDED",
      decisionId: chosen.affordanceTemplateId,
      decisionKernelId: chosen.decisionKernelId,
      affordanceTemplateId: chosen.affordanceTemplateId,
      label: chosen.title,
      actionText: chosen.actionText,
      targetRef: chosen.target.id,
    },
    3,
    { currentWorkingSetOverride: current },
  );
  assert.equal(settlement.event.sectionTransitioned, true);
  assert.equal(
    settlement.event.narrativePlan.nextStoryBeat
      .playerVisibleFallback.SCENE_TRANSITION,
    chosen.playerVisibleFallback.SCENE_TRANSITION,
  );
  assert.equal(
    settlement.event.narrativePlan.nextStoryBeat
      .playerVisibleFallback.DECISION_STOP,
    settlement.event.nextDecisionPoint.prompt,
  );
});

'''
if marker not in text:
    raise SystemExit("transition surface regression insertion point missing")
text = text.replace(marker, insert + marker, 1)
path.write_text(text.rstrip() + "\n", encoding="utf-8")
