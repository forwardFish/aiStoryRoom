import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveChromeBinary } from "./chrome-binary-resolver.mjs";
import { classifyManeuverRequest } from "./openovel-maneuver-preview-confirm-contract.mjs";

export class CdpClient {
  static async connect(url) {
    if (typeof WebSocket !== "function") throw new Error("Node WebSocket support is required");
    const client = new CdpClient(url);
    await client.ready;
    return client;
  }

  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", async (event) => {
      const raw = typeof event.data === "string"
        ? event.data
        : typeof event.data?.text === "function"
          ? await event.data.text()
          : Buffer.from(event.data).toString("utf8");
      const message = JSON.parse(raw);
      if (message.id) {
        const waiting = this.pending.get(message.id);
        if (!waiting) return;
        this.pending.delete(message.id);
        clearTimeout(waiting.timer);
        if (message.error) waiting.reject(new Error(`${waiting.method}: ${message.error.message}`));
        else waiting.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) {
        try { listener(message.params || {}); } catch {}
      }
    });
    this.socket.addEventListener("close", () => {
      for (const waiting of this.pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error(`CDP closed while waiting for ${waiting.method}`));
      }
      this.pending.clear();
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  async send(method, params = {}, timeoutMs = 30_000) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
  }
}

export async function launchChrome(evidenceRoot) {
  const executable = resolveChromeBinary();
  const debugPort = await reservePort();
  const profile = await mkdtemp(path.join(os.tmpdir(), "openovel-r2-4-chrome-"));
  const log = createWriteStream(path.join(evidenceRoot, "chrome.log"), { flags: "a" });
  const child = spawn(executable, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-extensions",
    "--no-first-run",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  await waitUntil(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`).catch(() => null);
    return response?.ok ? true : false;
  }, 30_000, "Chrome remote debugger did not start");
  return {
    debugPort,
    async stop() {
      await stopChild(child);
      await endStream(log);
      await rm(profile, { recursive: true, force: true });
    },
  };
}

export async function connectPage(debugPort) {
  const page = await waitUntil(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json`).catch(() => null);
    if (!response?.ok) return false;
    const pages = await response.json();
    return pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl) || false;
  }, 30_000, "Chrome page target unavailable");
  return CdpClient.connect(page.webSocketDebuggerUrl);
}

export async function navigate(client, url) {
  await client.send("Page.navigate", { url });
  await waitUntil(async () => {
    const state = await evaluate(client, "({ href: location.href, ready: document.readyState })");
    return state.href.startsWith(url.split("?")[0]) && state.ready === "complete" ? state : false;
  }, 60_000, `navigation failed: ${url}`);
}

export async function waitSelector(client, selector, timeoutMs = 30_000) {
  return waitUntil(
    async () => evaluate(client, `Boolean(document.querySelector(${JSON.stringify(selector)}))`),
    timeoutMs,
    `selector missing: ${selector}`,
  );
}

export async function click(client, selector) {
  return evaluate(client, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error(${JSON.stringify(`missing selector: ${selector}`)});
    if (element.disabled) throw new Error(${JSON.stringify(`disabled selector: ${selector}`)});
    element.click();
    return true;
  })()`);
}

export async function doubleClick(client, selector) {
  return evaluate(client, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error(${JSON.stringify(`missing selector: ${selector}`)});
    if (element.disabled) throw new Error(${JSON.stringify(`disabled selector: ${selector}`)});
    element.click();
    element.click();
    return true;
  })()`);
}

export async function fill(client, selector, value) {
  return evaluate(client, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error(${JSON.stringify(`missing selector: ${selector}`)});
    element.focus();
    element.value = ${JSON.stringify(value)};
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return element.value;
  })()`);
}

export async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "browser evaluation failed");
  }
  return result.result?.value;
}

export async function screenshot(client, file) {
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    fromSurface: true,
  }, 60_000);
  await writeFile(file, Buffer.from(result.data, "base64"));
}

export function captureBrowserEvidence(client) {
  const requests = new Map();
  const consoleItems = [];
  client.on("Network.requestWillBeSent", (event) => {
    if (!event.request?.url?.includes("/api/")) return;
    requests.set(event.requestId, {
      requestId: event.requestId,
      url: event.request.url,
      method: event.request.method,
      requestBody: parseJson(event.request.postData),
      status: null,
      failed: false,
      errorText: null,
    });
  });
  client.on("Network.responseReceived", (event) => {
    const item = requests.get(event.requestId);
    if (item) item.status = event.response?.status;
  });
  client.on("Network.loadingFailed", (event) => {
    const item = requests.get(event.requestId);
    if (item) {
      item.failed = true;
      item.errorText = event.errorText || null;
    }
  });
  client.on("Runtime.consoleAPICalled", (event) => consoleItems.push({
    kind: "console",
    type: event.type,
    values: (event.args || []).map((item) => item.value ?? item.description ?? ""),
  }));
  client.on("Runtime.exceptionThrown", (event) => consoleItems.push({
    kind: "exception",
    type: "error",
    text: event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || "exception",
  }));
  client.on("Log.entryAdded", (event) => consoleItems.push({
    kind: "log",
    type: event.entry?.level,
    text: event.entry?.text,
    url: event.entry?.url,
  }));
  const network = () => [...requests.values()];
  const maneuverRequests = () => network().filter((item) => item.method === "POST" && classifyManeuverRequest(item.url));
  return { network, maneuverRequests, console: () => consoleItems };
}

export async function waitForManeuverRequestDelta(evidence, startIndex, expected) {
  return waitUntil(() => {
    const requests = evidence.maneuverRequests().slice(startIndex);
    const preview = requests.filter((item) => classifyManeuverRequest(item.url) === "preview");
    const confirm = requests.filter((item) => classifyManeuverRequest(item.url) === "confirm");
    const legacy = requests.filter((item) => classifyManeuverRequest(item.url) === "legacy");
    if (preview.length !== expected.preview || confirm.length !== expected.confirm || legacy.length !== 0) return false;
    if (!requests.every((item) => item.failed || item.status != null)) return false;
    assert.equal(requests.every(isSuccessfulRequest), true, JSON.stringify(requests));
    return requests;
  }, 30_000, `maneuver network delta mismatch: ${JSON.stringify(expected)}`);
}

export function isSuccessfulRequest(item) {
  return !item.failed && Number(item.status || 0) >= 200 && Number(item.status || 0) < 300;
}

export async function waitUntil(fn, timeoutMs = 30_000, message = "condition not met") {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message || lastError}` : ""}`);
}

async function reservePort() {
  const { createServer } = await import("node:http");
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not expose a port");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    delay(5_000).then(() => false),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(2_000),
    ]);
  }
}

async function endStream(stream) {
  if (!stream || stream.closed) return;
  await new Promise((resolve) => stream.end(resolve));
}

function parseJson(value) {
  try { return value ? JSON.parse(value) : null; } catch { return value || null; }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
