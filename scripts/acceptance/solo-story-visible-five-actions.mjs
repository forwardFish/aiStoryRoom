import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const root = resolve(process.env.PROJECT_ROOT || ".");
const webBase = String(process.env.SOLO_VISIBLE_WEB_BASE || "http://127.0.0.1:5297").replace(/\/$/, "");
const mailSink = resolve(process.env.AUTH_MAIL_SINK_FILE || "apps/api/.auth-mail-sink.ndjson");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const cdpPort = Number(process.env.SOLO_VISIBLE_CDP_PORT || 9357);
const stamp = `solo-five-${Date.now()}-${randomBytes(3).toString("hex")}`;
const email = `${stamp}@example.test`;
const password = `Solo-${randomBytes(18).toString("base64url")}!`;
const profile = await mkdtemp(join(tmpdir(), "many-worlds-solo-five-"));
const outDir = resolve(process.env.SOLO_VISIBLE_EVIDENCE_DIR || join(root, "docs", "auto-execute", "evidence", stamp));
const prisma = new PrismaClient();
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

if (!existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);
await mkdir(outDir, { recursive: true });

async function request(path, options = {}, expected = [200, 201]) {
  const response = await fetch(`${webBase}/api${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!expected.includes(response.status)) {
    throw new Error(`${path} returned ${response.status}: ${body.code || body.message || JSON.stringify(body)}`);
  }
  return body;
}

async function verificationToken() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const raw = await readFile(mailSink, "utf8").catch(() => "");
    const rows = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    const message = rows.reverse().find((row) => String(row.to || "").toLowerCase() === email && String(row.subject || "").startsWith("Verify your email address"));
    const match = String(message?.text || message?.html || "").match(/[?&]token=([^&\s<]+)/);
    if (match) return decodeURIComponent(match[1]);
    await sleep(100);
  }
  throw new Error(`Verification email was not written to ${mailSink}`);
}

async function waitForJson(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.consoleErrors = [];
    this.failedRequests = [];
    this.network = [];
    this.responseBodies = [];
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    const cdp = new Cdp(socket);
    await new Promise((resolveOpen, reject) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data.toString());
      if (data.method === "Runtime.exceptionThrown") {
        cdp.exceptions.push(data.params?.exceptionDetails?.exception?.description || data.params?.exceptionDetails?.text || "Runtime exception");
      }
      if (data.method === "Runtime.consoleAPICalled" && data.params?.type === "error") {
        cdp.consoleErrors.push((data.params.args || []).map((arg) => arg.value || arg.description || "").join(" "));
      }
      if (data.method === "Network.loadingFailed") {
        cdp.failedRequests.push({ requestId: data.params.requestId, errorText: data.params.errorText, canceled: data.params.canceled === true });
      }
      if (data.method === "Network.responseReceived") {
        const urlValue = String(data.params?.response?.url || "");
        if (urlValue.includes("/api/v4/rooms/") || urlValue.includes("/api/v4/credits/")) {
          cdp.network.push({ url: urlValue, status: data.params.response.status, type: data.params.type });
          void cdp.send("Network.getResponseBody", { requestId: data.params.requestId })
            .then((body) => cdp.responseBodies.push({ url: urlValue, status: data.params.response.status, body: body.body }))
            .catch(() => {});
        }
      }
      const pending = cdp.pending.get(data.id);
      if (!pending) return;
      cdp.pending.delete(data.id);
      data.error ? pending.reject(new Error(JSON.stringify(data.error))) : pending.resolve(data.result);
    });
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveSend, reject) => this.pending.set(id, { resolve: resolveSend, reject }));
  }

  close() { this.socket.close(); }
}

const allActions = [
  { kind: "RECOMMENDED", slug: "recommended" },
  { kind: "TALK", slug: "talk", type: "contact", text: "召见巡抚，当面问清改桑数额如何分派，以及各县能否承受。" },
  { kind: "INVESTIGATE", slug: "investigate", type: "investigate", text: "核对急令、县册和经手人，查清数额与田亩是否相符。" },
  { kind: "USE_LEVERAGE", slug: "leverage", type: "leverage", text: "出示总督密奏渠道，要求对方交出真实账目并说明经手人。" },
  { kind: "CUSTOM", slug: "custom", type: "custom", text: "先令各县暂缓强征三日，同时召集粮商与县令核对存粮和可改桑田亩。" }
];
const requestedActions = new Set(String(process.env.SOLO_VISIBLE_ACTIONS || "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean));
const actions = requestedActions.size ? allActions.filter((action) => requestedActions.has(action.kind)) : allActions;
if (!actions.length) throw new Error(`No matching SOLO_VISIBLE_ACTIONS: ${[...requestedActions].join(",")}`);

await request("/v4/auth/register", { method: "POST", body: JSON.stringify({ email, password, nickname: "Solo Story Visible Acceptance" }) });
await request("/v4/auth/verify", { method: "POST", body: JSON.stringify({ token: await verificationToken() }) });

const chrome = spawn(chromePath, [
  `--remote-debugging-port=${cdpPort}`,
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${profile}`,
  "about:blank"
], { stdio: "ignore" });

