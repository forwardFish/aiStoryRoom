import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

type Json = Record<string, any>;

const API_BASE = String(
  process.env.MANY_WORLDS_API_BASE
  || process.env.API_BASE
  || "http://127.0.0.1:3104/api",
).replace(/\/$/, "");
const STAMP = Date.now();
const FORMAL_ACCEPTANCE = ["1", "true", "yes", "on"].includes(
  String(process.env.FORMAL_ACCEPTANCE || "").trim().toLowerCase(),
);
const ACCEPTANCE_NAMESPACE = String(
  process.env.ACCEPTANCE_DATA_NAMESPACE || "",
).trim().toLowerCase();
if (
  FORMAL_ACCEPTANCE
  && !/^omw-dkl-[a-z0-9][a-z0-9-]{5,95}$/u.test(ACCEPTANCE_NAMESPACE)
) {
  throw new Error("V4_DATABASE_SMOKE_FORMAL_NAMESPACE_INVALID");
}
const EMAIL = FORMAL_ACCEPTANCE
  ? `${ACCEPTANCE_NAMESPACE}-v4-db-${STAMP}@example.test`
  : `mw-openovel-v4-${STAMP}@example.test`;
const PASSWORD = "OpenNovelV4Smoke2026!";
const MAIL_SINKS = [...new Set([
  process.env.AUTH_MAIL_SINK_FILE ? resolve(process.env.AUTH_MAIL_SINK_FILE) : "",
  resolve(".auth-mail-sink.ndjson"),
  resolve("apps/api/.auth-mail-sink.ndjson"),
].filter(Boolean))];

async function requestWithResponse(path: string, init: RequestInit = {}, credential = "") {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  if (credential.startsWith("many_worlds_session=")) headers.set("cookie", credential);
  else if (credential) headers.set("authorization", `Bearer ${credential}`);
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as Json;
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  }
  return { payload, response };
}

async function request(path: string, init: RequestInit = {}, credential = "") {
  return (await requestWithResponse(path, init, credential)).payload;
}

function post(path: string, data: Json, credential = "") {
  return request(path, { method: "POST", body: JSON.stringify(data) }, credential);
}

function postWithResponse(path: string, data: Json, credential = "") {
  return requestWithResponse(path, { method: "POST", body: JSON.stringify(data) }, credential);
}

function sessionCookie(response: Response) {
  const values = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    || [response.headers.get("set-cookie") || ""];
  for (const value of values) {
    const match = value.match(/(?:^|,\s*)many_worlds_session=([^;]+)/);
    if (match) return `many_worlds_session=${match[1]}`;
  }
  throw new Error("login did not issue the HttpOnly session cookie");
}

async function verificationToken(email: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const contents = await Promise.all(MAIL_SINKS.map((path) => readFile(path, "utf8").catch(() => "")));
    const lines = contents.flatMap((content) => content.trim().split(/\r?\n/).filter(Boolean)).reverse();
    for (const line of lines) {
      const message = JSON.parse(line) as Json;
      if (String(message.to || "").toLowerCase() !== email.toLowerCase()) continue;
      const urlText = String(message.text || message.html || "").match(/https?:\/\/[^\s<]+/)?.[0];
      if (!urlText) continue;
      const token = new URL(urlText.replace(/&amp;/g, "&")).searchParams.get("token");
      if (token) return token;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`verification mail not found for ${email}`);
}

function assertPlayerStory(value: unknown, label: string) {
  const text = String(value || "").trim();
  assert.ok(text.length >= 80, `${label} must contain a playable story scene`);
  assert.ok((text.match(/[\u3400-\u9fff]/g) || []).length >= 30, `${label} must contain readable Chinese prose`);
  assert.doesNotMatch(text, /factKey|stateKey|entityId|allowedPredicates|narrativeSeed|JSON|内部状态|验收关键词/i);
}

