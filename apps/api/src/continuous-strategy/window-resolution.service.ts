import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { sha256Canonical } from "./canonical";
import { ContinuousStrategyContentService, type BoundContinuousStrategyContent } from "./content.service";
import { ContinuousEventDeliveryService } from "./event-delivery.service";
import { RoleAgentTaskService } from "./role-agent-task.service";
import {
  normalizeResolutionTaskLeaseMs,
  RESOLUTION_PHASE_TRANSACTION_TIMEOUT_MS
} from "../config/continuous-strategy.config";
import { roomSerializableTransaction } from "./room-transaction";

type Tx = Prisma.TransactionClient;

@Injectable()
export class WindowResolutionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ContinuousStrategyContentService) private readonly content: ContinuousStrategyContentService,
    @Inject(ContinuousEventDeliveryService) private readonly deliveries: ContinuousEventDeliveryService,
    @Inject(RoleAgentTaskService) private readonly roleAgents: RoleAgentTaskService
  ) {}

  async resolve(windowId: string, fence?: { taskId: string; leaseOwner: string; leaseVersion: number }) {
    const identity = await this.prisma.actionWindow.findUnique({ where: { id: windowId }, select: { runId: true } });
    if (!identity) throw new NotFoundException({ code: "WINDOW_NOT_FOUND", message: "Action window not found" });
    for (let phase = 0; phase < 256; phase += 1) {
      const result = await roomSerializableTransaction(
        this.prisma,
        identity.runId,
        (tx) => this.resolvePhaseTx(tx, windowId, fence),
        { timeoutMs: RESOLUTION_PHASE_TRANSACTION_TIMEOUT_MS }
      );
      if (result.createdCheckpoint) this.maybeFailAfterCheckpoint(result);
      if (result.done) return result.summary;
    }
    throw new Error(`RESOLUTION_CHECKPOINT_LOOP_EXCEEDED:${windowId}`);
  }

  private async resolvePhaseTx(tx: Tx, windowId: string, fence?: { taskId: string; leaseOwner: string; leaseVersion: number }) {
    await this.assertTaskFence(tx, fence);
    const window = await tx.actionWindow.findUnique({
      where: { id: windowId },
      include: {
        run: { include: { roles: true, players: { where: { status: "active" } }, roleControls: true } },
        node: true,
        participants: true,
        interactionRequests: true
      }
    });
    if (!window) throw new NotFoundException({ code: "WINDOW_NOT_FOUND", message: "Action window not found" });
    if (!["CLOSING", "RESOLVING", "PROJECTING", "RESOLVED"].includes(window.status)) {
      throw new ConflictException({ code: "WINDOW_NOT_RESOLVABLE", message: `Window is ${window.status}` });
    }
    const stageIndex = window.node.nodeIndex;
    const gameContent = this.content.forGame(window.run.templateKey, window.run.strategyVersion);
    const contentPackage = gameContent.package();
    const finalStageIndex = Math.max(...contentPackage.manifest.stageCoverage);
    const stage = gameContent.stage(stageIndex);
    const rolesById = new Map(window.run.roles.map((role) => [role.id, role]));
    const rolesByKey = new Map(window.run.roles.map((role) => [role.roleKey, role]));
    const playableRoles = contentPackage.contract.playableRoleKeys.map((key) => rolesByKey.get(key)!).filter(Boolean);
    if (playableRoles.length !== contentPackage.contract.playableRoleKeys.length) throw new Error(`RUN_ROLE_CONTRACT_MISMATCH:${window.runId}`);
    const actions = await tx.playerAction.findMany({
      where: { nodeId: window.nodeId, actionSlot: { in: ["MAIN", "MANEUVER", "REACTION", "SYSTEM_ACTION"] }, status: "accepted" },
      orderBy: [{ actionSlot: "asc" }, { roleId: "asc" }, { id: "asc" }]
    });
    const mains = actions.filter((action): action is typeof action & { roleId: string } => action.actionSlot === "MAIN" && action.roleId !== null);
    if (mains.length !== playableRoles.length || mains.some((action) => !action.roleId) || new Set(mains.map((action) => action.roleId)).size !== playableRoles.length) {
      throw new ConflictException({ code: "RESOLUTION_INPUT_INCOMPLETE", message: `Exactly ${playableRoles.length} distinct MAIN actions are required` });
    }
    if (actions.filter((action) => action.actionSlot === "SYSTEM_ACTION").length !== 1) {
      throw new ConflictException({ code: "RESOLUTION_INPUT_INCOMPLETE", message: "Exactly one SYSTEM_ACTION is required" });
    }
    if (window.interactionRequests.some((request) => request.status === "OPEN")) {
      throw new ConflictException({ code: "REACTION_INPUT_INCOMPLETE", message: "Open directed requests must be finalized before resolution" });
    }
    const rulesInput = actions.map((action) => ({
      id: action.id, roleId: action.roleId, slot: action.actionSlot, actionKey: action.actionKey,
      actorKind: action.actorKind, controlEpoch: action.controlEpoch, requestHash: action.requestHash,
      targetRoleId: action.targetRoleId, leverageKey: action.leverageKey, normalizedJson: action.normalizedJson
    }));
    const rulesInputHash = sha256Canonical(rulesInput);
    let workflow = await tx.resolutionWorkflow.findUnique({ where: { windowId }, include: { checkpoints: true } });
    if (!workflow) {
      workflow = await tx.resolutionWorkflow.create({
        data: { runId: window.runId, windowId, nodeId: window.nodeId, status: "RUNNING", rulesInputHash },
        include: { checkpoints: true }
      });
    } else if (workflow.rulesInputHash !== rulesInputHash) {
      throw new ConflictException({ code: "RESOLUTION_INPUT_DRIFT", message: "Sealed resolution input changed after workflow creation" });
    }
    const checkpointByKey = new Map(workflow.checkpoints.map((entry) => [entry.checkpointKey, entry]));

    const rulesCheckpoint = checkpointByKey.get("RULES_APPLIED");
    let rulesOutput = workflow.rulesOutputJson as Record<string, any> | null;
    if (!rulesCheckpoint) {
      const influenceEdges: Array<Record<string, unknown>> = [];
      for (const action of mains) {
        const role = rolesById.get(action.roleId!)!;
        const normalized = (action.normalizedJson || {}) as Record<string, any>;
        const configuredEdges = Array.isArray(normalized.effect?.influenceEdges) ? normalized.effect.influenceEdges : [];
        const fallbackTarget = playableRoles[(playableRoles.findIndex((candidate) => candidate.id === role.id) + 1) % playableRoles.length];
        const edges = configuredEdges.length ? configuredEdges : [{ affectedRoleKey: fallbackTarget.roleKey, effectKey: `${stage.stageKey}:pressure_from:${role.roleKey}`, visibility: "OBSERVABLE" }];
        for (const edge of edges) {
          const target = rolesByKey.get(String(edge.affectedRoleKey));
          if (!target || target.id === role.id) continue;
          influenceEdges.push({
            originActionId: action.id, sourceRoleId: role.id, sourceRoleKey: role.roleKey,
            affectedRoleId: target.id, affectedRoleKey: target.roleKey,
            effectKey: String(edge.effectKey), visibility: String(edge.visibility || "OBSERVABLE").toUpperCase()
          });
        }
      }
      influenceEdges.sort((left, right) => sha256Canonical(left).localeCompare(sha256Canonical(right)));
      if (new Set(influenceEdges.map((edge) => edge.sourceRoleId)).size < stage.minimumDistinctPlayableInfluenceSources) {
        throw new ConflictException({ code: "CAUSAL_EDGE_INCOMPLETE", message: "Resolution lacks two distinct playable influence sources" });
      }
      const factKeys = [...new Set(actions.flatMap((action) => factKeysFromAction(action.normalizedJson)))].sort();
      const facts: Array<{ factKey: string; visibility: string; sourceActionIds: string[]; knownByRoleIds: string[] }> = [];
      for (const factKey of factKeys) {
        const definition = stage.factCatalog.find((entry) => entry.factKey === factKey);
        const visibility = String(definition?.visibility || "OBSERVABLE").toUpperCase();
        const sourceActions = actions.filter((action) => factKeysFromAction(action.normalizedJson).includes(factKey));
        const sourceRoleIds = sourceActions.map((action) => action.roleId).filter((roleId): roleId is string => Boolean(roleId && playableRoles.some((role) => role.id === roleId)));
        const limitedTargetRoleIds = influenceEdges
          .filter((edge) => sourceActions.some((action) => action.id === edge.originActionId))
          .map((edge) => String(edge.affectedRoleId));
        const knownByRoleIds = visibility === "PUBLIC" || visibility === "OBSERVABLE"
          ? playableRoles.map((role) => role.id)
          : visibility === "LIMITED"
            ? [...new Set([...sourceRoleIds, ...limitedTargetRoleIds])]
            : [...new Set(sourceRoleIds)];
        const descriptor = { factKey, visibility, sourceActionIds: sourceActions.map((action) => action.id).sort(), knownByRoleIds: [...knownByRoleIds].sort() };
        facts.push(descriptor);
        await tx.canonFact.upsert({
          where: { runId_factKey: { runId: window.runId, factKey } },
          update: {
            content: `${stage.title}形成事实：${factKey}`, status: "confirmed", visibility: visibility.toLowerCase(),
            sourceActionIdsJson: descriptor.sourceActionIds as Prisma.InputJsonValue,
            knownByRoleIdsJson: descriptor.knownByRoleIds as Prisma.InputJsonValue
          },
          create: {
            runId: window.runId, sourceNodeId: window.nodeId, factKey,
            content: `${stage.title}形成事实：${factKey}`, status: "confirmed", visibility: visibility.toLowerCase(),
            sourceEventIdsJson: [] as Prisma.InputJsonValue,
            sourceActionIdsJson: descriptor.sourceActionIds as Prisma.InputJsonValue,
            knownByRoleIdsJson: descriptor.knownByRoleIds as Prisma.InputJsonValue
          }
        });
      }
      for (const action of actions) {
        const ownEdges = influenceEdges.filter((edge) => edge.originActionId === action.id
          || (edge.affectedRoleId === action.roleId && String(edge.visibility) !== "PRIVATE"));
        const authorizedFactKeys = action.roleId ? facts.filter((fact) => fact.knownByRoleIds.includes(action.roleId!)).map((fact) => fact.factKey) : [];
        await tx.playerAction.update({
          where: { id: action.id },
          data: { resolvedAt: new Date(), resolvedJson: { stageKey: stage.stageKey, influenceEdges: ownEdges, factKeys: authorizedFactKeys } as Prisma.InputJsonValue }
        });
      }
      const resultRules = contentPackage.resultRules;
      const publicRule = resultRules.publicStageRules.find((rule) => rule.stageKey === stage.stageKey)!;
      const publicContent = `${publicRule.summary} 三方行动形成 ${influenceEdges.length} 条可追溯影响，局势进入「${publicRule.outcomeStateKey}」。`;
      rulesOutput = {
        schemaVersion: "resolution_rules_output_v1", stageIndex, stageKey: stage.stageKey,
        contentVersion: contentPackage.manifest.contentVersion,
        facts, factKeys, publicFactKeys: facts.filter((fact) => fact.visibility === "PUBLIC").map((fact) => fact.factKey),
        influenceEdges, actionIds: actions.map((action) => action.id),
        publicContent, outcomeStateKey: publicRule.outcomeStateKey, nextStateKey: stage.nextStateKey,
        score: actions.length
      };
      await tx.resolutionWorkflow.update({ where: { id: workflow.id }, data: { status: "RUNNING", rulesOutputJson: rulesOutput as Prisma.InputJsonValue } });
      const created = await this.writeCheckpoint(tx, workflow.id, "RULES_APPLIED", rulesOutput, "RESOLUTION_WORKFLOW", workflow.id);
      return this.phaseResult(window, "RULES_APPLIED", created);
    }
    if (!rulesOutput) throw new Error(`RESOLUTION_RULES_OUTPUT_MISSING:${workflow.id}`);
    this.assertCheckpoint(rulesCheckpoint, rulesOutput, "RESOLUTION_WORKFLOW", workflow.id);

    const publicCheckpoint = checkpointByKey.get("PUBLIC_PROJECTED");
    let resolution = workflow.resolutionId ? await tx.directorResolution.findUnique({ where: { id: workflow.resolutionId } }) : null;
    let publicEntry = await tx.narrativeEntry.findUnique({ where: { dedupeKey: `STAGE_PUBLIC_RESULT:${window.id}` } });
    if (!publicCheckpoint) {
      if (!resolution) {
        resolution = await tx.directorResolution.upsert({
          where: { nodeId: window.nodeId }, update: {}, create: {
            runId: window.runId, nodeId: window.nodeId, chapterIndex: window.node.chapterIndex,
            summary: String(rulesOutput.publicContent), publicNarration: String(rulesOutput.publicContent),
            privateResultsJson: playableRoles.map((role) => ({ roleId: role.id, stageIndex })) as Prisma.InputJsonValue,
            actionResultsJson: actions.map((action) => ({ actionId: action.id, roleId: action.roleId, slot: action.actionSlot })) as Prisma.InputJsonValue,
            statePatchJson: { outcomeStateKey: rulesOutput.outcomeStateKey } as Prisma.InputJsonValue,
            clueChangesJson: rulesOutput.factKeys as Prisma.InputJsonValue,
            relationChangesJson: rulesOutput.influenceEdges as Prisma.InputJsonValue,
            dangerBefore: window.run.dangerLevel,
            dangerAfter: Math.min(window.run.maxDangerLevel, window.run.dangerLevel + 1),
            nextNodeHook: String(rulesOutput.nextStateKey), nextOptionsJson: [] as Prisma.InputJsonValue
          }
        });
      }
      if (resolution.summary !== String(rulesOutput.publicContent)) throw new Error(`RESOLUTION_OUTPUT_DRIFT:${resolution.id}`);
      await tx.resolutionWorkflow.update({ where: { id: workflow.id }, data: { resolutionId: resolution.id } });
      if (!publicEntry) {
        publicEntry = await tx.narrativeEntry.create({ data: {
          runId: window.runId, nodeId: window.nodeId, resolutionId: resolution.id,
          entryType: "stage_public_result", visibility: "public", content: String(rulesOutput.publicContent),
          factKeysJson: rulesOutput.publicFactKeys as Prisma.InputJsonValue,
          threadKeysJson: [String(rulesOutput.nextStateKey)] as Prisma.InputJsonValue,
          sourceEventIdsJson: [] as Prisma.InputJsonValue, dedupeKey: `STAGE_PUBLIC_RESULT:${window.id}`
        } });
      }
      const descriptor = { resolutionId: resolution.id, narrativeEntryId: publicEntry.id, publicFactKeys: rulesOutput.publicFactKeys };
      const created = await this.writeCheckpoint(tx, workflow.id, "PUBLIC_PROJECTED", descriptor, "NARRATIVE_ENTRY", publicEntry.id);
      return this.phaseResult(window, "PUBLIC_PROJECTED", created);
    }
    if (!resolution || !publicEntry) throw new Error(`PUBLIC_PROJECTION_MISSING:${workflow.id}`);
    this.assertCheckpoint(publicCheckpoint, { resolutionId: resolution.id, narrativeEntryId: publicEntry.id, publicFactKeys: rulesOutput.publicFactKeys }, "NARRATIVE_ENTRY", publicEntry.id);

    const facts = Array.isArray(rulesOutput.facts) ? rulesOutput.facts as Array<{ factKey: string; knownByRoleIds: string[] }> : [];
    for (const role of playableRoles) {
      const key = `ROLE_PROJECTED:${role.id}`;
      const roleCheckpoint = checkpointByKey.get(key);
      let personalEntry = await tx.narrativeEntry.findUnique({ where: { dedupeKey: `STAGE_PERSONAL_RESULT:${window.id}:${role.id}` } });
      const personalRule = contentPackage.resultRules.personalStageRules.find((rule) => rule.stageKey === stage.stageKey && rule.roleKey === role.roleKey)!;
      const affected = (rulesOutput.influenceEdges as Array<Record<string, unknown>>).filter((edge) => edge.affectedRoleId === role.id || edge.sourceRoleId === role.id);
      const content = `${personalRule.summary} 你的行动与他人选择形成 ${affected.length} 条与你有关的因果影响。`;
      const personalFactKeys = personalRule.candidateFactKeys.filter((factKey) => facts.some((fact) => fact.factKey === factKey && fact.knownByRoleIds.includes(role.id)));
      if (!roleCheckpoint) {
        if (!personalEntry) personalEntry = await tx.narrativeEntry.create({ data: {
          runId: window.runId, nodeId: window.nodeId, resolutionId: resolution.id, roleId: role.id,
          entryType: "stage_personal_result", visibility: "private", content,
          factKeysJson: personalFactKeys as Prisma.InputJsonValue,
          threadKeysJson: [String(rulesOutput.nextStateKey)] as Prisma.InputJsonValue,
          sourceEventIdsJson: [] as Prisma.InputJsonValue, dedupeKey: `STAGE_PERSONAL_RESULT:${window.id}:${role.id}`
        } });
        if (personalEntry.content !== content) throw new Error(`ROLE_PROJECTION_DRIFT:${personalEntry.id}`);
        const descriptor = { roleId: role.id, narrativeEntryId: personalEntry.id, factKeys: personalFactKeys };
        const created = await this.writeCheckpoint(tx, workflow.id, key, descriptor, "NARRATIVE_ENTRY", personalEntry.id);
        return this.phaseResult(window, key, created, false, undefined, playableRoles.indexOf(role) + 1);
      }
      if (!personalEntry) throw new Error(`ROLE_PROJECTION_MISSING:${key}`);
      this.assertCheckpoint(roleCheckpoint, { roleId: role.id, narrativeEntryId: personalEntry.id, factKeys: personalFactKeys }, "NARRATIVE_ENTRY", personalEntry.id);
    }

    const publishedKey = "PUBLISHED";
    const publishedCheckpoint = checkpointByKey.get(publishedKey);
    const personalEntries = await tx.narrativeEntry.findMany({
      where: { runId: window.runId, nodeId: window.nodeId, entryType: "stage_personal_result" }, orderBy: { roleId: "asc" }
    });
    if (personalEntries.length !== playableRoles.length) throw new Error(`PERSONAL_PROJECTION_COUNT_INVALID:${personalEntries.length}`);
    const publishedDescriptor = { resolutionId: resolution.id, publicEntryId: publicEntry.id, personalEntryIds: personalEntries.map((entry) => entry.id).sort() };
    if (!publishedCheckpoint) {
      if (window.node.status !== "resolved") await tx.sceneNode.update({ where: { id: window.nodeId }, data: { status: "resolved", resolvedAt: new Date(), resolutionId: resolution.id } });
      if (window.status !== "PROJECTING" && window.status !== "RESOLVED") {
        await tx.actionWindow.update({ where: { id: window.id }, data: { status: "PROJECTING", version: { increment: 1 }, projectionVersion: { increment: 1 } } });
      }
      const created = await this.writeCheckpoint(tx, workflow.id, publishedKey, publishedDescriptor, "DIRECTOR_RESOLUTION", resolution.id);
      return this.phaseResult(window, publishedKey, created);
    }
    this.assertCheckpoint(publishedCheckpoint, publishedDescriptor, "DIRECTOR_RESOLUTION", resolution.id);

    const terminalKey = stageIndex === finalStageIndex ? "RUN_COMPLETED" : "NEXT_WINDOW_OPENED";
    const terminalCheckpoint = checkpointByKey.get(terminalKey);
    if (!terminalCheckpoint) {
      let terminalDescriptor: Record<string, unknown>;
      if (stageIndex === finalStageIndex) {
        await this.publishFinalEndings(tx, gameContent, window.runId, window.nodeId, resolution.id, playableRoles, Number(rulesOutput.score || actions.length), finalStageIndex);
        if (window.status !== "RESOLVED") await tx.actionWindow.update({ where: { id: window.id }, data: { status: "RESOLVED", resolvedAt: new Date(), version: { increment: 1 }, projectionVersion: { increment: 1 } } });
        if (window.run.status !== "chapter_generated") await tx.storyRun.update({ where: { id: window.runId }, data: {
          status: "chapter_generated",
          completedNodeCount: finalStageIndex,
          chapterCount: 1,
          currentDay: finalStageIndex,
          freeDecisionsUsed: freeRoundsUsedAfterStage(window.run.freeDecisionsUsed, stageIndex),
          version: { increment: 1 }
        } });
        const endings = await tx.narrativeEntry.findMany({ where: { runId: window.runId, entryType: { in: ["final_public_ending", "final_personal_ending"] } }, orderBy: { id: "asc" } });
        const window8Count = await tx.actionWindow.count({ where: { runId: window.runId, node: { nodeIndex: { gt: finalStageIndex } } } });
        if (endings.length !== playableRoles.length + 1 || window8Count !== 0) throw new Error(`RUN_TERMINAL_INVARIANT_FAILED:${endings.length}:${window8Count}`);
        terminalDescriptor = { stageIndex: finalStageIndex, runId: window.runId, status: "chapter_generated", endingEntryIds: endings.map((entry) => entry.id).sort(), window8Count };
      } else {
        const nextStageIndex = stageIndex + 1;
        const nextStage = gameContent.stage(nextStageIndex);
        let nextNode = await tx.sceneNode.findUnique({ where: { runId_chapterIndex_nodeIndex: { runId: window.runId, chapterIndex: 1, nodeIndex: nextStageIndex } } });
        if (!nextNode) nextNode = await tx.sceneNode.create({ data: {
          runId: window.runId, chapterIndex: 1, nodeIndex: nextStageIndex, title: nextStage.title,
          publicNarration: `${nextStage.title}开始，三方将围绕${nextStage.commonContest.title}继续行动。`,
          nodeGoal: nextStage.commonContest.description, actionOptionsJson: [] as Prisma.InputJsonValue, status: "open_for_actions"
        } });
        const freeRoundLimit = Number(process.env.CREDIT_FREE_DECISION_LIMIT || 3);
        const requiresUnlock = window.run.accessLevel !== "UNLOCKED" && nextStageIndex > freeRoundLimit;
        const nextWindow = await this.createNextWindow(tx, gameContent, window, nextNode, nextStageIndex, requiresUnlock);
        if (!requiresUnlock) await this.roleAgents.enqueueForWindow(tx, nextWindow.id);
        if (window.status !== "RESOLVED") await tx.actionWindow.update({ where: { id: window.id }, data: { status: "RESOLVED", resolvedAt: new Date(), version: { increment: 1 }, projectionVersion: { increment: 1 } } });
        await tx.storyRun.update({ where: { id: window.runId }, data: {
          currentNodeId: nextNode.id, currentDay: nextStageIndex, completedNodeCount: stageIndex,
          status: requiresUnlock ? "WAITING_FOR_HUMAN_UNLOCK" : "playing",
          freeDecisionsUsed: freeRoundsUsedAfterStage(window.run.freeDecisionsUsed, stageIndex, freeRoundLimit),
          ...(
            window.run.accessLevel !== "UNLOCKED"
            && stageIndex >= freeRoundLimit
            && !window.run.paywallReachedAt
              ? { paywallReachedAt: new Date() }
              : {}
          ),
          dangerLevel: Math.min(window.run.maxDangerLevel, window.run.dangerLevel + 1), version: { increment: 1 }
        } });
        terminalDescriptor = { stageIndex, nextNodeId: nextNode.id, nextWindowId: nextWindow.id };
      }
      await this.deliveries.publish(tx, {
        runId: window.runId, day: stageIndex, type: stageIndex === finalStageIndex ? "RUN_COMPLETED" : "STAGE_RESOLVED",
        visibility: "PUBLIC", audienceType: "ALL_MEMBERS",
        audienceUserIds: window.run.players.map((player) => player.userId).filter((id): id is string => Boolean(id)),
        payload: { stageIndex, windowId: window.id, publicSummary: String(rulesOutput.publicContent) },
        dedupeKey: `${stageIndex === finalStageIndex ? "RUN_COMPLETED" : "STAGE_RESOLVED"}:${window.id}`
      });
      const created = await this.writeCheckpoint(tx, workflow.id, terminalKey, terminalDescriptor, stageIndex === finalStageIndex ? "STORY_RUN" : "ACTION_WINDOW", stageIndex === finalStageIndex ? window.runId : String(terminalDescriptor.nextWindowId));
      await tx.resolutionWorkflow.update({ where: { id: workflow.id }, data: { status: "COMPLETED", completedAt: new Date(), version: { increment: 1 } } });
      await this.validateTerminalWorkflow(tx, workflow.id, playableRoles.map((role) => role.id), stageIndex, finalStageIndex, contentPackage.manifest.stageCoverage.length, window.runId, window.id);
      return this.phaseResult(window, terminalKey, created, true, { runId: window.runId, windowId: window.id, stageIndex, status: terminalKey });
    }

    const terminalDescriptor = await this.readTerminalDescriptor(tx, window.runId, window.id, stageIndex, finalStageIndex);
    this.assertCheckpoint(terminalCheckpoint, terminalDescriptor, stageIndex === finalStageIndex ? "STORY_RUN" : "ACTION_WINDOW", stageIndex === finalStageIndex ? window.runId : String(terminalDescriptor.nextWindowId));
    await this.validateTerminalWorkflow(tx, workflow.id, playableRoles.map((role) => role.id), stageIndex, finalStageIndex, contentPackage.manifest.stageCoverage.length, window.runId, window.id);
    return this.phaseResult(window, terminalKey, false, true, { runId: window.runId, windowId: window.id, stageIndex, status: terminalKey });
  }

  private phaseResult(window: { id: string; runId: string; node: { nodeIndex: number } }, checkpointKey: string, createdCheckpoint: boolean, done = false, summary?: Record<string, unknown>, checkpointOrdinal?: number) {
    return { windowId: window.id, runId: window.runId, stageIndex: window.node.nodeIndex, checkpointKey, checkpointOrdinal, createdCheckpoint, done, summary };
  }

  private async assertTaskFence(tx: Tx, fence?: { taskId: string; leaseOwner: string; leaseVersion: number }) {
    if (!fence) return;
    const now = new Date();
    // The fence is renewed at the beginning of every serializable phase. It
    // must remain valid for the full transaction plus network/commit latency;
    // otherwise a successful terminal phase can commit while the outbox lease
    // has already expired, forcing an unnecessary second claim.
    const leaseMs = normalizeResolutionTaskLeaseMs(process.env.STORY_TASK_LEASE_MS);
    const renewed = await tx.storyTaskOutbox.updateMany({
      where: { id: fence.taskId, status: "running", leaseOwner: fence.leaseOwner, leaseVersion: fence.leaseVersion, leaseExpiresAt: { gt: now } },
      data: { leaseExpiresAt: new Date(now.getTime() + leaseMs) }
    });
    if (renewed.count !== 1) throw Object.assign(new Error("STALE_TASK_LEASE"), { code: "STALE_TASK_LEASE" });
  }

  private async writeCheckpoint(tx: Tx, workflowId: string, checkpointKey: string, output: unknown, outputRefType: string, outputRefId: string) {
    const contentHash = sha256Canonical(output);
    const existing = await tx.resolutionCheckpoint.findUnique({ where: { workflowId_checkpointKey: { workflowId, checkpointKey } } });
    if (existing) {
      this.assertCheckpoint(existing, output, outputRefType, outputRefId);
      return false;
    }
    await tx.resolutionCheckpoint.create({ data: { workflowId, checkpointKey, contentHash, outputRefType, outputRefId } });
    return true;
  }

  private assertCheckpoint(checkpoint: { checkpointKey: string; contentHash: string; outputRefType: string | null; outputRefId: string | null }, output: unknown, outputRefType: string, outputRefId: string) {
    if (checkpoint.contentHash !== sha256Canonical(output) || checkpoint.outputRefType !== outputRefType || checkpoint.outputRefId !== outputRefId) {
      throw new Error(`CHECKPOINT_OUTPUT_DRIFT:${checkpoint.checkpointKey}`);
    }
  }

  private async readTerminalDescriptor(tx: Tx, runId: string, windowId: string, stageIndex: number, finalStageIndex: number) {
    if (stageIndex === finalStageIndex) {
      const endings = await tx.narrativeEntry.findMany({ where: { runId, entryType: { in: ["final_public_ending", "final_personal_ending"] } }, orderBy: { id: "asc" } });
      const window8Count = await tx.actionWindow.count({ where: { runId, node: { nodeIndex: { gt: finalStageIndex } } } });
      return { stageIndex: finalStageIndex, runId, status: "chapter_generated", endingEntryIds: endings.map((entry) => entry.id).sort(), window8Count };
    }
    const nextNode = await tx.sceneNode.findUniqueOrThrow({ where: { runId_chapterIndex_nodeIndex: { runId, chapterIndex: 1, nodeIndex: stageIndex + 1 } } });
    const nextWindow = await tx.actionWindow.findUniqueOrThrow({ where: { nodeId: nextNode.id } });
    return { stageIndex, nextNodeId: nextNode.id, nextWindowId: nextWindow.id };
  }

  private async validateTerminalWorkflow(
    tx: Tx,
    workflowId: string,
    roleIds: string[],
    stageIndex: number,
    finalStageIndex: number,
    expectedWindowCount: number,
    runId: string,
    windowId: string
  ) {
    const workflow = await tx.resolutionWorkflow.findUniqueOrThrow({ where: { id: workflowId }, include: { checkpoints: true } });
    const expected = new Set(["RULES_APPLIED", "PUBLIC_PROJECTED", ...roleIds.map((roleId) => `ROLE_PROJECTED:${roleId}`), "PUBLISHED", stageIndex === finalStageIndex ? "RUN_COMPLETED" : "NEXT_WINDOW_OPENED"]);
    const actual = new Set(workflow.checkpoints.map((entry) => entry.checkpointKey));
    if (workflow.status !== "COMPLETED" || actual.size !== expected.size || [...expected].some((key) => !actual.has(key)) || [...actual].some((key) => !expected.has(key))) {
      throw new Error(`RESOLUTION_WORKFLOW_INCOMPLETE:${workflowId}`);
    }
    if (!workflow.resolutionId) throw new Error(`RESOLUTION_REFERENCE_MISSING:${workflowId}`);

    const sourceWindow = await tx.actionWindow.findUniqueOrThrow({ where: { id: windowId }, include: { node: true } });
    if (sourceWindow.runId !== runId || sourceWindow.status !== "RESOLVED" || sourceWindow.node.status !== "resolved" || sourceWindow.node.resolutionId !== workflow.resolutionId) {
      throw new Error(`RESOLUTION_TERMINAL_SOURCE_INVALID:${workflowId}`);
    }

    const run = await tx.storyRun.findUniqueOrThrow({ where: { id: runId } });
    if (stageIndex === finalStageIndex) {
      const endings = await tx.narrativeEntry.findMany({
        where: { runId, entryType: { in: ["final_public_ending", "final_personal_ending"] } },
        select: { entryType: true, roleId: true }
      });
      const windowCount = await tx.actionWindow.count({ where: { runId } });
      const hasOnePublic = endings.filter((entry) => entry.entryType === "final_public_ending" && entry.roleId === null).length === 1;
      const personalRoleIds = endings.filter((entry) => entry.entryType === "final_personal_ending").map((entry) => entry.roleId).filter((roleId): roleId is string => Boolean(roleId));
      if (run.status !== "chapter_generated" || run.currentDay !== finalStageIndex || run.completedNodeCount !== finalStageIndex || run.chapterCount !== 1 || windowCount !== expectedWindowCount || endings.length !== roleIds.length + 1 || !hasOnePublic || new Set(personalRoleIds).size !== roleIds.length) {
        throw new Error(`RUN_TERMINAL_STATE_INVALID:${runId}`);
      }
      return;
    }

    const nextNode = await tx.sceneNode.findUniqueOrThrow({
      where: { runId_chapterIndex_nodeIndex: { runId, chapterIndex: 1, nodeIndex: stageIndex + 1 } }
    });
    const nextWindow = await tx.actionWindow.findUniqueOrThrow({
      where: { nodeId: nextNode.id },
      include: { openingProjections: true, participants: true }
    });
    const openingRoleIds = new Set(nextWindow.openingProjections.map((entry) => entry.roleId));
    const participantRoleIds = new Set(nextWindow.participants.map((entry) => entry.roleId));
    const systemActionCount = await tx.playerAction.count({ where: { nodeId: nextNode.id, actionSlot: "SYSTEM_ACTION", actorKind: "SYSTEM", status: "accepted" } });
    if (nextWindow.runId !== runId || nextWindow.openingProjections.length !== roleIds.length || nextWindow.participants.length !== roleIds.length || roleIds.some((roleId) => !openingRoleIds.has(roleId) || !participantRoleIds.has(roleId)) || systemActionCount !== 1 || run.currentDay < stageIndex + 1) {
      throw new Error(`NEXT_WINDOW_TERMINAL_STATE_INVALID:${workflowId}`);
    }
  }
  private maybeFailAfterCheckpoint(result: { checkpointKey: string; checkpointOrdinal?: number; runId: string; windowId: string; stageIndex: number; createdCheckpoint: boolean }) {
    if (!result.createdCheckpoint) return;
    const targetKey = String(process.env.FAIL_AFTER_CHECKPOINT || "");
    const symbolicRole = /^ROLE_PROJECTED:(\d+)$/.exec(targetKey);
    const keyMatches = symbolicRole
      ? result.checkpointKey.startsWith("ROLE_PROJECTED:") && result.checkpointOrdinal === Number(symbolicRole[1])
      : targetKey === result.checkpointKey;
    if (!targetKey || !keyMatches) return;
    const targetRun = String(process.env.FAIL_AFTER_CHECKPOINT_RUN_ID || "");
    const targetWindow = String(process.env.FAIL_AFTER_CHECKPOINT_WINDOW_ID || "");
    const targetStage = Number(process.env.FAIL_AFTER_CHECKPOINT_STAGE || 0);
    if (targetRun && targetRun !== result.runId) return;
    if (targetWindow && targetWindow !== result.windowId) return;
    if (targetStage && targetStage !== result.stageIndex) return;
    if (process.env.NODE_ENV === "production" || process.env.STORY_WORKER_PROCESS !== "true") throw new Error("FAULT_INJECTION_REQUIRES_INDEPENDENT_NON_PRODUCTION_WORKER");
    throw Object.assign(new Error(`Injected checkpoint exit after ${result.checkpointKey}`), { code: "INJECTED_CHECKPOINT_EXIT", checkpointKey: result.checkpointKey, exitCode: 86 });
  }
  private async createNextWindow(
    tx: Tx,
    content: BoundContinuousStrategyContent,
    priorWindow: { runId: string; run: { roles: Array<{ id: string; roleKey: string }>; players: Array<{ roleId: string | null; userId: string | null }>; roleControls: Array<any> } },
    node: { id: string; nodeIndex: number },
    stageIndex: number,
    requiresUnlock: boolean
  ) {
    const stage = content.stage(stageIndex);
    const timing = timingConfig();
    const now = new Date();
    const expectedWindow = {
      runId: priorWindow.runId,
      nodeId: node.id,
      status: requiresUnlock ? "PREPARING" : "MAIN_OPEN",
      mainOpenedAt: requiresUnlock ? null : now,
      mainClosesAt: requiresUnlock ? null : new Date(now.getTime() + timing.mainSeconds * 1_000),
      openingSnapshotVersion: 1,
      projectionVersion: 1,
      configJson: { timing, stageKey: stage.stageKey, contentVersion: content.package().manifest.contentVersion } as Prisma.InputJsonValue
    };
    let window = await tx.actionWindow.findUnique({ where: { nodeId: node.id } });
    if (!window) window = await tx.actionWindow.create({ data: expectedWindow });
    if (window.runId !== priorWindow.runId) throw new Error(`NEXT_WINDOW_RUN_DRIFT:${window.id}`);    const roleByKey = new Map(priorWindow.run.roles.map((role) => [role.roleKey, role]));
    const priorFacts = await tx.canonFact.findMany({ where: { runId: priorWindow.runId, status: "confirmed" }, select: { factKey: true, knownByRoleIdsJson: true } });
    for (const roleKey of content.package().contract.playableRoleKeys) {
      const role = roleByKey.get(roleKey)!;
      const roleStage = content.roleStage(stageIndex, roleKey);
      const projection = {
        schemaVersion: "continuous_opening_projection_v1",
        stageIndex,
        stageKey: stage.stageKey,
        title: stage.title,
        roleId: role.id,
        roleKey,
        privateBrief: roleStage.privateBrief,
        personalPressure: roleStage.personalPressure,
        knownFactIds: priorFacts.filter((fact) => Array.isArray(fact.knownByRoleIdsJson) && fact.knownByRoleIdsJson.includes(role.id)).map((fact) => fact.factKey),
        mainCards: roleStage.mainCards.map((card) => ({ actionKey: card.actionKey, title: card.title, description: card.objective, targetRoleKey: card.targetRoleKey }))
      };
      const projectionHash = sha256Canonical(projection);
      const existingOpening = await tx.actionWindowOpeningProjection.findUnique({ where: { windowId_roleId: { windowId: window.id, roleId: role.id } } });
      if (!existingOpening) {
        await tx.actionWindowOpeningProjection.create({ data: { windowId: window.id, roleId: role.id, snapshotVersion: 1, projectionJson: projection as Prisma.InputJsonValue, contentHash: projectionHash } });
      } else if (existingOpening.contentHash !== projectionHash || existingOpening.snapshotVersion !== 1) {
        throw new Error(`NEXT_WINDOW_OPENING_DRIFT:${window.id}:${role.id}`);
      }
      await tx.actionWindowParticipant.upsert({ where: { windowId_roleId: { windowId: window.id, roleId: role.id } }, update: {}, create: { windowId: window.id, roleId: role.id } });      const control = priorWindow.run.roleControls.find((candidate) => candidate.roleId === role.id)!;
      if (control.mode === "HUMAN_RECLAIM_PENDING") {
        await tx.roleControl.update({
          where: { id: control.id },
          data: { mode: "HUMAN_ACTIVE", reclaimAfterWindowId: null, reason: "RECLAIM_EFFECTIVE_NEXT_WINDOW", lastHeartbeatAt: now }
        });
        const transitionKey = `reclaim-effective:${window.id}:${control.id}:${control.epoch}`;
        await tx.roleControlTransition.upsert({
          where: { idempotencyKey: transitionKey },
          update: {},
          create: {
            roleControlId: control.id,
            fromMode: "HUMAN_RECLAIM_PENDING",
            toMode: "HUMAN_ACTIVE",
            fromEpoch: control.epoch,
            toEpoch: control.epoch,
            reason: "RECLAIM_EFFECTIVE_NEXT_WINDOW",
            initiatedByUserId: priorWindow.run.players.find((player) => player.roleId === role.id)?.userId,
            effectiveWindowId: window.id,
            effectiveSlot: "MAIN",
            idempotencyKey: transitionKey
          }
        });
        await this.deliveries.publish(tx, {
          runId: priorWindow.runId,
          day: stageIndex,
          type: "ROLE_CONTROL_CHANGED",
          visibility: "PUBLIC",
          audienceType: "ALL_MEMBERS",
          audienceUserIds: priorWindow.run.players.map((player) => player.userId).filter((id): id is string => Boolean(id)),
          audienceRoleIds: [role.id],
          payload: { roleId: role.id, controllerKind: "HUMAN", presence: "ONLINE" },
          dedupeKey: `ROLE_CONTROL_CHANGED:${transitionKey}`
        });
      }
      const policy = content.agentPolicy(stageIndex, roleKey);
      await tx.roleAgentPolicy.upsert({
        where: { runId_roleId_policyVersion: { runId: priorWindow.runId, roleId: role.id, policyVersion: policy.policyVersion } },
        update: {},
        create: {
          runId: priorWindow.runId,
          roleId: role.id,
          policyVersion: policy.policyVersion,
          promptVersion: "continuous_role_agent_prompt_v1",
          provider: String(process.env.ROLE_AGENT_PROVIDER || "rules"),
          modelName: String(process.env.ROLE_AGENT_MODEL || process.env.DEEPSEEK_MODEL || "deterministic-rules-v1"),
          goalsJson: policy.goals as Prisma.InputJsonValue,
          riskProfileJson: { profile: policy.riskProfile } as Prisma.InputJsonValue,
          assetPriorityJson: policy.assetPriority as Prisma.InputJsonValue,
          actionWeightsJson: policy.actionWeights as Prisma.InputJsonValue,
          fallbackBySlotJson: policy.fallbackBySlot as Prisma.InputJsonValue
        }
      });
    }
    // Every stage owns a separate resource catalog.  Stage one is initialized
    // at room start; subsequent stages must seed their ledger before any MAIN
    // card can be guarded or mutate that stage's leverage.
    for (const asset of stage.assetCatalog) {
      const owner = roleByKey.get(asset.initialOwnerRoleKey || content.package().contract.worldActorKey);
      await tx.roleAsset.upsert({
        where: { runId_assetKey: { runId: priorWindow.runId, assetKey: asset.assetKey } },
        update: {},
        create: {
          runId: priorWindow.runId,
          assetKey: asset.assetKey,
          kind: asset.kind,
          ownerRoleId: owner?.id || null,
          ownerActorKey: owner ? null : content.package().contract.worldActorKey,
          quantity: 1,
          visibility: "PRIVATE",
          stateJson: { stageKey: stage.stageKey, initialOwnerRoleKey: asset.initialOwnerRoleKey } as Prisma.InputJsonValue
        }
      });
    }
    const systemAction = content.package().systemActions.systemActions.find((entry) => entry.systemActionKey === stage.systemActionKey)!;
    await tx.playerAction.upsert({
      where: { idempotencyKey: `system:${window.id}:${systemAction.systemActionKey}` },
      update: {},
      create: {
        runId: priorWindow.runId,
        nodeId: node.id,
        chapterIndex: 1,
        roleId: null,
        playerType: "ai",
        actionType: "system_policy",
        targetText: stage.commonContest.title,
        method: systemAction.visiblePressure,
        intent: systemAction.nextStateKey,
        riskLevel: "normal",
        normalizedJson: systemAction as Prisma.InputJsonValue,
        guardStatus: "ok",
        auditStatus: "ok",
        status: "accepted",
        actionSlot: "SYSTEM_ACTION",
        actorKind: "SYSTEM",
        controlEpoch: 1,
        actionKey: systemAction.systemActionKey,
        idempotencyKey: `system:${window.id}:${systemAction.systemActionKey}`,
        requestHash: sha256Canonical(systemAction),
        visibility: "OBSERVABLE",
        sealedAt: now,
        immediateJson: { pressure: systemAction.visiblePressure } as Prisma.InputJsonValue
      }
    });
    return window;
  }

  private async publishFinalEndings(tx: Tx, content: BoundContinuousStrategyContent, runId: string, nodeId: string, resolutionId: string, roles: Array<{ id: string; roleKey: string }>, score: number, stageCount: number) {
    const rules = content.package().endingRules;
    const pick = (classifications: Array<{ endingKey: string; title: string; minimumScore: number }>) =>
      [...classifications].sort((a, b) => b.minimumScore - a.minimumScore).find((entry) => score >= entry.minimumScore) || classifications[0];
    const acceptedRoleActionRows = await tx.playerAction.findMany({
      where: {
        runId,
        roleId: { not: null },
        status: "accepted",
        actionSlot: { in: ["MAIN", "MANEUVER", "REACTION"] }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        roleId: true,
        node: { select: { nodeIndex: true } },
        actionSlot: true,
        method: true
      }
    });
    const acceptedRoleActions: EndingEvidenceAction[] = acceptedRoleActionRows
      .map((action) => ({
        roleId: action.roleId,
        stageIndex: action.node.nodeIndex,
        actionSlot: action.actionSlot,
        method: action.method
      }))
      .sort((left, right) => left.stageIndex - right.stageIndex);
    const global = pick(rules.globalEndingRule.classifications);
    await tx.narrativeEntry.upsert({
      where: { dedupeKey: `FINAL_PUBLIC_ENDING:${runId}` },
      update: {},
      create: {
        runId, nodeId, resolutionId, entryType: "final_public_ending", visibility: "public",
        content: buildFinalPublicEndingNarrative(global.title, stageCount, roles, acceptedRoleActions),
        factKeysJson: [global.endingKey] as Prisma.InputJsonValue,
        threadKeysJson: [`stage_count:${stageCount}`] as Prisma.InputJsonValue,
        sourceEventIdsJson: [] as Prisma.InputJsonValue,
        dedupeKey: `FINAL_PUBLIC_ENDING:${runId}`
      }
    });
    for (const role of roles) {
      const rule = rules.personalEndingRules.find((entry) => entry.roleKey === role.roleKey)!;
      const ending = pick(rule.classifications);
      await tx.narrativeEntry.upsert({
        where: { dedupeKey: `FINAL_PERSONAL_ENDING:${runId}:${role.id}` },
        update: {},
        create: {
          runId, nodeId, resolutionId, roleId: role.id, entryType: "final_personal_ending", visibility: "private",
          content: buildFinalPersonalEndingNarrative(
            ending.title,
            stageCount,
            acceptedRoleActions.filter((action) => action.roleId === role.id)
          ),
          factKeysJson: [ending.endingKey] as Prisma.InputJsonValue,
          threadKeysJson: [`stage_count:${stageCount}`] as Prisma.InputJsonValue,
          sourceEventIdsJson: [] as Prisma.InputJsonValue,
          dedupeKey: `FINAL_PERSONAL_ENDING:${runId}:${role.id}`
        }
      });
    }
  }

}

