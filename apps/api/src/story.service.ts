import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
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
import { getTemplate, midnightStoreTemplate } from "@ai-story/templates";
import { PrismaService } from "./prisma.service";

type JsonValue = Record<string, unknown> | unknown[];

@Injectable()
export class StoryService {
  constructor(private readonly prisma: PrismaService) {}

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

  async createRun(openid: string, input: CreateStoryRunInput) {
    const owner = await this.ensureUser(openid);
    const template = getTemplate(input.templateId);
    const maxPlayers = Math.max(1, Math.min(5, Number(input.maxPlayers || 3)));
    const mode = input.mode || "invite";
    const inviteCode = await this.nextInviteCode();

    const run = await this.prisma.storyRun.create({
      data: {
        templateId: template.id,
        ownerUserId: owner.id,
        title: `${template.name}：没有影子的客人`,
        hook: template.hook,
        mode,
        status: "playing",
        maxPlayers,
        activeHumanCount: 0,
        aiPlayerCount: mode === "single" ? Math.max(0, maxPlayers - 1) : input.aiPlayerCount || 0,
        stateJson: {
          tone: input.tone || "悬疑",
          currentQuestion: "第一章刚刚开始",
          dangerLevel: 1
        },
        visibility: mode === "single" ? "private" : "link",
        inviteCode
      }
    });

    await this.createInitialRunAssets(run.id, template.id);

    if (input.ownerAsPlayer !== false || mode === "single") {
      await this.joinRun(openid, run.id);
    }

    return this.getRun(run.id);
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
    const actions = await this.prisma.playerAction.findMany({
      where: { nodeId, status: "accepted" },
      include: { role: true }
    });
    if (actions.length === 0) throw new BadRequestException("no accepted actions to resolve");

    const template = getTemplate(node.run.templateId);
    const templateNode = template.nodes[node.nodeIndex - 1] || midnightStoreTemplate.nodes[node.nodeIndex - 1];
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
        nextOptionsJson: template.nodes[node.nodeIndex]?.actionOptions || []
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

    if (node.nodeIndex < 5) {
      const next = await this.ensureNode(node.runId, node.chapterIndex, node.nodeIndex + 1, node.run.templateId);
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
    const segments = await this.segments(runId);
    if (segments.length < 5) throw new BadRequestException("chapter requires 5 resolved nodes");

    const template = getTemplate(run.templateId);
    const directorResult = await generateChapterWithDirector({
      templateName: template.name,
      title: "没有影子的客人",
      segments: segments.map((segment) => segment.content),
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
        inputJson: { segmentCount: segments.length, roleCount: run.roles.length, provider: directorResult.provider },
        resultJson: { ...directorTaskMeta(directorResult), title: chapter.title, segmentCount: segments.length }
      }
    });

    await this.prisma.storyRun.update({
      where: { id: runId },
      data: { status: "chapter_generated", chapterCount: 1 }
    });

    await this.shareChapter(run.owner.openid, chapter.id);
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
    const user = await this.ensureUser(openid);
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new NotFoundException("chapter not found");
    return this.prisma.shareToken.upsert({
      where: { token: `share_${chapter.id.slice(-8)}_${user.id.slice(-4)}` },
      update: {},
      create: {
        token: `share_${chapter.id.slice(-8)}_${user.id.slice(-4)}`,
        runId: chapter.runId,
        chapterId: chapter.id,
        shareUserId: user.id,
        scene: "chapter",
        channel: "mock"
      }
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

  private async createInitialRunAssets(runId: string, templateId: string) {
    const template = getTemplate(templateId);
    await this.prisma.chapterSandbox.create({
      data: {
        runId,
        chapterIndex: 1,
        title: "第 1 章：没有影子的客人",
        mainLocation: template.name,
        chapterGoal: "确认异常的来源，并让所有角色产生第一次协作。",
        currentQuestion: template.nodes[0]?.nodeGoal || template.hook,
        sandboxJson: template
      }
    });

    for (const role of template.roles) {
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

    const node = await this.ensureNode(runId, 1, 1, templateId);
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
  }

  private async ensureNode(runId: string, chapterIndex: number, nodeIndex: number, templateId: string) {
    const template = getTemplate(templateId);
    const templateNode = template.nodes[nodeIndex - 1] || midnightStoreTemplate.nodes[nodeIndex - 1];
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
