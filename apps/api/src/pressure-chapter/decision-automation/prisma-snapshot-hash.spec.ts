import assert from "node:assert/strict";
import test from "node:test";
import { sha256Canonical } from "@ai-story/shared";
import type { DecisionSubmitSnapshotV1 } from "./contracts";
import { withDecisionSubmitSnapshotHashV1 } from "./prisma-snapshot";

const HASH = sha256Canonical({ test: "authority" });

test("submit snapshot hash binds authority identity without canonicalizing projection Maps", () => {
  const authority = {
    schemaVersion: "pressure_decision_convergence_authority_snapshot_v1",
    snapshotHash: HASH,
    projection: {
      acceptedActions: new Map([["action-1", { actionId: "action-1" }]]),
      actionsByIdempotencyKey: new Map([["key-1", { actionId: "action-1" }]]),
    },
  } as unknown as DecisionSubmitSnapshotV1["authority"];
  const input: Omit<DecisionSubmitSnapshotV1, "submitSnapshotHash"> = {
    schemaVersion: "pressure_submit_page_authority_snapshot_v1",
    authority,
    viewer: {
      roomId: "room-1",
      runId: "run-1",
      subjectId: "subject-1",
      seatId: "zhejiang_governor",
      humanControllerId: "subject-1",
    },
    page: { snapshotHash: sha256Canonical("page-1") } as DecisionSubmitSnapshotV1["page"],
  };

  const result = withDecisionSubmitSnapshotHashV1(input);

  assert.equal(result.authority.projection.acceptedActions instanceof Map, true);
  assert.equal(result.submitSnapshotHash, sha256Canonical({
    schemaVersion: input.schemaVersion,
    authoritySnapshotHash: HASH,
    viewer: input.viewer,
    pageSnapshotHash: input.page.snapshotHash,
  }));
});

test("submit snapshot hash changes when viewer authorization changes", () => {
  const authority = {
    snapshotHash: HASH,
  } as DecisionSubmitSnapshotV1["authority"];
  const base: Omit<DecisionSubmitSnapshotV1, "submitSnapshotHash"> = {
    schemaVersion: "pressure_submit_page_authority_snapshot_v1",
    authority,
    viewer: {
      roomId: "room-1",
      runId: "run-1",
      subjectId: "subject-1",
      seatId: "zhejiang_governor",
      humanControllerId: "subject-1",
    },
    page: { snapshotHash: sha256Canonical("page-2") } as DecisionSubmitSnapshotV1["page"],
  };

  const first = withDecisionSubmitSnapshotHashV1(base);
  const second = withDecisionSubmitSnapshotHashV1({
    ...base,
    viewer: { ...base.viewer, subjectId: "subject-2", humanControllerId: "subject-2" },
  });

  assert.notEqual(first.submitSnapshotHash, second.submitSnapshotHash);
});
