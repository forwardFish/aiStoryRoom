import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type ActorTurn, type StoryRole } from "@prisma/client";
import { getGameDefinition } from "@ai-story/templates";
import { PrismaService } from "../prisma.service";
import { assetDisplayName } from "./asset-language";
import type { PlannedIntentAction } from "./player-intent";
import type { StorySituationInput } from "./story-content";
import {
  compileStoryContextV2,
  type CompileStoryContextResultV2,
  type StoryContextSourceTypeV2,
  type StoryContextSourceV2,
  type StoryContextVisibilityV2
} from "./story-context";

export type PersistedStoryContextV2 = {
  recordId: string;
  compilation: CompileStoryContextResultV2;
};

@Injectable()
export class StoryContextComposerV2 {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async compileForOpening(input: {
    run: {
      id: string;
      templateKey: string;
      engineVersion: string;
      strategyVersion: string;
      worldSequence: number;
    };
    role: StoryRole;
    turn: ActorTurn;
    controlEpoch: number;
    situation: StorySituationInput;
    maxTokenEstimate?: number;
  }): Promise<PersistedStoryContextV2> {
    const [facts, assets, relations, threads, mind, allRoles] = await Promise.all([
      this.prisma.canonFact.findMany({ where: { runId: input.run.id, status: "confirmed" }, orderBy: { createdAt: "asc" } }),
      this.prisma.roleAsset.findMany({
        where: { runId: input.run.id, status: "ACTIVE", OR: [{ ownerRoleId: input.role.id }, { visibility: { in: ["PUBLIC", "OBSERVABLE"] } }] },
        orderBy: { assetKey: "asc" }
      }),
      this.prisma.roleRelation.findMany({
        where: { runId: input.run.id, OR: [{ fromRoleId: input.role.id }, { toRoleId: input.role.id }] },
        include: { fromRole: true, toRole: true },
        orderBy: { updatedAt: "asc" }
      }),
      this.prisma.storyThread.findMany({ where: { runId: input.run.id, status: "active" }, orderBy: { updatedAt: "asc" } }),
      this.prisma.characterMind.findUnique({ where: { roleId: input.role.id } }),
      this.prisma.storyRole.findMany({ where: { runId: input.run.id }, orderBy: { createdAt: "asc" } })
    ]);
    const game = getGameDefinition(input.run.templateKey);
    const sequence = input.run.worldSequence;
    const own = [input.role.id];
    const cannotDo = stringList(input.role.cannotDoJson);
    const knownInfo = uniqueStrings([...stringList(input.role.knownInfoJson), ...stringList(mind?.knowledgeBoundaryJson)]);
    const sources: StoryContextSourceV2[] = [
      contextSource("role-identity", "ROLE_IDENTITY", "你的公开身份", `${input.role.roleName}，${input.role.identity}。${input.role.publicInfo}`, "P0", true, "PRIVATE", own, sequence),
      contextSource("role-authority", "ROLE_AUTHORITY", "你此刻能够动用的权限", input.role.abilityText || "只能使用该角色在当前时代和制度中真实拥有的权限。", "P0", true, "PRIVATE", own, sequence),
      contextSource(
        "knowledge-boundary",
        "KNOWLEDGE_BOUNDARY",
        "你的私人目标、已知内容与边界",
        [`私人目标：${input.role.personalGoal}`, input.role.hiddenSecret ? `只有你知道：${input.role.hiddenSecret}` : null, `已知：${knownInfo.join("；") || "只知道已经收到和亲眼确认的内容"}`, `不能做：${cannotDo.join("；") || "不得越过角色权限和他人自主决定"}`].filter(Boolean).join("\n"),
        "P0",
        true,
        "PRIVATE",
        own,
        sequence
      ),
      contextSource(
        "world-bible",
        "WORLD_BIBLE",
        "时代、制度与地理边界",
        `${game.catalog.title}。${game.catalog.description} 当前主要地点是${game.presentation.locationLabel}。一切行动必须使用当时真实存在的官署、公文、驿递、人证、物证与交通手段。`,
        "P0",
        true,
        "PUBLIC",
        [],
        sequence
      ),
      contextSource(
        "current-scene",
        "CURRENT_SCENE",
        `第${input.turn.stageIndex}阶段《${input.situation.stage.title}》的开场时刻`,
        `地点：${input.situation.locationLabel}。当前角色：${input.role.roleName}。这是故事尚未开始的真实开场位置；具体的人物、物件、矛盾和期限以 ACTIVE_PRESSURE 为准。Writer 必须从这个位置写人物正在经历的场景，不能照抄阶段规则或后台摘要。`,
        "P0",
        true,
        "PRIVATE",
        own,
        sequence
      ),
      contextSource(
        "active-pressure",
        "ACTIVE_PRESSURE",
        "开场就必须落到人物身上的压力",
        `${input.situation.roleStage.privateBrief}\n${input.situation.roleStage.personalPressure}`,
        "P0",
        true,
        "PRIVATE",
        own,
        sequence
      )
    ];
    for (const fact of facts) {
      sources.push(contextSource(`fact:${fact.id}`, "VISIBLE_FACT", "开场前已经确认的事实", fact.content, "P1", false, normalizeVisibility(fact.visibility), stringList(fact.knownByRoleIdsJson), sequence));
    }
    for (const asset of assets) {
      sources.push(contextSource(`asset:${asset.id}`, "ASSET_OR_EVIDENCE", assetDisplayName(asset.assetKey), `${assetDisplayName(asset.assetKey)}，数量${asset.quantity}，状态${asset.status}。`, "P1", false, normalizeVisibility(asset.visibility), asset.ownerRoleId ? [asset.ownerRoleId] : [], sequence));
    }
    for (const relation of relations) {
      const other = relation.fromRoleId === input.role.id ? relation.toRole : relation.fromRole;
      sources.push(contextSource(`relation:${relation.id}`, "RELATIONSHIP", `与${other.roleName}的既有关系`, relation.publicNote || `${relation.relationType}，关系强度${relation.score}`, "P1", false, "LIMITED", [relation.fromRoleId, relation.toRoleId], sequence));
    }
    for (const thread of threads) {
      sources.push(contextSource(`thread:${thread.id}`, "OPEN_THREAD", thread.title, `${thread.title}仍未解决，当前紧张度${thread.tension}。`, "P2", false, "PUBLIC", [], sequence));
    }
    sources.push(contextSource(
      "action-affordance",
      "ACTION_AFFORDANCE",
      "此刻本人可真实采取行动的对象和能力，不是固定选项",
      [
        `本人权限：${input.role.abilityText || "使用当前身份的制度权限"}`,
        `同一世界中的角色：${allRoles.filter((role) => role.id !== input.role.id).map((role) => `${role.roleName}[${role.id}]`).join("、")}`,
        ...assets.map((asset) => `持有${assetDisplayName(asset.assetKey)}（数量${asset.quantity}）`)
      ].join("\n"),
      "P1",
      false,
      "PRIVATE",
      own,
      sequence
    ));
    sources.push(contextSource("arc-guidance", "ARC_GUIDANCE", "角色弧线只规定张力方向", `${input.role.arcText || input.situation.stage.commonContest.title}，不得把它写成固定结局。`, "P2", false, "PRIVATE", own, sequence));

    const compilation = compileStoryContextV2({
      identity: {
        runId: input.run.id,
        templateKey: input.run.templateKey,
        engineVersion: input.run.engineVersion,
        roleId: input.role.id,
        actorTurnId: input.turn.id,
        macroStageKey: input.situation.stage.stageKey,
        worldSequence: input.run.worldSequence,
        turnRevision: input.turn.revision,
        controlEpoch: input.controlEpoch
      },
      purpose: "OPENING",
      audience: {
        roleName: input.role.roleName,
        publicIdentity: input.role.identity,
        authority: [input.role.abilityText || "使用当前身份真实拥有的权限"],
        cannotDo,
        privateGoal: input.role.personalGoal,
        knowledgeBoundary: knownInfo
      },
      sources,
      maxTokenEstimate: normalizeBudget(input.maxTokenEstimate ?? Number(process.env.STORY_CONTEXT_MAX_TOKENS || 12_000))
    });
    const record = await this.prisma.storyContextSnapshotV2.create({
      data: {
        runId: input.run.id,
        roleId: input.role.id,
        actorTurnId: input.turn.id,
        purpose: "OPENING",
        baseWorldSequence: input.run.worldSequence,
        turnRevision: input.turn.revision,
        controlEpoch: input.controlEpoch,
        contextVersion: "story-context-v2.1",
        snapshotJson: compilation.ok ? compilation.snapshot as unknown as Prisma.InputJsonValue : Prisma.DbNull,
        reportJson: compilation.report as unknown as Prisma.InputJsonValue,
        snapshotHash: compilation.ok ? compilation.snapshot.identity.snapshotHash : null,
        status: compilation.ok ? "READY" : "REJECTED"
      }
    });
    return { recordId: record.id, compilation };
  }

