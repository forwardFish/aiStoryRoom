import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { accessSync, constants as fsConstants } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = path.join(rootDir, "apps/web/public");
const runId = "browser-maneuver-v1";
const requestLog = [];
let projection = initialProjection();

class CdpClient {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP websocket timed out")), 5_000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", (event) => { clearTimeout(timer); reject(event.error || new Error("CDP websocket failed")); }, { once: true });
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        for (const listener of this.listeners.get(message.method) || []) {
          try { listener(message.params || {}); } catch (error) { console.error(error); }
        }
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed");
    return result.result.value;
  }

  async click(selector) {
    const clicked = await this.evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true; })()`);
    assert.equal(clicked, true, `missing clickable selector: ${selector}`);
  }

  close() { this.socket.close(); }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  requestLog.push({ method: req.method, path: url.pathname });
  try {
    if (req.method === "GET" && url.pathname === `/api/v4/rooms/${runId}/game`) {
      return json(res, 200, projection);
    }
    if (req.method === "POST" && url.pathname === `/api/v4/rooms/${runId}/game/turns/T01/action-previews`) {
      const body = await bodyJson(req);
      assert.equal(body.draft?.kind, "INVESTIGATION");
      assert.equal(body.draft?.traceId, "trace.cart");
      assert.equal(body.draft?.routeId, "route.registry");
      assert.equal(body.expectedManeuverWindowVersion, 1);
      return json(res, 200, previewResponse());
    }
    if (req.method === "POST" && url.pathname === `/api/v4/rooms/${runId}/game/action-previews/preview-browser-1/commit`) {
      const body = await bodyJson(req);
      assert.equal(body.previewToken, "browser-preview-token");
      projection = committedProjection();
      return json(res, 200, {
        accepted: true,
        action: { actionId: "action-browser-1", kind: "INVESTIGATION", slot: "MANEUVER_1", status: "RESOLVED" },
        immediateReceipt: {
          title: "沈砚带回一页抄录",
          narrative: "后门出入簿确认，子时三刻有一辆封箱车离开。",
          visibility: "PRIVATE",
        },
        gameProjection: projection,
      });
    }
    if (req.method === "POST" && url.pathname.includes("/presence/heartbeat")) {
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/game" || url.pathname === "/") {
      return file(res, path.join(publicDir, "index.html"));
    }
    const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    const requested = path.join(publicDir, safePath.replace(/^[/\\]+/, ""));
    if (!requested.startsWith(publicDir)) return text(res, 403, "Forbidden");
    const info = await stat(requested).catch(() => null);
    if (!info?.isFile()) return text(res, 404, "Not found");
    return file(res, requested);
  } catch (error) {
    console.error(error);
    return json(res, 500, { code: "TEST_SERVER_ERROR", message: error instanceof Error ? error.message : String(error) });
  }
});

const webPort = await listen(server);
const debugPort = await reservePort();
const userDataDir = await mkdtemp(path.join(os.tmpdir(), "maneuver-v1-chrome-"));
const browserOrigin = "https://maneuver-v1.test";
const browserUrl = `${browserOrigin}/game?runId=${runId}&debug=1`;
const chromiumBinary = process.env.CHROMIUM_BIN || [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
].find((candidate) => {
  try { return requireFile(candidate); } catch { return false; }
});
if (!chromiumBinary) throw new Error("Chromium binary not found; set CHROMIUM_BIN");
const chromium = spawn(chromiumBinary, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--no-proxy-server",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userDataDir}`,
  "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });

let browserStderr = "";
chromium.stderr.on("data", (chunk) => { browserStderr += String(chunk); });

