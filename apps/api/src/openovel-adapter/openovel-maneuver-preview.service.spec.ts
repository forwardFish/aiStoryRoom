import assert from "node:assert/strict";
import test from "node:test";
import { OpenNovelManeuverPreviewService } from "./openovel-maneuver-preview.service";

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
  const runtimeRun = {
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
  let releaseSubmit: ((value: unknown) => void) | null = null;
  const submitted = new Promise((resolve) => { releaseSubmit = resolve; });
  const prisma = {
    storyRun: {
      findUnique: async () => run,
    },
  };
  const runtime = {
    getRun: async () => runtimeRun,
  };
  const maneuvers = {
    submit: async () => {
      submitCalls += 1;
      return submitted;
    },
  };
  const service = new OpenNovelManeuverPreviewService(
    prisma as any,
    runtime as any,
    maneuvers as any,
  );
  return {
    service,
    run,
    runtimeRun,
    get submitCalls() { return submitCalls; },
    release(value: unknown) { releaseSubmit?.(value); },
  };
}

const user = { id: "user-1", openid: "openid-1" } as any;
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
  const result = await f.service.preview(user, f.run.id, command);
  assert.equal(result.accepted, true);
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
  const preview = await f.service.preview(user, f.run.id, command);
  const first = f.service.confirm(user, f.run.id, preview.previewToken);
  const second = f.service.confirm(user, f.run.id, preview.previewToken);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.submitCalls, 1);
  f.release({ accepted: true, replayed: false });
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
});
