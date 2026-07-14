import "reflect-metadata";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

type StoryView = Record<string, any>;

async function main() {
const dataDir = await mkdtemp(join(tmpdir(), "ai-story-room-http-"));
process.env.MVP_STORY_DATA_DIR = dataDir;
process.env.AI_CAUSAL_PROVIDER = "rules";
process.env.MVP_STORY_STORAGE = "file";
delete process.env.DATABASE_URL;
process.env.DISABLE_PRISMA = "true";

async function startApi() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  app.enableCors({ origin: true, credentials: true });
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  if (!address || typeof address === "string") throw new Error("API did not bind a TCP port");
  return { app, baseUrl: `http://127.0.0.1:${address.port}/api` };
}

async function request(baseUrl: string, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

let firstApi: Awaited<ReturnType<typeof startApi>> | undefined;
let secondApi: Awaited<ReturnType<typeof startApi>> | undefined;

try {
  firstApi = await startApi();
  let response = await request(firstApi.baseUrl, "/v4/story-runs", "POST", { storyId: "sangtian" });
  assert.equal(response.status, 201, JSON.stringify(response.payload));
  let view = response.payload as StoryView;
  const runId = view.run.id;
  assert.equal(view.run.currentDay, 1);

  response = await request(firstApi.baseUrl, `/v4/story-runs/${runId}/finalize`, "POST", {
    version: view.run.version
  });
  assert.equal(response.status, 409, "the API must reject early finalization");
  assert.notEqual(response.payload?.code ?? response.payload?.message?.code, "VERSION_CONFLICT", "phase conflicts must keep their own reason");
  const unchanged = await request(firstApi.baseUrl, `/v4/story-runs/${runId}`);
  assert.equal(unchanged.payload.run.version, view.run.version, "a rejected mutation must not alter version");

  for (let day = 1; day <= 6; day += 1) {
    for (let decision = 0; decision < 2; decision += 1) {
      response = await request(
        firstApi.baseUrl,
        `/v4/story-runs/${runId}/messages/${view.activeDecision.messageId}/decisions`,
        "POST",
        { optionKey: "A", customText: "", version: view.run.version }
      );
      assert.equal(response.status, 201);
      view = response.payload;
      if (day === 1 && decision === 0) {
        const stale = await request(
          firstApi.baseUrl,
          `/v4/story-runs/${runId}/messages/${view.activeDecision.messageId}/decisions`,
          "POST",
          { optionKey: "A", customText: "", version: view.run.version - 1 }
        );
        assert.equal(stale.status, 409);
        assert.equal(stale.payload?.code ?? stale.payload?.message?.code, "VERSION_CONFLICT");
      }
    }
    assert.equal(view.run.status, "awaiting_day_advance");
    assert.ok(view.daySummary, `day ${day} must expose its day-end summary`);
    response = await request(firstApi.baseUrl, `/v4/story-runs/${runId}/advance-day`, "POST", {
      version: view.run.version
    });
    assert.equal(response.status, 201);
    view = response.payload;
  }

  assert.equal(view.run.currentDay, 7);
  assert.equal(view.run.totalDecisionsCompleted, 12);
  assert.equal(view.run.status, "awaiting_finalization");
  response = await request(firstApi.baseUrl, `/v4/story-runs/${runId}/finalize`, "POST", {
    version: view.run.version
  });
  assert.equal(response.status, 201);
  view = response.payload;
  assert.equal(view.run.status, "finished");
  assert.ok(view.finalJudgement?.globalEnding?.title);
  assert.ok(view.finalJudgement?.personalEnding?.rank);
  assert.ok(view.finalJudgement?.emperorJudgement);
  assert.ok(view.finalJudgement?.futureAftermath);
  assert.ok(
    view.finalJudgement.causalExplanation.keyMovesThatSavedYou.every(
      (item: any) => item.originEventId && item.text
    )
  );

  const publicPayload = JSON.stringify(view);
  for (const privateField of [
    "privateReasoningSummary",
    "hiddenIntent",
    "hiddenMeaning",
    "backfireTriggers"
  ]) {
    assert.equal(publicPayload.includes(privateField), false, `${privateField} must stay server-private`);
  }

  await firstApi.app.close();
  firstApi = undefined;
  secondApi = await startApi();
  const restored = await request(secondApi.baseUrl, `/v4/story-runs/${runId}`);
  assert.equal(restored.status, 200);
  assert.equal(restored.payload.run.status, "finished");
  assert.equal(restored.payload.run.totalDecisionsCompleted, 12);
  assert.deepEqual(restored.payload.finalJudgement, view.finalJudgement);

  console.log("v4 HTTP full-flow and restart-persistence assertions passed");
} finally {
  await firstApi?.app.close();
  await secondApi?.app.close();
  await rm(dataDir, { recursive: true, force: true });
  delete process.env.DISABLE_PRISMA;
  delete process.env.MVP_STORY_STORAGE;
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
