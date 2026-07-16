import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const root = resolve(".");
const webBase = (process.env.MANY_WORLDS_WEB_BASE || "http://127.0.0.1:5278").replace(/\/$/, "");
const mailSink = process.env.AUTH_MAIL_SINK_FILE || "D:\\tmp\\aistory-invite-result-mail.ndjson";
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const resultDir = join(root, "docs", "auto-execute", "evidence", "functional-closure", "invite-result-browser");
const prisma = new PrismaClient();
if (!existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
async function json(url) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try { const response = await fetch(url); if (response.ok) return response.json(); } catch {}
    await sleep(125);
  }
  throw new Error(`CDP not ready: ${url}`);
}
async function verificationUrl(email) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const rows = (await readFile(mailSink, "utf8")).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      const message = rows.reverse().find((row) => row.to === email && /verify/i.test(row.subject || ""));
      const url = message?.text?.match(/https?:\/\/[^\s]+/)?.[0];
      if (url) return url;
    } catch {}
    await sleep(150);
  }
  throw new Error(`Verification email not delivered for ${email}`);
}

class Cdp {
  constructor(socket) { this.socket = socket; this.id = 0; this.pending = new Map(); this.exceptions = []; }
  static async connect(url) {
    const socket = new WebSocket(url); const cdp = new Cdp(socket);
    await new Promise((resolveOpen, reject) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data.toString());
      if (data.method === "Runtime.exceptionThrown") cdp.exceptions.push(data.params.exceptionDetails.text || "runtime exception");
      const pending = cdp.pending.get(data.id); if (!pending) return;
      cdp.pending.delete(data.id); data.error ? pending.reject(new Error(JSON.stringify(data.error))) : pending.resolve(data.result);
    });
    return cdp;
  }
  send(method, params = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolveSend, reject) => this.pending.set(id, { resolve: resolveSend, reject })); }
  close() { this.socket.close(); }
}

class BrowserUser {
  constructor(name, port) { this.name = name; this.port = port; }
  async start() {
    const profile = join(root, ".runtime", `chrome-invite-result-${this.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    this.chrome = spawn(chromePath, [`--remote-debugging-port=${this.port}`, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
    await json(`http://127.0.0.1:${this.port}/json/version`);
    const page = (await json(`http://127.0.0.1:${this.port}/json/list`)).find((item) => item.type === "page");
    this.cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await this.cdp.send("Page.enable"); await this.cdp.send("Runtime.enable");
    await this.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1040, deviceScaleFactor: 1, mobile: false });
  }
  async evaluate(expression) {
    const result = await this.cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(`${this.name}: browser expression failed: ${result.exceptionDetails.text || "unknown"}`);
    return result.result?.value;
  }
  async wait(expression, label, timeout = 45_000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await this.evaluate(expression)) return; await sleep(150); }
    const diagnostic = await this.evaluate("({href:location.href,text:document.body?.innerText?.slice(0,1200)})").catch(() => null);
    throw new Error(`${this.name}: timed out waiting for ${label}: ${JSON.stringify(diagnostic)}`);
  }
  async click(selector, label) {
    const clicked = await this.evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); if(!node||node.disabled)return false; node.click(); return true; })()`);
    if (!clicked) throw new Error(`${this.name}: unable to click ${label}`);
  }
  async navigate(urlOrPath) { await this.cdp.send("Page.navigate", { url: new URL(urlOrPath, webBase).href }); }
  async reload() { await this.cdp.send("Page.reload", { ignoreCache: true }); }
  async screenshot(name) { const shot = await this.cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }); await writeFile(join(resultDir, name), Buffer.from(shot.data, "base64")); }
  async signup(index, stamp, returnTo, alreadyOnAuth = false) {
    const email = `mw-closure-${stamp}-p${index}@example.test`;
    if (!alreadyOnAuth) await this.navigate(`/auth?returnTo=${encodeURIComponent(returnTo)}`);
    await this.wait("Boolean(document.querySelector('[data-auth-form]'))", "auth form");
    await this.click('[data-auth-tab="signup"]', "Sign up");
    await this.evaluate(`(() => { const set=(name,value)=>{const field=document.querySelector('[name="'+name+'"]');field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));}; set('email',${JSON.stringify(email)});set('password','ClosureBrowser2026!');set('nickname',${JSON.stringify(`Closure user ${index}`)});document.querySelector('[data-auth-form]').requestSubmit();return true;})()`);
    await this.wait("document.body.innerText.includes('Account created')", "registration confirmation");
    const url = await verificationUrl(email);
    await this.navigate(url);
    const target = new URL(returnTo, webBase).pathname;
    await this.wait(`location.pathname === ${JSON.stringify(target)} || /^\\/rooms\\//.test(location.pathname)`, "verified session and return route", 60_000);
    await this.evaluate(`fetch('/api/v4/credits/onboarding',{method:'POST',headers:{'content-type':'application/json'},credentials:'include',body:'{}'}).then(r=>r.json())`);
    return email;
  }
  async submit(round) {
    await this.wait("Boolean(document.querySelector('[data-action-form]'))", `round ${round} action form`, 75_000);
    await this.wait("Boolean(document.querySelector('[data-action-form] button:not([disabled])'))", `round ${round} submit enabled`, 75_000);
    await this.evaluate(`(() => { const form=document.querySelector('[data-action-form]'); form.querySelector('[name=method]').value=${JSON.stringify(`Verified browser action by ${this.name} in round ${round}.`)}; form.querySelector('[name=intent]').value=${JSON.stringify(`A shared consequence from ${this.name} in round ${round}.`)}; form.requestSubmit(); return true; })()`);
    await this.wait("Boolean(document.querySelector('[data-action-form] button[disabled]'))", `round ${round} acknowledged`, 75_000);
  }
  async stop() { this.cdp?.close(); this.chrome?.kill(); }
}

