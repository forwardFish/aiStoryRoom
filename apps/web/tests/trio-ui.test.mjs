import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createTrioApp } from "../public/trio.js";

test("三人 AI 页面可以创建故事局、切换玩家并展示通知", async () => {
  const dom = new JSDOM("<!doctype html><main id=trioApp></main>", { url: "http://trio.test/trio?apiBase=http://api.test/api" });
  const api = new TrioMockApi();
  const root = dom.window.document.getElementById("trioApp");
  const app = createTrioApp({ root, window: dom.window, fetchImpl: api.fetch });

  await app.setupRun();
  assert.ok(root.querySelector('[data-testid="trio-shell"]'));
  assert.match(root.textContent, /玩家甲/);
  assert.match(root.textContent, /林鹿/);

  await app.submitAction(0, "investigate", false, "先核验密报并公开可验证证据");
  app.selectPlayer(1);
  await app.refresh();
  assert.match(root.textContent, /玩家乙/);
  await app.submitAction(1, "observe");
  app.selectPlayer(2);
  await app.refresh();
  await app.submitAction(2, "observe");
  assert.equal(app.getState().submitted.size, 3);
  assert.ok(root.querySelector('[data-testid="trio-notifications"]'));
  assert.match(root.textContent, /其他玩家通知/);
  assert.equal(api.requests.filter((item) => item.path.endsWith("/actions") && item.method === "POST").length, 3);
  assert.equal(api.requests.find((item) => item.path.endsWith("/actions") && item.method === "POST").body.freeText, "先核验密报并公开可验证证据");
});

class TrioMockApi {
  constructor() {
    this.requests = [];
    this.actions = [];
    this.run = { id: "trio-run-1", title: "三人 AI 故事局", status: "playing", completedNodeCount: 0 };
    this.node = { id: "node-1", nodeIndex: 1, title: "共享线索的裂缝", nodeGoal: "验证公开证据", publicNarration: "三位玩家必须共享各自看到的线索。" };
    this.roles = ["林鹿", "陈舟", "顾言"].map((roleName, index) => ({ id: `role-${index}`, roleName, identity: `${roleName}身份`, publicGoal: "共享可验证事实" }));
    this.fetch = this.fetch.bind(this);
  }

  async fetch(input, init = {}) {
    const url = new URL(String(input), "http://api.test/api");
    const path = url.pathname.replace(/^\/api/, "");
    const method = String(init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : {};
    this.requests.push({ path, method, body, headers: init.headers });
    if (path === "/world-templates" && method === "GET") return json([{ id: "template-1" }]);
    if (path === "/auth/wechat-login" && method === "POST") return json({ token: "token", user: { id: "user" } });
    if (path === "/story-runs" && method === "POST") return json(this.run);
    if (/^\/story-runs\/trio-run-1\/join$/.test(path)) return json({ runId: this.run.id });
    if (path === "/story-runs/trio-run-1/roles" && method === "GET") return json(this.roles);
    if (/^\/story-runs\/trio-run-1\/roles\/role-\d+\/claim$/.test(path)) return json({ roleId: path.slice(-6) });
    if (path === "/story-runs/trio-run-1/state" && method === "GET") return json({ run: this.run, currentNode: this.node, roles: this.roles, chapters: [] });
    if (path === "/nodes/node-1/actions" && method === "GET") return json(this.actions);
    if (path === "/nodes/node-1/actions" && method === "POST") {
      this.actions.push({ id: `action-${this.actions.length + 1}`, roleId: body.roleId, status: "accepted" });
      return json({ actionId: this.actions.at(-1).id, status: "accepted", guardStatus: "ok" });
    }
    if (path === "/notifications" && method === "GET") return json(this.actions.map((action) => ({ type: "player_decision_shared", title: "玩家决策已共享", body: action.roleId })));
    if (path === "/nodes/node-1/resolve" && method === "POST") return json({ id: "resolution-1", summary: "三方行动已合并", crossImpactsJson: [{ text: "共享线索改变了局势" }] });
    if (path === "/story-runs/trio-run-1" && method === "GET") return json(this.run);
    throw new Error(`Unexpected ${method} ${path}`);
  }
}

function json(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } }); }
