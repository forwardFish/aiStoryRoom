export type UnfinishedRoleImpactTask = {
  id: string;
  roleId: string | null;
  status: string;
  resultJson: unknown;
  inputRefId?: string | null;
};

export type EarlierRoleImpact = {
  taskId: string;
  appliedWorldSequence: number | null;
};

export type ProjectedPendingImpact = {
  id: string;
  status: "PENDING" | "SYNCING" | "RECOVERY_REQUIRED";
  appliedWorldSequence: number | null;
};

export type OpenNovelImpactReceiptInput = {
  runId: string;
  nodeId: string | null;
  roleId: string;
  threadId: string;
  playerActionId: string;
  mode: "FULL" | "TRACE";
  impactSeed: string;
  appliedWorldSequence: number;
};

type OpenNovelImpactReceiptRecord = {
  id: string;
  runId: string;
  nodeId: string | null;
  roleId: string | null;
  entryType: string;
  visibility: string;
  content: string;
  threadKeysJson: unknown;
  sourceEventIdsJson: unknown;
  worldSequence: number | null;
  dedupeKey: string | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sequenceFrom(value: unknown): number | null {
  const sequence = Number(record(value).appliedWorldSequence);
  return Number.isSafeInteger(sequence) && sequence >= 1 ? sequence : null;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

export function findEarlierUnfinishedRoleImpact(
  currentTaskId: string,
  roleId: string,
  appliedWorldSequence: number,
  tasks: UnfinishedRoleImpactTask[]
): EarlierRoleImpact | null {
  const blockers = tasks.flatMap((task) => {
    if (task.id === currentTaskId || task.roleId !== roleId || !["PENDING", "RUNNING", "FAILED"].includes(task.status)) return [];
    const sequence = sequenceFrom(task.resultJson);
    // A malformed unfinished task is not safe to skip: its relative order is
    // unknowable, so fail closed until the durable payload is repaired.
    return sequence === null || sequence < appliedWorldSequence
      ? [{ taskId: task.id, appliedWorldSequence: sequence }]
      : [];
  });
  return blockers.sort((left, right) => {
    if (left.appliedWorldSequence === null) return right.appliedWorldSequence === null ? left.taskId.localeCompare(right.taskId) : -1;
    if (right.appliedWorldSequence === null) return 1;
    return left.appliedWorldSequence - right.appliedWorldSequence || left.taskId.localeCompare(right.taskId);
  })[0] || null;
}

export function impactProjectionStatus(status: string): ProjectedPendingImpact["status"] {
  return status === "RUNNING" ? "SYNCING" : status === "FAILED" ? "RECOVERY_REQUIRED" : "PENDING";
}

export function projectPendingImpactTasks(
  tasks: UnfinishedRoleImpactTask[],
  resolutions: Array<{ playerActionId: string; appliedWorldSequence: number }>
): ProjectedPendingImpact[] {
  const byAction = new Map(resolutions.map((item) => [item.playerActionId, item.appliedWorldSequence]));
  return tasks.map((task) => {
    const payloadSequence = sequenceFrom(task.resultJson);
    const resolutionSequence = task.inputRefId ? byAction.get(task.inputRefId) : undefined;
    return {
      id: task.id,
      status: impactProjectionStatus(task.status),
      appliedWorldSequence: payloadSequence ?? (Number.isSafeInteger(resolutionSequence) ? resolutionSequence! : null)
    };
  }).sort((left, right) => {
    if (left.appliedWorldSequence === null) return right.appliedWorldSequence === null ? left.id.localeCompare(right.id) : -1;
    if (right.appliedWorldSequence === null) return 1;
    return left.appliedWorldSequence - right.appliedWorldSequence || left.id.localeCompare(right.id);
  });
}

export function roleAssetAudienceWhere(runId: string, roleId: string) {
  return { runId, OR: [{ ownerRoleId: roleId }, { visibility: "PUBLIC" }] };
}

export function roleCommitmentAudienceWhere(runId: string, roleId: string) {
  return { runId, OR: [{ issuerRoleId: roleId }, { receiverRoleId: roleId }, { visibility: "PUBLIC" }] };
}

export function openNovelImpactReceiptDedupeKey(playerActionId: string, roleId: string): string {
  return `v2-impact:${playerActionId}:${roleId}`;
}

export function assertOpenNovelImpactReceiptIdentity(
  receipt: OpenNovelImpactReceiptRecord,
  input: OpenNovelImpactReceiptInput
): void {
  const expectedType = input.mode === "TRACE" ? "V2_OBSERVABLE_TRACE" : "V2_CROSS_IMPACT";
  const expectedDedupeKey = openNovelImpactReceiptDedupeKey(input.playerActionId, input.roleId);
  const threadKeys = stringArray(receipt.threadKeysJson);
  const sourceEventIds = stringArray(receipt.sourceEventIdsJson);
  const matches = receipt.runId === input.runId
    && receipt.nodeId === input.nodeId
    && receipt.roleId === input.roleId
    && receipt.entryType === expectedType
    && receipt.visibility === "role_private"
    && receipt.content === input.impactSeed
    && receipt.worldSequence === input.appliedWorldSequence
    && receipt.dedupeKey === expectedDedupeKey
    && threadKeys?.length === 1
    && threadKeys[0] === input.threadId
    && sourceEventIds?.length === 1
    && sourceEventIds[0] === input.playerActionId;
  if (!matches) throw new Error(`OPENOVEL_IMPACT_RECEIPT_IDENTITY_CONFLICT:${expectedDedupeKey}`);
}

export async function publishOpenNovelImpactReceipt(
  tx: { narrativeEntry: { upsert(args: unknown): Promise<OpenNovelImpactReceiptRecord> } },
  input: OpenNovelImpactReceiptInput
): Promise<{ entryId: string; dedupeKey: string }> {
  const dedupeKey = openNovelImpactReceiptDedupeKey(input.playerActionId, input.roleId);
  const receipt = await tx.narrativeEntry.upsert({
    where: { dedupeKey },
    create: {
      runId: input.runId,
      nodeId: input.nodeId,
      roleId: input.roleId,
      entryType: input.mode === "TRACE" ? "V2_OBSERVABLE_TRACE" : "V2_CROSS_IMPACT",
      visibility: "role_private",
      content: input.impactSeed,
      factKeysJson: [],
      threadKeysJson: [input.threadId],
      sourceEventIdsJson: [input.playerActionId],
      worldSequence: input.appliedWorldSequence,
      dedupeKey
    },
    update: {}
  });
  assertOpenNovelImpactReceiptIdentity(receipt, input);
  return { entryId: receipt.id, dedupeKey };
}
