import { Prisma, PrismaClient } from "@prisma/client";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import net from "node:net";
import path from "node:path";
import { sharedRoomRunIdForRequest } from "../../apps/api/src/rooms.service";
import { parseOpenNovelActionReceipt } from "./openovel-mp-action-receipt";

type Session = {
  label: string;
  userId: string;
  email: string;
  password: string;
  cookie: string;
  roleId: string;
  roleKey: string;
  roleName: string;
};

type Projection = {
  engineVersion: string;
  runtimeMode: string;
  worldSequence: number;
  player: { roleId: string; roleKey: string; roleName: string; personalGoal: string };
  control: { mode: string; epoch: number; canHumanAct: boolean };
  currentTurn: null | {
    id: string;
    revision: number;
    decisions: Array<{ id: string; intentDraft: Record<string, unknown> }>;
  };
  timeline: Array<{ kind: string; content: string; worldSequence: number }>;
  pendingInteractions: Array<{
    id: string;
    direction: "INCOMING" | "OUTGOING";
    sourceRoleId: string;
    targetRoleId: string;
  }>;
  pendingImpacts: Array<{ id: string; status: string }>;
  roleNarrativeState: { impactStatus: string; generationStatus: string };
  creditControl: { policyVersion: string; meteringMode: string; available?: number };
};

type ProcessLog = { label: string; child: ChildProcess; stdout: string; stderr: string };

type HeartbeatPump = {
  beat: () => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  stop: () => void;
  errors: string[];
};

const projectRoot = process.cwd();
const evidenceDir = path.resolve(requiredEnv("OPENOVEL_MP_EVIDENCE_DIR"));
const databaseSchema = requiredEnv("OPENOVEL_MP_DB_SCHEMA");
const password = "OpenNovel-MP-2026!";
const idempotencyKey = `room-create:openovel-three-role-${Date.now()}`;
const ownerId = `openovel_e2e_owner_${Date.now().toString(36)}`;
const runId = sharedRoomRunIdForRequest(ownerId, idempotencyKey);
const internalToken = `openovel-three-role-${randomBytes(12).toString("hex")}`;
const heartbeatIntervalMs = 800;
const users: Session[] = [
  account("governor", ownerId, "governor"),
  account("xunfu", `openovel_e2e_xunfu_${Date.now().toString(36)}`, "xunfu"),
  account("magistrate", `openovel_e2e_magistrate_${Date.now().toString(36)}`, "magistrate")
];

const report: Record<string, unknown> = {
  schemaVersion: "openovel_mp_three_role_e2e_v1",
  status: "RUNNING",
  providerMode: "DETERMINISTIC_TEST_PROVIDER",
  productProcesses: ["apps/openovel-runtime/src/server.ts", "apps/api/src/main.ts"],
  database: {
    provider: "postgresql",
    service: "supabase",
    schema: databaseSchema,
    isolated: true,
    provisioning: requiredEnv("OPENOVEL_MP_DB_PROVISIONING"),
    connectionBudget: {
      driver: Number(requiredEnv("OPENOVEL_MP_DRIVER_CONNECTION_LIMIT")),
      api: Number(requiredEnv("OPENOVEL_MP_API_CONNECTION_LIMIT")),
      supabaseSessionPoolLimit: 15,
      reserved: 2
    }
  },
  runId,
  startedAt: new Date().toISOString(),
  actions: []
};

const children: ProcessLog[] = [];
const heartbeatPumps: HeartbeatPump[] = [];
const providerCalls: Array<{ model: string; profile: string; inputTokens: number; outputTokens: number; totalTokens: number }> = [];
let provider: Server | null = null;

