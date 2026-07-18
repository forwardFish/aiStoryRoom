import assert from "node:assert/strict";
import { HttpException } from "@nestjs/common";
import {
  PresenceHeartbeatRateLimitGuard,
  V4WriteRateLimitGuard,
  isPresenceHeartbeatRequest
} from "../api-transport";
import { isControllerChange, playerFacingActionTitle, playerFacingResultDecision, publicRoleControllerState, roleControlProjection } from "./member-projection.service";

type TestRequest = {
  method: string;
  path: string;
  ip: string;
  user?: { id: string };
  body?: { sessionInstanceId: string };
};

const previousEnv = {
  write: process.env.API_WRITE_RATE_LIMIT_PER_MINUTE,
  session: process.env.HEARTBEAT_SESSION_RATE_LIMIT_PER_MINUTE,
  user: process.env.HEARTBEAT_USER_RATE_LIMIT_PER_MINUTE,
  ip: process.env.HEARTBEAT_IP_RATE_LIMIT_PER_MINUTE
};

try {
  process.env.API_WRITE_RATE_LIMIT_PER_MINUTE = "1";
  process.env.HEARTBEAT_SESSION_RATE_LIMIT_PER_MINUTE = "90";
  process.env.HEARTBEAT_USER_RATE_LIMIT_PER_MINUTE = "240";
  process.env.HEARTBEAT_IP_RATE_LIMIT_PER_MINUTE = "600";

  assert.equal(isPresenceHeartbeatRequest("POST", "/api/v4/rooms/room-1/presence/heartbeat"), true);
  assert.equal(isPresenceHeartbeatRequest("POST", "/api/v4/rooms/room-1/presence/heartbeat?retry=1"), true);
  assert.equal(isPresenceHeartbeatRequest("GET", "/api/v4/rooms/room-1/presence/heartbeat"), false);
  const writes = new V4WriteRateLimitGuard();
  for (let index = 0; index < 10; index += 1) {
    assert.equal(writes.canActivate(context(request("user-1", "session-1")) as never), true);
  }
  const genericWrite = { method: "POST", path: "/api/v4/rooms/room-1/actions/main", ip: "203.0.113.9" };
  assert.equal(writes.canActivate(context(genericWrite) as never), true);
  assert.throws(
    () => writes.canActivate(context(genericWrite) as never),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 429
  );

  const heartbeat = new PresenceHeartbeatRateLimitGuard();
  const sharedIp = "198.51.100.44";
  for (let round = 0; round < 70; round += 1) {
    for (let player = 1; player <= 3; player += 1) {
      assert.equal(
        heartbeat.canActivate(context(request(`user-${player}`, `session-${player}`, sharedIp)) as never),
        true,
        `heartbeat ${round + 1} for user-${player} must not be rate limited`
      );
    }
  }
  for (let count = 71; count <= 90; count += 1) {
    assert.equal(heartbeat.canActivate(context(request("user-1", "session-1", sharedIp)) as never), true);
  }
  const headers = new Map<string, string>();
  let limited: HttpException | null = null;
  try {
    heartbeat.canActivate(context(request("user-1", "session-1", sharedIp), headers) as never);
  } catch (error) {
    limited = error as HttpException;
  }
  assert.ok(limited instanceof HttpException);
  assert.equal(limited.getStatus(), 429);
  const limitedBody = limited.getResponse() as Record<string, unknown>;
  assert.equal(limitedBody.code, "HEARTBEAT_RATE_LIMITED");
  assert.equal(typeof limitedBody.retryAfterMs, "number");
  assert.ok(Number(limitedBody.retryAfterMs) > 0 && Number(limitedBody.retryAfterMs) <= 60_000);
  assert.match(headers.get("Retry-After") || "", /^\d+$/);

  const controls = [
    { roleId: "role-human", mode: "HUMAN_ACTIVE", epoch: 7, reclaimAfterWindowId: null },
    { roleId: "role-away", mode: "HUMAN_OFFLINE_GRACE", epoch: 8, reclaimAfterWindowId: null },
    { roleId: "role-ai", mode: "AI_ACTIVE", epoch: 9, reclaimAfterWindowId: null },
    { roleId: "role-reclaim", mode: "HUMAN_RECLAIM_PENDING", epoch: 10, reclaimAfterWindowId: "window-2" },
    { roleId: "role-system", mode: "SYSTEM", epoch: 11, reclaimAfterWindowId: null }
  ];
  const publicStates = controls.map(publicRoleControllerState);
  for (const state of publicStates) {
    assert.deepEqual(Object.keys(state).sort(), ["controllerKind", "presence", "roleId"]);
    assert.equal("mode" in state, false);
    assert.equal("epoch" in state, false);
    assert.equal("reclaimPolicy" in state, false);
    assert.equal("effectiveFromSlot" in state, false);
  }
  assert.deepEqual(publicStates[3], {
    roleId: "role-reclaim",
    controllerKind: "AI",
    presence: "AI_CONTROLLED"
  });
  assert.deepEqual(roleControlProjection(controls[3]), {
    roleId: "role-reclaim",
    mode: "HUMAN_RECLAIM_PENDING",
    presence: "AI_CONTROLLED",
    epoch: 10,
    reclaimPolicy: "NEXT_WINDOW",
    effectiveFromSlot: "window-2"
  });
  assert.deepEqual(playerFacingResultDecision({
    chapterIndex: 1,
    node: { nodeIndex: 7 },
    actionSlot: "MAIN",
    method: "承担最终复核责任",
    actorKind: "HUMAN"
  }), {
    stageIndex: 7,
    slot: "MAIN",
    title: "承担最终复核责任",
    actorKind: "HUMAN"
  });
  assert.equal(playerFacingResultDecision({
    chapterIndex: 2,
    actionSlot: "MANEUVER",
    method: "maneuver_s2_internal_key",
    actorKind: "AI_TAKEOVER"
  }).title, "已完成的角色行动");
  assert.equal(isControllerChange("HUMAN_ACTIVE", "HUMAN_OFFLINE_GRACE"), false);
  assert.equal(isControllerChange("HUMAN_OFFLINE_GRACE", "HUMAN_ACTIVE"), false);
  assert.equal(isControllerChange("AI_ACTIVE", "HUMAN_RECLAIM_PENDING"), false);
  assert.equal(isControllerChange("HUMAN_ACTIVE", "AI_ACTIVE"), true);
  assert.equal(isControllerChange("AI_ACTIVE", "HUMAN_ACTIVE"), true);
  assert.equal(playerFacingActionTitle("要求县令交出原件"), "要求县令交出原件");
  assert.equal(playerFacingActionTitle("main_s2_governor_request_original"), "一项需要你回应的行动");

  console.log("continuous strategy transport and projection privacy: PASS");
} finally {
  restore("API_WRITE_RATE_LIMIT_PER_MINUTE", previousEnv.write);
  restore("HEARTBEAT_SESSION_RATE_LIMIT_PER_MINUTE", previousEnv.session);
  restore("HEARTBEAT_USER_RATE_LIMIT_PER_MINUTE", previousEnv.user);
  restore("HEARTBEAT_IP_RATE_LIMIT_PER_MINUTE", previousEnv.ip);
}

function request(userId: string, sessionInstanceId: string, ip = "203.0.113.9"): TestRequest {
  return {
    method: "POST",
    path: "/api/v4/rooms/room-1/presence/heartbeat",
    ip,
    user: { id: userId },
    body: { sessionInstanceId }
  };
}

function context(requestValue: TestRequest, headers = new Map<string, string>()) {
  return {
    switchToHttp: () => ({
      getRequest: () => requestValue,
      getResponse: () => ({ setHeader: (name: string, value: string) => headers.set(name, value) })
    })
  };
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
