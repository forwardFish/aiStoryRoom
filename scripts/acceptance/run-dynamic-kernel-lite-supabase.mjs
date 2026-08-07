import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  SupabaseAcceptanceError,
  inspectSupabaseAcceptanceEnvironment,
  prepareSupabaseAcceptanceEnvironment,
  verifySupabaseAcceptanceConnection,
} from "./supabase-formal-acceptance.mjs";

const root = resolve(".");
const evidenceRoot = resolve(
  process.env.SUPABASE_ACCEPTANCE_EVIDENCE_ROOT
    || "outputs/dynamic-kernel-lite-supabase",
);
const logsRoot = join(evidenceRoot, "logs");
const summaryPath = join(evidenceRoot, "summary.json");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const node = process.execPath;
const apiPort = Number(process.env.DYNAMIC_KERNEL_LITE_API_PORT || 3104);
const webPort = Number(process.env.DYNAMIC_KERNEL_LITE_WEB_PORT || 5178);
const chromePath = process.env.CHROME_PATH
  || (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/usr/bin/google-chrome");
const mailSink = join(evidenceRoot, "auth-mail.ndjson");
const runStartedAtMs = Date.now();
const commands = [];
const services = [];
const syntheticEmails = new Set();
let cleanupEvidence = null;
let v4DatabaseEvidence = null;
let browserEvidence = null;
let contract = null;
let primaryError = null;

await mkdir(logsRoot, { recursive: true });
prepareSupabaseAcceptanceEnvironment(process.env);

function serviceEnvironment() {
  const namespace = process.env.ACCEPTANCE_DATA_NAMESPACE;
  return {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_TARGET: "external",
    MVP_STORY_STORAGE: "prisma",
    STORY_WORKER_EMBEDDED: "true",
    STORY_WORKER_ENABLED: "true",
    ENABLE_MOCK_LOGIN: "true",
    ENABLE_MOCK_AI: "true",
    ENABLE_MOCK_AUDIT: "true",
    AI_PROVIDER: "mock",
    AI_CAUSAL_PROVIDER: "rules",
    AUDIT_PROVIDER: "mock",
    ROLE_AGENT_PROVIDER: "mock",
    EMAIL_PROVIDER: "file-sink",
    AUTH_MAIL_SINK_FILE: mailSink,
    PUBLIC_WEB_URL: `http://127.0.0.1:${webPort}`,
    PUBLIC_API_URL: `http://127.0.0.1:${apiPort}`,
    CORS_ALLOWED_ORIGINS: [
      `http://127.0.0.1:${webPort}`,
      `http://localhost:${webPort}`,
    ].join(","),
    AUTH_TOKEN_SECRET:
      process.env.AUTH_TOKEN_SECRET
      || `dkl-supabase-${namespace}-auth-secret`,
    JWT_SECRET:
      process.env.JWT_SECRET
      || `dkl-supabase-${namespace}-jwt-secret`,
    ALLOW_TEST_CREDIT_GRANT: "true",
    CREDIT_ACTION_METERING_MODE: "OFF",
    CREEM_MOCK_MODE: "true",
    MOCK_WECHAT_OPENID_PREFIX: `${namespace}_`,
  };
}

function redact(value) {
  let text = String(value || "");
  const secretValues = [
    process.env.DATABASE_URL,
    process.env.SUPABASE_DATABASE_URL,
    process.env.OPENOVEL_PROVIDER_API_KEY,
    process.env.OPENOVEL_API_KEY,
    process.env.DEEPSEEK_API_KEY,
  ].filter((item) => String(item || "").length >= 8);
  for (const secret of secretValues) {
    text = text.split(String(secret)).join("[REDACTED_SECRET]");
  }
  return text
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/giu, "$1[REDACTED]@")
    .replace(/\b(?:sk-|sb_secret_)[A-Za-z0-9._-]{8,}\b/gu, "[REDACTED_KEY]");
}

async function runCommand(label, executable, args, extraEnv = {}) {
  const logPath = join(logsRoot, `${label}.log`);
  const startedAt = new Date().toISOString();
  const result = await new Promise((resolvePromise) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: { ...serviceEnvironment(), ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = redact(chunk.toString());
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = redact(chunk.toString());
      output += text;
      process.stderr.write(text);
    });
    child.on("error", (error) => {
      output += `\n${redact(error.stack || error.message)}\n`;
      resolvePromise({ exitCode: 1, output, signal: null });
    });
    child.on("exit", (code, signal) => {
      resolvePromise({
        exitCode: Number.isInteger(code) ? code : 1,
        signal: signal || null,
        output,
      });
    });
  });
  await writeFile(logPath, result.output, "utf8");
  const entry = {
    label,
    command: [executable, ...args].join(" "),
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: result.exitCode,
    signal: result.signal,
    logPath,
    passed: result.exitCode === 0,
  };
  commands.push(entry);
  if (!entry.passed) {
    throw new Error(`SUPABASE_FORMAL_COMMAND_FAILED:${label}`);
  }
  return entry;
}

