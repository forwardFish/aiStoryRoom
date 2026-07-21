import { sha256Canonical } from "../continuous-strategy/canonical";
import type {
  ActivePressure,
  CompiledStoryContext,
  ContextCompileInput,
  ContextCompileResult,
  ContextSection,
  ContextSourceItem,
  DirectedBeat,
  PendingConsequence,
  RecentCanonEntry,
  ScriptCard,
  StoryFact,
  StoryRole,
  StoryScene
} from "./types";

export function compileSoloStoryContext(input: ContextCompileInput): ContextCompileResult {
  if (Boolean(input.playerIntent) === Boolean(input.openingTrigger)) {
    return {
      ok: false,
      code: "CANON_STATE_CONFLICT",
      issues: [{ code: "GENERATION_TRIGGER_INVALID", message: "必须且只能提供开场触发或玩家行动之一。" }],
      dropped: []
    };
  }
  const visibleFacts = filterFactsForRole(input.facts, input.role);
  const duplicateFactConflict = findDuplicateFactConflict(visibleFacts);
  if (duplicateFactConflict) {
    return {
      ok: false,
      code: "CANON_STATE_CONFLICT",
      issues: [{ code: "CANON_STATE_CONFLICT", message: `同一事实 ID 出现了两个不同版本：${duplicateFactConflict}。` }],
      dropped: []
    };
  }

  const pendingConsequences = [...input.pendingConsequences, ...input.actionResolution.pendingConsequences]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.consequenceId === item.consequenceId) === index);
  const allSections = {
    recentCanon: { items: [...input.recentCanon].sort((a, b) => a.chronologicalOrder - b.chronologicalOrder), tokenEstimate: estimateNarrativeTokens(input.recentCanon) },
    currentScene: { items: [input.scene], tokenEstimate: estimateJsonTokens([input.scene]) },
    roleKnowledge: { items: visibleFacts, tokenEstimate: estimateJsonTokens(visibleFacts) },
    relevantScriptCards: { items: input.relevantScriptCards, tokenEstimate: estimateJsonTokens(input.relevantScriptCards) },
    activePressures: { items: input.activePressures, tokenEstimate: estimateJsonTokens(input.activePressures) },
    pendingConsequences: { items: pendingConsequences, tokenEstimate: estimateJsonTokens(pendingConsequences) },
    directedBeat: { items: input.scene.directedBeat ? [input.scene.directedBeat] : [], tokenEstimate: estimateJsonTokens(input.scene.directedBeat ? [input.scene.directedBeat] : []) }
  };

  const items: ContextSourceItem[] = [
    createItem("action-resolution", "P0", "ACTION_RESOLUTION", input.actionResolution, true),
    ...allSections.pendingConsequences.items.map((item) => createItem(`pending:${item.consequenceId}`, item.priority, "PENDING_CONSEQUENCE", item, item.priority === "P0")),
    ...allSections.currentScene.items.map((item) => createItem(`scene:${item.sceneId}`, "P0", "CURRENT_SCENE", item, true)),
    ...allSections.roleKnowledge.items.map((item) => createItem(`fact:${item.factId}`, item.priority, "ROLE_KNOWLEDGE", item, item.priority === "P0")),
    ...allSections.recentCanon.items.map((item) => createItem(`canon:${item.entryId}`, "P1", "RECENT_CANON", item, false)),
    ...allSections.activePressures.items.map((item) => createItem(`pressure:${item.pressureId}`, item.priority, "ACTIVE_PRESSURES", item, item.priority === "P0")),
    ...allSections.relevantScriptCards.items.map((item) => createItem(`card:${item.cardId}`, item.priority, "RELEVANT_SCRIPT_CARDS", item, false)),
    ...allSections.directedBeat.items.map((item) => createItem(`beat:${item.beatId}`, "P1", "THIS_TURN_DIRECTED_BEAT", item, false)),
    createItem(
      input.playerIntent ? `player:${input.playerIntent.immutableIntentHash.slice(0, 16)}` : `opening:${input.openingTrigger!.triggerId}`,
      "P0",
      "PLAYER_ACTION",
      input.playerIntent || input.openingTrigger,
      true
    )
  ];

  const ordered = [...items].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  const selected: ContextSourceItem[] = [];
  const dropped: Array<{ itemId: string; reason: "ACL_FILTERED" | "BUDGET_EXHAUSTED" | "P0_BUDGET_EXHAUSTED" }> = input.facts
    .filter((fact) => !visibleFacts.includes(fact))
    .map((fact) => ({ itemId: `fact:${fact.factId}`, reason: "ACL_FILTERED" as const }));
  let used = 0;
  for (const item of ordered) {
    if (used + item.tokenEstimate <= input.maxTokenEstimate) {
      selected.push(item);
      used += item.tokenEstimate;
      continue;
    }
    if (item.mustPreserve) {
      dropped.push({ itemId: item.itemId, reason: "P0_BUDGET_EXHAUSTED" });
      return {
        ok: false,
        code: "P0_CONTEXT_BUDGET_EXCEEDED",
        issues: [{ code: "P0_CONTEXT_BUDGET_EXCEEDED", message: "P0 工作集超过预算，不能静默丢失关键上下文。" }],
        dropped
      };
    }
    dropped.push({ itemId: item.itemId, reason: "BUDGET_EXHAUSTED" });
  }

  // The actual prompt contract places Player Action (or Opening Trigger) last.
  // Keep the Context Report in the same semantic order so the audit cannot
  // claim "player action last" while recording a different order.
  const playerActionItem = selected.find((item) => item.section === "PLAYER_ACTION");
  const included = [
    ...selected.filter((item) => item.section !== "PLAYER_ACTION"),
    ...(playerActionItem ? [playerActionItem] : [])
  ];
  const includedIds = new Set(included.map((item) => item.itemId));
  const sections = {
    recentCanon: filterSection(allSections.recentCanon, (item) => includedIds.has(`canon:${item.entryId}`)),
    currentScene: filterSection(allSections.currentScene, (item) => includedIds.has(`scene:${item.sceneId}`)),
    roleKnowledge: filterSection(allSections.roleKnowledge, (item) => includedIds.has(`fact:${item.factId}`)),
    relevantScriptCards: filterSection(allSections.relevantScriptCards, (item) => includedIds.has(`card:${item.cardId}`)),
    activePressures: filterSection(allSections.activePressures, (item) => includedIds.has(`pressure:${item.pressureId}`)),
    pendingConsequences: filterSection(allSections.pendingConsequences, (item) => includedIds.has(`pending:${item.consequenceId}`)),
    directedBeat: filterSection(allSections.directedBeat, (item) => includedIds.has(`beat:${item.beatId}`))
  };

  const allowedReferences = {
    // Suggested decisions may cite compiled context or a concrete target
    // explicitly available in the current scene. Both sets are present in
    // the prompt, so both must be valid grounding references.
    groundingIds: unique([
      ...included.map((item) => item.itemId),
      ...input.availableTargets.map((target) => target.id)
    ]),
    scriptSourceIds: unique(sections.relevantScriptCards.items.flatMap((card) => card.groundedFactIds)),
    storyCardIds: sections.relevantScriptCards.items.map((card) => card.cardId),
    canonFactIds: sections.roleKnowledge.items.map((fact) => fact.factId),
    mainlineQuestionIds: [...input.scene.mainlineQuestionIds],
    entityRefs: input.availableTargets.map((target) => target.id),
    assetKeys: [...input.role.heldLeverageKeys],
    pendingConsequenceIds: sections.pendingConsequences.items.map((item) => item.consequenceId),
    directedBeatIds: sections.directedBeat.items.map((item) => item.beatId)
  };

  const renderedWorkingSet = renderWorkingSet({
    role: input.role,
    scene: input.scene,
    recentCanon: sections.recentCanon.items,
    visibleFacts: sections.roleKnowledge.items,
    scriptCards: sections.relevantScriptCards.items,
    activePressures: sections.activePressures.items,
    pendingConsequences: sections.pendingConsequences.items,
    directedBeat: sections.directedBeat.items,
    actionResolution: input.actionResolution,
    playerAction: input.playerIntent,
    openingTrigger: input.openingTrigger || null
  });
  const context: CompiledStoryContext = {
    snapshotHash: sha256Canonical({
      roleId: input.role.roleId,
      sceneId: input.scene.sceneId,
      included: included.map((item) => ({ itemId: item.itemId, content: item.content })),
      playerIntentHash: input.playerIntent?.immutableIntentHash || null,
      openingTriggerId: input.openingTrigger?.triggerId || null
    }),
    triggerType: input.playerIntent ? "PLAYER_ACTION" : "OPENING",
    role: input.role,
    actionResolution: input.actionResolution,
    sections,
    included,
    dropped,
    allowedReferences,
    availableTargets: input.availableTargets,
    renderedWorkingSet
  };
  return { ok: true, context };
}