async function main() {
  await mkdir(evidenceDir, { recursive: true });
  const prisma = new PrismaClient();
  try {
    await seedAccounts(prisma);
    const [providerPort, runtimePort, apiPort] = await reservePorts(3);
    provider = createDeterministicProvider();
    await listen(provider, providerPort);
    const runtime = start("runtime", ["--import", "tsx", "apps/openovel-runtime/src/server.ts"], {
      NODE_ENV: "production",
      PORT: String(runtimePort),
      OPENOVEL_RUNTIME_HOST: "127.0.0.1",
      OPENOVEL_WORKSPACE_ROOT: path.join(evidenceDir, "runtime-workspaces"),
      OPENOVEL_PROJECT_ROOT: projectRoot,
      OPENOVEL_INTERNAL_TOKEN: internalToken,
      OPENOVEL_PROVIDER_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
      OPENOVEL_API_KEY: "deterministic-test-key",
      OPENOVEL_MODEL: "mock-narrator",
      OPENOVEL_NARRATOR_MODEL: "mock-narrator",
      OPENOVEL_OPTIONS_MODEL: "mock-options",
      OPENOVEL_STORYKEEPER_MODEL: "mock-storykeeper",
      OPENOVEL_MIRROR_URL: ""
    });
    await waitForHttp(`http://127.0.0.1:${runtimePort}/health`, runtime, 30_000);

    const api = start("api", ["--import", "tsx", "apps/api/src/main.ts"], {
      NODE_ENV: "test",
      PORT: String(apiPort),
      DATABASE_URL: requiredEnv("OPENOVEL_MP_API_DATABASE_URL"),
      MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED: "true",
      CONTINUOUS_OPENOVEL_V1_ENABLED: "true",
      CONTINUOUS_OPENOVEL_ROOM_IDS: runId,
      OPENOVEL_RUNTIME_URL: `http://127.0.0.1:${runtimePort}`,
      OPENOVEL_INTERNAL_TOKEN: internalToken,
      STORY_WORKER_EMBEDDED: "true",
      STORY_WORKER_ENABLED: "true",
      STORY_NARRATIVE_PROVIDER: "deepseek",
      STORY_NARRATIVE_TIMEOUT_MS: "10000",
      DEEPSEEK_API_KEY: "deterministic-test-key",
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
      STORY_AGENT_MODEL: "mock-agent",
      ROLE_AGENT_MODEL: "mock-agent",
      ROLE_AGENT_PROVIDER: "rules",
      CREDIT_DEFAULT_POLICY: "active_action_v1",
      CREDIT_ACTION_METERING_MODE: "OFF",
      ALLOW_TEST_CREDIT_GRANT: "true",
      AUTH_TOKEN_SECRET: "openovel-three-role-auth-secret",
      EMAIL_PROVIDER: "file-sink",
      AUTH_MAIL_SINK_FILE: path.join(evidenceDir, "auth-mail-sink.ndjson"),
      OPENOVEL_HEARTBEAT_STALE_MS: "2000",
      OPENOVEL_OFFLINE_GRACE_MS: "3000"
    });
    const apiBase = `http://127.0.0.1:${apiPort}/api`;
    await waitForHttp(`${apiBase}/health`, api, 45_000);

    for (const user of users) user.cookie = await login(apiBase, user);
    // This is fixture setup, not a production endpoint acceptance. Keep the
    // remote PostgreSQL transaction open long enough for the four durable
    // credit rows; the default interactive-transaction timeout is too short
    // for the isolated remote schema and obscures the reclaim behavior under
    // test.
    const reclaimCredit = await grantReclaimTestCredit(prisma, users[2]!, 1);
    assert(reclaimCredit.balance.available === 1, `RECLAIM_TEST_CREDIT_BALANCE:${reclaimCredit.balance.available}`);
    report.reclaimCredit = { ledgerId: reclaimCredit.ledgerId, granted: 1, available: reclaimCredit.balance.available };
    const created = await request<any>(apiBase, users[0]!, "/v4/rooms", {
      method: "POST",
      body: { worldId: "sangtian", title: "OpenNovel Three Role Acceptance", visibility: "private", idempotencyKey }
    });
    assert(created.id === runId, `ROOM_ID_MISMATCH:${created.id}`);
    for (const user of users.slice(1)) {
      await request(apiBase, user, "/v4/rooms/join-by-code", { method: "POST", body: { inviteCode: created.inviteCode } });
    }
    const room = await request<any>(apiBase, users[0]!, `/v4/rooms/${runId}`);
    const roleKeys = ["zhejiang_governor", "xunfu", "county_magistrate"];
    for (let index = 0; index < users.length; index += 1) {
      const user = users[index]!;
      const role = room.roles.find((candidate: any) => candidate.roleKey === roleKeys[index]);
      assert(role, `ROLE_MISSING:${roleKeys[index]}`);
      user.roleId = String(role.id);
      user.roleKey = String(role.roleKey);
      user.roleName = String(role.roleName);
      await request(apiBase, user, `/v4/rooms/${runId}/role`, { method: "POST", body: { roleId: user.roleId } });
    }
    await request(apiBase, users[0]!, `/v4/rooms/${runId}/role/lock`, { method: "POST", body: {} });
    for (const user of users) await request(apiBase, user, `/v4/rooms/${runId}/ready`, { method: "POST", body: { ready: true } });
    const started = await request<any>(apiBase, users[0]!, `/v4/rooms/${runId}/start`, { method: "POST", body: {} });
    assert(started.gameProjection?.engineVersion === "continuous_openovel_v1", "OPENOVEL_ENGINE_NOT_SELECTED");
    assert(started.gameProjection?.runtimeMode === "OPENOVEL_ROLE_V1", "OPENOVEL_RUNTIME_MODE_NOT_SELECTED");
    assert(started.gameProjection?.creditControl?.policyVersion === "active_action_v1", "OPENOVEL_ACCEPTANCE_BILLING_POLICY_INVALID");
    assert(started.gameProjection?.creditControl?.meteringMode === "OFF", "OPENOVEL_ACCEPTANCE_METERING_MUST_BE_OFF");

    for (const user of users) heartbeatPumps.push(createHeartbeatPump(apiBase, user));
    await Promise.all(heartbeatPumps.map((pump) => pump.resume()));
    report.presenceTiming = { heartbeatStaleMs: 2_000, offlineGraceMs: 3_000, heartbeatIntervalMs };

    const actionEvidence: Array<Record<string, unknown>> = [];
    const first = await projection(apiBase, users[0]!);
    const requestIntent = intentFor(users[0]!, 1, {
      type: "ROLE",
      id: users[1]!.roleId,
      label: users[1]!.roleName,
      effectClaim: "REQUEST",
      visibility: "LIMITED"
    });
    actionEvidence.push(await submit(apiBase, users[0]!, first, 1, requestIntent));
    report.actions = actionEvidence;

    const incoming = await waitForProjection(apiBase, users[1]!, (value) => value.pendingInteractions.some((item) => item.direction === "INCOMING"), 30_000);
    const interaction = incoming.pendingInteractions.find((item) => item.direction === "INCOMING")!;
    const replyIntent = intentFor(users[1]!, 2, {
      type: "ROLE",
      id: users[0]!.roleId,
      label: users[0]!.roleName,
      effectClaim: "REQUEST",
      visibility: "LIMITED"
    });
    actionEvidence.push(await submit(apiBase, users[1]!, incoming, 2, replyIntent, interaction.id));
    report.actions = actionEvidence;

    for (let sequence = 3; sequence <= 12; sequence += 1) {
      const user = users[(sequence - 1) % users.length]!;
      const current = await waitForProjection(apiBase, user, (value) => Boolean(
        value.currentTurn
        && value.control.canHumanAct
        && value.roleNarrativeState.generationStatus === "IDLE"
        && value.roleNarrativeState.impactStatus === "SYNCED"
      ), 45_000);
      const offered = current.currentTurn!.decisions[(sequence - 3) % Math.max(1, current.currentTurn!.decisions.length)]?.intentDraft;
      actionEvidence.push(await submit(apiBase, user, current, sequence, offered || intentFor(user, sequence)));
      report.actions = actionEvidence;
    }

    const offlineUser = users[2]!;
    const offlinePump = heartbeatPumps[2]!;
    const beforeShortDisconnect = await projection(apiBase, offlineUser);
    offlinePump.pause();
    const shortGrace = await waitForProjection(apiBase, offlineUser, (value) => value.control.mode === "HUMAN_OFFLINE_GRACE", 20_000);
    assert(shortGrace.control.epoch === beforeShortDisconnect.control.epoch, "SHORT_DISCONNECT_GRACE_CHANGED_EPOCH");
    await offlinePump.resume();
    const shortRecovered = await waitForProjection(apiBase, offlineUser, (value) => value.control.mode === "HUMAN_ACTIVE", 20_000);
    assert(shortRecovered.control.epoch === beforeShortDisconnect.control.epoch, "HEARTBEAT_RECOVERY_CHANGED_EPOCH");

    offlinePump.pause();
    const longGrace = await waitForProjection(apiBase, offlineUser, (value) => value.control.mode === "HUMAN_OFFLINE_GRACE", 20_000);
    assert(longGrace.control.epoch === shortRecovered.control.epoch, "LONG_DISCONNECT_GRACE_CHANGED_EPOCH");
    const autoTakeover = await waitForProjection(apiBase, offlineUser, (value) => value.control.mode === "AI_ACTIVE", 20_000);
    assert(autoTakeover.control.epoch === longGrace.control.epoch + 1, "AUTO_TAKEOVER_EPOCH_NOT_INCREMENTED_ONCE");

    await offlinePump.beat();
    await delay(1_200);
    const afterAiHeartbeat = await projection(apiBase, offlineUser);
    assert(afterAiHeartbeat.control.mode === "AI_ACTIVE", "AI_ACTIVE_HEARTBEAT_IMPLICITLY_RECLAIMED");
    assert(afterAiHeartbeat.control.epoch === autoTakeover.control.epoch, "AI_ACTIVE_HEARTBEAT_CHANGED_EPOCH");
    await offlinePump.resume();

    const takeoverAction = await waitForAiTakeover(prisma, runId, offlineUser.roleId, 120_000);
    await request(apiBase, offlineUser, `/v4/rooms/${runId}/game/control/reclaim`, {
      method: "POST",
      body: { idempotencyKey: "three-role-reclaim-0001", expectedControlEpoch: autoTakeover.control.epoch }
    });
    const reclaimed = await waitForProjection(apiBase, offlineUser, (value) => value.control.mode === "HUMAN_ACTIVE", 90_000);
    assert(reclaimed.control.epoch === autoTakeover.control.epoch + 1, "EXPLICIT_RECLAIM_EPOCH_NOT_INCREMENTED_ONCE");
    report.presenceScenario = {
      roleId: offlineUser.roleId,
      beforeShortDisconnect: beforeShortDisconnect.control,
      shortGrace: shortGrace.control,
      shortRecovered: shortRecovered.control,
      longGrace: longGrace.control,
      autoTakeover: autoTakeover.control,
      afterAiHeartbeat: afterAiHeartbeat.control,
      reclaimed: reclaimed.control,
      takeoverActionId: takeoverAction.id
    };
    await waitForOutboxSettled(prisma, runId, 240_000);

    const projections = await Promise.all(users.map((user) => waitForProjection(
      apiBase,
      user,
      (value) => value.worldSequence >= 12 && value.roleNarrativeState.impactStatus !== "SYNCING",
      45_000
    )));
    projections.forEach((value, index) => assertProjectionPrivacy(value, users[index]!, users));
    assert(projections.every((value) => value.worldSequence === projections[0]!.worldSequence), "WORLD_SEQUENCE_DIVERGED");
    assert(projections[0]!.worldSequence >= 12, `WORLD_SEQUENCE_TOO_LOW:${projections[0]!.worldSequence}`);
    assert(new Set(projections.map((value) => value.player.roleId)).size === 3, "ROLE_PROJECTIONS_NOT_DISTINCT");
    assert(reclaimed.control.canHumanAct, "RECLAIM_DID_NOT_RESTORE_HUMAN_CONTROL");

    const [run, resolutions, interactions, entries, controls, controlTransitions, outbox, reclaimCreditLedger, aiActions] = await Promise.all([
      prisma.storyRun.findUniqueOrThrow({ where: { id: runId } }),
      prisma.actionResolution.findMany({
        where: { runId },
        orderBy: { appliedWorldSequence: "asc" },
        include: { playerAction: { select: { actorKind: true } } }
      }),
      prisma.interactionRequestV2.findMany({ where: { runId }, orderBy: { createdAt: "asc" } }),
      prisma.narrativeEntry.findMany({ where: { runId }, orderBy: [{ worldSequence: "asc" }, { createdAt: "asc" }] }),
      prisma.roleControl.findMany({ where: { runId }, orderBy: { roleId: "asc" } }),
      prisma.roleControlTransition.findMany({
        where: { roleControl: { runId } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }),
      prisma.storyTaskOutbox.findMany({ where: { runId }, orderBy: { createdAt: "asc" } }),
      prisma.creditLedger.findUnique({ where: { id: reclaimCredit.ledgerId } }),
      prisma.playerAction.findMany({ where: { runId, actorKind: "AI_TAKEOVER" }, orderBy: { createdAt: "asc" } })
    ]);
    const humanResolutions = resolutions.filter((item) => item.playerAction.actorKind === "HUMAN");
    assert(humanResolutions.length === 12, `HUMAN_RESOLUTION_COUNT:${humanResolutions.length}`);
    assert(new Set(resolutions.map((item) => item.appliedWorldSequence)).size === resolutions.length, "RESOLUTION_SEQUENCE_NOT_UNIQUE");
    assert(interactions.some((item) => item.status === "RESPONDED"), "INTERACTION_NOT_RESPONDED");
    assert(controls.some((item) => item.roleId === users[2]!.roleId && item.mode === "HUMAN_ACTIVE" && item.epoch >= 3), "CONTROL_EPOCH_NOT_ADVANCED");
    const offlineControl = controls.find((item) => item.roleId === users[2]!.roleId);
    assert(offlineControl, "OFFLINE_CONTROL_MISSING");
    const offlineTransitions = controlTransitions.filter((item) => item.roleControlId === offlineControl.id);
    assert(offlineTransitions.filter((item) => item.reason === "DISCONNECT_DETECTED").length === 2, "DISCONNECT_DETECTED_TRANSITION_COUNT");
    assert(offlineTransitions.some((item) => item.reason === "HEARTBEAT_RECOVERED"
      && item.fromMode === "HUMAN_OFFLINE_GRACE" && item.toMode === "HUMAN_ACTIVE"
      && item.fromEpoch === item.toEpoch), "HEARTBEAT_RECOVERY_TRANSITION_MISSING");
    assert(offlineTransitions.some((item) => item.reason === "DISCONNECT_TIMEOUT"
      && item.fromMode === "HUMAN_OFFLINE_GRACE" && item.toMode === "AI_ACTIVE"
      && item.toEpoch === item.fromEpoch + 1), "AUTO_TAKEOVER_TRANSITION_MISSING");
    assert(offlineTransitions.some((item) => ["PLAYER_RECLAIMED", "PLAYER_RECLAIM_SCHEDULED"].includes(item.reason)
      && item.fromMode === "AI_ACTIVE" && item.toEpoch === item.fromEpoch + 1), "EXPLICIT_RECLAIM_TRANSITION_MISSING");
    assert(reclaimCreditLedger?.userId === users[2]!.userId, "RECLAIM_TEST_CREDIT_LEDGER_MISSING");
    assert(reclaimCreditLedger.reason === "ADMIN_ADJUSTMENT" && reclaimCreditLedger.bonusDelta === 1, "RECLAIM_TEST_CREDIT_LEDGER_INVALID");
    assert(aiActions.length >= 1, "AI_TAKEOVER_ACTION_MISSING");
    assert(aiActions.some((item) => item.id === takeoverAction.id), "WAITED_AI_TAKEOVER_ACTION_NOT_DURABLE");
    const disconnectAgentTask = outbox.find((item) => item.taskType === "ACTOR_AGENT_TURN_V2"
      && (item.identityJson as any)?.controlReason === "DISCONNECT_TIMEOUT");
    assert(disconnectAgentTask, "DISCONNECT_AGENT_TASK_IDENTITY_MISSING");
    assert((disconnectAgentTask.identityJson as any).controlEpoch === autoTakeover.control.epoch, "DISCONNECT_AGENT_TASK_EPOCH_MISMATCH");
    assert(typeof (disconnectAgentTask.identityJson as any).controlTransitionId === "string", "DISCONNECT_AGENT_TASK_TRANSITION_MISSING");
    assert(String((disconnectAgentTask.identityJson as any).standingPolicyCandidate?.id || "").startsWith("standing_policy_"), "DISCONNECT_STANDING_POLICY_SNAPSHOT_MISSING");
    assert(String(disconnectAgentTask.dedupeKey).endsWith(`:${autoTakeover.control.epoch}`), "DISCONNECT_AGENT_TASK_DEDUPE_NOT_EPOCH_SCOPED");
    const takeoverAudit = (takeoverAction.normalizedJson as any)?.agentDecisionAudit;
    assert(takeoverAudit?.decisionSource === "STANDING_POLICY", "AI_TAKEOVER_DECISION_SOURCE_NOT_AUDITABLE");
    assert(takeoverAudit?.controlReason === "DISCONNECT_TIMEOUT", "AI_TAKEOVER_CONTROL_REASON_NOT_AUDITABLE");
    assert(takeoverAudit?.controlEpoch === autoTakeover.control.epoch, "AI_TAKEOVER_AUDIT_EPOCH_MISMATCH");
    assert(takeoverAudit?.reviewedCandidatesIgnored === true, "AI_TAKEOVER_REVIEWED_CANDIDATES_NOT_IGNORED");
    assert(takeoverAudit?.standingPolicyId === (disconnectAgentTask.identityJson as any).standingPolicyCandidate.id, "AI_TAKEOVER_POLICY_SNAPSHOT_CHANGED");
    assert(takeoverAudit?.policyHash === (disconnectAgentTask.identityJson as any).policyHash, "AI_TAKEOVER_POLICY_HASH_CHANGED");
    const blockingTasks = outbox.filter((item) => ["PENDING", "RUNNING", "FAILED"].includes(item.status));
    assert(blockingTasks.length === 0, `UNFINISHED_BLOCKING_TASKS:${blockingTasks.length}`);
    const profileCounts = Object.fromEntries(
      ["narrator", "options", "storykeeper", "agent"].map((profile) => [
        profile,
        providerCalls.filter((call) => call.profile === profile).length
      ])
    );
    const openingPhaseCount = controls.length;
    const resultPhaseCount = resolutions.length;
    const expectedRoleNarrativePhases = openingPhaseCount + resultPhaseCount;
    assert(profileCounts.narrator === expectedRoleNarrativePhases, `NARRATOR_CALL_COUNT:${profileCounts.narrator}:${expectedRoleNarrativePhases}`);
    assert(profileCounts.options === expectedRoleNarrativePhases, `OPTIONS_CALL_COUNT:${profileCounts.options}:${expectedRoleNarrativePhases}`);
    assert(profileCounts.storykeeper === expectedRoleNarrativePhases, `STORYKEEPER_CALL_COUNT:${profileCounts.storykeeper}:${expectedRoleNarrativePhases}`);
    assert(profileCounts.agent === 0, `UNTRIGGERED_AI_AGENT_CALLS:${profileCounts.agent}`);
    assert(aiActions.length >= 1 && profileCounts.options > 0 && profileCounts.agent === 0, "OFFLINE_STANDING_POLICY_NOT_PROVEN");
    const heartbeatErrors = heartbeatPumps.flatMap((pump) => pump.errors);
    assert(heartbeatErrors.length === 0, `HEARTBEAT_PUMP_ERRORS:${heartbeatErrors.join("|")}`);
    const openingProviderCalls = openingPhaseCount * 3;
    const resultProviderCalls = providerCalls.length - openingProviderCalls;
    const averageProviderCallsPerResolvedAction = resultProviderCalls / Math.max(1, resultPhaseCount);
    assert(averageProviderCallsPerResolvedAction <= 3, `PROVIDER_CALL_BUDGET_EXCEEDED:${averageProviderCallsPerResolvedAction}`);

    report.status = "PASS";
    report.completedAt = new Date().toISOString();
    report.apiBase = apiBase;
    report.actions = actionEvidence;
    report.projections = projections.map((value) => ({
      roleId: value.player.roleId,
      roleKey: value.player.roleKey,
      worldSequence: value.worldSequence,
      timelineEntries: value.timeline.length,
      pendingInteractions: value.pendingInteractions.length,
      impactStatus: value.roleNarrativeState.impactStatus,
      control: value.control
    }));
    report.readback = {
      run: { id: run.id, engineVersion: run.engineVersion, worldSequence: run.worldSequence, status: run.status },
      resolutionCount: resolutions.length,
      humanResolutionCount: humanResolutions.length,
      resolutionSequences: resolutions.map((item) => item.appliedWorldSequence),
      interactionStatuses: interactions.map((item) => item.status),
      narrativeEntryCount: entries.length,
      controlEpochs: controls.map((item) => ({ roleId: item.roleId, mode: item.mode, epoch: item.epoch })),
      offlineControlTransitions: offlineTransitions.map((item) => ({
        fromMode: item.fromMode,
        toMode: item.toMode,
        fromEpoch: item.fromEpoch,
        toEpoch: item.toEpoch,
        reason: item.reason,
        idempotencyKey: item.idempotencyKey
      })),
      reclaimCreditLedger: reclaimCreditLedger ? {
        id: reclaimCreditLedger.id,
        userId: reclaimCreditLedger.userId,
        reason: reclaimCreditLedger.reason,
        bonusDelta: reclaimCreditLedger.bonusDelta,
        idempotencyKey: reclaimCreditLedger.idempotencyKey
      } : null,
      aiTakeoverActions: aiActions.map((item) => ({
        id: item.id,
        roleId: item.roleId,
        actionKey: item.actionKey,
        agentDecisionAudit: (item.normalizedJson as any)?.agentDecisionAudit || null,
        appliedWorldSequence: (item.resolvedJson as any)?.appliedWorldSequence ?? null
      })),
      unfinishedBlockingTasks: blockingTasks.map((item) => ({ id: item.id, taskType: item.taskType, status: item.status, lastError: publicError(item.lastError) }))
    };
    report.callBudget = {
      actualHttpProviderRequests: providerCalls.length,
      openingPhaseCount,
      resultPhaseCount,
      humanResultPhaseCount: humanResolutions.length,
      aiResultPhaseCount: aiActions.length,
      profileCounts,
      averageProviderCallsPerResolvedAction,
      humanRoleRuntimeCallsPerAction: 3,
      unaffectedRoleRealtimeNarratorCalls: profileCounts.narrator - expectedRoleNarrativePhases,
      untriggeredAiRoleAgentCalls: profileCounts.agent,
      standingPolicyProof: {
        offlineAiActionCount: aiActions.length,
        reviewedOptionsWereGenerated: profileCounts.options > 0,
        agentDeciderCalls: profileCounts.agent,
        conclusion: "DISCONNECT_TIMEOUT_USED_STANDING_POLICY_WITHOUT_AGENT_DECIDER"
      },
      tokens: providerCalls.reduce((sum, call) => ({
        input: sum.input + call.inputTokens,
        output: sum.output + call.outputTokens,
        total: sum.total + call.totalTokens
      }), { input: 0, output: 0, total: 0 })
    };
    report.providerCalls = providerCalls;
    report.processes = children.map((item) => ({ label: item.label, pid: item.child.pid, exitCode: item.child.exitCode }));
    await saveReport();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    report.status = "FAIL";
    report.message = publicError(String((error as Error)?.message || error));
    report.failedAt = new Date().toISOString();
    report.processes = children.map((item) => ({
      label: item.label,
      pid: item.child.pid,
      exitCode: item.child.exitCode,
      stdoutTail: publicError(item.stdout.split(/\r?\n/).slice(-20).join("\n")),
      stderrTail: publicError(item.stderr.split(/\r?\n/).slice(-20).join("\n"))
    }));
    report.providerCalls = providerCalls;
    await saveReport();
    throw error;
  } finally {
    heartbeatPumps.forEach((pump) => pump.stop());
    await prisma.$disconnect();
    for (const item of children.reverse()) await stop(item.child);
    if (provider) await close(provider);
  }
}

function account(label: string, userId: string, local: string): Session {
  return { label, userId, email: `${runId}-${local}@example.test`, password, cookie: "", roleId: "", roleKey: "", roleName: "" };
}

async function seedAccounts(prisma: PrismaClient) {
  const passwordHash = hashPassword(password);
  for (const user of users) {
    await prisma.user.create({
      data: {
        id: user.userId,
        openid: `local_${user.userId}`,
        email: user.email,
        emailVerifiedAt: new Date(),
        passwordHash,
        nickname: `OpenNovel ${user.label}`,
        avatarUrl: "",
        policyAgreedAt: new Date(),
        status: "active"
      }
    });
  }
}

async function grantReclaimTestCredit(prisma: PrismaClient, user: Session, amount: number) {
  const idempotencyKey = `test-credit:${runId}:${user.userId}:acceptance`;
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.creditWallet.upsert({ where: { userId: user.userId }, create: { userId: user.userId }, update: {} });
    const grant = await tx.creditGrant.create({
      data: {
        userId: user.userId,
        kind: "BONUS",
        source: "ADMIN",
        originalAmount: amount,
        remainingAmount: amount,
        idempotencyKey,
        metadataJson: { runId, purpose: "acceptance", grantedBy: "openovel-mp-three-role" }
      }
    });
    const ledger = await tx.creditLedger.create({
      data: {
        userId: user.userId,
        reason: "ADMIN_ADJUSTMENT",
        bonusDelta: amount,
        idempotencyKey,
        metadataJson: { runId, purpose: "acceptance", grantId: grant.id }
      }
    });
    const updated = await tx.creditWallet.update({
      where: { userId: user.userId },
      data: { bonusBalance: { increment: amount }, version: { increment: 1 } }
    });
    return {
      ledgerId: ledger.id,
      balance: {
        purchased: updated.purchasedBalance,
        bonus: updated.bonusBalance,
        debt: updated.debtBalance,
        available: updated.purchasedBalance + updated.bonusBalance
      },
      initialWalletVersion: wallet.version
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 30_000
  });
}

