import { jsonrepair } from "jsonrepair";
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
  knownContext = "",
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
      const option = normalizeOption(item, knownContext);
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

function normalizeOption(
  value: unknown,
  knownContext: string,
): Omit<OpenNovelOption, "id"> | null {
  if (typeof value !== "string" && (!value || typeof value !== "object")) return null;
  const record = typeof value === "string" ? {} : value as Record<string, unknown>;
  const label = typeof value === "string"
    ? value.trim()
    : typeof record.label === "string" ? record.label.trim() : "";
  if (!label || label.length > 120 || /(?:风险|代价|成功|失败|后果|因为这样)/.test(label)) return null;
  if (!isExploratoryOption(label) && isVagueCommunicativeOption(label)) return null;
  if (hasContradictoryCommunicationMode(label)) return null;
  if (referencesUnavailableMaterial(label, knownContext)) return null;
  // Every visible option must name one player action. A label such as
  // "call adviser A or officer B" delegates the choice back to the model and
  // can also smuggle an ungrounded actor into the next turn.
  if (/(?:叫|命|让|派|召).{0,24}或.{0,24}(?:来|去|查|办|送|取)/u.test(label)) return null;
  const option: Omit<OpenNovelOption, "id"> = { label };
  // Questions and inspection are reversible discovery moves. Their answers
  // do not exist yet, so a model may not pre-write a durable result for them.
  if (!isExploratoryOption(label)) {
    const effect = normalizeEffect(record.effect);
    if (effect) option.effect = effect;
    // Runtime-generated options are suggestions. Only an explicitly
    // irreversible effect may be elevated to a key decision. Authored opening
    // decisions bypass this parser and keep their reviewed key metadata.
    if (record.key === true && effect?.reversible === false) option.key = true;
  }
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
        // Model option effects are Storykeeper candidates, not authoritative
        // results. The selected label itself authorizes the action; only
        // reviewed, server-authored effects may require a durable result in
        // the same turn.
        ...(typeof hint.surfaceAnchor === "string" && hint.surfaceAnchor.trim()
          ? { surfaceAnchor: hint.surfaceAnchor.trim().slice(0, 120) }
          : {}),
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
  const candidate = unwrapped.slice(start, end + 1);
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    // Repair serialization only. Option meaning is still normalized and
    // validated above, so this cannot authorize a new action or fact.
    return JSON.parse(jsonrepair(candidate)) as Record<string, unknown>;
  }
}

function normalizeLabel(value: string) {
  return String(value || "").toLocaleLowerCase().replace(/[\s，。；、！？,.!?;:'"“”‘’（）()]/g, "");
}

function isExploratoryOption(label: string) {
  return /^(?:先)?(?:问|询问|追问|查问|核对|查看|察看|翻看|听|去看|去听|打听)/u.test(label.trim());
}

function isVagueCommunicativeOption(label: string) {
  if (!/(?:口信|答复|回话|回文)/u.test(label)) return false;
  if (/[：:“”"'「」]/u.test(label)) return false;
  return !/(?:不签|暂缓|缓签|落印|签发|同意|准许|拒绝|驳回|先查|核查|报疑|限期|今日|明日|三日)/u.test(label);
}

function hasContradictoryCommunicationMode(label: string) {
  if (/(?:写下|记下|记录|誊录|转为书面|写成书面)/u.test(label)) return false;
  return /(?:写|拟|起草|具文|落笔).{0,16}(?:口头回话|口头答复|口信)|(?:口头回话|口头答复|口信).{0,16}(?:写|拟|起草|具文|落笔)/u.test(label);
}

function referencesUnavailableMaterial(label: string, knownContext: string) {
  const lookup = label.match(
    /(?:调取?|取来|取阅|查阅|翻看|核对|比对|查看).{0,24}(汇总册|名册|账册|册簿|副本|原件|仓单|田契|口供|卷宗|暗账)/u,
  );
  if (!lookup) return false;
  const materialType = String(lookup[1] || "");
  return materialType !== "原件" && !knownContext.includes(materialType);
}
