import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3102/api").replace(/\/$/, "");

async function request<T>(path: string, options: { method?: string; data?: unknown } = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: options.data === undefined ? undefined : JSON.stringify(options.data)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  return payload as T;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`V4_DATABASE_SMOKE_FAIL: ${message}`);
}

async function main() {
  await request("/health");
  const created = await request<any>("/v4/story-runs", { method: "POST", data: { storyId: "sangtian", mode: "single", selectedRoleKey: "zhejiang_governor" } });
  const runId = created.run.id;
  const days: any[] = [];

  for (let day = 1; day <= 4; day += 1) {
    let view = await request<any>(`/v4/story-runs/${runId}`);
    assert(view.run.currentDay === day, `expected day ${day}, got ${view.run.currentDay}`);
    if (view.maneuverState.maneuverOpportunitiesRemaining > 0) {
      view = await request<any>(`/v4/story-runs/${runId}/maneuvers`, {
        method: "POST",
        data: { version: view.run.version, maneuverType: "contact", targetRoleKey: "county_magistrate", intentKey: "verify", idempotencyKey: `db-smoke-${day}` }
      });
    }
    for (let decision = 0; decision < 2; decision += 1) {
      const selected = view.activeDecision;
      assert(selected?.messageId, `day ${day} decision ${decision + 1} missing`);
      view = await request<any>(`/v4/story-runs/${runId}/messages/${selected.messageId}/decisions`, {
        method: "POST",
        data: { version: view.run.version, optionKey: decision % 2 === 0 ? "A" : "B" }
      });
    }
    days.push({ day, version: view.run.version, decisionCount: view.run.decisionsCompletedToday, maneuverCount: view.maneuverState.maneuversUsedToday, eventCount: view.meta.eventCount });
    if (day < 4) view = await request<any>(`/v4/story-runs/${runId}/advance-day`, { method: "POST", data: { version: view.run.version } });
  }

  const prisma = new PrismaClient();
  try {
    const stored = await prisma.storyRun.findUnique({ where: { id: runId }, include: { storyEvents: true, aiTasks: true } });
    assert(stored, "StoryRun was not persisted in Prisma");
    const eventTypes = [...new Set(stored.storyEvents.map((event) => event.type))].sort();
    for (const type of ["run_created", "decision_submitted", "maneuver", "maneuver_result", "state_patch", "pursuit_updated", "fate_seed_created"]) assert(eventTypes.includes(type), `missing StoryEvent type ${type}`);
    assert(stored.currentDay === 4 && stored.version > 1, "snapshot day/version was not updated");
    assert(stored.storyEvents.length >= 20, `expected append-only events, got ${stored.storyEvents.length}`);
    assert(stored.aiTasks.length >= 8, `expected AI/fallback task ledger, got ${stored.aiTasks.length}`);
    assert(stored.aiTasks.every((task) => ["fallback", "completed"].includes(task.status)), "AI task ledger has an invalid status");
    const hasFallbackTask = stored.aiTasks.some((task) => task.status === "fallback");
    const hasFallbackEvent = eventTypes.includes("ai_fallback");
    assert(hasFallbackTask === hasFallbackEvent, "AI fallback event and task ledger must agree when a provider call falls back");
    const report = { status: "PASS", apiBase: API_BASE, runId, days, snapshot: { currentDay: stored.currentDay, version: stored.version }, storyEventCount: stored.storyEvents.length, eventTypes, aiTaskCount: stored.aiTasks.length, aiStatuses: [...new Set(stored.aiTasks.map((task) => task.status))], narrativePath: hasFallbackTask ? "fallback" : "provider_completed" };
    await mkdir("scripts/test-reports", { recursive: true });
    const output = join("scripts/test-reports", `v4-database-smoke-${Date.now()}.json`);
    await writeFile(output, JSON.stringify(report, null, 2), "utf8");
    console.log(`V4_DATABASE_SMOKE_PASS ${output}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
