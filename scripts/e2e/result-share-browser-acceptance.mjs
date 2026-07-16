import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const root = resolve(".");
const webBase = (process.env.MANY_WORLDS_WEB_BASE || "http://127.0.0.1:5278").replace(/\/$/, "");
const roomId = String(process.env.ACCEPTANCE_ROOM_ID || "").trim();
const email = String(process.env.ACCEPTANCE_EMAIL || "").trim();
const password = String(process.env.ACCEPTANCE_PASSWORD || "");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const evidenceDir = join(root, "docs", "auto-execute", "evidence", "functional-closure", "invite-result-browser");
const redactShareToken = (value) => String(value || "").replace(/(token(?:%3D|=))[-_A-Za-z0-9]+/g, "$1[redacted]");
if (!roomId || !email || !password || !existsSync(chromePath)) throw new Error("ACCEPTANCE_ROOM_ID, ACCEPTANCE_EMAIL, ACCEPTANCE_PASSWORD and Chrome are required");
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
async function cdpJson(url) { for (let i = 0; i < 100; i += 1) { try { const response = await fetch(url); if (response.ok) return response.json(); } catch {} await sleep(100); } throw new Error(`CDP not ready: ${url}`); }

class Cdp {
  constructor(socket) { this.socket = socket; this.id = 0; this.pending = new Map(); this.exceptions = []; this.dialogs = []; }
  static async connect(url) {
    const socket = new WebSocket(url); const client = new Cdp(socket);
    await new Promise((resolveOpen, reject) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data.toString());
      if (data.method === "Runtime.exceptionThrown") client.exceptions.push(data.params.exceptionDetails.text || "runtime exception");
      if (data.method === "Page.javascriptDialogOpening") { client.dialogs.push(data.params.message); void client.send("Page.handleJavaScriptDialog", { accept: true }); }
      const pending = client.pending.get(data.id); if (!pending) return; client.pending.delete(data.id); data.error ? pending.reject(new Error(JSON.stringify(data.error))) : pending.resolve(data.result);
    });
    return client;
  }
  send(method, params = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolveSend, reject) => this.pending.set(id, { resolve: resolveSend, reject })); }
  close() { this.socket.close(); }
}

class Browser {
  constructor(name, port) { this.name = name; this.port = port; }
  async start() {
    const profile = join(root, ".runtime", `chrome-result-share-${this.name}-${Date.now()}`);
    this.chrome = spawn(chromePath, [`--remote-debugging-port=${this.port}`, "--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
    await cdpJson(`http://127.0.0.1:${this.port}/json/version`);
    const page = (await cdpJson(`http://127.0.0.1:${this.port}/json/list`)).find((entry) => entry.type === "page");
    this.cdp = await Cdp.connect(page.webSocketDebuggerUrl); await this.cdp.send("Page.enable"); await this.cdp.send("Runtime.enable");
    await this.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1040, deviceScaleFactor: 1, mobile: false });
  }
  async eval(expression) { const result = await this.cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw new Error(`${this.name}: ${result.exceptionDetails.text}`); return result.result?.value; }
  async wait(expression, label, timeout = 45_000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await this.eval(expression)) return; await sleep(120); } throw new Error(`${this.name}: timed out waiting for ${label}: ${JSON.stringify(await this.eval("({href:location.href,text:document.body.innerText.slice(0,1000)})"))}`); }
  async navigate(pathOrUrl) { await this.cdp.send("Page.navigate", { url: new URL(pathOrUrl, webBase).href }); }
  async click(selector, label) { const clicked = await this.eval(`(() => { const node=document.querySelector(${JSON.stringify(selector)});if(!node||node.disabled)return false;node.click();return true;})()`); if (!clicked) throw new Error(`${this.name}: cannot click ${label}`); }
  async screenshot(name) { const image = await this.cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }); await writeFile(join(evidenceDir, name), Buffer.from(image.data, "base64")); }
  async login(returnTo) {
    await this.navigate(`/auth?mode=login&reauth=1&returnTo=${encodeURIComponent(returnTo)}`); await this.wait("Boolean(document.querySelector('[data-auth-form]'))", "login form");
    await this.eval(`(() => {const set=(name,value)=>{const input=document.querySelector('[name="'+name+'"]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};set('email',${JSON.stringify(email)});set('password',${JSON.stringify(password)});document.querySelector('[data-auth-form]').requestSubmit();return true;})()`);
    await this.wait(`location.pathname === ${JSON.stringify(new URL(returnTo, webBase).pathname)}`, "authenticated return", 60_000);
  }
  stop() { this.cdp?.close(); this.chrome?.kill(); }
}

