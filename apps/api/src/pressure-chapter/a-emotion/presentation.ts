import type {
  AEmotionCardActionPortV1,
  AEmotionCenterCardPortV1,
  AEmotionPresentationInputPortV1,
  AEmotionPresentationPortV1,
  AEmotionVisibleImpactPortV1,
} from "./ports";

const FACT_COPY: Readonly<Record<string, string>> = Object.freeze({
  "fact.ledger.touched-by-governor-and-magistrate": "巡抚与县令都接触过账册",
  "fact.ledger.suspected-governor": "迹象指向巡抚衙门",
  "fact.ledger.source-confirmed": "调查证据已经确认账册流转经过",
  "fact.ledger.original-controlled": "原始粮册已经进入你的控制",
});

const ACTION_COPY: Readonly<Record<string, string>> = Object.freeze({
  INVESTIGATE_SOURCE: "派遣调查",
  PUBLIC_QUESTION: "公开质问",
  DEFER: "暂不回应",
  RETALIATE_NOW: "立即反击",
  HIDE_FOR_NOW: "暂时隐瞒",
  HANDLE_LATER: "稍后处理",
  RESPOND_NOW: "立刻应对",
  VIEW_DETAILS: "查看详情",
  CONTINUE_ADVANCE: "继续推进",
  VIEW_LATER: "稍后查看",
  KEEP_LOW_PROFILE: "先保持低调",
});

const IMPACT_COPY: Readonly<Record<string, { label: string; fallback: string }>> = Object.freeze({
  REFORM_PROGRESS_STALLED: { label: "改桑进度", fallback: "暂时停滞" },
  EMPEROR_TRUST_DELTA: { label: "皇帝信任", fallback: "发生变化" },
  EMPEROR_TRUST_RISK: { label: "皇帝信任", fallback: "风险上升" },
  EMPEROR_TRUST_DANGER: { label: "皇帝信任", fallback: "已进入危险区间" },
  REFORM_PROGRESS_GAIN: { label: "改桑进度", fallback: "取得进展" },
  QUESTION_INITIATIVE_GAINED: { label: "质问主动权", fallback: "已解锁" },
  REPORT_CONTROL_RESTRICTED: { label: "对手口径控制", fallback: "受到限制" },
  SANGTIAN_WORKING_ARC_DELTA: { label: "个人目标", fallback: "本章进展已更新" },
  SANGTIAN_CHAPTER_ARC_HIGH: { label: "章节目标", fallback: "取得关键进展" },
  SANGTIAN_CHAPTER_ARC_MID: { label: "章节目标", fallback: "在代价中推进" },
  SANGTIAN_CHAPTER_ARC_LOW: { label: "章节目标", fallback: "遭遇重大阻碍" },
  SANGTIAN_FINALE_VERDICT_WIN: { label: "个人结局", fallback: "目标达成" },
  SANGTIAN_FINALE_VERDICT_COSTLY_WIN: { label: "个人结局", fallback: "付出代价后达成目标" },
  SANGTIAN_FINALE_VERDICT_LOSS: { label: "个人结局", fallback: "目标未能达成" },
});

export function toVisibleImpact(input: {
  effectCode: string;
  before: string | number | null;
  after: string | number | null;
  delta: number | null;
}): AEmotionVisibleImpactPortV1 {
  const copy = IMPACT_COPY[input.effectCode] ?? { label: "局势", fallback: "发生变化" };
  const value = input.delta !== null
    ? `${input.delta > 0 ? "+" : ""}${input.delta}`
    : input.after !== null
      ? String(input.after)
      : copy.fallback;
  return { effectCode: input.effectCode, label: copy.label, value };
}

function actions(input: AEmotionPresentationInputPortV1): AEmotionCardActionPortV1[] | null {
  const result: AEmotionCardActionPortV1[] = [];
  for (const option of input.responseOptions) {
    const label = ACTION_COPY[option.code];
    if (!label) return null;
    result.push({ ...option, label });
  }
  if (input.cardType !== null && result.length !== 3) return null;
  return result;
}

