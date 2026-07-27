import type { OpenNovelOption, OpenNovelOptionEffect } from "./types.js";

export type ParsedOptions = {
  framing: string;
  options: OpenNovelOption[];
  tension: string;
  storyComplete: boolean;
};

export function parseOptions(
  raw: string,
  turnId: string,
  latestAction: string,
  previous: OpenNovelOption[],
): ParsedOptions {
  const parsed = parseJsonObject(raw);
  const storyComplete = parsed.storyComplete === true;
  const banned = new Set([
    normalizeLabel(latestAction),
    ...previous.map((option) => normalizeLabel(option.label)),
  ].filter(Boolean));
  const seen = new Set<string>();
  const options: OpenNovelOption[] = [];
  if (!storyComplete && Array.isArray(parsed.options)) {
    for (const item of parsed.options) {
      const option = normalizeOption(item);
      if (!option) continue;
      const key = normalizeLabel(option.label);
      if (!key || banned.has(key) || seen.has(key)) continue;
      seen.add(key);
      options.push({
        id: `opt_${turnId}_${options.length + 1}`,
        ...option,
      });
      if (options.length === 4) break;
    }
  }
  return {
    framing: options.length && typeof parsed.framing === "string" ? parsed.framing.trim() : "",
    options,
    tension: typeof parsed.tension === "string" && parsed.tension.trim()
      ? parsed.tension.trim()
      : storyComplete ? "story-complete" : "unknown",
    storyComplete,
  };
}

function normalizeOption(value: unknown): Omit<OpenNovelOption, "id"> | null {
  if (typeof value === "string") {
    const label = value.trim();
    return label ? { label } : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const label = typeof record.label === "string" ? record.label.trim() : "";
  if (!label || label.length > 120 || /(?:风险|代价|成功|失败|后果|因为这样)/.test(label)) return null;
  const option: Omit<OpenNovelOption, "id"> = { label };
  if (record.key === true) option.key = true;
  const effect = normalizeEffect(record.effect);
  if (effect) option.effect = effect;
  return option;
}

function normalizeEffect(value: unknown): OpenNovelOptionEffect | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const effect: OpenNovelOptionEffect = {};
  if (typeof record.intent === "string" && record.intent.trim()) effect.intent = record.intent.trim().slice(0, 500);
  if (typeof record.consequence === "string" && record.consequence.trim()) {
    effect.consequence = record.consequence.trim().slice(0, 800);
  }
  if (["low", "medium", "high"].includes(String(record.risk))) {
    effect.risk = String(record.risk) as OpenNovelOptionEffect["risk"];
  }
  if (typeof record.difficulty === "string" && record.difficulty.trim()) {
    effect.difficulty = record.difficulty.trim().slice(0, 300);
  }
  if (typeof record.reversible === "boolean") effect.reversible = record.reversible;
  if (Array.isArray(record.stateHints)) {
    const hints = record.stateHints
      .filter((hint): hint is Record<string, unknown> => Boolean(hint) && typeof hint === "object")
      .map((hint) => ({
        key: String(hint.key || "").slice(0, 120),
        op: String(hint.op || "flag") as "set" | "inc" | "dec" | "flag",
        value: hint.value,
        ...(typeof hint.note === "string" ? { note: hint.note.slice(0, 300) } : {}),
      }))
      .filter((hint) => hint.key && ["set", "inc", "dec", "flag"].includes(hint.op))
      .slice(0, 8);
    if (hints.length) effect.stateHints = hints;
  }
  return Object.keys(effect).length ? effect : undefined;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const text = String(raw || "").trim();
  const unwrapped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = unwrapped.indexOf("{");
  const end = unwrapped.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Options response is not a JSON object");
  return JSON.parse(unwrapped.slice(start, end + 1)) as Record<string, unknown>;
}

function normalizeLabel(value: string) {
  return String(value || "").toLocaleLowerCase().replace(/[\s，。；、！？,.!?;:'"“”‘’（）()]/g, "");
}