let cdp = null;
try {
  const target = await waitForTarget(debugPort);
  cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  cdp.on("Fetch.requestPaused", (event) => {
    void proxyBrowserRequest(cdp, event, { browserOrigin, webPort }).catch(async (error) => {
      console.error(error);
      await cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" }).catch(() => undefined);
    });
  });
  const frameTree = await cdp.send("Page.getFrameTree");
  await cdp.send("Page.setDocumentContent", {
    frameId: frameTree.frameTree.frame.id,
    html: await browserDocumentHtml(browserOrigin, browserUrl),
  });
  await waitFor(async () => Boolean(await cdp.evaluate(`document.querySelector('[data-testid="story-shell"]')`)), 20_000, "story shell");

    const permanentLabels = await cdp.evaluate(`Array.from(document.querySelectorAll('[data-mv1-kind]')).map((node) => node.textContent.trim())`);
    assert.deepEqual(permanentLabels, ["人物交谈", "派遣调查", "筹码布局", "自拟谋划"]);
    assert.equal(await cdp.evaluate(`document.querySelector('[data-testid="maneuver-opportunities"]')?.textContent.includes('2 / 2')`), true);
    assert.equal(await cdp.evaluate(`document.body.textContent.includes('应变') && document.querySelectorAll('[data-mv1-kind]').length !== 4`), false);

    await cdp.click(`[data-mv1-kind="INVESTIGATION"]`);
    await waitFor(async () => Boolean(await cdp.evaluate(`document.querySelector('[data-mv1-trace="trace.cart"]')`)), 5_000, "trace card");
    await cdp.click(`[data-mv1-trace="trace.cart"]`);
    await waitFor(async () => Boolean(await cdp.evaluate(`document.querySelector('[data-mv1-route="route.registry"]')`)), 5_000, "route card");
    const routeText = await cdp.evaluate(`document.querySelector('[data-mv1-route="route.registry"]').textContent`);
    assert.match(routeText, /可能查到/u);
    assert.match(routeText, /不能证明/u);
    await cdp.click(`[data-mv1-route="route.registry"]`);
    await cdp.click(`#mv1PreviewAction`);

    await waitFor(async () => Boolean(await cdp.evaluate(`document.querySelector('[data-testid="action-preview-card"]')`)), 5_000, "narrative preview card");
    const previewText = await cdp.evaluate(`document.querySelector('[data-testid="action-preview-card"]').textContent`);
    assert.match(previewText, /浙江总督 · 私密谋划/u);
    assert.match(previewText, /这一步不能证明/u);
    assert.match(previewText, /箱内装的是原始底册/u);
    assert.match(previewText, /派沈砚去查/u);

    await cdp.click(`[data-testid="action-preview-confirm"]`);
    await waitFor(async () => Boolean(await cdp.evaluate(`document.querySelector('[data-testid="maneuver-opportunities"]')?.textContent.includes('1 / 2')`)), 5_000, "authoritative opportunity decrement");
    await waitFor(async () => Boolean(await cdp.evaluate(`document.querySelector('[data-testid="evidence-card-evidence.registry"]')`)), 5_000, "private evidence card");
    const evidenceText = await cdp.evaluate(`document.querySelector('[data-testid="evidence-card-evidence.registry"]').textContent`);
    assert.match(evidenceText, /昨夜封箱车出门记录/u);
    assert.match(evidenceText, /佐证/u);
    assert.match(evidenceText, /仅你可见/u);

    assert.equal(requestLog.filter((item) => item.method === "POST" && item.path.endsWith("/action-previews")).length, 1);
    assert.equal(requestLog.filter((item) => item.method === "POST" && item.path.endsWith("/commit")).length, 1);

  console.log(JSON.stringify({
    ok: true,
      browser: "chromium",
      page: browserUrl,
      assertions: [
        "exactly four permanent maneuver entries",
        "server projection owns 2/2 opportunities",
        "investigation begins with a visible trace and bounded route",
        "narrative preview separates capability from uncertainty",
        "commit reduces opportunities to 1/2",
        "private evidence card appears on the real /game page",
      ],
    requests: requestLog.filter((item) => item.path.startsWith("/api/")),
  }, null, 2));
} catch (error) {
  try {
    if (cdp) {
      console.error("BROWSER_URL", await cdp.evaluate("location.href"));
      console.error("BROWSER_BODY", String(await cdp.evaluate("document.body.innerHTML")).slice(-12000));
    }
  } catch {}
  console.error("REQUEST_LOG", JSON.stringify(requestLog, null, 2));
  console.error(browserStderr.slice(-4000));
  throw error;
} finally {
  cdp?.close();
  if (chromium.exitCode === null) {
    const exitPromise = new Promise((resolve) => chromium.once("exit", resolve));
    chromium.kill("SIGTERM");
    await Promise.race([exitPromise, delay(3_000)]);
    if (chromium.exitCode === null) chromium.kill("SIGKILL");
  }
  server.closeAllConnections?.();
  await Promise.race([new Promise((resolve) => server.close(resolve)), delay(3_000)]);
  await rm(userDataDir, { recursive: true, force: true });
}