function findDuplicateFactConflict(facts: StoryFact[]) {
  const values = new Map<string, string>();
  for (const fact of facts) {
    const previous = values.get(fact.factId);
    if (previous !== undefined && previous !== fact.content) return fact.factId;
    values.set(fact.factId, fact.content);
  }
  return null;
}

function filterFactsForRole(facts: StoryFact[], role: StoryRole) {
  return facts.filter((fact) =>
    fact.visibility === "PUBLIC" ||
    fact.knownByRoleIds.includes(role.roleId) ||
    role.knownFactIds.includes(fact.factId)
  );
}

function createItem(
  itemId: string,
  priority: ContextSourceItem["priority"],
  section: ContextSourceItem["section"],
  content: unknown,
  mustPreserve: boolean
): ContextSourceItem {
  return {
    itemId,
    priority,
    section,
    content,
    mustPreserve,
    tokenEstimate: estimateJsonTokens(content)
  };
}

function priorityRank(priority: ContextSourceItem["priority"]) {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[priority];
}

function estimateJsonTokens(value: unknown) {
  return Math.max(8, Math.ceil(JSON.stringify(value).length / 3.5));
}

function estimateNarrativeTokens(entries: RecentCanonEntry[]) {
  return Math.max(8, Math.ceil(entries.map((item) => item.narrative.length).reduce((left, right) => left + right, 0) / 2));
}

