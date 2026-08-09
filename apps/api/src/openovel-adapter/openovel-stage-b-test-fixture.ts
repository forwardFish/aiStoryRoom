import { HttpException } from "@nestjs/common";
import { ReconciledOpenNovelAdapterService } from "./reconciled-openovel-adapter.service";
import { OPENOVEL_ENGINE_VERSION } from "./openovel-runtime.client";
import {
  committedResult,
  deferred,
  type Deferred,
  prices,
  publicRuntime,
  stageBEnding,
  statusMatches,
  user,
} from "./openovel-stage-b-test-data";

export {
  committedResult,
  deferred,
  prices,
  publicRuntime,
  stageBEnding,
  user,
} from "./openovel-stage-b-test-data";

export function createHarness(options: {
  gate?: Deferred<void> | null;
  failBeforeCommit?: boolean;
  failCommitChargeTimes?: number;
  failStreamAfterCommitTimes?: number;
} = {}) {
  const runId = "solo_ovl_0123456789abcdef0123456789abcdef";
  const role = {
    id: "role-governor-stage-b",
    runId,
    roleKey: "zhejiang_governor",
    roleName: "浙江总督",
    personalGoal: "稳住浙江。",
  };
  const run: any = {
    id: runId,
    title: "桑田诏",
    ownerUserId: user.id,
    templateKey: "sangtian",
    engineVersion: OPENOVEL_ENGINE_VERSION,
    selectedRoleKey: role.roleKey,
    billingPolicyVersion: "active_action_v1",
    billingPriceJson: prices,
    status: "playing",
    currentDay: 19,
    completedNodeCount: 19,
    currentNodeId: null,
    version: 1,
    stateJson: { openovel: { turnNumber: 19, status: "READY" } },
    players: [{ userId: user.id, role }],
  };
  const actions = new Map<string, any>();
  const nodes = new Map<string, any>();
  const events = new Map<string, any>();
  const charges = new Map<string, any>();
  const narrativeEntries: any[] = [];
  let chargeSequence = 0;
  let reserveCreates = 0;
  let commitTransitions = 0;
  let releaseTransitions = 0;
  let attachTransitions = 0;
  let failCommitChargeTimes = options.failCommitChargeTimes || 0;

  const prisma: any = {
    storyRun: {
      findUnique: async ({ select }: any = {}) => select ? { stateJson: run.stateJson } : run,
      update: async ({ data }: any) => {
        if (data.status !== undefined) run.status = data.status;
        if (data.currentDay !== undefined) run.currentDay = data.currentDay;
        if (data.completedNodeCount !== undefined) run.completedNodeCount = data.completedNodeCount;
        if (data.currentNodeId !== undefined) run.currentNodeId = data.currentNodeId;
        if (data.stateJson !== undefined) run.stateJson = data.stateJson;
        if (data.version?.increment) run.version += data.version.increment;
        return run;
      },
    },
    storyRole: {
      findUnique: async ({ where }: any) => where.id === role.id ? role : null,
    },
    sceneNode: {
      create: async ({ data }: any) => {
        const duplicate = [...nodes.values()].find((node) => (
          node.id === data.id
          || (node.runId === data.runId
            && node.chapterIndex === data.chapterIndex
            && node.nodeIndex === data.nodeIndex)
        ));
        if (duplicate) throw Object.assign(new Error("Unique constraint failed on SceneNode"), { code: "P2002" });
        const node = { ...data, createdAt: new Date(), resolvedAt: null };
        nodes.set(node.id, node);
        return node;
      },
      update: async ({ where, data }: any) => {
        const node = nodes.get(where.id);
        if (!node) throw new Error("NODE_NOT_FOUND");
        Object.assign(node, data);
        return node;
      },
      updateMany: async ({ where, data }: any) => {
        const node = nodes.get(where.id);
        if (!node || !statusMatches(node.status, where.status)) return { count: 0 };
        Object.assign(node, data);
        return { count: 1 };
      },
      findMany: async () => [...nodes.values()],
    },
    playerAction: {
      create: async ({ data }: any) => {
        const duplicate = [...actions.values()].find((action) => (
          action.id === data.id
          || action.idempotencyKey === data.idempotencyKey
          || (action.nodeId === data.nodeId
            && action.roleId === data.roleId
            && action.actionSlot === data.actionSlot)
        ));
        if (duplicate) throw Object.assign(new Error("Unique constraint failed on PlayerAction"), { code: "P2002" });
        const action = {
          ...data,
          createdAt: new Date("2026-08-09T11:00:00.000Z"),
          resolvedAt: null,
          resolvedJson: null,
        };
        actions.set(action.id, action);
        return action;
      },
      findUnique: async ({ where, select }: any) => {
        const action = where.id
          ? actions.get(where.id)
          : [...actions.values()].find((item) => item.idempotencyKey === where.idempotencyKey);
        if (!action) return null;
        if (!select) return action;
        return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, action[key]]));
      },
      findFirst: async ({ where }: any) => [...actions.values()].find((action) => (
        (!where.runId || action.runId === where.runId)
        && (!where.nodeId || action.nodeId === where.nodeId)
        && (!where.roleId || action.roleId === where.roleId)
        && (!where.actionSlot || action.actionSlot === where.actionSlot)
      )) || null,
      findMany: async ({ where }: any = {}) => [...actions.values()].filter((action) => (
        (!where?.runId || action.runId === where.runId)
        && (!where?.userId || action.userId === where.userId)
        && (!where?.status || action.status === where.status)
        && (!where?.actorKind || action.actorKind === where.actorKind)
      )),
      updateMany: async ({ where, data }: any) => {
        const action = actions.get(where.id);
        if (!action || !statusMatches(action.status, where.status)) return { count: 0 };
        Object.assign(action, data);
        return { count: 1 };
      },
      update: async ({ where, data }: any) => {
        const action = actions.get(where.id);
        if (!action) throw new Error("ACTION_NOT_FOUND");
        Object.assign(action, data);
        return action;
      },
    },
    eventLog: {
      create: async ({ data }: any) => {
        if (events.has(data.id)) throw Object.assign(new Error("Unique event"), { code: "P2002" });
        events.set(data.id, { ...data });
        return data;
      },
    },
    narrativeEntry: {
      findMany: async () => narrativeEntries,
    },
    creditCharge: {
      findUnique: async ({ where }: any) => {
        if (where.playerActionId) {
          return [...charges.values()].find((charge) => charge.playerActionId === where.playerActionId) || null;
        }
        if (where.idempotencyKey) return charges.get(where.idempotencyKey) || null;
        return null;
      },
    },
    $transaction: async (operation: any) => {
      if (Array.isArray(operation)) return Promise.all(operation);
      return operation(prisma);
    },
  };

  const credits: any = {
    reserveCharge: async (input: any) => {
      const existing = charges.get(input.idempotencyKey);
      if (existing) return { kind: "replay", charge: existing, required: existing.amount, availableBefore: 100 };
      reserveCreates += 1;
      const charge = {
        id: `charge-${++chargeSequence}`,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        amount: input.amount,
        status: "RESERVED",
        playerActionId: null,
      };
      charges.set(input.idempotencyKey, charge);
      return { kind: "reserved", charge, required: input.amount, availableBefore: 100 };
    },
    attachPlayerAction: async (chargeId: string, actionId: string) => {
      const charge = [...charges.values()].find((item) => item.id === chargeId);
      if (!charge) throw new Error("CHARGE_NOT_FOUND");
      const attached = [...charges.values()].find((item) => item.playerActionId === actionId && item.id !== chargeId);
      if (attached) throw new Error("CREDIT_CHARGE_ACTION_MISMATCH");
      if (!charge.playerActionId) attachTransitions += 1;
      charge.playerActionId = actionId;
      return charge;
    },
    commitCharge: async (chargeId: string) => {
      if (failCommitChargeTimes > 0) {
        failCommitChargeTimes -= 1;
        throw new Error("injected charge commit failure");
      }
      const charge = [...charges.values()].find((item) => item.id === chargeId);
      if (!charge) throw new Error("CHARGE_NOT_FOUND");
      if (charge.status === "COMMITTED") return charge;
      if (charge.status === "RELEASED") throw new Error("CREDIT_CHARGE_ALREADY_RELEASED");
      charge.status = "COMMITTED";
      commitTransitions += 1;
      return charge;
    },
    releaseCharge: async (chargeId: string, failureCode: string) => {
      const charge = [...charges.values()].find((item) => item.id === chargeId);
      if (!charge) throw new Error("CHARGE_NOT_FOUND");
      if (charge.status === "RELEASED") return charge;
      if (charge.status === "COMMITTED") throw new Error("CREDIT_CHARGE_ALREADY_COMMITTED");
      charge.status = "RELEASED";
      charge.failureCode = failureCode;
      releaseTransitions += 1;
      return charge;
    },
    availableForRun: async () => ({ available: 100, personalAvailable: 100, runAllowanceAvailable: 0 }),
  };

  let runtimeState = publicRuntime(runId);
  const committed = new Map<string, any>();
  let busy = false;
  let streamCalls = 0;
  let replayCalls = 0;
  let modelCalls = 0;
  let settlementCalls = 0;
  let headCount = 0;
  let endingCount = 0;
  let failBeforeCommit = options.failBeforeCommit === true;
  let failStreamAfterCommitTimes = options.failStreamAfterCommitTimes || 0;
  const streamEntered = deferred<void>();

  const commitRuntime = (submissionId: string) => {
    const result = committedResult(runId, submissionId);
    if (!committed.has(submissionId)) {
      committed.set(submissionId, result);
      runtimeState = publicRuntime(runId, 20, "COMPLETED");
      headCount += 1;
      endingCount += 1;
      narrativeEntries.push({
        dedupeKey: `runtime-head:${submissionId}`,
        entryType: "OPENOVEL_CANON",
        content: result.narration,
      });
    }
    return committed.get(submissionId);
  };

  const runtime: any = {
    getRun: async () => runtimeState,
    streamAction: async (input: any, onEvent: any) => {
      streamCalls += 1;
      if (committed.has(input.submissionId)) return committed.get(input.submissionId);
      if (busy) throw new HttpException({ code: "RUN_FOREGROUND_BUSY" }, 409);
      busy = true;
      modelCalls += 1;
      settlementCalls += 1;
      streamEntered.resolve();
      try {
        if (options.gate) await options.gate.promise;
        if (failBeforeCommit) {
          runtimeState = publicRuntime(runId, 19, "FAILED");
          throw new Error("injected precommit provider failure");
        }
        await onEvent({ type: "narration.delta", data: { text: "终局正文" } });
        const result = commitRuntime(input.submissionId);
        if (failStreamAfterCommitTimes > 0) {
          failStreamAfterCommitTimes -= 1;
          throw new HttpException({ code: "OPENOVEL_TURN_NOT_COMMITTED" }, 503);
        }
        return result;
      } finally {
        busy = false;
      }
    },
  };

  const replay: any = {
    replay: async (input: any) => {
      replayCalls += 1;
      if (busy) throw new HttpException({ code: "RUN_FOREGROUND_BUSY" }, 409);
      if (committed.has(input.submissionId)) return committed.get(input.submissionId);
      busy = true;
      modelCalls += 1;
      settlementCalls += 1;
      try {
        if (failBeforeCommit) {
          runtimeState = publicRuntime(runId, 19, "FAILED");
          throw new Error("injected precommit provider failure");
        }
        return commitRuntime(input.submissionId);
      } finally {
        busy = false;
      }
    },
  };

  const service = () => new ReconciledOpenNovelAdapterService(
    prisma,
    {} as any,
    credits,
    runtime,
    replay,
  );

  return {
    runId,
    run,
    role,
    prisma,
    credits,
    runtime,
    replay,
    actions,
    nodes,
    events,
    charges,
    narrativeEntries,
    service,
    streamEntered,
    setFailBeforeCommit(value: boolean) {
      failBeforeCommit = value;
      if (!value && runtimeState.status === "FAILED") runtimeState = publicRuntime(runId, 19, "READY");
    },
    counts() {
      return {
        actions: actions.size,
        nodes: nodes.size,
        events: events.size,
        charges: charges.size,
        reserveCreates,
        commitTransitions,
        releaseTransitions,
        attachTransitions,
        streamCalls,
        replayCalls,
        modelCalls,
        settlementCalls,
        headCount,
        endingCount,
        narrativeEntries: narrativeEntries.length,
      };
    },
    runtimeState: () => runtimeState,
    committed,
  };
}

export function responseCode(error: any) {
  const payload = error?.getResponse?.() || {};
  return String(payload.code || error?.code || error?.message || "");
}

export async function withFastReconcile<T>(operation: () => Promise<T>) {
  const previousDelay = process.env.OPENOVEL_RECONCILE_DELAY_MS;
  const previousAttempts = process.env.OPENOVEL_RECONCILE_ATTEMPTS;
  process.env.OPENOVEL_RECONCILE_DELAY_MS = "1";
  process.env.OPENOVEL_RECONCILE_ATTEMPTS = "200";
  try {
    return await operation();
  } finally {
    if (previousDelay === undefined) delete process.env.OPENOVEL_RECONCILE_DELAY_MS;
    else process.env.OPENOVEL_RECONCILE_DELAY_MS = previousDelay;
    if (previousAttempts === undefined) delete process.env.OPENOVEL_RECONCILE_ATTEMPTS;
    else process.env.OPENOVEL_RECONCILE_ATTEMPTS = previousAttempts;
  }
}

