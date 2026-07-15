import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(process.cwd());
const webBase = (process.env.MANY_WORLDS_WEB_BASE || "http://127.0.0.1:5177").replace(/\/$/, "");
const cdpPort = Number(process.env.MANY_WORLDS_COPY_CDP_PORT || 9332);
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outputDir = resolve(root, "docs/auto-execute/screenshots/wallet-pages");
const outPath = resolve(outputDir, "wallet-pages-audit.json");
const routes = [
  { name: "home-pricing", route: "/?wallet-audit=20260715", focus: "#pricing" },
  { name: "credits-wallet", route: "/credits?wallet-audit=20260715", focus: ".credits-heading" }
];
const viewports = [
  { name: "desktop", width: 1448, height: 900, mobile: false },
  { name: "mobile", width: 390, height: 844, mobile: true }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function getJson(url) {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`${response.status}: ${url}`);
    } catch (error) { lastError = error; }
    await sleep(150);
  }
  throw lastError || new Error(`Timed out: ${url}`);
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    const cdp = new Cdp(ws);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    ws.addEventListener("message", (message) => {
      const data = JSON.parse(message.data.toString());
      if (data.id && cdp.pending.has(data.id)) {
        const pending = cdp.pending.get(data.id);
        cdp.pending.delete(data.id);
        if (data.error) pending.reject(new Error(JSON.stringify(data.error)));
        else pending.resolve(data.result);
      } else if (data.method) cdp.events.push(data);
    });
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() { this.ws.close(); }
}

