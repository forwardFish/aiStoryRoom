import { sha256Canonical } from "./canonical";
import { compileCausalTurn } from "./causal-turn-engine";
import type {
  CompiledCausalTurn,
  CompiledShadowContext,
  CompiledWorldBible,
  ContextAuditItem,
  EvidencePackage,
  Priority,
  ShadowDecisionClass,
  ShadowNarrativeBudget,
  ShadowRuntimeFixture,
  ShadowWriterPlan,
  WorldBibleContextCard,
  WorldBibleRuntimeFact
} from "./types";

export function compileShadowContext(
  fixture: ShadowRuntimeFixture,
  evidencePackage: EvidencePackage,
  worldBible: CompiledWorldBible
): CompiledShadowContext {
  if (fixture.evidencePackageId !== evidencePackage.manifest.packageId) {
    throw new Error(`EVIDENCE_PACKAGE_MISMATCH: fixture=${fixture.evidencePackageId} package=${evidencePackage.manifest.packageId}`);
  }
  if (worldBible.sourceEvidence.packageId !== evidencePackage.manifest.packageId || worldBible.sourceEvidence.sourceSha256 !== evidencePackage.manifest.source.sha256) {
    throw new Error("WORLD_BIBLE_EVIDENCE_MISMATCH");
  }
  if (worldBible.startPoint.sourceCutoffChapterId !== fixture.sourceCutoffChapterId) {
    throw new Error(`WORLD_BIBLE_START_POINT_MISMATCH: fixture=${fixture.sourceCutoffChapterId} bible=${worldBible.startPoint.sourceCutoffChapterId}`);
  }
  const cutoff = evidencePackage.chapterIndex.find((chapter) => chapter.chapterId === fixture.sourceCutoffChapterId);
  if (!cutoff) throw new Error(`SOURCE_CUTOFF_UNKNOWN: ${fixture.sourceCutoffChapterId}`);
  const chapterOrdinal = new Map(evidencePackage.chapterIndex.map((chapter) => [chapter.chapterId, chapter.ordinal]));
  const includedClaims = [];
  const excludedEvidenceClaimIds: CompiledShadowContext["excludedEvidenceClaimIds"] = [];
  for (const claim of evidencePackage.claims) {
    const ordinal = chapterOrdinal.get(claim.chapterId) || Number.MAX_SAFE_INTEGER;
    if (ordinal > cutoff.ordinal || claim.runtimeUse === "forbidden_future") {
      excludedEvidenceClaimIds.push({ claimId: claim.claimId, reason: "FUTURE_CUTOFF" });
    } else if (claim.runtimeUse === "world_basis_only") {
      excludedEvidenceClaimIds.push({ claimId: claim.claimId, reason: "WORLD_BASIS_ONLY" });
    } else if (!claim.visibleToRoleIds.includes(fixture.role.roleId)) {
      excludedEvidenceClaimIds.push({ claimId: claim.claimId, reason: "ROLE_ACL" });
    } else {
      includedClaims.push(claim);
    }
  }

  const visibleFacts = worldBible.runtimeFacts.filter((fact) =>
    fact.visibility === "PUBLIC" || fact.knownByRoleIds.includes(fixture.role.roleId) || fixture.role.knownFactIds.includes(fact.factId)
  );
  const visibleFactIds = new Set(visibleFacts.map((fact) => fact.factId));
  const visibleCards = worldBible.contextCards.filter((card) => card.groundedFactIds.some((factId) => visibleFactIds.has(factId)));
  const writerPlan = resolveWriterPlan(fixture);
  const narrativeBudget = resolveNarrativeBudget(fixture);
  const causalTurn = compileCausalTurn(fixture);
  const writerFacts = selectByIds(visibleFacts, writerPlan.relevantRuntimeFactIds, (item) => item.factId, "WRITER_RUNTIME_FACT_UNKNOWN");
  const writerCards = selectByIds(visibleCards, writerPlan.relevantCardIds, (item) => item.cardId, "WRITER_CONTEXT_CARD_UNKNOWN");
  const minimalCanon = compileMinimalCanonTail(fixture.recentCanon);
  const sourceClaimIds = new Set(evidencePackage.claims.map((claim) => claim.claimId));
  for (const fact of visibleFacts) {
    for (const claimId of fact.sourceClaimIds) {
      if (!sourceClaimIds.has(claimId)) throw new Error(`RUNTIME_FACT_SOURCE_CLAIM_MISSING: ${fact.factId} -> ${claimId}`);
      const sourceClaim = evidencePackage.claims.find((claim) => claim.claimId === claimId)!;
      const sourceOrdinal = chapterOrdinal.get(sourceClaim.chapterId) || Number.MAX_SAFE_INTEGER;
      if (sourceOrdinal > cutoff.ordinal || sourceClaim.runtimeUse === "forbidden_future") {
        throw new Error(`RUNTIME_FACT_SOURCE_CLAIM_AFTER_CUTOFF: ${fact.factId} -> ${claimId}`);
      }
    }
  }
  const allowedEvidenceClaimIds = [...new Set([
    ...includedClaims.map((claim) => claim.claimId),
    ...visibleFacts.flatMap((fact) => fact.sourceClaimIds),
    ...visibleCards.flatMap((card) => card.sourceClaimIds)
  ])];

  const sections: Array<{ id: string; label: string; priority: Priority; lines: string[]; provenance: string[]; preserved: boolean }> = [
    {
      id: "context-contract",
      label: "Context Contract",
      priority: "P0",
      lines: [
        `packet=shadow-only; evidence=${evidencePackage.manifest.packageId}@${evidencePackage.manifest.packageVersion}`,
        `source_cutoff=${fixture.sourceCutoffChapterId}; player=${fixture.role.roleId}`,
        "只把 Current Scene、Recent Canon 和 Confirmed Resolution 明示的内容写成本局当前事实。",
        "原著证据只解释世界底色，不表示原著事件正在本局重复发生；人物说法、信念、推断和游戏改编必须保留各自标签。"
      ],
      provenance: [evidencePackage.manifest.source.sha256],
      preserved: true
    },
    {
      id: "action-boundary",
      label: "Action Boundary",
      priority: "P0",
      lines: [JSON.stringify(fixture.actionBoundary)],
      provenance: [fixture.playerIntent.immutableIntentHash],
      preserved: true
    },
    {
      id: "state-locks",
      label: "State Locks",
      priority: "P0",
      lines: [JSON.stringify(fixture.stateLocks)],
      provenance: fixture.stateLockAssertions.map((item) => item.fieldPath),
      preserved: true
    },
    {
      id: "npc-action-policies",
      label: "NPC Action Policy",
      priority: "P0",
      lines: [JSON.stringify(fixture.npcActionPolicies)],
      provenance: Object.keys(fixture.npcActionPolicies),
      preserved: true
    },
    {
      id: "scene",
      label: "当前场景与时间",
      priority: "P0",
      lines: [
        `${fixture.scene.timeLabel} · ${fixture.scene.locationLabel}`,
        fixture.scene.situation,
        `在场：${fixture.scene.presentCharacterIds.join("、")}`,
        `关系：${fixture.scene.visibleRelationships.join("；")}`
      ],
      provenance: [fixture.scene.sceneId],
      preserved: true
    },
    {
      id: "identity",
      label: "角色身份、目标与权限",
      priority: "P0",
      lines: [fixture.role.identity, `目标：${fixture.role.goal}`, `权限：${fixture.role.permissions.join("；")}`],
      provenance: [fixture.role.roleId],
      preserved: true
    },
    {
      id: "evidence",
      label: "原著背景证据（类型不可升级，也不是本局当前事件）",
      priority: "P0",
      lines: includedClaims.map((claim) =>
        `- [SOURCE_HISTORY_ONLY | ${claim.claimId} | ${claim.type} | ${claim.truthStatus} | ${claim.evidence.chapterId}:${claim.evidence.lineStart}-${claim.evidence.lineEnd}] ${claim.content}`
      ),
      provenance: includedClaims.map((claim) => claim.claimId),
      preserved: true
    },
    {
      id: "runtime-facts",
      label: "玩家已知事实与改编边界",
      priority: "P0",
      lines: visibleFacts.map((fact) => `- [${fact.origin}; sources=${fact.sourceClaimIds.join(",")}] ${fact.content}`),
      provenance: visibleFacts.flatMap((fact) => [fact.factId, ...fact.sourceClaimIds]),
      preserved: true
    },
    {
      id: "resources",
      label: "资源、风险与开放线索",
      priority: "P0",
      lines: [
        `资源：${fixture.resources.join("；")}`,
        `当前压力：${fixture.activePressures.map((pressure) => pressure.summary).join("；")}`,
        `开放线索：${fixture.openThreads.join("；")}`,
        `主线问题：${fixture.scene.mainlineQuestion}`
      ],
      provenance: [...fixture.activePressures.map((pressure) => pressure.pressureId), ...fixture.scene.mainlineQuestionIds],
      preserved: true
    },
    {
      id: "pending",
      label: "待兑现后果",
      priority: "P0",
      lines: fixture.pendingConsequences.map((item) => `- [${item.consequenceId}; due=${item.dueLabel || "未定"}] ${item.summary}`),
      provenance: fixture.pendingConsequences.map((item) => item.consequenceId),
      preserved: true
    },
    {
      id: "narrative-boundary",
      label: "本轮叙事边界",
      priority: "P0",
      lines: [
        `结束条件：${fixture.narrativeBoundary.turnEndsWhen}`,
        `巡抚只可围绕：${fixture.narrativeBoundary.allowedNpcResponseTopics.join("；")}`,
        `resultNarrative 不得出现：${fixture.narrativeBoundary.resultNarrativeForbiddenTerms.join("、")}`,
        `本局角色没有姓名；正文和决策不得使用原著人物名：${fixture.narrativeBoundary.forbiddenCharacterNames.join("、")}`,
        `正文不得预写巡抚下一步报复或上报结果：${fixture.narrativeBoundary.forbiddenStoryOutcomeTerms.join("、")}`,
        "不得新增信使、文书、市场变化、群众行动、调查结果或角色离场。"
      ],
      provenance: ["shadow-turn-boundary-v1"],
      preserved: true
    },
    {
      id: "narrative-frame",
      label: "本轮叙事任务与边界",
      priority: "P0",
      lines: [
        `叙事意图：${fixture.narrativeFrame.storyIntent}`,
        ...fixture.narrativeFrame.requiredBeats.map((beat, index) => `必须发生_${index + 1}：${beat}`),
        `只可使用的描写细节：${fixture.narrativeFrame.allowedDescriptiveDetails.join("、")}`,
        `收束边界：${fixture.narrativeFrame.endingBoundary}`,
        `决策合同：${fixture.narrativeFrame.decisionPolicy.minimum}—${fixture.narrativeFrame.decisionPolicy.maximum} 个；${fixture.narrativeFrame.decisionPolicy.instruction}`
      ],
      provenance: [fixture.narrativeFrame.frameId],
      preserved: true
    },
    {
      id: "cards",
      label: "触发的 Context Cards",
      priority: "P1",
      lines: visibleCards.map((card) => `- [${card.origin}; ${card.cardId}; sources=${card.sourceClaimIds.join(",")}] ${card.title}：${card.summary}`),
      provenance: visibleCards.flatMap((card) => [card.cardId, ...card.sourceClaimIds]),
      preserved: false
    },
    {
      id: "style",
      label: "叙述规则",
      priority: "P1",
      lines: fixture.styleGuide.map((rule) => `- ${rule}`),
      provenance: ["shadow-style-v1"],
      preserved: false
    },
    {
      id: "recent-canon",
      label: "Recent Canon Excerpt",
      priority: "P0",
      lines: [...fixture.recentCanon]
        .sort((left, right) => left.chronologicalOrder - right.chronologicalOrder)
        .map((entry) => entry.narrative),
      provenance: fixture.recentCanon.map((entry) => entry.entryId),
      preserved: true
    },
    {
      id: "resolution",
      label: "Confirmed Resolution",
      priority: "P0",
      lines: [
        `resolution_id=${fixture.actionResolution.resolutionId}`,
        `已开始：${fixture.actionResolution.actionStarted}`,
        `confirmedEffects：${fixture.actionResolution.confirmedEffects.join("；")}`,
        `unresolvedEffects：${fixture.actionResolution.unresolvedEffects.join("；")}`,
        `代价：${fixture.actionResolution.costSummary || "无"}`
      ],
      provenance: [fixture.actionResolution.resolutionId],
      preserved: true
    },
    {
      id: "player-action",
      label: "Player Action",
      priority: "P0",
      lines: [fixture.playerIntent.userFacingText],
      provenance: [fixture.playerIntent.immutableIntentHash],
      preserved: true
    }
  ];

  const fitted = fitSectionsToBudget(sections, fixture.maxTokenEstimate);
  const auditItems: ContextAuditItem[] = sections.map((section) => ({
    id: section.id,
    section: section.label,
    priority: section.priority,
    tokenEstimate: estimateTokens(section.lines.join("\n")),
    required: section.preserved,
    preserved: fitted.includedIds.has(section.id),
    ...(!fitted.includedIds.has(section.id) ? { trimmedReason: "TOKEN_BUDGET" as const } : {}),
    provenance: section.provenance
  }));
  const renderedWorkingSet = sections
    .filter((section) => fitted.includedIds.has(section.id))
    .map((section) => `【${section.label}】\n${section.lines.join("\n")}`)
    .join("\n\n");
  const renderedWriterWorkingSet = renderWriterWorkingSet(fixture, writerPlan, narrativeBudget, minimalCanon, writerFacts, writerCards, causalTurn);
  const writerTokenEstimate = estimateTokens(renderedWriterWorkingSet);
  if (writerTokenEstimate > fixture.maxTokenEstimate) {
    throw new Error(`P0_WRITER_CONTEXT_BUDGET_EXCEEDED: writer packet ${writerTokenEstimate} > ${fixture.maxTokenEstimate}; refusing silent loss`);
  }
  const contextPacketId = `CTX-${fixture.fixtureId}`;
  const snapshotHash = sha256Canonical({
    contextPacketId,
    fixtureId: fixture.fixtureId,
    sourceCutoffChapterId: fixture.sourceCutoffChapterId,
    claims: includedClaims.map((claim) => ({ id: claim.claimId, hash: claim.evidence.excerptSha256 })),
    facts: visibleFacts,
    recentCanon: minimalCanon,
    resolution: fixture.actionResolution,
    actionBoundary: fixture.actionBoundary,
    stateLocks: fixture.stateLocks,
    npcActionPolicies: fixture.npcActionPolicies,
    decisionAccess: fixture.decisionAccess,
    narrativeFrame: fixture.narrativeFrame,
    writerPlan,
    narrativeBudget,
    causalTurn,
    playerIntentHash: fixture.playerIntent.immutableIntentHash
  });
  const serverGrounding = {
    evidenceClaimIds: [...new Set([
      ...writerFacts.flatMap((fact) => fact.sourceClaimIds),
      ...writerCards.flatMap((card) => card.sourceClaimIds)
    ])],
    runtimeFactIds: writerFacts.map((fact) => fact.factId),
    cardIds: writerCards.map((card) => card.cardId),
    sourceMapHash: sha256Canonical({
      facts: writerFacts.map((fact) => ({ id: fact.factId, claims: fact.sourceClaimIds })),
      cards: writerCards.map((card) => ({ id: card.cardId, claims: card.sourceClaimIds }))
    })
  };
  return {
    schemaVersion: "openovel_context_packet_v2",
    contextPacketId,
    snapshotHash,
    fixtureId: fixture.fixtureId,
    roleId: fixture.role.roleId,
    sourceCutoffChapterId: fixture.sourceCutoffChapterId,
    renderedWorkingSet,
    renderedWriterWorkingSet,
    includedEvidenceClaimIds: includedClaims.map((claim) => claim.claimId),
    excludedEvidenceClaimIds,
    allowedReferences: {
      evidenceClaimIds: allowedEvidenceClaimIds,
      runtimeFactIds: visibleFacts.map((fact) => fact.factId),
      cardIds: visibleCards.map((card) => card.cardId),
      entityRefs: fixture.availableTargets.map((target) => target.id)
    },
    serverGrounding,
    narrativeBudget,
    causalTurn,
    minimalCanonEntryIds: minimalCanon.map((entry) => entry.entryId),
    forbiddenDisclosures: fixture.forbiddenDisclosures,
    auditItems,
    tokenEstimate: writerTokenEstimate,
    playerActionLast: renderedWriterWorkingSet.endsWith(`【PLAYER_ACTION】\n${fixture.playerIntent.userFacingText}`),
    soloTakeoverEligible: false
  };
}

