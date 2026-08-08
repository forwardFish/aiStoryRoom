import childProcess from "node:child_process";
import { existsSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

export function resolveChromeBinary(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const fileExists = options.existsSync || existsSync;
  const run = options.execFileSync || childProcess.execFileSync;
  const configured = String(readEnv(env, "CHROME_BIN") || "").trim();
  const pathApi = platform === "win32" ? path.win32 : path.posix;

  if (configured && pathApi.isAbsolute(configured) && fileExists(configured)) {
    return configured;
  }

  if (platform === "win32") {
    for (const candidate of windowsBrowserCandidates(env)) {
      if (fileExists(candidate)) return candidate;
    }
    for (const candidate of unique([configured, "chrome.exe", "msedge.exe", "chromium.exe", "chrome", "msedge", "chromium"])) {
      const located = locateWindowsCommand(candidate, run, fileExists);
      if (located) return located;
    }
  } else {
    for (const candidate of unique([configured, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable"])) {
      if (pathApi.isAbsolute(candidate) && fileExists(candidate)) return candidate;
      const located = locateUnixCommand(candidate, run, fileExists);
      if (located) return located;
    }
  }

  throw new Error("A real Chrome/Chromium binary is required");
}

/**
 * The existing browser journey performs a legacy `which` lookup internally.
 * Install a narrowly scoped adapter before loading that journey so the public
 * entrypoint can use the platform-aware resolver without changing the journey
 * itself. The original child_process binding is restored after completion.
 */
export function installLegacyWhichChromeResolver(resolve = null) {
  const original = childProcess.execFileSync;
  const locate = typeof resolve === "function"
    ? resolve
    : () => resolveChromeBinary({ execFileSync: original });
  childProcess.execFileSync = createLegacyWhichChromeExecFileSync(locate, original);
  syncBuiltinESMExports();

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    childProcess.execFileSync = original;
    syncBuiltinESMExports();
  };
}

export function createLegacyWhichChromeExecFileSync(resolve, delegate) {
  if (typeof resolve !== "function") throw new TypeError("resolve must be a function");
  if (typeof delegate !== "function") throw new TypeError("delegate must be a function");
  let resolved = null;

  return function legacyWhichChromeExecFileSync(command, args = [], options = {}) {
    if (command === "which") {
      resolved ||= String(resolve()).trim();
      if (!resolved) throw new Error("A real Chrome/Chromium binary is required");
      const output = `${resolved}\n`;
      return options && typeof options === "object" && options.encoding
        ? output
        : Buffer.from(output);
    }
    return delegate(command, args, options);
  };
}

function windowsBrowserCandidates(env) {
  const roots = unique([
    readEnv(env, "PROGRAMFILES"),
    readEnv(env, "PROGRAMFILES(X86)"),
    readEnv(env, "LOCALAPPDATA"),
  ]);
  const candidates = [];
  for (const root of roots) {
    candidates.push(
      path.win32.join(root, "Google", "Chrome", "Application", "chrome.exe"),
      path.win32.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
    );
  }
  return candidates;
}

function locateWindowsCommand(candidate, run, fileExists) {
  if (!candidate) return null;
  try {
    const output = String(run("where.exe", [candidate], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }) || "");
    return firstExistingPath(output, fileExists);
  } catch {
    return null;
  }
}

function locateUnixCommand(candidate, run, fileExists) {
  if (!candidate) return null;
  const lookups = [
    ["sh", ["-c", 'command -v "$1"', "sh", candidate]],
    ["which", [candidate]],
  ];
  for (const [command, args] of lookups) {
    try {
      const output = String(run(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }) || "");
      const located = firstExistingPath(output, fileExists);
      if (located) return located;
    } catch {}
  }
  return null;
}

function firstExistingPath(output, fileExists) {
  for (const line of String(output || "").split(/\r?\n/)) {
    const candidate = line.trim();
    if (candidate && fileExists(candidate)) return candidate;
  }
  return null;
}

function readEnv(env, name) {
  const exact = env?.[name];
  if (exact !== undefined) return exact;
  const key = Object.keys(env || {}).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key ? env[key] : undefined;
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}
