import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(process.env.PROJECT_ROOT || ".");
const databaseEnvFile = resolve(process.env.SANGTIAN_ENV_FILE || join(root, ".env.test"));
if (!process.env.DATABASE_URL && existsSync(databaseEnvFile)) process.loadEnvFile(databaseEnvFile);
const { PrismaClient } = await import("@prisma/client");
const webBase = String(process.env.SANGTIAN_WEB_BASE || "http://127.0.0.1:5315").replace(/\/$/, "");
const mailSink = resolve(process.env.AUTH_MAIL_SINK_FILE || "apps/api/.auth-mail-sink.ndjson");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const cdpPort = Number(process.env.SANGTIAN_CDP_PORT || 9365);
const turnLimit = Number(process.env.SANGTIAN_TURN_LIMIT || 20);
const playerChoiceIndices = parsePlayerChoiceIndices(
  process.env.SANGTIAN_PLAYER_CHOICE_INDICES,
  turnLimit
);
const selectionMode = playerChoiceIndices
  ? "CODEX_PLAYER_PLAN"
  : "ENGINEERING_ALTERNATING";
const stamp = `sangtian-part-one-dev-${Date.now()}-${randomBytes(3).toString("hex")}`;
const email = `${stamp}@example.test`;
const password = `Sangtian-${randomBytes(18).toString("base64url")}!`;
const profile = await mkdtemp(join(tmpdir(), "many-worlds-sangtian-part-one-"));
const outDir = resolve(process.env.SANGTIAN_EVIDENCE_DIR || join(root, "docs", "auto-execute", "evidence", stamp));
const prisma = new PrismaClient();
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

if (!Number.isInteger(turnLimit) || turnLimit < 1 || turnLimit > 20) {
  throw new Error(`SANGTIAN_TURN_LIMIT must be an integer from 1 to 20; received ${turnLimit}`);
}
if (!existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);
await mkdir(outDir, { recursive: true });

