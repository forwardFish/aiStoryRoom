from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


compile_path = "scripts/story-decomposition/compile-sangtian-part-one-authoring.mjs"
replace_once(
    compile_path,
    '''        ...(kernelPlayerVisibleFallbacks[kernelId]?.[index]
          ? {
            playerVisibleFallback: kernelPlayerVisibleFallbacks[kernelId][index],
            settledReaction: {
              schemaVersion: "settled-reaction-template-v1",
              sourceEventKind: "AFFORDANCE_SETTLEMENT",
              sourceActionId: `${kernelId}-OPT-0${index + 1}`,
              responderActorIds: [],
              scenePolicy: "CURRENT_SCENE",
              reactionAction: {
                actionKind: "RESPOND",
                targetEntityIds: [targetRef],
                parameterBindings: {},
                visibleAction: String(
                  kernelPlayerVisibleFallbacks[kernelId][index].IMMEDIATE_REACTION
                  || kernelPlayerVisibleFallbacks[kernelId][index].WORLD_PRESSURE
                  || ""
                ).trim(),
              },
              resultCeiling: "只表达本轮已结算行动的直接回应；不得新增重大命令、证据、死亡、身份变化、未授权转场，也不得回答下一项决策。",
              requiredVisibleEffects: [
                String(
                  kernelPlayerVisibleFallbacks[kernelId][index].IMMEDIATE_REACTION
                  || kernelPlayerVisibleFallbacks[kernelId][index].WORLD_PRESSURE
                  || ""
                ).trim(),
              ].filter(Boolean),
              forbiddenEscalations: [
                "NEW_MAJOR_COMMAND",
                "NEW_EVIDENCE",
                "DEATH_OR_IDENTITY_CHANGE",
                "UNAUTHORIZED_SCENE_TRANSITION",
                "ANSWER_NEXT_DECISION",
              ],
            },
          }
          : {}),''',
    '''        ...(kernelPlayerVisibleFallbacks[kernelId]?.[index]
          ? {
            playerVisibleFallback: kernelPlayerVisibleFallbacks[kernelId][index],
            ...(String(
              kernelPlayerVisibleFallbacks[kernelId][index].IMMEDIATE_REACTION
              || ""
            ).trim()
              ? {
                settledReaction: {
                  schemaVersion: "settled-reaction-template-v1",
                  sourceEventKind: "AFFORDANCE_SETTLEMENT",
                  sourceActionId: `${kernelId}-OPT-0${index + 1}`,
                  responderActorIds: [],
                  scenePolicy: "CURRENT_SCENE",
                  reactionAction: {
                    actionKind: "RESPOND",
                    targetEntityIds: [targetRef],
                    parameterBindings: {},
                    visibleAction: String(
                      kernelPlayerVisibleFallbacks[kernelId][index].IMMEDIATE_REACTION
                    ).trim(),
                  },
                  resultCeiling: "只表达本轮已结算行动的直接回应；不得新增重大命令、证据、死亡、身份变化、未授权转场，也不得回答下一项决策。",
                  requiredVisibleEffects: [String(
                    kernelPlayerVisibleFallbacks[kernelId][index].IMMEDIATE_REACTION
                  ).trim()],
                  forbiddenEscalations: [
                    "NEW_MAJOR_COMMAND",
                    "NEW_EVIDENCE",
                    "DEATH_OR_IDENTITY_CHANGE",
                    "UNAUTHORIZED_SCENE_TRANSITION",
                    "ANSWER_NEXT_DECISION",
                  ],
                },
              }
              : {}),
          }
          : {}),''',
    "optional authored reaction mapping",
)
replace_once(
    compile_path,
    '''    if (
      !option.settledReaction
      || option.settledReaction.schemaVersion !== "settled-reaction-template-v1"
      || option.settledReaction.sourceActionId !== option.affordanceTemplateId
      || !String(option.settledReaction.reactionAction?.visibleAction || "").trim()
      || !String(option.settledReaction.resultCeiling || "").trim()
      || !Array.isArray(option.settledReaction.requiredVisibleEffects)
      || !Array.isArray(option.settledReaction.forbiddenEscalations)
    ) {
      throw new Error(`DECISION_KERNEL_SETTLED_REACTION_INVALID:${option.affordanceTemplateId}`);
    }''',
    '''    if (
      option.settledReaction
      && (
        option.settledReaction.schemaVersion !== "settled-reaction-template-v1"
        || option.settledReaction.sourceActionId !== option.affordanceTemplateId
        || !String(option.settledReaction.reactionAction?.visibleAction || "").trim()
        || !String(option.settledReaction.resultCeiling || "").trim()
        || !Array.isArray(option.settledReaction.requiredVisibleEffects)
        || !Array.isArray(option.settledReaction.forbiddenEscalations)
      )
    ) {
      throw new Error(`DECISION_KERNEL_SETTLED_REACTION_INVALID:${option.affordanceTemplateId}`);
    }''',
    "optional reaction validation",
)

replace_once(
    "packages/templates/src/story-package/part-one-runtime-engine.ts",
    '''  if (!contract) return policyResolved;''',
    '''  if (!contract) return [];''',
    "missing reaction does not borrow next decision",
)

part_test = Path("packages/templates/tests/part-one-dynamic-kernel-lite.test.ts")
text = part_test.read_text(encoding="utf-8")
old = '''test("every playable Affordance carries a full current-turn reaction template", () => {
  const pkg = packageUnderTest();
  const options = pkg.assets
    .filter((asset) => asset.assetType === "DECISION_KERNEL")
    .flatMap((asset) => asset.payload.options || []);
  assert.ok(options.length > 0);
  for (const option of options) {
    const reaction = option.settledReaction;
    assert.equal(reaction?.schemaVersion, "settled-reaction-template-v1");
    assert.equal(reaction?.sourceActionId, option.affordanceTemplateId);
    assert.ok(String(reaction?.reactionAction.visibleAction || "").trim());
    assert.ok(String(reaction?.resultCeiling || "").trim());
    assert.equal(reaction?.forbiddenEscalations.includes("ANSWER_NEXT_DECISION"), true);
  }
});'''
new = '''test("every authored current-turn reaction is complete and next-decision safe", () => {
  const pkg = packageUnderTest();
  const authored = pkg.assets
    .filter((asset) => asset.assetType === "DECISION_KERNEL")
    .flatMap((asset) => asset.payload.options || [])
    .filter((option) => option.settledReaction);
  assert.ok(authored.length > 0);
  for (const option of authored) {
    const reaction = option.settledReaction;
    assert.equal(reaction?.schemaVersion, "settled-reaction-template-v1");
    assert.equal(reaction?.sourceActionId, option.affordanceTemplateId);
    assert.ok(String(reaction?.reactionAction.visibleAction || "").trim());
    assert.ok(String(reaction?.resultCeiling || "").trim());
    assert.equal(reaction?.forbiddenEscalations.includes("ANSWER_NEXT_DECISION"), true);
  }
});'''
if old not in text:
    raise SystemExit("authored reaction test marker missing")
part_test.write_text(text.replace(old, new, 1), encoding="utf-8")

print("optional authored reaction policy staged")
