import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { PrismaService } from "../prisma.service";
import { OpenNovelManeuverPreviewService } from "./openovel-maneuver-preview.service";
import { OpenNovelManeuverService } from "./openovel-maneuver.service";
import {
  OpenNovelRuntimeClient,
  type OpenNovelPublicRun,
} from "./openovel-runtime.client";

type PreviewResult = Awaited<ReturnType<OpenNovelManeuverPreviewService["preview"]>>;
type AcceptedPreviewResult = Extract<PreviewResult, { accepted: true }>;

function requireAcceptedPreview(result: PreviewResult): AcceptedPreviewResult {
  if (result.accepted !== true) {
    throw new Error(`preview was rejected: ${result.reason}`);
  }
  return result;
}

type AcceptedSubmissionResult = {
  accepted: true;
  replayed: boolean;
};

function requireAcceptedSubmission(
  value: unknown,
): asserts value is AcceptedSubmissionResult {
  if (
    value === null
    || typeof value !== "object"
    || !("accepted" in value)
    || value.accepted !== true
    || !("replayed" in value)
    || typeof value.replayed !== "boolean"
  ) {
    throw new Error("committed confirm did not return an accepted submission");
  }
}

function createTestDouble<T extends object>(
  prototype: T,
  properties: PropertyDescriptorMap,
): T {
  return Object.defineProperties(Object.create(prototype), properties);
}

function fixture() {
  const run = {
    id: "solo_ovl_preview_service",
    title: "Preview service test",
    templateKey: "sangtian",
    status: "playing",
    ownerUserId: "user-1",
    version: 7,
    stateJson: {},
    engineVersion: "openovel_v1",
    players: [{
      userId: "user-1",
      role: {
        id: "role-governor",
        roleKey: "zhejiang_governor",
        roleName: "浙江总督",
        identity: "浙江总督",
        personalGoal: "稳住浙江",
      },
    }],
  };
  const runtimeRun: OpenNovelPublicRun = {
    runId: run.id,
    worldId: "sangtian",
    roleId: "zhejiang_governor",
    runtimeMode: "OPENOVEL_V1",
    turnNumber: 0,
    status: "READY",
    canon: "开场正文",
    recentCanon: "当前局势",
    options: [{ id: "opening_d1", label: "先查证" }],
    updatedAt: new Date().toISOString(),
  };
  let submitCalls = 0;
  let committed = false;
  let releaseSubmit: ((value: unknown) => void) | null = null;
  const submitted = new Promise((resolve) => { releaseSubmit = resolve; });

  const prisma = createTestDouble(PrismaService.prototype, {
    storyRun: {
      value: {
        findUnique: async () => run,
      },
    },
    storyEvent: {
      value: {
        findUnique: async () => committed
          ? { id: "event-1", payloadJson: { requestFingerprint: "durable" } }
          : null,
      },
    },
  });
  const runtime = createTestDouble(OpenNovelRuntimeClient.prototype, {
    getRun: {
      value: async () => runtimeRun,
    },
  });
  const maneuvers = createTestDouble(OpenNovelManeuverService.prototype, {
    submit: {
      value: async () => {
        submitCalls += 1;
        if (committed) {
          return {
            accepted: true,
            replayed: true,
            resolution: { id: "event-1" },
          };
        }
        return submitted;
      },
    },
  });
  const service = new OpenNovelManeuverPreviewService(
    prisma,
    runtime,
    maneuvers,
  );
  return {
    service,
    run,
    runtimeRun,
    get submitCalls() { return submitCalls; },
    release(value: unknown) { releaseSubmit?.(value); },
    markCommitted() { committed = true; },
  };
}

const user: AuthenticatedUser = {
  id: "user-1",
  openid: "openid-1",
  email: null,
  emailVerifiedAt: null,
  nickname: null,
  authMethod: "PASSWORD",
  authIdentityId: null,
};
const command = {
  version: 7,
  idempotencyKey: "preview-service-key-001",
  maneuverType: "contact",
  targetRoleKey: "county_magistrate",
  messageText: "原始名册为何早于诏令形成？",
};

test("preview validates the authoritative projection without model or persistence side effects", async () => {
  const f = fixture();
  const before = JSON.stringify(f.run);
  const result = requireAcceptedPreview(
    await f.service.preview(user, f.run.id, command),
  );
  assert.equal(result.previewed, true);
  assert.match(result.previewToken, /^[^.]+\.[^.]+$/);
  assert.match(result.preview.previewId, /^ovl_preview_/);
  assert.equal(result.preview.sceneKey, "d1_1");
  assert.equal(result.preview.maneuverType, "contact");
  assert.equal(f.submitCalls, 0);
  assert.equal(JSON.stringify(f.run), before);
});

test("concurrent confirms for one signed preview execute the logical submit once", async () => {
  const f = fixture();
  const preview = requireAcceptedPreview(
    await f.service.preview(user, f.run.id, command),
  );
  const first = f.service.confirm(user, f.run.id, preview.previewToken);
  const second = f.service.confirm(user, f.run.id, preview.previewToken);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.submitCalls, 1);
  f.release({ accepted: true, replayed: false, resolution: { id: "event-1" } });
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
});

test("a committed confirm replays before checking the now-advanced revision", async () => {
  const f = fixture();
  const preview = requireAcceptedPreview(
    await f.service.preview(user, f.run.id, command),
  );
  const first = f.service.confirm(user, f.run.id, preview.previewToken);
  f.release({ accepted: true, replayed: false, resolution: { id: "event-1" } });
  await first;
  f.markCommitted();
  f.run.version = 8;

  const replay = await f.service.confirm(user, f.run.id, preview.previewToken);

  requireAcceptedSubmission(replay);
  assert.equal(replay.accepted, true);
  assert.equal(replay.replayed, true);
  assert.equal(f.submitCalls, 2, "the second call delegates to the durable replay path, not a new commit");
});