type EndingEvidenceAction = {
  roleId: string | null;
  stageIndex: number;
  actionSlot: string | null;
  method: string | null;
};

const INTERNAL_PLAYER_KEY = /\b(?:main|maneuver|reaction|system|state|asset|global|personal|internal)_[a-z0-9_]+\b/i;

export function buildFinalPublicEndingNarrative(
  title: string,
  stageCount: number,
  roles: Array<{ id: string }>,
  actions: EndingEvidenceAction[]
): string {
  const representativeActions = roles.flatMap((role) => {
    const roleActions = actions.filter((action) => action.roleId === role.id);
    const latestMain = [...roleActions].reverse().find((action) => action.actionSlot === "MAIN");
    const latestAction = roleActions.at(-1);
    return latestMain ? [latestMain] : latestAction ? [latestAction] : [];
  });
  const evidence = endingEvidenceDescriptions(representativeActions, roles.length || 3);
  const causalBasis = evidence.length
    ? `各角色最后采取${evidence.join("、")}等关键行动`
    : "各角色已经密封自己的关键行动";
  return `${cleanEndingTitle(title)}。经过 ${stageCount} 轮，${causalBasis}；这些选择造成的资源、证据与跨角色影响共同把局势推向这一结局。`;
}

export function buildFinalPersonalEndingNarrative(title: string, stageCount: number, actions: EndingEvidenceAction[]): string {
  const mainActions = actions.filter((action) => action.actionSlot === "MAIN");
  const maneuverActions = actions.filter((action) => action.actionSlot === "MANEUVER");
  const evidenceActions = [
    ...(mainActions[0] ? [mainActions[0]] : []),
    ...(mainActions.at(-1) ? [mainActions.at(-1)!] : []),
    ...(maneuverActions.at(-1) ? [maneuverActions.at(-1)!] : [])
  ];
  const evidence = endingEvidenceDescriptions(evidenceActions, 3);
  const causalBasis = evidence.length
    ? `你的行动链中，${evidence.join("、")}成为关键节点`
    : "你已经密封的角色选择形成了一条完整行动链";
  return `${cleanEndingTitle(title)}。经过 ${stageCount} 轮，${causalBasis}；它们造成的资源、证据与角色关系变化累计形成了这一角色结局。`;
}

