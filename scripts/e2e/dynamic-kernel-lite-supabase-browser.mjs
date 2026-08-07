import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import {
  inspectSupabaseAcceptanceEnvironment,
  prepareSupabaseAcceptanceEnvironment,
  syntheticEmail,
  verifySupabaseAcceptanceConnection,
} from "../acceptance/supabase-formal-acceptance.mjs";

const root = resolve(".");
const webBase = String(
  process.env.DYNAMIC_KERNEL_LITE_WEB_BASE
    || "http://127.0.0.1:5178",
).replace(/\/$/u, "");
const chromePath = process.env.CHROME_PATH
  || (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/usr/bin/google-chrome");
const cdpPort = Number(
  process.env.DYNAMIC_KERNEL_LITE_BROWSER_CDP_PORT || 9341,
);
const evidenceRoot = resolve(
  process.env.SUPABASE_ACCEPTANCE_EVIDENCE_ROOT
    || "outputs/dynamic-kernel-lite-supabase",
);
const browserEvidenceRoot = join(evidenceRoot, "browser");
prepareSupabaseAcceptanceEnvironment(process.env);
const acceptance = await verifySupabaseAcceptanceConnection(
  inspectSupabaseAcceptanceEnvironment(process.env),
);
const email = syntheticEmail("browser", Date.now(), process.env);
const password = "DynamicKernelLite2026!";

if (!existsSync(chromePath)) {
  throw new Error(`FORMAL_BROWSER_CHROME_NOT_FOUND:${chromePath}`);
}
await mkdir(browserEvidenceRoot, { recursive: true });

const sleep = (ms) => new Promise((resolvePromise) => {
  setTimeout(resolvePromise, ms);
});

async function verificationUrlFor(recipient, timeout = 15_000) {
  const sink = String(process.env.AUTH_MAIL_SINK_FILE || "").trim();
  if (!sink) throw new Error("FORMAL_BROWSER_MAIL_SINK_MISSING");
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const text = await readFile(sink, "utf8").catch(() => "");
    const lines = text.split(/\r?\n/u).filter(Boolean).reverse();
    for (const line of lines) {
      const message = JSON.parse(line);
      if (String(message.to || "").toLowerCase() !== recipient.toLowerCase()) {
        continue;
      }
      const content = String(message.text || message.html || "");
      const url = content.match(/https?:\/\/[^\s<]+/u)?.[0];
      if (url) return url.replace(/&amp;/gu, "&");
    }
    await sleep(100);
  }
  throw new Error(`FORMAL_BROWSER_VERIFICATION_MAIL_MISSING:${recipient}`);
}