function factLines(input: AEmotionPresentationInputPortV1): string[] {
  return input.knownFactRefs.map((factRef) => FACT_COPY[factRef]).filter((item): item is string => Boolean(item));
}

function impactLines(input: AEmotionPresentationInputPortV1): string[] {
  return input.visibleImpacts.map((impact) => `${impact.label} ${impact.value}`);
}

function card(
  input: AEmotionPresentationInputPortV1,
  title: string,
  safeSummary: string,
  blockA: { title: string; lines: string[] },
  blockB: { title: string; lines: string[] },
  cardActions: AEmotionCardActionPortV1[],
): AEmotionCenterCardPortV1 | null {
  if (!input.cardType) return null;
  const accent = input.cardType === "STAGE_VICTORY"
    ? "GREEN"
    : input.cardType === "CROSS_IMPACT"
      ? "PURPLE"
      : "ORANGE_RED";
  return {
    id: `card:${input.eventId}:${input.cardType}`,
    type: input.cardType,
    accent,
    title,
    summary: safeSummary,
    blockA: { ...blockA, lines: blockA.lines.length > 0 ? blockA.lines : ["局势变化已经确认"] },
    blockB: { ...blockB, lines: blockB.lines.length > 0 ? blockB.lines : ["更多信息可通过现有行动获得"] },
    primaryAction: cardActions[0]!,
    secondaryAction: cardActions[1]!,
    tertiaryAction: cardActions[2]!,
    sourceEventId: input.eventId,
  };
}

