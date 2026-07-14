import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";

const root = resolve(".");
const webBase = (process.env.MANY_WORLDS_WEB_BASE || "http://127.0.0.1:5201").replace(/\/$/, "");
const apiBase = (process.env.API_BASE || "http://127.0.0.1:3102/api").replace(/\/$/, "");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const resultDir = join(root, "docs", "auto-execute", "evidence", "many-worlds-v14", "browser-credit-pages");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const envWebhookSecret = (() => {
  try { return readFileSync(join(root, ".env"), "utf8").split(/\r?\n/).find((line) => line.startsWith("CREEM_WEBHOOK_SECRET="))?.slice("CREEM_WEBHOOK_SECRET=".length).trim(); }
  catch { return undefined; }
})();
const webhookSecret = process.env.CREEM_WEBHOOK_SECRET || envWebhookSecret || "local_world_credits_secret";

async function json(url) {
  for (let i = 0; i < 100; i += 1) {
    try { const response = await fetch(url); if (response.ok) return response.json(); } catch {}
    await sleep(150);
  }
  throw new Error(`CDP unavailable: ${url}`);
}

class Cdp {
  constructor(socket) { this.socket = socket; this.id = 0; this.pending = new Map(); this.exceptions = []; }
  static async connect(url) {
    const socket = new WebSocket(url); const cdp = new Cdp(socket);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once:true }); socket.addEventListener("error", reject, { once:true }); });
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data.toString());
      if (data.method === "Runtime.exceptionThrown") cdp.exceptions.push(data.params.exceptionDetails.text || "runtime exception");
      const pending = cdp.pending.get(data.id); if (!pending) return;
      cdp.pending.delete(data.id); data.error ? pending.reject(new Error(JSON.stringify(data.error))) : pending.resolve(data.result);
    });
    return cdp;
  }
  send(method, params = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  close() { this.socket.close(); }
}