function assertPlayerDecisions(values: unknown, label: string) {
  assert.ok(Array.isArray(values), `${label} must be an array`);
  assert.ok(values.length >= 2 && values.length <= 4, `${label} must contain 2-4 decisions`);
  for (const decision of values) {
    const visibleText = String(decision.description || decision.label || "").trim();
    assert.ok(visibleText.length >= 6, `${label} must use understandable player language`);
    assert.ok(decision.id, `${label} decision id is required`);
    assert.doesNotMatch(visibleText, /factKey|stateKey|entityId|Predicate|Reviewer|JSON/i);
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const health = await request("/health");
    assert.ok(health, "API health endpoint must answer");

    const registration = await post("/v4/auth/register", {
      email: EMAIL,
      password: PASSWORD,
      nickname: "OpenNovel V4 Database Smoke",
    });
    assert.equal(registration.accepted, true);
    assert.equal("verificationToken" in registration, false, "registration must not expose verification secrets");
    await post("/v4/auth/verify", { token: await verificationToken(EMAIL) });
    const login = await postWithResponse("/v4/auth/login", { email: EMAIL, password: PASSWORD });
    const credential = sessionCookie(login.response);
    const currentUser = await request("/v4/auth/me", {}, credential);
    assert.equal(currentUser.email, EMAIL);
    const onboarding = await post("/v4/credits/onboarding", {}, credential);
    assert.ok(
      Number(onboarding.balance?.available || 0) >= 20,
      "verified new player onboarding must provide enough World Credits to start one run",
    );

    const createKey = `v4-db-smoke-create-${STAMP}`;
    const created = await post("/v4/rooms/solo", {
      worldId: "sangtian",
      roleKey: "zhejiang_governor",
      idempotencyKey: createKey,
      resumeExisting: false,
    }, credential);
    const runId = String(created.roomId || created.runId || created.id || "");
    assert.match(runId, /^solo_ovl_[a-f0-9]{32}$/, "Solo product route must create an OpenNovel run");

    const opening = created.gameProjection || await request(`/v4/rooms/${runId}/game`, {}, credential);
    assert.equal(opening.schemaVersion, "continuous_game_projection_v2");
    assert.equal(opening.room?.worldId, "sangtian");
    assert.equal(opening.room?.mode, "solo");
    assert.equal(opening.worldSequence, 0);
    assertPlayerStory(opening.currentTurn?.narrative, "G00 story");
    assertPlayerDecisions(opening.currentTurn?.decisions, "G00 decisions");

    const selected = opening.currentTurn.decisions[0];
    const decisionKey = `v4-db-smoke-turn-${STAMP}`;
    const decisionCommand = {
      idempotencyKey: decisionKey,
      turnRevision: opening.currentTurn.revision,
      controlEpoch: opening.control.epoch,
      candidateId: selected.id,
      intent: selected.intentDraft,
    };
    const decided = await post(
      `/v4/rooms/${runId}/game/turns/${opening.currentTurn.id}/decision`,
      decisionCommand,
      credential,
    );
    assert.equal(decided.accepted, true);
    assert.equal(decided.resolution?.appliedWorldSequence, 1);
    assertPlayerStory(decided.resolution?.resultNarrative, "T01 result story");
    assert.equal(decided.gameProjection?.worldSequence, 1);
    assertPlayerStory(decided.gameProjection?.currentTurn?.narrative, "T01 committed canon");
    assertPlayerDecisions(decided.gameProjection?.currentTurn?.decisions, "T01 decisions");

    const replayed = await post(
      `/v4/rooms/${runId}/game/turns/${opening.currentTurn.id}/decision`,
      decisionCommand,
      credential,
    );
    assert.equal(replayed.accepted, true);
    assert.equal(replayed.resolution?.id, decided.resolution?.id);
    assert.equal(replayed.gameProjection?.worldSequence, 1, "idempotent replay must not create a second turn");

    const runtimeReadback = await request(`/v4/openovel/runs/${runId}`, {}, credential);
    assert.equal(runtimeReadback.schemaVersion, "openovel_game_projection_v1");
    assert.equal(runtimeReadback.turnNumber, 1);

    const [stored, actions, nodes, events] = await Promise.all([
      prisma.storyRun.findUnique({ where: { id: runId } }),
      prisma.playerAction.findMany({ where: { runId }, orderBy: { createdAt: "asc" } }),
      prisma.sceneNode.findMany({ where: { runId }, orderBy: { createdAt: "asc" } }),
      prisma.eventLog.findMany({ where: { runId }, orderBy: { createdAt: "asc" } }),
    ]);
    assert.ok(stored, "StoryRun must be persisted");
    assert.equal(stored.engineVersion, "openovel_v1");
    assert.equal(stored.templateKey, "sangtian");
    assert.equal(stored.status, "playing");
    assert.equal(stored.currentDay, 1);
    assert.equal(Number((stored.stateJson as Json)?.openovel?.turnNumber), 1);
    assert.equal(actions.length, 1, "one decision plus one replay must persist exactly one PlayerAction");
    assert.equal(actions[0]?.status, "resolved");
    const resolvedNodes = nodes.filter((node) => node.status === "resolved");
    assert.equal(resolvedNodes.length, 1, "one committed turn must persist exactly one resolved scene node");
    const eventNames = events.map((event) => event.eventName);
    assert.equal(eventNames.filter((name) => name === "openovel_run_created").length, 1);
    assert.equal(eventNames.filter((name) => name === "openovel_turn_committed").length, 1);

    const report = {
      status: "PASS",
      apiBase: API_BASE,
      syntheticEmail: EMAIL,
      runId,
      engineVersion: stored.engineVersion,
      turnNumber: runtimeReadback.turnNumber,
      selectedDecision: String(selected.description || selected.label),
      playerActionCount: actions.length,
      totalSceneNodeCount: nodes.length,
      resolvedSceneCount: resolvedNodes.length,
      eventNames,
      onboardingCreditsAvailable: Number(onboarding.balance?.available || 0),
      idempotentReplayPreservedWorldSequence: replayed.gameProjection.worldSequence,
      checkedAt: new Date().toISOString(),
    };
    await mkdir("scripts/test-reports", { recursive: true });
    const output = join("scripts/test-reports", `v4-database-smoke-${STAMP}.json`);
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`V4_DATABASE_SMOKE_PASS ${output}`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});