function renderWriterWorkingSet(
  fixture: ShadowRuntimeFixture,
  writerPlan: ShadowWriterPlan,
  narrativeBudget: ShadowNarrativeBudget,
  minimalCanon: ShadowRuntimeFixture["recentCanon"],
  visibleFacts: WorldBibleRuntimeFact[],
  visibleCards: WorldBibleContextCard[],
  causalTurn: CompiledCausalTurn
): string {
  const decisionSeeds: Array<{
    actionClass: ShadowDecisionClass;
    targetRefs: string[];
    situation: string;
    wordingFrame?: string;
  }> = writerPlan.decisionEntrances?.length
    ? writerPlan.decisionEntrances
    : causalTurn.decisionAffordances.map((affordance) => ({
      actionClass: affordance.actionClass,
      targetRefs: [affordance.targetRef],
      situation: entityLabel(fixture, affordance.targetRef)
    }));
  const decisionAffordances = decisionSeeds.map((affordance, index) => [
    `${index + 1}. ${decisionClassLabel(affordance.actionClass)}`,
    `对象：${affordance.targetRefs.map((ref) => entityLabel(fixture, ref)).join("、")}`,
    `当前局面：${stripClosingPunctuation(affordance.situation)}`,
    ...("wordingFrame" in affordance && affordance.wordingFrame
      ? [`措辞骨架：${stripClosingPunctuation(affordance.wordingFrame)}`]
      : [])
  ].join("｜"));
  const reaction = causalTurn.npcReactionEnvelopes[0];
  const npcAgenda = reaction ? [
    `人物：${entityLabel(fixture, reaction.npcRef)}`,
    `公开立场：${writerPlan.npcAgenda.publicPosition}`,
    `当前目标：${joinClauses(reaction.activeGoals.map((goal) => goal.goal))}`,
    `可用筹码：${joinClauses(reaction.usableLeverageRefs.map((ref) => entityLabel(fixture, ref)))}`,
    `可采取方式：${reaction.allowedTactics.map(tacticLabel).join("；")}`
  ] : [
    `公开立场：${writerPlan.npcAgenda.publicPosition}`,
    `当前目标：${writerPlan.npcAgenda.immediateGoal}`,
    `可用筹码：${writerPlan.npcAgenda.leverage.join("；")}`
  ];
  const availableRefs = [
    `人物：${fixture.scene.presentCharacterIds.map((id) => entityLabel(fixture, id)).join("、")}`,
    `物件：${fixture.decisionAccess.availableObjectRefs.map((id) => entityLabel(fixture, id)).join("、")}`,
    ...(fixture.decisionAccess.reachableInstitutionRefs.length
      ? [`机构：${fixture.decisionAccess.reachableInstitutionRefs.map((id) => entityLabel(fixture, id)).join("、")}`]
      : [])
  ];
  const forcedProgression = causalTurn.stagnationReports.find((report) => report.shouldForceProgression);
  const writerCanon = writerPlan.recentCanonBridge?.length
    ? writerPlan.recentCanonBridge
    : minimalCanon.map((entry) => entry.narrative);
  const sections: Array<[string, string[]]> = [
    ["RECENT_CANON", writerCanon.map((item) => `- ${item}`)],
    ["CURRENT_SCENE", [
      `${fixture.scene.timeLabel} · ${fixture.scene.locationLabel}`,
      writerPlan.sceneStart,
      `在场：${fixture.scene.presentCharacterIds.map((id) => entityLabel(fixture, id)).join("、")}`,
      `当前关系：${joinClauses(writerPlan.visibleRelationships || fixture.scene.visibleRelationships)}`
    ]],
    ["PLAYER_ROLE", [
      fixture.role.identity,
      `目标：${fixture.role.goal}`,
      `权限：${fixture.role.permissions.join("；")}`
    ]],
    ["BACKGROUND", [
      ...visibleFacts.map((fact) => `- ${fact.content}`),
      ...visibleCards.map((card) => `- ${card.summary}`)
    ]],
    ["ACTION_ALREADY_OCCURRED", (writerPlan.actionAlreadyOccurred || fixture.actionBoundary.alreadyOccurred).map((item) => `- ${item}`)],
    ["CONFIRMED_EFFECTS", writerPlan.confirmedFacts.map((item) => `- ${item}`)],
    ["UNRESOLVED", writerPlan.unresolvedFacts.map((item) => `- ${item}`)],
    ["NPC_AGENDA", npcAgenda],
    ["DRAMATIC_TASK", [writerPlan.dramaticTask]],
    ...(writerPlan.sceneBlocking?.length
      ? [["SCENE_BLOCKING", writerPlan.sceneBlocking.map((item) => `- ${item}`)] as [string, string[]]]
      : []),
    ...(writerPlan.sceneBeats?.length
      ? [["SCENE_BEATS", writerPlan.sceneBeats.map((item, index) => `${index + 1}. ${item}`)] as [string, string[]]]
      : []),
    ["REQUIRED_END_CHANGE", [writerPlan.requiredEndChange]],
    ["NARRATIVE_CEILING", [writerPlan.narrativeCeiling]],
    ...(forcedProgression ? [["PROGRESSION_REQUIREMENT", [forcedProgression.reason || "必须推进既有压力。"]] as [string, string[]]] : []),
    ["AVAILABLE_REFS", availableRefs],
    ["DECISION_AFFORDANCES", decisionAffordances.length ? decisionAffordances : ["- 从正文末态中生成三个立即可执行且彼此不同的行动。"]],
    ["NARRATIVE_BUDGET", [
      `正文：建议 420—500 个中文字符，硬范围 ${narrativeBudget.minChars}—${narrativeBudget.maxChars} 个中文字符`,
      `段落：${narrativeBudget.minParagraphs}—${narrativeBudget.maxParagraphs} 个自然段`
    ]],
    ["PLAYER_ACTION", [fixture.playerIntent.userFacingText]]
  ];
  return sections.map(([label, lines]) => `【${label}】\n${lines.join("\n")}`).join("\n\n");
}

