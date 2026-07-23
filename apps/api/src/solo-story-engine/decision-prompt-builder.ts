import type {
  CompiledStoryContext,
  StoryNarratorDraft,
  StoryTurnPrompt
} from "./types";

/**
 * Post-narration decision call.
 *
 * It sees the exact accepted prose endpoint and only public legal affordance
 * summaries. Hidden state patches and causal effects remain server-side.
 */
export function buildSoloDecisionPrompt(
  context: CompiledStoryContext,
  narration: StoryNarratorDraft
): StoryTurnPrompt {
  const runtime = context.sections.partOneRuntime.items[0] || null;
  const legalRoutes = runtime?.decisionAffordances.map((route) => ({
    routeKey: route.affordanceTemplateId,
    actionBoundary: route.actionText,
    target: route.target.label,
    method: route.method,
    immediatePurpose: route.immediateIntent,
    visibleTradeoff: route.visibleTradeoff
  })) || genericRoutes(context);

  const systemPrompt = [
    "你是互动故事的决策文案编辑。剧情正文已经完成并通过校验；你不能续写、修改或总结正文。",
    "先读到正文最后一个字，再为玩家写两条此刻可以立刻执行的行动。",
    "只能使用给定的合法行动路线。每条路线必须原样返回 routeKey；不得创造第三条行动、合并两条路线或交换路线含义。",
    "description 是玩家在前端唯一会看见的文字。它必须是一句自然、明确、普通人能看懂的行动，直接说明现在做什么；不要写分析、代价说明、成功结果、对方反应或系统术语。",
    "两条 description 必须具体且真正不同。不得写“推进方案”“协调资源”“谨慎处理”“视情况而定”等空话。",
    "只输出 JSON，不要 Markdown 或解释。"
  ].join("\n");

  const userPrompt = [
    "【已经通过校验的完整正文】",
    narration.rawProse,
    "",
    "【正文停下的确切一刻】",
    narration.nextSituationNarrative,
    "",
    "【玩家此刻可合法执行的两条路线】",
    JSON.stringify(legalRoutes, null, 2),
    "",
    "返回：",
    JSON.stringify({
      decisions: legalRoutes.map((route) => ({
        routeKey: route.routeKey,
        description: "一句只写玩家行动的自然中文"
      }))
    }, null, 2)
  ].join("\n");

  return {
    systemPrompt,
    userPrompt,
    responseMode: "JSON",
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["decisions"],
      properties: {
        decisions: {
          type: "array",
          minItems: 2,
          maxItems: 2,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["routeKey", "description"],
            properties: {
              routeKey: { type: "string" },
              description: { type: "string" }
            }
          }
        }
      }
    }
  };
}

function genericRoutes(context: CompiledStoryContext) {
  return context.availableTargets.slice(0, 2).map((target, index) => ({
    routeKey: `target:${target.type}:${target.id}:${index + 1}`,
    actionBoundary: `直接处理${target.label}`,
    target: target.label,
    method: "使用玩家角色已有权限采取一项具体行动",
    immediatePurpose: context.sections.currentScene.items[0]?.mainlineQuestion || "推动当前局势",
    visibleTradeoff: "行动会让另一项压力继续累积"
  }));
}
