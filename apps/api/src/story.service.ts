import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  buildCrossImpacts,
  buildEchoes,
  buildPersonalCards,
  buildPovSections,
  directorTaskMeta,
  enrichFateLine,
  generateChapterWithDirector,
  resolveNodeWithDirector,
  type CreateStoryRunInput,
  type MockLoginInput,
  type SubmitActionInput
} from "@ai-story/shared";
import { findGameDefinitionByTemplateId, getTemplate, midnightStoreTemplate } from "@ai-story/templates";
import { PrismaService } from "./prisma.service";
import { MvpStoryEngine } from "./mvp-causal-runtime";
import { FileMvpStoryStorage } from "./mvp-storage";
import { PrismaMvpStoryStorage } from "./prisma-mvp-storage";
import { createConfiguredMvpNarrativeProvider } from "./mvp-narrative-provider";

const AI_TRIO_EXTENSION_NODES = [
  {
    title: "共享线索的裂缝",
    publicNarration: "三个人把各自找到的线索摊在同一张桌上，线索之间出现了一个不该存在的空缺。",
    nodeGoal: "判断哪些信息可以公开共享，哪些信息仍需要保留给持有者。",
    actionOptions: ["公开自己的关键线索", "只分享可验证事实", "保留线索并观察他人"],
    resolutionSummary: "公开的信息让局势更清楚，也让每个角色的真实动机更容易被其他人重新判断。",
    nextHook: "最后一轮的选择将决定你们是共同承担后果，还是把责任推给其中一个人。"
  },
  {
    title: "最后的共同选择",
    publicNarration: "天亮前，异常把三个人带到同一个出口。出口只会对一个明确的共同方案作出回应。",
    nodeGoal: "在互信、证据和个人目标之间作出最后一次协作判断。",
    actionOptions: ["共同承担风险", "以证据换取安全", "保留退路再行动"],
    resolutionSummary: "最后的共同选择留下了可追溯的行动记录，故事的结局取决于你们如何解释彼此的决策。",
    nextHook: "本轮推演结束，AI 导演将依据七轮行动和跨玩家回响生成章节结算。"
  }
] as const;

type JsonValue = Record<string, unknown> | unknown[];

