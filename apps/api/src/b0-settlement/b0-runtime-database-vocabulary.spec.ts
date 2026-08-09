import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(process.cwd(), "../..");
const MIGRATION = readFileSync(
  join(ROOT, "prisma", "migrations", "20260809030000_b0_runtime_database_vocabulary", "migration.sql"),
  "utf8",
);
const PIPELINE = readFileSync(join(ROOT, "apps", "api", "src", "b0-settlement", "b0-settlement-pipeline.service.ts"), "utf8");
const COORDINATOR = readFileSync(join(ROOT, "apps", "api", "src", "b0-settlement", "b0-window-coordinator.prisma.ts"), "utf8");
const COMMIT = readFileSync(join(ROOT, "apps", "api", "src", "b0-settlement", "b0-settlement-commit.prisma.ts"), "utf8");

function constraintBody(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = MIGRATION.match(new RegExp(`ADD CONSTRAINT "${escaped}"[\\s\\S]*?;`));
  assert.ok(match, `missing ${name}`);
  return match[0];
}

function assertValues(name: string, values: readonly string[]): void {
  const body = constraintBody(name);
  for (const value of values) assert.match(body, new RegExp(`'${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`), `${name} must admit ${value}`);
}

test("B0 database vocabulary admits every durable state emitted by the synchronized runtime", () => {
  assertValues("ActionWindow_status_check", [
    "OPEN", "LOCKED", "SETTLING", "COMMITTED", "PUBLISHING", "COMPLETED", "FAILED_RETRYABLE", "FAILED_HARD", "ABORTED",
  ]);
  assertValues("ActionWindow_closing_reason_check", ["ALL_READY", "DEADLINE", "IMMEDIATE"]);
  assertValues("ActionWindowParticipant_main_status_check", [
    "B0_PENDING", "B0_READY", "B0_LOCKED", "B0_COMMITTED", "B0_COMPLETED",
  ]);
  assertValues("PlayerAction_action_slot_check", ["B0_PRIMARY"]);
  assertValues("StoryEvent_audience_type_check", ["SYSTEM"]);
  assertValues("StoryTaskOutbox_task_type_check", [
    "B0_SETTLEMENT_REQUESTED", "B0_PUBLISH_STRUCTURED_RESULTS", "B0_NARRATIVE_GENERATION", "B0_WINDOW_EVENT",
  ]);
  assertValues("StoryTaskOutbox_outcome_check", [
    "COMMITTED", "ALREADY_COMMITTED", "PUBLISHED", "ALREADY_PUBLISHED", "NARRATED", "RECORDED",
  ]);
  assert.match(constraintBody("StoryTaskOutbox_dedupe_format_check"), /LIKE 'b0-%'/);
  assertValues("ResolutionWorkflow_status_check", ["B0_PREPARED", "B0_RESOLVING"]);
  assertValues("ResolutionCheckpoint_key_check", ["B0_BATCH_COMMITTED"]);
});

test("the additive vocabulary preserves current non-B0 action contracts", () => {
  assertValues("PlayerAction_action_slot_check", [
    "MAIN", "MANEUVER", "MANEUVER_1", "MANEUVER_2", "REACTION", "SYSTEM_ACTION",
  ]);
  const slots = constraintBody("PlayerAction_action_slot_check");
  for (const pattern of ["TURN:%", "SOLO:%", "SOLO_CLARIFICATION:%", "CONDITION:%"]) assert.ok(slots.includes(`LIKE '${pattern}'`));
  assertValues("PlayerAction_actor_kind_check", [
    "HUMAN", "AI", "AI_TAKEOVER", "SYSTEM", "TIMEOUT_FALLBACK", "LEGACY_AI", "CONDITIONAL",
  ]);
  assertValues("StoryTaskOutbox_task_type_check", [
    "resolve_node", "RESOLVE_WINDOW", "PROJECT_REPAIR", "ROLE_AGENT_DECISION", "ACTOR_OPENING_V2",
    "ACTOR_AGENT_TURN_V2", "ACTOR_RESULT_V2", "ACTOR_IMPACT_V2", "CONDITIONAL_ACTION_V2",
  ]);
});

test("concurrent lazy initialization uses one-statement conflict-safe inserts", () => {
  assert.match(PIPELINE, /roleControl\.createMany\(\{[\s\S]*?skipDuplicates: true/);
  assert.doesNotMatch(PIPELINE, /roleControl\.upsert\(\{[\s\S]*?B0_INITIAL_ROLE_BINDING/);
  assert.doesNotMatch(PIPELINE, /roleControl\.create\(\{[\s\S]*?B0_INITIAL_ROLE_BINDING/);
  assert.match(PIPELINE, /sceneNode\.createMany\(\{[\s\S]*?skipDuplicates: true/);
  assert.match(PIPELINE, /sceneNode\.findUnique\(\{[\s\S]*?runId_chapterIndex_nodeIndex/);
  assert.doesNotMatch(PIPELINE, /sceneNode\.upsert\(\{[\s\S]*?Shared situation/);
  assert.doesNotMatch(PIPELINE, /sceneNode\.create\(\{[\s\S]*?Shared situation/);
});

test("generated HOLD rows use a precise durable actor provenance", () => {
  assert.match(COORDINATOR, /actorKind: existing\?\.actorKind \|\| "TIMEOUT_FALLBACK"/);
  assert.doesNotMatch(COORDINATOR, /SYSTEM_OR_ACTOR/);
});

test("migration covers the exact B0 persistence surfaces", () => {
  for (const token of [
    "B0_SETTLEMENT_REQUESTED", "B0_PUBLISH_STRUCTURED_RESULTS", "B0_NARRATIVE_GENERATION", "B0_WINDOW_EVENT",
    "B0_BATCH_COMMITTED", "B0_PREPARED", "B0_RESOLVING", "B0_PRIMARY", "B0_COMPLETED",
  ]) {
    assert.ok(PIPELINE.includes(token) || COORDINATOR.includes(token) || COMMIT.includes(token), `${token} must be emitted by a B0 persistence surface`);
    assert.ok(MIGRATION.includes(`'${token}'`) || token === "B0_PRIMARY", `${token} must be admitted by the migration`);
  }
});
