import "reflect-metadata";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "ai-story-room-http-"));
  process.env.MVP_STORY_DATA_DIR = dataDir;
  process.env.AI_CAUSAL_PROVIDER = "rules";
  process.env.MVP_STORY_STORAGE = "file";
  delete process.env.DATABASE_URL;
  process.env.DISABLE_PRISMA = "true";

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  app.enableCors({ origin: true, credentials: true });

  try {
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    if (!address || typeof address === "string") throw new Error("API did not bind a TCP port");
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const anonymousCreate = await fetch(`${baseUrl}/v4/story-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storyId: "sangtian", mode: "single" })
    });
    const createPayload = await anonymousCreate.json();
    assert.equal(anonymousCreate.status, 401);
    assert.equal(createPayload.code, "AUTHENTICATION_REQUIRED");

    const anonymousRead = await fetch(`${baseUrl}/v4/story-runs/non-member-run`);
    const readPayload = await anonymousRead.json();
    assert.equal(anonymousRead.status, 401);
    assert.equal(readPayload.code, "AUTHENTICATION_REQUIRED");

    console.log("v4 HTTP public-route and fail-closed authentication assertions passed");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.DISABLE_PRISMA;
    delete process.env.MVP_STORY_STORAGE;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});