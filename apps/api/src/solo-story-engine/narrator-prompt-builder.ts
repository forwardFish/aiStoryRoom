import type { CompiledStoryContext, StoryTurnPrompt } from "./types";

/**
 * Foreground prose call.
 *
 * This prompt deliberately contains no legal decision seeds, route keys,
 * decision copy, state patches, or hidden effects. The narrator may render
 * only the settled event and the public pressure that is now present.
 */
export function buildSoloNarratorPrompt(context: CompiledStoryContext): StoryTurnPrompt {
  const runtime = context.sections.partOneRuntime.items[0] || null;
  const event = context.sections.partOneSettlement.items[0] || null;
  const scene = context.sections.currentScene.items[0] || null;
  const style = runtime?.styleProfile || null;
  const recentCanon = context.sections.recentCanon.items
    .slice(-4)
    .map((entry) => entry.narrative);
  const knownFacts = context.sections.roleKnowledge.items.map((fact) => fact.content);
  const sourceCards = context.sections.relevantScriptCards.items
    .map((card) => `${card.title}：${card.summary}`);
  const pressures = context.sections.activePressures.items.map((pressure) => pressure.summary);
  const dueConsequences = context.sections.pendingConsequences.items
    .filter((consequence) => consequence.priority === "P0")
    .map((consequence) => consequence.summary);
  const eventEnvelope = event
    ? {
        playerAction: event.actionText,
        observableFacts: event.authoritativeObservableFacts,
        npcMoves: event.authoritativeNpcReactions.map((reaction) => reaction.action),
        consequencesDueNow: dueConsequences
      }
    : {
        playerAction: context.actionResolution.actionStarted,
        observableFacts: context.actionResolution.immediateObservableResult,
        npcMoves: [],
        consequencesDueNow: dueConsequences
      };

  const systemPrompt = [
    "你是互动历史政治小说的前台叙事者。你只写故事正文，不写标题、选项、解释、JSON、字段名或总结。",
    "本轮事实已经由服务器结算。把给出的玩家行动、可观察结果和人物回应写成正在发生的场景；可以改变句式、安排动作和对白，但不得增加新的命令、人物、证据、文书、数量、期限、发现或事件结果。",
    "Recent Canon 是故事已经发生的连续正文。直接从它的最后一刻往下写，不复述上一轮，不重新解释旧困境。",
    "叙事限于玩家角色此刻能看见、听见或可靠收到的事情。未知仍然未知，推测只能作为人物的推测。",
    "权力关系要通过谁进门、谁递交什么、谁拒绝回答、谁要求具名、谁承担时限来显现；不要把制度、状态、因果或利弊逐项讲给读者。",
    "正文必须像小说场景：人物先行动和说话，意义从动作与言外之意中显出。避免报告腔、方案腔、裁判腔和是非判断题。",
    "最后一段停在一个已经到场的具体压力、追问、来人、文书或行动后果上。不要写“你必须决定”“有两种选择”“接下来怎么办”，也不要暗示选项答案。",
    "输出三至七个自然段。不要为了凑段落切碎一句连续对白。最后一个自然段必须能单独成为下一刻的现场，但仍是正文的一部分。",
    style
      ? `采用以下获批语体原则：${[
          ...style.registerRules,
          ...style.sceneConstructionRules,
          ...style.dialogueAndSubtextRules
        ].join("；")}`
      : "语体克制、具体、含蓄，以历史官场中的行动、对白和程序压力推动情节。",
    style
      ? `总长度为 ${style.narrativeBudget.minCharacters} 至 ${style.narrativeBudget.maxCharacters} 个非空白字符。`
      : "总长度约四百至八百个汉字。",
    style
      ? `禁止使用：${[
          ...style.forbiddenModernPhrases,
          ...style.forbiddenSystemPhrases,
          ...style.forbiddenAiSummaryPatterns
        ].join("、")}`
      : "",
    runtime?.forbiddenEarlyReveals?.length
      ? `本节不得提前确认：${runtime.forbiddenEarlyReveals.join("；")}`
      : "",
    "不要复现任何原著原句；只迁移已经批准的冲突机制、人物立场和历史语感。",
    "只输出正文纯文本。"
  ].filter(Boolean).join("\n");

  const userPrompt = [
    proseSection("玩家角色", {
      name: context.role.roleName,
      identity: context.role.identity,
      goal: context.role.goal
    }),
    proseSection("当前现场", scene
      ? {
          time: scene.timeLabel,
          place: scene.locationLabel,
          situation: scene.situation
        }
      : null),
    proseSection("已经发生的连续正文", recentCanon),
    proseSection("本轮已结算事件", eventEnvelope),
    proseSection("角色已知事实", knownFacts),
    proseSection("本轮可用的原著机制材料", sourceCards),
    proseSection("正在施压的局势", pressures),
    runtime?.nextDecisionPressure
      ? proseSection("本轮末尾必须自然到场的公开压力", runtime.nextDecisionPressure.summary)
      : "",
    runtime?.narrativeScenePatterns?.length
      ? proseSection(
          "可迁移的场景组织方法",
          runtime.narrativeScenePatterns.map((asset) => publicScenePattern(asset.payload))
        )
      : "",
    "从 Recent Canon 的最后一个动作之后直接续写。"
  ].filter(Boolean).join("\n\n");

  return {
    systemPrompt,
    userPrompt,
    responseMode: "TEXT",
    outputSchema: {
      type: "plain_text",
      paragraphs: { minimum: 3, maximum: 8 },
      finalParagraph: "the new present situation, without a decision menu"
    }
  };
}

function proseSection(title: string, value: unknown) {
  return `【${title}】\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`;
}

function publicScenePattern(payload: Record<string, unknown>) {
  const allowedKeys = [
    "scenePurpose",
    "openingMotion",
    "exchangePattern",
    "pressureDelivery",
    "closingMotion",
    "dialogueStrategy",
    "spatialMechanism"
  ];
  return Object.fromEntries(
    allowedKeys
      .filter((key) => payload[key] !== undefined)
      .map((key) => [key, payload[key]])
  );
}