function hashPassword(value: string) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(value, salt, 64).toString("hex")}`;
}

async function login(apiBase: string, user: Session) {
  const response = await fetch(`${apiBase}/v4/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`LOGIN_FAILED:${user.label}:${response.status}:${JSON.stringify(payload)}`);
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  for (const value of cookies) {
    const match = value.match(/(?:^|,\s*)many_worlds_session=([^;]+)/);
    if (match) return `many_worlds_session=${match[1]}`;
  }
  throw new Error(`LOGIN_COOKIE_MISSING:${user.label}`);
}

async function request<T>(apiBase: string, user: Session, url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${apiBase}${url}`, {
    method: init.method || "GET",
    headers: { "content-type": "application/json", cookie: user.cookie },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method || "GET"} ${url} ${response.status}:${JSON.stringify(payload)}`);
  return payload as T;
}

function projection(apiBase: string, user: Session) {
  return request<Projection>(apiBase, user, `/v4/rooms/${runId}/game`);
}

function createHeartbeatPump(apiBase: string, user: Session): HeartbeatPump {
  let heartbeatSequence = 0;
  let active = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const errors: string[] = [];
  const beat = async () => {
    if (stopped) return;
    heartbeatSequence += 1;
    await request(apiBase, user, `/v4/rooms/${runId}/presence/heartbeat`, {
      method: "POST",
      body: {
        sessionInstanceId: `three-role-${user.label}`,
        heartbeatSequence,
        lastAppliedDeliverySequence: 0
      }
    });
  };
  const schedule = () => {
    if (!active || stopped) return;
    timer = setTimeout(async () => {
      timer = null;
      try {
        await beat();
      } catch (error) {
        errors.push(publicError(String((error as Error)?.message || error)));
      }
      schedule();
    }, heartbeatIntervalMs);
    timer.unref?.();
  };
  return {
    beat,
    errors,
    pause() {
      active = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    async resume() {
      if (stopped) throw new Error(`HEARTBEAT_PUMP_STOPPED:${user.label}`);
      if (active) return;
      active = true;
      await beat();
      schedule();
    },
    stop() {
      stopped = true;
      active = false;
      if (timer) clearTimeout(timer);
      timer = null;
    }
  };
}

async function waitForProjection(apiBase: string, user: Session, predicate: (value: Projection) => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let latest: Projection | null = null;
  while (Date.now() < deadline) {
    latest = await projection(apiBase, user);
    if (predicate(latest)) return latest;
    await delay(150);
  }
  throw new Error(`PROJECTION_TIMEOUT:${user.label}:${latest ? JSON.stringify({ worldSequence: latest.worldSequence, control: latest.control, state: latest.roleNarrativeState }) : "none"}`);
}

async function waitForOutboxSettled(prisma: PrismaClient, targetRunId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let latest = { pending: 0, running: 0 };
  while (Date.now() < deadline) {
    const [pending, running] = await Promise.all([
      prisma.storyTaskOutbox.count({ where: { runId: targetRunId, status: "PENDING" } }),
      prisma.storyTaskOutbox.count({ where: { runId: targetRunId, status: "RUNNING" } })
    ]);
    latest = { pending, running };
    if (pending === 0 && running === 0) return;
    await delay(250);
  }
  throw new Error(`OUTBOX_SETTLE_TIMEOUT:${JSON.stringify(latest)}`);
}

async function waitForAiTakeover(prisma: PrismaClient, targetRunId: string, roleId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const action = await prisma.playerAction.findFirst({
      where: { runId: targetRunId, roleId, actorKind: "AI_TAKEOVER", status: "resolved" },
      orderBy: { createdAt: "desc" }
    });
    if (action) return action;
    await delay(250);
  }
  throw new Error(`AI_TAKEOVER_TIMEOUT:${roleId}`);
}

