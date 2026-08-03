import type { CausalDelta, OpenNovelOption } from "./types.js";

export function normalizeReaderAction(value: string) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildCausalDelta(input: {
  turnId: string;
  action: string;
  selectedOption: OpenNovelOption | null;
}): CausalDelta {
  const readerAction = normalizeReaderAction(input.action);
  const effect = input.selectedOption?.effect;
  const immediateIntent = normalizeReaderAction(effect?.intent || readerAction);
  const authoredBoundary = effect?.knowledgeBoundary;
  const beat = effect?.beatContract;
  const durableHints = (effect?.stateHints || [])
    .filter((hint) => Boolean(hint?.key))
    .slice(0, 8);
  const requiredNarrativeFacts = durableHints
    .filter((hint) => hint.presentThisTurn === true)
    .map((hint) => normalizeReaderAction(hint.surfaceAnchor || hint.note || ""))
    .filter(Boolean);

  return {
    turnId: input.turnId,
    source: input.selectedOption ? "bound-option" : "free-text",
    readerAction,
    immediateIntent,
    // Natural-language intent classification is intentionally absent. P02's
    // typed PlayerActionIntent owns durable authorization; this compatibility
    // field cannot decide publication.
    protagonistScope: "bounded-action",
    stopCondition: normalizeReaderAction(
      beat?.stopCondition || "Stop before the protagonist takes another material action.",
    ),
    allowedKnowledge: normalizeList(authoredBoundary?.allowed),
    forbiddenKnowledge: normalizeList(authoredBoundary?.forbidden),
    evidenceSubjects: normalizeList(authoredBoundary?.subjects),
    ...(normalizeReaderAction(authoredBoundary?.sourceRef || "")
      ? { knowledgeBoundaryRef: normalizeReaderAction(authoredBoundary?.sourceRef || "") }
      : {}),
    beatContract: beat
      ? {
        sourceRef: normalizeReaderAction(beat.sourceRef || ""),
        objective: normalizeReaderAction(beat.objective),
        moves: normalizeList(beat.moves),
        requiredAnchorGroups: normalizeGroups(beat.requiredAnchorGroups),
        requiredDurableAnchorGroups: normalizeGroups(beat.requiredDurableAnchorGroups),
        authorizedPlayerActions: normalizeList(beat.authorizedPlayerActions),
        constraints: normalizeList(beat.constraints),
        settledNarrative: normalizeReaderAction(beat.settledNarrative || ""),
        stopCondition: normalizeReaderAction(beat.stopCondition),
      }
      : null,
    durableHints,
    requiredNarrativeFacts: [...new Set(requiredNarrativeFacts)],
  };
}

export function renderCausalDelta(delta: CausalDelta) {
  return renderNarratorCausalDelta(delta);
}

export function renderNarratorCausalDelta(delta: CausalDelta) {
  const lines = [`- 玩家行动：${delta.readerAction}`];
  if (delta.immediateIntent && delta.immediateIntent !== delta.readerAction) {
    lines.push(`- 已绑定行动意图：${delta.immediateIntent}`);
  }
  if (delta.beatContract?.settledNarrative) {
    lines.push("- 已结算玩家结果由受保护正文提供；只从其后的 NPC 回应继续。\n");
  }
  if (delta.beatContract?.objective) {
    lines.push(`- 本轮场景目标：${delta.beatContract.objective}`);
  }
  if (delta.beatContract?.moves.length) {
    lines.push(`- 已授权 NPC／世界节拍：${delta.beatContract.moves.join("；")}`);
  }
  if (delta.allowedKnowledge.length) {
    lines.push(`- 当前可确认事实：${delta.allowedKnowledge.join("；")}`);
  }
  if (delta.requiredNarrativeFacts.length) {
    lines.push(`- 本轮必须让玩家感知：${delta.requiredNarrativeFacts.join("；")}`);
  }
  lines.push(`- 停止点：${delta.beatContract?.stopCondition || delta.stopCondition}`);
  return lines.join("\n");
}

function normalizeList(values: readonly string[] | undefined) {
  return [...new Set((values || []).map(normalizeReaderAction).filter(Boolean))];
}

function normalizeGroups(values: readonly string[][] | undefined) {
  return (values || [])
    .map((group) => normalizeList(group))
    .filter((group) => group.length > 0);
}
