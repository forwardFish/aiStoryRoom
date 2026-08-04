import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCausalDelta } from "../src/causal-context.js";
import {
  buildNarratorMessages,
  compileForegroundContext,
} from "../src/foreground.js";
import type { BeatManifest } from "../src/scene-expression.js";
import type { CompiledForegroundContext } from "../src/types.js";
import { FileStoryWorkspace } from "../src/workspace.js";
import { sangtianWorkspaceSeeder } from "../src/sangtian-workspace.js";
import { sangtianDecisionAdapter } from "../src/sangtian-decisions.js";

for (const world of ["sangtian", "caesar"]) {
  test(world + ": Narrator receives one complete-scene contract", () => {
    const action = world + " player action";
    const manifest = fixtureManifest(world);
    const after = manifest.transition.afterScene;
    const delta = buildCausalDelta({
      turnId: "T01",
      action,
      selectedOption: {
        id: world + ".option",
        label: action,
        effect: {
          beatContract: {
            objective: "continue after the protected transition",
            moves: [],
            requiredAnchorGroups: [],
            stopCondition: "leave the next choice unresolved",
            sceneProjection: {
              sceneRef: after.sceneId,
              timeLabel: after.timeLabel,
              locationLabel: after.locationLabel,
              situation: "Only the player and officer remain in the new room.",
              presentActors: [
                { actorRef: world + ".player", displayName: "player" },
                { actorRef: world + ".officer", displayName: "officer" },
              ],
              observableFacts: ["The seal remains unbroken."],
              keyEntityInventoryIsExhaustive: true,
              documents: [
                { label: "the treaty", accessState: "NOT_PRESENT" },
              ],
              objects: [],
            },
          },
        },
      },
    });
    const context = fixtureContext();
    const messages = buildNarratorMessages(delta, context, manifest);
    const all = messages.map((message) => message.content).join("\n");
    const user = messages[1]!.content;

    assert.equal(messages.length, 2);
    assert.match(messages[0]!.content, /Narrator-owned slots/u);
    assert.match(messages[0]!.content, /server inserts author-reviewed PROTECTED slots verbatim/u);
    assert.match(messages[0]!.content, /omw\.scene-draft\.v1/u);
    assert.match(user, /old room/u);
    assert.match(user, /new room/u);
    assert.doesNotMatch(user, /player result meaning/u);
    assert.match(user, /"protectedSlots"[\s\S]*"PLAYER_RESULT"/u);
    assert.match(user, /decision stop meaning/u);
    assert.doesNotMatch(user, /The clerk waited./u);
    assert.match(user, /scene transition meaning/u);
    const foreground = user.split("## ????", 1)[0] || "";
    assert.doesNotMatch(foreground, /The player remains in the old room./u);
    assert.match(foreground, /Only the player and officer remain in the new room./u);
    assert.match(foreground, /- player/u);
    assert.match(foreground, /- officer/u);
    assert.match(foreground, /The seal remains unbroken/u);
    assert.match(foreground, /the treaty/u);
    assert.match(foreground, /\u4e0d\u5728\u5f53\u524d\u573a\u666f/u);
    assert.match(foreground, /\u672a\u5217\u51fa\u7684\u5173\u952e\u5b9e\u4f53\u4e0d\u5728\u573a/u);
    assert.equal(user.trim().endsWith(action), true);
    assert.doesNotMatch(all, new RegExp(world + "\\.(?:ticket|event)\\.", "u"));
    assert.doesNotMatch(all, /sourceRef|stateRevision|validator|synonym/u);
  });
}

