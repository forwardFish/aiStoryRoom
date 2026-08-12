import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  REQUIRED_PRESSURE_MODELS,
  RETIRED_PRESSURE_MODELS,
  verifyPressurePersistenceArtifacts,
} from "./migration-verifier";
import {
  PRESSURE_OUTBOX_CHECKPOINTS,
  PRESSURE_OUTBOX_STATUSES,
  PRESSURE_OUTBOX_TASK_TYPES,
} from "./vocabulary";

const repositoryRoot = resolve(__dirname, "../../../../../");
const schemaPath = resolve(repositoryRoot, "prisma/schema.prisma");
const migrationPath = resolve(
  repositoryRoot,
  "prisma/migrations/20260812090000_pressure_chapter_v1_expand/migration.sql",
);
const downstreamMigrationPath = resolve(
  repositoryRoot,
  "prisma/migrations/20260812173000_pressure_authority_downstream_expand/migration.sql",
);
const lobbyMigrationPath = resolve(
  repositoryRoot,
  "prisma/migrations/20260812160000_pressure_lobby_idempotency_expand/migration.sql",
);
const actionRunScopeMigrationPath = resolve(
  repositoryRoot,
  "prisma/migrations/20260812190000_pressure_action_run_scope_unique/migration.sql",
);

test("Pressure MVP migration is additive and creates exactly twelve tables", () => {
  const schema = readFileSync(schemaPath, "utf8");
  const migration = readFileSync(migrationPath, "utf8");
  const result = verifyPressurePersistenceArtifacts(schema, migration);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(REQUIRED_PRESSURE_MODELS.length, 12);
});

test("PC-W1 Prisma and SQL vocabularies stay aligned", () => {
  const schema = readFileSync(schemaPath, "utf8");
  const migration = readFileSync(migrationPath, "utf8");
  const downstreamMigration = readFileSync(downstreamMigrationPath, "utf8");
  const appliedSql = `${migration}\n${downstreamMigration}`;
  for (const value of [
    ...PRESSURE_OUTBOX_TASK_TYPES,
    ...PRESSURE_OUTBOX_STATUSES,
    ...PRESSURE_OUTBOX_CHECKPOINTS,
  ]) {
    assert.match(schema, new RegExp(`\\b${value}\\b`));
    assert.match(appliedSql, new RegExp(`'${value}'`));
  }
});

test("follow-up migrations preserve ordering without mutating the consolidated schema", () => {
  for (const migration of [
    readFileSync(lobbyMigrationPath, "utf8"),
    readFileSync(downstreamMigrationPath, "utf8"),
  ]) {
    assert.match(migration, /Intentionally empty/u);
    assert.doesNotMatch(
      migration,
      /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|TYPE|INDEX)\b|\b(?:DELETE|TRUNCATE|UPDATE|INSERT|RENAME)\b/iu,
    );
  }
});

test("decision action ordinal uniqueness is scoped to one run", () => {
  const schema = readFileSync(schemaPath, "utf8");
  const migration = readFileSync(actionRunScopeMigrationPath, "utf8");
  assert.match(
    schema,
    /@@unique\(\[runId, decisionPointId, seatId, actionOrdinal\], map: "pc_action_point_seat_ordinal_key"\)/u,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "pc_action_point_seat_ordinal_key"\s+ON "PressureDecisionAction"\("runId", "decisionPointId", "seatId", "actionOrdinal"\);/u,
  );
  assert.doesNotMatch(migration, /\b(?:DROP|ALTER)\s+TABLE\b|\b(?:DELETE|TRUNCATE|UPDATE|INSERT|RENAME)\b/iu);
});

test("every Prisma scalar field has an identically named SQL column", () => {
  const migration = [
    readFileSync(migrationPath, "utf8"),
    readFileSync(lobbyMigrationPath, "utf8"),
    readFileSync(downstreamMigrationPath, "utf8"),
  ].join("\n");
  for (const modelName of REQUIRED_PRESSURE_MODELS) {
    const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
    assert.ok(model, `generated Prisma DMMF must contain ${modelName}`);
    const expectedColumns = model.fields
      .filter((field) => field.kind === "scalar" || field.kind === "enum")
      .map((field) => field.dbName ?? field.name)
      .sort();
    const tableMatch = migration.match(
      new RegExp(`CREATE TABLE \\\"${modelName}\\\" \\(([\\s\\S]*?)\\n\\);`),
    );
    assert.ok(tableMatch, `migration must contain CREATE TABLE ${modelName}`);
    const columnSection = tableMatch[1].split(/^\s+CONSTRAINT\s+/m, 1)[0];
    const actualColumns = new Set(
      [...columnSection.matchAll(/^\s+"([^"]+)"\s+/gm)].map((match) => match[1]),
    );
    const alterPattern = new RegExp(
      `ALTER TABLE \\"${modelName}\\"([\\s\\S]*?);`,
      "g",
    );
    for (const alter of migration.matchAll(alterPattern)) {
      for (const added of alter[1].matchAll(/ADD COLUMN "([^"]+)"/g)) {
        actualColumns.add(added[1]);
      }
    }
    assert.deepEqual([...actualColumns].sort(), expectedColumns, `${modelName} SQL columns must match Prisma`);
  }
});

test("consolidated authority fields replace retired child tables", () => {
  const schema = readFileSync(schemaPath, "utf8");
  const migration = readFileSync(migrationPath, "utf8");
  assert.match(schema, /model PressureChapterRuntime[\s\S]*?decisionStateJson\s+Json[\s\S]*?ledgerProjectionJson\s+Json/u);
  assert.match(schema, /model PressureChapterSettlement[\s\S]*?frozenBundleHash\s+String/u);
  assert.match(schema, /model PressureNarrativeProjection[\s\S]*?artifactJson\s+Json\?[\s\S]*?artifactContentHash\s+String\?/u);
  assert.match(schema, /model PressureSeatControlSnapshot[\s\S]*?runId\s+String\s+@unique[\s\S]*?snapshotJson\s+Json[\s\S]*?version\s+Int/u);
  for (const retired of RETIRED_PRESSURE_MODELS) {
    assert.doesNotMatch(schema, new RegExp(`\\bmodel\\s+${retired}\\s*\\{`));
    assert.doesNotMatch(migration, new RegExp(`CREATE TABLE \\"${retired}\\"`));
  }
  assert.doesNotMatch(migration, /ALTER TABLE "StoryRun"/u);
});
