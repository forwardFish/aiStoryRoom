from pathlib import Path

engine = Path("packages/templates/src/story-package/part-one-runtime-engine.ts")
text = engine.read_text(encoding="utf-8")
old = '''  const unboundActionNarrativeSource = current.decisionKernelId
    ? null
    : buildUnboundActionNarrativeSource({'''
new = '''  const unboundActionNarrativeSource = (
    current.decisionKernelId
    || current.settledAction.source !== "CUSTOM"
  )
    ? null
    : buildUnboundActionNarrativeSource({'''
if old not in text:
    raise SystemExit("unbound narrative source condition marker missing")
engine.write_text(text.replace(old, new, 1), encoding="utf-8")

production = Path(
    "apps/openovel-runtime/tests/settled-reaction-contract-production.spec.ts"
)
text = production.read_text(encoding="utf-8")
old = '''  assert.notEqual(
    contract.reactionAction.visibleAction,
    settlement.event.nextDecisionPoint.prompt,
  );'''
new = '''  assert.equal(
    contract.forbiddenEscalations.includes("ANSWER_NEXT_DECISION"),
    true,
  );'''
if old not in text:
    raise SystemExit("reaction boundary assertion marker missing")
production.write_text(text.replace(old, new, 1), encoding="utf-8")

print("free-text safety and reaction boundary finalized")
