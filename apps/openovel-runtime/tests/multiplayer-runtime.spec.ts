import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import templates from "@ai-story/templates";
import { MultiplayerWorldRuntime } from "../src/multiplayer-runtime.js";
import { WorldModuleRegistry } from "../src/world-module-registry.js";

const {
  caesarRuntimeFixture,
  caesarSettlementFixture,
  sangtianRuntimeFixture,
  sangtianSettlementFixture,
} = templates;

const noSeed = {
  supports: () => true,
  seed: async () => ({ openingOptions: [] }),
};

function registry() {
  return new WorldModuleRegistry([
    {
      worldId: "sangtian",
      seeder: noSeed,
      runtimeContract: sangtianRuntimeFixture,
      settlementPackage: sangtianSettlementFixture,
    },
    {
      worldId: "caesar",
      seeder: noSeed,
      runtimeContract: caesarRuntimeFixture,
      settlementPackage: caesarSettlementFixture,
    },
  ]);
}

test("shared runtime serially commits an action and exposes distinct actor projections", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openovel-shared-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = new MultiplayerWorldRuntime(root, registry());
  const actors = sangtianRuntimeFixture.roles.map((role) => role.actorId);
  const run = await runtime.createRun({ runId: "shared.run.one", worldId: "sangtian", actorIds: actors });
  assert.equal(run.stateRevision, 0);

  const accepted = await runtime.submitAction({
    runId: run.runId,
    actorId: actors[0],
    rawText: "Use the authorized capability.",
    expectedStateRevision: 0,
    idempotencyKey: "shared-action-key-0001",
    intentType: "USE_CAPABILITY",
    referencedEntityIds: [sangtianRuntimeFixture.entities[2].id],
    proposedCapabilityId: sangtianRuntimeFixture.capabilities[0].id,
  });
  assert.equal(accepted.kind, "ACCEPTED");
  assert.equal(accepted.stateRevision, 1);
  assert.equal(accepted.projection.personalEchoes.length, 1);

  const otherProjection = await runtime.projection(run.runId, actors[1]);
  assert.equal(otherProjection?.personalEchoes.length, 0);
  assert.equal(otherProjection?.crossPlayerEchoes.length, 1);
  assert.equal(otherProjection?.worldEchoes.length, 1);
  assert.doesNotMatch(JSON.stringify(otherProjection), /sangtian\.secret\.plan/u);
  assert.ok((await runtime.feed(run.runId, actors[1])).some((entry) => entry.kind === "CROSS_PLAYER"));
  assert.equal((await runtime.impact(run.runId, actors[1])).crossPlayer.length, 1);

  const persisted = JSON.parse(await readFile(
    path.join(root, "shared-runs", run.runId, "head.json"),
    "utf8",
  )) as { snapshot: { state: { revision: number } } };
  assert.equal(persisted.snapshot.state.revision, 1);
});

test("shared runtime replays exactly and serializes concurrent actors without a global turn barrier", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openovel-shared-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = new MultiplayerWorldRuntime(root, registry());
  const actors = caesarRuntimeFixture.roles.map((role) => role.actorId);
  await runtime.createRun({ runId: "shared.run.caesar", worldId: "caesar", actorIds: actors });
  const firstInput = {
    runId: "shared.run.caesar",
    actorId: actors[0],
    rawText: "Deliberate on the warning.",
    expectedStateRevision: 0,
    idempotencyKey: "shared-action-key-0002",
    intentType: "USE_CAPABILITY" as const,
    referencedEntityIds: [caesarRuntimeFixture.entities[2].id],
    proposedCapabilityId: caesarRuntimeFixture.capabilities[0].id,
  };
  const accepted = await runtime.submitAction(firstInput);
  const replayed = await runtime.submitAction(firstInput);
  assert.equal(accepted.kind, "ACCEPTED");
  assert.equal(replayed.kind, "REPLAYED");
  assert.equal(replayed.actionId, accepted.actionId);
  assert.equal((await runtime.getRun(firstInput.runId)).stateRevision, 1);

  await assert.rejects(
    runtime.submitAction({ ...firstInput, rawText: "Different request." }),
    /IDEMPOTENCY_KEY_REUSED/u,
  );
  const stale = await Promise.allSettled([
    runtime.submitAction({
      ...firstInput,
      actorId: actors[1],
      rawText: "Warn using the envoy capability.",
      idempotencyKey: "shared-action-key-0003",
      expectedStateRevision: 1,
      proposedCapabilityId: caesarRuntimeFixture.capabilities[1].id,
    }),
    runtime.submitAction({
      ...firstInput,
      rawText: "Submit a concurrent second deliberation.",
      idempotencyKey: "shared-action-key-0004",
      expectedStateRevision: 1,
    }),
  ]);
  assert.equal(stale.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(stale.filter((item) => item.status === "rejected").length, 1);
  assert.equal((await runtime.getRun(firstInput.runId)).stateRevision, 2);
});

test("shared runtime provides clue and destiny projections through the same API in two worlds", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openovel-shared-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = new MultiplayerWorldRuntime(root, registry());
  const actor = caesarRuntimeFixture.roles[0].actorId;
  const other = caesarRuntimeFixture.roles[1].actorId;
  await runtime.createRun({ runId: "shared.run.net", worldId: "caesar", actorIds: [actor, other] });
  await runtime.submitAction({
    runId: "shared.run.net",
    actorId: actor,
    rawText: "Deliberate.",
    expectedStateRevision: 0,
    idempotencyKey: "shared-action-key-0005",
    intentType: "USE_CAPABILITY",
    referencedEntityIds: [caesarRuntimeFixture.entities[2].id],
    proposedCapabilityId: caesarRuntimeFixture.capabilities[0].id,
  });
  const clues = await runtime.clues("shared.run.net", actor);
  const net = await runtime.destinyNet("shared.run.net", actor);
  assert.ok(clues.public.length + clues.private.length > 0);
  assert.ok(net?.nodes.some((node) => node.type === "SELF"));
  assert.doesNotMatch(JSON.stringify({ clues, net }), /caesar\.secret\.route/u);
});

test("two runtime instances share one file lease and cannot overwrite the same revision", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openovel-shared-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const firstRuntime = new MultiplayerWorldRuntime(root, registry());
  const secondRuntime = new MultiplayerWorldRuntime(root, registry());
  const actors = sangtianRuntimeFixture.roles.map((role) => role.actorId);
  await firstRuntime.createRun({ runId: "shared.run.processes", worldId: "sangtian", actorIds: actors });
  const base = {
    runId: "shared.run.processes",
    actorId: actors[0],
    expectedStateRevision: 0,
    intentType: "USE_CAPABILITY" as const,
    referencedEntityIds: [sangtianRuntimeFixture.entities[2].id],
    proposedCapabilityId: sangtianRuntimeFixture.capabilities[0].id,
  };
  const results = await Promise.allSettled([
    firstRuntime.submitAction({ ...base, rawText: "First process action.", idempotencyKey: "process-action-key-0001" }),
    secondRuntime.submitAction({ ...base, rawText: "Second process action.", idempotencyKey: "process-action-key-0002" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.match(String((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason), /STATE_REVISION_CONFLICT/u);
  assert.equal((await firstRuntime.getRun(base.runId)).stateRevision, 1);
});
