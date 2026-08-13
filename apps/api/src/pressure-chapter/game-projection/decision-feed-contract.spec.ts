import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { AEmotionFeedItemPortV1 } from "./contracts";

type DecisionCompilerFeedFields = Pick<
  AEmotionFeedItemPortV1,
  | "eventId"
  | "disclosure"
  | "responseOptions"
  | "isAcknowledged"
  | "isResolved"
  | "projectionHash"
>;

const COMPILER_FIELDS: ReadonlyArray<keyof DecisionCompilerFeedFields> = [
  "eventId",
  "disclosure",
  "responseOptions",
  "isAcknowledged",
  "isResolved",
  "projectionHash",
];

test("viewer-safe feed keeps the exact response authority and decision compiler seam", () => {
  const compiler = readFileSync(resolve(
    process.cwd(),
    "apps/api/src/pressure-chapter/integration/decision-command.compiler.ts",
  ), "utf8");
  const adapter = readFileSync(resolve(
    process.cwd(),
    "apps/api/src/pressure-chapter/integration/a-emotion-response-authority.adapter.ts",
  ), "utf8");
  for (const field of ["eventId", "disclosure", "responseOptions", "projectionHash"] as const) {
    assert.match(adapter, new RegExp(`aggregate\\.projection\\.${field}\\b`, "u"));
  }
  assert.match(adapter, /delivery\.acknowledgedAt\b/u);
  assert.match(adapter, /delivery\.resolvedAt\b/u);
  for (const field of [
    "sourceEventId", "disclosure", "responseOptions", "resolved", "projectionHash",
  ] as const) {
    assert.match(compiler, new RegExp(`source\\?*\\.${field}\\b`, "u"));
  }
  assert.doesNotMatch(
    compiler,
    /!source\.acknowledged\b/u,
    "ACK is an accepted-action receipt, never a compile prerequisite",
  );
  assert.deepEqual(COMPILER_FIELDS, [
    "eventId", "disclosure", "responseOptions", "isAcknowledged", "isResolved", "projectionHash",
  ]);
  const knownFactRefsAreInternal: "knownFactRefs" extends keyof AEmotionFeedItemPortV1
    ? false
    : true = true;
  assert.equal(knownFactRefsAreInternal, true);
});

test("A-Emotion outbox dedupe namespace remains isolated", () => {
  for (const relative of [
    "apps/api/src/pressure-chapter/a-emotion-production/content-source.ts",
    "apps/api/src/pressure-chapter/a-emotion-production/lifecycle-source.ts",
  ]) {
    const source = readFileSync(resolve(process.cwd(), relative), "utf8");
    assert.match(source, /dedupeKey:\s*`aemotion:\$\{job\.jobHash\}`/u);
    assert.doesNotMatch(source, /dedupeKey:\s*`(?:narrative|progress):/u);
  }
});
