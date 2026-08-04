export type StructuredStateSelectorOperator = "EQ" | "NEQ" | "IN" | "NOT_NULL";

export type StructuredStateSelector = {
  statePath: string;
  operator: StructuredStateSelectorOperator;
  expectedValue: unknown;
};

/** Selects authored content from structured durable state without inspecting prose. */
export function evaluateStructuredStateSelector(
  root: unknown,
  selector: StructuredStateSelector
): boolean {
  const actual = readStructuredStatePath(root, selector.statePath);
  switch (selector.operator) {
    case "EQ":
      return equalStructuredValue(actual, selector.expectedValue);
    case "NEQ":
      return !equalStructuredValue(actual, selector.expectedValue);
    case "IN":
      return Array.isArray(selector.expectedValue)
        && selector.expectedValue.some((candidate) => equalStructuredValue(actual, candidate));
    case "NOT_NULL":
      return actual !== null && actual !== undefined;
  }
}

function readStructuredStatePath(root: unknown, statePath: string): unknown {
  return statePath.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, root);
}
function equalStructuredValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => equalStructuredValue(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) =>
      key === rightKeys[index] && equalStructuredValue(leftRecord[key], rightRecord[key])
    );
}
