import {
  ENDGAME_PRESENTATION_V1_SCHEMA,
  type EndgameCauseDirectionV1,
  type EndgameCauseV1,
  type EndgamePresentationV1,
  type EndgameReplayActionV1,
  type EndgameRevealV1,
  type EndgameVerdictV1,
} from "@ai-story/shared";
export type SoloEndingSource = {
  schemaVersion: "openovel_ending_v1";
  scope: "STORY" | "PART";
  endingKey: string;
  title: string;
  finalSceneNarrative: string;
  protagonistFate: string;
  aftermath: string[];
  sourceTurnId: string;
  sourceRevision: number;
};

export type SoloEndingEvidenceAuthority =
  | "PLAYER_ACTION"
  | "PREDICATE"
  | "CAUSAL_EVENT"
  | "DELAYED_EVENT"
  | "PLAYER_CANON";

export type SoloEndingEvidenceCandidate = {
  authority: SoloEndingEvidenceAuthority;
  committed: boolean;
  authorized: boolean;
  stageIndex: number | null;
  sourceActionId: string | null;
  sourceRoleName: string | null;
  actionTitle: string;
  factText: string;
  direction: EndgameCauseDirectionV1;
};

export type SoloEndingRevealCandidate = {
  committed: boolean;
  authorized: boolean;
  visibility: "PUBLIC" | "PLAYER" | "INTERNAL";
  title: string;
  text: string;
};

export type SoloReplayCapabilities = {
  worldId: string;
  currentRoleKey: string;
  supportedRoleKeys: string[];
  nextPart: null | {
    partId: string;
    href: string;
    label?: string;
  };
};

export type SoloEndingPresentationInput = {
  ending: SoloEndingSource;
  evidence: SoloEndingEvidenceCandidate[];
  revealCandidates: SoloEndingRevealCandidate[];
  replay: SoloReplayCapabilities;
};

export type SoloEndingCompletionContractV1 = {
  schemaVersion: "openovel_completion_contract_v1";
  contractId: string;
  engineVersion: "openovel_v1";
  templateKey: string;
  roleKey: string;
  partId: string;
  terminalScope: "PART" | "STORY";
  terminalTurnId: string;
  terminalRevision: number;
};

const COMPLETION_CONTRACTS: readonly SoloEndingCompletionContractV1[] = Object.freeze([
  Object.freeze({
    schemaVersion: "openovel_completion_contract_v1",
    contractId: "openovel.sangtian.part-01.zhejiang-governor.v1",
    engineVersion: "openovel_v1",
    templateKey: "sangtian",
    roleKey: "zhejiang_governor",
    partId: "PART-01",
    terminalScope: "PART",
    terminalTurnId: "T20",
    terminalRevision: 20,
  }),
]);

export function resolveSoloEndingCompletionContract(input: {
  engineVersion: string;
  templateKey: string;
  roleKey: string;
}): SoloEndingCompletionContractV1 | null {
  return COMPLETION_CONTRACTS.find((contract) => (
    contract.engineVersion === input.engineVersion
    && contract.templateKey === input.templateKey
    && contract.roleKey === input.roleKey
  )) || null;
}

type OutcomePolicy = {
  verdict: Exclude<EndgameVerdictV1, "UNAVAILABLE">;
  verdictLabel: string;
  gain: string[];
  loss: string[];
  replayHint: string;
};

