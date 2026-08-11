import assert from "node:assert/strict";
import test from "node:test";
import {
  beginPrepareResolutionPhase,
  buildDefaultPressureAction,
  confirmCompiledPressureAction,
  initializePressureRuntime,
  loadPressureRuntimeContent,
  lockPreparePhase,
  pressureRuntimeReplayHash,
  projectP0ToN1,
  resolvePreparePhase,
  type PressureRuntimeState,
} from "@ai-story/templates";
import path from "node:path";
import { PressureNarrativeRuntimeService } from "./pressure-narrative-runtime.service";

function resolvedPrepareState(): { content: ReturnType<typeof loadPressureRuntimeContent>; state: PressureRuntimeState } {
  const registry = path.resolve(process.cwd(), "packages/templates/config/sangtian/strategy-registry.json");
  const content = loadPressureRuntimeContent(registry, "sangtian_pressure_v1_0");
  let state = initializePressureRuntime(content, { runId: "run-narrative-live", runSeed: "neutral-seed", nowEpochMs: 1_000 });
  state = projectP0ToN1(content, state, 2_000, 20_000).state;
  for (const seatId of content.seatIds) {
    const command = buildDefaultPressureAction(content, state, seatId, "PREPARE", 3_000);
    state = confirmCompiledPressureAction(content, state, command).state;
  }
  state = lockPreparePhase(content, state, 4_000);
  state = beginPrepareResolutionPhase(state);
  state = resolvePreparePhase(content, state, 5_000, 30_000).state;
  assert.equal(state.phase, "COMMIT_OPEN");
  return { content, state };
}

function prismaHarness() {
  const roles = [
    { id: "role-governor", roleKey: "zhejiang_governor" },
    { id: "role-province", roleKey: "zhejiang_administration" },
    { id: "role-law", roleKey: "qingliu_law" },
    { id: "role-merchant", roleKey: "jiangnan_merchant" },
    { id: "role-weaving", roleKey: "sili_weaving" },
    { id: "role-cabinet", roleKey: "cabinet_finance" },
  ];
  const entries = new Map<string, any>();
  const contexts: any[] = [];
  const tasks: any[] = [];
  const executions: any[] = [];
  let seq = 0;
  const tx: any = {
    narrativeEntry: {
      create: async ({ data }: any) => {
        if (entries.has(data.dedupeKey)) throw Object.assign(new Error("unique"), { code: "P2002" });
        const row = { id: `entry-${++seq}`, createdAt: new Date(), ...data };
        entries.set(data.dedupeKey, row);
        return row;
      },
    },
    promptExecutionRecord: {
      create: async ({ data }: any) => { executions.push(data); return data; },
    },
    aiTask: {
      update: async ({ where, data }: any) => {
        const task = tasks.find((item) => item.id === where.id);
        Object.assign(task, data);
        return task;
      },
    },
    sceneNode: {
      findFirst: async () => ({ id: "node-n1" }),
    },
  };
  const prisma: any = {
    storyRun: {
      findUnique: async () => ({
        id: "run-narrative-live",
        roles,
        players: [{ roleId: "role-governor", userId: "user-1", status: "active" }],
      }),
    },
    narrativeEntry: {
      findUnique: async ({ where }: any) => entries.get(where.dedupeKey) || null,
      findUniqueOrThrow: async ({ where }: any) => {
        const row = entries.get(where.dedupeKey);
        if (!row) throw new Error("missing narrative entry");
        return row;
      },
    },
    storyContextSnapshotV2: {
      create: async ({ data }: any) => {
        const row = { id: `context-${contexts.length + 1}`, ...data };
        contexts.push(row);
        return row;
      },
    },
    aiTask: {
      create: async ({ data }: any) => {
        const row = { id: `task-${tasks.length + 1}`, ...data };
        tasks.push(row);
        return row;
      },
    },
    $transaction: async (operation: any) => operation(tx),
  };
  return { prisma, entries, contexts, tasks, executions };
}

function validNarrator() {
  return {
    generate: async ({ userPrompt }: any) => {
      const request = JSON.parse(userPrompt);
      return {
        content: JSON.stringify({
          sceneText: "你的准备行动已经落实。现场人物作出可见回应，时辰与压力继续前进，新的紧迫局势已经来到眼前。",
          usedFactIds: request.publicFactIds.slice(0, 1),
          usedObjectVersionIds: request.visibleObjectVersions.slice(0, 1),
          usedActionIds: request.sceneBrief.sourceActionIds,
          usedSettledEventIds: request.settledEventIds.slice(0, 1),
          usedContentSourceRefs: request.allowedContentSourceRefs.slice(0, 1),
          coveredBeatIds: request.sceneBrief.requiredBeats.map((beat: any) => beat.beatId),
          endingState: { nodeId: request.nodeId },
        }),
        provider: "deepseek",
        modelName: "deepseek-test",
        tokenUsage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      };
    },
  };
}

test("live pressure Narrator persists a guarded four-beat scene without changing authoritative state", async () => {
  const { content, state } = resolvedPrepareState();
  const beforeHash = pressureRuntimeReplayHash(state);
  const harness = prismaHarness();
  const service = new PressureNarrativeRuntimeService(harness.prisma, validNarrator() as never);

  const result = await service.publish({ runId: state.runId, state, content, generationKind: "AFTER_PREPARE" });
  assert.equal(result.length, 1);
  assert.equal(result[0].source, "MODEL");
  assert.equal(pressureRuntimeReplayHash(state), beforeHash, "Narrator must not mutate the settled pressure state");
  const entry = [...harness.entries.values()][0];
  assert.equal(entry.entryType, "pressure_scene");
  assert.equal(entry.visibility, "role_private");
  assert.equal(entry.threadKeysJson.coveredBeatIds.length, 4);
  assert.equal(entry.threadKeysJson.source, "MODEL");
  assert.equal(harness.contexts.length, 1);
  assert.equal(harness.tasks[0].status, "completed");
  assert.equal(harness.executions[0].status, "SUCCESS");
});

test("invalid live Narrator references fall back to the authored scene through the same guard", async () => {
  const { content, state } = resolvedPrepareState();
  const harness = prismaHarness();
  const invalidNarrator = {
    generate: async ({ userPrompt }: any) => {
      const request = JSON.parse(userPrompt);
      return {
        content: JSON.stringify({
          sceneText: "An invalid model scene.",
          usedFactIds: ["fact:not-allowed"],
          usedObjectVersionIds: [],
          usedActionIds: request.sceneBrief.sourceActionIds,
          usedSettledEventIds: [],
          usedContentSourceRefs: [],
          coveredBeatIds: request.sceneBrief.requiredBeats.slice(0, 3).map((beat: any) => beat.beatId),
          endingState: {},
        }),
        provider: "deepseek",
        modelName: "deepseek-test",
      };
    },
  };
  const service = new PressureNarrativeRuntimeService(harness.prisma, invalidNarrator as never);
  const [result] = await service.publish({ runId: state.runId, state, content, generationKind: "AFTER_PREPARE" });
  assert.equal(result.source, "AUTHORED_FALLBACK");
  const entry = [...harness.entries.values()][0];
  assert.equal(entry.threadKeysJson.source, "AUTHORED_FALLBACK");
  assert.equal(entry.threadKeysJson.coveredBeatIds.length, 4);
  assert.equal(harness.tasks[0].errorMessage.includes("NARRATIVE_"), true);
  assert.equal(harness.executions[0].status, "FAILED");
});