function startService(label, executable, args, extraEnv = {}) {
  const outPath = join(logsRoot, `${label}.out.log`);
  const errPath = join(logsRoot, `${label}.err.log`);
  const child = spawn(executable, args, {
    cwd: root,
    env: { ...serviceEnvironment(), ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    const text = redact(chunk.toString());
    stdout += text;
    process.stdout.write(`[${label}] ${text}`);
  });
  child.stderr.on("data", (chunk) => {
    const text = redact(chunk.toString());
    stderr += text;
    process.stderr.write(`[${label}] ${text}`);
  });
  const service = {
    label,
    child,
    flush: async () => {
      await writeFile(outPath, stdout, "utf8");
      await writeFile(errPath, stderr, "utf8");
    },
  };
  services.push(service);
  return service;
}

async function waitForHttp(url, label, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
      lastError = new Error(`${response.status} ${url}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(
    `SUPABASE_FORMAL_SERVICE_NOT_READY:${label}:${lastError?.message || url}`,
  );
}

async function latestV4DatabaseReport() {
  const reportDir = join(root, "scripts", "test-reports");
  const files = (await readdir(reportDir).catch(() => []))
    .filter((name) => {
      const stamp = Number(name.match(/^v4-database-smoke-(\d+)\.json$/u)?.[1]);
      return Number.isFinite(stamp) && stamp >= runStartedAtMs;
    })
    .sort((left, right) => right.localeCompare(left));
  const name = files[0];
  if (!name) throw new Error("SUPABASE_V4_DATABASE_REPORT_MISSING");
  const report = JSON.parse(await readFile(join(reportDir, name), "utf8"));
  if (
    report.status !== "PASS"
    || !String(report.runId || "").startsWith("solo_ovl_")
    || Number(report.playerActionCount) !== 1
    || Number(report.resolvedSceneCount) !== 1
    || Number(report.idempotentReplayPreservedWorldSequence) !== 1
  ) {
    throw new Error("SUPABASE_V4_DATABASE_REPORT_INVALID");
  }
  const stamp = name.match(/(\d+)\.json$/u)?.[1] || "";
  const syntheticEmail = stamp
    ? `mw-openovel-v4-${stamp}@example.test`
    : null;
  if (syntheticEmail) syntheticEmails.add(syntheticEmail);
  return {
    ...report,
    evidenceClass: "FORMAL_SUPABASE",
    databaseProvider: "SUPABASE",
    supabaseProjectRefHash: contract.projectRefHash,
    supabaseSchema: contract.schema,
    reportFile: join(reportDir, name),
    syntheticEmail,
  };
}

async function loadBrowserEvidence() {
  const rootPath = join(evidenceRoot, "browser");
  for (const name of ["result.json", "failure.json"]) {
    try {
      const value = JSON.parse(await readFile(join(rootPath, name), "utf8"));
      if (value.syntheticEmail) syntheticEmails.add(value.syntheticEmail);
      return value;
    } catch {
      // Try the next evidence file.
    }
  }
  return null;
}

async function cleanupSyntheticAcceptanceUsers(activeContract) {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const exactEmails = [...syntheticEmails].filter(Boolean);
    const users = await prisma.user.findMany({
      where: {
        OR: [
          ...(exactEmails.length ? [{ email: { in: exactEmails } }] : []),
          {
            email: {
              startsWith: `${activeContract.namespace}-`,
              endsWith: "@example.test",
            },
          },
          { openid: { startsWith: `${activeContract.namespace}_` } },
        ],
      },
      select: { id: true, email: true, openid: true },
    });
    if (users.length > 25) {
      throw new Error(
        `SUPABASE_SYNTHETIC_CLEANUP_SCOPE_TOO_LARGE:${users.length}`,
      );
    }
    for (const user of users) {
      const email = String(user.email || "");
      const openid = String(user.openid || "");
      const safe = exactEmails.includes(email)
        || (
          email.startsWith(`${activeContract.namespace}-`)
          && email.endsWith("@example.test")
        )
        || openid.startsWith(`${activeContract.namespace}_`);
      if (!safe) {
        throw new Error("SUPABASE_SYNTHETIC_CLEANUP_SCOPE_VIOLATION");
      }
    }
    for (const user of users) {
      await prisma.user.delete({ where: { id: user.id } });
    }
    return {
      status: "PASS",
      queryScope: "EXACT_SYNTHETIC_IDENTIFIERS_ONLY",
      deletedSyntheticUserCount: users.length,
      completedAt: new Date().toISOString(),
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function stopServices() {
  for (const service of services.reverse()) {
    service.child.kill("SIGTERM");
    await service.flush().catch(() => {});
  }
}

async function writeSummary(status, error = null) {
  const commandPassed = (label) => commands.some(
    (command) => command.label === label && command.passed,
  );
  const persistencePassed = commandPassed("04-supabase-run-turn-idempotency")
    && v4DatabaseEvidence?.status === "PASS";
  const pageFlowPassed = commandPassed("05-supabase-real-page-flow")
    && browserEvidence?.status === "PASS";
  const summary = {
    schemaVersion: "omw.dynamic-kernel-lite.supabase-formal.v1",
    status,
    evidenceClass: contract?.evidenceClass || "FORMAL_SUPABASE",
    formalAcceptanceEligible: status === "PASS",
    databaseProvider: contract?.provider || "SUPABASE",
    supabaseProjectRefHash: contract?.projectRefHash || null,
    supabaseSchema: contract?.schema || null,
    acceptanceNamespace: contract?.namespace
      || process.env.ACCEPTANCE_DATA_NAMESPACE
      || null,
    databaseBacked: Boolean(contract?.connected),
    runRoomTurnPersistenceCovered: persistencePassed,
    idempotencyCovered: persistencePassed
      && Number(v4DatabaseEvidence?.idempotentReplayPreservedWorldSequence) === 1,
    atomicCommitCovered: persistencePassed
      && pageFlowPassed
      && Number(browserEvidence?.committedEventCount) === 1,
    realPageFlowCovered: pageFlowPassed,
    migrationsExecuted: false,
    onlineConfigurationModified: false,
    realUserDataAccessed: false,
    commands,
    v4DatabaseEvidence,
    browserEvidence,
    cleanupEvidence,
    error: error
      ? redact(error instanceof Error ? error.stack || error.message : error)
      : null,
    completedAt: new Date().toISOString(),
  };
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
}

try {
  contract = await verifySupabaseAcceptanceConnection(
    inspectSupabaseAcceptanceEnvironment(process.env),
  );
  await writeFile(mailSink, "", "utf8");

  // Client generation is local code generation only. No migration, db push,
  // reset or seed command is permitted by this runner.
  await runCommand("01-prisma-client-generate", pnpm, ["db:generate"]);
  await runCommand("02-api-build", pnpm, ["--filter", "@apps/api", "build"]);
  await runCommand("03-web-typecheck", pnpm, ["--filter", "@apps/web", "typecheck"]);

  startService(
    "api",
    node,
    ["apps/api/dist/main.js"],
    { PORT: String(apiPort), API_PORT: String(apiPort) },
  );
  startService(
    "web",
    node,
    ["apps/web/src/server.mjs"],
    { PORT: String(webPort), API_PORT: String(apiPort) },
  );
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`, "api");
  await waitForHttp(`http://127.0.0.1:${webPort}/`, "web");

  await runCommand(
    "04-supabase-run-turn-idempotency",
    pnpm,
    [
      "exec",
      "tsx",
      "--tsconfig",
      "apps/api/tsconfig.json",
      "scripts/e2e/v4-database-smoke.ts",
    ],
    {
      MANY_WORLDS_API_BASE: `http://127.0.0.1:${apiPort}/api`,
      API_BASE: `http://127.0.0.1:${apiPort}/api`,
    },
  );
  v4DatabaseEvidence = await latestV4DatabaseReport();

  await runCommand(
    "05-supabase-real-page-flow",
    node,
    ["scripts/e2e/dynamic-kernel-lite-supabase-browser.mjs"],
    {
      CHROME_PATH: chromePath,
      DYNAMIC_KERNEL_LITE_WEB_BASE: `http://127.0.0.1:${webPort}`,
      DYNAMIC_KERNEL_LITE_BROWSER_CDP_PORT: String(
        Number(process.env.DYNAMIC_KERNEL_LITE_BROWSER_CDP_PORT || 9341),
      ),
    },
  );
  browserEvidence = await loadBrowserEvidence();
  if (
    browserEvidence?.status !== "PASS"
    || browserEvidence.evidenceClass !== "FORMAL_SUPABASE"
    || browserEvidence.databaseProvider !== "SUPABASE"
    || browserEvidence.supabaseProjectRefHash !== contract.projectRefHash
    || browserEvidence.supabaseSchema !== contract.schema
    || Number(browserEvidence.playerActionCount) !== 1
    || Number(browserEvidence.resolvedSceneNodeCount) !== 1
    || Number(browserEvidence.committedEventCount) !== 1
  ) {
    throw new Error("SUPABASE_FORMAL_BROWSER_EVIDENCE_INVALID");
  }
} catch (error) {
  primaryError = error;
} finally {
  await stopServices();
  browserEvidence ||= await loadBrowserEvidence();
  if (contract) {
    try {
      // Cleanup queries are restricted to exact synthetic identifiers and the
      // unique acceptance namespace. They never enumerate or mutate real users.
      cleanupEvidence = await cleanupSyntheticAcceptanceUsers(contract);
    } catch (cleanupError) {
      cleanupEvidence = {
        status: "FAIL",
        error: redact(
          cleanupError instanceof Error
            ? cleanupError.stack || cleanupError.message
            : cleanupError,
        ),
        completedAt: new Date().toISOString(),
      };
      primaryError ||= cleanupError;
    }
  }
}

const blocked = primaryError instanceof SupabaseAcceptanceError;
const finalStatus = primaryError ? (blocked ? "BLOCKED" : "FAIL") : "PASS";
const summary = await writeSummary(finalStatus, primaryError);
if (finalStatus === "PASS") {
  console.log("DYNAMIC_KERNEL_LITE_SUPABASE_FORMAL_PASS");
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.error(JSON.stringify(summary, null, 2));
  process.exitCode = blocked ? 78 : 1;
}