const OUTCOME_POLICY: Readonly<Record<string, OutcomePolicy>> = Object.freeze({
  guarded_people_bore_responsibility: {
    verdict: "COSTLY_WIN",
    verdictLabel: "你守住了底线，但承担了代价",
    gain: [
      "民田边界与最急迫的救粮秩序仍然有效。",
      "县册证据链仍可追索，第一版事实无法被轻易抹去。",
    ],
    loss: [
      "问责已经落到你自己名下。",
      "你失去了继续含混退让和把责任完全推给下属的余地。",
    ],
    replayHint: "下一局可以尝试更早分配复核责任，看看能否在守住民田与证据的同时，减少最终由你独自担责的代价。",
  },
  guarded_people_preserved_evidence: {
    verdict: "WIN",
    verdictLabel: "你保住了本部分最重要的东西",
    gain: [
      "民田边界与最急迫的救粮秩序仍然有效。",
      "县册证据链仍可追索，后续问责不再只能依赖口供。",
    ],
    loss: [
      "第一份奏报与责任边界仍可能被各方继续争夺。",
    ],
    replayHint: "下一局可以尝试让首份奏报更早离开浙江，比较“保住证据”与“抢先固定政治叙述”之间的代价。",
  },
  evidence_entered_capital: {
    verdict: "COSTLY_WIN",
    verdictLabel: "证据成功入京，但民生代价未能阻止",
    gain: [
      "可核验的证据已经进入京师政治，地方难以再靠口头改写第一版事实。",
    ],
    loss: [
      "民田与最急迫的救粮秩序没有被真正守住。",
      "证据被保留下来时，百姓已经先承担了现实代价。",
    ],
    replayHint: "下一局可以优先处理救粮与民田边界，再寻找把证据送入京师的路径，比较事实胜利与民生结果能否同时成立。",
  },
  executed_policy_lost_people: {
    verdict: "LOSS",
    verdictLabel: "你保住了执行名分，却失去了百姓的退路",
    gain: [
      "执行国策的名分暂时没有从你手中失去。",
    ],
    loss: [
      "百姓面对粮价与田契时的退路没有被保住。",
      "粮食压力与失田风险仍会进入下一部分。",
    ],
    replayHint: "下一局可以先为民田和救粮设置明确边界，再决定如何回应催办与奏报压力。",
  },
  crisis_unresolved: {
    verdict: "UNRESOLVED",
    verdictLabel: "危局尚未真正解决",
    gain: [
      "部分民田与眼前秩序获得了暂时缓冲。",
    ],
    loss: [
      "证据链、奏报与责任边界仍未形成足以收束危局的结果。",
      "尚未兑现的压力会继续进入后续部分。",
    ],
    replayHint: "下一局需要更早把调查、证据保管与奏报动作连接起来，避免只守住眼前局势却没有形成可延续的责任链。",
  },
});

export function toSoloEndgamePresentation(
  input: SoloEndingPresentationInput,
): EndgamePresentationV1 {
  assertSoloEndingCompletionContract({
    ending: input.ending,
    replay: input.replay,
  });
  const policy = OUTCOME_POLICY[input.ending.endingKey];
  if (!policy) return legacySoloEndgamePresentation({
    ending: input.ending,
    replay: input.replay,
  });

  return {
    schemaVersion: ENDGAME_PRESENTATION_V1_SCHEMA,
    resultType: input.ending.scope === "PART" ? "SOLO_PART_END" : "SOLO_STORY_END",
    verdict: policy.verdict,
    verdictLabel: policy.verdictLabel,
    title: input.ending.title,
    verdictLine: input.ending.protagonistFate,
    narrative: input.ending.finalSceneNarrative,
    gain: [...policy.gain],
    loss: [...policy.loss],
    causes: projectAuthorizedCauses(input.evidence),
    reveal: projectAuthorizedReveal(input.revealCandidates),
    replayHint: policy.replayHint,
    replayActions: buildSoloReplayActions(input.replay, input.ending.scope),
  };
}

export function legacySoloEndgamePresentation(input: {
  ending?: SoloEndingSource | null;
  replay: SoloReplayCapabilities;
}): EndgamePresentationV1 {
  return {
    schemaVersion: ENDGAME_PRESENTATION_V1_SCHEMA,
    resultType: "LEGACY_ENDING",
    verdict: "UNAVAILABLE",
    verdictLabel: "历史结局数据不完整",
    title: "历史结局数据不完整",
    verdictLine: "系统没有找到可验证的终局裁定映射，因此不会从小诱正文猜测胜负。",
    narrative: input.ending?.finalSceneNarrative || "",
    gain: [],
    loss: [],
    causes: [],
    reveal: null,
    replayHint: "你可以保留这条历史记录，并从同一世界重新开始一条完整的新故事线。",
    replayActions: buildSoloReplayActions(input.replay, input.ending?.scope || "PART"),
  };
}

