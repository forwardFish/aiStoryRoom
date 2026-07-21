import type { CompiledStoryContext, StoryTurnPrompt } from "./types";

export function buildSoloStoryTurnPrompt(context: CompiledStoryContext): StoryTurnPrompt {
  const publishedSchema = {
    schemaVersion: "solo-story-turn-v1",
    resultType: "PUBLISHED_TURN",
    story: {
      title: "普通玩家能理解的标题",
      resultNarrative: "玩家行动或开场压力实际发生的故事",
      nextSituationNarrative: "从结果末态继续并停在新压力上的故事"
    },
    resolution: {
      confirmedResolutionId: context.actionResolution.resolutionId,
      outcome: "APPLIED | BLOCKED",
      observableOutcome: "浙江总督此刻能够观察到的行动结果"
    },
    endingState: {
      timeLabel: "当前时间",
      locationLabel: "当前地点",
      tension: "浙江总督眼前必须回应的问题",
      presentEntityRefs: ["ALLOWED_REFERENCES_JSON.entityRefs 中的 ID"],
      visibleChanges: ["本轮故事中已经可见发生的变化"],
      surfacedConsequenceIds: ["本轮已兑现的 pending consequence ID"]
    },
    decisions: [
      {
        decisionId: "d1",
        label: "一眼能看懂的单一行动",
        description: "如何做以及要承担什么真实代价",
        intent: "这项行动想改变什么",
        targetRef: { type: "ROLE | PERSON | LOCATION | INSTITUTION | EVIDENCE | RESOURCE | PUBLIC_FRAME", id: "允许目标 ID", label: "允许目标名称" },
        method: "实际执行方式",
        leverageKeys: ["当前持有并决定使用的筹码 key；不用则为空"],
        visibility: "PRIVATE | LIMITED | OBSERVABLE | PUBLIC",
        riskTolerance: "LOW | MEDIUM | HIGH",
        distinctAxis: "这项行动与其他选项的主要差异",
        concreteCost: "可能承担的真实代价",
        expectedCountermove: "对方可能怎样回应",
        groundingIds: ["ALLOWED_REFERENCES_JSON.groundingIds 中的 ID"]
      }
    ],
    grounding: {
      usedScriptSourceIds: ["允许的 source ID"],
      usedStoryCardIds: ["允许的 story card ID"],
      usedCanonFactIds: ["允许的 canon fact ID"],
      advancedMainlineQuestionIds: ["允许的 mainline question ID"],
      paidPendingConsequenceIds: ["本轮已兑现的 pending consequence ID"],
      stagedDirectedBeatId: "允许的 directed beat ID 或 null",
      deferredConsequences: [{ consequenceId: "尚未兑现的 P0 consequence ID", reason: "本轮仍不能兑现的确定原因", nextDueLabel: "下次最迟期限" }]
    }
  };

  const clarificationSchema = {
    schemaVersion: "solo-story-turn-v1",
    resultType: "ACTION_NEEDS_CLARIFICATION",
    clarification: {
      reason: "说明玩家行动的哪一部分无法唯一理解",
      ambiguousFields: ["TARGET | METHOD | OBJECTIVE | LEVERAGE"],
      question: "只问一个能让玩家明确目标或方式的具体问题"
    }
  };
  const outputSchema = context.triggerType === "OPENING"
    ? publishedSchema
    : {
        oneOf: [publishedSchema, clarificationSchema],
        rule: "行动足够明确时必须返回 PUBLISHED_TURN；只有目标、方式、目的或筹码确实无法唯一理解时才能返回 ACTION_NEEDS_CLARIFICATION。"
      };
  const systemPrompt = [
    "你是 Many Worlds 的前台历史权谋叙事者。",
    "从 Recent Canon 最后一刻继续一个故事节拍；Recent Canon 比滞后的摘要更能代表现在。",
    "玩家行动决定本轮要做什么，Confirmed Resolution 决定哪些事实已经发生；不得替浙江总督追加第二项行动。",
    "只使用本轮提供的剧本卡、事实和允许引用，只呈现浙江总督此刻可观察、可知道的内容。",
    "正文必须是具体的场景、动作、对话和人物反应，不是规则摘要；不得发明未授权的关键人物、证据、资源、期限或秘密。",
    "Pending Consequence 必须在故事中兑现，或在 deferredConsequences 中说明仍无法兑现的确定原因和下一期限。",
    "Directed Beat 只能让外部世界行动，不能替浙江总督选择。",
    "先完成 story、resolution 和 endingState，再从刚写完的末态生成 2 到 4 个自然、具体、可执行且方向不同的决策。",
    "本次完整 JSON 必须控制在 2400 tokens 以内并正常闭合。resultNarrative 写 120 到 220 个汉字，nextSituationNarrative 写 180 到 300 个汉字；只生成 2 个决策。",
    "每个决策必须具体但简洁：label 不超过 18 个汉字，description 不超过 45 个汉字，intent 不超过 30 个汉字，method 不超过 55 个汉字，distinctAxis 不超过 12 个汉字，concreteCost 与 expectedCountermove 各不超过 24 个汉字。",
    "如果输出可能接近长度上限，必须缩短自然语言，绝不能省略必填字段、截断 JSON、重复剧情或在 JSON 外追加解释。",
    "grounding 只列出实际使用的允许 ID，不要解释或复述上下文。",
    "输出中的所有 ID、目标和筹码必须逐字取自允许集合；只输出符合 OUTPUT_SCHEMA_JSON 的 JSON。",
    context.triggerType === "OPENING"
      ? "本轮是开场：浙江总督尚未下令、答复、承诺、拒绝或派遣任何人；只能把已经在场或由外部世界带来的压力送到他眼前。"
      : "本轮是玩家行动：忠实表现这一项行动如何开始、遭遇什么真实回应，以及局势因此怎样变化。"
  ].join(" ");

  const userPrompt = [
    context.triggerType === "PLAYER_ACTION"
      ? "如果玩家行动的目标、方式、目的或所用筹码无法唯一理解，不得猜测或改写玩家意图；本次同一响应只返回 ACTION_NEEDS_CLARIFICATION，不写剧情、不写决策。"
      : "开场不得返回 ACTION_NEEDS_CLARIFICATION。",
    wrap("ACTION_RESOLUTION_JSON", context.actionResolution),
    wrap("RECENT_CANON_JSON", context.sections.recentCanon.items),
    wrap("CURRENT_SCENE_JSON", context.sections.currentScene.items[0]),
    wrap("ROLE_KNOWLEDGE_JSON", context.sections.roleKnowledge.items),
    wrap("RELEVANT_SCRIPT_CARDS_JSON", context.sections.relevantScriptCards.items),
    wrap("ACTIVE_PRESSURES_JSON", context.sections.activePressures.items),
    wrap("PENDING_CONSEQUENCE_JSON", context.sections.pendingConsequences.items),
    wrap("THIS_TURN_DIRECTED_BEAT_JSON", context.sections.directedBeat.items),
    wrap("AVAILABLE_TARGETS_JSON", context.availableTargets),
    wrap("ALLOWED_REFERENCES_JSON", context.allowedReferences),
    wrap("OUTPUT_SCHEMA_JSON", outputSchema),
    wrap(context.triggerType === "OPENING" ? "OPENING_TRIGGER_JSON" : "PLAYER_ACTION_JSON", {
      roleId: context.role.roleId,
      roleName: context.role.roleName,
      value: context.included.find((item) => item.section === "PLAYER_ACTION")?.content
    })
  ].join("\n\n");

  return { systemPrompt, userPrompt, outputSchema };
}

function wrap(tag: string, value: unknown) {
  return `<${tag}>${JSON.stringify(value, null, 2)}</${tag}>`;
}
