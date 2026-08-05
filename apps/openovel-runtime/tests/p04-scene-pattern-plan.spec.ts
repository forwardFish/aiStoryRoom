import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCausalDelta } from "../src/causal-context.js";
import { buildNarratorMessages, compileForegroundContext } from "../src/foreground.js";
import { sangtianDecisionAdapter } from "../src/sangtian-decisions.js";
import { sangtianWorkspaceSeeder } from "../src/sangtian-workspace.js";
import { FileStoryWorkspace } from "../src/workspace.js";

test("approved scene grammar reaches Narrator only through transient DramaticBeatPlan steps", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-scene-pattern-plan-"));
  const projectRoot = path.basename(process.cwd()) === "openovel-runtime"
    ? path.resolve(process.cwd(), "..", "..")
    : path.resolve(import.meta.dirname, "..", "..", "..");
  const workspace = new FileStoryWorkspace(
    root,
    projectRoot,
    "scene-pattern-plan-test",
    sangtianWorkspaceSeeder,
  );
  const runId = "scene_pattern_plan";

  try {
    await workspace.createRun({
      runId,
      worldId: "sangtian",
      roleId: "zhejiang_governor",
    });
    const snapshot = await workspace.snapshot(runId);
    const selected = snapshot.previousOptions.find((option) => option.id === "opening_d1");
    assert.ok(selected);

    const prepared = await sangtianDecisionAdapter.prepare(workspace, {
      runId,
      turnNumber: 1,
      action: selected.label,
      selectedOption: selected,
    });
    assert.ok(prepared);
    const pattern = prepared.beatManifest.dramaticGuidance?.scenePatterns[0];
    const plan = prepared.beatManifest.dramaticBeatPlan;
    assert.ok(pattern);
    assert.ok(plan);
    assert.ok(plan.steps.some((step) => step.kind === "PATTERN_OPENING"));
    assert.ok(plan.steps.some((step) => step.kind === "PATTERN_MOVE"));
    assert.ok(plan.steps.every((step) => step.durableMutationAllowed === false));
    assert.equal(plan.steps.at(-1)?.kind, "DECISION_PRESSURE");

    const delta = buildCausalDelta({
      turnId: "T01",
      action: selected.label,
      selectedOption: prepared.selectedOption,
    });
    const compiled = await compileForegroundContext(workspace.paths(runId), snapshot);
    const prompt = buildNarratorMessages(delta, compiled, prepared.beatManifest)
      .map((message) => message.content)
      .join("\n");

    assert.match(prompt, /"kind": "PATTERN_OPENING"/u);
    assert.match(prompt, /"kind": "PATTERN_MOVE"/u);
    assert.match(prompt, /"expressionPolicy": "ADAPT_PATTERN_TO_CURRENT_SCENE"/u);
    assert.match(prompt, /不得照搬来源场景/u);
    assert.doesNotMatch(prompt, new RegExp(escapeRegExp(pattern.orderedBeats[0]!.observableMove), "u"));
    assert.doesNotMatch(prompt, new RegExp(escapeRegExp(pattern.patternId), "u"));
    assert.doesNotMatch(prompt, new RegExp(escapeRegExp(prepared.sourceRef), "u"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
