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
  const allowedKnowledge = normalizeList(authoredBoundary?.allowed);
  const forbiddenKnowledge = normalizeList(authoredBoundary?.forbidden);
  const evidenceSubjects = normalizeList(authoredBoundary?.subjects);
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
    allowedKnowledge,
    forbiddenKnowledge,
    evidenceSubjects,
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
        sceneProjection: beat.sceneProjection
          ? {
              sceneRef: normalizeReaderAction(beat.sceneProjection.sceneRef || ""),
              timeLabel: normalizeReaderAction(beat.sceneProjection.timeLabel),
              locationLabel: normalizeReaderAction(beat.sceneProjection.locationLabel),
              situation: normalizeReaderAction(beat.sceneProjection.situation || ""),
              presentActors: beat.sceneProjection.presentActors.map((actor) => ({
                actorRef: normalizeReaderAction(actor.actorRef),
                displayName: normalizeReaderAction(actor.displayName),
              })),
              observableFacts: normalizeList(beat.sceneProjection.observableFacts),
              keyEntityInventoryIsExhaustive: true,
              documents: beat.sceneProjection.documents.map((document) => ({
                label: normalizeReaderAction(document.label),
                accessState: document.accessState,
                ...(normalizeReaderAction(document.holderLabel || "")
                  ? { holderLabel: normalizeReaderAction(document.holderLabel || "") }
                  : {}),
              })),
              objects: beat.sceneProjection.objects.map((object) => ({
                label: normalizeReaderAction(object.label),
                ...(normalizeReaderAction(object.holderLabel || "")
                  ? { holderLabel: normalizeReaderAction(object.holderLabel || "") }
                  : {}),
                ...(object.contentsState ? { contentsState: object.contentsState } : {}),
                ...(object.closureState ? { closureState: object.closureState } : {}),
              })),
            }
          : undefined,
        continuationMoves: normalizeList(beat.continuationMoves),
        narrativeSeed: beat.narrativeSeed
          ? {
              playerOutcome: normalizeReaderAction(beat.narrativeSeed.playerOutcome),
              continuationMoves: normalizeList(beat.narrativeSeed.continuationMoves),
              sourceEventIds: normalizeList(beat.narrativeSeed.sourceEventIds),
              deferredEventIds: normalizeList(beat.narrativeSeed.deferredEventIds),
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
    scenePacket: buildScenePacket({
      beat,
      allowedKnowledge,
      forbiddenKnowledge,
      evidenceSubjects,
    }),
    durableHints,
    requiredNarrativeFacts: [...new Set(requiredNarrativeFacts)],
  };
}

type BeatContract = NonNullable<NonNullable<OpenNovelOption['effect']>['beatContract']>;

function buildScenePacket(input: {
  beat: BeatContract | undefined;
  allowedKnowledge: string[];
  forbiddenKnowledge: string[];
  evidenceSubjects: string[];
}): CausalDelta['scenePacket'] {
  const seed = input.beat?.narrativeSeed;
  if (!input.beat || !seed) return null;
  const evidence = input.beat.sceneEvidence;
  const presentBeatMoves = normalizeList(
    seed.continuationMoves?.length
      ? seed.continuationMoves
      : [seed.npcOrWorldPressure],
  );
  const sourceRefs = normalizeList([
    input.beat.sourceRef || '',
    ...(evidence?.evidenceItems || []).flatMap((item) => [
      item.evidenceId,
      ...item.sourceClaimIds,
      ...item.adaptationDecisionIds,
    ]),
  ]);
  const visibleFacts = normalizeList(
    (evidence?.evidenceItems || [])
      .filter((item) => (
        item.useAs === 'OBJECTIVE_FACT'
        && item.evidenceClass !== 'CURRENT_CANON'
      ))
      .map((item) => item.statement),
  );
  const dramaticMechanisms = normalizeList(
    (evidence?.evidenceItems || [])
      .filter((item) => (
        item.evidenceClass === 'ORIGINAL_MECHANISM'
        || (
          item.useAs === 'DRAMATIC_MECHANISM'
          && item.evidenceClass !== 'APPROVED_ADAPTATION'
        )
      ))
      .map((item) => item.statement),
  );
  const approvedAdaptations = normalizeList(
    (evidence?.evidenceItems || [])
      .filter((item) => item.evidenceClass === 'APPROVED_ADAPTATION')
      .map((item) => item.statement),
  );
  return {
    packetId: normalizeReaderAction(
      evidence?.packetId || ('scene-packet:' + (input.beat.sourceRef || 'unknown')),
    ),
    sourceRefs,
    sourceEventIds: normalizeList(seed.sourceEventIds),
    deferredEventIds: normalizeList(seed.deferredEventIds),
    presentBeatMoves,
    stopCondition: normalizeReaderAction(seed.stopCondition),
    visibleFacts,
    dramaticMechanisms,
    approvedAdaptations,
    allowedKnowledge: input.allowedKnowledge.filter((item) => !visibleFacts.includes(item)),
    forbiddenKnowledge: input.forbiddenKnowledge,
    unresolvedFacts: normalizeList(evidence?.unresolvedFacts),
    specificityBoundary: normalizeReaderAction(evidence?.specificityBoundary || ''),
    relevantSubjects: input.evidenceSubjects,
  };
}

export function renderCausalDelta(delta: CausalDelta) {
  return renderNarratorCausalDelta(delta);
}