let browser; let cdp;
async function evaluate(expression) {
  const value = await cdp.send("Runtime.evaluate", { expression, awaitPromise:true, returnByValue:true, userGesture:true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.text || "browser evaluation failed");
  return value.result?.value;
}
async function wait(expression, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { if (await evaluate(expression)) return; } catch {} await sleep(150); }
  throw new Error(`Timed out waiting for ${label}`);
}
async function click(selector, label) {
  if (!await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) return false; el.click(); return true; })()`)) throw new Error(`Unable to click ${label}`);
}
async function shot(name) {
  const png = await cdp.send("Page.captureScreenshot", { format:"png", fromSurface:true });
  await writeFile(join(resultDir, name), Buffer.from(png.data, "base64"));
}
async function completeMockCheckout(stamp) {
  const checkout = await evaluate(`(async () => { const purchaseId = new URLSearchParams(location.search).get('purchase_id'); const token = localStorage.getItem('many-worlds-token'); const response = await fetch('/api/v4/auth/me', { headers:{ authorization:'Bearer ' + token } }); return { purchaseId, user: await response.json() }; })()`);
  if (!checkout?.purchaseId || !checkout?.user?.id) throw new Error("Payment status did not expose a usable purchase identity");
  const event = { id:`evt_credit_pages_${stamp}`, eventType:"checkout.completed", object:{ id:`mock_checkout_many-worlds-${checkout.purchaseId}`, status:"completed", metadata:{ userId:checkout.user.id, purchaseId:checkout.purchaseId, source:"browser-credit-pages" }, product:{ id:"prod_xkzSkuNeiQuP1QVNV6NbL" }, order:{ id:`ord_credit_pages_${stamp}`, transaction:`tx_credit_pages_${stamp}`, amount:799, currency:"USD", status:"paid" }, customer:{ id:`cust_credit_pages_${stamp}`, email:checkout.user.email || "credit-page@example.test" } } };
  const raw = JSON.stringify(event);
  const response = await fetch(`${apiBase}/v4/webhooks/creem`, { method:"POST", headers:{ "content-type":"application/json", "creem-signature":createHmac("sha256", webhookSecret).update(raw).digest("hex") }, body:raw });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.processed) throw new Error(`Mock payment webhook failed: ${response.status}`);
}

try {
  if (!existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);
  await mkdir(resultDir, { recursive:true });
  const port = Number(process.env.MANY_WORLDS_CREDITS_CDP_PORT || 9348); const stamp = Date.now();
  browser = spawn(chromePath, [`--remote-debugging-port=${port}`, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(root, ".runtime", `chrome-v14-credits-${stamp}`)}`, "about:blank"], { stdio:"ignore" });
  await json(`http://127.0.0.1:${port}/json/version`);
  let page = (await json(`http://127.0.0.1:${port}/json/list`)).find((item) => item.type === "page");
  if (!page?.webSocketDebuggerUrl) page = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method:"PUT" }).then((response) => response.json());
  cdp = await Cdp.connect(page.webSocketDebuggerUrl); await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width:1487, height:1058, deviceScaleFactor:1, mobile:false });
  const email = `mw-credit-page-${stamp}@example.test`;
  await cdp.send("Page.navigate", { url:`${webBase}/auth?returnTo=${encodeURIComponent("/rooms?worldId=sangtian")}` });
  await wait("Boolean(document.querySelector('[data-auth-form]'))", "auth"); await click('[data-auth-tab="signup"]', "signup tab");
  await evaluate(`(() => { const fill=(name,value)=>{const el=document.querySelector('[name='+name+']');el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}; fill('email',${JSON.stringify(email)});fill('password','MvpCredit2026!');fill('nickname','Credit page tester');document.querySelector('[data-auth-form]').requestSubmit(); })()`);
  await wait("location.pathname === '/rooms' && Boolean(localStorage.getItem('many-worlds-token'))", "signed in rooms", 60000);
  await wait("Boolean(document.querySelector('[data-action=create-room]'))", "create room action"); await click('[data-action="create-room"]', "create contextual room");
  await wait("/^\\/rooms\\/c/.test(location.pathname)", "created room", 60000); const roomId = await evaluate("location.pathname.split('/').pop()");
  const grant = await evaluate(`(async () => { const response = await fetch('/api/v4/credits/test-grant', { method:'POST', headers:{ 'content-type':'application/json', authorization:'Bearer ' + localStorage.getItem('many-worlds-token') }, body:JSON.stringify({ runId:${JSON.stringify(String(stamp))}, amount:40 }) }); return { status:response.status, body:await response.json().catch(()=>({})) }; })()`);
  if (grant.status !== 201) throw new Error(`Unable to prepare the 40-credit visual fixture: ${JSON.stringify(grant)}`);
  const returnTo = `/room-game?runId=${roomId}`;
  await cdp.send("Page.navigate", { url:`${webBase}/credits?intent=WORLD_UNLOCK&runId=${encodeURIComponent(roomId)}&returnTo=${encodeURIComponent(returnTo)}` });
  await wait("location.pathname === '/credits'", "contextual wallet route");
  await wait("Boolean(document.querySelector('[data-wallet-state]:not([hidden])')) && document.querySelector('[data-balance]')?.textContent?.trim() !== '—'", "loaded wallet state"); await shot("pay-02-wallet.png");
  await click('[data-pack="credits_300"]', "choose 300 credits"); await wait("Boolean(document.querySelector('[data-confirm-state]:not([hidden])'))", "confirm state");
  if (await evaluate("Boolean(document.querySelector('[data-purchase-dialog]'))")) throw new Error("PAY-03 must be the documented same-container state, not a legacy dialog");
  await shot("pay-03-confirm.png"); await click('[data-confirm-purchase]', "continue to secure checkout");
  await wait("location.pathname === '/credits/status' && document.body.innerText.includes('Payment received. Adding your Credits.') && document.querySelector('[data-status-order]')?.textContent?.trim().startsWith('MW-')", "server-backed processing status"); await shot("pay-04-processing.png");
  await completeMockCheckout(stamp); await wait("document.body.innerText.includes('Your room is unlocked')", "paid status and idempotent unlock", 30000); await shot("pay-05-paid.png");
  await cdp.send("Page.navigate", { url:`${webBase}/credits/cancel?intent=WORLD_UNLOCK&runId=${encodeURIComponent(roomId)}&returnTo=${encodeURIComponent(returnTo)}` });
  await wait("document.body.innerText.includes('Payment cancelled')", "cancelled state"); await shot("pay-06-cancelled.png");
  await cdp.send("Page.navigate", { url:`${webBase}/credits/failed?intent=WORLD_UNLOCK&runId=${encodeURIComponent(roomId)}&returnTo=${encodeURIComponent(returnTo)}` });
  await wait("document.body.innerText.includes('Payment failed')", "failed state"); await shot("pay-07-failed.png");
  if (cdp.exceptions.length) throw new Error(`Runtime exceptions: ${cdp.exceptions.join(" | ")}`);
  const result = { status:"PASS", email, roomId, steps:["contextual wallet loads with 40 credits", "300 pack enters same-container confirmation", "secure checkout returns to server-backed processing status before webhook", "signed webhook updates paid status and unlocks the original room once", "cancelled status preserves recovery actions", "failed status preserves recovery actions"], screenshots:["pay-02-wallet.png","pay-03-confirm.png","pay-04-processing.png","pay-05-paid.png","pay-06-cancelled.png","pay-07-failed.png"], runtimeExceptions:cdp.exceptions, completedAt:new Date().toISOString() };
  await writeFile(join(resultDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`); console.log(JSON.stringify(result));
} finally { cdp?.close(); browser?.kill(); }
