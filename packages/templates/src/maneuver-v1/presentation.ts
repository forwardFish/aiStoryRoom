import {
  ActionPreviewPresentationV1,
  CompiledManeuverActionV1,
  EvidenceLevelV1,
  InvestigationRouteV1,
  RuleCardDefinitionV1,
} from "./types";

const LEVEL_LABELS: Record<EvidenceLevelV1, string> = {
  LEAD: "线索",
  CORROBORATION: "佐证",
  PROOF: "实证",
};

export function evidenceLevelLabel(level: EvidenceLevelV1): string {
  return LEVEL_LABELS[level];
}

export function settlementMomentLabel(route: Pick<InvestigationRouteV1, "settlementMoment">): string {
  const moment = route.settlementMoment;
  switch (moment.kind) {
    case "IMMEDIATE_AFTER_COMMIT": return "确认后立即揭晓";
    case "BEFORE_MAIN_LOCK": return "本场景主线决策锁定前";
    case "NEXT_ACTOR_TURN": return "下一次轮到你行动时";
    case "ON_WORLD_EVENT": return "相关局势再次发生时";
    case "AT_STAGE": return `第 ${moment.stageIndex} 阶段`;
  }
}

function chips(action: CompiledManeuverActionV1): ActionPreviewPresentationV1["chips"] {
  const result: ActionPreviewPresentationV1["chips"] = action.costs.map((cost) => ({
    kind: "COST" as const,
    label: cost.label,
  }));
  result.push({ kind: "TIME", label: action.timing.playerLabel });
  result.push({
    kind: "VISIBILITY",
    label: action.visibility.scope === "PRIVATE"
      ? "仅你可见"
      : action.visibility.scope === "LIMITED"
        ? "仅相关人物可见"
        : action.visibility.scope === "OBSERVABLE"
          ? "行动可能被察觉"
          : "公开行动",
  });
  result.push({ kind: "LOCK", label: "提交后锁定" });
  return dedupeChips(result);
}

function dedupeChips(items: ActionPreviewPresentationV1["chips"]): ActionPreviewPresentationV1["chips"] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function baseSections(action: CompiledManeuverActionV1): ActionPreviewPresentationV1["sections"] {
  const sections: ActionPreviewPresentationV1["sections"] = [];
  if (action.guaranteedStart.length > 0) {
    sections.push({
      kind: "CAN_DO",
      label: action.actionKind === "INVESTIGATION" ? "这一步会开始追查" : "这一步一定开始发生",
      lines: action.guaranteedStart.map((item) => item.statement),
    });
  }
  if (action.contestedOutcome.length > 0) {
    sections.push({
      kind: "CAN_DO",
      label: action.actionKind === "INVESTIGATION" ? "这一步可能查清" : "进入结算",
      lines: action.contestedOutcome.map((item) => item.statement),
    });
  }
  if (action.notGuaranteed.length > 0) {
    sections.push({
      kind: "CANNOT_GUARANTEE",
      label: action.actionKind === "INVESTIGATION" ? "这一步不能证明" : "仍然不能保证",
      lines: action.notGuaranteed.map((item) => item.statement),
    });
  }
  if (action.tracePolicy.leavesTrace && action.tracePolicy.playerSafeHint) {
    sections.push({
      kind: "MAY_LEAVE",
      label: "可能留下",
      lines: [action.tracePolicy.playerSafeHint],
    });
  }
  sections.push({
    kind: "WHEN_REVEALED",
    label: action.timing.startsAt === "ON_TRIGGER" ? "何时生效" : "何时揭晓",
    lines: [action.timing.playerLabel],
  });
  return sections;
}

export function buildConversationPresentation(
  action: CompiledManeuverActionV1,
  input: { actorLabel: string; targetLabel: string; message: string; purposeLabel: string },
): ActionPreviewPresentationV1 {
  const visibilityText = action.visibility.scope === "PUBLIC" ? "当众" : "避开旁人";
  return {
    eyebrow: `${input.actorLabel} · ${action.visibility.scope === "PUBLIC" ? "公开交涉" : "私下会面"}`,
    title: `${visibilityText}与${input.targetLabel}交谈`,
    narrative: `${visibilityText}后，你会把这句话原样交给${input.targetLabel}：\n\n“${input.message}”`,
    sections: [
      {
        kind: "CAN_DO",
        label: "这次交谈会做到",
        lines: [`${input.targetLabel}会收到这段话，并知道你正在尝试${input.purposeLabel}。`],
      },
      {
        kind: "CANNOT_GUARANTEE",
        label: "对方不必",
        lines: action.notGuaranteed.map((item) => item.statement),
      },
      ...(action.tracePolicy.leavesTrace && action.tracePolicy.playerSafeHint
        ? [{ kind: "MAY_LEAVE" as const, label: "可能留下", lines: [action.tracePolicy.playerSafeHint] }]
        : []),
      { kind: "WHEN_REVEALED", label: "何时揭晓", lines: [action.timing.playerLabel] },
    ],
    chips: chips(action),
    confirmLabel: `向${input.targetLabel}说出这段话`,
    editLabel: "返回修改",
  };
}

