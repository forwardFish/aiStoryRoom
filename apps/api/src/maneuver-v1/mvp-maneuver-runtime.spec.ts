import assert from "node:assert/strict";
import test from "node:test";
import { MvpStoryEngine } from "../mvp-causal-runtime";
import { MemoryMvpStoryStorage } from "../mvp-storage";

function versions(view: any) {
  const capability = view.capabilities.maneuverRulesV1;
  return {
    version: view.run.version,
    turnRevision: view.run.version,
    expectedStateRevision: view.run.version,
    expectedManeuverWindowVersion: capability.window.version,
    controlEpoch: 1,
  };
}

test("MVP maneuver preview is side-effect free, commit is bounded, and stale previews cannot execute", async () => {
  const storage = new MemoryMvpStoryStorage();
  const engine = new MvpStoryEngine(storage);
  const created: any = await engine.create({ storyId: "sangtian" });
  const runId = created.run.id;
  const capability = created.capabilities.maneuverRulesV1;
  const lead = capability.investigationLeads.find((item: any) => item.routes.some((route: any) => route.returnLabel));
  assert.ok(lead);
  const route = lead.routes[0];

  const staleCandidate: any = await engine.previewManeuver(runId, {
    ...versions(created),
    idempotencyKey: "preview:custom:seal-archive",
    draft: {
      schemaVersion: "maneuver_draft_v1",
      kind: "CUSTOM_PLAN",
      rawText: "命一队兵丁封锁巡抚衙门档房",
      attachmentAssetKeys: [],
      visibilityPreference: "PUBLIC",
    },
  });
  assert.equal(staleCandidate.decision, "READY");

  const before = await storage.load(runId);
  const preview: any = await engine.previewManeuver(runId, {
    ...versions(created),
    idempotencyKey: "preview:investigation:registry",
    draft: {
      schemaVersion: "maneuver_draft_v1",
      kind: "INVESTIGATION",
      traceId: lead.traceId,
      routeId: route.routeId,
      attachmentAssetKeys: [],
    },
  });
  assert.equal(preview.decision, "READY");
  assert.ok(preview.previewId);
  assert.ok(preview.previewToken);
  assert.equal(preview.compiledAction, undefined);

  const afterPreview = await storage.load(runId);
  assert.equal(afterPreview.run.version, before.run.version);
  assert.equal(afterPreview.events.length, before.events.length);
  assert.equal(afterPreview.maneuverState.maneuverOpportunitiesRemaining, 2);
  assert.equal(afterPreview.maneuverRulesV1.evidenceCards.length, 0);

  const committed: any = await engine.commitManeuverPreview(runId, {
    version: created.run.version,
    idempotencyKey: "commit:investigation:registry",
    previewId: preview.previewId,
    previewToken: preview.previewToken,
    expectedStateRevision: created.run.version,
    expectedManeuverWindowVersion: capability.window.version,
    controlEpoch: 1,
  });
  assert.equal(committed.accepted, true);
  assert.equal(committed.action.kind, "INVESTIGATION");
  assert.equal(committed.gameProjection.capabilities.maneuverRulesV1.window.remainingOpportunities, 1);
  assert.equal(committed.gameProjection.capabilities.maneuverRulesV1.window.formLimits.investigationRemaining, 0);
  assert.ok(committed.gameProjection.capabilities.maneuverRulesV1.evidenceCards.length >= 1);
  const evidence = committed.gameProjection.capabilities.maneuverRulesV1.evidenceCards[0];
  assert.ok(evidence.supports.length >= 1);
  assert.ok(evidence.cannotProve.length >= 1);
  assert.match(String(evidence.visibility), /PRIVATE|仅你可见/u);

  await assert.rejects(
    () => engine.commitManeuverPreview(runId, {
      version: committed.gameProjection.run.version,
      idempotencyKey: "commit:custom:stale",
      previewId: staleCandidate.previewId,
      previewToken: staleCandidate.previewToken,
      expectedStateRevision: committed.gameProjection.run.version,
      expectedManeuverWindowVersion: committed.gameProjection.capabilities.maneuverRulesV1.window.version,
      controlEpoch: 1,
    }),
    (error: any) => error?.getResponse?.()?.code === "ACTION_PREVIEW_STALE",
  );
});

test("holding a reaction closes only that window and creates no maneuver action or pending result", async () => {
  const storage = new MemoryMvpStoryStorage();
  const engine = new MvpStoryEngine(storage);
  const created: any = await engine.create({ storyId: "sangtian" });
  const runId = created.run.id;

  const current = await storage.load(runId);
  const reaction = {
    eventId: "critical-hold-1",
    title: "有人正在搬运封箱",
    summary: "后门出现了一辆尚未离开的马车。",
    sourceRole: "xunfu",
    severity: "high",
    status: "pending",
    originEventId: "origin-1",
  };
  current.criticalEvent = reaction;
  current.pendingCriticalEvents = [reaction];
  const expectedVersion = current.run.version;
  current.run.version += 1;
  current.run.updatedAt = new Date().toISOString();
  await storage.save(current, expectedVersion);

  const withReaction: any = await engine.get(runId);
  const projectedReaction = withReaction.capabilities.maneuverRulesV1.reactions[0];
  assert.equal(projectedReaction.reactionId, reaction.eventId);

  const preview: any = await engine.previewManeuver(runId, {
    ...versions(withReaction),
    idempotencyKey: "preview:reaction:hold",
    draft: {
      schemaVersion: "maneuver_draft_v1",
      kind: "REACTION",
      reactionId: reaction.eventId,
      hold: true,
    },
  });
  assert.equal(preview.decision, "READY");
  const beforeHold = await storage.load(runId);
  const beforePendingCount = beforeHold.maneuverRulesV1.pendingActions.length;
  const beforeMessagesCount = beforeHold.messages.length;
  const beforeOpportunities = beforeHold.maneuverState.maneuverOpportunitiesRemaining;

  const result: any = await engine.commitManeuverPreview(runId, {
    version: withReaction.run.version,
    idempotencyKey: "commit:reaction:hold",
    previewId: preview.previewId,
    previewToken: preview.previewToken,
    expectedStateRevision: withReaction.run.version,
    expectedManeuverWindowVersion: withReaction.capabilities.maneuverRulesV1.window.version,
    controlEpoch: 1,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.action.kind, "REACTION");
  assert.equal(result.action.status, "RESOLVED");

  const afterHold = await storage.load(runId);
  assert.equal(afterHold.maneuverRulesV1.pendingActions.length, beforePendingCount);
  assert.equal(afterHold.messages.length, beforeMessagesCount);
  assert.equal(afterHold.maneuverState.maneuverOpportunitiesRemaining, beforeOpportunities);
  assert.equal(afterHold.criticalEvent, null);
  assert.equal(afterHold.pendingCriticalEvents?.[0]?.status, "held");
  assert.ok(afterHold.events.some((item) => item.type === "maneuver_reaction_held"));
  assert.ok(!afterHold.events.some((item) => item.type === "maneuver_action_committed" && item.payload?.actionKind === "REACTION"));

  const replay: any = await engine.commitManeuverPreview(runId, {
    version: withReaction.run.version,
    idempotencyKey: "commit:reaction:hold",
    previewId: preview.previewId,
    previewToken: preview.previewToken,
  });
  assert.equal(replay.idempotentReplay, true);
});
