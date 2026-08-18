import type { PressureChapterGameProjectionV1 } from "../game-projection";

export function reportPressurePostCommitProjectionDiffV1(input: Readonly<{
  mode: "SHADOW" | "FAST";
  runId: string;
  replay: PressureChapterGameProjectionV1;
  candidate: PressureChapterGameProjectionV1;
}>): void {
  const replay = normalize(input.replay);
  const candidate = normalize(input.candidate);
  const firstDifferencePath = firstDifference(replay, candidate, "$", new Set());
  if (process.env.PRESSURE_POST_COMMIT_PROJECTION_LOG !== "1") return;
  console.error("Pressure post-commit projection", JSON.stringify({
    mode: input.mode,
    runId: input.runId,
    outcome: firstDifferencePath ? "MISMATCH" : "MATCH",
    firstDifferencePath,
  }));
}

export function reportPressurePostCommitProjectionErrorV1(
  mode: "SHADOW" | "FAST",
  runId: string,
): void {
  if (process.env.PRESSURE_POST_COMMIT_PROJECTION_LOG !== "1") return;
  console.error("Pressure post-commit projection", JSON.stringify({ mode, runId, outcome: "ERROR" }));
}

function normalize(value: PressureChapterGameProjectionV1): Record<string, unknown> {
  const clone = structuredClone(value) as unknown as Record<string, unknown>;
  delete clone.narrative;
  delete clone.feedPage;
  delete clone.projectionHash;
  return clone;
}

function firstDifference(
  left: unknown,
  right: unknown,
  path: string,
  seen: Set<unknown>,
): string | null {
  if (Object.is(left, right)) return null;
  if (typeof left !== typeof right || left === null || right === null) return path;
  if (typeof left !== "object") return path;
  if (seen.has(left) || seen.has(right)) return null;
  seen.add(left);
  seen.add(right);
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return path;
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstDifference(left[index], right[index], `${path}[${index}]`, seen);
      if (difference) return difference;
    }
    return null;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
  for (const key of keys) {
    if (!(key in leftRecord) || !(key in rightRecord)) return `${path}.${key}`;
    const difference = firstDifference(leftRecord[key], rightRecord[key], `${path}.${key}`, seen);
    if (difference) return difference;
  }
  return null;
}