/** Frozen, deterministic copy catalog. No Provider or Narrative call is allowed here. */
export class FrozenAEmotionPresentationCatalogV1 implements AEmotionPresentationPortV1 {
  render(input: AEmotionPresentationInputPortV1) {
    const cardActions = actions(input);
    if (!cardActions) return null;
    const impacts = impactLines(input);
    const facts = factLines(input);
    if (["LEDGER_DELIVERY_ANOMALY", "LEDGER_SOURCE_SUSPECTED", "LEDGER_SOURCE_CONFIRMED", "LEDGER_ORIGINAL_LOCATED"].includes(input.eventCode)) {
      const title = "原始粮册的递送出现异常";
      const summary = input.disclosure === "CONFIRMED"
        ? "调查已经确认账册流转过程被改变。"
        : input.disclosure === "SUSPECTED"
          ? "多项迹象表明，账册流转过程可能被改变。"
          : "部分页面可能在送达前被替换。";
      return {
        title,
        safeSummary: summary,
        actions: cardActions,
        card: card(input, "他人的行动影响了你的处境", summary, { title: "影响", lines: impacts }, { title: "你知道", lines: facts }, cardActions),
      };
    }
    if (input.eventCode === "LEDGER_COPY_DELIVERED") {
      return { title: "巡抚正式递交粮册副本", safeSummary: "账册副本已经公开送达。", actions: cardActions, card: null };
    }
    if (input.eventCode === "PROMISE_DELIVER_LEDGER_BROKEN") {
      const summary = "巡抚没有兑现承诺，县令只交出了转抄副本。";
      return {
        title: "承诺破裂",
        safeSummary: summary,
        actions: cardActions,
        card: card(input, "承诺破裂", summary, { title: "结果", lines: impacts }, { title: "你获得", lines: ["巡抚手令抄录", "一次公开质问机会"] }, cardActions),
      };
    }
    if (input.eventCode === "EMPEROR_TRUST_DANGER_ENTERED") {
      const summary = "皇帝信任已进入危险区间，再出现一次公开治理失败，你将失去改革主持权。";
      return {
        title: "你正在失去主持权",
        safeSummary: summary,
        actions: cardActions,
        card: card(input, "你正在失去主持权", summary, { title: "危险来源", lines: facts }, { title: "你可以", lines: ["使用筹码稳定信任", "立即派遣调查"] }, cardActions),
      };
    }
    if (["ORIGINAL_LEDGER_CONTROL_GAINED", "REFORM_MOMENTUM_RESTORED"].includes(input.eventCode)) {
      const summary = "原始粮册已经落入你手中，巡抚暂时无法继续控制奏报口径。";
      return {
        title: "你夺回了主动权",
        safeSummary: summary,
        actions: cardActions,
        card: card(input, "你夺回了主动权", summary, { title: "收益", lines: impacts }, { title: "对手受限", lines: ["巡抚难以继续控制口径", "县令开始动摇"] }, cardActions),
      };
    }
    if (input.eventCode === "SANGTIAN_BEAT_ACTION_COMMITTED") {
      return {
        title: "本章行动已经确认",
        safeSummary: input.disclosure === "CONFIRMED"
          ? "行动及其直接影响已有权威证据确认。"
          : "行动已经进入本章工作状态，来源细节仍按权限隐藏。",
        actions: cardActions,
        card: null,
      };
    }
    if (input.eventCode === "SANGTIAN_CHAPTER_HIGH_COMMITTED") {
      const summary = "本章结算已经确认，你的个人目标取得了关键进展。";
      return {
        title: "本章取得关键进展",
        safeSummary: summary,
        actions: cardActions,
        card: card(input, "本章取得关键进展", summary, { title: "个人影响", lines: impacts }, { title: "公开结果", lines: facts }, cardActions),
      };
    }
    if (input.eventCode === "SANGTIAN_CHAPTER_MID_COMMITTED") {
      const summary = "本章结算已经确认，局势继续推进，但代价仍然存在。";
      return {
        title: "局势在代价中推进",
        safeSummary: summary,
        actions: cardActions,
        card: card(input, "局势在代价中推进", summary, { title: "个人影响", lines: impacts }, { title: "公开结果", lines: facts }, cardActions),
      };
    }
    if (input.eventCode === "SANGTIAN_CHAPTER_LOW_COMMITTED") {
      const summary = "本章结算已经确认，你的个人目标遭遇了重大阻碍。";
      return {
        title: "本章危机已经确认",
        safeSummary: summary,
        actions: cardActions,
        card: card(input, "本章危机已经确认", summary, { title: "个人影响", lines: impacts }, { title: "公开结果", lines: facts }, cardActions),
      };
    }
    if (input.eventCode === "SANGTIAN_FINALE_WIN_COMMITTED") {
      const summary = "你的个人结局已经确认：目标达成。";
      return {
        title: "你的目标已经达成",
        safeSummary: summary,
        actions: cardActions,
        card: card(input, "你的目标已经达成", summary, { title: "最终影响", lines: impacts }, { title: "权威状态", lines: ["结局已冻结"] }, cardActions),
      };
    }
    if (input.eventCode === "SANGTIAN_FINALE_COSTLY_WIN_COMMITTED") {
      const summary = "你的个人结局已经确认：目标达成，但付出了明确代价。";
      return {
        title: "你带着代价达成目标",
        safeSummary: summary,
        actions: cardActions,
        card: card(input, "你带着代价达成目标", summary, { title: "最终影响", lines: impacts }, { title: "权威状态", lines: ["结局已冻结"] }, cardActions),
      };
    }
    if (input.eventCode === "SANGTIAN_FINALE_LOSS_COMMITTED") {
      const summary = "你的个人结局已经确认：目标未能达成。";
      return {
        title: "你的目标未能达成",
        safeSummary: summary,
        actions: cardActions,
        card: card(input, "你的目标未能达成", summary, { title: "最终影响", lines: impacts }, { title: "权威状态", lines: ["结局已冻结"] }, cardActions),
      };
    }
    return null;
  }
}
