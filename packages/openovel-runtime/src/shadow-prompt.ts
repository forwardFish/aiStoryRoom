import type { CompiledShadowContext, ShadowRuntimeFixture } from "./types";

export interface ShadowTurnPrompt {
  systemPrompt: string;
  userPrompt: string;
  outputSchema: Record<string, unknown>;
}

export function buildShadowTurnPrompt(context: CompiledShadowContext, fixture: ShadowRuntimeFixture): ShadowTurnPrompt {
  const eventTypes = context.causalTurn.allowedEventEnvelope.allowedEventTypes;
  const requiredEventCount = context.causalTurn.allowedEventEnvelope.requiredEventTypes.length;
  const decisionProperties = Object.fromEntries(context.causalTurn.decisionAffordances.map((affordance, index) => {
    const writerEntrance = fixture.writerPlan?.decisionEntrances?.[index];
    const targetRefs = writerEntrance?.targetRefs?.length ? writerEntrance.targetRefs : [affordance.targetRef];
    const targets = targetRefs.map((ref) => fixture.availableTargets.find((target) => target.id === ref)?.label || ref).join("、");
    const situation = writerEntrance?.situation || affordance.immediateGoal;
    const wordingFrame = writerEntrance?.wordingFrame
      ? `；措辞严格采用：${writerEntrance.wordingFrame}`
      : "";
    return [`decision${index + 1}`, {
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: {
        text: {
          type: "string",
          minLength: 6,
          maxLength: 24,
          description: `用 8—22 个中文字符写一个${decisionClassLabel(affordance.actionClass)}动作；对象是${targets}；动作范围是${situation}${wordingFrame}`
        }
      }
    }];
  }));
  const decisionKeys = Object.keys(decisionProperties);
  const outputSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "resultType", "narration", "eventDrafts", "decisions"],
    properties: {
      schemaVersion: { const: "openovel-shadow-writer-v6" },
      resultType: { const: "PUBLISHED_SHADOW_TURN" },
      narration: {
        type: "object",
        additionalProperties: false,
        required: ["title", "body", "endingState"],
        properties: {
          title: { type: "string", minLength: 4, maxLength: 10 },
          body: {
            type: "string",
            minLength: context.narrativeBudget.minChars,
            maxLength: context.narrativeBudget.maxChars,
            description: `第一句直接呈现巡抚开口提出责任条件；正文建议写 420—500 个中文字符，硬范围为 ${context.narrativeBudget.minChars}—${context.narrativeBudget.maxChars} 个中文字符；使用 ${context.narrativeBudget.minParagraphs}—${context.narrativeBudget.maxParagraphs} 个自然段，段落之间留一个空行`
          },
          endingState: {
            type: "object",
            additionalProperties: false,
            required: ["visibleFacts", "unresolvedFacts", "relationshipDelta"],
            properties: {
              visibleFacts: { type: "array", items: { type: "string" }, minItems: 2 },
              unresolvedFacts: { type: "array", items: { type: "string" }, minItems: 1 },
              relationshipDelta: {
                type: "string",
                minLength: 8,
                description: "只写已经发生的关系变化：巡抚的分责主张已经公开入册，督抚责任分歧变得明确，但总督尚未接受，责任条件仍未生效。不得写成总督已经承担暂缓落印责任"
              }
            }
          }
        }
      },
      eventDrafts: {
        type: "array",
        minItems: requiredEventCount,
        maxItems: context.causalTurn.allowedEventEnvelope.maxEventDrafts,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["eventType"],
          properties: {
            eventType: eventTypes.length ? { type: "string", enum: eventTypes } : { type: "string" }
          }
        }
      },
      decisions: {
        type: "object",
        additionalProperties: false,
        required: decisionKeys,
        properties: decisionProperties
      }
    }
  };

  const systemPrompt = [
    "你是 Our Many Worlds 的历史权谋 Writer。根据本轮 Writer Context，一次返回连续剧情正文、正文结束时的可见局面、事件草案和三个下一步决策。",
    "Recent Canon 是已经发生内容的最高权威。正文从它的最后一刻继续，首段直接写主要 NPC 的新反应，不复述玩家刚完成的行动。",
    "只把已确认内容写成客观事实；尚未确认事项保持未知。人物可以表达立场、条件、怀疑或追问；具体日期、数字、文书状态和册据执行进度只来自 CONFIRMED_EFFECTS。",
    "当 NPC 提出条件、请求、主张、建议或责任分配，而玩家角色尚未回应时，正文、文书记录、endingState 和 eventDrafts 必须保留其提议尚未生效的身份。记录 NPC 的主张不等于玩家接受；不得把请总督承担或巡抚主张由总督承担改写成总督承担，也不得写成已经成立的责任、承诺或双方共识。",
    "NPC 根据公开身份、当前目标和可用筹码主动回应。让冲突通过对白、停顿、记录、文书和动作自然显现，不解释工作集，不讨论规则，也不评价自己是否符合要求。",
    "使用第三人称叙事，始终称玩家角色为总督。不得替总督新增对白、承诺、命令或动作。SCENE_BLOCKING 规定人物与物件的硬边界；SCENE_BEATS 只规定必须兑现的语义节拍，不必逐句照抄。",
    "正文形成 REQUIRED_END_CHANGE 指定的新局面，并停在 NARRATIVE_CEILING。长度和段落数量服从 NARRATIVE_BUDGET，只写有剧情作用的内容。",
    "先完整写完正文，再填写 endingState。endingState 只概括正文最后一刻已经出现的可见事实，不得把尚未接受的条件写成已成立状态。",
    "eventDrafts 只列正文中确实发生的事件。提议、记录、接受和履行是不同状态，不能互相替代。",
    "decisions 中的 decision1、decision2、decision3 按 DECISION_AFFORDANCES 的编号一一对应，每个入口只使用一次。严格使用各入口的措辞骨架写成一个无逗号的动宾短语；不添加第二动作、风险、收益、理由或结果。",
    "人物、物件、事件引用、决策类型、目标引用和证据 Grounding 均由服务器绑定。只输出符合 OUTPUT_SCHEMA 的 JSON 对象。"
  ].join("\n");

  const userPrompt = [
    `【OUTPUT_SCHEMA】\n${JSON.stringify(outputSchema, null, 2)}`,
    context.renderedWriterWorkingSet
  ].join("\n\n");
  return { systemPrompt, userPrompt, outputSchema };
}

function decisionClassLabel(value: string): string {
  switch (value) {
    case "authority": return "行政处置";
    case "responsibility": return "责任承担";
    case "evidence_control": return "记录与证据处理";
    case "scope_change": return "范围调整";
    case "secrecy": return "保密处置";
    case "negotiation": return "条件协商";
    default: return "行动";
  }
}
