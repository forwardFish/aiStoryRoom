import "reflect-metadata";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpException, HttpStatus } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../apps/api/src/app.module";
import { ApiContractExceptionFilter, configureApiTransport } from "../../apps/api/src/api-transport";

type Result = { status: number; payload: any; headers: Headers };

async function request(baseUrl: string, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}): Promise<Result> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, payload: text ? JSON.parse(text) : null, headers: response.headers };
}

function assertEnvelope(result: Result, status: number, code?: string) {
  assert.equal(result.status, status);
  assert.equal(typeof result.payload?.code, "string");
  assert.equal(typeof result.payload?.message, "string");
  assert.ok(Object.hasOwn(result.payload, "details"));
  if (code) assert.equal(result.payload.code, code);
}

function syntheticEnvelope(status: number) {
  let written: any;
  const response = { status(value: number) { assert.equal(value, status); return this; }, json(value: any) { written = value; } };
  const host: any = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ method: "GET", url: "/synthetic" }) }) };
  new ApiContractExceptionFilter().catch(new HttpException({ code: `TEST_${status}`, message: `status ${status}`, details: { transport: true } }, status), host);
  assert.equal(written.code, `TEST_${status}`);
  assert.equal(written.message, `status ${status}`);
  return written;
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "ai-story-room-contract-"));
  const original = { DATABASE_URL: process.env.DATABASE_URL, MVP_STORY_DATA_DIR: process.env.MVP_STORY_DATA_DIR, MVP_STORY_STORAGE: process.env.MVP_STORY_STORAGE, AI_CAUSAL_PROVIDER: process.env.AI_CAUSAL_PROVIDER, API_WRITE_RATE_LIMIT_PER_MINUTE: process.env.API_WRITE_RATE_LIMIT_PER_MINUTE };
  let app: any;
  try {
    delete process.env.DATABASE_URL;
    process.env.MVP_STORY_DATA_DIR = dataDir;
    process.env.MVP_STORY_STORAGE = "file";
    process.env.AI_CAUSAL_PROVIDER = "rules";
    process.env.API_WRITE_RATE_LIMIT_PER_MINUTE = "120";
    app = await NestFactory.create(AppModule, { logger: false });
    configureApiTransport(app);
    app.setGlobalPrefix("api");
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    if (!address || typeof address === "string") throw new Error("API did not bind a TCP port");
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    const catalog = await request(baseUrl, "/v4/stories");
    assert.equal(catalog.status, 200);
    assert.equal(catalog.payload.featured.id, "sangtian");
    const detail = await request(baseUrl, "/v4/stories/sangtian");
    assert.equal(detail.status, 200);
    const roles = await request(baseUrl, "/v4/stories/sangtian/roles");
    assert.equal(roles.status, 200);
    assert.equal(JSON.stringify(roles.payload).includes("hiddenMeaning"), false);

    assertEnvelope(await request(baseUrl, "/v4/stories/not-found"), 404, "NOT_FOUND");
    assertEnvelope(await request(baseUrl, "/v4/story-runs", "POST", { storyId: "not-found" }), 400, "VALIDATION_ERROR");
    const created = await request(baseUrl, "/v4/story-runs", "POST", { storyId: "sangtian", selectedRoleKey: "zhejiang_governor" });
    assert.equal(created.status, 201);
    const run = created.payload;
    assert.equal(JSON.stringify(run).includes("privateReasoningSummary"), false);
    const messages = await request(baseUrl, `/v4/story-runs/${run.run.id}/messages`);
    assert.equal(messages.status, 200);
    const dashboard = await request(baseUrl, `/v4/story-runs/${run.run.id}/dashboard`);
    assert.equal(dashboard.status, 200);
    assert.equal(JSON.stringify(dashboard.payload).includes("hiddenMeaning"), false);

    const decision = await request(baseUrl, `/v4/story-runs/${run.run.id}/messages/${run.activeDecision.messageId}/decisions`, "POST", { version: run.run.version, optionKey: "A" });
    assert.equal(decision.status, 201);
    const stale = await request(baseUrl, `/v4/story-runs/${run.run.id}/messages/${decision.payload.activeDecision.messageId}/decisions`, "POST", { version: run.run.version, optionKey: "A" });
    assertEnvelope(stale, 409, "VERSION_CONFLICT");
    assert.equal(typeof stale.payload.currentVersion, "number");
    const blocked = await request(baseUrl, `/v4/story-runs/${run.run.id}/maneuvers`, "POST", { version: decision.payload.run.version, maneuverType: "custom", customText: "命令巡抚立即认罪" });
    assertEnvelope(blocked, 422, "ACTION_BLOCKED");

    const allowedCors = await request(baseUrl, "/v4/stories", "GET", undefined, { origin: "http://127.0.0.1:5200" });
    assert.equal(allowedCors.headers.get("access-control-allow-origin"), "http://127.0.0.1:5200");
    const deniedCors = await request(baseUrl, "/v4/stories", "GET", undefined, { origin: "https://untrusted.example" });
    assert.equal(deniedCors.headers.get("access-control-allow-origin"), null);

    process.env.API_WRITE_RATE_LIMIT_PER_MINUTE = "1";
    const limited = await request(baseUrl, "/v4/story-runs", "POST", { storyId: "sangtian" });
    assertEnvelope(limited, 429, "RATE_LIMITED");
    const synthetic502 = syntheticEnvelope(502);
    const synthetic503 = syntheticEnvelope(503);

    const result = {
      schemaVersion: "v4-api-contract-audit-v1",
      status: "PASS",
      api: ["FT-API-001", "FT-API-002", "FT-API-003", "FT-API-004", "FT-API-005", "FT-API-006", "FT-API-007", "FT-API-008", "FT-API-010", "FT-API-013", "FT-API-014", "FT-API-016", "FT-API-017"],
      localOnlyAuthBoundary: "v4 MVP has no production identity binding; the API accepts no user identity and writes only its isolated local run store.",
      errorStatuses: { 400: "VALIDATION_ERROR", 404: "NOT_FOUND", 409: "VERSION_CONFLICT", 422: "ACTION_BLOCKED", 429: "RATE_LIMITED", 502: synthetic502.code, 503: synthetic503.code },
      completedAt: new Date().toISOString()
    };
    await mkdir(join(process.cwd(), "docs/auto-execute/results"), { recursive: true });
    await writeFile(join(process.cwd(), "docs/auto-execute/results/v4-api-contract-audit.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