export function endingEvidenceTitles(actions: EndingEvidenceAction[], limit: number): string[] {
  const titles: string[] = [];
  for (const action of actions) {
    const title = readableActionTitle(action.method);
    if (!title || titles.includes(title)) continue;
    titles.push(title);
    if (titles.length >= limit) break;
  }
  return titles;
}

function endingEvidenceDescriptions(actions: EndingEvidenceAction[], limit: number): string[] {
  const titles = endingEvidenceTitles(actions, limit);
  return titles.map((title) => {
    const source = actions.find((action) => readableActionTitle(action.method) === title);
    return source?.stageIndex ? `第 ${source.stageIndex} 轮“${title}”` : `“${title}”`;
  });
}

function readableActionTitle(value: string | null): string {
  const title = String(value || "").replace(/\s+/g, " ").trim().slice(0, 60);
  return !title || INTERNAL_PLAYER_KEY.test(title) ? "" : title;
}

function cleanEndingTitle(value: string): string {
  const title = String(value || "").replace(INTERNAL_PLAYER_KEY, "").replace(/\s+/g, " ").trim();
  return title || "本局结局已经落定";
}

function factKeysFromAction(value: Prisma.JsonValue | null): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const normalized = value as Record<string, any>;
  const candidates = [
    ...(Array.isArray(normalized.effect?.factKeys) ? normalized.effect.factKeys : []),
    ...(Array.isArray(normalized.factKeys) ? normalized.factKeys : []),
    ...(typeof normalized.option?.factKey === "string" ? [normalized.option.factKey] : [])
  ];
  return candidates.filter((entry): entry is string => typeof entry === "string");
}