async function proxyBrowserRequest(client, event, { browserOrigin, webPort }) {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== browserOrigin) {
    return client.send("Fetch.fulfillRequest", {
      requestId: event.requestId,
      responseCode: 404,
      responseHeaders: responseHeaders("text/plain; charset=utf-8", { "access-control-allow-origin": "*" }),
      body: Buffer.from("External network disabled in browser acceptance").toString("base64"),
    });
  }

  if (request.method === "OPTIONS") {
    requestLog.push({ method: request.method, path: url.pathname });
    return client.send("Fetch.fulfillRequest", {
      requestId: event.requestId,
      responseCode: 204,
      responseHeaders: responseHeaders("text/plain; charset=utf-8", corsHeaders(url.pathname)),
      body: "",
    });
  }

  const forwarded = await fetch(`http://127.0.0.1:${webPort}${url.pathname}${url.search}`, {
    method: request.method,
    headers: {
      accept: request.headers?.accept || "*/*",
      ...(request.headers?.["content-type"] ? { "content-type": request.headers["content-type"] } : {}),
    },
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.postData,
  });
  const bytes = Buffer.from(await forwarded.arrayBuffer());
  const contentType = forwarded.headers.get("content-type") || "application/octet-stream";
  return client.send("Fetch.fulfillRequest", {
    requestId: event.requestId,
    responseCode: forwarded.status,
    responsePhrase: forwarded.statusText,
    responseHeaders: responseHeaders(contentType, corsHeaders(url.pathname)),
    body: bytes.toString("base64"),
  });
}

function corsHeaders(pathname) {
  return pathname.startsWith("/api/")
    ? {
        "access-control-allow-origin": "null",
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "accept, content-type",
      }
    : { "access-control-allow-origin": "*" };
}

function responseHeaders(contentType, extra = {}) {
  return Object.entries({ "content-type": contentType, "cache-control": "no-store", ...extra })
    .map(([name, value]) => ({ name, value: String(value) }));
}

