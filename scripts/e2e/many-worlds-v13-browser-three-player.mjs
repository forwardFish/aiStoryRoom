import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const root = resolve(".");
const webBase = (process.env.MANY_WORLDS_WEB_BASE || "http://127.0.0.1:5178").replace(/\/$/, "");
const apiBase = (process.env.API_BASE || "http://127.0.0.1:3102/api").replace(/\/$/, "");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const resultDir = join(root, "docs", "auto-execute", "evidence", "many-worlds-v13", "browser-three-player-seven-round");
if (!existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function fetchWithTimeout(url, options = {}, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
const envSecret = (() => {
  try { return readFileSync(join(root, ".env"), "utf8").split(/\r?\n/).find((line) => line.startsWith("CREEM_WEBHOOK_SECRET="))?.slice("CREEM_WEBHOOK_SECRET=".length).trim(); }
  catch { return undefined; }
})();
const webhookSecret = process.env.CREEM_WEBHOOK_SECRET || envSecret || "local_world_credits_secret";
async function waitForJson(url) { for (let attempt = 0; attempt < 120; attempt += 1) { try { const response = await fetchWithTimeout(url, {}, 5_000); if (response.ok) return response.json(); } catch {} await sleep(150); } throw new Error(`CDP not ready: ${url}`); }
class Cdp {
  constructor(socket) { this.socket = socket; this.id = 0; this.pending = new Map(); this.exceptions = []; }
  static async connect(url) { const socket = new WebSocket(url); const cdp = new Cdp(socket); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); }); socket.addEventListener("message", (event) => { const data = JSON.parse(event.data.toString()); if (data.method === "Runtime.exceptionThrown") cdp.exceptions.push(data.params.exceptionDetails.text || "runtime exception"); const pending = cdp.pending.get(data.id); if (!pending) return; cdp.pending.delete(data.id); data.error ? pending.reject(new Error(JSON.stringify(data.error))) : pending.resolve(data.result); }); return cdp; }
  send(method, params = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  close() { this.socket.close(); }
}
class Player {
  constructor(name, port) { this.name = name; this.port = port; this.chrome = null; this.cdp = null; }
  async start() {
    this.chrome = spawn(chromePath, [`--remote-debugging-port=${this.port}`, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(root, ".runtime", `chrome-many-worlds-v13-${this.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)}`, "about:blank"], { stdio: "ignore" });
    await waitForJson(`http://127.0.0.1:${this.port}/json/version`);
    let page = (await waitForJson(`http://127.0.0.1:${this.port}/json/list`)).find((item) => item.type === "page");
    if (!page?.webSocketDebuggerUrl) page = await fetch(`http://127.0.0.1:${this.port}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
    this.cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await this.cdp.send("Page.enable"); await this.cdp.send("Runtime.enable");
    await this.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1586, height: 992, deviceScaleFactor: 1, mobile: false });
  }
  async evaluate(expression) { const result = await this.cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw new Error(`${this.name}: ${result.exceptionDetails.text || "browser expression failed"}`); return result.result?.value; }
  async wait(expression, label, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await this.evaluate(expression)) return; await sleep(150); } throw new Error(`${this.name}: timed out waiting for ${label}`); }
  async click(selector, label) { const clicked = await this.evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) return false; node.click(); return true; })()`); if (!clicked) throw new Error(`${this.name}: unable to click ${label}`); }
  async navigate(path) { await this.cdp.send("Page.navigate", { url: `${webBase}${path}` }); }
  async reload() { await this.cdp.send("Page.reload", { ignoreCache: true }); }
  async signup(index, stamp, returnTo = "/rooms?worldId=sangtian", fromCurrentPage = false) {
    const email = `mw-browser-${stamp}-p${index}@example.test`;
    if (!fromCurrentPage) await this.navigate(`/auth?returnTo=${encodeURIComponent(returnTo)}`);
    await this.wait("Boolean(document.querySelector('[data-auth-form]'))", "auth page");
    await this.click('[data-auth-tab="signup"]', "signup tab");
    await this.evaluate(`(() => { const set = (name, value) => { const field = document.querySelector('[name=' + name + ']'); field.value = value; field.dispatchEvent(new Event('input', { bubbles:true })); }; set('email', ${JSON.stringify(email)}); set('password', 'MvpBrowser2026!'); set('nickname', ${JSON.stringify(`Browser player ${index}`)}); document.querySelector('[data-auth-form]').requestSubmit(); return true; })()`);
    const returnPath = new URL(returnTo, webBase).pathname;
    const returned = returnPath === "/join" ? "/^\\/rooms\\//.test(location.pathname)" : `location.pathname === ${JSON.stringify(returnPath)}`;
    await this.wait(`(${returned}) && Boolean(localStorage.getItem('many-worlds-token'))`, "registration, verification, login and requested return route", 60000);
    return email;
  }
  async submit(round) {
    try { await this.wait("Boolean(document.querySelector('[data-action-form]'))", `round ${round} action form`); }
    catch (error) { const page = await this.evaluate("document.body.innerText.slice(0, 1800)").catch(() => "unable to read page"); const diagnostic = await this.evaluate(`(async () => { const id = new URLSearchParams(location.search).get('runId'); const token = localStorage.getItem('many-worlds-token'); const response = await fetch('/api/v4/rooms/' + encodeURIComponent(id || '') + '/game', { headers: { authorization: 'Bearer ' + token } }); return { href: location.href, runId: id, status: response.status, body: (await response.text()).slice(0, 800) }; })()`).catch(() => null); throw new Error(`${error.message}\n${this.name} page text: ${page}\n${JSON.stringify(diagnostic)}`); }
    await this.evaluate(`(() => {
      const form = document.querySelector('[data-action-form]');
      const method = form.querySelector('[name=method]');
      const intent = form.querySelector('[name=intent]');
      window.__manyWorldsSubmitEvents = [];
      if (!window.__manyWorldsOriginalFetch) {
        window.__manyWorldsOriginalFetch = window.fetch.bind(window);
        window.fetch = async (...args) => {
          const response = await window.__manyWorldsOriginalFetch(...args);
          if (String(args[0]).includes('/game/action')) window.__manyWorldsSubmitEvents.push({ url:String(args[0]), status:response.status, body:await response.clone().text() });
          return response;
        };
      }
      form.addEventListener('submit', () => window.__manyWorldsSubmitEvents.push({ type:'submit-event' }), { once:true });
      method.value = ${JSON.stringify(`Browser ${this.name} verifies concrete evidence in round ${round}.`)};
      intent.value = ${JSON.stringify(`Browser ${this.name} makes a shared choice that influences the other players in round ${round}.`)};
      method.dispatchEvent(new Event('input', {bubbles:true})); intent.dispatchEvent(new Event('input', {bubbles:true}));
      const valid = form.checkValidity();
      form.requestSubmit();
      return { valid, method:method.value, intent:intent.value };
    })()`);
    try { await this.wait("Boolean(document.querySelector('[data-action-form] button[disabled]'))", `round ${round} submitted state`); }
    catch (error) {
      const diagnostic = await this.evaluate(`(async () => {
        const id = new URLSearchParams(location.search).get('runId');
        const token = localStorage.getItem('many-worlds-token');
        const response = await fetch('/api/v4/rooms/' + encodeURIComponent(id || '') + '/game', { headers: { authorization: 'Bearer ' + token } });
        return {
          href: location.href,
          page: document.body.innerText.slice(0, 1400),
          buttonDisabled: document.querySelector('[data-action-form] button')?.disabled ?? null,
          submitEvents: window.__manyWorldsSubmitEvents || [],
          gameStatus: response.status,
          game: (await response.text()).slice(0, 1200)
        };
      })()`).catch(() => null);
      throw new Error(`${error.message}\n${this.name} submit diagnostic: ${JSON.stringify(diagnostic)}`);
    }
    await this.wait("!document.querySelector('[data-action-form][data-submit-pending]') && Boolean(document.querySelector('[data-action-form] button[disabled]'))", `round ${round} server acknowledgement`, 75_000);
  }
  async stop() { this.cdp?.close(); this.chrome?.kill(); }
}

async function completeMockCheckout(player, stamp) {
  const checkout = await player.evaluate(`(async () => { const purchaseId = new URLSearchParams(location.search).get('purchase_id'); const token = localStorage.getItem('many-worlds-token'); const response = await fetch('/api/v4/auth/me', { headers:{ authorization:'Bearer ' + token }, signal:AbortSignal.timeout(60000) }); return { purchaseId, user: await response.json() }; })()`);
  if (!checkout?.purchaseId || !checkout?.user?.id) throw new Error(`host: payment status has no usable checkout identity: ${JSON.stringify(checkout)}`);
  const event = {
    id: `evt_browser_checkout_${stamp}`,
    eventType: "checkout.completed",
    object: {
      id: `mock_checkout_many-worlds-${checkout.purchaseId}`,
      status: "completed",
      metadata: { userId: checkout.user.id, purchaseId: checkout.purchaseId, source: "browser-p0-closure" },
      product: { id: "prod_xkzSkuNeiQuP1QVNV6NbL" },
      order: { id: `ord_browser_checkout_${stamp}`, transaction: `tx_browser_checkout_${stamp}`, amount: 799, currency: "USD", status: "paid" },
      customer: { id: `cust_browser_${stamp}`, email: checkout.user.email || "browser@example.test" }
    }
  };
  const raw = JSON.stringify(event);
  const response = await fetchWithTimeout(`${apiBase}/v4/webhooks/creem`, { method:"POST", headers:{ "content-type":"application/json", "creem-signature":createHmac("sha256", webhookSecret).update(raw).digest("hex") }, body:raw });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.processed) throw new Error(`mock payment notification failed: ${response.status} ${JSON.stringify(payload)}`);
  return { purchaseId: checkout.purchaseId, webhook: payload };
}