function timingConfig() {
  const profile = String(process.env.CONTINUOUS_TIMING_PROFILE || "realtime");
  const profiles: Record<string, { mainSeconds: number; graceSeconds: number; graceMinimumSeconds: number; aiOnlyGraceSeconds: number }> = {
    realtime: { mainSeconds: 180, graceSeconds: 45, graceMinimumSeconds: 20, aiOnlyGraceSeconds: 2 },
    "manual-three-page": { mainSeconds: 1200, graceSeconds: 900, graceMinimumSeconds: 30, aiOnlyGraceSeconds: 2 },
    "automated-success": { mainSeconds: 240, graceSeconds: 120, graceMinimumSeconds: 20, aiOnlyGraceSeconds: 1 },
    "fault-acceptance": { mainSeconds: 90, graceSeconds: 45, graceMinimumSeconds: 8, aiOnlyGraceSeconds: 1 },
    timeout: { mainSeconds: 15, graceSeconds: 8, graceMinimumSeconds: 8, aiOnlyGraceSeconds: 1 }
  };
  return profiles[profile] || profiles.realtime;
}

export function freeRoundsUsedAfterStage(current: number, stageIndex: number, limit = Number(process.env.CREDIT_FREE_DECISION_LIMIT || 3)): number {
  const safeCurrent = Number.isInteger(current) && current > 0 ? current : 0;
  const safeStage = Number.isInteger(stageIndex) && stageIndex > 0 ? stageIndex : 0;
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 3;
  return Math.max(safeCurrent, Math.min(safeStage, safeLimit));
}