export function buildInvestigationPresentation(
  action: CompiledManeuverActionV1,
  input: {
    actorLabel: string;
    route: InvestigationRouteV1;
    executorLabel: string;
    traceTitle: string;
  },
): ActionPreviewPresentationV1 {
  return {
    eyebrow: `${input.actorLabel} · 私密谋划`,
    title: `沿“${input.traceTitle}”继续追查`,
    narrative: `你把${input.executorLabel}叫到一旁，只交代一件事：${input.route.narrativeMethod}。`,
    sections: [
      {
        kind: "CAN_DO",
        label: "这一步可能查清",
        lines: input.route.mayLearn,
      },
      {
        kind: "CANNOT_GUARANTEE",
        label: "这一步不能证明",
        lines: input.route.cannotProve,
      },
      ...(input.route.observableTrail
        ? [{ kind: "MAY_LEAVE" as const, label: "可能留下", lines: [input.route.observableTrail.summary] }]
        : []),
      {
        kind: "WHEN_REVEALED",
        label: "何时揭晓",
        lines: [settlementMomentLabel(input.route)],
      },
    ],
    chips: chips(action),
    confirmLabel: `让${input.executorLabel}去查`,
    editLabel: "返回修改",
  };
}

export function buildCardLayoutPresentation(
  action: CompiledManeuverActionV1,
  input: {
    actorLabel: string;
    card: RuleCardDefinitionV1;
    targetLabel: string;
    playMode: "ACTIVE" | "SET";
    triggerLabel?: string;
  },
): ActionPreviewPresentationV1 {
  const set = input.playMode === "SET";
  const sections = baseSections(action).filter((section) => section.kind !== "WHEN_REVEALED");
  if (set) {
    sections.unshift({
      kind: "TRIGGER",
      label: "只在这件事发生时",
      lines: [input.triggerLabel || "牌面允许的条件成立"],
    });
  }
  sections.push({
    kind: "WHEN_REVEALED",
    label: set ? "何时暴露" : "何时生效",
    lines: [set ? "伏置时保持秘密，触发后按牌面公开" : action.timing.playerLabel],
  });
  return {
    eyebrow: `${input.actorLabel} · ${set ? "暗中伏置" : "筹码落子"}`,
    title: `${set ? "伏下" : "打出"}“${input.card.label}”`,
    narrative: set
      ? `你没有立刻亮出“${input.card.label}”，而是把它押在“${input.targetLabel}”上，等待约定的条件出现。`
      : `你决定把“${input.card.label}”正式落在“${input.targetLabel}”上，接受牌面写明的代价与暴露。`,
    sections,
    chips: chips(action),
    confirmLabel: set ? `伏下${input.card.label}` : `打出${input.card.label}`,
    editLabel: "返回修改",
  };
}

export function buildCustomPlanPresentation(
  action: CompiledManeuverActionV1,
  input: { actorLabel: string; title: string; narrative: string; confirmLabel: string },
): ActionPreviewPresentationV1 {
  return {
    eyebrow: `${input.actorLabel} · 正式行动`,
    title: input.title,
    narrative: input.narrative,
    sections: baseSections(action),
    chips: chips(action),
    confirmLabel: input.confirmLabel,
    editLabel: "返回修改",
  };
}

export function buildReactionPresentation(
  action: CompiledManeuverActionV1,
  input: { actorLabel: string; title: string; narrative: string; hold: boolean },
): ActionPreviewPresentationV1 {
  return {
    eyebrow: `${input.actorLabel} · 应变`,
    title: input.title,
    narrative: input.narrative,
    sections: input.hold ? [] : baseSections(action),
    chips: input.hold ? [] : chips(action),
    confirmLabel: input.hold ? "暂不应变" : "确认应变",
    editLabel: "返回修改",
  };
}