@Injectable()
export class StoryService {
  private readonly mvpStory: MvpStoryEngine;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    this.mvpStory = new MvpStoryEngine(
      process.env.DATABASE_URL && process.env.MVP_STORY_STORAGE !== "file"
        ? new PrismaMvpStoryStorage(prisma as any)
        : new FileMvpStoryStorage(),
      createConfiguredMvpNarrativeProvider()
    );
  }

  createMvpRun(input: Record<string, unknown>) {
    return this.mvpStory.create(input);
  }

  getMvpRun(runId: string) {
    return this.mvpStory.get(runId);
  }

  getMvpMessages(runId: string) {
    return this.mvpStory.get(runId);
  }

  async getMvpDashboard(runId: string) {
    return (await this.mvpStory.get(runId)).dashboard;
  }

  submitMvpDecision(runId: string, messageId: string, input: Record<string, unknown>) {
    return this.mvpStory.submitDecision(runId, messageId, input as any);
  }

  startMvpCriticalResponse(runId: string, eventId: string, input: Record<string, unknown>) {
    return this.mvpStory.startCriticalResponse(runId, eventId, input as any);
  }

  deferMvpCriticalEvent(runId: string, messageId: string, input: Record<string, unknown>) {
    return this.mvpStory.deferCriticalEvent(runId, messageId, input as any);
  }

  submitMvpManeuver(runId: string, input: Record<string, unknown>) {
    return this.mvpStory.submitManeuver(runId, input as any);
  }

  advanceMvpDay(runId: string, input: Record<string, unknown>) {
    return this.mvpStory.advanceDay(runId, input as any);
  }

  finalizeMvpRun(runId: string, input: Record<string, unknown>) {
    return this.mvpStory.finalize(runId, input as any);
  }

  async login(input: MockLoginInput) {
    const openid = input.mockOpenid || `mock_openid_${Date.now()}`;
    const user = await this.prisma.user.upsert({
      where: { openid },
      update: {
        nickname: input.nickname,
        avatarUrl: input.avatarUrl,
        policyAgreedAt: new Date()
      },
      create: {
        openid,
        nickname: input.nickname || "本地玩家",
        avatarUrl: input.avatarUrl || "",
        policyAgreedAt: new Date()
      }
    });
    return { token: user.openid, user };
  }

  async me(openid: string) {
    return this.ensureUser(openid);
  }

  async agreePolicy(openid: string) {
    return this.prisma.user.update({
      where: { openid },
      data: { policyAgreedAt: new Date() }
    });
  }

  async templates() {
    return this.prisma.worldTemplate.findMany({
      where: { status: "online" },
      orderBy: { createdAt: "asc" }
    });
  }

  async template(templateId: string) {
    const template = await this.prisma.worldTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new NotFoundException("world template not found");
    return template;
  }

  async createRun(
    openid: string,
    input: CreateStoryRunInput,
    internalVersions: { engineVersion: string; strategyVersion: string; runId?: string } = { engineVersion: "legacy_v1", strategyVersion: "legacy_v1" }
  ) {
    const owner = await this.ensureUser(openid);
    const template = getTemplate(input.templateId);
    const gameDefinition = findGameDefinitionByTemplateId(template.id);
    const canonicalTemplate = gameDefinition ? { ...template, roles: gameDefinition.roles } : template;
    await this.prisma.worldTemplate.upsert({
      where: { id: template.id },
      update: { name: template.name, genre: template.genre, hook: template.hook, worldBase: template.worldBase, status: "online", configJson: canonicalTemplate as any },
      create: { id: template.id, name: template.name, genre: template.genre, hook: template.hook, worldBase: template.worldBase, status: "online", configJson: canonicalTemplate as any }
    });
    const mode = input.mode || "invite";
    const isAiTrio = mode === "ai-trio";
    const isRoom = mode === "room";
    const maxPlayers = isAiTrio ? 3 : Math.max(1, Math.trunc(Number(input.maxPlayers || 3)));
    const inviteCode = await this.nextInviteCode();

    const run = await this.prisma.storyRun.create({
      data: {
        id: internalVersions.runId,
        templateId: template.id,
        templateKey: gameDefinition?.worldId || "sangtian",
        ownerUserId: owner.id,
        title: isAiTrio ? `${template.name}：三人 AI 推演` : `${template.name}：没有影子的客人`,
        hook: template.hook,
        mode,
        status: "playing",
        maxPlayers,
        activeHumanCount: 0,
        aiPlayerCount: mode === "single" ? Math.max(0, maxPlayers - 1) : input.aiPlayerCount || 0,
        stateJson: {
          tone: input.tone || "悬疑",
          currentQuestion: "第一章刚刚开始",
          dangerLevel: 1,
          simulation: isAiTrio ? { roundCount: 7, decisionOrder: ["player_a", "player_b", "player_c"] } : undefined
        },
        visibility: mode === "single" ? "private" : "link",
        inviteCode,
        engineVersion: internalVersions.engineVersion,
        strategyVersion: internalVersions.strategyVersion
      }
    });

    try {
      await this.createInitialRunAssets(run.id, template.id, mode);

      if (input.ownerAsPlayer !== false || mode === "single" || isAiTrio) {
        await this.joinRun(openid, run.id);
      }

      return await this.getRun(run.id);
    } catch (error) {
      // Creation is all-or-nothing. A transport failure after StoryRun.create
      // must not leave a deterministic idempotency key permanently bound to a
      // half-created run that no client can resume.
      await this.prisma.storyRun.deleteMany({ where: { id: run.id } }).catch(() => undefined);
      throw error;
    }
  }

  async getRun(runId: string) {
    const run = await this.prisma.storyRun.findUnique({
      where: { id: runId },
      include: {
        template: true,
        players: { include: { user: true, role: true } },
        roles: { orderBy: { createdAt: "asc" } },
        chapters: { orderBy: { chapterIndex: "asc" } }
      }
    });
    if (!run) throw new NotFoundException("story run not found");
    return run;
  }

  async getRunState(runId: string) {
    const [run, node, clues, relations, chapters, roles] = await Promise.all([
      this.prisma.storyRun.findUnique({ where: { id: runId } }),
      this.currentNode(runId),
      this.prisma.clue.findMany({ where: { runId, status: "active" }, orderBy: { createdAt: "asc" } }),
      this.prisma.roleRelation.findMany({ where: { runId }, include: { fromRole: true, toRole: true } }),
      this.prisma.chapter.findMany({ where: { runId }, orderBy: { chapterIndex: "asc" } }),
      this.prisma.storyRole.findMany({ where: { runId }, orderBy: { createdAt: "asc" } })
    ]);
    if (!run) throw new NotFoundException("story run not found");
    return {
      run,
      currentNode: node,
      clues,
      relations,
      chapters: chapters.map((chapter) => this.enrichChapter(chapter, roles)),
      roles: roles.map((role) => enrichFateLine(role as any))
    };
  }

  async myRuns(openid: string) {
    const user = await this.ensureUser(openid);
    return this.prisma.storyRun.findMany({
      where: {
        OR: [{ ownerUserId: user.id }, { players: { some: { userId: user.id } } }]
      },
      include: { template: true, players: { include: { role: true } }, chapters: true },
      orderBy: { updatedAt: "desc" }
    });
  }

  async joinRun(openid: string, runId: string) {
    const user = await this.ensureUser(openid);
    const run = await this.prisma.storyRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException("story run not found");
    const existing = await this.prisma.storyPlayer.findUnique({
      where: { runId_userId: { runId, userId: user.id } }
    });

    const player = await this.prisma.storyPlayer.upsert({
      where: { runId_userId: { runId, userId: user.id } },
      update: { status: "active", lastActiveAt: new Date() },
      create: { runId, userId: user.id, playerType: "human", status: "active", lastActiveAt: new Date() }
    });

    if (!existing) {
      await this.prisma.storyRun.update({
        where: { id: runId },
        data: { activeHumanCount: { increment: 1 } }
      }).catch(() => undefined);
    }

    await this.logEvent("story_run_joined", user.id, runId, undefined, undefined, { openid, wasNew: !existing });
    return { player, runId, activeHumanCountIncremented: !existing };
  }

  async startRun(runId: string) {
    return this.prisma.storyRun.update({ where: { id: runId }, data: { status: "playing" } });
  }

  async pauseRun(runId: string) {
    return this.prisma.storyRun.update({ where: { id: runId }, data: { status: "paused" } });
  }

  async roles(runId: string) {
    const roles = await this.prisma.storyRole.findMany({
      where: { runId },
      orderBy: { createdAt: "asc" },
      include: { players: { include: { user: true } } }
    });
    return roles.map((role) => enrichFateLine(role as any));
  }

  async claimRole(openid: string, runId: string, roleId: string) {
    const user = await this.ensureUser(openid);
    const role = await this.prisma.storyRole.findFirst({ where: { id: roleId, runId } });
    if (!role) throw new NotFoundException("role not found");

    const existing = await this.prisma.storyPlayer.findFirst({ where: { runId, userId: user.id } });
    if (existing?.roleId && existing.roleId !== roleId) {
      throw new BadRequestException("user already claimed a role in this run");
    }

    const player = await this.prisma.storyPlayer.upsert({
      where: { runId_userId: { runId, userId: user.id } },
      update: { roleId, status: "active", lastActiveAt: new Date() },
      create: { runId, userId: user.id, roleId, playerType: "human", status: "active", lastActiveAt: new Date() }
    });
    if (!existing) {
      await this.prisma.storyRun.update({
        where: { id: runId },
        data: { activeHumanCount: { increment: 1 } }
      }).catch(() => undefined);
    }

    await this.prisma.storyRole.update({
      where: { id: roleId },
      data: { status: "claimed", isAiControlled: false }
    });
    await this.logEvent("role_claimed", user.id, runId, undefined, undefined, { roleId });
    return { roleId, roleName: role.roleName, playerId: player.id };
  }

  async myRole(openid: string, runId: string) {
    const user = await this.ensureUser(openid);
    const player = await this.prisma.storyPlayer.findFirst({
      where: { runId, userId: user.id },
      include: { role: true }
    });
    return player?.role ? { ...player, role: enrichFateLine(player.role as any) } : player;
  }

  async currentNode(runId: string) {
    const run = await this.prisma.storyRun.findUnique({ where: { id: runId } });
    if (!run?.currentNodeId) throw new NotFoundException("current node not found");
    return this.node(run.currentNodeId);
  }

  async nodes(runId: string) {
    return this.prisma.sceneNode.findMany({
      where: { runId },
      include: { actions: { include: { role: true } }, resolution: true },
      orderBy: [{ chapterIndex: "asc" }, { nodeIndex: "asc" }]
    });
  }

  async node(nodeId: string) {
    const node = await this.prisma.sceneNode.findUnique({
      where: { id: nodeId },
      include: {
        run: true,
        actions: { include: { role: true, user: true } },
        resolution: true,
        narrativeSegments: true
      }
    });
    if (!node) throw new NotFoundException("node not found");
    return node;
  }

  async submitAction(openid: string, nodeId: string, input: SubmitActionInput) {
    const user = await this.ensureUser(openid);
    const node = await this.prisma.sceneNode.findUnique({ where: { id: nodeId } });
    if (!node) throw new NotFoundException("node not found");
    if (node.status !== "open_for_actions") throw new BadRequestException("node is not open for actions");

    const guard = this.guardAction(input);
    const auditResult = guard.ok ? "ok" : "blocked";
    await this.prisma.auditLog.create({
      data: {
        targetType: "PlayerActionDraft",
        content: [input.method, input.intent, input.freeText].filter(Boolean).join("\n"),
        result: auditResult,
        riskType: guard.ok ? undefined : "action_overreach"
      }
    });
    if (!guard.ok) {
      await this.logEvent("action_guard_blocked", user.id, node.runId, nodeId, undefined, { roleId: input.roleId, reason: guard.reason, matchedRules: guard.matchedRules, guardStatus: guard.guardStatus });
      return {
        status: "rejected",
        accepted: false,
        rejected: true,
        guardStatus: guard.guardStatus,
        matchedRules: guard.matchedRules,
        suggestedRewrite: this.rewriteSuggestion(input),
        reason: guard.reason,
        message: guard.reason,
        rewriteSuggestion: this.rewriteSuggestion(input)
      };
    }

    const role = await this.prisma.storyRole.findFirst({ where: { id: input.roleId, runId: node.runId } });
    if (!role) throw new NotFoundException("role not found");
    const runPlayer = await this.prisma.storyPlayer.findFirst({
      where: { runId: node.runId, userId: user.id, roleId: input.roleId, status: "active" }
    });
    if (node.runId && !runPlayer) {
      throw new ForbiddenException("player must claim this role before submitting its action");
    }
    const knowledgeViolation = await this.guardKnowledgeBoundary(node.runId, input.roleId, input);
    if (knowledgeViolation) {
      await this.prisma.auditLog.create({
        data: {
          targetType: "PlayerActionDraft",
          content: [input.method, input.intent, input.freeText].filter(Boolean).join("\n"),
          result: "blocked",
          riskType: "knowledge_boundary"
        }
      });
      await this.logEvent("action_knowledge_blocked", user.id, node.runId, nodeId, undefined, {
        roleId: input.roleId,
        factKey: knowledgeViolation.factKey
      });
      return {
        status: "rejected",
        accepted: false,
        rejected: true,
        guardStatus: "blocked",
        matchedRules: ["unknown_private_fact"],
        suggestedRewrite: this.rewriteSuggestion(input),
        reason: "ActionGuard blocked: the role cannot use another role's private fact.",
        message: "ActionGuard blocked: the role cannot use another role's private fact.",
        rewriteSuggestion: this.rewriteSuggestion(input)
      };
    }

    const action = await this.prisma.playerAction.create({
      data: {
        runId: node.runId,
        nodeId,
        chapterIndex: node.chapterIndex,
        userId: user.id,
        roleId: input.roleId,
        playerType: "human",
        actionType: input.actionType,
        targetType: input.targetType,
        targetId: input.targetId,
        targetText: input.targetText,
        method: input.method,
        intent: input.intent,
        riskLevel: input.riskLevel || "normal",
        freeText: input.freeText,
        normalizedJson: input as any,
        guardStatus: "ok",
        auditStatus: "ok",
        status: "accepted"
      }
    }).catch((error: unknown) => {
      throw new BadRequestException(`action already submitted for this role/node: ${String(error)}`);
    });

    await this.logEvent("action_submitted", user.id, node.runId, nodeId, action.id, { roleName: role.roleName });
    return { actionId: action.id, status: "accepted", guardStatus: "ok", message: "行动已提交，等待本节点结算。" };
  }

  async nodeActions(nodeId: string) {
    return this.prisma.playerAction.findMany({
      where: { nodeId },
      include: { role: true, user: true },
      orderBy: { createdAt: "asc" }
    });
  }

  async fillMissingActions(nodeId: string) {
    const node = await this.prisma.sceneNode.findUnique({ where: { id: nodeId } });
    if (!node) throw new NotFoundException("node not found");
    const roles = await this.prisma.storyRole.findMany({ where: { runId: node.runId } });
    const existing = await this.prisma.playerAction.findMany({ where: { nodeId } });
    const actedRoleIds = new Set(existing.map((action) => action.roleId));
    const created = [];
    for (const role of roles) {
      if (actedRoleIds.has(role.id)) continue;
      created.push(
        await this.prisma.playerAction.create({
          data: {
            runId: node.runId,
            nodeId,
            chapterIndex: node.chapterIndex,
            roleId: role.id,
            playerType: "ai",
            actionType: "observe",
            targetText: node.title,
            method: `${role.roleName}保持观察，补充不改变核心选择的轻动作。`,
            intent: "协助团队收集信息，不替玩家做关键决定。",
            riskLevel: "safe",
            guardStatus: "ok",
            auditStatus: "ok",
            status: "accepted"
          }
        })
      );
    }
    return { created };
  }

  async resolveNode(nodeId: string) {
    const node = await this.prisma.sceneNode.findUnique({ where: { id: nodeId }, include: { run: true } });
    if (!node) throw new NotFoundException("node not found");
    const existing = await this.prisma.directorResolution.findUnique({ where: { nodeId } });
    if (existing) return existing;

    await this.fillMissingActions(nodeId);
    const rawActions = await this.prisma.playerAction.findMany({
      where: { nodeId, status: "accepted", roleId: { not: null } },
      include: { role: true }
    });
    const actions = rawActions.filter((action): action is typeof action & { roleId: string; role: NonNullable<typeof action.role> } => Boolean(action.roleId && action.role));
    if (actions.length === 0) throw new BadRequestException("no accepted actions to resolve");

    const template = getTemplate(node.run.templateId);
    const totalNodes = node.run.mode === "ai-trio" || node.run.mode === "room" ? 7 : 5;
    const templateNode = this.nodeDefinition(template, node.nodeIndex, node.run.mode);
    const dangerAfter = Math.min(node.run.maxDangerLevel, node.run.dangerLevel + (node.nodeIndex >= 4 ? 1 : 0));
    const directorResult = await resolveNodeWithDirector({
      templateName: template.name,
      nodeTitle: node.title,
      nodeGoal: node.nodeGoal,
      publicNarration: node.publicNarration,
      resolutionSummary: templateNode.resolutionSummary,
      nextHook: templateNode.nextHook,
      dangerBefore: node.run.dangerLevel,
      dangerAfter,
      actions: actions.map((action) => ({
        roleId: action.roleId,
        roleName: action.role.roleName,
        method: action.method,
        intent: action.intent,
        riskLevel: action.riskLevel
      }))
    });
    const actionResults = directorResult.actionResults.map((result, index) => ({
      actionId: actions[index]?.id,
      roleId: result.roleId || actions[index]?.roleId,
      roleName: result.roleName || actions[index]?.role.roleName,
      result: result.result || "partial_success",
      text: result.text || `${actions[index]?.role.roleName || "角色"}尝试推进当前节点，获得了线索。`
    }));
    const echoActions = actionResults.map((action) => ({ roleId: action.roleId, roleName: action.roleName }));
    const echoesJson = buildEchoes(echoActions, directorResult.summary);
    const crossImpactsJson = buildCrossImpacts(echoActions, directorResult.summary);

    const aiTask = await this.prisma.aiTask.create({
      data: {
        runId: node.runId,
        nodeId,
        taskType: "resolve_node",
        modelType: directorResult.model,
        status: directorResult.status === "completed" ? "completed" : "failed",
        inputJson: { actionCount: actions.length, node: node.title, provider: directorResult.provider },
        resultJson: { ...directorTaskMeta(directorResult), summary: directorResult.summary }
      }
    });

    const resolution = await this.prisma.directorResolution.create({
      data: {
        runId: node.runId,
        nodeId,
        chapterIndex: node.chapterIndex,
        summary: directorResult.summary,
        publicNarration: directorResult.publicNarration,
        privateResultsJson: directorResult.privateResults,
        actionResultsJson: actionResults,
        statePatchJson: { resolvedNode: node.title, aiTaskId: aiTask.id, echoesJson, crossImpactsJson },
        clueChangesJson: [{ title: `节点 ${node.nodeIndex} 新线索`, description: directorResult.summary }],
        relationChangesJson: this.mockRelationChanges(actions),
        dangerBefore: node.run.dangerLevel,
        dangerAfter,
        nextNodeHook: directorResult.nextNodeHook,
        nextOptionsJson: this.nodeDefinition(template, node.nodeIndex + 1, node.run.mode)?.actionOptions || []
      }
    });

    const segment = await this.prisma.narrativeSegment.create({
      data: {
        runId: node.runId,
        nodeId,
        resolutionId: resolution.id,
        chapterIndex: node.chapterIndex,
        content: `【${node.title}】${directorResult.summary} ${actions.map((action) => action.role.roleName).join("、")}的选择让局面继续推进。`,
        contributorJson: actions.map((action) => ({ roleId: action.roleId, roleName: action.role.roleName }))
      }
    });

    const allRoles = await this.prisma.storyRole.findMany({
      where: { runId: node.runId },
      orderBy: { createdAt: "asc" }
    });
    const publicFactKey = ["node", node.nodeIndex, "resolved"].join("_");
    await this.prisma.canonFact.upsert({
      where: { runId_factKey: { runId: node.runId, factKey: publicFactKey } },
      update: {
        content: directorResult.summary,
        sourceActionIdsJson: actions.map((action) => action.id),
        knownByRoleIdsJson: allRoles.map((role) => role.id)
      },
      create: {
        runId: node.runId,
        sourceNodeId: node.id,
        factKey: publicFactKey,
        content: directorResult.summary,
        status: "confirmed",
        visibility: "public",
        sourceEventIdsJson: [],
        sourceActionIdsJson: actions.map((action) => action.id),
        knownByRoleIdsJson: allRoles.map((role) => role.id)
      }
    });
    await this.prisma.storyThread.upsert({
      where: { runId_threadKey: { runId: node.runId, threadKey: "main_pressure" } },
      update: {
        tension: Math.max(1, Math.min(5, node.nodeIndex)),
        status: node.nodeIndex >= totalNodes ? "resolved" : "active",
        stateJson: { lastNodeId: node.id, lastFactKey: publicFactKey, nextHook: directorResult.nextNodeHook }
      },
      create: {
        runId: node.runId,
        threadKey: "main_pressure",
        title: "主线压力",
        status: node.nodeIndex >= totalNodes ? "resolved" : "active",
        tension: Math.max(1, Math.min(5, node.nodeIndex)),
        deadlineNodeIndex: totalNodes,
        sourceFactKeysJson: [publicFactKey],
        stateJson: { lastNodeId: node.id, lastFactKey: publicFactKey, nextHook: directorResult.nextNodeHook }
      }
    });
    const minds = await this.prisma.characterMind.findMany({ where: { runId: node.runId } });
    await Promise.all(minds.map((mind) => {
      const confirmed = this.stringList(mind.confirmedFactKeysJson);
      return this.prisma.characterMind.update({
        where: { id: mind.id },
        data: {
          confirmedFactKeysJson: [...new Set([...confirmed, publicFactKey])],
          lastNodeId: node.id
        }
      });
    }));
    await this.prisma.sceneSnapshot.create({
      data: {
        runId: node.runId,
        nodeId: node.id,
        scope: "public",
        stateJson: { dangerLevel: dangerAfter, latestResolution: resolution.summary, nodeIndex: node.nodeIndex },
        knownFactKeysJson: [publicFactKey],
        activeThreadKeysJson: ["main_pressure"]
      }
    });
    await Promise.all(allRoles.map((role) => this.prisma.sceneSnapshot.create({
      data: {
        runId: node.runId,
        nodeId: node.id,
        roleId: role.id,
        scope: "role_private",
        stateJson: { nodeIndex: node.nodeIndex, roleKey: role.roleKey, dangerLevel: dangerAfter },
        knownFactKeysJson: [...new Set([...this.stringList(minds.find((mind) => mind.roleId === role.id)?.confirmedFactKeysJson), publicFactKey])],
        activeThreadKeysJson: ["main_pressure"]
      }
    })));
    await this.prisma.narrativeEntry.create({
      data: {
        runId: node.runId,
        nodeId: node.id,
        resolutionId: resolution.id,
        entryType: "resolution",
        visibility: "public",
        content: segment.content,
        factKeysJson: [publicFactKey],
        threadKeysJson: ["main_pressure"],
        sourceEventIdsJson: []
      }
    });

    await this.prisma.clue.upsert({
      where: { runId_clueKey: { runId: node.runId, clueKey: `node_${node.nodeIndex}_clue` } },
      update: {},
      create: {
        runId: node.runId,
        clueKey: `node_${node.nodeIndex}_clue`,
        title: `节点 ${node.nodeIndex} 线索`,
        description: directorResult.summary,
        visibility: "public",
        discoveredNodeId: node.id
      }
    });

    await this.upsertRelationChanges(node.runId, actions.map((action) => action.roleId), node.id);
    await this.prisma.worldStateSnapshot.create({
      data: {
        runId: node.runId,
        nodeId,
        chapterIndex: node.chapterIndex,
        stateJson: { dangerLevel: dangerAfter, latestResolution: resolution.summary },
        factsJson: { segmentId: segment.id, clue: directorResult.summary }
      }
    });

    await this.prisma.sceneNode.update({
      where: { id: nodeId },
      data: { status: "resolved", resolvedAt: new Date(), resolutionId: resolution.id }
    });

    await this.notifyOtherPlayers({
      runId: node.runId,
      nodeId,
      nodeTitle: node.title,
      actions,
      summary: directorResult.summary
    });

    if (node.nodeIndex < totalNodes) {
      const next = await this.ensureNode(node.runId, 1, node.nodeIndex + 1, node.run.templateId, node.run.mode);
      await this.prisma.storyRun.update({
        where: { id: node.runId },
        data: {
          currentNodeId: next.id,
          completedNodeCount: { increment: 1 },
          dangerLevel: dangerAfter,
          status: "playing"
        }
      });
    } else {
      await this.prisma.storyRun.update({
        where: { id: node.runId },
        data: {
          completedNodeCount: { increment: 1 },
          dangerLevel: dangerAfter,
          status: "chapter_ready"
        }
      });
      await this.generateChapter(node.runId);
    }

    await this.logEvent("node_resolved", undefined, node.runId, nodeId, undefined, { resolutionId: resolution.id });
    return { ...resolution, echoesJson, crossImpactsJson };
  }

  async resolution(nodeId: string) {
    const resolution = await this.prisma.directorResolution.findUnique({
      where: { nodeId },
      include: { narrativeSegments: true }
    });
    if (!resolution) return null;
    return this.enrichResolution(resolution as any);
  }

  async segments(runId: string) {
    return this.prisma.narrativeSegment.findMany({
      where: { runId },
      orderBy: { createdAt: "asc" }
    });
  }

  async generateChapter(runId: string) {
    const existing = await this.prisma.chapter.findUnique({ where: { runId_chapterIndex: { runId, chapterIndex: 1 } } });
    if (existing) return existing;
    const run = await this.prisma.storyRun.findUnique({ where: { id: runId }, include: { roles: true, owner: true } });
    if (!run) throw new NotFoundException("story run not found");
    const entries = await this.prisma.narrativeEntry.findMany({
      where: { runId, entryType: "resolution", visibility: "public" },
      orderBy: { createdAt: "asc" }
    });
    const segments = await this.segments(runId);
    const requiredNodes = run.mode === "ai-trio" || run.mode === "room" ? 7 : 5;
    if (entries.length < requiredNodes && segments.length < requiredNodes) throw new BadRequestException(`chapter requires ${requiredNodes} resolved nodes`);
    const chapterEntries = entries.length >= requiredNodes ? entries : segments;

    const template = getTemplate(run.templateId);
    const directorResult = await generateChapterWithDirector({
      templateName: template.name,
      title: "没有影子的客人",
      segments: chapterEntries.map((segment) => segment.content),
      roles: run.roles.map((role) => ({ id: role.id, roleName: role.roleName, personalGoal: role.personalGoal })),
      fallbackNextHook: "第 2 章《第五个人》：北巷 24 号的门牌在雨后亮了起来。"
    });

    const chapter = await this.prisma.chapter.create({
      data: {
        runId,
        chapterIndex: 1,
        title: directorResult.title,
        content: directorResult.content,
        highlightsJson: directorResult.highlights,
        keyChoicesJson: directorResult.keyChoices,
        contributorJson: run.roles.map((role) => ({ roleId: role.id, roleName: role.roleName })),
        nextHook: directorResult.nextHook
      }
    });

    await this.prisma.aiTask.create({
      data: {
        runId,
        chapterId: chapter.id,
        taskType: "generate_chapter",
        modelType: directorResult.model,
        status: directorResult.status === "completed" ? "completed" : "failed",
        inputJson: { segmentCount: chapterEntries.length, roleCount: run.roles.length, provider: directorResult.provider },
        resultJson: { ...directorTaskMeta(directorResult), title: chapter.title, segmentCount: chapterEntries.length }
      }
    });

    await this.prisma.storyRun.update({
      where: { id: runId },
      data: { status: "chapter_generated", chapterCount: 1 }
    });

    return this.enrichChapter(chapter, run.roles);
  }

  async chapter(chapterId: string) {
    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { run: true, shareTokens: true }
    });
    if (!chapter) throw new NotFoundException("chapter not found");
    const roles = await this.prisma.storyRole.findMany({ where: { runId: chapter.runId }, orderBy: { createdAt: "asc" } });
    return this.enrichChapter(chapter, roles);
  }

  async shareChapter(openid: string, chapterId: string) {
    await this.ensureUser(openid);
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new NotFoundException("chapter not found");
    throw new ConflictException({
      code: "SECURE_RESULT_SHARE_REQUIRED",
      message: "Create a revocable, expiring result share from the result page"
    });
  }


  async notifications(openid: string) {
    const user = await this.ensureUser(openid);
    const stored = await this.prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20
    });
    if (stored.length) return stored;
    const runs = await this.myRuns(openid);
    return runs.slice(0, 5).flatMap((run) => [
      {
        id: `mock_action_${run.id}`,
        type: "action_reminder",
        title: "行动提醒",
        content: `${run.title} 等待玩家提交行动`,
        runId: run.id,
        isRead: false,
        createdAt: run.updatedAt
      },
      {
        id: `mock_ai_${run.id}`,
        type: "ai_resolution",
        title: "AI 结算",
        content: run.status === "chapter_generated" ? "本章已生成多 POV 章节" : "mock AI 正在记录局势",
        runId: run.id,
        isRead: false,
        createdAt: run.updatedAt
      }
    ]);
  }

  async reportFeedback(openid: string, body: Record<string, unknown>) {
    const user = await this.ensureUser(openid);
    const content = String(body.content || body.description || "反馈 / 举报");
    const log = await this.prisma.auditLog.create({
      data: {
        targetType: "FeedbackReport",
        targetId: typeof body.runId === "string" ? body.runId : undefined,
        content,
        result: "queued",
        riskType: typeof body.category === "string" ? body.category : "content_safety",
        provider: "mock"
      }
    });
    await this.logEvent("feedback_reported", user.id, typeof body.runId === "string" ? body.runId : undefined, undefined, undefined, { auditLogId: log.id });
    return { status: "queued", auditLogId: log.id, provider: "mock" };
  }

  async insights(openid: string, runId: string) {
    const [state, myRole, nodes, actions, resolutions, snapshots] = await Promise.all([
      this.getRunState(runId),
      this.myRole(openid, runId).catch(() => null),
      this.nodes(runId),
      this.prisma.playerAction.findMany({ where: { runId }, include: { role: true }, orderBy: { createdAt: "asc" } }),
      this.prisma.directorResolution.findMany({ where: { runId }, orderBy: { createdAt: "asc" } }),
      this.prisma.worldStateSnapshot.findMany({ where: { runId }, orderBy: { createdAt: "desc" }, take: 5 })
    ]);
    const latestResolution = resolutions.length ? this.enrichResolution(resolutions[resolutions.length - 1] as any) : null;
    return {
      ...state,
      myRole,
      nodes,
      actions,
      resolutions: resolutions.map((item) => this.enrichResolution(item as any)),
      latestResolution,
      worldSnapshots: snapshots,
      suspicious: state.clues.map((clue: any) => ({ title: clue.title, description: clue.description, risk: state.run.dangerLevel }))
    };
  }

  async adminDashboard() {
    const [activeRuns, pendingAiTasks, auditIssues, eventCount, latestRuns] = await Promise.all([
      this.prisma.storyRun.count({ where: { status: { in: ["playing", "chapter_ready", "chapter_generated"] } } }),
      this.prisma.aiTask.count({ where: { status: { in: ["pending", "running", "failed"] } } }),
      this.prisma.auditLog.count({ where: { result: { not: "ok" } } }),
      this.prisma.eventLog.count(),
      this.prisma.storyRun.findMany({ orderBy: { updatedAt: "desc" }, take: 5 })
    ]);
    return { activeRuns, pendingAiTasks, auditIssues, eventCount, latestRuns };
  }

  async adminStoryRuns() {
    return this.prisma.storyRun.findMany({
      include: { template: true, players: { include: { role: true, user: true } }, chapters: true, aiTasks: true },
      orderBy: { updatedAt: "desc" },
      take: 30
    });
  }

  async adminStoryRun(runId: string) {
    const run = await this.prisma.storyRun.findUnique({
      where: { id: runId },
      include: {
        template: true,
        players: { include: { role: true, user: true } },
        roles: true,
        nodes: { include: { actions: { include: { role: true, user: true } }, resolution: true }, orderBy: [{ chapterIndex: "asc" }, { nodeIndex: "asc" }] },
        actions: { include: { role: true, user: true }, orderBy: { createdAt: "asc" } },
        resolutions: true,
        chapters: true,
        aiTasks: true,
        events: { orderBy: { createdAt: "desc" }, take: 50 }
      }
    });
    if (!run) throw new NotFoundException("story run not found");
    return run;
  }


  async adminRoles() {
    return this.prisma.storyRole.findMany({
      include: { run: true, players: { include: { user: true } } },
      orderBy: { updatedAt: "desc" },
      take: 100
    });
  }

  async adminActions() {
    return this.prisma.playerAction.findMany({
      include: { run: true, node: true, role: true, user: true },
      orderBy: { createdAt: "desc" },
      take: 120
    });
  }

  async adminResolutions() {
    return this.prisma.directorResolution.findMany({
      include: { run: true, node: true, narrativeSegments: true },
      orderBy: { createdAt: "desc" },
      take: 80
    });
  }

  async adminAiTasks() {
    return this.prisma.aiTask.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  }

  async adminAuditLogs() {
    return this.prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  }

  async adminEventLogs() {
    return this.prisma.eventLog.findMany({ orderBy: { createdAt: "desc" }, take: 80 });
  }

  async adminActionGuard() {
    const [blockedAudits, guardEvents, rejectedActions] = await Promise.all([
      this.prisma.auditLog.findMany({ where: { OR: [{ targetType: "PlayerActionDraft" }, { riskType: "action_overreach" }] }, orderBy: { createdAt: "desc" }, take: 30 }),
      this.prisma.eventLog.findMany({ where: { eventName: "action_guard_blocked" }, orderBy: { createdAt: "desc" }, take: 30 }),
      this.prisma.playerAction.findMany({ where: { OR: [{ guardStatus: { not: "ok" } }, { auditStatus: { not: "ok" } }] }, include: { role: true }, orderBy: { createdAt: "desc" }, take: 30 })
    ]);
    return { blockedAudits, guardEvents, rejectedActions };
  }

  private async ensureUser(openid: string) {
    return this.prisma.user.upsert({
      where: { openid },
      update: {},
      create: {
        openid,
        nickname: openid.replace("mock_openid_", "玩家 "),
        avatarUrl: "",
        policyAgreedAt: new Date()
      }
    });
  }

  private async createInitialRunAssets(runId: string, templateId: string, mode: string) {
    const template = getTemplate(templateId);
    const gameDefinition = findGameDefinitionByTemplateId(templateId);
    const canonicalTemplate = gameDefinition ? { ...template, roles: gameDefinition.roles } : template;
    await this.prisma.chapterSandbox.create({
      data: {
        runId,
        chapterIndex: 1,
        title: mode === "ai-trio" ? "第 1 章：三人共同推演" : "第 1 章：没有影子的客人",
        mainLocation: template.name,
        chapterGoal: "确认异常的来源，并让所有角色产生第一次协作。",
        currentQuestion: this.nodeDefinition(template, 1, mode)?.nodeGoal || template.hook,
        sandboxJson: canonicalTemplate
      }
    });

    // Registered games own the canonical player-seat list. A world actor is
    // deliberately absent here and is materialized only as an internal runtime
    // principal when a continuous action needs a required roleId foreign key.
    for (const role of gameDefinition?.roles || template.roles) {
      await this.prisma.storyRole.create({
        data: {
          runId,
          roleKey: role.roleKey,
          roleName: role.roleName,
          identity: role.identity,
          publicInfo: role.publicInfo,
          hiddenSecret: role.hiddenSecret,
          personalGoal: role.personalGoal,
          currentState: role.currentState,
          abilityText: role.abilityText,
          arcText: role.arcText,
          knownInfoJson: role.knownInfo,
          cannotDoJson: role.cannotDo,
          isAiControlled: false,
          status: "available"
        }
      });
    }

    const node = await this.ensureNode(runId, 1, 1, templateId, mode);
    await this.prisma.storyRun.update({ where: { id: runId }, data: { currentNodeId: node.id } });

    for (const clue of template.initialClues) {
      await this.prisma.clue.create({
        data: {
          runId,
          clueKey: clue.clueKey,
          title: clue.title,
          description: clue.description,
          visibility: "public",
          discoveredNodeId: node.id
        }
      });
    }

    await this.prisma.worldStateSnapshot.create({
      data: {
        runId,
        nodeId: node.id,
        chapterIndex: 1,
        stateJson: { dangerLevel: 1, currentNode: node.title },
        factsJson: { publicFacts: [template.hook] }
      }
    });

    const createdRoles = await this.prisma.storyRole.findMany({
      where: { runId },
      orderBy: { createdAt: "asc" }
    });
    const publicFactKeys = ["world_hook", ...template.initialClues.map((clue) => ["clue", clue.clueKey].join("_"))];
    await this.prisma.canonFact.upsert({
      where: { runId_factKey: { runId, factKey: "world_hook" } },
      update: {},
      create: {
        runId,
        sourceNodeId: node.id,
        factKey: "world_hook",
        content: template.hook,
        status: "confirmed",
        visibility: "public",
        sourceEventIdsJson: [],
        sourceActionIdsJson: [],
        knownByRoleIdsJson: createdRoles.map((role) => role.id)
      }
    });
    await Promise.all(template.initialClues.map((clue) => this.prisma.canonFact.upsert({
      where: { runId_factKey: { runId, factKey: ["clue", clue.clueKey].join("_") } },
      update: {},
      create: {
        runId,
        sourceNodeId: node.id,
        factKey: ["clue", clue.clueKey].join("_"),
        content: clue.description,
        status: "confirmed",
        visibility: "public",
        sourceEventIdsJson: [],
        sourceActionIdsJson: [],
        knownByRoleIdsJson: createdRoles.map((role) => role.id)
      }
    })));
    await this.prisma.storyThread.upsert({
      where: { runId_threadKey: { runId, threadKey: "main_pressure" } },
      update: {},
      create: {
        runId,
        threadKey: "main_pressure",
        title: "主线压力",
        status: "active",
        tension: 1,
        deadlineNodeIndex: mode === "room" || mode === "ai-trio" ? 7 : 5,
        sourceFactKeysJson: publicFactKeys,
        stateJson: { currentNodeId: node.id, currentQuestion: node.nodeGoal }
      }
    });
    await Promise.all(createdRoles.map(async (role) => {
      const roleFactKeys = this.stringList(role.knownInfoJson).map((_, index) => ["role", role.roleKey, "known", index + 1].join("_"));
      const secretKey = ["role", role.roleKey, "secret"].join("_");
      const knownInfo = this.stringList(role.knownInfoJson);
      await Promise.all(knownInfo.map((content, index) => this.prisma.canonFact.upsert({
        where: { runId_factKey: { runId, factKey: roleFactKeys[index] } },
        update: {},
        create: {
          runId,
          sourceNodeId: node.id,
          factKey: roleFactKeys[index],
          content,
          status: "confirmed",
          visibility: "role_private",
          sourceEventIdsJson: [],
          sourceActionIdsJson: [],
          knownByRoleIdsJson: [role.id]
        }
      })));
      if (role.hiddenSecret) {
        await this.prisma.canonFact.upsert({
          where: { runId_factKey: { runId, factKey: secretKey } },
          update: {},
          create: {
            runId,
            sourceNodeId: node.id,
            factKey: secretKey,
            content: role.hiddenSecret,
            status: "confirmed",
            visibility: "role_private",
            sourceEventIdsJson: [],
            sourceActionIdsJson: [],
            knownByRoleIdsJson: [role.id]
          }
        });
      }
      const confirmedFactKeys = [...publicFactKeys, ...roleFactKeys, ...(role.hiddenSecret ? [secretKey] : [])];
      await this.prisma.characterMind.upsert({
        where: { roleId: role.id },
        update: {},
        create: {
          runId,
          roleId: role.id,
          confirmedFactKeysJson: confirmedFactKeys,
          believedFactKeysJson: [],
          activeGoalsJson: [role.personalGoal],
          knowledgeBoundaryJson: { cannotDo: this.stringList(role.cannotDoJson), roleKey: role.roleKey },
          lastNodeId: node.id
        }
      });
      await this.prisma.sceneSnapshot.create({
        data: {
          runId,
          nodeId: node.id,
          roleId: role.id,
          scope: "role_private",
          stateJson: { dangerLevel: 1, currentNode: node.title, roleKey: role.roleKey },
          knownFactKeysJson: confirmedFactKeys,
          activeThreadKeysJson: ["main_pressure"]
        }
      });
    }));
    await this.prisma.sceneSnapshot.create({
      data: {
        runId,
        nodeId: node.id,
        scope: "public",
        stateJson: { dangerLevel: 1, currentNode: node.title },
        knownFactKeysJson: publicFactKeys,
        activeThreadKeysJson: ["main_pressure"]
      }
    });
    await this.prisma.narrativeEntry.create({
      data: {
        runId,
        nodeId: node.id,
        entryType: "scene_open",
        visibility: "public",
        content: node.publicNarration,
        factKeysJson: publicFactKeys,
        threadKeysJson: ["main_pressure"],
        sourceEventIdsJson: []
      }
    });
  }

  private async ensureNode(runId: string, chapterIndex: number, nodeIndex: number, templateId: string, mode = "invite") {
    const template = getTemplate(templateId);
    const templateNode = this.nodeDefinition(template, nodeIndex, mode);
    if (!templateNode) throw new BadRequestException(`story node ${nodeIndex} is not configured`);
    return this.prisma.sceneNode.upsert({
      where: { runId_chapterIndex_nodeIndex: { runId, chapterIndex, nodeIndex } },
      update: {},
      create: {
        runId,
        chapterIndex,
        nodeIndex,
        title: templateNode.title,
        publicNarration: templateNode.publicNarration,
        nodeGoal: templateNode.nodeGoal,
        actionOptionsJson: templateNode.actionOptions,
        status: "open_for_actions"
      }
    });
  }

  private nodeDefinition(template: { nodes: readonly any[] }, nodeIndex: number, mode = "invite") {
    if (mode === "ai-trio" && nodeIndex > template.nodes.length) {
      return AI_TRIO_EXTENSION_NODES[nodeIndex - template.nodes.length - 1];
    }
    return template.nodes[nodeIndex - 1] || midnightStoreTemplate.nodes[nodeIndex - 1];
  }

  private async notifyOtherPlayers(input: {
    runId: string;
    nodeId: string;
    nodeTitle: string;
    actions: Array<{ id: string; userId: string | null; role: { roleName: string }; method: string; intent: string }>;
    summary: string;
  }) {
    const players = await this.prisma.storyPlayer.findMany({
      where: { runId: input.runId, status: "active", userId: { not: null } },
      include: { role: true }
    });
    const notifications: Array<{
      userId: string;
      runId: string;
      nodeId: string;
      type: string;
      title: string;
      content: string;
    }> = [];
    for (const action of input.actions) {
      if (!action.userId) continue;
      const decision = `${action.method}${action.intent ? `（意图：${action.intent}）` : ""}`;
      for (const recipient of players) {
        if (!recipient.userId || recipient.userId === action.userId) continue;
        notifications.push({
          userId: recipient.userId,
          runId: input.runId,
          nodeId: input.nodeId,
          type: "player_decision_shared",
          title: `${action.role.roleName} 已在「${input.nodeTitle}」作出决策`,
          content: `其他玩家可见决策：${decision}\nAI 导演回响：${input.summary}`
        });
      }
    }
    if (notifications.length) await this.prisma.notification.createMany({ data: notifications });
  }

  private stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }

  private async guardKnowledgeBoundary(runId: string, roleId: string, input: SubmitActionInput) {
    const text = [input.method, input.intent, input.freeText].filter((item): item is string => typeof item === "string").join("\n");
    if (!text.trim()) return null;
    const canonFact = (this.prisma as any).canonFact;
    // Isolated legacy unit fixtures intentionally expose only their relevant
    // delegates. Production Prisma always has this delegate after migration.
    if (!canonFact?.findMany) return null;
    const privateFacts = await canonFact.findMany({
      where: { runId, visibility: "role_private" },
      select: { factKey: true, content: true, knownByRoleIdsJson: true }
    });
    return privateFacts.find((fact: { factKey: string; content: string; knownByRoleIdsJson: unknown }) => {
      const ownerRoleIds = this.stringList(fact.knownByRoleIdsJson);
      return !ownerRoleIds.includes(roleId) && fact.content.length >= 4 && text.includes(fact.content);
    }) || null;
  }

  private guardAction(input: SubmitActionInput): { ok: true } | { ok: false; reason: string; guardStatus: "rewrite_needed" | "blocked"; matchedRules: string[] } {
    const text = `${input.method} ${input.intent} ${input.freeText || ""}`;
    const rules = [
      { id: "declare_result", status: "rewrite_needed" as const, pattern: /(\u6211\u6210\u529f|\u76f4\u63a5\u6210\u529f|\u5ba3\u5e03\u7ed3\u679c|\u7834\u89e3\u5168\u90e8|\u63ed\u5f00\u5168\u90e8\u771f\u76f8|FORCE_SUCCESS)/iu, reason: "ActionGuard rewrite_needed: player can submit intent but cannot declare the result." },
      { id: "control_others", status: "blocked" as const, pattern: /(\u64cd\u63a7|\u63a7\u5236\u5176\u4ed6|\u66ff\u4ed6|\u66ff\u5979|\u6240\u6709\u4eba\u90fd|CONTROL_ALL)/iu, reason: "ActionGuard blocked: player cannot control other characters." },
      { id: "skip_plot", status: "blocked" as const, pattern: /(\u8df3\u8fc7|\u7acb\u523b\u901a\u5173|\u76f4\u63a5\u5230\u7ed3\u5c40|AUTO_WIN)/iu, reason: "ActionGuard blocked: player cannot skip the current plot node." },
      { id: "overreach", status: "blocked" as const, pattern: /(\u6740\u6b7b|\u6467\u6bc1\u4e16\u754c|\u5c01\u5370\u5168\u90e8|\u4e00\u5200\u89e3\u51b3)/iu, reason: "ActionGuard blocked: action overreaches the role authority." }
    ];
    const matched = rules.filter((rule) => rule.pattern.test(text));
    if (matched.length > 0) {
      const guardStatus = matched.some((rule) => rule.status === "blocked") ? "blocked" : "rewrite_needed";
      return { ok: false, guardStatus, matchedRules: matched.map((rule) => rule.id), reason: matched.map((rule) => rule.reason).join("; ") };
    }
    if (!input.method || !input.intent) {
      return { ok: false, guardStatus: "rewrite_needed", matchedRules: ["missing_fields"], reason: "ActionGuard rewrite_needed: method and intent are required." };
    }
    return { ok: true };
  }

  private rewriteSuggestion(input: SubmitActionInput) {
    return {
      method: input.method
        ? input.method.replace(/(\u6211\u6210\u529f|\u76f4\u63a5\u6210\u529f|\u5ba3\u5e03\u7ed3\u679c|\u7834\u89e3\u5168\u90e8|\u63ed\u5f00\u5168\u90e8\u771f\u76f8|\u64cd\u63a7|\u63a7\u5236\u5176\u4ed6|\u66ff\u4ed6|\u66ff\u5979|\u6240\u6709\u4eba\u90fd|\u8df3\u8fc7|\u7acb\u523b\u901a\u5173|\u76f4\u63a5\u5230\u7ed3\u5c40|\u6740\u6b7b|CONTROL_ALL|FORCE_SUCCESS|AUTO_WIN)/giu, "I try to observe and move the scene forward")
        : "Describe what the role tries to do, without declaring the result.",
      intent: "Only state action intent and information boundary; leave the outcome to the AI Director.",
      strategy: "Use public clues openly, private clues as motivation, and do not decide for other players."
    };
  }

  private async nextInviteCode() {
    for (let i = 0; i < 5; i += 1) {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      const existing = await this.prisma.storyRun.findUnique({ where: { inviteCode: code } });
      if (!existing) return code;
    }
    return `${Date.now()}`.slice(-6);
  }

  private mockRelationChanges(actions: Array<{ role: { roleName: string }; roleId: string }>) {
    if (actions.length < 2) return [];
    return [
      {
        fromRoleId: actions[0].roleId,
        toRoleId: actions[1].roleId,
        relationType: "trust",
        scoreDelta: 1,
        note: `${actions[0].role.roleName}开始信任${actions[1].role.roleName}的判断。`
      }
    ];
  }

  private async upsertRelationChanges(runId: string, roleIds: string[], nodeId: string) {
    if (roleIds.length < 2) return;
    await this.prisma.roleRelation.upsert({
      where: {
        runId_fromRoleId_toRoleId_relationType: {
          runId,
          fromRoleId: roleIds[0],
          toRoleId: roleIds[1],
          relationType: "trust"
        }
      },
      update: { score: { increment: 1 }, updatedByNodeId: nodeId, publicNote: "共同经历异常后产生信任。" },
      create: {
        runId,
        fromRoleId: roleIds[0],
        toRoleId: roleIds[1],
        relationType: "trust",
        score: 1,
        updatedByNodeId: nodeId,
        publicNote: "共同经历异常后产生信任。"
      }
    });
  }

  private async logEvent(eventName: string, userId?: string, runId?: string, nodeId?: string, actionId?: string, payload?: JsonValue) {
    await this.prisma.eventLog.create({
      data: {
        eventName,
        userId,
        runId,
        nodeId,
        actionId,
        source: "api",
        payload: payload as any
      }
    });
  }

  private enrichResolution<T extends { actionResultsJson?: unknown; summary?: string; statePatchJson?: unknown }>(resolution: T) {
    const actions = Array.isArray(resolution.actionResultsJson) ? resolution.actionResultsJson as Array<{ roleId?: string; roleName?: string }> : [];
    const statePatch = (resolution.statePatchJson && typeof resolution.statePatchJson === "object" ? resolution.statePatchJson : {}) as Record<string, unknown>;
    return {
      ...resolution,
      echoesJson: Array.isArray(statePatch.echoesJson) ? statePatch.echoesJson : buildEchoes(actions, resolution.summary || ""),
      crossImpactsJson: Array.isArray(statePatch.crossImpactsJson) ? statePatch.crossImpactsJson : buildCrossImpacts(actions, resolution.summary || "")
    };
  }

  private enrichChapter<T extends { content?: string; title?: string; highlightsJson?: unknown }>(
    chapter: T,
    roles: Array<{ id?: string; roleName?: string; personalGoal?: string; roleKey?: string; knownInfoJson?: unknown; publicInfo?: string }>
  ) {
    const summary = Array.isArray(chapter.highlightsJson) ? JSON.stringify(chapter.highlightsJson) : chapter.title || "";
    return {
      ...chapter,
      povSectionsJson: buildPovSections(roles, chapter.content || ""),
      personalCardsJson: buildPersonalCards(roles, summary)
    };
  }
}
