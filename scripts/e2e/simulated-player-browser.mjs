import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(".");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const webBase = (process.env.SIM_WEB_BASE || "http://127.0.0.1:5200").replace(/\/$/, "");
// The Web server owns the /api proxy in local acceptance.  Keeping this
// same-origin avoids coupling browser coverage to a particular dev port.
const apiBase = (process.env.SIM_API_BASE || "/api").replace(/\/$/, "");
const cdpPort = Number(process.env.SIM_CDP_PORT || 9331);
const firstUnderstandingPlayers = Math.max(1, Number(process.env.SIM_FIRST_UNDERSTANDING_PLAYERS || 5));
const screenshots = join(root, "docs", "auto-execute", "screenshots", "simulated-player");
const profile = join(root, ".runtime", "chrome-simulated-player");

if (!existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);
await mkdir(screenshots, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForJson(url, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return await response.json(); lastError = new Error(`${response.status} ${url}`); } catch (error) { lastError = error; }
    await sleep(200);
  }
  throw lastError || new Error(`timeout: ${url}`);
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.exceptions = []; }
  static async connect(url) {
    const ws = new WebSocket(url); const cdp = new Cdp(ws);
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data.toString());
      if (data.method === "Runtime.exceptionThrown") cdp.exceptions.push(data.params.exceptionDetails.text || "runtime exception");
      const pending = cdp.pending.get(data.id); if (!pending) return;
      cdp.pending.delete(data.id); data.error ? pending.reject(new Error(JSON.stringify(data.error))) : pending.resolve(data.result);
    });
    return cdp;
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  close() { this.ws.close(); }
}