function intentFor(user: Session, sequence: number, target: {
  type?: string;
  id?: string;
  label?: string;
  effectClaim?: string;
  visibility?: string;
} = {}) {
  const directed = Boolean(target.type || target.id || target.label);
  return {
    objective: directed ? `推进第 ${sequence} 项可复核处置并保留各角色独立决定权` : `核实第 ${sequence} 项当前角色可见的处置线索`,
    target: {
      type: target.type || "PUBLIC_FRAME",
      id: target.id || "shared_world_pressure",
      label: target.label || "当前共同局势"
    },
    method: directed
      ? `${user.roleName}安排经手人记录本轮请求、传递路径与可观察结果，不替任何其他角色宣布决定`
      : "先通过可收集民情、田契与县衙文书核实相关线索，再决定本角色下一步",
    leverageKeys: [],
    visibility: target.visibility || "OBSERVABLE",
    riskTolerance: "LOW",
    ...(target.effectClaim ? { effectClaim: target.effectClaim } : {}),
    fallback: null,
    condition: null,
    freeText: directed ? `第 ${sequence} 项三角色验收行动` : `第 ${sequence} 项先核实当前角色可见线索再作本角色决定`
  };
}

async function submit(apiBase: string, user: Session, current: Projection, sequence: number, intent: Record<string, unknown>, interactionId?: string) {
  assert(current.currentTurn, `TURN_MISSING:${user.label}:${sequence}`);
  const body = {
    idempotencyKey: `three-role-action-${String(sequence).padStart(4, "0")}`,
    turnRevision: current.currentTurn.revision,
    controlEpoch: current.control.epoch,
    customAction: `${user.roleName}执行第 ${sequence} 项明确、可复核且不越权的行动`,
    decisionForm: interactionId ? "CONVERSATION" : "CUSTOM_PLAN",
    ...(interactionId ? { interactionId } : {}),
    intent
  };
  const url = interactionId
    ? `/v4/rooms/${runId}/interactions/${interactionId}/reply`
    : `/v4/rooms/${runId}/game/turns/${current.currentTurn.id}/decision`;
  const response = await fetch(`${apiBase}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: user.cookie },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  let receipt;
  try {
    receipt = parseOpenNovelActionReceipt(response.status, payload);
  } catch {
    throw new Error(`POST ${url} ${response.status}:${JSON.stringify(payload)}`);
  }
  assert(receipt.appliedWorldSequence >= sequence, `ACTION_SEQUENCE_INVALID:${sequence}`);
  await waitForProjection(
    apiBase,
    user,
    (value) => value.worldSequence >= receipt.appliedWorldSequence
      && value.roleNarrativeState.generationStatus === "IDLE"
      && value.timeline.some((item) => item.worldSequence === receipt.appliedWorldSequence),
    90_000
  );
  return {
    sequence,
    roleId: user.roleId,
    roleKey: user.roleKey,
    interactionReply: Boolean(interactionId),
    deferredReceipt: receipt.deferred,
    resolutionId: receipt.resolutionId,
    appliedWorldSequence: receipt.appliedWorldSequence
  };
}

function assertProjectionPrivacy(value: Projection, current: Session, all: Session[]) {
  assert(value.engineVersion === "continuous_openovel_v1", `PROJECTION_ENGINE:${current.label}`);
  assert(value.runtimeMode === "OPENOVEL_ROLE_V1", `PROJECTION_RUNTIME:${current.label}`);
  assert(value.player.roleId === current.roleId, `PROJECTION_ROLE:${current.label}`);
  const serialized = JSON.stringify(value);
  for (const other of all.filter((candidate) => candidate.roleId !== current.roleId)) {
    assert(!serialized.includes(`private:${other.roleId}`), `PRIVATE_SENTINEL_LEAK:${current.label}:${other.label}`);
  }
  const forbiddenKeys = new Set(["prompt", "systemPrompt", "userPrompt", "statePatch", "statePatchJson", "rationale", "rawOutput", "providerPayload"]);
  walk(value, (key) => assert(!forbiddenKeys.has(key), `INTERNAL_KEY_LEAK:${current.label}:${key}`));
}

function walk(value: unknown, visit: (key: string) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return value.forEach((item) => walk(item, visit));
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    visit(key);
    walk(item, visit);
  }
}

function createDeterministicProvider() {
  let narrationIndex = 0;
  return createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
      response.writeHead(404).end();
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    const body = JSON.parse(raw || "{}") as { model?: string; messages?: Array<{ content?: string }> };
    const prompt = body.messages?.map((item) => String(item.content || "")).join("\n") || "";
    const profile = body.model === "mock-options" ? "options"
      : body.model === "mock-storykeeper" ? "storykeeper"
        : body.model === "mock-agent" ? "agent"
          : "narrator";
    providerCalls.push({
      model: String(body.model || "deterministic-test-model"),
      profile,
      inputTokens: 40,
      outputTokens: 80,
      totalTokens: 120
    });
    let content: string;
    if (body.model === "mock-options" || prompt.includes("Return strict JSON {\"options\"")) {
      content = JSON.stringify({
        options: [{
          id: "verify_visible_records",
          label: "Verify the visible records before changing course",
          intentProposal: {
            objective: "Verify the currently visible records while preserving each role's independent authority",
            target: { type: "PUBLIC_FRAME", id: "shared_world_pressure", label: "Current shared pressure" },
            method: "Check the visible chain of custody and defer irreversible action until new evidence arrives",
            leverageKeys: [],
            visibility: "OBSERVABLE",
            riskTolerance: "LOW"
          }
        }]
      });
    } else if (body.model === "mock-storykeeper" || prompt.includes("Return strict JSON {\"guidance\"")) {
      content = JSON.stringify({ guidance: "只保留本角色已知的可见压力。", memory: "本轮行动已经结算，其他角色仍独立决定。", contextCards: [] });
    } else if (body.model === "mock-agent" || prompt.includes("AGENT_DECIDER") || prompt.includes("候选行动")) {
      const candidateId = prompt.match(/\"id\"\s*:\s*\"([^\"]+)\"/)?.[1] || prompt.match(/candidateId[^A-Za-z0-9_-]+([A-Za-z0-9_-]+)/)?.[1] || "missing";
      content = JSON.stringify({ candidateId, rationale: "选择一个已经审查且不越过其他角色决定权的行动。" });
    } else {
      narrationIndex += 1;
      content = deterministicNarration(prompt, narrationIndex);
    }
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      model: body.model || "deterministic-test-model",
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 40, completion_tokens: 80, total_tokens: 120 }
    }));
  });
}

function deterministicNarration(prompt: string, narrationIndex: number) {
  const workingSet = prompt.match(/ROLE WORKING SET:\s*([\s\S]*?)\n\nCONFIRMED RESOLUTION:/)?.[1] || "";
  const roleName = workingSet.match(/## 本角色视角\s*\n([^（\n]+)/)?.[1]?.trim() || "当前角色";
  const sceneTitle = workingSet.match(/## 当前场景[\s\S]*?### [^\n]*《([^》]+)》/)?.[1]?.trim() || "改桑急令";
  const pressure = sectionFirstParagraph(workingSet, "## 眼前压力") || "朝廷限期催办改桑，地方执行已经出现裂缝";
  const visibleFact = sectionFirstParagraph(workingSet, "## 已确认可见事实") || "朝廷限期催办改桑，地方执行已出现裂缝。";
  const confirmed = prompt.match(/CONFIRMED RESOLUTION:\s*([\s\S]*?)\n\nREADER ACTION:/)?.[1]?.trim() || "";
  const readerAction = prompt.match(/READER ACTION:\s*([\s\S]*?)\n\nVISIBLE EVENTS:/)?.[1]?.trim() || "";
  const actionBeat = confirmed && confirmed !== "Opening only."
    ? `${readerAction && readerAction !== "None." ? `${readerAction.replace(/\s+/g, "，")}。` : ""}${confirmed.replace(/\s+/g, "，")}。`
    : "案前的公文与县册仍在等待一项能够被查验的处置。";
  return [
    `${roleName}面对第${narrationIndex}次${sceneTitle}局势时，没有把压力当成一句空泛命令。${pressure}，因此眼前每一步都必须留下经手人、文书去向与可复核的时限。`,
    `${visibleFact} ${actionBeat}已经发生的传递会写入当前记录；尚未获得的证据、尚未作出的决定和其他角色的私下判断仍然保持未知。`,
    `新的压力于是落回${roleName}面前：他可以继续追问、查验或调整自己的办法，却不能越过另一角色的选择，也不能把一次尝试写成已经成功的结果。`
  ].join("\n\n");
}

function sectionFirstParagraph(workingSet: string, heading: string) {
  const section = workingSet.split(heading)[1]?.split(/\n\n## /, 1)[0] || "";
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))[0]
    ?.replace(/\s+/g, " ")
    .slice(0, 260) || "";
}

function start(label: string, args: string[], env: Record<string, string>) {
  const state: ProcessLog = { label, child: null as never, stdout: "", stderr: "" };
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  state.child = child;
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => { state.stdout += chunk; });
  child.stderr?.on("data", (chunk) => { state.stderr += chunk; });
  children.push(state);
  return state;
}

async function waitForHttp(url: string, process: ProcessLog, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null) throw new Error(`${process.label.toUpperCase()}_EXITED:${process.child.exitCode}:${publicError(process.stderr)}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`${process.label.toUpperCase()}_READINESS_TIMEOUT:${publicError(process.stderr)}`);
}

async function reservePorts(count: number) {
  const ports: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    ports.push((server.address() as net.AddressInfo).port);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return ports;
}

function listen(server: Server, port: number) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

function close(server: Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(3_000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); })
  ]);
}

function requiredEnv(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function publicError(value: unknown) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[DATABASE_URL_REDACTED]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .slice(0, 8_000);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function saveReport() {
  return writeFile(path.join(evidenceDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

void main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", message: publicError((error as Error)?.message || error) })}\n`);
  process.exitCode = 1;
});