  async compileForResolution(input: {
    run: {
      id: string;
      templateKey: string;
      engineVersion: string;
      strategyVersion: string;
      worldSequence: number;
    };
    role: StoryRole;
    turn: ActorTurn;
    controlEpoch: number;
    situation: StorySituationInput;
    purpose?: "RESULT" | "IMPACT" | "AGENT_DECISION";
    action?: PlannedIntentAction;
    confirmedResolution?: string;
    maxTokenEstimate?: number;
  }): Promise<PersistedStoryContextV2> {
    const [narratives, facts, commitments, conditions, interactions, assets, relations, threads, mind, allRoles] = await Promise.all([
      this.prisma.narrativeEntry.findMany({
        where: {
          runId: input.run.id,
          OR: [
            { roleId: input.role.id },
            { visibility: { in: ["PUBLIC", "public", "OBSERVABLE", "observable"] } }
          ]
        },
        orderBy: [{ worldSequence: "desc" }, { createdAt: "desc" }],
        // The current turn already carries the authoritative latest situation.
        // Keep only the nearest result beside it; replaying the entire visible
        // timeline makes every Solo turn slower and lets stale scenes compete
        // with the exact moment the player is acting from.
        take: 2
      }),
      this.prisma.canonFact.findMany({ where: { runId: input.run.id, status: "confirmed" }, orderBy: { createdAt: "asc" } }),
      this.prisma.commitmentV2.findMany({
        where: { runId: input.run.id, status: "ACTIVE", OR: [{ issuerRoleId: input.role.id }, { receiverRoleId: input.role.id }, { visibility: { in: ["PUBLIC", "OBSERVABLE"] } }] },
        include: { issuerRole: true, receiverRole: true },
        orderBy: { createdAt: "asc" }
      }),
      this.prisma.conditionalActionV2.findMany({
        where: { runId: input.run.id, ownerThreadId: input.turn.threadId, status: "ARMED" },
        orderBy: { createdAt: "asc" }
      }),
      this.prisma.interactionRequestV2.findMany({
        where: { runId: input.run.id, status: "OPEN", OR: [{ sourceRoleId: input.role.id }, { targetRoleId: input.role.id }] },
        include: { sourceRole: true, targetRole: true },
        orderBy: { createdAt: "asc" }
      }),
      this.prisma.roleAsset.findMany({
        where: { runId: input.run.id, status: "ACTIVE", OR: [{ ownerRoleId: input.role.id }, { visibility: { in: ["PUBLIC", "OBSERVABLE"] } }] },
        orderBy: { assetKey: "asc" }
      }),
      this.prisma.roleRelation.findMany({
        where: { runId: input.run.id, OR: [{ fromRoleId: input.role.id }, { toRoleId: input.role.id }] },
        include: { fromRole: true, toRole: true },
        orderBy: { updatedAt: "asc" }
      }),
      this.prisma.storyThread.findMany({ where: { runId: input.run.id, status: "active" }, orderBy: { updatedAt: "asc" } }),
      this.prisma.characterMind.findUnique({ where: { roleId: input.role.id } }),
      this.prisma.storyRole.findMany({ where: { runId: input.run.id }, orderBy: { createdAt: "asc" } })
    ]);

    const game = getGameDefinition(input.run.templateKey);
    const sources: StoryContextSourceV2[] = [];
    const add = (source: StoryContextSourceV2) => sources.push(source);
    const own = [input.role.id];
    const sequence = input.run.worldSequence;

    add(contextSource("role-identity", "ROLE_IDENTITY", "你的公开身份", `${input.role.roleName}，${input.role.identity}。${input.role.publicInfo}`, "P0", true, "PRIVATE", own, sequence));
    add(contextSource("role-authority", "ROLE_AUTHORITY", "你此刻能够动用的权限", input.role.abilityText || "只能使用该角色在当前时代和制度中真实拥有的权限。", "P0", true, "PRIVATE", own, sequence));
    const cannotDo = stringList(input.role.cannotDoJson);
    const knownInfo = uniqueStrings([...stringList(input.role.knownInfoJson), ...stringList(mind?.knowledgeBoundaryJson)]);
    add(contextSource(
      "knowledge-boundary",
      "KNOWLEDGE_BOUNDARY",
      "你知道什么、不能越过什么",
      [`已知：${knownInfo.join("；") || "只知道本角色已经收到和亲眼确认的内容"}`, `不能做：${cannotDo.join("；") || "不得越过角色权限和他人自主决定"}`].join("\n"),
      "P0",
      true,
      "PRIVATE",
      own,
      sequence
    ));
    add(contextSource(
      "world-bible",
      "WORLD_BIBLE",
      "时代、制度与地理边界",
      `${game.catalog.title}，类型为${game.catalog.genre}。当前主要地点是${game.presentation.locationLabel}。消息和行动必须使用当时真实存在的官署、公文、驿递、人证、物证与交通手段，不得出现现代技术或超越身份的权限。`,
      "P2",
      false,
      "PUBLIC",
      [],
      sequence
    ));
    add(contextSource(
      "current-scene",
      "CURRENT_SCENE",
      input.turn.situationTitle,
      `当前宏观阶段：第${input.turn.stageIndex}阶段《${input.situation.stage.title}》。地点：${input.situation.locationLabel}。当前角色：${input.role.roleName}。行动前的当前场景如下：\n${input.turn.situationNarrative}`,
      "P0",
      true,
      "PRIVATE",
      own,
      sequence
    ));
    add(contextSource(
      "active-pressure",
      "ACTIVE_PRESSURE",
      "当前必须面对的压力",
      `${input.situation.roleStage.privateBrief}\n${input.situation.roleStage.personalPressure}\n共同冲突：${input.situation.stage.commonContest.description}`,
      "P0",
      true,
      "PRIVATE",
      own,
      sequence
    ));
    const purpose = input.purpose || "RESULT";
    if (purpose === "RESULT") {
      if (!input.action || !input.confirmedResolution) throw new Error("RESULT_CONTEXT_REQUIRES_ACTION_AND_RESOLUTION");
      add(contextSource(
        "player-intent",
        "PLAYER_INTENT",
        "玩家不可擅改的真实行动",
        [
          `目标：${input.action.normalizedIntent.objective}`,
          `对象：${input.action.normalizedIntent.target.label}`,
          `方法：${input.action.normalizedIntent.method}`,
          `明确投入：${input.action.normalizedIntent.leverageKeys.map(assetDisplayName).join("、") || "没有额外投入筹码"}`,
          `可见度：${input.action.normalizedIntent.visibility}`,
          `风险承受：${input.action.normalizedIntent.riskTolerance}`,
          input.action.normalizedIntent.fallback ? `受阻后手：${input.action.normalizedIntent.fallback.method}` : "没有另行指定受阻后手",
          input.action.normalizedIntent.condition ? `条件后手：仅在“${input.action.normalizedIntent.condition.eventType}”发生时另行结算` : "没有另行布置条件后手"
        ].join("\n"),
        "P0",
        true,
        "PRIVATE",
        own,
        sequence
      ));
      add(contextSource(
        "rule-resolution",
        "RULE_RESOLUTION",
        "已经确认、不得由 Writer 改写的结算",
        `${input.confirmedResolution}\n本次行动只能产生已经确认的事实；他人的回应、尚未核实的证据与最终成败仍然开放。`,
        "P0",
        true,
        "PRIVATE",
        own,
        sequence
      ));
    }

    const orderedNarratives = [...narratives].reverse();
    const canonContents = new Set<string>();
    for (const [index, entry] of orderedNarratives.entries()) {
      const content = entry.content.trim();
      if (!content || canonContents.has(content)) continue;
      canonContents.add(content);
      add(contextSource(
        `narrative:${entry.id}`,
        "RECENT_CANON",
        narrativeTitle(entry.entryType),
        content,
        "P1",
        false,
        normalizeVisibility(entry.visibility),
        entry.roleId ? [entry.roleId] : [],
        entry.worldSequence ?? 0,
        index
      ));
    }
    if (!canonContents.has(input.turn.situationNarrative.trim())) {
      add(contextSource(
        `turn-canon:${input.turn.id}`,
        "RECENT_CANON",
        "玩家正在阅读的完整当前局势",
        input.turn.situationNarrative,
        "P0",
        true,
        "PRIVATE",
        own,
        input.turn.baseWorldSequence,
        orderedNarratives.length + 1
      ));
    }

    for (const fact of facts) {
      add(contextSource(
        `fact:${fact.id}`,
        "VISIBLE_FACT",
        "已经确认的事实",
        fact.content,
        fact.sourceActionIdsJson && stringList(fact.sourceActionIdsJson).length ? "P1" : "P2",
        false,
        normalizeVisibility(fact.visibility),
        stringList(fact.knownByRoleIdsJson),
        sequence
      ));
    }
    for (const commitment of commitments) {
      const deadline = commitment.expiresAtStage ? `，最迟在第${commitment.expiresAtStage}阶段前处理` : "";
      add(contextSource(
        `commitment:${commitment.id}`,
        "COMMITMENT",
        `${commitment.issuerRole.roleName}对${commitment.receiverRole.roleName}的有效承诺`,
        `${commitment.content}${deadline}。当前状态：尚未履行或解除。`,
        "P0",
        true,
        normalizeVisibility(commitment.visibility),
        [commitment.issuerRoleId, commitment.receiverRoleId],
        sequence
      ));
      if (commitment.expiresAtStage) {
        add(contextSource(`commitment-deadline:${commitment.id}`, "DEADLINE", "承诺期限", `第${commitment.expiresAtStage}阶段前必须处理：${commitment.content}`, "P0", true, normalizeVisibility(commitment.visibility), [commitment.issuerRoleId, commitment.receiverRoleId], sequence));
      }
    }
    for (const condition of conditions) {
      const conditionData = asRecord(condition.rawConditionJson);
      const commandData = asRecord(condition.normalizedCommandJson);
      const fallbackIntent = asRecord(commandData.intent);
      add(contextSource(
        `condition:${condition.id}`,
        "ACTIVE_CONDITION",
        "已经布置、尚未触发的条件后手",
        `触发事件：${text(conditionData.eventType, "未具名事件")}；触发后执行：${text(fallbackIntent.method, "按原计划的后手处理")}；${condition.expiresAtStage ? `第${condition.expiresAtStage}阶段后失效` : "当前没有固定失效阶段"}。条件未发生前不得提前写成已经执行。`,
        "P0",
        true,
        "PRIVATE",
        own,
        sequence
      ));
    }
    for (const interaction of interactions) {
      const pressure = asRecord(interaction.pressureJson);
      const isTarget = interaction.targetRoleId === input.role.id;
      add(contextSource(
        `interaction:${interaction.id}`,
        "UNANSWERED_INTERACTION",
        isTarget ? `${interaction.sourceRole.roleName}正在等待你本人回应` : `你正在等待${interaction.targetRole.roleName}自行回应`,
        `要求：${text(pressure.objective, interaction.requestKind)}；方式：${text(pressure.method, "等待对方在自己的剧情中决定")}。系统不得替${interaction.targetRole.roleName}回答。`,
        "P0",
        true,
        "LIMITED",
        [interaction.sourceRoleId, interaction.targetRoleId],
        sequence
      ));
      if (interaction.expiresAt) {
        add(contextSource(`interaction-deadline:${interaction.id}`, "DEADLINE", "回应期限", `${interaction.targetRole.roleName}需要在${interaction.expiresAt.toISOString()}前自行回应；到期只触发规则处理，不得替其决定。`, "P0", true, "LIMITED", [interaction.sourceRoleId, interaction.targetRoleId], sequence));
      }
    }
    for (const asset of assets) {
      add(contextSource(
        `asset:${asset.id}`,
        "ASSET_OR_EVIDENCE",
        assetDisplayName(asset.assetKey),
        `${assetDisplayName(asset.assetKey)}，数量${asset.quantity}，当前状态${asset.status}。只有明确投入后才可以在本轮消耗或移交。`,
        "P1",
        false,
        normalizeVisibility(asset.visibility),
        asset.ownerRoleId ? [asset.ownerRoleId] : [],
        sequence
      ));
    }
    for (const relation of relations) {
      const other = relation.fromRoleId === input.role.id ? relation.toRole : relation.fromRole;
      add(contextSource(
        `relation:${relation.id}`,
        "RELATIONSHIP",
        `与${other.roleName}的当前关系`,
        `${relation.publicNote || `${relation.relationType}，当前关系强度${relation.score}`}。这只描述既有关系，不代表对方下一步会如何选择。`,
        "P1",
        false,
        "LIMITED",
        [relation.fromRoleId, relation.toRoleId],
        sequence
      ));
    }
    for (const thread of threads) {
      add(contextSource(
        `thread:${thread.id}`,
        "OPEN_THREAD",
        thread.title,
        `${thread.title}仍未解决，当前紧张度${thread.tension}${thread.deadlineNodeIndex ? `，在第${thread.deadlineNodeIndex}个节点前会继续施压` : ""}。`,
        "P2",
        false,
        "PUBLIC",
        [],
        sequence
      ));
    }
    for (const impact of input.situation.incomingImpacts) {
      add(contextSource(
        `impact:${sources.length}`,
        "INCOMING_IMPACT",
        `${impact.sourceRoleName}造成的可见影响`,
        impact.content,
        "P1",
        false,
        "PRIVATE",
        own,
        sequence
      ));
    }
    add(contextSource(
      "action-affordance",
      "ACTION_AFFORDANCE",
      "此刻本人真实能够使用的能力，不是固定选项",
      [
        input.role.abilityText || "使用角色既有权限",
        `可互动角色：${allRoles.filter((role) => role.id !== input.role.id).map((role) => `${role.roleName}[${role.id}]`).join("、")}`,
        ...assets.map((asset) => `持有${assetDisplayName(asset.assetKey)}（数量${asset.quantity}）`)
      ].join("；"),
      "P1",
      false,
      "PRIVATE",
      own,
      sequence
    ));
    add(contextSource(
      "arc-guidance",
      "ARC_GUIDANCE",
      "只用于维持张力的宏观方向",
      `${input.role.arcText || input.situation.stage.commonContest.title}。不得把这一方向写成固定结局。`,
      "P2",
      false,
      "PRIVATE",
      own,
      sequence
    ));

    const compilation = compileStoryContextV2({
      identity: {
        runId: input.run.id,
        templateKey: input.run.templateKey,
        engineVersion: input.run.engineVersion,
        roleId: input.role.id,
        actorTurnId: input.turn.id,
        macroStageKey: input.situation.stage.stageKey,
        worldSequence: input.run.worldSequence,
        turnRevision: input.turn.revision,
        controlEpoch: input.controlEpoch
      },
      purpose,
      audience: {
        roleName: input.role.roleName,
        publicIdentity: input.role.identity,
        authority: [input.role.abilityText || "使用当前身份真实拥有的权限"],
        cannotDo,
        privateGoal: input.role.personalGoal,
        knowledgeBoundary: knownInfo
      },
      sources,
      maxTokenEstimate: normalizeBudget(input.maxTokenEstimate ?? Number(process.env.STORY_CONTEXT_MAX_TOKENS || 12_000))
    });
    const record = await this.prisma.storyContextSnapshotV2.create({
      data: {
        runId: input.run.id,
        roleId: input.role.id,
        actorTurnId: input.turn.id,
        purpose,
        baseWorldSequence: input.run.worldSequence,
        turnRevision: input.turn.revision,
        controlEpoch: input.controlEpoch,
        contextVersion: "story-context-v2.1",
        snapshotJson: compilation.ok ? compilation.snapshot as unknown as Prisma.InputJsonValue : Prisma.DbNull,
        reportJson: compilation.report as unknown as Prisma.InputJsonValue,
        snapshotHash: compilation.ok ? compilation.snapshot.identity.snapshotHash : null,
        status: compilation.ok ? "READY" : "REJECTED"
      }
    });
    return { recordId: record.id, compilation };
  }
}

