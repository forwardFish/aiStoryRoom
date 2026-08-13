import type { PressureGameDecisionOptionV1 } from "../game-projection/contracts";

export type PressureCustomActionGuardResultV1 =
  | Readonly<{
      accepted: true;
      actionType: string;
      binding: "FORMAL_MATCH" | "DEFAULT_PASS";
      normalizedText: string;
    }>
  | Readonly<{
      accepted: false;
      code: "EMPTY" | "TOO_LONG" | "DECLARES_RESULT" | "CONTROLS_OTHERS" | "SKIPS_PRESSURE";
    }>;

const DECLARES_RESULT = /(已经|立即|直接).{0,8}(成功|解决|完成|平定|查明|获胜)|保证.{0,6}(成功|完成)|全部.{0,6}(解决|完成)/u;
const CONTROLS_OTHERS = /(所有人|他们|六席|皇帝|朝廷).{0,8}(必须|立刻|同意|服从|照办)/u;
const SKIPS_PRESSURE = /(跳过|直接到|立刻进入).{0,8}(下一章|结局|终局)|通关/u;
const COMMON_BIGRAMS = new Set([
  "行动", "提出", "当前", "进行", "本轮", "可以", "一个", "需要", "调动",
]);

/**
 * Deterministic Action Guard: free text may bind to an existing formal action,
 * otherwise it remains a real player choice with DEFAULT_PASS effects. It
 * never invents a new WorkingDelta and never calls a model.
 */
export class PressureCatalogCustomActionGuardV1 {
  bind(input: Readonly<{
    customText: string;
    visibleOptions: readonly PressureGameDecisionOptionV1[];
    allowedActionTypes: readonly string[];
  }>): PressureCustomActionGuardResultV1 {
    const normalizedText = normalize(input.customText);
    if (!normalizedText) return { accepted: false, code: "EMPTY" };
    if ([...normalizedText].length > 200) return { accepted: false, code: "TOO_LONG" };
    if (DECLARES_RESULT.test(normalizedText)) {
      return { accepted: false, code: "DECLARES_RESULT" };
    }
    if (CONTROLS_OTHERS.test(normalizedText)) {
      return { accepted: false, code: "CONTROLS_OTHERS" };
    }
    if (SKIPS_PRESSURE.test(normalizedText)) {
      return { accepted: false, code: "SKIPS_PRESSURE" };
    }

    const matches = input.visibleOptions
      .map((option) => ({ option, score: matchScore(normalizedText, option) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);
    if (matches.length > 0
      && (matches.length === 1 || matches[0]!.score > matches[1]!.score)) {
      return {
        accepted: true,
        actionType: matches[0]!.option.actionType,
        binding: "FORMAL_MATCH",
        normalizedText,
      };
    }
    if (input.allowedActionTypes.includes("DEFAULT_PASS")) {
      return {
        accepted: true,
        actionType: "DEFAULT_PASS",
        binding: "DEFAULT_PASS",
        normalizedText,
      };
    }
    return { accepted: false, code: "SKIPS_PRESSURE" };
  }
}

function matchScore(
  text: string,
  option: PressureGameDecisionOptionV1,
): number {
  const label = normalize(option.label);
  const description = normalize(option.description);
  if (text.includes(label) || label.includes(text)) return 100;
  const terms = new Set([
    ...ngrams(label, 2),
    ...ngrams(description, 2),
    ...ngrams(label, 3),
  ].filter((term) => !COMMON_BIGRAMS.has(term)));
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) score += [...term].length;
  }
  return score;
}

function ngrams(value: string, size: number): string[] {
  const chars = [...value];
  const result: string[] = [];
  for (let index = 0; index <= chars.length - size; index += 1) {
    const term = chars.slice(index, index + size).join("");
    if (/^[\p{Script=Han}]+$/u.test(term)) result.push(term);
  }
  return result;
}

function normalize(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .toLowerCase();
}
