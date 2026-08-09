from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


path = Path("packages/templates/tests/requirement-dependency.test.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''  const rules = selectionRules();
  rules.requirementDependencies[0]!.bypassWhen = [
    "DIRECT_DUE_PRESSURE",
  ];''',
    '''  const rules = selectionRules();
  Object.assign(rules.requirementDependencies[0]!, {
    bypassWhen: ["DIRECT_DUE_PRESSURE"],
  });''',
    "typed valid bypass fixture",
)
text = replace_once(
    text,
    '''  const invalid = selectionRules();
  invalid.requirementDependencies[0]!.bypassWhen = ["PROSE_MATCH"];''',
    '''  const invalid = selectionRules();
  Object.assign(invalid.requirementDependencies[0]!, {
    bypassWhen: ["PROSE_MATCH"],
  });''',
    "typed invalid bypass fixture",
)
path.write_text(text.rstrip() + "\n", encoding="utf-8")
print("typed due-pressure fixture fixed")