function digest(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function parsePlayerChoiceIndices(raw, expectedTurns) {
  if (!String(raw || "").trim()) return null;
  const values = String(raw)
    .split(",")
    .map((value) => Number(value.trim()));
  if (
    values.length !== expectedTurns
    || values.some((value) => !Number.isInteger(value) || value < 0)
  ) {
    throw new Error(
      `SANGTIAN_PLAYER_CHOICE_INDICES must contain exactly ${expectedTurns} non-negative comma-separated integers`
    );
  }
  return values;
}

async function request(path, options = {}, expected = [200, 201]) {
  const response = await fetch(`${webBase}/api${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!expected.includes(response.status)) {
    throw new Error(`${path} returned ${response.status}: ${body.code || body.message || JSON.stringify(body)}`);
  }
  return body;
}

async function verificationToken() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const raw = await readFile(mailSink, "utf8").catch(() => "");
    const rows = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    const message = rows.reverse().find((row) =>
      String(row.to || "").toLowerCase() === email &&
      String(row.subject || "").startsWith("Verify your email address")
    );
    const match = String(message?.text || message?.html || "").match(/[?&]token=([^&\s<]+)/);
    if (match) return decodeURIComponent(match[1]);
    await sleep(100);
  }
  throw new Error(`Verification email was not written to ${mailSink}`);
}

async function waitForJson(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function endpointAlreadyResponds(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.consoleErrors = [];
    this.failedRequests = [];
    this.network = [];
    this.responseBodies = [];
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    const cdp = new Cdp(socket);
    await new Promise((resolveOpen, reject) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data.toString());
      if (data.method === "Runtime.exceptionThrown") {
        cdp.exceptions.push(data.params?.exceptionDetails?.exception?.description || data.params?.exceptionDetails?.text || "Runtime exception");
      }
      if (data.method === "Runtime.consoleAPICalled" && data.params?.type === "error") {
        cdp.consoleErrors.push((data.params.args || []).map((arg) => arg.value || arg.description || "").join(" "));
      }
      if (data.method === "Network.loadingFailed") {
        cdp.failedRequests.push({ requestId: data.params.requestId, errorText: data.params.errorText, canceled: data.params.canceled === true });
      }
      if (data.method === "Network.responseReceived") {
        const urlValue = String(data.params?.response?.url || "");
        if (urlValue.includes("/api/v4/rooms/") || urlValue.includes("/api/v4/credits/")) {
          cdp.network.push({ url: urlValue, status: data.params.response.status, type: data.params.type });
          void cdp.send("Network.getResponseBody", { requestId: data.params.requestId })
            .then((body) => cdp.responseBodies.push({ url: urlValue, status: data.params.response.status, body: body.body }))
            .catch(() => {});
        }
      }
      const pending = cdp.pending.get(data.id);
      if (!pending) return;
      cdp.pending.delete(data.id);
      data.error ? pending.reject(new Error(JSON.stringify(data.error))) : pending.resolve(data.result);
    });
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveSend, reject) => this.pending.set(id, { resolve: resolveSend, reject }));
  }

  close() { this.socket.close(); }
}

async function databaseSnapshot(runId) {
  // The shared test database has a small session-mode pool. Keep the evidence
  // readback deterministic and low-pressure: one Prisma query at a time instead
  // of opening six concurrent sessions after every visible turn.
  const run = await prisma.storyRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true, currentDay: true, worldSequence: true, stateJson: true, updatedAt: true }
  });
  const attempts = await prisma.soloGenerationAttempt.findMany({
    where: { runId, triggerType: { not: "OPENING" } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, triggerType: true, status: true, providerCallCount: true, issueCodesJson: true,
      failureReason: true, contextSnapshotHash: true, timingsJson: true, createdAt: true, finishedAt: true
    }
  });
  const submissions = await prisma.decisionSubmission.findMany({
    where: { runId },
    orderBy: { submittedAt: "asc" },
    select: { id: true, turnId: true, candidateId: true, immutableIntentHash: true, status: true, submittedAt: true, resolvedAt: true }
  });
  const actions = await prisma.playerAction.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
    select: { id: true, actionType: true, targetType: true, targetId: true, targetText: true, method: true, intent: true, status: true }
  });
  const resolutions = await prisma.actionResolution.findMany({
    where: { runId },
    orderBy: { resolvedAt: "asc" },
    select: {
      id: true, turnId: true, playerActionId: true, appliedWorldSequence: true, resultNarrative: true,
      nextHook: true, qualityStatus: true, outcomeJson: true, statePatchJson: true, resolvedAt: true
    }
  });
  const decisionSets = await prisma.decisionSet.findMany({
    where: { runId },
    orderBy: { generatedAt: "asc" },
    select: { turnId: true, framing: true, candidatesJson: true, qualityStatus: true, generatedAt: true }
  });
  return { run, attempts, submissions, actions, resolutions, decisionSets };
}

function validatePrefix(snapshot, expectedTurn) {
  const partOne = snapshot.run?.stateJson?.partOne || {};
  const checks = {
    oneRun: Boolean(snapshot.run?.id?.startsWith("solo_")),
    exactAttemptPrefix: snapshot.attempts.length === expectedTurn,
    exactSubmissionPrefix: snapshot.submissions.length === expectedTurn,
    exactActionPrefix: snapshot.actions.length === expectedTurn,
    exactResolutionPrefix: snapshot.resolutions.length === expectedTurn,
    allAttemptsPublished: snapshot.attempts.every((item) => item.status === "PUBLISHED"),
    exactlyOneNarratorAndDecisionCallPerTurn: snapshot.attempts.every((item) =>
      item.providerCallCount === 2
      && item.timingsJson?.providerCallCount === 2
      && item.timingsJson?.narrationProviderCallCount === 1
      && item.timingsJson?.decisionProviderCallCount === 1
    ),
    allSubmissionsResolved: snapshot.submissions.every((item) => item.status === "RESOLVED"),
    allActionsResolved: snapshot.actions.every((item) => String(item.status).toLowerCase() === "resolved"),
    allResolutionsPassed: snapshot.resolutions.every((item) => item.qualityStatus === "PASSED"),
    noAttemptIssues: snapshot.attempts.every((item) => !item.failureReason && (!Array.isArray(item.issueCodesJson) || item.issueCodesJson.length === 0)),
    turnNumberCommitted: Number(partOne.turnNumber || 0) === expectedTurn
  };
  return { checks, partOne };
}

function serializableSnapshot(snapshot) {
  return {
    run: snapshot.run,
    attempts: snapshot.attempts,
    submissions: snapshot.submissions,
    actions: snapshot.actions,
    resolutions: snapshot.resolutions,
    decisionSets: snapshot.decisionSets
  };
}

if (await endpointAlreadyResponds(`http://127.0.0.1:${cdpPort}/json/version`)) {
  throw new Error(
    `SANGTIAN_CDP_PORT ${cdpPort} is already in use; refusing to attach to a stale authenticated browser`
  );
}

await request("/v4/auth/register", {
  method: "POST",
  body: JSON.stringify({ email, password, nickname: "Sangtian Part One Engineering Run" })
});
await request("/v4/auth/verify", { method: "POST", body: JSON.stringify({ token: await verificationToken() }) });

const chrome = spawn(chromePath, [
  `--remote-debugging-port=${cdpPort}`,
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${profile}`,
  "about:blank"
], { stdio: "ignore" });

let cdp;
let runId = null;
const checkpoints = [];
try {
  await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`);
  const page = (await waitForJson(`http://127.0.0.1:${cdpPort}/json/list`)).find((entry) => entry.type === "page");
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__STORY_STREAM_DELAY_MULTIPLIER__ = 0;" });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    }
    return result.result?.value;
  };
  const wait = async (expression, label, timeout = 90_000) => {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try { last = await evaluate(expression); } catch (error) { last = error.message; }
      if (last) return last;
      await sleep(150);
    }
    const snapshot = await evaluate("({ path:location.pathname, text:document.body.innerText.slice(0,2400), html:document.body.innerHTML.slice(0,1200) })").catch(() => null);
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(snapshot || last)}`);
  };
  const navigate = async (url) => {
    await cdp.send("Page.navigate", { url });
    await wait("document.readyState === 'complete'", `page load ${url}`, 30_000);
  };
  const screenshot = async (name) => {
    const dimensions = await evaluate("({width:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),height:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight)})");
    const image = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.min(2400, dimensions.width), height: Math.min(12000, dimensions.height), scale: 1 }
    });
    const path = join(outDir, name);
    await writeFile(path, Buffer.from(image.data, "base64"));
    return path;
  };
  const visibleCheckpoint = async (checkpointId) => {
    const view = await evaluate(`(() => ({
      checkpointId:${JSON.stringify(checkpointId)},
      path:location.pathname + location.search,
      title:document.querySelector('.decision-frame h2')?.innerText.trim() || document.querySelector('.decision-question')?.innerText.trim() || '',
      bodyText:document.body.innerText,
      decisionQuestion:document.querySelector('.decision-question')?.innerText.trim() || '',
      decisions:(() => {
        const active=[...document.querySelectorAll('input[name="decision"]')].map((input) => ({
          id:input.value,
          checked:input.checked,
          visibleText:input.closest('label')?.innerText.trim() || ''
        }));
        if(active.length) return active;
        return [...document.querySelectorAll('[data-testid="handoff-option"]')].map((item,index) => ({
          id:item.dataset.optionId || String(index + 1),
          checked:false,
          visibleText:item.innerText.trim()
        }));
      })(),
      resultNarrative:document.querySelector('[data-testid="result-narrative"]')?.innerText.trim() || '',
      error:document.querySelector('[data-testid="error-banner"]')?.innerText.trim() || ''
    }))()`);
    view.viewHash = digest({ title: view.title, decisionQuestion: view.decisionQuestion, decisions: view.decisions, resultNarrative: view.resultNarrative });
    return view;
  };

  await navigate(`${webBase}/auth?mode=login&returnTo=${encodeURIComponent("/role-select?story=sangtian&start=new")}`);
  await wait("Boolean(document.querySelector('[data-auth-form]'))", "login form");
  await evaluate(`(() => {
    const set = (name, value) => {
      const input = document.querySelector('[name="' + name + '"]');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles:true }));
    };
    set('email', ${JSON.stringify(email)});
    set('password', ${JSON.stringify(password)});
    document.querySelector('[data-auth-form]').requestSubmit();
    return true;
  })()`);
  await wait("location.pathname === '/role-select' && Boolean(document.querySelector('#enterRole'))", "authenticated role selection", 30_000);
  const creditGrant = await evaluate(`fetch('/api/v4/credits/test-grant', {
    method:'POST', credentials:'include', headers:{'content-type':'application/json'},
    body:JSON.stringify({runId:${JSON.stringify(stamp)},amount:500})
  }).then(async (response) => ({status:response.status, body:await response.json()}))`);
  if (![200, 201].includes(creditGrant.status)) throw new Error(`Credit grant failed: ${JSON.stringify(creditGrant)}`);

  await navigate(`${webBase}/role-select?story=sangtian&start=new&acceptance=continuous-dev`);
  await wait("Boolean(document.querySelector('#enterRole:not([disabled])'))", "role select");
  await evaluate("document.querySelector('#enterRole').click(); true");
  await wait("location.pathname === '/game' && Boolean(new URL(location.href).searchParams.get('runId'))", "game navigation", 45_000);
  runId = await evaluate("new URL(location.href).searchParams.get('runId')");
  await wait("Boolean(document.querySelector('#beginStoryBtn'))", "fixed opening", 45_000);
  await screenshot("G00-opening.png");
  await evaluate("document.querySelector('#beginStoryBtn').click(); true");
  await wait("Boolean(document.querySelector('#continueStoryBtn'))", "opening situation", 15_000);
  const g00Situation = await visibleCheckpoint("G00-SITUATION");
  if (g00Situation.resultNarrative.length < 120) {
    throw new Error(`G00 opening situation is too short: ${g00Situation.resultNarrative.length}`);
  }
  await screenshot("G00-situation.png");
  await writeFile(
    join(outDir, "G00-situation-player-visible.json"),
    `${JSON.stringify(g00Situation, null, 2)}\n`
  );
  await evaluate("document.querySelector('#continueStoryBtn').click(); true");
  await wait("Boolean(document.querySelector('#submitDecision')) && document.querySelectorAll('input[name=\"decision\"]').length >= 2", "G00 decisions", 15_000);
  const g00 = await visibleCheckpoint("G00");
  if (g00.decisions.length < 2) throw new Error(`G00 has fewer than two visible decisions: ${JSON.stringify(g00.decisions)}`);
  await screenshot("G00-decisions.png");
  await writeFile(join(outDir, "G00-player-visible.json"), `${JSON.stringify(g00, null, 2)}\n`);
  checkpoints.push({
    checkpointId: "G00",
    openingSituation: g00Situation,
    playerVisible: g00
  });

  for (let turnNumber = 1; turnNumber <= turnLimit; turnNumber += 1) {
    const checkpointBefore = turnNumber === 1 ? g00 : checkpoints.at(-1).nextPlayerVisible;
    const decisions = checkpointBefore?.decisions || [];
    if (decisions.length < 2) throw new Error(`A${String(turnNumber).padStart(2, "0")} has fewer than two visible decisions`);

    const actionId = `A${String(turnNumber).padStart(2, "0")}`;
    const selectedIndex = playerChoiceIndices
      ? playerChoiceIndices[turnNumber - 1]
      : turnNumber % 2 === 1 ? decisions.length - 1 : 0;
    if (selectedIndex >= decisions.length) {
      throw new Error(
        `${actionId} player choice index ${selectedIndex} exceeds ${decisions.length} visible decisions`
      );
    }
    const selected = decisions[selectedIndex];
    const checkpointId = `T${String(turnNumber).padStart(2, "0")}`;
    const actionRecord = {
      actionId,
      selectedDecisionId: selected.id,
      selectedVisibleText: selected.visibleText,
      selectionMode,
      selectedIndex,
      selectionRule: playerChoiceIndices
        ? "pre-reviewed coherent governor policy; every generated result still requires post-run player reading"
        : turnNumber % 2 === 1 ? "last-visible-option" : "first-visible-option",
      sourceCheckpointId: turnNumber === 1 ? "G00" : `T${String(turnNumber - 1).padStart(2, "0")}`,
      sourceViewHash: checkpointBefore.viewHash
    };
    await writeFile(join(outDir, `${actionId}-engineering-choice.json`), `${JSON.stringify(actionRecord, null, 2)}\n`);
    console.log(`[${checkpointId}] submit ${selected.visibleText.split(/\r?\n/)[0] || selected.id}`);

    await evaluate(`(() => {
      const input=[...document.querySelectorAll('input[name="decision"]')].find((item)=>item.value===${JSON.stringify(selected.id)});
      if(!input) throw new Error('selected decision missing');
      input.click();
      if(!input.checked) throw new Error('selected decision was not checked');
      document.querySelector('#submitDecision').click();
      return true;
    })()`);
    await wait("Boolean(document.querySelector('[data-testid=\"simulation-screen\"], .simulation-stage, .simulation-screen')) || document.body.innerText.includes('AI is shaping') || document.body.innerText.includes('推演')", `${checkpointId} resolving`, 10_000);
    await screenshot(`${checkpointId}-resolving.png`);
    await wait("Boolean(document.querySelector('#continueStoryBtn')) || Boolean(document.querySelector('[data-testid=\"error-banner\"]'))", `${checkpointId} generated result`, 150_000);
    const resultVisible = await visibleCheckpoint(checkpointId);
    if (resultVisible.error) throw new Error(`${checkpointId} visibly failed: ${resultVisible.error}`);
    if (resultVisible.resultNarrative.length < 120) throw new Error(`${checkpointId} result narrative is too short: ${resultVisible.resultNarrative.length}`);
    await screenshot(`${checkpointId}-result.png`);

    const snapshot = await databaseSnapshot(runId);
    const prefix = validatePrefix(snapshot, turnNumber);
    if (!Object.values(prefix.checks).every(Boolean)) {
      throw new Error(`${checkpointId} database prefix failed: ${JSON.stringify(prefix.checks)}`);
    }
    const latestResolution = snapshot.resolutions.at(-1);
    const outcome = latestResolution?.outcomeJson || {};
    const record = {
      checkpointId,
      action: actionRecord,
      playerVisibleResult: resultVisible,
      machine: {
        prefixChecks: prefix.checks,
        partOneState: prefix.partOne,
        currentAttempt: snapshot.attempts.at(-1),
        currentSubmission: snapshot.submissions.at(-1),
        currentAction: snapshot.actions.at(-1),
        currentResolution: latestResolution,
        committedEvent: outcome.partOneEvent || null,
        progressReport: outcome.partOneProgressReport || null
      }
    };

    await evaluate("document.querySelector('#continueStoryBtn').click(); true");
    if (turnNumber < 20) {
      await wait("Boolean(document.querySelector('#submitDecision')) && document.querySelectorAll('input[name=\"decision\"]').length >= 2", `${checkpointId} next decisions`, 20_000);
      record.nextPlayerVisible = await visibleCheckpoint(checkpointId);
      if (record.nextPlayerVisible.decisions.length < 2) {
        throw new Error(`${checkpointId} has fewer than two next decisions`);
      }
      await screenshot(`${checkpointId}-next.png`);
    } else {
      await wait("!document.querySelector('#submitDecision')", "T20 completion state", 20_000);
      record.nextPlayerVisible = await visibleCheckpoint(checkpointId);
      if (record.nextPlayerVisible.decisions.length < 2) {
        throw new Error(`${checkpointId} has fewer than two read-only Part Two handoff decisions`);
      }
      await screenshot(`${checkpointId}-handoff.png`);
    }
    checkpoints.push(record);
    await writeFile(join(outDir, `${checkpointId}.json`), `${JSON.stringify(record, null, 2)}\n`);
    await writeFile(join(outDir, "progress.json"), `${JSON.stringify({ status: "RUNNING", runId, completedTurns: turnNumber, checkpoints }, null, 2)}\n`);
    console.log(`[${checkpointId}] PASS section=${prefix.partOne.sectionId} part=${prefix.partOne.partCompletionStatus}`);
  }

  const finalSnapshot = await databaseSnapshot(runId);
  const partOne = finalSnapshot.run?.stateJson?.partOne || {};
  const visitedSections = [...new Set(finalSnapshot.resolutions.map((item) => item.outcomeJson?.partOneEvent?.sectionIdBefore).filter(Boolean))];
  const completedKernelIds = Array.isArray(partOne.completedKernelIds) ? partOne.completedKernelIds : [];
  const finalChecks = {
    completedRequestedTurns: checkpoints.length === turnLimit + 1,
    oneAttemptPerTurn: finalSnapshot.attempts.length === turnLimit,
    oneSubmissionPerTurn: finalSnapshot.submissions.length === turnLimit,
    oneActionPerTurn: finalSnapshot.actions.length === turnLimit,
    oneResolutionPerTurn: finalSnapshot.resolutions.length === turnLimit,
    exactlyOneNarratorAndDecisionCallPerTurn: finalSnapshot.attempts.every((item) =>
      item.providerCallCount === 2
      && item.timingsJson?.providerCallCount === 2
      && item.timingsJson?.narrationProviderCallCount === 1
      && item.timingsJson?.decisionProviderCallCount === 1
    ),
    noRetriesOrFallbacks: finalSnapshot.attempts.every((item) => item.status === "PUBLISHED" && !item.failureReason),
    noRuntimeExceptions: cdp.exceptions.length === 0,
    noFailedRequests: cdp.failedRequests.filter((item) => !item.canceled).length === 0
  };
  const twentyTurnChecks = turnLimit === 20 ? {
    exactlyTwentyTurns: finalSnapshot.resolutions.length === 20,
    allFourSectionsVisited: ["SEC-P1-01", "SEC-P1-02", "SEC-P1-03", "SEC-P1-04"].every((id) => visitedSections.includes(id)),
    allFifteenKernelsCompleted: completedKernelIds.length === 15,
    handoffReady: partOne.partCompletionStatus === "HANDOFF_READY",
    runCompleted: finalSnapshot.run?.status === "chapter_generated"
  } : null;
  const allExecutedChecksPass = Object.values(finalChecks).every(Boolean)
    && (!twentyTurnChecks || Object.values(twentyTurnChecks).every(Boolean));
  const report = {
    schemaVersion: "sangtian-part-one-continuous-dev-v1",
    status: allExecutedChecksPass ? "ENGINEERING_PASS" : "REPAIR_REQUIRED",
    formalPlayerAcceptance: playerChoiceIndices ? "PENDING_POST_RUN_PLAYER_REVIEW" : "NOT_PERFORMED",
    selectionMode,
    warning: playerChoiceIndices
      ? "The coherent player path completed, but every visible checkpoint still requires Codex player review before acceptance."
      : "This deterministic branch soak is not the Codex blind-player G00-T20 acceptance run.",
    runId,
    route: `${webBase}/role-select?story=sangtian&start=new`,
    requestedTurns: turnLimit,
    visitedSections,
    completedKernelIds,
    finalPartOneState: partOne,
    finalChecks,
    twentyTurnChecks,
    checkpoints,
    finalDatabaseSnapshot: serializableSnapshot(finalSnapshot),
    runtimeExceptions: cdp.exceptions,
    consoleErrors: cdp.consoleErrors,
    failedRequests: cdp.failedRequests.filter((item) => !item.canceled),
    network: cdp.network,
    capturedAt: new Date().toISOString()
  };
  await writeFile(join(outDir, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, runId, evidenceDir: outDir, finalChecks, visitedSections, completedKernelIds }, null, 2));
  if (report.status !== "ENGINEERING_PASS") process.exitCode = 1;
} catch (error) {
  await sleep(500);
  const failure = {
    schemaVersion: "sangtian-part-one-continuous-dev-v1",
    status: "FAILED",
    formalPlayerAcceptance: playerChoiceIndices ? "FAILED_BEFORE_PLAYER_REVIEW" : "NOT_PERFORMED",
    selectionMode,
    runId,
    message: error instanceof Error ? error.stack || error.message : String(error),
    checkpoints,
    runtimeExceptions: cdp?.exceptions || [],
    consoleErrors: cdp?.consoleErrors || [],
    failedRequests: cdp?.failedRequests || [],
    network: cdp?.network || [],
    responseBodies: cdp?.responseBodies || [],
    capturedAt: new Date().toISOString()
  };
  await writeFile(join(outDir, "result.json"), `${JSON.stringify(failure, null, 2)}\n`);
  console.error(failure.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
  try { await cdp?.send("Browser.close"); } catch {}
  cdp?.close();
  if (chrome.exitCode === null) chrome.kill();
  chrome.unref();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
