import { PrismaClient } from "@prisma/client";

const runId = String(process.env.OPENOVEL_MP_READBACK_RUN_ID || "").trim();
if (!runId) throw new Error("OPENOVEL_MP_READBACK_RUN_ID_REQUIRED");

const prisma = new PrismaClient();
try {
  const [actions, tasks, controls] = await Promise.all([
    prisma.playerAction.groupBy({ by: ["actorKind"], where: { runId }, _count: { _all: true } }),
    prisma.storyTaskOutbox.groupBy({ by: ["status"], where: { runId }, _count: { _all: true } }),
    prisma.roleControl.findMany({
      where: { runId },
      select: { roleId: true, mode: true, epoch: true, reason: true },
      orderBy: { roleId: "asc" }
    })
  ]);
  process.stdout.write(`${JSON.stringify({ runId, actions, tasks, controls }, null, 2)}\n`);
} finally {
  await prisma.$disconnect();
}
