import { PrismaClient } from "@prisma/client";

const runId = String(process.env.OPENOVEL_MP_READBACK_RUN_ID || "").trim();
if (!runId) throw new Error("OPENOVEL_MP_READBACK_RUN_ID_REQUIRED");

const prisma = new PrismaClient();
try {
  const [actions, tasks, taskDetails, agentTasks, controls] = await Promise.all([
    prisma.playerAction.groupBy({ by: ["actorKind"], where: { runId }, _count: { _all: true } }),
    prisma.storyTaskOutbox.groupBy({ by: ["status"], where: { runId }, _count: { _all: true } }),
    prisma.storyTaskOutbox.findMany({
      where: { runId },
      select: {
        id: true,
        taskType: true,
        inputRefId: true,
        roleId: true,
        controlEpoch: true,
        status: true,
        outcome: true,
        attempt: true,
        lastError: true,
        dedupeKey: true
      },
      orderBy: { createdAt: "asc" }
    }),
    prisma.storyTaskOutbox.findMany({
      where: { runId, taskType: "ACTOR_AGENT_TURN_V2" },
      select: {
        id: true,
        inputRefId: true,
        roleId: true,
        controlEpoch: true,
        status: true,
        outcome: true,
        attempt: true,
        lastError: true,
        dedupeKey: true,
        identityJson: true
      },
      orderBy: { createdAt: "asc" }
    }),
    prisma.roleControl.findMany({
      where: { runId },
      select: { roleId: true, mode: true, epoch: true, reason: true },
      orderBy: { roleId: "asc" }
    })
  ]);
  process.stdout.write(`${JSON.stringify({ runId, actions, tasks, taskDetails, agentTasks, controls }, null, 2)}\n`);
} finally {
  await prisma.$disconnect();
}