function contextSource(
  itemId: string,
  sourceType: StoryContextSourceTypeV2,
  title: string,
  content: string,
  priority: StoryContextSourceV2["priority"],
  mustPreserve: boolean,
  visibility: StoryContextVisibilityV2,
  knownByRoleIds: string[],
  basedOnWorldSequence: number,
  chronologicalOrder?: number
): StoryContextSourceV2 {
  return {
    itemId,
    sourceType,
    sourceId: itemId,
    title,
    content,
    priority,
    mustPreserve,
    visibility,
    knownByRoleIds: uniqueStrings(knownByRoleIds),
    basedOnWorldSequence,
    inclusionReason: `${priority} ${sourceType} is relevant to the current role-scoped story generation`,
    chronologicalOrder
  };
}

function normalizeVisibility(value: string): StoryContextVisibilityV2 {
  const normalized = String(value || "PRIVATE").toUpperCase();
  if (normalized === "PUBLIC" || normalized === "OBSERVABLE" || normalized === "LIMITED") return normalized;
  return "PRIVATE";
}

function narrativeTitle(entryType: string): string {
  if (entryType.includes("OPENING")) return "此前发生的开场故事";
  if (entryType.includes("RESULT")) return "上一项行动造成的结果";
  if (entryType.includes("IMPACT") || entryType.includes("TRACE")) return "他人行动留下的影响";
  if (entryType.includes("NEXT")) return "角色上一段完整局势";
  return "此前已经发生的故事";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry || "").trim()).filter(Boolean) : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeBudget(value: number): number {
  return Number.isFinite(value) ? Math.max(2_000, Math.min(60_000, Math.trunc(value))) : 12_000;
}
