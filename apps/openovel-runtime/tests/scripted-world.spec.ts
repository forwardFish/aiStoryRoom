import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { caesarSoloWorldModule } from "../src/caesar-solo-world.js";
import { WorldModuleRegistry } from "../src/world-module-registry.js";
import { FileStoryWorkspace } from "../src/workspace.js";
import { OpenNovelRuntime } from "../src/runtime.js";
import { FileAtomicTurnRepository } from "../src/atomic-turn.js";
import type {
  EventMirror,
  MirrorEvent,
  OpenNovelProvider,
  ProviderRequest,
} from "../src/types.js";

test("data-driven Caesar fixture runs G00-T03 through the generic solo pipeline", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-scripted-world-"));
  const projectRoot = path.basename(process.cwd()) === "openovel-runtime"
    ? path.resolve(process.cwd(), "..", "..")
    : path.resolve(import.meta.dirname, "..", "..", "..");
  const registry = new WorldModuleRegistry([caesarSoloWorldModule]);
  const workspace = new FileStoryWorkspace(root, projectRoot, "test-upstream", registry);
  const runtime = new OpenNovelRuntime(
    workspace,
    new UnavailableProvider(),
    { kick: async () => {} },
    new NoopMirror(),
    {
      decisionMode: "AUTHORED_WHEN_AVAILABLE",
      worldModules: registry,
    },
  );
  const runId = "caesar_scripted_t03";
  try {
    const opening = await runtime.createRun({ runId, worldId: "caesar", roleId: "senator" });
    assert.equal(opening.turnNumber, 0);
    assert.equal(opening.options.length, 2);
    assert.match(opening.prologueNarrative, /sealed warning/u);

    const selections = [
      "caesar_open_senate",
      "caesar_name_witnesses",
      "caesar_continue_under_record",
    ];
    for (let index = 0; index < selections.length; index += 1) {
      const current = await workspace.snapshot(runId);
      const selected = current.previousOptions.find((option) => option.id === selections[index]);
      assert.ok(selected);
      const result = await runtime.processAction({
        runId,
        action: selected.label,
        submissionId: `caesar-scripted-${index + 1}`,
        expectedStateRevision: index,
        boundOption: { id: selected.id, label: selected.label },
      });
      assert.equal(result.turnNumber, index + 1);
      assert.ok(result.narration.trim());
      assert.ok(result.causalDelta.beatContract?.narrativeSeed);
      assert.equal(result.storyComplete, index === 2);
      assert.equal(result.options.length, index === 2 ? 0 : 2);
      assert.equal((await new FileAtomicTurnRepository(workspace.paths(runId)).loadHead())?.turnNumber, index + 1);
    }

    const state = JSON.parse(await readFile(workspace.paths(runId).worldState, "utf8"));
    assert.equal(state.revision, 3);
    assert.equal(state.storyComplete, true);
    assert.equal(state.keyFacts.warningDisclosure, "senate_public");
    assert.equal(state.keyFacts.warningWitnesses, "two_opposing_senators");
    assert.equal(state.keyFacts.senateBusiness, "continued_under_record");
    assert.equal((await runtime.getRun(runId)).status, "COMPLETED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scripted world rejects options from another step without mutating state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-scripted-world-reject-"));
  const projectRoot = path.basename(process.cwd()) === "openovel-runtime"
    ? path.resolve(process.cwd(), "..", "..")
    : path.resolve(import.meta.dirname, "..", "..", "..");
  const registry = new WorldModuleRegistry([caesarSoloWorldModule]);
  const workspace = new FileStoryWorkspace(root, projectRoot, "test-upstream", registry);
  try {
    await workspace.createRun({ runId: "caesar_reject", worldId: "caesar", roleId: "senator" });
    const adapter = registry.require("caesar").decisionAdapter!;
    await assert.rejects(() => adapter.prepare(workspace, {
      runId: "caesar_reject",
      turnNumber: 1,
      action: "Move to suspend ordinary business.",
      selectedOption: {
        id: "caesar_suspend_business",
        label: "Move to suspend ordinary business until the warning has been examined.",
      },
    }), /SCRIPTED_WORLD_OPTION_NOT_AVAILABLE/u);
    const state = JSON.parse(await readFile(workspace.paths("caesar_reject").worldState, "utf8"));
    assert.equal(state.revision, 0);
    assert.equal(state.currentStepId, "warning_in_hand");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

class UnavailableProvider implements OpenNovelProvider {
  async generate(_request: ProviderRequest): Promise<never> {
    throw new Error("TEST_PROVIDER_UNAVAILABLE");
  }

  describe() {
    return { provider: "test", model: "unavailable", configured: true };
  }
}

class NoopMirror implements EventMirror {
  async publish(_event: MirrorEvent) {}
}