const stamp = Date.now();
const players = [new Player("host", 9341), new Player("player2", 9342), new Player("player3", 9343)];
const rounds = [];
try {
  await mkdir(resultDir, { recursive: true });
  await Promise.all(players.map((player) => player.start()));
  const [host, player2, player3] = players;
  const emails = [await host.signup(1, stamp)];
  await host.wait("(() => { const node = document.querySelector('[data-action=create-room]'); return Boolean(node && typeof node.onclick === 'function'); })()", "create-room handler binding");
  await host.click('[data-action="create-room"]', "create Sangtian room");
  await host.wait("/^\\/rooms\\/c/.test(location.pathname)", "created room route", 60000);
  await host.wait("Boolean(document.querySelector('[data-role-id]'))", "host role list");
  const room = await host.evaluate("(() => ({ id: location.pathname.split('/').pop(), code: document.querySelector('.invite strong')?.textContent?.trim() }))()");
  if (!room?.code) throw new Error("host: room invite code was not rendered");
  await host.click('[data-role-id]', "host role selection and lock");
  await host.wait("Boolean(document.querySelector('.select-role.selected'))", "host role lock");
  // The host selects a real social channel. We capture the outgoing social
  // message only to deliver it to a fresh browser, as a recipient would.
  await host.evaluate("window.__manyWorldsShareTarget = ''; window.open = (url) => { window.__manyWorldsShareTarget = String(url); return null; };");
  await host.click('[data-action="share-invite"]', "open social invite");
  await host.wait("Boolean(document.querySelector('.share-dialog[open] [data-poster-preview][src^=\"blob:\"]'))", "generated invitation poster with real QR");
  await host.click('[data-share-channel="WHATSAPP"]', "send WhatsApp invitation");
  await host.wait("Boolean(window.__manyWorldsShareTarget)", "social application handoff");
  const socialTarget = await host.evaluate("window.__manyWorldsShareTarget");
  const socialMessage = new URL(socialTarget).searchParams.get("text") || "";
  const inviteUrl = socialMessage.match(/https?:\/\/\S+/)?.[0];
  if (!inviteUrl || !inviteUrl.includes("channel=WHATSAPP")) throw new Error(`host: social target did not contain WhatsApp invitation URL: ${socialTarget}`);
  await host.click('[data-close-share]', "close social invite");
  for (const [index, player] of [player2, player3].entries()) {
    await player.navigate(new URL(inviteUrl, webBase).pathname + new URL(inviteUrl, webBase).search);
    try { await player.wait("location.pathname === '/auth'", "invite recipient authentication redirect"); }
    catch (error) {
      const diagnostic = await player.evaluate("(() => ({ href:location.href, token:Boolean(localStorage.getItem('many-worlds-token')), text:document.body.innerText.slice(0,1400), html:document.documentElement.outerHTML.slice(0,1800) }))()").catch(() => null);
      throw new Error(`${error.message}\n${player.name} invite redirect diagnostic: ${JSON.stringify(diagnostic)}`);
    }
    emails.push(await player.signup(index + 2, stamp, new URL(inviteUrl, webBase).pathname + new URL(inviteUrl, webBase).search, true));
    await player.wait(`location.pathname === ${JSON.stringify(`/rooms/${room.id}`)}`, "joined room route");
    await player.wait("Boolean(document.querySelector('[data-role-id]:not([disabled])'))", "available role");
    await player.click('[data-role-id]:not([disabled])', "player role selection");
    await player.wait("Boolean(document.querySelector('.select-role.selected'))", "selected role persistence");
  }
  // Ready is an optimistic-concurrency write.  Deliberately exercise it through
  // three browsers, but serialize the clicks so an intentional state-conflict
  // response cannot be mistaken for a successful UI transition.
  for (const player of players) {
    await player.click('[data-action="ready"]', "ready");
    await player.wait("document.body.innerText.includes('Ready')", "ready state");
  }
  await host.reload();
  await host.wait("document.querySelectorAll('.ready-badge:not(.off)').length === 3", "all three persisted ready states");
  await host.click('[data-action="start-game"]', "start game");
  await host.wait("location.pathname === '/room-game'", "host game route");
  await sleep(500);
  if (await host.evaluate("document.body.innerText.trim() === 'Not found'")) await host.navigate(`/room-game?runId=${encodeURIComponent(room.id)}`);
  for (const player of [player2, player3]) {
    await player.wait("Boolean(document.querySelector('a[href^=\"/room-game?runId=\"]'))", "continue game link", 40000);
    await player.click('a[href^="/room-game?runId="]', "continue game");
    await sleep(500);
    // CDP click occasionally races an in-flight lobby polling render.  It is
    // still a browser navigation (never an API shortcut); retry the exact UI
    // link target only when that race produced the server's plain 404 body.
    if (await player.evaluate("document.body.innerText.trim() === 'Not found'")) await player.navigate(`/room-game?runId=${encodeURIComponent(room.id)}`);
    await player.wait("location.pathname === '/room-game'", "player game route");
  }
  for (let round = 1; round <= 7; round += 1) {
    console.log(`three-player acceptance: entering round ${round}`);
    if (round === 4) {
      await host.wait("Boolean(document.querySelector('.room-unlock-modal[open] a[href^=\"/credits?intent=WORLD_UNLOCK\"]'))", "shared-room insufficient-credit unlock gate");
      const gate = await host.evaluate("(() => ({ text:document.querySelector('[data-unlock-gate]')?.innerText || '', available:document.body.innerText.includes('Your available balance') }))()");
      if (!gate.available) throw new Error(`host: unlock gate lacks balance disclosure: ${JSON.stringify(gate)}`);
      await host.click('.room-unlock-modal a[href^="/credits?intent=WORLD_UNLOCK"]', "open contextual World Credits page");
      await host.wait("location.pathname === '/credits' && Boolean(document.querySelector('[data-pack=credits_300]'))", "payment pack page");
      await host.click('[data-pack="credits_300"]', "choose 300 credit pack");
      try {
        await host.wait("Boolean(document.querySelector('[data-confirm-state]:not([hidden])'))", "same-page purchase confirmation");
      } catch (error) {
        const diagnostic = await host.evaluate(`(() => ({ href:location.href, walletHidden:document.querySelector('[data-wallet-state]')?.hidden, confirmHidden:document.querySelector('[data-confirm-state]')?.hidden, selectedPack:new URLSearchParams(location.search).get('confirm'), text:document.body.innerText.slice(0,1200) }))()`);
        throw new Error(`${error.message}\nPAY-03 diagnostic: ${JSON.stringify(diagnostic)}`);
      }
      await host.click('[data-confirm-purchase]', "confirm purchase and redirect to checkout");
      await host.wait("location.pathname === '/credits/status' && Boolean(new URLSearchParams(location.search).get('purchase_id'))", "payment processing return page");
      const payment = await completeMockCheckout(host, stamp);
      await host.wait("document.body.innerText.includes('Your room is unlocked')", "paid status auto-unlocks room", 30000);
      await host.click('[data-status-actions] a[href^="/room-game?runId="]', "return to unlocked room");
      await host.wait("location.pathname === '/room-game' && Boolean(document.querySelector('[data-action-form]'))", "unlocked action form");
      await host.wait("Boolean(document.querySelector('[data-action-form]'))", "unlocked action form");
      await Promise.all([player2, player3].map(async (player) => { await player.reload(); await player.wait("Boolean(document.querySelector('[data-action-form]'))", "shared unlocked action form", 30000); }));
      rounds.push({ payment, freeRounds: 3, unlockedAtRound: 4, chargedOnce: 100 });
    }
    await Promise.all(players.map((player) => player.submit(round)));
    console.log(`three-player acceptance: actions acknowledged for round ${round}`);
    await host.wait("Boolean(document.querySelector('[data-resolve]:not([disabled])'))", `round ${round} resolve enabled`);
    await host.click('[data-resolve]', `resolve round ${round}`);
    console.log(`three-player acceptance: resolution requested for round ${round}`);
    if (round < 7) {
      await host.wait(`document.body.innerText.includes('Round ${round + 1} of 7')`, `round ${round + 1} host state`, 180000);
      console.log(`three-player acceptance: round ${round + 1} host state reached`);
      await Promise.all([player2, player3].map(async (player) => {
        await player.reload();
        try { await player.wait(`document.body.innerText.includes('Round ${round + 1} of 7')`, `round ${round + 1} reload`, 75_000); }
        catch (error) {
          const diagnostic = await player.evaluate(`(async () => {
            const id = new URLSearchParams(location.search).get('runId');
            const token = localStorage.getItem('many-worlds-token');
            const response = await fetch('/api/v4/rooms/' + encodeURIComponent(id || '') + '/game', { headers: { authorization: 'Bearer ' + token } });
            return { href:location.href, text:document.body.innerText.slice(0,1400), gameStatus:response.status, game:(await response.text()).slice(0,1200) };
          })()`).catch(() => null);
          throw new Error(`${error.message}\\n${player.name} reload diagnostic: ${JSON.stringify(diagnostic)}`);
        }
      }));
    } else {
      await host.wait("document.body.innerText.includes('Session complete')", "completed session", 180000);
    }
    rounds.push({ round, resolvedBy: "host", actionSubmitters: 3 });
  }
  await host.click('a[href^="/game/result?runId="]', "view result");
  await host.wait("location.pathname === '/game/result'", "result page");
  await host.wait("document.querySelector('.result-run h1')?.textContent?.includes('嘉靖') && document.querySelector('.result-title')?.textContent !== 'A Republic Without a Master'", "hydrated Sangtian chapter result", 60000);
  const screenshot = await host.cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(join(resultDir, "host-result.png"), Buffer.from(screenshot.data, "base64"));
  const state = await host.evaluate("(() => ({ path: location.pathname, title: document.querySelector('.result-title')?.textContent?.trim(), text: document.body.innerText.slice(0, 1800) }))()");
  const exceptions = Object.fromEntries(players.map((player) => [player.name, player.cdp.exceptions]));
  if (Object.values(exceptions).some((items) => items.length)) throw new Error(`runtime exceptions: ${JSON.stringify(exceptions)}`);
  const paymentEvidence = rounds.find((item) => item.payment)?.payment;
  const result = { status: "PASS", story: "sangtian", roomId: room.id, players: emails.map((email, index) => ({ browser: players[index].name, email })), invitation: { channel: "WHATSAPP", roomCode: room.code, deliveredToNewUsers: 2 }, unlock: { paymentEvidence, freeRounds: 3, unlockedAtRound: 4, chargedOnce: 100 }, rounds: rounds.filter((item) => item.round), finalState: state, runtimeExceptions: exceptions, screenshot: "host-result.png", completedAt: new Date().toISOString() };
  await writeFile(join(resultDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: result.status, roomId: room.id, rounds: result.rounds.length, report: "docs/auto-execute/evidence/many-worlds-v13/browser-three-player-seven-round/result.json" }));
} finally {
  await Promise.all(players.map((player) => player.stop()));
}