function decisionClassLabel(value: ShadowDecisionClass): string {
  switch (value) {
    case "authority": return "行政处置";
    case "responsibility": return "责任承担";
    case "evidence_control": return "记录与证据处理";
    case "scope_change": return "范围调整";
    case "secrecy": return "保密处置";
    case "negotiation": return "条件协商";
    default: return "行动入口";
  }
}

function tacticLabel(value: string): string {
  switch (value) {
    case "CONDITIONAL_COMPLIANCE": return "附条件配合";
    case "RESPONSIBILITY_SHIFT": return "转移或分担责任";
    case "NEGOTIATION": return "协商条件";
    default: return value;
  }
}

function joinClauses(values: string[]): string {
  return values.map(stripClosingPunctuation).filter(Boolean).join("；");
}

function stripClosingPunctuation(value: string): string {
  return value.trim().replace(/[。；，、]+$/u, "");
}

function resolveWriterPlan(fixture: ShadowRuntimeFixture): ShadowWriterPlan {
  if (fixture.writerPlan) return fixture.writerPlan;
  const npc = Object.values(fixture.npcActionPolicies)[0];
  return {
    sceneStart: fixture.scene.situation,
    confirmedFacts: fixture.actionResolution.confirmedEffects,
    unresolvedFacts: fixture.actionResolution.unresolvedEffects,
    semanticFactBoundary: [
      "未确认事项只能保持未知，不能写成已经发生或已经查明。",
      fixture.narrativeFrame.endingBoundary
    ],
    npcAgenda: {
      publicPosition: npc?.publicPosition || "NPC 必须根据当前身份作出真实回应。",
      immediateGoal: npc?.immediateGoal || fixture.scene.mainlineQuestion,
      leverage: npc?.leverage || []
    },
    dramaticTask: fixture.narrativeFrame.storyIntent,
    requiredEndChange: fixture.narrativeBoundary.turnEndsWhen,
    narrativeCeiling: fixture.narrativeFrame.endingBoundary,
    relevantRuntimeFactIds: [],
    relevantCardIds: []
  };
}

