import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const runId = String(process.env.MANY_WORLDS_RUN_ID || "").trim();
const schema = String(process.env.MANY_WORLDS_DB_SCHEMA || "").trim();
const evidencePath = resolve(process.env.MANY_WORLDS_EVIDENCE_PATH || `D:/tmp/continuous-human-run-audit-${runId || "missing"}.json`);

assert.match(runId, /^cmr[a-z0-9]+$/i, "MANY_WORLDS_RUN_ID must identify the accepted room run");
assert.match(schema, /^cs_accept_[a-z0-9_]+$/i, "MANY_WORLDS_DB_SCHEMA must be an isolated acceptance schema");

function configuredSupabaseUrl() {
  const line = requireEnvFileValue("SUPABASE_DATABASE_URL");
  const url = new URL(line);
  assert.ok(!["localhost", "127.0.0.1", "::1"].includes(url.hostname), "local PostgreSQL is forbidden for this audit");
  assert.match(url.hostname, /supabase/i, "the audit database must be Supabase");
  url.searchParams.set("schema", schema);
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("sslmode", "disable");
  return url.toString();
}

function requireEnvFileValue(key: string) {
  const contents = readFileSync(resolve(".env"), "utf8");
  const line = contents.split(/\r?\n/).find((entry) => entry.trimStart().startsWith(`${key}=`));
  assert.ok(line, `${key} is required in .env`);
  const raw = line.slice(line.indexOf("=") + 1).trim();
  return raw.replace(/^(['"])(.*)\1$/, "$2");
}

function controllerKind(mode: string) {
  if (mode === "HUMAN_ACTIVE" || mode === "HUMAN_OFFLINE_GRACE") return "HUMAN";
  if (mode === "AI_ACTIVE" || mode === "HUMAN_RECLAIM_PENDING") return "AI";
  if (mode === "SYSTEM") return "SYSTEM";
  return "UNKNOWN";
}

function counts<T extends string>(values: T[]) {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((entry) => entry === value).length]));
}

