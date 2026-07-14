import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(".");
const webBase = (process.env.MANY_WORLDS_WEB_BASE || "http://127.0.0.1:5178").replace(/\/$/, "");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const resultDir = join(root, "docs", "auto-execute", "evidence", "many-worlds-v13", "page-interactions");
if (!existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForJson(url) { for (let attempt = 0; attempt < 100; attempt += 1) { try { const response = await fetch(url); if (response.ok) return response.json(); } catch {} await sleep(150); } throw new Error(`CDP not ready: ${url}`); }
class Cdp {
  constructor(socket) { this.socket = socket; this.id = 0; this.pending = new Map(); this.exceptions = []; }
  static async connect(url) { const socket = new WebSocket(url); const cdp = new Cdp(socket); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once:true }); socket.addEventListener("error", reject, { once:true }); }); socket.addEventListener("message", (event) => { const data = JSON.parse(event.data.toString()); if (data.method === "Runtime.exceptionThrown") cdp.exceptions.push(data.params.exceptionDetails.text || "runtime exception"); const pending = cdp.pending.get(data.id); if (!pending) return; cdp.pending.delete(data.id); data.error ? pending.reject(new Error(JSON.stringify(data.error))) : pending.resolve(data.result); }); return cdp; }
  send(method, params = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  close() { this.socket.close(); }
}

let chrome; let cdp;
async function evaluate(expression) { const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise:true, returnByValue:true, userGesture:true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "browser expression failed"); return result.result?.value; }
async function wait(expression, label, timeout = 20000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(150); } throw new Error(`Timed out waiting for ${label}`); }
async function navigate(path) { await cdp.send("Page.navigate", { url: `${webBase}${path}` }); }
async function click(selector, label) { const clicked = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) return false; node.click(); return true; })()`); if (!clicked) throw new Error(`Unable to click ${label}`); }

try {
  await mkdir(resultDir, { recursive:true });
  const port = Number(process.env.MANY_WORLDS_INTERACTION_CDP_PORT || 9337);
  chrome = spawn(chromePath, [`--remote-debugging-port=${port}`, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(root, ".runtime", "chrome-many-worlds-v13-page-interactions")}`, "about:blank"], { stdio:"ignore" });
  await waitForJson(`http://127.0.0.1:${port}/json/version`);
  let page = (await waitForJson(`http://127.0.0.1:${port}/json/list`)).find((item) => item.type === "page");
  if (!page?.webSocketDebuggerUrl) page = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method:"PUT" }).then((response) => response.json());
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable"); await cdp.send("Emulation.setDeviceMetricsOverride", { width:1586, height:992, deviceScaleFactor:1, mobile:false });
  const steps = [];

  await navigate("/auth?returnTo=/worlds/caesar"); await wait("Boolean(document.querySelector('[data-auth-form]'))", "auth page"); await click('[data-auth-tab="signup"]', "signup tab"); await wait("document.querySelector('[data-auth-tab=signup]')?.classList.contains('active')", "signup tab state"); steps.push("auth signup tab");
  await navigate("/worlds/caesar"); await wait("Boolean(document.querySelector('[data-action=solo]'))", "world page"); await click('[data-action="solo"]', "solo navigation"); await wait("location.pathname === '/role-select' && location.search.includes('story=caesar')", "solo route"); steps.push("world solo route");
  await navigate("/worlds/caesar"); await wait("Boolean(document.querySelector('[data-action=rooms]'))", "world multiplayer action"); await click('[data-action="rooms"]', "multiplayer navigation"); await wait("location.pathname === '/rooms' && location.search.includes('worldId=caesar')", "rooms route"); steps.push("world multiplayer route");
  await wait("Boolean(document.querySelector('[data-action=join-room]'))", "rooms fixture action"); await click('[data-action="join-room"]', "fixture join route"); await wait("location.pathname === '/rooms/fixture-caesar-waiting'", "fixture room route"); steps.push("rooms fixture join route");
  for (const [action, expected] of [["play-again", "/role-select"], ["other-role", "/role-select"], ["back-worlds", "/worlds/caesar"]]) {
    await navigate("/game/result?runId=fixture-caesar-finished"); await wait(`Boolean(document.querySelector('[data-action=${action}]'))`, `${action} action`); await click(`[data-action="${action}"]`, action); await wait(`location.pathname === ${JSON.stringify(expected)}`, `${action} route`); steps.push(`result ${action}`);
  }
  if (cdp.exceptions.length) throw new Error(`Runtime exceptions: ${cdp.exceptions.join(" | ")}`);
  const result = { status:"PASS", steps, runtimeExceptions:cdp.exceptions, completedAt:new Date().toISOString() };
  await writeFile(join(resultDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally { cdp?.close(); chrome?.kill(); }
