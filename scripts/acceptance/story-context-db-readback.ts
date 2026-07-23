import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [contexts, prompts, columns] = await Promise.all([
    prisma.storyContextSnapshotV2.count(),
    prisma.promptExecutionRecord.count(),
    prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('StoryContextSnapshotV2', 'PromptExecutionRecord')
      ORDER BY table_name, ordinal_position
    `
  ]);
  const names = new Set(columns.map((column) => `${column.table_name}.${column.column_name}`));
  const evidence = {
    contexts,
    prompts,
    columnCount: columns.length,
    requiredColumns: {
      snapshotHash: names.has("StoryContextSnapshotV2.snapshotHash"),
      reportJson: names.has("StoryContextSnapshotV2.reportJson"),
      pipelineStep: names.has("PromptExecutionRecord.pipelineStep"),
      contextSnapshotHash: names.has("PromptExecutionRecord.contextSnapshotHash"),
      inputJson: names.has("PromptExecutionRecord.inputJson"),
      issueCodesJson: names.has("PromptExecutionRecord.issueCodesJson")
    }
  };
  if (!Object.values(evidence.requiredColumns).every(Boolean)) {
    throw new Error(`story context database readback failed: ${JSON.stringify(evidence)}`);
  }
  console.log(JSON.stringify(evidence));
}

void main().finally(() => prisma.$disconnect());
