import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const [storyRuns, storyTasks, playerActions] = await Promise.all([
    prisma.storyRun.count(),
    prisma.storyTaskOutbox.count(),
    prisma.playerAction.count()
  ]);
  const counts = { storyRuns, storyTasks, playerActions };
  if (Object.values(counts).some((count) => count !== 0)) {
    throw new Error(`OPENOVEL_MP_SCHEMA_NOT_CLEAN:${JSON.stringify(counts)}`);
  }
  process.stdout.write(`${JSON.stringify({ status: "PASS", counts })}\n`);
} finally {
  await prisma.$disconnect();
}
