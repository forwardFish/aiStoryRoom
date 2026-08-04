import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { NoopMirror } from "../src/mirror.js";
import { OpenNovelRuntime } from "../src/runtime.js";
import { sangtianDecisionAdapter } from "../src/sangtian-decisions.js";
import type {
  OpenNovelProvider,
  ProviderRequest,
} from "../src/types.js";
import { FileStoryWorkspace } from "../src/workspace.js";
import { sangtianWorkspaceSeeder } from "../src/sangtian-workspace.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.basename(process.cwd()) === "openovel-runtime"
  ? path.resolve(process.cwd(), "..", "..")
  : path.resolve(currentDir, "..", "..", "..");
const upstreamCommit = "1b4404e85d03d1e41e5d745e303372333b29c610";

test("critical Sangtian turn calls Narrator and falls back only when the provider is unavailable", async () => {
  const provider = new UnavailableProvider();
  await withRuntime(provider, async ({ runtime, workspace, runId }) => {
    const opening = await workspace.snapshot(runId);
    const selected = opening.previousOptions.find((option) => option.id === "opening_d2");
    assert.ok(selected);
    const result = await runtime.processAction({
      runId,
      action: selected.label,
      boundOption: { id: selected.id, label: selected.label },
    });
    assert.equal(result.turnNumber, 1);
    assert.ok(result.narration.length > 20);
    assert.deepEqual(provider.profiles, ["narrator"]);
    const head = JSON.parse(await readFile(workspace.paths(runId).head, "utf8"));
    const root = path.join(workspace.paths(runId).root, head.artifactDirectory);
    const assembly = JSON.parse(await readFile(path.join(root, "assembly-manifest.json"), "utf8"));
    const disposition = JSON.parse(await readFile(path.join(root, "disposition.json"), "utf8"));
    const renderPlan = JSON.parse(await readFile(path.join(root, "scene-render-plan.json"), "utf8"));
    assert.equal(assembly.owner, "FALLBACK");
    assert.equal(assembly.invariants.singleOwnerPerSlot, true);
    assert.equal(assembly.invariants.noUnownedServerProse, true);
    assert.equal(renderPlan.mode, "COMPOSED_SCENE");
    assert.equal(renderPlan.owner, "NARRATOR");
    assert.equal(disposition.narrativeOwner, "FALLBACK");
    assert.equal(disposition.disposition.kind, "USE_FALLBACK");
    assert.equal((await runtime.getRun(runId)).status, "READY");
  });
});

test("critical Sangtian turn composes protected facts with a Narrator-owned dramatic scene", async () => {
  const provider = new LiteraryProvider();
  await withRuntime(provider, async ({ runtime, workspace, runId }) => {
    const opening = await workspace.snapshot(runId);
    const selected = opening.previousOptions.find((option) => option.id === "opening_d2");
    assert.ok(selected);
    const result = await runtime.processAction({
      runId,
      action: selected.label,
      boundOption: { id: selected.id, label: selected.label },
    });
    assert.deepEqual(provider.profiles, ["narrator"]);
    assert.match(result.narration, /灯芯在屏风后爆了一声/u);
    assert.match(result.narration, /书吏没有催促，只把袖口从案沿收了回去/u);
    const head = JSON.parse(await readFile(workspace.paths(runId).head, "utf8"));
    const root = path.join(workspace.paths(runId).root, head.artifactDirectory);
    const assembly = JSON.parse(await readFile(path.join(root, "assembly-manifest.json"), "utf8"));
    const disposition = JSON.parse(await readFile(path.join(root, "disposition.json"), "utf8"));
    assert.equal(assembly.owner, "COMPOSED");
    assert.equal(assembly.slotOwners.PLAYER_RESULT, "PROTECTED");
    assert.equal(assembly.slotOwners.WORLD_PRESSURE, "NARRATOR");
    assert.equal(disposition.narrativeOwner, "COMPOSED");
    assert.equal(disposition.disposition.kind, "USE_ORIGINAL");
  });
});

test("Sangtian settlement compiles action and after scene separately", async () => {
  await withRuntime(new UnavailableProvider(), async ({ workspace, runId }) => {
    const opening = await workspace.snapshot(runId);
    const selected = opening.previousOptions.find((option) => option.id === "opening_d2");
    assert.ok(selected);
    const prepared = await sangtianDecisionAdapter.prepare(workspace, {
      runId,
      turnNumber: 1,
      action: selected.label,
      selectedOption: selected,
    });
    assert.ok(prepared);
    assert.deepEqual(
      prepared.beatManifest.transition.beforeScene,
      prepared.beatManifest.transition.narrationScene,
    );
    assert.equal(
      prepared.truthContexts.actionPhase.sceneContinuity?.sceneId,
      prepared.beatManifest.transition.narrationScene.sceneId,
    );
    assert.equal(
      prepared.truthContexts.afterPhase.sceneContinuity?.sceneId,
      prepared.beatManifest.transition.afterScene.sceneId,
    );
  });
});

async function withRuntime(
  provider: UnavailableProvider,
  run: (input: {
    runtime: OpenNovelRuntime;
    workspace: FileStoryWorkspace;
    runId: string;
  }) => Promise<void>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-scene-runtime-"));
  const runId = "scene_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  const workspace = new FileStoryWorkspace(root, projectRoot, upstreamCommit, sangtianWorkspaceSeeder);
  const runtime = new OpenNovelRuntime(
    workspace,
    provider,
    { kick: async () => {} },
    new NoopMirror(),
    {
      decisionMode: "AUTHORED_WHEN_AVAILABLE",
      authoredDecisionAdapter: sangtianDecisionAdapter,
    },
  );
  try {
    await runtime.createRun({
      runId,
      worldId: "sangtian",
      roleId: "zhejiang_governor",
    });
    await run({ runtime, workspace, runId });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

class UnavailableProvider implements OpenNovelProvider {
  readonly profiles: ProviderRequest["profile"][] = [];
  describe() {
    return { provider: "fixture", model: "fixture", configured: true };
  }
  async generate(request: ProviderRequest): Promise<never> {
    this.profiles.push(request.profile);
    throw new Error("fixture unavailable");
  }
}

class LiteraryProvider implements OpenNovelProvider {
  readonly profiles: ProviderRequest["profile"][] = [];
  describe() {
    return { provider: "fixture", model: "literary-fixture", configured: true };
  }
  async generate(request: ProviderRequest) {
    this.profiles.push(request.profile);
    return {
      text: JSON.stringify({
        schemaVersion: "omw.scene-draft.v1",
        draftId: "T01.draft.original",
        owner: "NARRATOR",
        slots: {
          IMMEDIATE_REACTION: "灯芯在屏风后爆了一声。巡抚书吏没有催促，只把袖口从案沿收了回去，像是在等这句话落成一纸可以带走的凭据。",
          WORLD_PRESSURE: "书吏朝已经合上的厅门看了一眼，转向案后的总督：‘封档房的令牌已经出了门。公文可以候，巡抚衙门问起来，下官该回哪一句？’",
          DECISION_STOP: "屋里静下来。书吏站在屏风外，等的是一句能带回巡抚衙门、也能落到纸上的答复。",
        },
      }),
      model: "literary-fixture",
      usage: { inputTokens: 10, outputTokens: 80 },
      latencyMs: 1,
    };
  }
}
