import { PrismaClient } from "@prisma/client";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OpenNovelImpactReceiptInput } from "../../apps/api/src/continuous-story-v2/openovel-impact-receipt";

type ChildResult = { label: string; pid: number; exitCode: number; stdout: string; stderr: string };

async function main() {
const projectRoot = process.cwd();
const evidenceDir = path.resolve(requiredEnv("OPENOVEL_MP_EVIDENCE_DIR"));
const lane = requiredEnv("OPENOVEL_MP_LANE");
if (!['concurrency', 'fault'].includes(lane)) throw new Error(`OPENOVEL_MP_LANE_INVALID:${lane}`);
await mkdir(evidenceDir, { recursive: true });
const prisma = new PrismaClient();
const runId = `openovel_mp_${Date.now().toString(36)}`;
const roleA = `${runId}_governor`;
const roleB = `${runId}_xunfu`;
const report: Record<string, unknown> = {
  schemaVersion: "openovel_mp_db_acceptance_v1",
  lane,
  status: "RUNNING",
  database: { provider: "postgresql", schema: process.env.OPENOVEL_MP_DB_SCHEMA, isolated: true },
  runId,
  startedAt: new Date().toISOString(),
  processes: []
};

try {
  const commitEntryReport = JSON.parse(await readFile(path.join(evidenceDir, "commit-entry-report.json"), "utf8"));
  if (commitEntryReport.status !== "PASS" || commitEntryReport.lane !== lane) throw new Error("COMMIT_ENTRY_ACCEPTANCE_NOT_PASS");
  report.commitEntry = commitEntryReport;
  await seed(runId, roleA, roleB);
  if (lane === "concurrency") {
    const same = receipt(runId, roleA, "action-same", 1, "A single durable shared-world impact.");
    const sameRace = await runTogether([
      { label: "same-a", mode: "receipt", input: { receipt: same } },
      { label: "same-b", mode: "receipt", input: { receipt: same } }
    ]);
    assertExitCodes(sameRace, [0, 0], "SAME_RECEIPT_RACE");

    const independent = await runTogether([
      { label: "role-a", mode: "receipt", input: { receipt: receipt(runId, roleA, "action-independent", 2, "Governor-visible impact.") } },
      { label: "role-b", mode: "receipt", input: { receipt: receipt(runId, roleB, "action-independent", 2, "Xunfu-visible impact.") } }
    ]);
    assertExitCodes(independent, [0, 0], "INDEPENDENT_ROLE_RACE");
    const entries = await prisma.narrativeEntry.findMany({ where: { runId }, orderBy: [{ worldSequence: "asc" }, { roleId: "asc" }] });
    if (entries.length !== 3) throw new Error(`CONCURRENCY_RECEIPT_COUNT:${entries.length}`);
    if (new Set(entries.map((entry) => entry.dedupeKey)).size !== 3) throw new Error("CONCURRENCY_DEDUPE_NOT_UNIQUE");
    report.processes = [...sameRace, ...independent].map(publicChild);
    report.readback = entries.map((entry) => ({ id: entry.id, roleId: entry.roleId, worldSequence: entry.worldSequence, dedupeKey: entry.dedupeKey }));
  } else {
    const runtimeUrl = requiredEnv("OPENOVEL_RUNTIME_URL");
    const internalToken = requiredEnv("OPENOVEL_INTERNAL_TOKEN");
    const crashReceipt = receipt(runId, roleB, "action-runtime-crash", 3, "Runtime committed this filtered impact before the database receipt.");
    await ensureRuntimeRole(runtimeUrl, internalToken, runId, roleB);
    const marker = path.join(evidenceDir, "runtime-committed-db-pending.json");
    const crashed = await runTogether([{ label: "runtime-crash", mode: "runtime-crash", input: { receipt: crashReceipt, runtimeUrl, internalToken, runtimeMarkerPath: marker } }]);
    assertExitCodes(crashed, [86], "RUNTIME_BEFORE_DB_CRASH");
    const runtimeMarker = JSON.parse(await readFile(marker, "utf8"));
    const before = await prisma.narrativeEntry.count({ where: { runId, dedupeKey: `v2-impact:${crashReceipt.playerActionId}:${roleB}` } });
    if (before !== 0) throw new Error("RUNTIME_CRASH_ALREADY_WROTE_DB_RECEIPT");

    const recovered = await runTogether([{ label: "db-recovery", mode: "receipt", input: { receipt: crashReceipt } }]);
    assertExitCodes(recovered, [0], "DB_RECEIPT_RECOVERY");
    const replayed = await runTogether([{ label: "db-replay", mode: "receipt", input: { receipt: crashReceipt } }]);
    assertExitCodes(replayed, [0], "DB_RECEIPT_REPLAY");
    const conflict = await runTogether([{ label: "identity-conflict", mode: "receipt", input: { receipt: { ...crashReceipt, impactSeed: "Conflicting receipt content must fail closed." } } }]);
    assertExitCodes(conflict, [1], "DB_RECEIPT_IDENTITY_CONFLICT");
    if (!conflict[0]!.stderr.includes("OPENOVEL_IMPACT_RECEIPT_IDENTITY_CONFLICT")) throw new Error("IDENTITY_CONFLICT_CODE_MISSING");
    const entries = await prisma.narrativeEntry.findMany({ where: { runId } });
    if (entries.length !== 1) throw new Error(`FAULT_RECEIPT_COUNT:${entries.length}`);
    const statusResponse = await fetch(`${runtimeUrl}/internal/openovel/rooms/${encodeURIComponent(runId)}/roles/${encodeURIComponent(roleB)}`, {
      headers: { authorization: `Bearer ${internalToken}`, accept: "application/json" }
    });
    const runtimeStatus = await statusResponse.json();
    if (!statusResponse.ok || Number((runtimeStatus as any).appliedWorldSequence) !== 3) throw new Error("RUNTIME_STATUS_DID_NOT_SURVIVE_DB_CRASH");
    report.processes = [...crashed, ...recovered, ...replayed, ...conflict].map(publicChild);
    report.runtimeMarker = runtimeMarker;
    report.runtimeReadback = { appliedWorldSequence: Number((runtimeStatus as any).appliedWorldSequence), workspaceRevision: Number((runtimeStatus as any).workspaceRevision || 0) };
    report.databaseReadback = entries.map((entry) => ({ id: entry.id, roleId: entry.roleId, worldSequence: entry.worldSequence, dedupeKey: entry.dedupeKey, content: entry.content }));
  }
  report.status = "PASS";
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(evidenceDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  report.status = "FAIL";
  report.message = redact(String((error as Error)?.message || error));
  report.failedAt = new Date().toISOString();
  await writeFile(path.join(evidenceDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  throw error;
} finally {
  await prisma.$disconnect();
}

function receipt(runId: string, roleId: string, playerActionId: string, appliedWorldSequence: number, impactSeed: string): OpenNovelImpactReceiptInput {
  return { runId, nodeId: null, roleId, threadId: `${roleId}-thread`, playerActionId, mode: "FULL", impactSeed, appliedWorldSequence };
}

async function seed(runId: string, roleA: string, roleB: string) {
  const userId = `${runId}_user`;
  const templateId = `${runId}_template`;
  await prisma.user.create({ data: { id: userId, openid: `${runId}_openid`, nickname: "OpenNovel DB acceptance" } });
  await prisma.worldTemplate.create({ data: { id: templateId, name: "OpenNovel DB acceptance", genre: "test", hook: "isolated", worldBase: "isolated", status: "test", configJson: {} } });
  await prisma.storyRun.create({ data: {
    id: runId, templateId, ownerUserId: userId, title: "OpenNovel DB acceptance", hook: "isolated",
    mode: "room", templateKey: "sangtian", status: "playing", stateJson: {}, inviteCode: `${runId}_invite`,
    engineVersion: "continuous_openovel_v1", strategyVersion: "continuous_story_v2", worldSequence: 3, reservedWorldSequence: 3
  } });
  for (const [id, key, name] of [[roleA, "zhejiang_governor", "Zhejiang Governor"], [roleB, "zhejiang_xunfu", "Zhejiang Xunfu"]]) {
    await prisma.storyRole.create({ data: {
      id, runId, roleKey: key!, roleName: name!, identity: name!, publicInfo: "public test identity",
      personalGoal: "isolated test goal", currentState: "active", knownInfoJson: [], cannotDoJson: []
    } });
  }
}

async function ensureRuntimeRole(runtimeUrl: string, token: string, runId: string, roleId: string) {
  const response = await fetch(`${runtimeUrl}/internal/openovel/rooms/${encodeURIComponent(runId)}/roles/${encodeURIComponent(roleId)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ runtimeMode: "OPENOVEL_ROLE_V1", roomId: runId, roleId, worldId: "sangtian", storyPackageVersion: "v1" })
  });
  if (!response.ok) throw new Error(`RUNTIME_ROLE_INIT_FAILED:${response.status}`);
}

async function runTogether(definitions: Array<{ label: string; mode: string; input: Record<string, unknown> }>): Promise<ChildResult[]> {
  const group = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startPath = path.join(evidenceDir, `${group}.start`);
  const children = [] as Array<{ label: string; process: ReturnType<typeof spawn>; readyPath: string; stdout: string; stderr: string }>;
  for (const definition of definitions) {
    const inputPath = path.join(evidenceDir, `${group}.${definition.label}.input.json`);
    const readyPath = path.join(evidenceDir, `${group}.${definition.label}.ready`);
    await writeFile(inputPath, `${JSON.stringify(definition.input, null, 2)}\n`, "utf8");
    const child = spawn(process.execPath, ["--import", "tsx", path.join(projectRoot, "scripts/e2e/openovel-mp-db-worker.ts"), definition.mode, inputPath, readyPath, startPath], {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const state = { label: definition.label, process: child, readyPath, stdout: "", stderr: "" };
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { state.stdout += chunk; });
    child.stderr.on("data", (chunk) => { state.stderr += chunk; });
    children.push(state);
  }
  await Promise.all(children.map((child) => waitForFile(child.readyPath, 15_000)));
  await writeFile(startPath, `${new Date().toISOString()}\n`, "utf8");
  return Promise.all(children.map(async (child) => ({
    label: child.label,
    pid: child.process.pid!,
    exitCode: await exitCode(child.process, 30_000),
    stdout: redact(child.stdout),
    stderr: redact(child.stderr)
  })));
}

function assertExitCodes(children: ChildResult[], expected: number[], label: string) {
  const actual = children.map((child) => child.exitCode);
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label}_EXIT_CODES:${actual.join(",")}:${children.map((child) => child.stderr).join("|")}`);
  }
}

function publicChild(child: ChildResult) { return { label: child.label, pid: child.pid, exitCode: child.exitCode, stdout: child.stdout.trim(), stderr: child.stderr.trim() }; }
function requiredEnv(name: string) { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`${name}_REQUIRED`); return value; }
function redact(value: string) { return value.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[DATABASE_URL_REDACTED]").replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]"); }
async function waitForFile(file: string, timeoutMs: number) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { try { await readFile(file); return; } catch {} await new Promise((resolve) => setTimeout(resolve, 20)); } throw new Error(`CHILD_READY_TIMEOUT:${path.basename(file)}`); }
function exitCode(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<number> { return new Promise((resolve, reject) => { const timer = setTimeout(() => { child.kill(); reject(new Error(`CHILD_EXIT_TIMEOUT:${child.pid}`)); }, timeoutMs); child.once("error", reject); child.once("exit", (code) => { clearTimeout(timer); resolve(code ?? -1); }); }); }
}

void main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", message: redactStartup(String(error?.message || error)) })}\n`);
  process.exitCode = 1;
});

function redactStartup(value: string) {
  return value.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[DATABASE_URL_REDACTED]").replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]");
}