async function waitForJson(url, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`${response.status} ${url}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw lastError || new Error(`timeout: ${url}`);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.networkFailures = [];
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    const cdp = new Cdp(socket);
    await new Promise((resolvePromise, reject) => {
      socket.addEventListener("open", resolvePromise, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data.toString());
      if (data.method === "Runtime.exceptionThrown") {
        cdp.exceptions.push(
          data.params?.exceptionDetails?.text || "runtime exception",
        );
      }
      if (data.method === "Network.loadingFailed") {
        cdp.networkFailures.push({
          errorText: data.params?.errorText,
          type: data.params?.type,
          canceled: data.params?.canceled,
        });
      }
      const pending = cdp.pending.get(data.id);
      if (!pending) return;
      cdp.pending.delete(data.id);
      if (data.error) pending.reject(new Error(JSON.stringify(data.error)));
      else pending.resolve(data.result);
    });
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
    });
  }

  close() {
    this.socket.close();
  }
}

let chrome;
let cdp;

async function evaluate(expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.text || "browser expression failed",
    );
  }
  return result.result?.value;
}

async function waitUntil(expression, description, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await sleep(150);
  }
  const diagnostic = await evaluate(
    "(() => ({ path: location.pathname + location.search, text: document.body.innerText.slice(0, 2200) }))()",
  ).catch(() => null);
  throw new Error(
    `timeout waiting for ${description}; diagnostic=${JSON.stringify(diagnostic)}`,
  );
}

async function click(selector, description) {
  const clicked = await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node || node.disabled) return false;
    node.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`unable to click ${description}`);
}

async function decisionSurface() {
  return evaluate(`(() => ({
    decisionPointText: document.querySelector('[data-testid=story-shell]')?.innerText?.slice(-1800) || '',
    options: Array.from(document.querySelectorAll('input[name=decision]')).map((input) => {
      const label = document.querySelector('label[for="' + input.id + '"]')?.innerText?.trim()
        || input.closest('label')?.innerText?.trim()
        || '';
      return {
        key: input.value || input.dataset?.optionId || label,
        value: input.value || '',
        label
      };
    })
  }))()`);
}

async function screenshot(name) {
  const image = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  const file = join(browserEvidenceRoot, name);
  await writeFile(file, Buffer.from(image.data, "base64"));
  return file;
}

const prisma = new PrismaClient();
try {
  chrome = spawn(chromePath, [
    `--remote-debugging-port=${cdpPort}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    `--user-data-dir=${join(root, ".runtime", `chrome-dkl-supabase-${Date.now()}`)}`,
    "about:blank",
  ], { stdio: "ignore" });
  await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`);
  let page = (await waitForJson(`http://127.0.0.1:${cdpPort}/json/list`))
    .find((item) => item.type === "page");
  if (!page?.webSocketDebuggerUrl) {
    page = await fetch(
      `http://127.0.0.1:${cdpPort}/json/new?about:blank`,
      { method: "PUT" },
    ).then((response) => response.json());
  }
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const returnTo = "/role-select?story=sangtian&start=new";
  await cdp.send("Page.navigate", {
    url: `${webBase}/auth?returnTo=${encodeURIComponent(returnTo)}`,
  });
  await waitUntil(
    "Boolean(document.querySelector('[data-auth-form]'))",
    "authentication page",
  );
  await click('[data-auth-tab="signup"]', "signup tab");
  await evaluate(`(() => {
    const set = (name, value) => {
      const field = document.querySelector('[name="' + name + '"]');
      if (!field) throw new Error('missing field ' + name);
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('email', ${JSON.stringify(email)});
    set('password', ${JSON.stringify(password)});
    set('nickname', 'Dynamic Kernel Lite Supabase');
    document.querySelector('[data-auth-form]').requestSubmit();
    return true;
  })()`);
  await waitUntil(
    "Boolean(document.querySelector('[data-notice]')) && document.querySelector('[data-notice]').innerText.includes('Account created')",
    "signup confirmation",
  );
  const verificationUrl = await verificationUrlFor(email);
  await cdp.send("Page.navigate", { url: verificationUrl });
  await waitUntil(
    "location.pathname === '/role-select' && Boolean(document.querySelector('#enterRole'))",
    "email verification, signed-in entry and role selection",
  );
  await click("#enterRole", "solo role confirmation");
  await waitUntil(
    "location.pathname === '/game' && Boolean(document.querySelector('[data-testid=story-shell]'))",
    "real game page",
  );
  const runId = await evaluate(
    "new URL(location.href).searchParams.get('runId') || localStorage.getItem('many-worlds-story-run-id') || ''",
  );
  assert.match(
    String(runId),
    /^solo_ovl_[a-f0-9]{32}$/u,
    "real page must create an OpenNovel run",
  );

  await waitUntil(
    "Boolean(document.querySelector('#beginStoryBtn'))",
    "opening narrative",
  );
  await click("#beginStoryBtn", "begin story");
  await waitUntil(
    "document.querySelectorAll('input[name=decision]').length >= 2 && Boolean(document.querySelector('#submitDecision'))",
    "first Dynamic Kernel decision surface",
  );
  const before = await decisionSurface();
  assert.ok(before.options.length >= 2, "first surface needs at least two options");
  assert.ok(
    new Set(before.options.map((option) => option.key)).size >= 2,
    "visible choices must expose distinct stable option keys",
  );
  await evaluate(`(() => {
    const option = document.querySelector('input[name=decision]');
    const submit = document.querySelector('#submitDecision');
    option.click();
    submit.click();
    return true;
  })()`);
  await waitUntil(
    "Boolean(document.querySelector('#continueStoryBtn:not([disabled])'))",
    "committed turn result",
  );
  await click("#continueStoryBtn", "continue after committed turn");
  await waitUntil(
    "document.querySelectorAll('input[name=decision]').length >= 2",
    "next Dynamic Kernel decision surface",
  );
  const afterCommit = await decisionSurface();
  const committedScreenshot = await screenshot("dynamic-kernel-committed.png");

  await evaluate("location.reload(); true");
  await waitUntil(
    "location.pathname === '/game' && document.querySelectorAll('input[name=decision]').length >= 2",
    "decision recovery after refresh",
  );
  const afterRefresh = await decisionSurface();
  assert.deepEqual(
    afterRefresh.options,
    afterCommit.options,
    "refresh must preserve the committed option surface",
  );

  const [storedRun, actions, nodes, events] = await Promise.all([
    prisma.storyRun.findUnique({ where: { id: String(runId) } }),
    prisma.playerAction.findMany({
      where: { runId: String(runId) },
      orderBy: { createdAt: "asc" },
    }),
    prisma.sceneNode.findMany({
      where: { runId: String(runId) },
      orderBy: { createdAt: "asc" },
    }),
    prisma.eventLog.findMany({
      where: { runId: String(runId) },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  assert.ok(storedRun, "StoryRun must exist in Supabase");
  assert.equal(storedRun.engineVersion, "openovel_v1");
  assert.equal(storedRun.worldSequence, 1);
  assert.equal(actions.length, 1, "one page submission must persist one action");
  assert.equal(
    nodes.filter((node) => node.status === "resolved").length,
    1,
    "one page submission must resolve one SceneNode",
  );
  assert.equal(
    events.filter((event) => event.eventName === "openovel_turn_committed")
      .length,
    1,
    "one atomic page submission must emit one commit event",
  );
  assert.equal(cdp.exceptions.length, 0, "browser runtime exceptions are forbidden");

  const report = {
    schemaVersion: "omw.dynamic-kernel-lite.supabase-browser.v1",
    status: "PASS",
    evidenceClass: acceptance.evidenceClass,
    databaseProvider: acceptance.provider,
    supabaseProjectRefHash: acceptance.projectRefHash,
    supabaseSchema: acceptance.schema,
    acceptanceNamespace: acceptance.namespace,
    syntheticEmail: email,
    runId,
    worldSequence: storedRun.worldSequence,
    playerActionCount: actions.length,
    resolvedSceneNodeCount: nodes.filter(
      (node) => node.status === "resolved",
    ).length,
    committedEventCount: events.filter(
      (event) => event.eventName === "openovel_turn_committed",
    ).length,
    beforeOptionCount: before.options.length,
    afterCommitOptions: afterCommit.options,
    afterRefreshOptions: afterRefresh.options,
    browserRuntimeExceptions: cdp.exceptions,
    browserNetworkFailures: cdp.networkFailures,
    screenshot: committedScreenshot,
    checkedAt: new Date().toISOString(),
  };
  const reportPath = join(browserEvidenceRoot, "result.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log("DYNAMIC_KERNEL_LITE_SUPABASE_BROWSER_PASS");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const failure = {
    schemaVersion: "omw.dynamic-kernel-lite.supabase-browser.v1",
    status: "FAIL",
    evidenceClass: acceptance.evidenceClass,
    databaseProvider: acceptance.provider,
    supabaseProjectRefHash: acceptance.projectRefHash,
    supabaseSchema: acceptance.schema,
    acceptanceNamespace: acceptance.namespace,
    syntheticEmail: email,
    error: error instanceof Error ? error.stack || error.message : String(error),
    browserRuntimeExceptions: cdp?.exceptions || [],
    browserNetworkFailures: cdp?.networkFailures || [],
    checkedAt: new Date().toISOString(),
  };
  await writeFile(
    join(browserEvidenceRoot, "failure.json"),
    `${JSON.stringify(failure, null, 2)}\n`,
    "utf8",
  ).catch(() => {});
  throw error;
} finally {
  await prisma.$disconnect();
  cdp?.close();
  chrome?.kill();
}