function assertStageCoverage(values: number[], label: string, perStage: number) {
  assert.deepEqual([...new Set(values)].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7], `${label} must cover stages 1-7`);
  for (let stage = 1; stage <= 7; stage += 1) {
    assert.equal(values.filter((value) => value === stage).length, perStage, `${label} stage ${stage} count`);
  }
}

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: configuredSupabaseUrl() } } });
  try {
    const [run, actions, windows, controls, resolutions, narratives, unlock, agentDecisions, workflows] = await Promise.all([
      prisma.storyRun.findUnique({
        where: { id: runId },
        select: {
          id: true, status: true, mode: true, templateKey: true, engineVersion: true, strategyVersion: true,
          currentDay: true, totalDays: true, completedNodeCount: true, accessLevel: true, freeDecisionsUsed: true,
          roles: { select: { id: true, roleKey: true, roleName: true } },
          players: { where: { status: "active" }, select: { id: true, userId: true, playerType: true, roleId: true, status: true } }
        }
      }),
      prisma.playerAction.findMany({
        where: { runId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, roleId: true, userId: true, actionSlot: true, actorKind: true, status: true, method: true,
          controlEpoch: true, node: { select: { nodeIndex: true } }
        }
      }),
      prisma.actionWindow.findMany({
        where: { runId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true, status: true, resolvedAt: true, node: { select: { nodeIndex: true } },
          participants: { select: { roleId: true, mainStatus: true, maneuverStatus: true, reactionStatus: true, doneAt: true } }
        }
      }),
      prisma.roleControl.findMany({
        where: { runId },
        select: {
          id: true, roleId: true, humanPlayerId: true, mode: true, epoch: true,
          transitions: { orderBy: { createdAt: "asc" }, select: { fromMode: true, toMode: true, fromEpoch: true, toEpoch: true, reason: true, createdAt: true } }
        }
      }),
      prisma.directorResolution.findMany({
        where: { runId },
        select: { id: true, auditStatus: true, node: { select: { nodeIndex: true } } }
      }),
      prisma.narrativeEntry.findMany({
        where: { runId },
        select: { id: true, roleId: true, entryType: true, visibility: true, content: true, node: { select: { nodeIndex: true } } }
      }),
      prisma.worldUnlock.findUnique({ where: { runId } }),
      prisma.roleAgentDecision.findMany({ where: { runId }, select: { id: true, roleId: true, actionSlot: true, status: true, playerActionId: true } }),
      prisma.resolutionWorkflow.findMany({
        where: { runId },
        select: { id: true, status: true, node: { select: { nodeIndex: true } }, checkpoints: { select: { checkpointKey: true } } }
      })
    ]);

    assert.ok(run, "run not found in the declared Supabase schema");
    assert.equal(run.status, "chapter_generated");
    assert.equal(run.mode, "room");
    assert.equal(run.templateKey, "sangtian");
    assert.equal(run.engineVersion, "continuous_strategy_v1_1");
    assert.equal(run.strategyVersion, "sangtian_v1_1");
    assert.equal(run.currentDay, 7);
    assert.equal(run.totalDays, 7);
    assert.equal(run.completedNodeCount, 7);
    assert.equal(run.accessLevel, "UNLOCKED");
    assert.equal(run.freeDecisionsUsed, 3);
    assert.equal(run.roles.length, 3, "only the three playable roles may have StoryRole rows");
    assert.equal(run.players.length, 3);
    assert.equal(new Set(run.players.map((entry) => entry.userId)).size, 3);
    assert.equal(new Set(run.players.map((entry) => entry.roleId)).size, 3);
    assert.ok(run.players.every((entry) => entry.playerType === "human" && entry.roleId));

    const main = actions.filter((entry) => entry.actionSlot === "MAIN");
    const maneuvers = actions.filter((entry) => entry.actionSlot === "MANEUVER");
    const reactions = actions.filter((entry) => entry.actionSlot === "REACTION");
    const system = actions.filter((entry) => entry.actionSlot === "SYSTEM_ACTION");
    assert.equal(main.length, 21);
    assert.equal(maneuvers.length, 21);
    assert.equal(reactions.length, 3);
    assert.equal(system.length, 7);
    assert.ok([...main, ...maneuvers, ...reactions].every((entry) => entry.actorKind === "HUMAN" && entry.status === "accepted" && entry.roleId && entry.userId));
    assert.ok(system.every((entry) => entry.actorKind === "SYSTEM" && entry.status === "accepted" && !entry.roleId));
    assert.equal(actions.filter((entry) => ["AI_TAKEOVER", "TIMEOUT_FALLBACK"].includes(String(entry.actorKind))).length, 0);
    assertStageCoverage(main.map((entry) => entry.node.nodeIndex), "MAIN", 3);
    assertStageCoverage(maneuvers.map((entry) => entry.node.nodeIndex), "MANEUVER", 3);
    assertStageCoverage(system.map((entry) => entry.node.nodeIndex), "SYSTEM_ACTION", 1);

    assert.equal(windows.length, 7);
    assertStageCoverage(windows.map((entry) => entry.node.nodeIndex), "ActionWindow", 1);
    assert.ok(windows.every((entry) => entry.status === "RESOLVED" && entry.resolvedAt && entry.participants.length === 3));
    assert.ok(windows.every((entry) => entry.participants.every((participant) => participant.mainStatus === "SUBMITTED" && participant.doneAt)));

    assert.equal(controls.length, 3);
    assert.ok(controls.every((entry) => entry.mode === "HUMAN_ACTIVE" && entry.humanPlayerId));
    const controllerChanges = controls.flatMap((entry) => entry.transitions.filter((transition) => controllerKind(transition.fromMode) !== controllerKind(transition.toMode)));
    assert.equal(controllerChanges.length, 0, "all-human success lane must have no HUMAN/AI controller change");

    assert.equal(resolutions.length, 7);
    assertStageCoverage(resolutions.map((entry) => entry.node.nodeIndex), "DirectorResolution", 1);
    assert.ok(resolutions.every((entry) => entry.auditStatus === "ok"));
    assert.equal(workflows.length, 7);
    assert.ok(workflows.every((entry) => entry.status === "COMPLETED"));
    assertStageCoverage(workflows.map((entry) => entry.node.nodeIndex), "ResolutionWorkflow", 1);

    const narrativeCounts = counts(narratives.map((entry) => entry.entryType));
    assert.equal(narrativeCounts.stage_public_result, 7);
    assert.equal(narrativeCounts.stage_personal_result, 21);
    assert.equal(narrativeCounts.final_public_ending, 1);
    assert.equal(narrativeCounts.final_personal_ending, 3);
    const finalNarratives = narratives.filter((entry) => entry.entryType.startsWith("final_"));
    const internalKey = /\b(?:global|personal|state|asset|main|maneuver|reaction|system|internal)_[a-z0-9_]+\b/i;
    assert.ok(finalNarratives.every((entry) => !internalKey.test(entry.content)), "final narratives must not expose internal keys");
    assert.ok(finalNarratives.every((entry) => /第\s*[1-7]\s*轮/.test(entry.content)), "final narratives must cite real stage numbers");
    assert.ok(finalNarratives.some((entry) => /第\s*7\s*轮/.test(entry.content)), "final narratives must include stage 7 causality");

    assert.ok(unlock, "shared world unlock is required");
    assert.equal(unlock.status, "COMMITTED");
    assert.equal(unlock.creditsCharged, 100);
    const ledgers = await prisma.creditLedger.findMany({ where: { externalRef: runId, reason: "WORLD_UNLOCK" } });
    assert.equal(ledgers.length, 1);
    assert.equal(ledgers[0].id, unlock.debitLedgerId);
    assert.equal(Math.abs(ledgers[0].purchasedDelta + ledgers[0].bonusDelta), 100);
    assert.equal(agentDecisions.length, 0, "all-human lane must not create role-agent decisions");

    const report = {
      schemaVersion: "continuous_human_run_audit_v1",
      verdict: "PASS",
      provider: "supabase",
      schema,
      runId,
      generatedAt: new Date().toISOString(),
      run: {
        status: run.status,
        engineVersion: run.engineVersion,
        strategyVersion: run.strategyVersion,
        stages: run.completedNodeCount,
        playableRoles: run.roles.length,
        humanPlayers: run.players.length,
        accessLevel: run.accessLevel,
        freeDecisionsUsed: run.freeDecisionsUsed
      },
      actions: {
        MAIN: main.length,
        MANEUVER: maneuvers.length,
        REACTION: reactions.length,
        SYSTEM_ACTION: system.length,
        actorKinds: counts(actions.map((entry) => String(entry.actorKind)))
      },
      state: {
        windows: windows.length,
        resolutions: resolutions.length,
        workflows: workflows.length,
        roleControls: controls.length,
        controllerChanges: controllerChanges.length,
        presenceOnlyTransitions: controls.flatMap((entry) => entry.transitions).length - controllerChanges.length,
        roleAgentDecisions: agentDecisions.length
      },
      narratives: narrativeCounts,
      unlock: { creditsCharged: unlock.creditsCharged, payerUserId: unlock.paidByUserId, ledgerCount: ledgers.length },
      decisionTimeline: main.map((entry) => ({ stageIndex: entry.node.nodeIndex, roleId: entry.roleId, title: entry.method, actorKind: entry.actorKind })),
      evidenceSha256: ""
    };
    const canonical = JSON.stringify({ ...report, evidenceSha256: undefined });
    report.evidenceSha256 = createHash("sha256").update(canonical).digest("hex");
    await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ verdict: report.verdict, runId, schema, evidencePath, evidenceSha256: report.evidenceSha256 }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  const failure = {
    schemaVersion: "continuous_human_run_audit_v1",
    verdict: "FAIL",
    provider: "supabase",
    schema,
    runId,
    generatedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error)
  };
  await mkdir(dirname(evidencePath), { recursive: true }).catch(() => undefined);
  await writeFile(evidencePath, `${JSON.stringify(failure, null, 2)}\n`, "utf8").catch(() => undefined);
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