const stamp = Date.now();
const users = [new BrowserUser("host", 9451), new BrowserUser("invitee1", 9452), new BrowserUser("invitee2", 9453), new BrowserUser("public", 9454)];
const result = { status: "RUNNING", startedAt: new Date().toISOString(), browsers: users.map((user) => user.name), invitation: {}, resultShare: {}, rounds: [] };
try {
  await mkdir(resultDir, { recursive: true });
  await Promise.all(users.map((user) => user.start()));
  const [host, invitee1, invitee2, publicViewer] = users;
  result.players = [await host.signup(1, stamp, "/rooms?worldId=sangtian")];
  await host.wait("Boolean(document.querySelector('[data-action=\"create-room\"]'))", "create room button");
  await host.click('[data-action="create-room"]', "create room");
  await host.wait("/^\\/rooms\\/c/.test(location.pathname)", "created room", 60_000);
  await host.wait("Boolean(document.querySelector('[data-role-id]'))", "role list");
  const room = await host.evaluate("({id:location.pathname.split('/').pop(),code:document.querySelector('.invite strong')?.textContent.trim()})");
  result.room = room;
  await host.click("[data-role-id]", "host role");
  await host.wait("Boolean(document.querySelector('.select-role.selected'))", "host role lock");

  await host.evaluate(`(() => { window.__targets=[]; window.open=(url)=>{window.__targets.push(String(url));return {};}; window.__native=[]; Object.defineProperty(navigator,'share',{configurable:true,value:async(data)=>{window.__native.push(data);}}); Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{window.__copied=String(text);}}}); return true; })()`);
  await host.click('[data-action="share-invite"]', "open invitation share");
  await host.wait("Boolean(document.querySelector('.share-dialog[open] [data-poster-preview][src^=\"blob:\"]'))", "QR poster preview", 60_000);
  await host.screenshot("invite-share-modal.png");
  const inviteUrl = await host.evaluate("document.querySelector('.share-dialog[open] .share-link-label input')?.value");
  if (!inviteUrl?.includes(`/join?room=${room.code}`)) throw new Error(`Invitation URL missing room code: ${inviteUrl}`);
  for (const [index, channel] of ["WHATSAPP", "TELEGRAM", "DISCORD", "FACEBOOK", "X"].entries()) {
    await host.click(`[data-share-channel="${channel}"]`, channel);
    await host.wait(`window.__targets.length >= ${index + 1}`, `${channel} handoff`);
  }
  await host.click("[data-native-share]", "native share");
  await host.wait("window.__native.length === 1", "native share handoff");
  const platformHandoffs = await host.evaluate("({targets:window.__targets,native:window.__native,copied:window.__copied})");
  const expectedHosts = ["wa.me", "t.me", "discord.com", "facebook.com", "x.com"];
  for (const expected of expectedHosts) if (!platformHandoffs.targets.some((url) => url.includes(expected))) throw new Error(`Missing ${expected} handoff: ${JSON.stringify(platformHandoffs)}`);
  result.invitation = { inviteUrl, qrPoster: true, platformHandoffs };

  for (const [index, invitee] of [invitee1, invitee2].entries()) {
    await invitee.navigate(inviteUrl);
    await invitee.wait("location.pathname === '/auth'", "invite authentication redirect");
    const authReturn = new URLSearchParams(await invitee.evaluate("location.search")).get("returnTo");
    if (!authReturn?.startsWith("/join?")) throw new Error(`Invite returnTo lost: ${authReturn}`);
    result.players.push(await invitee.signup(index + 2, stamp, authReturn, true));
    await invitee.wait(`location.pathname === ${JSON.stringify(`/rooms/${room.id}`)}`, "joined shared room", 60_000);
    await invitee.wait("Boolean(document.querySelector('[data-role-id]:not([disabled])'))", "available role");
    await invitee.click("[data-role-id]:not([disabled])", "invitee role");
    await invitee.wait("Boolean(document.querySelector('.select-role.selected'))", "invitee role lock");
  }
  for (const user of [host, invitee1, invitee2]) { await user.click('[data-action="ready"]', "ready"); await sleep(700); }
  await host.reload();
  await host.wait("document.querySelectorAll('.ready-badge:not(.off)').length === 3", "all ready");
  await host.click('[data-action="start-game"]', "start game");
  await host.wait("location.pathname === '/room-game'", "host game");
  for (const invitee of [invitee1, invitee2]) { await invitee.wait("Boolean(document.querySelector('a[href^=\"/room-game?runId=\"]'))", "game link"); await invitee.click('a[href^="/room-game?runId="]', "continue game"); await invitee.wait("location.pathname === '/room-game'", "game route"); }

  for (let round = 1; round <= 7; round += 1) {
    if (round === 4) {
      await host.wait("Boolean(document.querySelector('[data-unlock-room]'))", "credit unlock gate", 60_000);
      await host.click("[data-unlock-room]", "unlock shared room with earned credits");
      await host.wait("Boolean(document.querySelector('[data-action-form]'))", "unlocked host form", 60_000);
      for (const invitee of [invitee1, invitee2]) { await invitee.reload(); await invitee.wait("Boolean(document.querySelector('[data-action-form]'))", "shared unlock", 60_000); }
    }
    for (const user of [host, invitee1, invitee2]) {
      await user.submit(round);
      await sleep(500);
    }
    await host.wait("Boolean(document.querySelector('[data-resolve]:not([disabled])'))", `round ${round} resolvable`);
    await host.click("[data-resolve]", `resolve round ${round}`);
    if (round < 7) {
      await host.wait(`document.body.innerText.includes('Round ${round + 1} of 7')`, `round ${round + 1}`, 180_000);
      for (const invitee of [invitee1, invitee2]) { await invitee.reload(); await invitee.wait(`document.body.innerText.includes('Round ${round + 1} of 7')`, `round ${round + 1}`, 75_000); }
    } else await host.wait("document.body.innerText.includes('Session complete')", "seven rounds complete", 180_000);
    result.rounds.push({ round, actionSubmitters: 3, resolvedBy: "host" });
  }

  const referral = await host.evaluate("fetch('/api/v4/referrals/me',{credentials:'include'}).then(async r=>({status:r.status,body:await r.json()}))");
  if (referral.status !== 200 || referral.body.rewardedCount !== 2 || referral.body.remainingRewardSlots !== 0) throw new Error(`Referral rewards not closed: ${JSON.stringify(referral)}`);
  result.invitation.rewards = referral.body;
  await host.click('a[href^="/game/result?runId="]', "view result");
  await host.wait("location.pathname === '/game/result'", "result page");
  await host.wait("document.querySelector('.result-title')?.textContent !== 'A Republic Without a Master'", "hydrated result", 60_000);
  await host.wait("Boolean(document.querySelector('[data-action=\"share-recap\"]'))", "Share Recap button", 30_000);
  await host.click('[data-action="share-recap"]', "Share Recap");
  await host.wait("Boolean(document.querySelector('[data-result-share-form]'))", "secure share form");
  await host.click('[data-result-share-form] button[type="submit"]', "create secure share");
  await host.wait("Boolean(document.querySelector('[data-result-share-output]:not([hidden]) input'))", "secure share output");
  await host.screenshot("result-share-modal.png");
  const share = await host.evaluate("({url:document.querySelector('[data-result-share-output] input').value,poster:document.querySelector('.result-poster img')?.src,buttons:[...document.querySelectorAll('[data-result-channel]')].map(n=>n.dataset.resultChannel)})");
  if (!share.url.includes("/shared/result?token=") || !share.poster.startsWith("data:image/png")) throw new Error(`Invalid secure share output: ${JSON.stringify(share)}`);
  result.resultShare.created = share;
  await publicViewer.navigate(share.url);
  await publicViewer.wait("Boolean(document.querySelector('[data-public-result] h1'))", "public recap", 60_000);
  await publicViewer.screenshot("public-result.png");
  const publicText = await publicViewer.evaluate("document.body.innerText");
  const forbidden = result.players.filter((email) => publicText.includes(email)).concat(["private goal", "hidden intent", "reasoning trace"].filter((value) => !publicText.toLowerCase().includes(value) ? false : !publicText.includes("were removed")));
  if (forbidden.length) throw new Error(`Public result leaked private values: ${forbidden.join(', ')}`);
  result.resultShare.publicViewer = { unauthenticated: true, rendered: true, privacyLeakChecks: { emails: false, privatePayload: false } };

  await host.evaluate("window.confirm=()=>true");
  await host.click("[data-revoke-result]", "revoke share");
  await publicViewer.reload();
  await publicViewer.wait("document.body.innerText.includes('This shared result is unavailable')", "revoked public link", 30_000);
  await publicViewer.screenshot("revoked-result.png");
  result.resultShare.revoked = true;

  await host.click('[data-action="share-recap"]', "create expiring share");
  await host.wait("Boolean(document.querySelector('[data-result-share-form]'))", "second secure share form");
  await host.click('[data-result-share-form] button[type="submit"]', "create second secure share");
  await host.wait("Boolean(document.querySelector('[data-result-share-output]:not([hidden]) input'))", "second secure share output");
  const expiringUrl = await host.evaluate("document.querySelector('[data-result-share-output] input').value");
  const expiringToken = new URL(expiringUrl).searchParams.get("token");
  const { createHash } = await import("node:crypto");
  await prisma.shareToken.update({ where: { tokenHash: createHash("sha256").update(expiringToken).digest("hex") }, data: { expiresAt: new Date(Date.now() - 60_000) } });
  await publicViewer.navigate(expiringUrl);
  await publicViewer.wait("document.body.innerText.includes('This shared result is unavailable')", "expired public link", 30_000);
  await publicViewer.screenshot("expired-result.png");
  result.resultShare.expired = true;

  const dbShares = await prisma.shareToken.findMany({ where: { runId: room.id, scene: "result" }, select: { id: true, token: true, tokenHash: true, revokedAt: true, expiresAt: true } });
  const dbReferrals = await prisma.referral.findMany({ where: { referrer: { email: result.players[0] } }, select: { status: true, rewardedAt: true, referred: { select: { email: true } } } });
  if (dbShares.some((item) => item.token !== null || !/^[a-f0-9]{64}$/.test(item.tokenHash || ""))) throw new Error("Raw result token was persisted");
  if (dbReferrals.filter((item) => item.status === "REWARDED").length !== 2) throw new Error(`Database referral rewards mismatch: ${JSON.stringify(dbReferrals)}`);
  const exceptions = Object.fromEntries(users.map((user) => [user.name, user.cdp.exceptions]));
  if (Object.values(exceptions).some((items) => items.length)) throw new Error(`Browser runtime exceptions: ${JSON.stringify(exceptions)}`);
  result.database = { secureShares: dbShares, referrals: dbReferrals };
  result.runtimeExceptions = exceptions;
  result.status = "PASS"; result.completedAt = new Date().toISOString();
  await writeFile(join(resultDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: result.status, roomId: room.id, rewardedInvites: 2, rounds: result.rounds.length, secureShares: dbShares.length, evidence: join(resultDir, "result.json") }));
} catch (error) {
  result.status = "FAIL"; result.error = error instanceof Error ? error.stack : String(error); result.completedAt = new Date().toISOString();
  await mkdir(resultDir, { recursive: true }); await writeFile(join(resultDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  throw error;
} finally {
  await prisma.$disconnect();
  await Promise.all(users.map((user) => user.stop()));
}
