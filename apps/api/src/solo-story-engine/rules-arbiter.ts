import type { ConfirmedResolution, PendingConsequence, PlayerIntent, StoryRole, ValidationResult } from "./types";

export function arbitratePlayerIntent(input: { role: StoryRole; intent: PlayerIntent; validation: Extract<ValidationResult, { ok: true }> }): ConfirmedResolution {
  const baseConsequence = consequenceFor(input.intent);
  const consumedLeverageKeys = input.intent.source === "USE_LEVERAGE" ? [...input.intent.leverageKeys] : [];
  const acceptedWithCost = input.validation.decision === "ACCEPT_WITH_COST";
  const resolutionId = `resolution:${input.intent.immutableIntentHash.slice(0, 24)}`;
  const actionStarted = actionStartedSummary(input.intent);
  return {
    resolutionId,
    legality: "LEGAL",
    actionType: input.intent.source,
    accepted: true,
    acceptedWithCost,
    actionStarted,
    immediateObservableResult: [actionStarted],
    summary: resolutionSummary(input.intent),
    costSummary: acceptedWithCost ? "这一步会留下明确代价：关系紧张、责任暴露或反制压力上升。" : null,
    consumedLeverageKeys,
    pendingConsequences: baseConsequence ? [baseConsequence] : [],
    factsModelMayStateAsConfirmed: [resolutionId],
    factsStillUnknown: [`outcome:${input.intent.immutableIntentHash.slice(0, 12)}`]
  };
}

function actionStartedSummary(intent: PlayerIntent) {
  switch (intent.source) {
    case "RECOMMENDED":
      return `浙江总督开始执行“${intent.method}”。`;
    case "TALK":
      return `浙江总督向${intent.targetLabel}发起交谈，并提出“${intent.method}”。`;
    case "INVESTIGATE":
      return `浙江总督已将“${intent.method}”作为调查任务发往${intent.targetLabel}；调查结果仍未知。`;
    case "USE_LEVERAGE":
      return `浙江总督已对${intent.targetLabel}亮明并投入指定筹码；对方反应仍未知。`;
    case "CUSTOM":
      return `浙江总督开始执行玩家自拟行动“${intent.method}”。`;
  }
}

function consequenceFor(intent: PlayerIntent): PendingConsequence | null {
  const short = intent.targetLabel || "当前对象";
  switch (intent.source) {
    case "TALK":
      return {
        consequenceId: `pc:${intent.immutableIntentHash.slice(0, 16)}`,
        summary: `${short} 会否回应、试探、推诿或反咬，必须在下一段剧情里出现。`,
        priority: "P0",
        dueLabel: "本轮"
      };
    case "INVESTIGATE":
      return {
        consequenceId: `pc:${intent.immutableIntentHash.slice(0, 16)}`,
        summary: `${short} 的调查结果尚未揭晓，下一段剧情必须体现查验、阻挠或发现。`,
        priority: "P0",
        dueLabel: "本轮"
      };
    case "USE_LEVERAGE":
      return {
        consequenceId: `pc:${intent.immutableIntentHash.slice(0, 16)}`,
        summary: `筹码已经投下，对方会否屈服、讨价还价或借机反制，必须进入下一段剧情。`,
        priority: "P0",
        dueLabel: "本轮"
      };
    case "CUSTOM":
    case "RECOMMENDED":
      return {
        consequenceId: `pc:${intent.immutableIntentHash.slice(0, 16)}`,
        summary: `围绕“${intent.objective}”的第一轮实际回响必须进入下一段剧情。`,
        priority: "P0",
        dueLabel: "本轮"
      };
  }
}

function resolutionSummary(intent: PlayerIntent) {
  switch (intent.source) {
    case "RECOMMENDED":
      return `你已经按“${intent.method}”着手推进，局势将立刻给出回应。`;
    case "TALK":
      return `你已经发起与${intent.targetLabel}的交谈，对方如何回应将立即影响局势。`;
    case "INVESTIGATE":
      return `调查力量已经投向${intent.targetLabel}；本地只确认行动开始，不预先宣布查验结果。`;
    case "USE_LEVERAGE":
      return `你已经对${intent.targetLabel}动用了手中的筹码，代价与回响都会很快出现。`;
    case "CUSTOM":
      return `你已经按自拟谋划落子，接下来世界会对这一步做出真实回应。`;
  }
}
