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
        fallbackContinuation: normalizeReaderAction(beat.fallbackContinuation || ""),
        narrativeSeed: beat.narrativeSeed
          ? {
              playerOutcome: normalizeReaderAction(beat.narrativeSeed.playerOutcome),
              npcOrWorldPressure: normalizeReaderAction(beat.narrativeSeed.npcOrWorldPressure),
              stopCondition: normalizeReaderAction(beat.narrativeSeed.stopCondition),
            }
          : undefined,
        sceneEvidence: beat.sceneEvidence
          ? {
              packetId: normalizeReaderAction(beat.sceneEvidence.packetId),
              evidenceItems: beat.sceneEvidence.evidenceItems.map((item) => ({
                evidenceId: normalizeReaderAction(item.evidenceId),
                evidenceClass: normalizeReaderAction(item.evidenceClass),
                statement: normalizeReaderAction(item.statement),
                sourceClaimIds: normalizeList(item.sourceClaimIds),
                adaptationDecisionIds: normalizeList(item.adaptationDecisionIds),
                useAs: normalizeReaderAction(item.useAs),
              })),
              unresolvedFacts: normalizeList(beat.sceneEvidence.unresolvedFacts),
              specificityBoundary: normalizeReaderAction(beat.sceneEvidence.specificityBoundary),
            }
          : undefined,
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
  const seed = delta.beatContract?.narrativeSeed;
  if (delta.beatContract?.sceneEvidence && !seed) {
    throw new Error("NEXT_STORY_BEAT_MISSING_BEFORE_NARRATOR");
  }
  if (seed) {
    const evidence = delta.beatContract?.sceneEvidence;
    const mechanisms = (evidence?.evidenceItems || [])
      .filter((item) => item.evidenceClass === "ORIGINAL_MECHANISM")
      .map((item) => `  - ${item.statement}`);
    const adaptations = (evidence?.evidenceItems || [])
      .filter((item) => item.evidenceClass === "APPROVED_ADAPTATION")
      .map((item) => `  - ${item.statement}`);
    return [
      "- 已发生的玩家结果（已经在 Recent Player Canon 中，不得重写或补充）：",
      "  - 以 Recent Player Canon 末尾的已结算正文为准；本节不重复展示。",
      "- 服务端已经确定的下一剧情拍（必须写成现场，不得改选其他事件）：",
      `  - ${seed.npcOrWorldPressure}`,
      "- 本拍停止点（到此立即停下，不得替玩家回答）：",
      `  - ${seed.stopCondition}`,
      ...(mechanisms.length ? ["- 可借鉴的原著冲突机制（只提供戏剧机制，不自动成为当前事实）：", ...mechanisms] : []),
      ...(adaptations.length ? ["- 已批准的改编映射：", ...adaptations] : []),
      ...(evidence?.unresolvedFacts?.length
        ? ["- 仍然未知、不得写死：", ...evidence.unresolvedFacts.map((item) => `  - ${item}`)]
        : []),
      ...(evidence?.specificityBoundary
        ? ["- 事实精度边界：", `  - ${evidence.specificityBoundary}`]
        : []),
    ].join("\n");
  }
  const stopPoint = delta.beatContract?.stopCondition || delta.stopCondition;
  return [
    delta.beatContract?.settledNarrative
      ? "- 起点：玩家已结算行动已在 Recent Player Canon 末尾写成；从其后继续。"
      : "- 起点：从 Recent Player Canon 的最后一刻承接 Reader Action。",
    `- 当前压力：${stopPoint}`,
    "- 停止点：现场人物把当前压力推到必须由玩家再次回应的位置，主角尚未作出下一项行动。",
  ].join("\n");
}

function normalizeList(values: readonly string[] | undefined) {
  return [...new Set((values || []).map(normalizeReaderAction).filter(Boolean))];
}

function normalizeGroups(values: readonly string[][] | undefined) {
  return (values || [])
    .map((group) => normalizeList(group))
    .filter((group) => group.length > 0);
}