export function renderNarratorCausalDelta(delta: CausalDelta) {
  if (delta.scenePacket) return renderScenePacket(delta.scenePacket);
  const seed = delta.beatContract?.narrativeSeed;
  if (delta.beatContract?.sceneEvidence && !seed) {
    throw new Error("NEXT_STORY_BEAT_MISSING_BEFORE_NARRATOR");
  }
  if (seed) {
    const evidence = delta.beatContract?.sceneEvidence;
    const continuationMoves = normalizeList(
      seed.continuationMoves?.length
        ? seed.continuationMoves
        : delta.beatContract?.continuationMoves,
    );
    const currentFacts = (evidence?.evidenceItems || [])
      .filter((item) => (
        item.useAs === "OBJECTIVE_FACT"
        // The protected player outcome is already present exactly once at the
        // end of Recent Player Canon. Repeating CURRENT_CANON here invites the
        // Narrator to rewrite the action instead of continuing from it.
        && item.evidenceClass !== "CURRENT_CANON"
      ))
      .map((item) => `  - ${item.statement}`);
    const mechanisms = (evidence?.evidenceItems || [])
      .filter((item) => item.evidenceClass === "ORIGINAL_MECHANISM")
      .map((item) => `  - ${item.statement}`);
    const adaptations = (evidence?.evidenceItems || [])
      .filter((item) => item.evidenceClass === "APPROVED_ADAPTATION")
      .map((item) => `  - ${item.statement}`);
    const stopAlreadyExpressed = continuationMoves.some((item) => (
      item === seed.stopCondition || item.includes(seed.stopCondition) || seed.stopCondition.includes(item)
    )) || seed.npcOrWorldPressure === seed.stopCondition;
    return [
      "- 已发生的玩家结果（已经在 Recent Player Canon 中，不得重写或补充）：",
      "  - 以 Recent Player Canon 末尾的已结算正文为准；本节不重复展示。",
      ...(continuationMoves.length
        ? [
            "- 服务端已经确定的下一剧情拍（按顺序逐项写成现场，不得改选其他事件）：",
            ...continuationMoves.map((item) => `  - ${item}`),
          ]
        : [
            "- 服务端已经确定的下一剧情拍（必须写成现场，不得改选其他事件）：",
            `  - ${seed.npcOrWorldPressure}`,
          ]),
      "- 本拍停止点（到此立即停下，不得替玩家回答）：",
      `  - ${stopAlreadyExpressed
        ? "最后一项获批动作把问题交到玩家面前时立即结束；不要另加局势总结，也不要换句话重复这项压力。"
        : seed.stopCondition}`,
      ...(delta.allowedKnowledge.length
        ? [
            "- 本拍允许直接写入的已知事实（每条都是事实精度上限）：",
            ...delta.allowedKnowledge.map((item) => `  - ${item}`),
          ]
        : []),
      ...(delta.forbiddenKnowledge.length
        ? [
            "- 本拍不得新增或写实的内容：",
            ...delta.forbiddenKnowledge.map((item) => `  - ${item}`),
          ]
        : []),
      ...(currentFacts.length
        ? ["- 当前可直接使用的客观事实（只限这些事实，不得扩写数字、地点或完成状态）：", ...currentFacts]
        : []),
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

function renderScenePacket(packet: NonNullable<CausalDelta['scenePacket']>) {
  if (!packet.presentBeatMoves.length) {
    throw new Error('SCENE_PACKET_PRESENT_BEAT_MISSING');
  }
  const lines = [
    '- 已结算行动已经写在最近正文末尾；从其最后一刻继续，不得重写。',
    '- 本轮只写服务器选定的这一剧情拍：',
    ...packet.presentBeatMoves.map((item) => '  - ' + item),
    '- 到下列时刻立即停笔，把决定权交还玩家：',
    '  - ' + packet.stopCondition,
  ];
  if (packet.visibleFacts.length) {
    lines.push(
      '- 当前可直接使用的客观事实：',
      ...packet.visibleFacts.map((item) => '  - ' + item),
    );
  }
  if (packet.dramaticMechanisms.length) {
    lines.push(
      '- 原著可借鉴的冲突机制（只决定人物如何施压和反制，不自动成为当前事实）：',
      ...packet.dramaticMechanisms.map((item) => '  - ' + item),
    );
  }
  if (packet.approvedAdaptations.length) {
    lines.push(
      '- 已批准的改编映射（只限所述边界，不得扩大数字、人物、地点或完成状态）：',
      ...packet.approvedAdaptations.map((item) => '  - ' + item),
    );
  }
  if (packet.allowedKnowledge.length) {
    lines.push(
      '- 当前人物允许知道的内容：',
      ...packet.allowedKnowledge.map((item) => '  - ' + item),
    );
  }
  if (packet.forbiddenKnowledge.length) {
    lines.push(
      '- 当前不得揭露或写实的内容：',
      ...packet.forbiddenKnowledge.map((item) => '  - ' + item),
    );
  }
  if (packet.unresolvedFacts.length) {
    lines.push(
      '- 仍然未知、不得写死：',
      ...packet.unresolvedFacts.map((item) => '  - ' + item),
    );
  }
  if (packet.specificityBoundary) {
    lines.push('- 事实精度边界：', '  - ' + packet.specificityBoundary);
  }
  return lines.join(String.fromCharCode(10));
}

function normalizeList(values: readonly string[] | undefined) {
  return [...new Set((values || []).map(normalizeReaderAction).filter(Boolean))];
}

function normalizeGroups(values: readonly string[][] | undefined) {
  return (values || [])
    .map((group) => normalizeList(group))
    .filter((group) => group.length > 0);
}