function filterSection<T>(section: ContextSection<T>, predicate: (item: T) => boolean): ContextSection<T> {
  const items = section.items.filter(predicate);
  return { items, tokenEstimate: estimateJsonTokens(items) };
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function renderWorkingSet(input: {
  role: StoryRole;
  scene: StoryScene;
  recentCanon: RecentCanonEntry[];
  visibleFacts: StoryFact[];
  scriptCards: ScriptCard[];
  activePressures: ActivePressure[];
  pendingConsequences: PendingConsequence[];
  directedBeat: DirectedBeat[];
  actionResolution: unknown;
  playerAction: { userFacingText: string } | null;
  openingTrigger: { triggerId: string; summary: string } | null;
}) {
  const chunks = [
    `【角色】${input.role.roleName}：${input.role.identity}。目标：${input.role.goal}`,
    `【当前场景】${input.scene.timeLabel}，${input.scene.locationLabel}。${input.scene.situation}`,
    `【Mainline】${input.scene.mainlineQuestion}`,
    `【Recent Canon】\n${input.recentCanon.map((item) => item.narrative).join("\n\n")}`,
    `【角色已知事实】\n${input.visibleFacts.map((item) => `- ${item.content}`).join("\n")}`,
    `【相关剧本卡】\n${input.scriptCards.map((item) => `- ${item.title}：${item.summary}`).join("\n")}`,
    `【当前压力】\n${input.activePressures.map((item) => `- ${item.summary}`).join("\n")}`,
    `【待兑现后果】\n${input.pendingConsequences.map((item) => `- ${item.summary}`).join("\n")}`,
    input.directedBeat.length ? `【本轮外部推进】\n${input.directedBeat.map((item) => `- ${item.summary}`).join("\n")}` : "【本轮外部推进】无",
    `【本地裁决】${JSON.stringify(input.actionResolution)}`,
    input.playerAction
      ? `【玩家行动】${input.playerAction.userFacingText}`
      : `【开场触发】${input.openingTrigger?.summary || "故事从当前场景开始，浙江总督尚未作出决定。"}`
  ];
  return chunks.join("\n\n");
}