let cdp;
const journeys = [];
try {
  await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`);
  const page = (await waitForJson(`http://127.0.0.1:${cdpPort}/json/list`)).find((entry) => entry.type === "page");
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__STORY_STREAM_DELAY_MULTIPLIER__ = 0;" });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const wait = async (expression, label, timeout = 90_000) => {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try { last = await evaluate(expression); } catch (error) { last = error.message; }
      if (last) return last;
      await sleep(150);
    }
    const snapshot = await evaluate("({ path:location.pathname, text:document.body.innerText.slice(0,1800), html:document.body.innerHTML.slice(0,1000) })").catch(() => null);
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(snapshot || last)}`);
  };
  const navigate = async (url) => {
    await cdp.send("Page.navigate", { url });
    await wait("document.readyState === 'complete'", `page load ${url}`, 30_000);
  };
  const screenshot = async (name) => {
    const image = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    const path = join(outDir, name);
    await writeFile(path, Buffer.from(image.data, "base64"));
    return path;
  };

  await navigate(`${webBase}/auth?mode=login&returnTo=${encodeURIComponent("/role-select?story=sangtian&start=new")}`);
  await wait("Boolean(document.querySelector('[data-auth-form]'))", "login form");
  await evaluate(`(() => {
    const set = (name, value) => { const input = document.querySelector('[name="' + name + '"]'); input.value = value; input.dispatchEvent(new Event('input', { bubbles:true })); };
    set('email', ${JSON.stringify(email)});
    set('password', ${JSON.stringify(password)});
    document.querySelector('[data-auth-form]').requestSubmit();
    return true;
  })()`);
  await wait("location.pathname === '/role-select' && Boolean(document.querySelector('#enterRole'))", "authenticated role selection", 30_000);
  const creditGrant = await evaluate(`fetch('/api/v4/credits/test-grant', { method:'POST', credentials:'include', headers:{'content-type':'application/json'}, body:JSON.stringify({runId:${JSON.stringify(stamp)},amount:500}) }).then(async (response) => ({status:response.status, body:await response.json()}))`);
  if (creditGrant.status !== 201 && creditGrant.status !== 200) throw new Error(`Credit grant failed: ${JSON.stringify(creditGrant)}`);
  const initialBalance = await evaluate("fetch('/api/v4/credits/balance',{credentials:'include'}).then(r=>r.json())");

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    console.log(`[${index + 1}/${actions.length}] starting ${action.kind}`);
    await navigate(`${webBase}/role-select?story=sangtian&start=new&acceptance=${action.slug}`);
    await wait("Boolean(document.querySelector('#enterRole:not([disabled])'))", `${action.kind} role select`);
    await evaluate("document.querySelector('#enterRole').click(); true");
    await wait("location.pathname === '/game' && Boolean(new URL(location.href).searchParams.get('runId'))", `${action.kind} game navigation`, 45_000);
    const runId = await evaluate("new URL(location.href).searchParams.get('runId')");
    await wait("Boolean(document.querySelector('#beginStoryBtn'))", `${action.kind} fixed opening`, 45_000);
    if (index === 0) await screenshot(`${String(index + 1).padStart(2, "0")}-${action.slug}-opening.png`);
    await evaluate("document.querySelector('#beginStoryBtn').click(); true");
    await wait("Boolean(document.querySelector('#continueStoryBtn'))", `${action.kind} first situation narrative`, 15_000);
    await evaluate("document.querySelector('#continueStoryBtn').click(); true");
    await wait("Boolean(document.querySelector('#submitDecision')) && Boolean(document.querySelector('[data-testid=\"maneuver-panel\"]'))", `${action.kind} actionable turn`, 15_000);

    const availability = await evaluate(`(() => Object.fromEntries([...document.querySelectorAll('[data-maneuver-type]:not([data-maneuver-direct])')].map((button) => [button.dataset.maneuverType, { disabled:button.disabled, state:button.dataset.availability || '', title:button.title || '', text:button.innerText.trim() }])))()`);
    const visibleDecisions = await evaluate(`([...document.querySelectorAll('input[name="decision"]')].map((input) => ({ value:input.value, title:input.closest('label')?.innerText.trim() || '' })))`);
    await screenshot(`${String(index + 1).padStart(2, "0")}-${action.slug}-before.png`);

    let submittedText = "";
    if (action.kind === "RECOMMENDED") {
      const choice = visibleDecisions[1] || visibleDecisions[0];
      if (!choice) throw new Error("No visible recommended decision was available");
      submittedText = choice.title;
      await evaluate(`(() => { const input=[...document.querySelectorAll('input[name="decision"]')].find((item)=>item.value===${JSON.stringify(choice.value)}); if(!input) throw new Error('chosen decision missing'); input.click(); if(!input.checked) throw new Error('chosen decision was not checked'); document.querySelector('#submitDecision').click(); return true; })()`);
    } else {
      const item = availability[action.type];
      if (!item || item.disabled || item.state !== "AVAILABLE") throw new Error(`${action.kind} is not available: ${JSON.stringify(item)}`);
      await evaluate(`document.querySelector('[data-maneuver-type=${JSON.stringify(action.type)}]:not([data-maneuver-direct])').click(); true`);
      if (action.type === "contact") {
        await wait("Boolean(document.querySelector('[data-maneuver-contact]:not([disabled])'))", "contact target");
        await evaluate("document.querySelector('[data-maneuver-contact]:not([disabled])').click(); true");
      } else if (action.type === "investigate") {
        await wait("Boolean(document.querySelector('[data-maneuver-investigation]:not([disabled])'))", "investigation target");
        await evaluate("document.querySelector('[data-maneuver-investigation]:not([disabled])').click(); true");
      } else if (action.type === "leverage") {
        await wait("Boolean(document.querySelector('[data-maneuver-leverage]:not([disabled])'))", "leverage target");
        await evaluate("document.querySelector('[data-maneuver-leverage]:not([disabled])').click(); true");
      }
      submittedText = action.text;
      await wait("Boolean(document.querySelector('#maneuverCustomText'))", `${action.kind} intent input`);
      await evaluate(`(() => { const input=document.querySelector('#maneuverCustomText'); input.value=${JSON.stringify(action.text)}; input.dispatchEvent(new Event('input',{bubbles:true})); if(input.value!==${JSON.stringify(action.text)}) throw new Error('maneuver text did not persist'); return true; })()`);
      await wait("Boolean(document.querySelector('#maneuverSubmit:not([disabled])'))", `${action.kind} submit control`);
      await evaluate("document.querySelector('#maneuverSubmit').click(); true");
    }

    await wait("Boolean(document.querySelector('[data-testid=\"simulation-screen\"], .simulation-stage, .simulation-screen')) || document.body.innerText.includes('AI is shaping') || document.body.innerText.includes('推演')", `${action.kind} resolving screen`, 10_000);
    await screenshot(`${String(index + 1).padStart(2, "0")}-${action.slug}-resolving.png`);
    await wait("Boolean(document.querySelector('#continueStoryBtn')) || Boolean(document.querySelector('[data-testid=\"error-banner\"]'))", `${action.kind} generated result`, 120_000);
    const errorBanner = await evaluate("document.querySelector('[data-testid=\"error-banner\"]')?.innerText || ''");
    if (errorBanner) throw new Error(`${action.kind} failed visibly: ${errorBanner}`);
    const resultStory = await evaluate("document.querySelector('[data-testid=\"result-narrative\"]')?.innerText.trim() || ''");
    await screenshot(`${String(index + 1).padStart(2, "0")}-${action.slug}-result.png`);
    await evaluate("document.querySelector('#continueStoryBtn').click(); true");
    await wait("Boolean(document.querySelector('#submitDecision'))", `${action.kind} next decisions`, 15_000);
    const nextDecisions = await evaluate(`([...document.querySelectorAll('input[name="decision"]')].map((input) => input.closest('label')?.innerText.trim() || '').filter(Boolean))`);
    const nextSituation = await evaluate("document.querySelector('.decision-question')?.innerText.trim() || document.querySelector('.decision-frame h2')?.innerText.trim() || ''");
    await screenshot(`${String(index + 1).padStart(2, "0")}-${action.slug}-next.png`);

    const attempts = await prisma.soloGenerationAttempt.findMany({ where: { runId }, orderBy: { createdAt: "asc" } });
    const submissions = await prisma.decisionSubmission.findMany({ where: { runId }, orderBy: { submittedAt: "asc" } });
    const resolutions = await prisma.actionResolution.findMany({ where: { runId }, orderBy: { resolvedAt: "asc" } });
    const run = await prisma.storyRun.findUnique({ where: { id: runId }, select: { billingPolicyVersion: true, billingPriceJson: true, ownerUserId: true } });
    const actionAttempts = attempts.filter((attempt) => attempt.triggerType !== "OPENING");
    const checks = {
      freshRun: runId.startsWith("solo_"),
      activeActionBilling: run?.billingPolicyVersion === "active_action_v1",
      oneAcceptedSubmission: submissions.length === 1 && submissions[0].status === "RESOLVED",
      exactlyOneProviderCall: actionAttempts.length === 1 && actionAttempts[0].providerCallCount === 1 && actionAttempts[0].status === "PUBLISHED",
      oneResolution: resolutions.length === 1,
      realResultStory: resultStory.length >= 120,
      nextDecisionCount: nextDecisions.length >= 2 && nextDecisions.length <= 4,
      noWaitingForOthers: !resultStory.includes("等待其他") && !resultStory.includes("三方决策"),
      submittedIntentPreserved: JSON.stringify(submissions[0]?.normalizedActionJson || {}).includes(submittedText.replace(/^.[\s\S]*?\n/, "").slice(0, 12)) || action.kind === "RECOMMENDED"
    };
    journeys.push({
      kind: action.kind,
      runId,
      submittedText,
      availability,
      visibleDecisions,
      resultStory,
      nextSituation,
      nextDecisions,
      run,
      attempts: actionAttempts.map((attempt) => ({ id: attempt.id, status: attempt.status, providerCallCount: attempt.providerCallCount, triggerType: attempt.triggerType, timingsJson: attempt.timingsJson, failureReason: attempt.failureReason })),
      submissions: submissions.map((submission) => ({ id: submission.id, candidateId: submission.candidateId, customAction: submission.customAction, normalizedActionJson: submission.normalizedActionJson, status: submission.status })),
      resolutions: resolutions.map((resolution) => ({ id: resolution.id, resultNarrativeLength: resolution.resultNarrative.length, qualityStatus: resolution.qualityStatus })),
      checks
    });
    if (!Object.values(checks).every(Boolean)) throw new Error(`${action.kind} checks failed: ${JSON.stringify(checks)}`);
    console.log(`[${index + 1}/${actions.length}] PASS ${action.kind} ${runId}`);
  }

  const finalBalance = await evaluate("fetch('/api/v4/credits/balance',{credentials:'include'}).then(r=>r.json())");
  const report = {
    status: journeys.length === actions.length && journeys.every((journey) => Object.values(journey.checks).every(Boolean)) && cdp.exceptions.length === 0 ? "PASS" : "REPAIR_REQUIRED",
    fixtureOnly: false,
    route: `${webBase}/role-select?story=sangtian&start=new`,
    account: "non-personal @example.test acceptance account",
    initialBalance,
    finalBalance,
    journeys,
    runtimeExceptions: cdp.exceptions,
    consoleErrors: cdp.consoleErrors,
    failedRequests: cdp.failedRequests.filter((item) => !item.canceled),
    network: cdp.network,
    capturedAt: new Date().toISOString()
  };
  await writeFile(join(outDir, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, evidenceDir: outDir, journeys: journeys.map((journey) => ({ kind: journey.kind, runId: journey.runId, checks: journey.checks, attempts: journey.attempts })) }, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
} catch (error) {
  await sleep(500);
  const failure = { status: "FAILED", message: error instanceof Error ? error.stack || error.message : String(error), journeys, runtimeExceptions: cdp?.exceptions || [], consoleErrors: cdp?.consoleErrors || [], failedRequests: cdp?.failedRequests || [], network: cdp?.network || [], responseBodies: cdp?.responseBodies || [], capturedAt: new Date().toISOString() };
  await writeFile(join(outDir, "result.json"), `${JSON.stringify(failure, null, 2)}\n`);
  console.error(failure.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
  try { await cdp?.send("Browser.close"); } catch {}
  cdp?.close();
  if (chrome.exitCode === null) chrome.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