function resolveNarrativeBudget(fixture: ShadowRuntimeFixture): ShadowNarrativeBudget {
  return fixture.narrativeBudget || {
    kind: "standard_scene",
    minChars: 450,
    maxChars: 750,
    minParagraphs: 3,
    maxParagraphs: 5
  };
}

function compileMinimalCanonTail(entries: ShadowRuntimeFixture["recentCanon"]): ShadowRuntimeFixture["recentCanon"] {
  const latest = [...entries].sort((left, right) => left.chronologicalOrder - right.chronologicalOrder).at(-1);
  if (!latest) return [];
  const paragraphs = latest.narrative.split(/\n\s*\n/u).map((item) => item.trim()).filter(Boolean);
  const effective = paragraphs.at(-1) || "";
  const quoteStarts = [...effective.matchAll(/“/gu)].map((match) => match.index || 0);
  let narrative = effective;
  if (quoteStarts.length > 1) {
    const prefix = effective.slice(0, quoteStarts.at(-1)!);
    const speakerStart = Math.max(prefix.lastIndexOf("巡抚"), prefix.lastIndexOf("书记"), prefix.lastIndexOf("总督"));
    if (speakerStart >= 0) narrative = effective.slice(speakerStart);
  }
  return narrative ? [{ ...latest, narrative }] : [];
}

