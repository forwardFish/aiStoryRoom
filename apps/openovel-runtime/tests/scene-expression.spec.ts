import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSEMBLY_MANIFEST_SCHEMA,
  SCENE_DRAFT_SCHEMA,
  assembleSceneDraft,
  composeProtectedSceneDraft,
  validateBeatManifest,
  validateSceneDraft,
  type BeatManifest,
  type SceneAudit,
  type SceneDraft,
  type SceneSnapshot,
} from "../src/scene-expression.js";

const sangtianBefore: SceneSnapshot = {
  sceneId: "governor-hall",
  timeLabel: "day-one",
  locationLabel: "governor hall",
  presentActorIds: ["governor", "clerk"],
};
const sangtianAfter: SceneSnapshot = {
  sceneId: "signing-room",
  timeLabel: "day-two",
  locationLabel: "signing room",
  presentActorIds: ["governor", "secretary"],
};
const caesarBefore: SceneSnapshot = {
  sceneId: "senate-steps",
  timeLabel: "morning",
  locationLabel: "senate steps",
  presentActorIds: ["consul", "tribune"],
};
const caesarAfter: SceneSnapshot = {
  sceneId: "curia",
  timeLabel: "noon",
  locationLabel: "curia",
  presentActorIds: ["consul", "senator"],
};

for (const fixture of [
  { world: "sangtian", before: sangtianBefore, after: sangtianAfter },
  { world: "caesar", before: caesarBefore, after: caesarAfter },
]) {
  test(fixture.world + ": single-owner complete scene", () => {
    const manifest = transitionManifest(fixture.world, fixture.before, fixture.after);
    const draft = completeDraft(fixture.world);
    const assembled = assembleSceneDraft({
      manifest,
      draft,
      audit: passingAudit(manifest, draft),
    });
    assert.equal(assembled.manifest.schemaVersion, ASSEMBLY_MANIFEST_SCHEMA);
    assert.equal(assembled.manifest.owner, "NARRATOR");
    assert.equal(assembled.manifest.invariants.noUnownedServerProse, true);
    assert.deepEqual(assembled.manifest.slotOrder, [
      "PLAYER_RESULT",
      "IMMEDIATE_REACTION",
      "SCENE_TRANSITION",
      "WORLD_PRESSURE",
      "DECISION_STOP",
    ]);
    assert.equal(assembled.text, Object.values(draft.slots).join("\n\n"));
  });
}

test("protected causal slots are inserted verbatim and cannot be claimed by Narrator", () => {
  const manifest = transitionManifest("protected", sangtianBefore, sangtianAfter);
  const resultTicket = manifest.tickets.find((ticket) => ticket.slot === "PLAYER_RESULT")!;
  const transitionTicket = manifest.tickets.find((ticket) => ticket.slot === "SCENE_TRANSITION")!;
  Object.assign(resultTicket, {
    expressionOwner: "PROTECTED",
    protectedText: "The signed order was handed to the clerk.",
  });
  Object.assign(transitionTicket, {
    expressionOwner: "PROTECTED",
    protectedText: "The next morning, the hearing opened in the archive room.",
  });
  validateBeatManifest(manifest);

  const narratorDraft = completeDraft("protected");
  delete narratorDraft.slots.PLAYER_RESULT;
  delete narratorDraft.slots.SCENE_TRANSITION;
  validateSceneDraft(narratorDraft, manifest);
  const composed = composeProtectedSceneDraft(narratorDraft, manifest);

  assert.equal(composed.owner, "COMPOSED");
  assert.equal(composed.slots.PLAYER_RESULT, resultTicket.protectedText);
  assert.equal(composed.slots.SCENE_TRANSITION, transitionTicket.protectedText);
  const assembled = assembleSceneDraft({
    manifest,
    draft: composed,
    audit: passingAudit(manifest, composed),
  });
  assert.equal(assembled.manifest.slotOwners.PLAYER_RESULT, "PROTECTED");
  assert.equal(assembled.manifest.slotOwners.SCENE_TRANSITION, "PROTECTED");
  assert.equal(assembled.manifest.slotOwners.WORLD_PRESSURE, "NARRATOR");

  const illegalDraft = completeDraft("protected");
  assert.throws(
    () => validateSceneDraft(illegalDraft, manifest),
    /SCENE_DRAFT_PROTECTED_SLOT_CLAIMED:PLAYER_RESULT/,
  );
});
test("action stays in narrationScene", () => {
  const manifest = transitionManifest("world", sangtianBefore, sangtianAfter);
  manifest.transition.narrationScene = sangtianAfter;
  assert.throws(
    () => validateBeatManifest(manifest),
    /SCENE_TRANSITION_ACTION_SCENE_DRIFT/,
  );
});