function assertSoloEndingCompletionContract(input: {
  ending: SoloEndingSource;
  replay: Pick<SoloReplayCapabilities, "worldId" | "currentRoleKey">;
}) {
  // This mapper is entered only after the OpenNovel service has verified the
  // engine version and authenticated role. The exact template/role identity
  // selects a versioned Part contract; no prose, keyword or title is read.
  const contract = resolveSoloEndingCompletionContract({
    engineVersion: "openovel_v1",
    templateKey: input.replay.worldId,
    roleKey: input.replay.currentRoleKey,
  });
  if (!contract) return;
  if (
    input.ending.scope !== contract.terminalScope
    || input.ending.sourceTurnId !== contract.terminalTurnId
    || input.ending.sourceRevision !== contract.terminalRevision
  ) {
    throw Object.assign(
      new Error("SOLO_RESULT_NOT_READY:ENDING_COMPLETION_CONTRACT_MISMATCH"),
      {
        code: "SOLO_RESULT_NOT_READY" as const,
        reason: "ENDING_COMPLETION_CONTRACT_MISMATCH",
      },
    );
  }
}

export function projectAuthorizedCauses(
  candidates: readonly SoloEndingEvidenceCandidate[],
): EndgameCauseV1[] {
  const seen = new Set<string>();
  const projected: EndgameCauseV1[] = [];
  for (const candidate of candidates) {
    if (!candidate.committed || !candidate.authorized) continue;
    const actionTitle = candidate.actionTitle.trim();
    const factText = candidate.factText.trim();
    if (!actionTitle || !factText) continue;
    const key = candidate.sourceActionId
      ? `action:${candidate.sourceActionId}`
      : `${candidate.authority}:${actionTitle}\u0000${factText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    projected.push({
      stageIndex: candidate.stageIndex,
      sourceActionId: candidate.sourceActionId,
      sourceRoleName: candidate.sourceRoleName,
      actionTitle,
      factText,
      direction: candidate.direction,
    });
    if (projected.length === 3) break;
  }
  return projected;
}

export function projectAuthorizedReveal(
  candidates: readonly SoloEndingRevealCandidate[],
): EndgameRevealV1 {
  const candidate = candidates.find((item) => (
    item.committed
    && item.authorized
    && (item.visibility === "PUBLIC" || item.visibility === "PLAYER")
    && item.title.trim().length > 0
    && item.text.trim().length > 0
  ));
  return candidate
    ? { title: candidate.title.trim(), text: candidate.text.trim() }
    : null;
}

export function buildSoloReplayActions(
  capability: SoloReplayCapabilities,
  endingScope: "STORY" | "PART",
): EndgameReplayActionV1[] {
  const params = new URLSearchParams({
    story: capability.worldId,
    role: capability.currentRoleKey,
    start: "new",
    soloRoles: [...new Set(capability.supportedRoleKeys)].join(","),
  });
  const roleSelectionHref = `/role-select?${params.toString()}`;
  const hasAlternativeRole = capability.supportedRoleKeys.some(
    (roleKey) => roleKey !== capability.currentRoleKey,
  );
  const nextPartAvailable = endingScope === "PART" && Boolean(capability.nextPart?.href);

  return [
    {
      type: "RESTART_SAME_STORY",
      label: "重新开始",
      href: roleSelectionHref,
      enabled: true,
      disabledReason: null,
    },
    {
      type: "CHANGE_ROLE",
      label: "换个角色",
      href: hasAlternativeRole ? roleSelectionHref : null,
      enabled: hasAlternativeRole,
      disabledReason: hasAlternativeRole ? null : "当前运行时尚未开放其他可完整体验的单人角色。",
    },
    {
      type: "CONTINUE_NEXT_PART",
      label: capability.nextPart?.label || "进入第二部分",
      href: nextPartAvailable ? capability.nextPart!.href : null,
      enabled: nextPartAvailable,
      disabledReason: nextPartAvailable
        ? null
        : endingScope === "STORY"
          ? "这已经是整部故事的结局。"
          : "第二部分尚未开放。",
    },
    {
      type: "BACK_TO_WORLDS",
      label: "返回世界大厅",
      href: "/worlds",
      enabled: true,
      disabledReason: null,
    },
  ];
}