const chrome = spawn(chromePath, [
  `--remote-debugging-port=${cdpPort}`, "--headless=new", "--disable-gpu", "--hide-scrollbars",
  "--no-first-run", "--no-default-browser-check", `--user-data-dir=${resolve(root, ".runtime", "chrome-home-copy-audit")}`, "about:blank"
], { stdio: "ignore" });
let cdp;
try {
  await getJson(`http://127.0.0.1:${cdpPort}/json/version`);
  const targets = await getJson(`http://127.0.0.1:${cdpPort}/json/list`);
  const target = targets.find((item) => item.type === "page") || targets[0];
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  const evaluate = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
    return result.result?.value;
  };
  const pages = [];
  await mkdir(outputDir, { recursive: true });
  for (const viewport of viewports) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
    for (const page of routes) {
      const start = cdp.events.length;
      const url = `${webBase}${page.route}`;
      await cdp.send("Page.navigate", { url });
      await sleep(page.name.startsWith("credits") ? 1100 : 850);
      await evaluate(`(() => { document.documentElement.style.scrollBehavior = "auto"; const target = document.querySelector(${JSON.stringify(page.focus)}); if (target) window.scrollTo(0, Math.max(0, target.getBoundingClientRect().top + window.scrollY - 18)); return window.scrollY; })()`);
      await sleep(220);
      const snapshot = await evaluate(`(() => ({
        title: document.title,
        lang: document.documentElement.lang,
        text: document.body.innerText,
        packCount: document.querySelectorAll('[data-pack]').length,
        rewardCount: document.querySelectorAll('.wallet-rewards > div, .credit-reward-grid article, .credits-reward-panel article').length,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollY: Math.round(window.scrollY),
        focusTop: Math.round(document.querySelector(${JSON.stringify(page.focus)})?.getBoundingClientRect().top || 0)
      }))()`);
      const screenshotName = `${page.name}-${viewport.name}.png`;
      const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      await writeFile(resolve(outputDir, screenshotName), Buffer.from(screenshot.data, "base64"));
      const events = cdp.events.slice(start);
      const visibleFacts = {
        pack300: /300\s+World Credits/.test(snapshot.text) && snapshot.text.includes("$7.99"),
        pack650: /650\s+World Credits/.test(snapshot.text) && snapshot.text.includes("$14.99"),
        signup50: /(?:\+)?50\s+World Credits/.test(snapshot.text),
        referral25: /(?:\+)?25\s+World Credits/.test(snapshot.text)
      };
      const forbiddenCopy = [
        "The first three decisions are free",
        "100 Credits / room",
        "Best for this room",
        "Purchased Credits never expire",
        "Bonus Credits expire after 90 days",
        "no per-turn charge",
        "two reward slots"
      ].filter((copy) => snapshot.text.includes(copy));
      const runtimeErrors = events.filter((event) => event.method === "Runtime.exceptionThrown").map((event) => event.params.exceptionDetails?.text || "runtime exception");
      const failedNetwork = events.filter((event) => event.method === "Network.loadingFailed" && event.params.type !== "Document").map((event) => ({ errorText: event.params.errorText, type: event.params.type }));
      pages.push({
        name: page.name,
        viewport: viewport.name,
        url,
        title: snapshot.title,
        lang: snapshot.lang,
        visibleFacts,
        forbiddenCopy,
        packCount: snapshot.packCount,
        rewardCount: snapshot.rewardCount,
        horizontalOverflow: Math.max(0, snapshot.scrollWidth - snapshot.clientWidth),
        scrollY: snapshot.scrollY,
        focusTop: snapshot.focusTop,
        screenshot: screenshotName,
        runtimeErrors,
        failedNetwork
      });
    }
  }
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1448, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: `${webBase}/credits?auth-gate-audit=20260715` });
  await sleep(800);
  await evaluate(`localStorage.removeItem("many-worlds-token"); location.reload(); true`);
  await sleep(800);
  await evaluate(`document.querySelector('[data-pack="credits_300"]')?.click(); true`);
  await sleep(600);
  const authGate = await evaluate(`({ pathname: location.pathname, returnTo: new URLSearchParams(location.search).get("returnTo") })`);
  authGate.passed = authGate.pathname === "/auth" && authGate.returnTo === "/credits?confirm=credits_300";
  const authEntries = [
    { name: "direct", route: "/auth" },
    { name: "world-return", route: "/auth?returnTo=%2Fworlds%2Fcaesar" },
    { name: "room-return", route: "/auth?returnTo=%2Frooms%2Fexample" },
    { name: "credits-return", route: "/auth?returnTo=%2Fcredits%3Fconfirm%3Dcredits_300" }
  ];
  const authPages = [];
  for (const viewport of viewports) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
    for (const entry of authEntries) {
      const start = cdp.events.length;
      await cdp.send("Page.navigate", { url: `${webBase}${entry.route}` });
      await sleep(550);
      const login = await evaluate(`(() => ({
        text: document.body.innerText,
        title: document.title,
        nicknamePlaceholder: document.querySelector('input[name="nickname"]')?.placeholder || "",
        resetText: document.querySelector('[data-reset-form]')?.textContent || "",
        horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
      }))()`);
      const forbiddenCopies = ["Caesar", "Continue to", "continue your story", "story know you", "shared room", "story room"];
      const authCopy = `${login.text}\n${login.nicknamePlaceholder}\n${login.resetText}`.toLowerCase();
      const forbidden = forbiddenCopies.filter((copy) => authCopy.includes(copy.toLowerCase()));
      let screenshots = [];
      let signupText = "";
      let signupOverflow = login.horizontalOverflow;
      if (entry.name === "direct") {
        const loginName = `auth-login-${viewport.name}.png`;
        const loginShot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
        await writeFile(resolve(outputDir, loginName), Buffer.from(loginShot.data, "base64"));
        await evaluate(`document.querySelector('[data-auth-tab="signup"]')?.click(); true`);
        await sleep(120);
        const signup = await evaluate(`({
          text: document.body.innerText,
          horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
        })`);
        signupText = signup.text;
        signupOverflow = signup.horizontalOverflow;
        forbidden.push(...forbiddenCopies.filter((copy) => signupText.toLowerCase().includes(copy.toLowerCase())));
        const signupName = `auth-signup-${viewport.name}.png`;
        const signupShot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
        await writeFile(resolve(outputDir, signupName), Buffer.from(signupShot.data, "base64"));
        screenshots = [loginName, signupName];
      }
      const events = cdp.events.slice(start);
      const runtimeErrors = events.filter((event) => event.method === "Runtime.exceptionThrown").map((event) => event.params.exceptionDetails?.text || "runtime exception");
      const failedNetwork = events.filter((event) => event.method === "Network.loadingFailed" && event.params.type !== "Document").map((event) => ({ errorText: event.params.errorText, type: event.params.type }));
      authPages.push({
        name: entry.name,
        viewport: viewport.name,
        title: login.title,
        genericHeading: login.text.includes("Welcome to Many Worlds"),
        genericSubtitle: login.text.includes("Log in or create an account to continue."),
        nicknamePlaceholder: login.nicknamePlaceholder,
        forbidden: [...new Set(forbidden)],
        horizontalOverflow: Math.max(login.horizontalOverflow, signupOverflow),
        screenshots,
        runtimeErrors,
        failedNetwork
      });
    }
  }
  const failures = pages.filter((page) => page.forbiddenCopy.length || page.horizontalOverflow > 1 || page.runtimeErrors.length || page.failedNetwork.length);
  if (!authGate.passed) failures.push({ name: "auth-gate", reason: "Signed-out purchase did not redirect to auth with the selected pack." });
  if (authPages.some((page) => page.forbidden.length || page.horizontalOverflow > 1 || page.runtimeErrors.length || page.failedNetwork.length || !page.genericHeading || !page.genericSubtitle || page.nicknamePlaceholder !== "Enter your display name")) failures.push({ name: "auth-copy", reason: "An auth entry still exposes game-specific copy or fails the generic account layout." });
  const offerPages = pages;
  if (offerPages.some((page) => !page.visibleFacts.pack300 || !page.visibleFacts.pack650 || !page.visibleFacts.signup50 || !page.visibleFacts.referral25)) failures.push({ name: "confirmed-facts", reason: "One or more confirmed wallet facts are missing." });
  const result = { status: failures.length ? "FAIL" : "PASS", webBase, pages, authGate, authPages, failures, capturedAt: new Date().toISOString() };
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  cdp?.close();
  chrome.kill();
}
