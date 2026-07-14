import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const baseUrl = (process.env.MANY_WORLDS_API_BASE || "http://127.0.0.1:3102/api").replace(/\/$/, "");
const stamp = Date.now();
const evidencePath = resolve("docs", "auto-execute", "evidence", "many-worlds-v13", "caesar-solo-seven-round.json");

async function request(path: string, init: RequestInit = {}, token?: string): Promise<any> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path} -> ${response.status} ${payload.code || "UNKNOWN"}: ${payload.message || "request failed"}`);
  return payload;
}

async function post(path: string, body: object, token?: string) {
  return request(path, { method: "POST", body: JSON.stringify(body) }, token);
}

async function waitForTask(roomId: string, taskId: string, token: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const task = await request(`/v4/rooms/${roomId}/game/tasks/${taskId}`, {}, token);
    if (task.status === "completed") return task;
    if (task.status === "failed") throw new Error(task.lastError || "Caesar solo task failed");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Caesar solo task did not complete before timeout");
}

async function main() {
  const email = `mw-caesar-solo-${stamp}@example.test`;
  const password = "MvpTest2026!";
  const registration = await post("/v4/auth/register", { email, password, nickname: "Caesar Solo Acceptance" });
  assert.ok(registration.verificationToken, "non-production registration must provide a verification token");
  await post("/v4/auth/verify", { email, verificationToken: registration.verificationToken });
  const login = await post("/v4/auth/login", { email, password });
  const token = String(login.accessToken);
  assert.ok(token, "login must provide an access token");

  // Rounds 1–3 are intentionally free.  The acceptance flow must exercise
  // the real unlock at round 4, using only the development-only grant endpoint
  // while the server has explicitly enabled it.
  if (process.env.MANY_WORLDS_ENABLE_TEST_CREDIT !== "true") {
    throw new Error("Caesar seven-round acceptance needs MANY_WORLDS_ENABLE_TEST_CREDIT=true and an API started with ALLOW_TEST_CREDIT_GRANT=true");
  }
  const controlledCredit = await post("/v4/credits/test-grant", { runId: String(stamp), amount: 100 }, token);
  assert.equal(controlledCredit.balance.available, 100, "controlled Caesar acceptance account must receive exactly 100 World Credits");

  const created = await post("/v4/rooms/solo", { worldId: "caesar", roleKey: "brutus" }, token);
  assert.equal(created.worldId, "caesar");
  const roomId = String(created.id);
  const rounds: Array<{ nodeIndex: number; taskId: string }> = [];
  let unlock: any = null;
  let game = await request(`/v4/rooms/${roomId}/game`, {}, token);
  for (let nodeIndex = 1; nodeIndex <= 7; nodeIndex += 1) {
    assert.equal(game.currentNode.nodeIndex, nodeIndex, `expected Caesar node ${nodeIndex}`);
    if (nodeIndex === 4) {
      assert.equal(game.access?.requiresUnlock, true, "Caesar round 4 must present the real World Credits unlock gate");
      unlock = await post(`/v4/story-runs/${roomId}/unlock`, {}, token);
      assert.equal(unlock.creditsCharged, 100, "Caesar solo unlock must debit exactly 100 credits once");
      assert.equal(unlock.alreadyUnlocked, false, "first Caesar solo unlock must not be an idempotent replay");
    }
    await post(`/v4/rooms/${roomId}/game/action`, {
      actionType: nodeIndex % 2 ? "investigate" : "negotiate",
      targetText: game.currentNode.title,
      method: `Brutus evaluates the public evidence in node ${nodeIndex} before committing to a constitutional choice.`,
      intent: `Keep the Republic's competing obligations visible in Caesar solo node ${nodeIndex}.`,
      riskLevel: nodeIndex % 2 ? "risky" : "normal"
    }, token);
    const queued = await post(`/v4/rooms/${roomId}/game/resolve-async`, {}, token);
    assert.ok(["pending", "running"].includes(queued.status), "solo resolution must use a durable task");
    await waitForTask(roomId, queued.taskId, token);
    rounds.push({ nodeIndex, taskId: queued.taskId });
    game = await request(`/v4/rooms/${roomId}/game`, {}, token);
  }
  assert.equal(game.completed, true, "the seventh Caesar node must complete the run");
  const result = await request(`/v4/rooms/${roomId}/result`, {}, token);
  assert.equal(result.room.worldId, "caesar");
  assert.equal(result.completedNodes, 7);
  const mine = await request("/v4/rooms/mine?worldId=caesar", {}, token);
  assert.ok(mine.rooms.some((room: any) => room.id === roomId && room.nextAction === "view_result"), "completed Caesar solo run must reopen from My Rooms");
  const report = { status: "PASS", roomId, worldId: result.room.worldId, completedNodes: result.completedNodes, controlledCredit, unlock, rounds, myRoomsResult: true, completedAt: new Date().toISOString() };
  await mkdir(join(evidencePath, ".."), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, evidence: "docs/auto-execute/evidence/many-worlds-v13/caesar-solo-seven-round.json" }));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
