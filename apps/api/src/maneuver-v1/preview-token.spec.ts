import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  signManeuverPreviewTokenV1,
  verifyManeuverPreviewTokenV1,
  type ManeuverPreviewTokenPayloadV1,
} from "./preview-token";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function payload(expiresAt = "2026-08-05T06:00:00.000Z"): ManeuverPreviewTokenPayloadV1 {
  return {
    schemaVersion: "maneuver_preview_token_v1",
    previewId: "preview-test-1",
    runId: "run-test-1",
    actorTurnId: "turn-test-1",
    turnVersion: 4,
    stateRevision: 17,
    maneuverWindowVersion: 2,
    controlEpoch: 3,
    contextHash: hash("context"),
    requestHash: hash("request"),
    previewIdempotencyKey: "preview-run-test-turn-test-draft-1",
    expiresAt,
    draft: {
      schemaVersion: "maneuver_draft_v1",
      kind: "CUSTOM_PLAN",
      rawText: "封锁档案室",
      attachmentAssetKeys: [],
      visibilityPreference: "NORMAL",
    },
    compiledAction: {
      schemaVersion: "compiled_maneuver_action_v1",
      actionKind: "CUSTOM_PLAN",
      slot: "MANEUVER_1",
      runId: "run-test-1",
      actorTurnId: "turn-test-1",
      actorRoleId: "role-test-1",
      actorId: "actor-test-1",
      objective: "封锁档案室",
      target: { type: "LOCATION", id: "location.archive", label: "档案室" },
      method: "封锁档案室",
      primaryEffect: { kind: "APPLY_CAPABILITY", capabilityId: "capability.control", effectKey: "control_or_block" },
      guaranteedStart: [{ statement: "命令会送达现场。" }],
      contestedOutcome: [{ statement: "能否及时建立控制。" }],
      notGuaranteed: [{ statement: "目标仍然留在原处。" }],
      costs: [{ kind: "OPPORTUNITY", amount: 1, label: "1 次谋划" }],
      timing: { startsAt: "ON_COMMIT", settlesAt: { kind: "CURRENT_SETTLEMENT" }, playerLabel: "本场景结算时" },
      visibility: { scope: "OBSERVABLE" },
      tracePolicy: { leavesTrace: true, playerSafeHint: "现场可能察觉调动。" },
      reactionPolicy: { mode: "IF_OBSERVED", playerSafeHint: "相关人物可能应变。" },
      attachedAssetKeys: [],
      sourceEvidenceIds: [],
      settlementBindingId: "binding.control",
      turnRevision: 4,
      stateRevision: 17,
      maneuverWindowVersion: 2,
      controlEpoch: 3,
      contextHash: hash("context"),
    },
    presentation: {
      eyebrow: "负责人 · 私密落子",
      title: "封锁档案室",
      narrative: "你命人前往档案室。",
      sections: [],
      chips: [],
      confirmLabel: "确认封锁档案室",
      editLabel: "返回修改",
    },
  };
}

function withEnv(values: Record<string, string | undefined>, fn: () => void) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("preview token round-trips the server-owned compiled action", () => {
  withEnv({ NODE_ENV: "test", MANEUVER_PREVIEW_SECRET: "test-secret-with-more-than-thirty-two-characters" }, () => {
    const original = payload();
    const token = signManeuverPreviewTokenV1(original);
    const decoded = verifyManeuverPreviewTokenV1(token, Date.parse("2026-08-05T05:30:00.000Z"));
    assert.deepEqual(decoded, original);
    assert.doesNotMatch(token, /封锁档案室/u, "encrypted token must not expose private preview text");
  });
});

test("preview token rejects ciphertext or tag tampering", () => {
  withEnv({ NODE_ENV: "test", MANEUVER_PREVIEW_SECRET: "test-secret-with-more-than-thirty-two-characters" }, () => {
    const token = signManeuverPreviewTokenV1(payload());
    const parts = token.split(".");
    parts[2] = `${parts[2].slice(0, -1)}${parts[2].endsWith("A") ? "B" : "A"}`;
    assert.throws(
      () => verifyManeuverPreviewTokenV1(parts.join("."), Date.parse("2026-08-05T05:30:00.000Z")),
      (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: string }).code === "ACTION_PREVIEW_TOKEN_INVALID"),
    );
  });
});

test("preview token expires at its server-authored deadline", () => {
  withEnv({ NODE_ENV: "test", MANEUVER_PREVIEW_SECRET: "test-secret-with-more-than-thirty-two-characters" }, () => {
    const token = signManeuverPreviewTokenV1(payload("2026-08-05T05:10:00.000Z"));
    assert.throws(
      () => verifyManeuverPreviewTokenV1(token, Date.parse("2026-08-05T05:10:00.000Z")),
      (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: string }).code === "ACTION_PREVIEW_EXPIRED"),
    );
  });
});

test("production refuses an implicit or weak preview secret", () => {
  withEnv({ NODE_ENV: "production", MANEUVER_PREVIEW_SECRET: undefined }, () => {
    assert.throws(
      () => signManeuverPreviewTokenV1(payload()),
      (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: string }).code === "MANEUVER_PREVIEW_SECRET_REQUIRED"),
    );
  });
});