test("changed scenes require a transition ticket", () => {
  const manifest = transitionManifest("world", sangtianBefore, sangtianAfter);
  manifest.tickets = manifest.tickets.filter((ticket) => ticket.slot !== "SCENE_TRANSITION");
  assert.throws(
    () => validateBeatManifest(manifest),
    /BEAT_MANIFEST_TRANSITION_TICKET_MISSING/,
  );
});

test("unchanged scenes reject transition prose", () => {
  const manifest = transitionManifest("world", sangtianBefore, sangtianBefore);
  manifest.tickets = manifest.tickets.filter((ticket) => ticket.slot !== "SCENE_TRANSITION");
  const draft = completeDraft("world");
  assert.throws(
    () => assembleSceneDraft({ manifest, draft, audit: passingAudit(manifest, draft) }),
    /SCENE_DRAFT_UNAUTHORIZED_TRANSITION/,
  );
});

test("coverage in a wrong slot is rejected", () => {
  const manifest = transitionManifest("world", sangtianBefore, sangtianAfter);
  const draft = completeDraft("world");
  const audit = passingAudit(manifest, draft);
  const stop = manifest.tickets.find((ticket) => ticket.slot === "DECISION_STOP")!;
  audit.slots.find((slot) => slot.slot === "DECISION_STOP")!.coveredTicketIds = [];
  audit.slots.find((slot) => slot.slot === "WORLD_PRESSURE")!.coveredTicketIds.push(stop.ticketId);
  assert.throws(
    () => assembleSceneDraft({ manifest, draft, audit }),
    /SCENE_AUDIT_TICKET_UNCOVERED|SCENE_AUDIT_TICKET_WRONG_SLOT/,
  );
});

test("P0 selects fallback instead of repair", () => {
  const manifest = transitionManifest("world", sangtianBefore, sangtianAfter);
  const draft = completeDraft("world");
  const audit = passingAudit(manifest, draft);
  audit.valid = false;
  audit.reason = "UNAUTHORIZED_PLAYER_ACTION";
  assert.throws(
    () => assembleSceneDraft({ manifest, draft, audit }),
    /SCENE_AUDIT_REJECTED:UNAUTHORIZED_PLAYER_ACTION/,
  );
});

function transitionManifest(
  world: string,
  before: SceneSnapshot,
  after: SceneSnapshot,
): BeatManifest {
  const beforeActors = new Set(before.presentActorIds);
  const afterActors = new Set(after.presentActorIds);
  const transitionRequired = JSON.stringify(before) !== JSON.stringify(after);
  return {
    beatId: world + ".beat.1",
    sourceRef: world + ".source.1",
    transition: {
      beforeScene: before,
      narrationScene: before,
      afterScene: after,
      transitionRequired,
      arrivingActorIds: after.presentActorIds.filter((id) => !beforeActors.has(id)),
      departingActorIds: before.presentActorIds.filter((id) => !afterActors.has(id)),
    },
    tickets: [
      ticket(world, "result", "PLAYER_RESULT", "ACTION_PHASE", true),
      ticket(world, "reaction", "IMMEDIATE_REACTION", "ACTION_PHASE", false),
      ...(transitionRequired
        ? [ticket(world, "transition", "SCENE_TRANSITION", "AFTER_PHASE", true)]
        : []),
      ticket(world, "pressure", "WORLD_PRESSURE", "AFTER_PHASE", true),
      ticket(world, "stop", "DECISION_STOP", "AFTER_PHASE", true),
    ],
  };
}

function ticket(
  world: string,
  suffix: string,
  slot: BeatManifest["tickets"][number]["slot"],
  scenePhase: BeatManifest["tickets"][number]["scenePhase"],
  required: boolean,
) {
  return {
    ticketId: world + ".ticket." + suffix,
    slot,
    scenePhase,
    required,
    sourceRefs: [world + ".event.1"],
    requiredMeaning: world + " " + suffix + " meaning",
  };
}

function completeDraft(world: string): SceneDraft {
  return {
    schemaVersion: SCENE_DRAFT_SCHEMA,
    draftId: world + ".draft.1",
    owner: "NARRATOR",
    slots: {
      PLAYER_RESULT: world + " player result prose.",
      IMMEDIATE_REACTION: world + " immediate reaction prose.",
      SCENE_TRANSITION: world + " scene transition prose.",
      WORLD_PRESSURE: world + " world pressure prose.",
      DECISION_STOP: world + " decision stop prose.",
    },
  };
}

function passingAudit(manifest: BeatManifest, draft: SceneDraft): SceneAudit {
  return {
    draftId: draft.draftId,
    valid: true,
    slots: Object.keys(draft.slots).map((slot) => ({
      slot: slot as SceneAudit["slots"][number]["slot"],
      coveredTicketIds: manifest.tickets
        .filter((ticket) => ticket.slot === slot)
        .map((ticket) => ticket.ticketId),
      p0ConflictCodes: [],
      scenePhaseValid: true,
    })),
  };
}
