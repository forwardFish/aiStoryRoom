import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { OpenNovelRuntime } from "../src/runtime.js";
import { FileStoryWorkspace } from "../src/workspace.js";
import { sangtianDecisionAdapter } from "../src/sangtian-decisions.js";
import { sangtianWorkspaceSeeder } from "../src/sangtian-workspace.js";
import { FileAtomicTurnRepository } from "../src/atomic-turn.js";
import type {
  EventMirror,
  MirrorEvent,
  OpenNovelProvider,
  ProviderRequest,
} from "../src/types.js";

test("P07 authored G00-T05 commits one server beat and one atomic Head per turn", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-authored-five-turn-"));
  const projectRoot = path.resolve(process.cwd(), "../..");
  const runId = "authored_atomic_t05";
  const workspace = new FileStoryWorkspace(root, projectRoot, "test-upstream", sangtianWorkspaceSeeder);
  const provider = new UnavailableNarrator();
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
    let options = (await workspace.snapshot(runId)).previousOptions;
    const preferredOpening = options.find((option) => option.id === "opening_d1");
    assert.ok(preferredOpening);
    let selected = preferredOpening;

    for (let turn = 1; turn <= 5; turn += 1) {
      const result = await runtime.processAction({
        runId,
        action: selected.label,
        submissionId: `authored_t${String(turn).padStart(2, "0")}_submission`,
        boundOption: { id: selected.id, label: selected.label },
      });
      assert.equal(result.turnNumber, turn);
      assert.ok(result.narration.trim().length > 0);
      assert.ok(result.causalDelta.beatContract?.narrativeSeed);
      assert.ok(result.causalDelta.beatContract?.sceneEvidence?.evidenceItems.length);
      if (turn === 2) {
        assert.match(result.narration, /写成的改桑放行回文随即交由巡抚书吏持有/u);
        assert.match(result.narration, /巡抚书吏将这份文书收入巡抚回文匣/u);
        assert.match(result.narration, /将巡抚回文匣重新合拢/u);
      }
      const repository = new FileAtomicTurnRepository(workspace.paths(runId));
      const head = await repository.loadHead();
      assert.equal(head?.turnNumber, turn);
      assert.equal(head?.turnId, `T${String(turn).padStart(2, "0")}`);
      if (turn === 1) {
        await assert.rejects(() => runtime.processAction({
          runId,
          action: selected.label,
          submissionId: "stale-revision-submission",
          expectedStateRevision: 0,
          boundOption: { id: selected.id, label: selected.label },
        }), /STATE_REVISION_CONFLICT/);
        assert.equal((await workspace.metadata(runId)).status, "READY");
        await assert.rejects(() => runtime.processAction({
          runId,
          action: "A different action must not reuse the committed key.",
          submissionId: "authored_t01_submission",
        }), /IDEMPOTENCY_KEY_REUSED/);
        assert.equal((await workspace.metadata(runId)).status, "READY");
        assert.equal((await repository.loadHead())?.turnNumber, 1);
      }
      options = (await workspace.snapshot(runId)).previousOptions;
      assert.ok(options.length >= 2);
      assert.ok(options.every((option) => option.effect?.decisionPointId));
      selected = options[0];
    }

    const paths = workspace.paths(runId);
    const state = JSON.parse(await readFile(paths.partOneState, "utf8"));
    const canon = await readFile(paths.chapters, "utf8");
    const events = (await readFile(paths.partOneEvents, "utf8"))
      .split(/\r?\n/u)
      .filter(Boolean);
    assert.equal(state.turnNumber, 5);
    assert.equal(events.length, 5);
    assert.equal((canon.match(/\*\*读者选择\*\*/gu) || []).length, 5);
    assert.equal((await readdir(paths.headsDir)).length, 5);
    assert.equal(provider.narratorAttempts, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

class UnavailableNarrator implements OpenNovelProvider {
  narratorAttempts = 0;

  async generate(request: ProviderRequest): Promise<never> {
    if (request.profile === "narrator") this.narratorAttempts += 1;
    throw new Error("TEST_PROVIDER_UNAVAILABLE");
  }

  describe() {
    return { provider: "test", model: "unavailable", configured: true };
  }
}

class NoopMirror implements EventMirror {
  async publish(_event: MirrorEvent) {}
}