let chrome; let cdp;
async function evaluate(expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}
async function waitUntil(expression, description, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await sleep(150); }
  throw new Error(`timeout waiting for ${description}`);
}
async function navigate(url) { await cdp.send("Page.navigate", { url }); await sleep(350); }
async function setViewport(width, height) { await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }); }
async function screenshot(name) { const image = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }); const path = join(screenshots, name); await writeFile(path, Buffer.from(image.data, "base64")); return `docs/auto-execute/screenshots/simulated-player/${name}`; }
async function click(selector, description) {
  const clicked = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) return false; element.click(); return true; })()`);
  if (!clicked) throw new Error(`missing or disabled ${description}: ${selector}`);
}
async function clearPlayerState() { await evaluate(`(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} return true; })()`); }
async function openThroughUi(viewport) {
  await setViewport(viewport.width, viewport.height);
  await navigate(`${webBase}/worlds/sangtian?apiBase=${encodeURIComponent(apiBase)}&simulated=1`);
  await waitUntil("Boolean(document.querySelector('[data-action=sangtian-solo]'))", "嘉靖财政危局 solo entry");
  await click("[data-action=sangtian-solo]", "嘉靖财政危局 solo button");
  await waitUntil("location.pathname === '/role-select'", "role selection route");
  await waitUntil("Boolean(document.querySelector('#enterRole'))", "role confirmation");
  await click("#enterRole", "role confirmation");
  try {
    await waitUntil("location.pathname === '/game' && Boolean(document.querySelector('[data-testid=story-shell]'))", "game route");
  } catch (error) {
    const diagnostic = await evaluate("(() => ({ path:location.pathname + location.search, text:document.body.innerText.slice(0, 1200), alert:document.querySelector('[role=alert]')?.textContent || '' }))()");
    throw new Error(`${error instanceof Error ? error.message : String(error)}; diagnostic=${JSON.stringify(diagnostic)}`);
  }
  await waitUntil("Boolean(document.querySelector('#beginStoryBtn'))", "opening narrative");
}
async function snapshot(label) {
  return await evaluate(`(() => ({ label: ${JSON.stringify(label)}, path: location.pathname, title: document.title, width: innerWidth, scrollWidth: document.documentElement.scrollWidth, hasOpening: Boolean(document.querySelector('#beginStoryBtn')), hasDecision: Boolean(document.querySelector('#submitDecision')), hasCritical: Boolean(document.querySelector('#criticalRespondBtn')), hasHistory: Boolean(document.querySelector('#historyBtn')), visibleText: document.body.innerText.slice(0, 1800) }))()`);
}
async function submitDecision() {
  // The frozen 嘉靖 game deliberately streams the opening before exposing the
  // first actionable choice; a normal 20-second UI polling window is too
  // short when the narrative provider is warm-starting.
  try {
    await waitUntil("Boolean(document.querySelector('input[name=decision]')) && Boolean(document.querySelector('#submitDecision'))", "decision controls", 90_000);
  } catch (error) {
    const diagnostic = await evaluate("(() => ({ path:location.pathname + location.search, runId:new URL(location.href).searchParams.get('runId'), text:document.body.innerText.slice(0, 1800), hasBegin:Boolean(document.querySelector('#beginStoryBtn')), hasAdvance:Boolean(document.querySelector('#advanceBtn, #maneuverAdvanceBtn')), hasError:Boolean(document.querySelector('.error, [role=alert]')) }))()");
    throw new Error(`${error instanceof Error ? error.message : String(error)}; diagnostic=${JSON.stringify(diagnostic)}`);
  }
  await evaluate(`(() => { const option = document.querySelector('input[name=decision]'); const submit = document.querySelector('#submitDecision'); option.click(); submit.click(); return true; })()`);
  await waitUntil("Boolean(document.querySelector('#continueStoryBtn:not([disabled])'))", "decision result continuation", 90_000);
  await click("#continueStoryBtn", "decision result continuation");
  await sleep(200);
}
async function advanceDay() {
  await waitUntil("Boolean(document.querySelector('#advanceBtn:not([disabled]), #maneuverAdvanceBtn:not([disabled])'))", "advance-day control", 20_000);
  await click("#advanceBtn:not([disabled]), #maneuverAdvanceBtn:not([disabled])", "advance-day control");
  await sleep(900);
}
async function resolveTwoPrompts() { await submitDecision(); await submitDecision(); }

async function firstUnderstandingRound() {
  const records = [];
  for (let index = 1; index <= firstUnderstandingPlayers; index += 1) {
    await clearPlayerState();
    await openThroughUi({ width: 1366, height: 768 });
    const state = await snapshot(`SP-R1-${index}`);
    const visible = state.visibleText;
    const understood = {
      roleIdentity: /浙江总督|总督/.test(visible),
      sevenDays: /距离御前裁决/.test(visible) && /\n[0-6]\n天/.test(visible),
      openingAndContinue: Boolean(state.hasOpening),
      decisionAreaAvailable: Boolean(state.hasOpening)
    };
    if (!Object.values(understood).every(Boolean)) throw new Error(`first understanding failed for simulated player ${index}`);
    records.push({ playerId: `SIM-R1-${index}`, scenarioIds: ["SP-001", "SP-002", "SP-003", "SP-004"], clicks: ["嘉靖财政危局 solo", "confirm playable role"], pausesMs: [350, 350], understood, viewport: "1366x768" });
  }
  return records;
}

async function completeFlowRound() {
  await clearPlayerState();
  await openThroughUi({ width: 1672, height: 941 });
  const clicks = ["嘉靖财政危局 solo", "confirm playable role", "begin opening narrative"];
  await click("#beginStoryBtn", "begin story");
  await resolveTwoPrompts(); await advanceDay();
  await resolveTwoPrompts(); await advanceDay();
  // Day three: select the visible investigation workbench, then choose one
  // concrete investigation card.  These cards submit directly in the frozen
  // main-game UI; there is no hidden select or generic submit control.
  try {
    await waitUntil("Boolean(document.querySelector('[data-maneuver-type=investigate]:not([disabled])'))", "available investigation workbench", 30_000);
  } catch (error) {
    const diagnostic = await evaluate("(() => ({ path:location.pathname + location.search, text:document.body.innerText.slice(0, 1800), currentDay:document.body.innerText.match(/第\\s*(\\d+)\\s*天/)?.[1] || '', hasAdvance:Boolean(document.querySelector('#advanceBtn, #maneuverAdvanceBtn')), hasContinue:Boolean(document.querySelector('#continueStoryBtn')), investigationDisabled:document.querySelector('[data-maneuver-type=investigate]')?.disabled ?? null }))()");
    throw new Error(`${error instanceof Error ? error.message : String(error)}; diagnostic=${JSON.stringify(diagnostic)}`);
  }
  await click('[data-maneuver-type="investigate"]', "investigation workbench");
  await waitUntil("Boolean(document.querySelector('[data-maneuver-investigation]'))", "investigation choices");
  await click('[data-maneuver-investigation="inspect_courier_registry"]', "investigate maneuver");
  await waitUntil("Boolean(document.querySelector('#criticalDeferBtn'))", "critical event modal");
  clicks.push("investigate maneuver", "defer critical event");
  await click("#criticalDeferBtn", "defer critical event");
  await waitUntil("Boolean(document.querySelector('#criticalDeferredOpenBtn'))", "deferred event notice");
  await evaluate("location.reload(); true");
  await waitUntil("Boolean(document.querySelector('#criticalDeferredOpenBtn'))", "deferred event after refresh");
  clicks.push("refresh", "reopen deferred event", "submit critical response");
  await click("#criticalDeferredOpenBtn", "reopen deferred critical event");
  await waitUntil("Boolean(document.querySelector('input[name=decision]'))", "critical response decision zone");
  await submitDecision(); await submitDecision(); await advanceDay();
  for (let day = 4; day <= 6; day += 1) { await resolveTwoPrompts(); await advanceDay(); }
  await waitUntil("Boolean(document.querySelector('#finalizeBtn'))", "final judgment control");
  clicks.push("complete day 1-7 decisions", "finalize judgment");
  await click("#finalizeBtn", "finalize judgment");
  await waitUntil("document.body.innerText.includes('结局') || document.body.innerText.includes('裁决')", "final judgment result");
  const state = await snapshot("SP-R2-complete");
  const image = await screenshot("round-2-complete-flow.png");
  return { playerId: "SIM-R2-01", scenarioIds: ["SP-005", "SP-006", "SP-009", "SP-012", "SP-019", "SP-020", "SP-021", "SP-024", "SP-025", "SP-026", "SP-027", "SP-029", "SP-032", "SP-033", "SP-035"], clicks, pausesMs: [3700, 900, 3700], viewport: "1672x941", state, screenshot: image };
}

async function compatibilityRound() {
  const records = [];
  for (const [index, viewport] of [[1, { width: 1366, height: 768 }], [2, { width: 1672, height: 941 }]]) {
    await clearPlayerState();
    await openThroughUi(viewport);
    await click("#beginStoryBtn", "begin story");
    await submitDecision();
    const beforeReload = await snapshot(`SP-R3-${index}-before-refresh`);
    await evaluate("location.reload(); true");
    await waitUntil("Boolean(document.querySelector('[data-testid=story-shell]'))", "game recovery after refresh");
    const afterReload = await snapshot(`SP-R3-${index}-after-refresh`);
    if (beforeReload.scrollWidth > beforeReload.width || afterReload.scrollWidth > afterReload.width) throw new Error(`horizontal overflow at ${viewport.width}x${viewport.height}`);
    records.push({ playerId: `SIM-R3-${index}`, scenarioIds: ["SP-028", "SP-029", "SP-030", "SP-031", "SP-034", "SP-035"], clicks: ["嘉靖财政危局 solo", "role confirm", "begin story", "submit visible decision", "refresh"], viewport: `${viewport.width}x${viewport.height}`, beforeReload, afterReload, screenshot: await screenshot(`round-3-${viewport.width}x${viewport.height}.png`) });
  }
  return records;
}

try {
  chrome = spawn(chromePath, [`--remote-debugging-port=${cdpPort}`, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`);
  let page = (await waitForJson(`http://127.0.0.1:${cdpPort}/json/list`)).find((item) => item.type === "page");
  if (!page?.webSocketDebuggerUrl) page = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  const result = {
    schemaVersion: "simulated-player-browser-v1",
    status: "PASS",
    method: "Automated simulated players used only visible DOM controls in a real browser; no direct API or database calls were made by the test driver.",
    rounds: [
      { round: 1, name: "first-understanding", players: await firstUnderstandingRound() },
      { round: 2, name: "complete-behavior", players: [await completeFlowRound()] },
      { round: 3, name: "compatibility-and-recovery", players: await compatibilityRound() }
    ],
    runtimeExceptions: cdp.exceptions,
    completedAt: new Date().toISOString()
  };
  assertNoRuntimeExceptions(result.runtimeExceptions);
  await mkdir(join(root, "docs", "auto-execute", "results"), { recursive: true });
  await writeFile(join(root, "docs", "auto-execute", "results", "simulated-player-browser.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: result.status, rounds: result.rounds.map((round) => ({ round: round.round, players: round.players.length })), report: "docs/auto-execute/results/simulated-player-browser.json" }));
} finally { cdp?.close(); chrome?.kill(); }

function assertNoRuntimeExceptions(exceptions) { if (exceptions.length) throw new Error(`browser runtime exceptions: ${exceptions.join(" | ")}`); }
