import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ContinuousStrategyContentService } from "../../apps/api/src/continuous-strategy/content.service";
import { ContinuousStoryV2Service } from "../../apps/api/src/continuous-story-v2/continuous-story-v2.service";

const SIMULATION_COUNT = 100;
const ROLES_PER_ROOM = 3;
const LATENCY_SAMPLE_COUNT = 60;
const WORLD_RESOLUTION_P95_LIMIT_MS = 1_000;
const ROLE_KEYS = ["zhejiang_governor", "xunfu", "county_magistrate"] as const;

type Fixture = { run: { id: string }; role: any; turn: any };

async function main() {
  const evidenceDir = path.resolve(requiredEnv("OPENOVEL_MP_EVIDENCE_DIR"));
  await mkdir(evidenceDir, { recursive: true });
  const prisma = new PrismaClient();
  const runIdPrefix = `openovel_mp_perf_${Date.now().toString(36)}`;
  const report: Record<string, unknown> = {
    schemaVersion: "openovel_mp_performance_v1",
    lane: "performance",
    status: "RUNNING",
    runIdPrefix,
    database: { provider: "postgresql", schema: process.env.OPENOVEL_MP_DB_SCHEMA, isolated: true },
    startedAt: new Date().toISOString(),
    limits: { worldResolutionExcludingModelP95Ms: WORLD_RESOLUTION_P95_LIMIT_MS, concurrentSimulations: SIMULATION_COUNT }
  };

  try {
    const fixtures = await seed(prisma, runIdPrefix, SIMULATION_COUNT);
    const service = new ContinuousStoryV2Service(prisma as any, new ContinuousStrategyContentService(), null as any, null as any, null as any, null as any, null as any, null as any);
    const wallStartedAt = performance.now();
    const reservations = await Promise.all(fixtures.map((fixture, index) => reserveFixture(service, fixture, index, "stress")));
    const wallDurationMs = round(performance.now() - wallStartedAt);
    const stressDurations = reservations.map((value) => value.durationMs).sort((a, b) => a - b);
    const runIds = [...new Set(fixtures.map((value) => value.run.id))];
    const reservationReadback = await Promise.all([
      prisma.storyRun.findMany({ where: { id: { in: runIds } }, select: { id: true, worldSequence: true, reservedWorldSequence: true }, orderBy: { id: "asc" } }),
      prisma.actionResolution.findMany({ where: { runId: { in: runIds } }, select: { id: true, runId: true, roleId: true, appliedWorldSequence: true }, orderBy: [{ runId: "asc" }, { appliedWorldSequence: "asc" }] }),
      prisma.multiplayerWorldCommitEntry.count({ where: { runId: { in: runIds }, state: "RESERVED" } }),
      prisma.playerAction.count({ where: { runId: { in: runIds } } }),
      prisma.decisionSubmission.count({ where: { runId: { in: runIds } } }),
      prisma.storyTaskOutbox.count({ where: { runId: { in: runIds }, taskType: "ACTOR_RESULT_V2", status: "PENDING" } })
    ]);
    assert(reservations.length === SIMULATION_COUNT, `RESERVATION_COUNT:${reservations.length}`);
    assert(new Set(reservations.map((value) => value.entryId)).size === SIMULATION_COUNT, "RESERVATION_ENTRY_DUPLICATED");
    for (const run of reservationReadback[0]) {
      const expected = fixtures.filter((value) => value.run.id === run.id).length;
      assert(expected > 0, `ROOM_FIXTURE_MISSING:${run.id}`);
      assert(run.worldSequence === 0 && run.reservedWorldSequence === 0, `RESERVATION_ALLOCATED_FORMAL_WORLD_SEQUENCE:${run.id}`);
    }
    assert(reservationReadback[1].length === 0, `RESERVATION_CREATED_ACTION_RESOLUTION:${reservationReadback[1].length}`);
    assert(reservationReadback[2] === SIMULATION_COUNT && reservationReadback[3] === SIMULATION_COUNT
      && reservationReadback[4] === SIMULATION_COUNT && reservationReadback[5] === SIMULATION_COUNT,
    "RESERVATION_SIDE_EFFECT_COUNT_MISMATCH");

    const commitWallStartedAt = performance.now();
    const commits = await Promise.all(reservations.map((reservation) => commitFixture(service, prisma, reservation)));
    const commitWallDurationMs = round(performance.now() - commitWallStartedAt);
    const commitDurations = commits.map((value) => value.durationMs).sort((a, b) => a - b);
    const committedReadback = await Promise.all([
      prisma.storyRun.findMany({ where: { id: { in: runIds } }, select: { id: true, worldSequence: true, reservedWorldSequence: true }, orderBy: { id: "asc" } }),
      prisma.actionResolution.findMany({ where: { runId: { in: runIds } }, select: { id: true, runId: true, roleId: true, appliedWorldSequence: true }, orderBy: [{ runId: "asc" }, { appliedWorldSequence: "asc" }] }),
      prisma.multiplayerWorldCommitEntry.count({ where: { runId: { in: runIds }, state: "COMMITTED" } })
    ]);
    for (const run of committedReadback[0]) {
      const expected = fixtures.filter((value) => value.run.id === run.id).length;
      const sequences = committedReadback[1].filter((value) => value.runId === run.id).map((value) => value.appliedWorldSequence);
      assert(run.worldSequence === expected && run.reservedWorldSequence === 0, `WORLD_SEQUENCE_COMMIT_READBACK_MISMATCH:${run.id}`);
      assert(sequences.length === expected && new Set(sequences).size === expected, `WORLD_SEQUENCE_DUPLICATED:${run.id}`);
      assert(Math.min(...sequences) === 1 && Math.max(...sequences) === expected, `WORLD_SEQUENCE_RANGE:${run.id}`);
    }
    assert(committedReadback[1].length === SIMULATION_COUNT && committedReadback[2] === SIMULATION_COUNT, "WORLD_COMMIT_COUNT_MISMATCH");

    // The latency SLA and the 100-simulation correctness stress are separate
    // requirements in the source plan. Measure the SLA at the real per-room
    // concurrency ceiling (three role turns at once), repeated across rooms.
    const latencyFixtures = await seed(prisma, `${runIdPrefix}_latency`, LATENCY_SAMPLE_COUNT);
    const latencyReservations: Awaited<ReturnType<typeof reserveFixture>>[] = [];
    const latencyCommits: Awaited<ReturnType<typeof commitFixture>>[] = [];
    for (let offset = 0; offset < latencyFixtures.length; offset += ROLES_PER_ROOM) {
      const batchReservations = await Promise.all(
        latencyFixtures.slice(offset, offset + ROLES_PER_ROOM)
          .map((fixture, index) => reserveFixture(service, fixture, offset + index, "latency"))
      );
      latencyReservations.push(...batchReservations);
      latencyCommits.push(...await Promise.all(batchReservations.map((reservation) => commitFixture(service, prisma, reservation))));
    }
    const latencyDurations = latencyCommits.map((value) => value.durationMs).sort((a, b) => a - b);
    const p95Ms = percentile(latencyDurations, 0.95);

    report.performance = {
      scope: "production multiplayer reservation plus formal world commit across real three-role room shapes, deterministic AI actors, provider/model excluded",
      correctnessStress: {
        concurrentSimulations: SIMULATION_COUNT,
        roomCount: runIds.length,
        rolesPerRoom: ROLES_PER_ROOM,
        wallDurationMs,
        throughputPerSecond: round(SIMULATION_COUNT / (wallDurationMs / 1_000)),
        queuedLatencyMs: {
          min: stressDurations[0], p50: percentile(stressDurations, 0.5),
          p95: percentile(stressDurations, 0.95), max: stressDurations.at(-1)
        },
        worldCommit: {
          wallDurationMs: commitWallDurationMs,
          throughputPerSecond: round(SIMULATION_COUNT / (commitWallDurationMs / 1_000)),
          queuedLatencyMs: {
            min: commitDurations[0], p50: percentile(commitDurations, 0.5),
            p95: percentile(commitDurations, 0.95), max: commitDurations.at(-1)
          }
        }
      },
      worldResolutionSla: {
        loadProfile: "formal world commits in repeated batches of up to three simultaneous roles in one room",
        sampleCount: latencyCommits.length,
        latencyMs: { min: latencyDurations[0], p50: percentile(latencyDurations, 0.5), p95: p95Ms, max: latencyDurations.at(-1) },
        p95LimitMs: WORLD_RESOLUTION_P95_LIMIT_MS
      }
    };
    report.readback = {
      rooms: committedReadback[0],
      reservationEntryCount: reservationReadback[2],
      committedEntryCount: committedReadback[2],
      actionResolutionCount: committedReadback[1].length,
      playerActionCount: reservationReadback[3],
      decisionSubmissionCount: reservationReadback[4],
      resultTaskCount: reservationReadback[5],
      uniqueRoomSequencePairs: new Set(committedReadback[1].map((value) => `${value.runId}:${value.appliedWorldSequence}`)).size
    };
    report.samples = { correctnessStress: { reservations, commits }, worldResolutionSla: latencyCommits };
    assert(p95Ms < WORLD_RESOLUTION_P95_LIMIT_MS, `WORLD_RESOLUTION_P95_EXCEEDED:${p95Ms}`);
    report.status = "PASS";
    report.completedAt = new Date().toISOString();
    await persist(evidenceDir, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    report.status = "FAIL";
    report.message = redact(String((error as Error)?.message || error));
    report.failedAt = new Date().toISOString();
    await persist(evidenceDir, report);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

async function reserveFixture(service: ContinuousStoryV2Service, fixture: Fixture, index: number, keyPrefix: string) {
  const { run, role, turn } = fixture;
  const startedAt = performance.now();
  const intent = {
    objective: `Apply independent multiplayer simulation ${index + 1}`,
    target: { type: "PUBLIC_FRAME", id: "performance-frame", label: "Performance frame" },
    method: `Record deterministic multiplayer action ${index + 1}`,
    leverageKeys: [], visibility: "OBSERVABLE", riskTolerance: "LOW", fallback: null, condition: null
  };
  const action = {
    actionKey: `performance:${keyPrefix}:${index + 1}`, source: "CUSTOM", visibility: "OBSERVABLE",
    label: `Simulation ${index + 1}`, description: intent.method, intent: intent.objective, risk: "LOW",
    targetRoleId: null, targetRoleName: null, basisFactKeys: [], requiredAssetKeys: [],
    receiptText: `Simulation ${index + 1} was durably reserved.`, effectFactKeys: [`performance_fact_${index + 1}`],
    influenceEdges: [], nextStateKey: `performance_state_${index + 1}`, normalizedIntent: intent,
    immutableIntentHash: `performance_hash_${keyPrefix}_${index + 1}`,
    guardDecision: { accepted: true, decision: "ALLOW", reason: "PERFORMANCE_FIXTURE", matchedRules: [], riskFlags: [], normalizedIntent: intent },
    effectHooks: [`WORLD_FACT:performance_fact_${index + 1}`], observableTraceText: `Observable trace ${index + 1}`,
    requiresTargetResponse: false, interactionRequestKind: null, leverageDispositions: []
  };
  const reservation = await (service as any).reserveResolution({
    context: {
      run, turn, role, membership: { userId: null },
      visibleFacts: [], incomingImpacts: [], assets: [],
      situationInput: { stage: { title: "Performance stage" } }
    },
    command: {
      candidateId: null, customAction: action.description, decisionForm: "CUSTOM_PLAN",
      idempotencyKey: `performance-${keyPrefix}-${run.id}-${index + 1}`,
      turnRevision: 1, controlEpoch: 1, intent
    },
    requestHash: `performance-request-${keyPrefix}-${index + 1}`,
    action,
    stageProgress: { stageAdvanced: false, nextStageIndex: null, reason: "STAGE_EVIDENCE_PENDING", evidenceFactKeys: [] },
    actorKind: "AI"
  });
  return {
    runId: run.id, roleId: role.id, entryId: reservation.entryId as string,
    taskId: reservation.taskId as string, observedWorldSequence: reservation.observedWorldSequence as number,
    durationMs: round(performance.now() - startedAt)
  };
}

async function commitFixture(
  service: ContinuousStoryV2Service,
  prisma: PrismaClient,
  reservation: Awaited<ReturnType<typeof reserveFixture>>
) {
  const leaseOwner = `performance-commit-${reservation.entryId}`;
  const leased = await prisma.storyTaskOutbox.updateMany({
    where: { id: reservation.taskId, status: "PENDING", taskType: "ACTOR_RESULT_V2" },
    data: {
      status: "RUNNING",
      leaseOwner,
      leaseExpiresAt: new Date(Date.now() + 120_000),
      startedAt: new Date(),
      attempt: { increment: 1 },
      leaseVersion: { increment: 1 }
    }
  });
  assert(leased.count === 1, `RESULT_TASK_LEASE_FAILED:${reservation.taskId}`);
  const task = await prisma.storyTaskOutbox.findUniqueOrThrow({ where: { id: reservation.taskId } });
  const entry = await (service as any).loadMultiplayerCommitEntry(prisma, reservation.entryId);
  assert(entry, `COMMIT_ENTRY_MISSING:${reservation.entryId}`);
  const payload = task.resultJson as any;
  const prepared = await (service as any).contextForMultiplayerEntry(entry, payload);
  const startedAt = performance.now();
  const committed = await (service as any).commitMultiplayerWorldEntry({
    entryId: reservation.entryId,
    context: prepared.context,
    action: payload.action,
    stageProgress: payload.stageProgress,
    resultFence: { taskId: task.id, leaseOwner, leaseVersion: task.leaseVersion }
  });
  return {
    runId: reservation.runId,
    roleId: reservation.roleId,
    entryId: reservation.entryId,
    resolutionId: committed.resolutionId as string,
    appliedWorldSequence: committed.appliedWorldSequence as number,
    durationMs: round(performance.now() - startedAt)
  };
}

async function seed(prisma: PrismaClient, runIdPrefix: string, simulationCount: number): Promise<Fixture[]> {
  const userId = `${runIdPrefix}_owner`;
  const templateId = `${runIdPrefix}_template`;
  await prisma.user.create({ data: { id: userId, openid: `${runIdPrefix}_openid`, nickname: "OpenNovel performance" } });
  await prisma.worldTemplate.create({ data: { id: templateId, name: "OpenNovel performance", genre: "test", hook: "isolated", worldBase: "isolated", status: "test", configJson: {} } });
  const roomCount = Math.ceil(simulationCount / ROLES_PER_ROOM);
  const runs = Array.from({ length: roomCount }, (_, index) => {
    const id = `${runIdPrefix}_room_${index + 1}`;
    return { id, nodeId: `${id}_node` };
  });
  await prisma.storyRun.createMany({ data: runs.map(({ id, nodeId }) => ({
    id, templateId, ownerUserId: userId, title: "OpenNovel multiplayer performance", hook: "isolated",
    mode: "room", templateKey: "sangtian", status: "playing", stateJson: {}, inviteCode: `${id}_invite`,
    engineVersion: "continuous_openovel_v1", strategyVersion: "sangtian_v1_2", worldSequence: 0,
    reservedWorldSequence: 0, maxPlayers: ROLES_PER_ROOM, currentNodeId: nodeId
  })) });
  await prisma.sceneNode.createMany({ data: runs.map(({ id, nodeId }) => ({
    id: nodeId, runId: id, chapterIndex: 1, nodeIndex: 1, title: "Performance node",
    publicNarration: "Deterministic performance fixture", nodeGoal: "Reserve independent multiplayer actions", actionOptionsJson: []
  })) });
  const fixtures: Fixture[] = [];
  for (let index = 0; index < simulationCount; index += 1) {
    const roomIndex = Math.floor(index / ROLES_PER_ROOM);
    const runId = runs[roomIndex]!.id;
    const role = {
      id: `${runId}_role_${(index % ROLES_PER_ROOM) + 1}`, runId, roleKey: ROLE_KEYS[index % ROLES_PER_ROOM]!, roleName: `Performance Role ${(index % ROLES_PER_ROOM) + 1}`,
      identity: "Independent multiplayer actor", publicInfo: "Public performance fixture", personalGoal: "Reserve one action",
      currentState: "active", knownInfoJson: [], cannotDoJson: [], isAiControlled: true
    };
    const thread = { id: `${role.id}_thread`, runId, roleId: role.id, currentTurnIndex: 1, currentStageIndex: 1, lastAppliedSequence: 0 };
    const turn = {
      id: `${role.id}_turn`, runId, threadId: thread.id, roleId: role.id, stageIndex: 1, turnIndex: 1, status: "OPEN", baseWorldSequence: 0,
      revision: 1, situationTitle: "Performance situation", situationNarrative: "A deterministic action can be reserved now.",
      visibleFactKeysJson: [], activeThreadKeysJson: [], contextJson: {}, qualityStatus: "PASS", dedupeKey: `performance-turn:${role.id}`
    };
    fixtures.push({ run: { id: runId }, role, turn });
  }
  await prisma.storyRole.createMany({ data: fixtures.map((value) => value.role) });
  await prisma.actorThread.createMany({ data: fixtures.map((value) => ({ id: value.turn.threadId, runId: value.run.id, roleId: value.role.id, currentTurnIndex: 1, currentStageIndex: 1, lastAppliedSequence: 0 })) });
  await prisma.actorTurn.createMany({ data: fixtures.map((value) => value.turn) });
  await prisma.roleControl.createMany({ data: fixtures.map((value) => ({ runId: value.run.id, roleId: value.role.id, mode: "AI_ACTIVE", epoch: 1, reason: "INITIAL_AI_AGENT" })) });
  return fixtures;
}

function percentile(sorted: number[], ratio: number) {
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]!;
}
function round(value: number) { return Math.round(value * 100) / 100; }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function requiredEnv(name: string) { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`${name}_REQUIRED`); return value; }
function redact(value: string) { return value.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[DATABASE_URL_REDACTED]"); }
async function persist(evidenceDir: string, report: Record<string, unknown>) { await writeFile(path.join(evidenceDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"); }

void main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", message: redact(String(error?.message || error)) })}\n`);
  process.exitCode = 1;
});
