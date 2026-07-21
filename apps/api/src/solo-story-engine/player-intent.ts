import { sha256Canonical } from "../continuous-strategy/canonical";
import type { PlayerIntent, RawPlayerAction, ValidationIssue } from "./types";

export function normalizePlayerIntent(raw: RawPlayerAction): { ok: true; intent: PlayerIntent } | { ok: false; issues: ValidationIssue[] } {
  switch (raw.source) {
    case "RECOMMENDED":
      return okIntent({
        source: "RECOMMENDED",
        targetId: normalizeId(raw.targetId),
        targetLabel: compact(raw.targetLabel, 120),
        objective: compact(raw.label, 200),
        method: compact(raw.actionText, 400),
        userFacingText: compact(raw.actionText, 400),
        leverageKeys: []
      });
    case "TALK":
      return okIntent({
        source: "TALK",
        targetId: normalizeId(raw.personId),
        targetLabel: compact(raw.personName, 120),
        objective: `与${compact(raw.personName, 60)}交谈，争取回应`,
        method: compact(raw.prompt, 400),
        userFacingText: compact(raw.prompt, 400),
        leverageKeys: []
      });
    case "INVESTIGATE":
      return okIntent({
        source: "INVESTIGATE",
        targetId: normalizeId(raw.locationId),
        targetLabel: compact(raw.locationName, 120),
        objective: `调查${compact(raw.locationName, 80)}`,
        method: compact(raw.task, 400),
        userFacingText: compact(raw.task, 400),
        leverageKeys: []
      });
    case "USE_LEVERAGE":
      return okIntent({
        source: "USE_LEVERAGE",
        targetId: normalizeId(raw.targetId),
        targetLabel: compact(raw.targetLabel, 120),
        objective: `动用${compact(raw.leverageLabel, 80)}影响${compact(raw.targetLabel, 80)}`,
        method: compact(raw.task, 400),
        userFacingText: compact(raw.task, 400),
        leverageKeys: [normalizeId(raw.leverageKey)]
      });
    case "CUSTOM": {
      const text = compact(raw.text, 500);
      if (!text) return { ok: false, issues: [{ code: "EMPTY_CUSTOM_ACTION", message: "自拟谋划不能为空。" }] };
      return okIntent({
        source: "CUSTOM",
        targetId: inferTargetId(text),
        targetLabel: inferTargetLabel(text),
        objective: inferObjective(text),
        method: text,
        userFacingText: text,
        leverageKeys: []
      });
    }
  }
}

function okIntent(input: Omit<PlayerIntent, "immutableIntentHash">): { ok: true; intent: PlayerIntent } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (!input.targetId) issues.push({ code: "TARGET_REQUIRED", message: "行动必须指向一个明确对象。" });
  if (!input.targetLabel) issues.push({ code: "TARGET_LABEL_REQUIRED", message: "行动必须写清对象名称。" });
  if (!input.method) issues.push({ code: "METHOD_REQUIRED", message: "行动必须写清具体做法。" });
  if (issues.length) return { ok: false, issues };
  const intent: PlayerIntent = {
    ...input,
    immutableIntentHash: sha256Canonical({
      source: input.source,
      targetId: input.targetId,
      targetLabel: input.targetLabel,
      objective: input.objective,
      method: input.method,
      leverageKeys: [...input.leverageKeys].sort()
    })
  };
  return { ok: true, intent };
}

function compact(value: string, max: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeId(value: string) {
  return compact(value, 120).toLowerCase().replace(/[^a-z0-9:_-]+/g, "_");
}

function inferTargetId(text: string) {
  const match = text.match(/(巡抚|书吏|司礼监|商会|档房|县令|总督|粮仓|清流县)/);
  return match ? normalizeId(match[1]) : "public_frame";
}

function inferTargetLabel(text: string) {
  const match = text.match(/(巡抚|书吏|司礼监|商会|档房|县令|总督|粮仓|清流县)/);
  return match ? match[1] : "当前局势";
}

function inferObjective(text: string) {
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
}
