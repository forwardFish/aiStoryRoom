export const STORY_TASK_SOURCE_FINALIZATION_SCHEMA_V1 = "story-task-source-finalization-v1" as const;

export type StoryTaskLeaseFenceV1 = Readonly<{
  taskId: string;
  leaseOwner: string;
  leaseVersion: number;
}>;

export type StoryTaskSourceFinalizationV1 = Readonly<{
  outcome: string;
  sourceFinalization: Readonly<{
    schemaVersion: typeof STORY_TASK_SOURCE_FINALIZATION_SCHEMA_V1;
    taskId: string;
    leaseOwner: string;
    leaseVersion: number;
  }>;
}>;

export function isStoryTaskSourceFinalizationV1(
  value: unknown,
  fence: StoryTaskLeaseFenceV1,
): value is StoryTaskSourceFinalizationV1 {
  if (!value || typeof value !== "object") return false;
  const marker = (value as { sourceFinalization?: unknown }).sourceFinalization;
  if (!marker || typeof marker !== "object") return false;
  const record = marker as Record<string, unknown>;
  return record.schemaVersion === STORY_TASK_SOURCE_FINALIZATION_SCHEMA_V1
    && record.taskId === fence.taskId
    && record.leaseOwner === fence.leaseOwner
    && record.leaseVersion === fence.leaseVersion;
}