async function browserDocumentHtml(browserOrigin, browserUrl) {
  let html = await readFile(path.join(publicDir, "index.html"), "utf8");
  html = html.replace(/<head>/i, `<head><base href="${browserOrigin}/">`);
  const boot = `<script type="module">
    window.__AI_STORY_DISABLE_AUTO_BOOT__ = true;
    const makeStorage = () => {
      const values = new Map();
      return {
        get length() { return values.size; },
        key(index) { return Array.from(values.keys())[index] ?? null; },
        getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
        setItem(key, value) { values.set(String(key), String(value)); },
        removeItem(key) { values.delete(String(key)); },
        clear() { values.clear(); },
      };
    };
    const logicalLocation = {
      href: ${JSON.stringify(browserUrl)},
      pathname: "/game",
      search: ${JSON.stringify(`?runId=${runId}&debug=1`)},
      hash: "",
      origin: ${JSON.stringify(browserOrigin)},
      assign() {}, replace() {}, reload() {},
      toString() { return this.href; },
    };
    const memoryLocalStorage = makeStorage();
    const memorySessionStorage = makeStorage();
    const absoluteFetch = (input, init) => window.fetch(new URL(String(input), ${JSON.stringify(browserOrigin)}).href, init);
    const testWindow = new Proxy(window, {
      get(target, property) {
        if (property === "location") return logicalLocation;
        if (property === "localStorage") return memoryLocalStorage;
        if (property === "sessionStorage") return memorySessionStorage;
        if (property === "fetch") return absoluteFetch;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    import(${JSON.stringify(`${browserOrigin}/game-bootstrap.js?v=20260805-maneuver-v1`)})
      .then(({ bootGamePage }) => bootGamePage({
        root: document.getElementById("app"),
        window: testWindow,
        fetchImpl: absoluteFetch,
        navigate: () => undefined,
      }))
      .then((app) => { window.__MANEUVER_BROWSER_APP__ = app; })
      .catch((error) => {
        window.__MANEUVER_BROWSER_ERROR__ = String(error?.stack || error);
        document.getElementById("app").innerHTML = '<pre data-testid="browser-boot-error"></pre>';
        document.querySelector('[data-testid="browser-boot-error"]').textContent = window.__MANEUVER_BROWSER_ERROR__;
      });
  </script>`;
  return html.replace(/<script\s+type="module"\s+src="\/game-bootstrap\.js[^>]*><\/script>/i, boot);
}

function requireFile(candidate) {
  try {
    accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function initialProjection() {
  return projectionWith({ remaining: 2, windowVersion: 1, evidenceCards: [], timeline: [] });
}

function committedProjection() {
  return projectionWith({
    remaining: 1,
    windowVersion: 2,
    evidenceCards: [{
      evidenceId: "evidence.registry",
      title: "昨夜封箱车出门记录",
      level: "佐证",
      authenticity: "SUPPORTED",
      supports: ["子时三刻有一辆封箱车从后门离开"],
      cannotProve: ["箱内装的是原始底册", "巡抚本人直接下令"],
      visibility: "PRIVATE",
      sourceLabel: "查阅后门出入簿",
    }],
    timeline: [{
      id: "maneuver:action-browser-1",
      kind: "MANEUVER_RESULT",
      title: "沈砚带回一页抄录",
      content: "后门出入簿确认，子时三刻有一辆封箱车离开。",
      worldSequence: 2,
      createdAt: "2026-08-05T00:02:00.000Z",
      decisionForm: "INVESTIGATION",
      sourceActionId: "action-browser-1",
    }],
  });
}

function projectionWith({ remaining, windowVersion, evidenceCards, timeline }) {
  return {
    schemaVersion: "continuous_game_projection_v2",
    generatedAt: "2026-08-05T00:00:00.000Z",
    worldSequence: windowVersion,
    room: { id: runId, title: "桑田诏：嘉靖财政危局", worldId: "sangtian", status: "playing", mode: "solo", ownerUserId: "user-1" },
    world: {
      schemaVersion: "game_page_world_v1",
      worldId: "sangtian",
      title: "桑田诏：嘉靖财政危局",
      locale: "zh-CN",
      totalStages: 7,
      presentation: {
        locationLabel: "浙江总督府",
        roundLabel: "今日",
        finaleLabel: "御前裁决",
        sceneBackground: "",
        accent: "#6545f5",
        accentSoft: "#f3f0ff",
        statusMetrics: [],
      },
      roles: [{
        roleKey: "zhejiang_governor",
        roleName: "浙江总督",
        identity: "浙江总督",
        publicInfo: "统筹地方政务",
        personalGoal: "保住民田并留下可追索证据",
        currentState: "面临改桑与赈粮双重压力",
        abilityText: "可以调动地方官署和幕僚",
        arcText: "在责任与生民之间作出选择",
        knownInfo: ["档房封条有异"],
        cannotDo: ["不能替巡抚作决定"],
        portrait: "",
        gameplayProfile: {
          characterName: "浙江总督",
          rank: "封疆大吏",
          office: "总督府",
          fateQuestion: "你能否保住民田并留下证据？",
          goals: ["查清底册异常"],
          resources: [{ label: "幕僚", value: "4" }, { label: "兵丁", value: "4" }],
          leverage: ["总督封缄令牌"],
        },
      }],
    },
    player: { userId: "user-1", roleId: "role-governor", roleKey: "zhejiang_governor", roleName: "浙江总督", identity: "浙江总督", personalGoal: "保住民田并留下可追索证据" },
    control: { mode: "HUMAN_ACTIVE", epoch: 1, canHumanAct: true },
    currentTurn: {
      id: "T01",
      revision: 1,
      stageIndex: 1,
      turnIndex: 1,
      baseWorldSequence: 1,
      status: "OPEN",
      title: "档房封条已破",
      narrative: "书记坚持底册没有离开，守门人却提到昨夜听见车轮声。",
      visibleFacts: [],
      framing: "你要怎样处理这处矛盾？",
      decisions: [{
        id: "T01_A",
        actionKey: "T01_A",
        label: "先封存现场，等待进一步核验",
        description: "暂时阻止新的搬运。",
        intent: "封存现场",
        targetRoleId: null,
        targetRoleName: null,
        risk: "NORMAL",
        basisFactKeys: [],
        requiredAssetKeys: [],
        authorityBasis: "当前角色权限",
        intendedOutcome: "保留现场",
        concreteCost: "可能惊动巡抚",
        expectedCountermove: "相关人物可能质疑越权",
        visibility: "PRIVATE",
        effectHooks: [],
        intentDraft: {
          objective: "封存现场",
          target: { type: "PUBLIC_FRAME", id: "scene:1", label: "当前局势" },
          method: "先封存现场，等待进一步核验",
          leverageKeys: [],
          visibility: "PRIVATE",
          riskTolerance: "MEDIUM",
          fallback: null,
          condition: null,
        },
      }],
      availableTargets: [{ type: "PUBLIC_FRAME", id: "scene:1", label: "当前局势" }],
      customActionAllowed: true,
    },
    timeline,
    otherActors: [],
    visibleAssets: [],
    evidenceHoldings: [],
    commitments: [],
    armedConditions: [],
    pendingInteractions: [],
    observableTraces: [],
    capabilities: {
      maneuverRulesV1: {
        schemaVersion: "maneuver_rules_projection_v1",
        enabled: true,
        window: {
          windowId: `${runId}:T01`,
          status: "OPEN",
          totalOpportunities: 2,
          remainingOpportunities: remaining,
          usedSlots: remaining === 1 ? [{ slot: "MANEUVER_1", actionId: "action-browser-1", kind: "INVESTIGATION", status: "RESOLVED" }] : [],
          formLimits: { conversationRemaining: 1, investigationRemaining: remaining === 1 ? 0 : 1 },
          version: windowVersion,
          closesWhen: "MAIN_DECISION_COMMITS",
        },
        contacts: [{ actorId: "actor.xunfu", displayName: "浙江巡抚", publicIdentity: "地方主官", whyRelevant: "他声称底册仍在档房", visibilityOptions: ["LIMITED"] }],
        investigationLeads: [{
          traceId: "trace.cart",
          title: "昨夜的封箱车",
          narrativeHook: "雨势正在冲淡车辙。",
          urgency: "NOW",
          expiresAtLabel: "本场景结束后可能消失",
          routes: [{
            routeId: "route.registry",
            label: "查阅后门出入簿",
            narrativeMethod: "核对时辰、登记人和领车签名",
            mayLearn: ["离开时辰", "领车人"],
            cannotProve: ["箱内装的是原始底册", "巡抚本人直接下令"],
            costLabels: ["幕僚 1"],
            returnLabel: "本场景锁定前",
            possibleTrail: "档房书记可能知道有人翻查记录",
          }],
        }],
        ruleCards: [{
          cardAssetKey: "card.seal",
          label: "总督封缄令牌",
          status: "AVAILABLE",
          timing: ["ACTIVE", "SET", "REACTION"],
          guaranteedEffects: ["普通差役必须停止继续搬运"],
          limitations: ["不能追回已经离开的文件"],
          legalTargets: [{ id: "location.archive", label: "巡抚衙门档房", type: "LOCATION" }],
          triggerOptions: [{ triggerPatternId: "document_transfer_attempt", label: "有人试图转移文件" }],
        }],
        evidenceCards,
        pendingActions: remaining === 1 ? [{ actionId: "action-browser-1", kind: "INVESTIGATION", slot: "MANEUVER_1", title: "查阅后门出入簿", status: "RESOLVED", evidenceId: "evidence.registry", evidenceTitle: "昨夜封箱车出门记录", resultNarrative: "后门出入簿确认了封箱车离开。" }] : [],
        reactions: [],
      },
    },
    access: { state: "UNLOCKED", requiresUnlock: false, requiredCredits: 0, canCurrentUserUnlock: false, unlockEndpoint: null },
    creditControl: { policyVersion: "world_unlock_v1", meteringMode: "OFF", available: 100, personalAvailable: 100, runAllowanceAvailable: 0, minimumActionCost: 0, standardActionCost: 0, customActionCost: 0, canRequestSponsor: false, sponsorshipRequestStatus: "NONE" },
    completed: false,
    resultUrl: null,
  };
}

function previewResponse() {
  return {
    schemaVersion: "action_preview_response_v1",
    decision: "READY",
    previewId: "preview-browser-1",
    previewToken: "browser-preview-token",
    expiresAt: "2099-01-01T00:00:00.000Z",
    presentation: {
      eyebrow: "浙江总督 · 私密谋划",
      title: "让沈砚查阅昨夜后门出入簿",
      narrative: "夜色落下后，你把沈砚叫进内厅，只交代他追查领车人与离开时辰。",
      sections: [
        { kind: "CAN_DO", label: "这一步可能查清", lines: ["封箱车离开的时辰", "登记人与领车人"] },
        { kind: "CANNOT_GUARANTEE", label: "这一步不能证明", lines: ["箱内装的是原始底册", "巡抚本人直接下令"] },
        { kind: "MAY_LEAVE", label: "可能留下", lines: ["档房书记可能知道有人翻查记录"] },
        { kind: "WHEN_REVEALED", label: "何时揭晓", lines: ["本场景主线锁定前"] },
      ],
      chips: [
        { kind: "COST", label: "1 次谋划" },
        { kind: "COST", label: "幕僚 1 人" },
        { kind: "VISIBILITY", label: "结果仅你可见" },
      ],
      confirmLabel: "派沈砚去查",
      editLabel: "返回修改",
    },
  };
}

async function waitForTarget(port) {
  return waitFor(async () => {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      return targets.find((item) => item.type === "page") || false;
    } catch {
      return false;
    }
  }, 15_000, "Chromium target");
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(80);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function listen(httpServer) {
  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  return httpServer.address().port;
}

async function reservePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function bodyJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function file(res, filename) {
  const bytes = await readFile(filename);
  res.writeHead(200, { "content-type": mime(filename), "cache-control": "no-store" });
  res.end(bytes);
}

function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

function text(res, status, value) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(value);
}

function mime(filename) {
  if (filename.endsWith(".html")) return "text/html; charset=utf-8";
  if (filename.endsWith(".js") || filename.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (filename.endsWith(".css")) return "text/css; charset=utf-8";
  if (filename.endsWith(".json")) return "application/json; charset=utf-8";
  if (filename.endsWith(".svg")) return "image/svg+xml";
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}