function selectByIds<T>(items: T[], ids: string[], idOf: (item: T) => string, errorCode: string): T[] {
  if (!ids.length) return items;
  const byId = new Map(items.map((item) => [idOf(item), item]));
  return ids.map((id) => {
    const value = byId.get(id);
    if (!value) throw new Error(`${errorCode}: ${id}`);
    return value;
  });
}

function entityLabel(fixture: ShadowRuntimeFixture, id: string): string {
  if (id === fixture.role.characterId || id === fixture.role.roleId) return fixture.role.roleName;
  const pressure = fixture.activePressures.find((item) => item.pressureId === id);
  if (pressure) return pressure.summary;
  return fixture.availableTargets.find((target) => target.id === id)?.label || id;
}

function estimateTokens(value: string): number {
  return Math.max(8, Math.ceil(value.length / 2));
}

function fitSectionsToBudget(
  sections: Array<{ id: string; priority: Priority; lines: string[]; preserved: boolean }>,
  maxTokenEstimate: number
): { includedIds: Set<string>; tokenEstimate: number } {
  const includedIds = new Set(sections.map((section) => section.id));
  const estimates = new Map(sections.map((section) => [section.id, estimateTokens(section.lines.join("\n"))]));
  let tokenEstimate = [...estimates.values()].reduce((sum, value) => sum + value, 0);
  const rank: Record<Priority, number> = { P3: 0, P2: 1, P1: 2, P0: 3 };
  const optional = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => !section.preserved)
    .sort((left, right) => rank[left.section.priority] - rank[right.section.priority] || left.index - right.index);

  for (const { section } of optional) {
    if (tokenEstimate <= maxTokenEstimate) break;
    includedIds.delete(section.id);
    tokenEstimate -= estimates.get(section.id) || 0;
  }
  if (tokenEstimate > maxTokenEstimate) {
    throw new Error(`P0_CONTEXT_BUDGET_EXCEEDED: required shadow packet ${tokenEstimate} > ${maxTokenEstimate}; refusing to trim critical continuity`);
  }
  return { includedIds, tokenEstimate };
}