test("real Sangtian opening keeps action scene separate from after scene", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omw-scene-context-"));
  const projectRoot = path.basename(process.cwd()) === "openovel-runtime"
    ? path.resolve(process.cwd(), "..", "..")
    : path.resolve(import.meta.dirname, "..", "..", "..");
  const workspace = new FileStoryWorkspace(
    root,
    projectRoot,
    "scene-context-test",
    sangtianWorkspaceSeeder,
  );
  const runId = "scene_context";
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
    assert.ok(prepared?.selectedOption);
    assert.ok(prepared.beatManifest.dramaticGuidance);
    assert.ok(prepared.beatManifest.dramaticGuidance.sourceMechanisms.length > 0);
    assert.ok(prepared.beatManifest.dramaticGuidance.scenePatterns.length > 0);
    const delta = buildCausalDelta({
      turnId: "T01",
      action: selected.label,
      selectedOption: prepared.selectedOption,
    });
    const compiled = await compileForegroundContext(workspace.paths(runId), snapshot);
    const prompt = buildNarratorMessages(delta, compiled, prepared.beatManifest)
      .map((message) => message.content)
      .join("\n");
    assert.doesNotMatch(prompt, new RegExp(escapeRegExp(prepared.settledNarrative), "u"));
    assert.match(prompt, /"protectedSlots"\s*:\s*\[\s*"PLAYER_RESULT"/u);
    assert.match(prompt, /"dramaticGuidance"/u);
    assert.match(prompt, new RegExp(escapeRegExp(
      prepared.beatManifest.dramaticGuidance.scenePatterns[0]!.forbiddenFlattening[0]!,
    ), "u"));
    assert.doesNotMatch(prompt, new RegExp(escapeRegExp(
      prepared.beatManifest.dramaticGuidance.scenePatterns[0]!.orderedBeats[0]!.observableMove,
    ), "u"));
    assert.match(prompt, new RegExp(escapeRegExp(
      prepared.beatManifest.transition.narrationScene.locationLabel,
    ), "u"));
    assert.match(prompt, new RegExp(escapeRegExp(
      prepared.beatManifest.transition.afterScene.locationLabel,
    ), "u"));
    assert.doesNotMatch(prompt, new RegExp(escapeRegExp(prepared.sourceRef), "u"));
    assert.equal(prompt.trim().endsWith(selected.label), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function fixtureManifest(world: string): BeatManifest {
  const before = {
    sceneId: world + ".old",
    timeLabel: "day one",
    locationLabel: "old room",
    presentActorIds: [world + ".player", world + ".clerk"],
  };
  const after = {
    sceneId: world + ".new",
    timeLabel: "day two",
    locationLabel: "new room",
    presentActorIds: [world + ".player", world + ".officer"],
  };
  return {
    beatId: world + ".beat",
    sourceRef: world + ".event",
    transition: {
      beforeScene: before,
      narrationScene: before,
      afterScene: after,
      transitionRequired: true,
      arrivingActorIds: [world + ".officer"],
      departingActorIds: [world + ".clerk"],
    },
    tickets: [
      ticket(world, "result", "PLAYER_RESULT", "ACTION_PHASE", "player result meaning"),
      ticket(world, "transition", "SCENE_TRANSITION", "AFTER_PHASE", "scene transition meaning"),
      ticket(world, "pressure", "WORLD_PRESSURE", "AFTER_PHASE", "world pressure meaning"),
      ticket(world, "stop", "DECISION_STOP", "AFTER_PHASE", "decision stop meaning"),
    ],
  };
}

function ticket(
  world: string,
  suffix: string,
  slot: BeatManifest["tickets"][number]["slot"],
  scenePhase: BeatManifest["tickets"][number]["scenePhase"],
  requiredMeaning: string,
) {
  const protectedSlot = slot === "PLAYER_RESULT" || slot === "SCENE_TRANSITION";
  return {
    ticketId: world + ".ticket." + suffix,
    slot,
    scenePhase,
    required: true,
    sourceRefs: [world + ".event"],
    requiredMeaning,
    expressionOwner: protectedSlot ? "PROTECTED" as const : "NARRATOR" as const,
    ...(protectedSlot ? { protectedText: requiredMeaning } : {}),
  };
}

function fixtureContext(): CompiledForegroundContext {
  return {
    foregroundGuidance: [
      "## Story",
      "A world under pressure.",
      "## Scene",
      "The player remains in the old room.",
      "## Tone",
      "Restrained historical fiction.",
    ].join("\n"),
    durableMemory: "A durable fact.",
    storyMemory: "A relevant memory.",
    recentCanonExcerpt: "The clerk waited.",
    report: {
      usedChars: 0,
      budgets: {},
      truncated: [],
      removedPlayerDirectiveClauses: 0,
      deduplicatedContextCardSections: 0,
    },
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
