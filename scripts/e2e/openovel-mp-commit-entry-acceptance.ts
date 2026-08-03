import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ContinuousStrategyContentService } from "../../apps/api/src/continuous-strategy/content.service";
import { ContinuousStoryV2Service } from "../../apps/api/src/continuous-story-v2/continuous-story-v2.service";

type Fixture = { runId: string; role: any; turn: any };
type Reservation = {
  runId: string;
  roleId: string;
  entryId: string;
  taskId: string;
  submissionId: string;
  observedWorldSequence: number;
};

const evidenceDir = path.resolve(requiredEnv("OPENOVEL_MP_EVIDENCE_DIR"));
const lane = requiredEnv("OPENOVEL_MP_LANE");

async function main() {
  if (!new Set(["concurrency", "fault"]).has(lane)) throw new Error(`COMMIT_ENTRY_LANE_INVALID:${lane}`);
  await mkdir(evidenceDir, { recursive: true });
  const prisma = new PrismaClient();
  const runPrefix = `openovel_commit_${lane}_${Date.now().toString(36)}`;
  const report: Record<string, unknown> = {
    schemaVersion: "openovel_mp_commit_entry_acceptance_v1",
    lane,
    status: "RUNNING",
    database: { provider: "postgresql", schema: process.env.OPENOVEL_MP_DB_SCHEMA, isolated: true },
    runPrefix,
    startedAt: new Date().toISOString()
  };
  try {
    report.result = lane === "concurrency"
      ? await verifyConcurrency(prisma, runPrefix)
      : await verifyFaultRecovery(prisma, runPrefix);
    report.status = "PASS";
    report.completedAt = new Date().toISOString();
    await persist(report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    report.status = "FAIL";
    report.message = redact(String((error as Error)?.message || error));
    report.failedAt = new Date().toISOString();
    await persist(report);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyConcurrency(prisma: PrismaClient, prefix: string) {
  const fixtures = await seed(prisma, `${prefix}_parallel`, 3);
  const service = storyService(prisma);
  const parallel = await Promise.all(fixtures.slice(0, 2).map((fixture, index) => reserve(service, fixture, `parallel-${index + 1}`)));
  const leased = await Promise.all(parallel.map((reservation) => lease(prisma, reservation)));
  const committed = await Promise.all(leased.map((value) => commit(storyService(prisma), prisma, value.reservation, value.fence)));
  const replayed = await Promise.all(leased.map((value) => commit(storyService(prisma), prisma, value.reservation, value.fence)));
  const sequences = committed.map((value) => value.appliedWorldSequence).sort((a, b) => a - b);
  assert(JSON.stringify(sequences) === JSON.stringify([1, 2]), `PARALLEL_WORLD_SEQUENCE:${sequences.join(",")}`);
  assert(replayed.every((value, index) => value.resolutionId === committed[index]!.resolutionId), "COMMIT_REPLAY_CREATED_SECOND_RESOLUTION");

  const duplicateResults = await Promise.allSettled([
    reserve(service, fixtures[2]!, "same-turn-key"),
    reserve(service, fixtures[2]!, "same-turn-key")
  ]);
  const duplicateSuccesses = duplicateResults.filter((value) => value.status === "fulfilled");
  const duplicateFailures = duplicateResults.filter((value) => value.status === "rejected");
  assert(duplicateSuccesses.length === 1 && duplicateFailures.length === 1, `SAME_TURN_DOUBLE_SUBMIT:${duplicateSuccesses.length}:${duplicateFailures.length}`);
  const duplicateCounts = await Promise.all([
    prisma.multiplayerWorldCommitEntry.count({ where: { turnId: fixtures[2]!.turn.id } }),
    prisma.playerAction.count({
      where: {
        runId: fixtures[2]!.runId,
        roleId: fixtures[2]!.role.id,
        idempotencyKey: `v2-action:${fixtures[2]!.runId}:same-turn-key`
      }
    }),
    prisma.decisionSubmission.count({ where: { turnId: fixtures[2]!.turn.id } }),
    prisma.storyTaskOutbox.count({ where: { inputRefId: (duplicateSuccesses[0] as PromiseFulfilledResult<Reservation>).value.entryId, taskType: "ACTOR_RESULT_V2" } })
  ]);
  assert(duplicateCounts.every((value) => value === 1), `SAME_TURN_SIDE_EFFECT_COUNTS:${duplicateCounts.join(",")}`);

  const contestedFixtures = await seed(prisma, `${prefix}_asset`, 2);
  await prisma.roleAsset.create({
    data: {
      runId: contestedFixtures[0]!.runId,
      assetKey: "shared-seal",
      kind: "TOKEN",
      ownerRoleId: null,
      ownerActorKey: null,
      quantity: 1,
      status: "ACTIVE",
      visibility: "OBSERVABLE",
      stateJson: {}
    }
  });
  const contested = await Promise.all(contestedFixtures.map((fixture, index) => reserve(storyService(prisma), fixture, `asset-${index + 1}`, true)));
  const contestedLeases = await Promise.all(contested.map((reservation) => lease(prisma, reservation)));
  const contestedResults = await Promise.allSettled(contestedLeases.map((value) => commit(storyService(prisma), prisma, value.reservation, value.fence)));
  const contestedSuccesses = contestedResults.filter((value) => value.status === "fulfilled") as Array<PromiseFulfilledResult<{ resolutionId: string; appliedWorldSequence: number }>>;
  const contestedFailures = contestedResults.filter((value) => value.status === "rejected");
  assert(contestedSuccesses.length === 1 && contestedFailures.length === 1, `CONTESTED_ASSET_OUTCOME:${contestedSuccesses.length}:${contestedFailures.length}`);
  const contestedReadback = await prisma.storyRun.findUniqueOrThrow({ where: { id: contestedFixtures[0]!.runId }, select: { worldSequence: true } });
  const contestedResolutions = await prisma.actionResolution.findMany({ where: { runId: contestedFixtures[0]!.runId }, select: { appliedWorldSequence: true } });
  const asset = await prisma.roleAsset.findUniqueOrThrow({ where: { runId_assetKey: { runId: contestedFixtures[0]!.runId, assetKey: "shared-seal" } } });
  assert(contestedReadback.worldSequence === 1 && contestedResolutions.length === 1 && contestedResolutions[0]!.appliedWorldSequence === 1, "CONTESTED_ASSET_LEFT_WORLD_SEQUENCE_GAP");
  assert(Boolean(asset.ownerRoleId), "CONTESTED_ASSET_NOT_CLAIMED");

  const readback = await prisma.storyRun.findUniqueOrThrow({ where: { id: fixtures[0]!.runId }, select: { worldSequence: true } });
  const resolutions = await prisma.actionResolution.findMany({ where: { runId: fixtures[0]!.runId }, orderBy: { appliedWorldSequence: "asc" } });
  assert(readback.worldSequence === 2 && resolutions.length === 2, "PARALLEL_COMMIT_READBACK_MISMATCH");
  return {
    parallel: { committed, replayed, worldSequence: readback.worldSequence, resolutionSequences: resolutions.map((value) => value.appliedWorldSequence) },
    sameTurnDoubleSubmit: { successes: duplicateSuccesses.length, rejected: duplicateFailures.length, sideEffectCounts: duplicateCounts },
    contestedAsset: {
      successes: contestedSuccesses.length,
      rejected: contestedFailures.length,
      worldSequence: contestedReadback.worldSequence,
      resolutionSequences: contestedResolutions.map((value) => value.appliedWorldSequence),
      ownerRoleId: asset.ownerRoleId
    }
  };
}

async function verifyFaultRecovery(prisma: PrismaClient, prefix: string) {
  const fixtures = await seed(prisma, `${prefix}_recovery`, 2);
  const first = await reserve(storyService(prisma), fixtures[0]!, "lease-recovery");
  const staleFence = { taskId: first.taskId, leaseOwner: "dead-worker", leaseVersion: 1 };
  await prisma.storyTaskOutbox.update({
    where: { id: first.taskId },
    data: { status: "RUNNING", leaseOwner: staleFence.leaseOwner, leaseVersion: staleFence.leaseVersion, leaseExpiresAt: new Date(Date.now() - 5_000), attempt: 1 }
  });
  const staleAttempt = await Promise.allSettled([commit(storyService(prisma), prisma, first, staleFence)]);
  assert(staleAttempt[0]!.status === "rejected", "EXPIRED_LEASE_COMMITTED_WORLD");
  await assertUncommitted(prisma, first, "EXPIRED_LEASE");

  const recoveredPending = await prisma.storyTaskOutbox.updateMany({
    where: { id: first.taskId, status: "RUNNING", leaseExpiresAt: { lt: new Date() } },
    data: { status: "PENDING", leaseOwner: null, leaseExpiresAt: null, nextRetryAt: new Date(), leaseVersion: { increment: 1 } }
  });
  assert(recoveredPending.count === 1, "EXPIRED_OUTBOX_NOT_RECOVERED");
  const replacementLease = await lease(prisma, first, "replacement-worker");
  const recoveredCommit = await commit(storyService(prisma), prisma, first, replacementLease.fence);
  assert(recoveredCommit.appliedWorldSequence === 1, `RECOVERED_WORLD_SEQUENCE:${recoveredCommit.appliedWorldSequence}`);
  const replay = await commit(storyService(prisma), prisma, first, replacementLease.fence);
  assert(replay.resolutionId === recoveredCommit.resolutionId, "RECOVERED_COMMIT_REPLAY_MISMATCH");

  const terminal = await reserve(storyService(prisma), fixtures[1]!, "precommit-terminal");
  await prisma.storyTaskOutbox.update({ where: { id: terminal.taskId }, data: { status: "FAILED", lastError: "INJECTED_PRECOMMIT_FAILURE" } });
  const released = await storyService(prisma).failReservedResultTask(terminal.taskId, "INJECTED_PRECOMMIT_FAILURE");
  assert(released.released === true, `PRECOMMIT_NOT_RELEASED:${JSON.stringify(released)}`);
  const terminalEntry = await prisma.multiplayerWorldCommitEntry.findUniqueOrThrow({ where: { id: terminal.entryId } });
  const replacementTurn = await prisma.actorTurn.findFirst({ where: { runId: terminal.runId, roleId: terminal.roleId, status: "OPEN", id: { not: fixtures[1]!.turn.id } } });
  const finalRun = await prisma.storyRun.findUniqueOrThrow({ where: { id: terminal.runId }, select: { worldSequence: true } });
  const finalResolutions = await prisma.actionResolution.findMany({ where: { runId: terminal.runId }, orderBy: { appliedWorldSequence: "asc" } });
  assert(terminalEntry.state === "FAILED" && terminalEntry.failureCode === "INJECTED_PRECOMMIT_FAILURE", "PRECOMMIT_ENTRY_NOT_FAILED");
  assert(Boolean(replacementTurn), "PRECOMMIT_FAILURE_DID_NOT_OPEN_REPLACEMENT_TURN");
  assert(finalRun.worldSequence === 1 && finalResolutions.length === 1 && finalResolutions[0]!.appliedWorldSequence === 1, "PRECOMMIT_FAILURE_CHANGED_WORLD_SEQUENCE");

  return {
    expiredLease: { rejected: true, worldMutationSuppressed: true },
    outboxRecovery: { recoveredPending: recoveredPending.count, committed: recoveredCommit, replay },
    precommitFailure: {
      released,
      entryState: terminalEntry.state,
      replacementTurnId: replacementTurn!.id,
      worldSequence: finalRun.worldSequence,
      resolutionSequences: finalResolutions.map((value) => value.appliedWorldSequence)
    }
  };
}

function storyService(prisma: PrismaClient) {
  return new ContinuousStoryV2Service(
    prisma as any,
    new ContinuousStrategyContentService(),
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any
  );
}

async function reserve(service: ContinuousStoryV2Service, fixture: Fixture, key: string, claimAsset = false): Promise<Reservation> {
  const intent = {
    objective: claimAsset ? "Claim the shared seal" : `Commit ${key}`,
    target: { type: claimAsset ? "RESOURCE" : "PUBLIC_FRAME", id: claimAsset ? "shared-seal" : "acceptance-frame", label: claimAsset ? "Shared seal" : "Acceptance frame" },
    method: claimAsset ? "Claim this currently unowned seal" : `Record deterministic action ${key}`,
    leverageKeys: claimAsset ? ["shared-seal"] : [],
    visibility: "OBSERVABLE",
    riskTolerance: "LOW",
    fallback: null,
    condition: null
  };
  const action = {
    actionKey: `acceptance:${key}`,
    source: "CUSTOM",
    visibility: "OBSERVABLE",
    label: key,
    description: intent.method,
    intent: intent.objective,
    risk: "LOW",
    targetRoleId: null,
    targetRoleName: null,
    basisFactKeys: [],
    requiredAssetKeys: claimAsset ? ["shared-seal"] : [],
    receiptText: `${key} was durably accepted.`,
    effectFactKeys: [],
    influenceEdges: [],
    nextStateKey: `acceptance_state_${key}`,
    normalizedIntent: intent,
    immutableIntentHash: `acceptance_hash_${fixture.runId}_${key}`,
    guardDecision: { accepted: true, decision: "ALLOW", reason: "ACCEPTANCE_FIXTURE", matchedRules: [], riskFlags: [], normalizedIntent: intent },
    effectHooks: [],
    observableTraceText: `${key} left an observable trace.`,
    requiresTargetResponse: false,
    interactionRequestKind: null,
    leverageDispositions: claimAsset ? [{ assetKey: "shared-seal", disposition: "CLAIM" }] : []
  };
  const reservation = await (service as any).reserveResolution({
    context: {
      run: { id: fixture.runId },
      turn: fixture.turn,
      role: fixture.role,
      membership: { userId: null },
      visibleFacts: [],
      incomingImpacts: [],
      assets: [],
      situationInput: { stage: { title: "Commit-entry acceptance stage" } }
    },
    command: {
      candidateId: null,
      customAction: action.description,
      decisionForm: "CUSTOM_PLAN",
      idempotencyKey: `${fixture.runId}:${key}`,
      turnRevision: 1,
      controlEpoch: 1,
      intent
    },
    requestHash: `request:${fixture.runId}:${key}`,
    action,
    stageProgress: { stageAdvanced: false, nextStageIndex: null, reason: "STAGE_EVIDENCE_PENDING", evidenceFactKeys: [] },
    actorKind: "AI"
  });
  return {
    runId: fixture.runId,
    roleId: fixture.role.id,
    entryId: reservation.entryId,
    taskId: reservation.taskId,
    submissionId: reservation.submissionId,
    observedWorldSequence: reservation.observedWorldSequence
  };
}

async function lease(prisma: PrismaClient, reservation: Reservation, owner = `acceptance-${reservation.entryId}`) {
  const claimed = await prisma.storyTaskOutbox.updateMany({
    where: { id: reservation.taskId, status: "PENDING", taskType: "ACTOR_RESULT_V2" },
    data: {
      status: "RUNNING",
      leaseOwner: owner,
      leaseExpiresAt: new Date(Date.now() + 120_000),
      startedAt: new Date(),
      attempt: { increment: 1 },
      leaseVersion: { increment: 1 }
    }
  });
  assert(claimed.count === 1, `TASK_LEASE_FAILED:${reservation.taskId}`);
  const task = await prisma.storyTaskOutbox.findUniqueOrThrow({ where: { id: reservation.taskId } });
  return { reservation, fence: { taskId: task.id, leaseOwner: owner, leaseVersion: task.leaseVersion } };
}

async function commit(
  service: ContinuousStoryV2Service,
  prisma: PrismaClient,
  reservation: Reservation,
  fence: { taskId: string; leaseOwner: string; leaseVersion: number }
) {
  const task = await prisma.storyTaskOutbox.findUniqueOrThrow({ where: { id: reservation.taskId } });
  const entry = await (service as any).loadMultiplayerCommitEntry(prisma, reservation.entryId);
  assert(entry, `COMMIT_ENTRY_MISSING:${reservation.entryId}`);
  const payload = task.resultJson as any;
  const prepared = await (service as any).contextForMultiplayerEntry(entry, payload);
  return (service as any).commitMultiplayerWorldEntry({
    entryId: reservation.entryId,
    context: prepared.context,
    action: payload.action,
    stageProgress: payload.stageProgress,
    resultFence: fence
  }) as Promise<{ resolutionId: string; appliedWorldSequence: number }>;
}

async function assertUncommitted(prisma: PrismaClient, reservation: Reservation, label: string) {
  const [run, entry, resolution] = await Promise.all([
    prisma.storyRun.findUniqueOrThrow({ where: { id: reservation.runId }, select: { worldSequence: true } }),
    prisma.multiplayerWorldCommitEntry.findUniqueOrThrow({ where: { id: reservation.entryId }, select: { state: true, committedResolutionId: true } }),
    prisma.actionResolution.findUnique({ where: { id: reservation.entryId } })
  ]);
  assert(run.worldSequence === 0 && entry.state === "RESERVED" && entry.committedResolutionId === null && resolution === null, `${label}_MUTATED_WORLD`);
}

async function seed(prisma: PrismaClient, runId: string, roleCount: number): Promise<Fixture[]> {
  const userId = `${runId}_owner`;
  const templateId = `${runId}_template`;
  const nodeId = `${runId}_node`;
  await prisma.user.create({ data: { id: userId, openid: `${runId}_openid`, nickname: "Commit-entry acceptance" } });
  await prisma.worldTemplate.create({ data: { id: templateId, name: "Commit-entry acceptance", genre: "test", hook: "isolated", worldBase: "isolated", status: "test", configJson: {} } });
  await prisma.storyRun.create({
    data: {
      id: runId,
      templateId,
      ownerUserId: userId,
      title: "Commit-entry acceptance",
      hook: "isolated",
      mode: "room",
      templateKey: "sangtian",
      status: "playing",
      stateJson: {},
      inviteCode: `${runId}_invite`,
      engineVersion: "continuous_openovel_v1",
      strategyVersion: "sangtian_v1_2",
      worldSequence: 0,
      reservedWorldSequence: 0,
      maxPlayers: Math.max(3, roleCount),
      currentNodeId: nodeId
    }
  });
  await prisma.sceneNode.create({
    data: {
      id: nodeId,
      runId,
      chapterIndex: 1,
      nodeIndex: 1,
      title: "Commit-entry node",
      publicNarration: "Deterministic multiplayer acceptance fixture",
      nodeGoal: "Verify durable shared-world commits",
      actionOptionsJson: []
    }
  });
  const roleKeys = ["zhejiang_governor", "xunfu", "county_magistrate"];
  const fixtures: Fixture[] = [];
  for (let index = 0; index < roleCount; index += 1) {
    const role = {
      id: `${runId}_role_${index + 1}`,
      runId,
      roleKey: roleKeys[index]!,
      roleName: `Acceptance Role ${index + 1}`,
      identity: "Independent multiplayer actor",
      publicInfo: "Public fixture identity",
      personalGoal: "Commit one independent action",
      currentState: "active",
      knownInfoJson: [],
      cannotDoJson: [],
      isAiControlled: true
    };
    const threadId = `${role.id}_thread`;
    const turn = {
      id: `${role.id}_turn`,
      runId,
      threadId,
      roleId: role.id,
      stageIndex: 1,
      turnIndex: 1,
      status: "OPEN",
      baseWorldSequence: 0,
      revision: 1,
      situationTitle: "Commit-entry situation",
      situationNarrative: "An independent action can proceed.",
      visibleFactKeysJson: [],
      activeThreadKeysJson: [],
      contextJson: {},
      qualityStatus: "PASS",
      dedupeKey: `commit-entry-turn:${role.id}`
    };
    await prisma.storyRole.create({ data: role });
    await prisma.actorThread.create({ data: { id: threadId, runId, roleId: role.id, currentTurnIndex: 1, currentStageIndex: 1, lastAppliedSequence: 0 } });
    await prisma.actorTurn.create({ data: turn });
    await prisma.roleControl.create({ data: { runId, roleId: role.id, mode: "AI_ACTIVE", epoch: 1, reason: "INITIAL_AI_AGENT" } });
    fixtures.push({ runId, role, turn });
  }
  return fixtures;
}

async function persist(report: Record<string, unknown>) {
  await writeFile(path.join(evidenceDir, "commit-entry-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function requiredEnv(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function redact(value: string) {
  return value.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[DATABASE_URL_REDACTED]");
}

void main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", message: redact(String(error?.message || error)) })}\n`);
  process.exitCode = 1;
});