const prisma = new PrismaClient();
const host = new Browser("creator", 9461); const viewer = new Browser("signed-out-viewer", 9462);
const report = { status: "RUNNING", roomId, creator: email, startedAt: new Date().toISOString(), socialTargets: [] };
try {
  await mkdir(evidenceDir, { recursive: true }); await Promise.all([host.start(), viewer.start()]);
  await host.login(`/game/result?runId=${roomId}`);
  await host.wait("Boolean(document.querySelector('[data-action=\"share-recap\"]:not([disabled])'))", "hydrated Share Recap");
  await host.eval("window.__resultTargets=[];window.open=(url)=>{window.__resultTargets.push(String(url));return {};};Object.defineProperty(navigator,'share',{configurable:true,value:async(data)=>{window.__nativeResult=data;}});");
  await host.click('[data-action="share-recap"]', "Share Recap"); await host.click('[data-result-share-form] button[type="submit"]', "Create secure link");
  await host.wait("Boolean(document.querySelector('[data-result-share-output]:not([hidden]) input'))", "secure link and poster", 60_000);
  await host.screenshot("result-share-modal.png");
  const first = await host.eval("({url:document.querySelector('[data-result-share-output] input').value,poster:document.querySelector('.result-poster img').src})");
  for (const [index, channel] of ["WHATSAPP", "TELEGRAM", "FACEBOOK", "X"].entries()) { await host.click(`[data-result-channel="${channel}"]`, channel); await host.wait(`window.__resultTargets.length >= ${index + 1}`, `${channel} target`); }
  await host.click("[data-result-native]", "native sharing"); await host.wait("Boolean(window.__nativeResult)", "native share payload");
  const socialTargets = await host.eval("({external:window.__resultTargets,native:window.__nativeResult})");
  report.socialTargets = { external: socialTargets.external.map(redactShareToken), native: { ...socialTargets.native, url: redactShareToken(socialTargets.native.url) } }; report.poster = first.poster.startsWith("data:image/png");
  await viewer.navigate(first.url); await viewer.wait("Boolean(document.querySelector('[data-public-result] h1'))", "signed-out public recap", 60_000); await viewer.screenshot("public-result.png");
  const publicText = await viewer.eval("document.querySelector('[data-public-result]').innerText");
  report.publicView = { url: first.url.replace(/token=.*/, "token=[redacted]"), rendered: true, leakedEmail: publicText.includes(email), leakedPrivateGoal: publicText.includes("稳住浙江并避免皇帝认定你欺瞒") };
  if (report.publicView.leakedEmail || report.publicView.leakedPrivateGoal) throw new Error("Public recap leaked private data");
  await host.click("[data-revoke-result]", "Revoke this link"); await host.wait("document.body.innerText.includes('Result link revoked')", "revocation confirmation", 30_000);
  await viewer.navigate(first.url); await viewer.wait("document.body.innerText.includes('This link is unavailable')", "revoked public link", 30_000); await viewer.screenshot("revoked-result.png"); report.revoked = true;

  await host.navigate(`/game/result?runId=${roomId}`); await host.wait("Boolean(document.querySelector('[data-action=\"share-recap\"]:not([disabled])'))", "hydrated Share Recap again"); await host.click('[data-action="share-recap"]', "Share Recap again"); await host.click('[data-result-share-form] button[type="submit"]', "Create expiry link"); await host.wait("Boolean(document.querySelector('[data-result-share-output]:not([hidden]) input'))", "expiry link");
  const expiringUrl = await host.eval("document.querySelector('[data-result-share-output] input').value"); const token = new URL(expiringUrl).searchParams.get("token"); const tokenHash = createHash("sha256").update(token).digest("hex");
  await prisma.shareToken.update({ where: { tokenHash }, data: { expiresAt: new Date(Date.now() - 60_000) } });
  await viewer.navigate(expiringUrl); await viewer.wait("document.body.innerText.includes('This link is unavailable')", "expired public link", 30_000); await viewer.screenshot("expired-result.png"); report.expired = true;
  const rows = await prisma.shareToken.findMany({ where: { runId: roomId, scene: "result" }, select: { id: true, token: true, tokenHash: true, revokedAt: true, expiresAt: true } });
  const prior = JSON.parse(await readFile(join(evidenceDir, "result.json"), "utf8"));
  const creator = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const referrals = await prisma.referral.findMany({ where: { inviterUserId: creator.id }, select: { status: true, rewardedAt: true, referredUserId: true } });
  if (prior.rounds?.length !== 7 || prior.invitation?.rewards?.rewardedCount !== 2 || referrals.filter((row) => row.status === "REWARDED").length !== 2) throw new Error("Invitation or seven-round acceptance checkpoint is incomplete");
  if (rows.some((row) => row.token !== null || !/^[a-f0-9]{64}$/.test(row.tokenHash || ""))) throw new Error("Raw public token was stored");
  if (host.cdp.exceptions.length || viewer.cdp.exceptions.length) throw new Error(`Runtime exceptions: ${JSON.stringify({ host: host.cdp.exceptions, viewer: viewer.cdp.exceptions })}`);
  report.invitation = prior.invitation; report.rounds = prior.rounds; report.players = prior.players;
  report.database = { secureShares: rows, referrals }; report.runtimeExceptions = { host: [], viewer: [] }; report.status = "PASS"; report.completedAt = new Date().toISOString();
  await writeFile(join(evidenceDir, "result-share-result.json"), `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify({ status: report.status, revoked: report.revoked, expired: report.expired, evidence: join(evidenceDir, "result-share-result.json") }));
} catch (error) {
  report.status = "FAIL"; report.error = error instanceof Error ? error.stack : String(error); report.completedAt = new Date().toISOString(); await writeFile(join(evidenceDir, "result-share-result.json"), `${JSON.stringify(report, null, 2)}\n`); throw error;
} finally { await prisma.$disconnect(); host.stop(); viewer.stop(); }
