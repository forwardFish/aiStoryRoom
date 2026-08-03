import { PrismaClient } from "@prisma/client";
import { access, readFile, writeFile } from "node:fs/promises";
import { publishOpenNovelImpactReceipt, type OpenNovelImpactReceiptInput } from "../../apps/api/src/continuous-story-v2/openovel-impact-receipt";
import { continuousStoryV2Serializable } from "../../apps/api/src/continuous-story-v2/serializable-retry";

type WorkerInput = {
  receipt: OpenNovelImpactReceiptInput;
  runtimeUrl?: string;
  internalToken?: string;
  runtimeMarkerPath?: string;
};

async function main() {
const [mode, inputPath, readyPath, startPath] = process.argv.slice(2);
if (!mode || !inputPath || !readyPath || !startPath) throw new Error("OPENOVEL_MP_WORKER_ARGS_REQUIRED");
const input = JSON.parse(await readFile(inputPath, "utf8")) as WorkerInput;
await writeFile(readyPath, `${process.pid}\n`, "utf8");
await waitForFile(startPath, 15_000);

try {
  if (mode === "receipt") {
    const prisma = new PrismaClient();
    try {
      const result = await continuousStoryV2Serializable(
        prisma,
        (tx) => publishOpenNovelImpactReceipt(tx, input.receipt),
        { timeoutMs: 20_000 }
      );
      process.stdout.write(`${JSON.stringify({ status: "PASS", mode, pid: process.pid, result })}\n`);
    } finally {
      await prisma.$disconnect();
    }
  } else if (mode === "runtime-crash") {
    if (!input.runtimeUrl || !input.internalToken || !input.runtimeMarkerPath) throw new Error("RUNTIME_CRASH_INPUT_REQUIRED");
    const receipt = input.receipt;
    const body = {
      schemaVersion: "role_impact_sync_v1",
      runtimeMode: "OPENOVEL_ROLE_V1",
      roomId: receipt.runId,
      roleId: receipt.roleId,
      actorTurnId: `impact-${receipt.playerActionId}`,
      baseWorldSequence: receipt.appliedWorldSequence - 1,
      appliedWorldSequence: receipt.appliedWorldSequence,
      contextSnapshotHash: `ctx-${receipt.playerActionId}`,
      renderedWorkingSet: receipt.impactSeed,
      visibleWorldEvents: [{
        schemaVersion: "role_visible_event_v1",
        id: receipt.playerActionId,
        worldSequence: receipt.appliedWorldSequence,
        type: "CROSS_IMPACT",
        content: receipt.impactSeed
      }],
      pendingInteractions: [],
      idempotencyKey: `impact:${receipt.playerActionId}:${receipt.roleId}:${receipt.appliedWorldSequence}`
    };
    const response = await fetch(`${input.runtimeUrl}/internal/openovel/rooms/${encodeURIComponent(receipt.runId)}/roles/${encodeURIComponent(receipt.roleId)}/impacts`, {
      method: "POST",
      headers: { authorization: `Bearer ${input.internalToken}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`RUNTIME_IMPACT_FAILED:${response.status}:${String((payload as any).code || "UNKNOWN")}`);
    if (Number((payload as any).appliedWorldSequence) !== receipt.appliedWorldSequence) throw new Error("RUNTIME_IMPACT_SEQUENCE_MISMATCH");
    await writeFile(input.runtimeMarkerPath, `${JSON.stringify({
      status: "RUNTIME_COMMITTED_DB_PENDING",
      pid: process.pid,
      roomId: receipt.runId,
      roleId: receipt.roleId,
      appliedWorldSequence: receipt.appliedWorldSequence,
      workspaceRevision: Number((payload as any).workspaceRevision || 0)
    }, null, 2)}\n`, "utf8");
    process.exit(86);
  } else {
    throw new Error(`OPENOVEL_MP_WORKER_MODE_INVALID:${mode}`);
  }
} catch (error) {
  const message = String((error as Error)?.message || error).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[DATABASE_URL_REDACTED]");
  process.stderr.write(`${JSON.stringify({ status: "FAIL", mode, pid: process.pid, message })}\n`);
  process.exitCode = 1;
}

async function waitForFile(path: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await access(path); return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("OPENOVEL_MP_WORKER_START_TIMEOUT");
}
}

void main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", mode: "startup", pid: process.pid, message: String(error?.message || error) })}\n`);
  process.exitCode = 1;
});
