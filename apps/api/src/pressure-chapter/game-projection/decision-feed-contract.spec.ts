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

test("API viewer-safe output and Web exact-key validator share one feed/keyModal contract", () => {
  const api = readFileSync(resolve(
    process.cwd(),
    "apps/api/src/pressure-chapter/game-projection/game-projection.service.ts",
  ), "utf8");
  const web = readFileSync(resolve(
    process.cwd(),
    "apps/web/public/pressure-chapter-game-v1.js",
  ), "utf8");
  assert.match(api, /knownFactRefs:\s*_internalKnownFactRefs/u, "API must explicitly strip internal knownFactRefs");
  const webFeedKeys = web.match(/const allowed = \[([^\]]+)\];/u)?.[1] ?? "";
  assert.doesNotMatch(webFeedKeys, /knownFactRefs/u, "Web requires a field the API intentionally strips");
  const modalKeys = web.match(/exactKeys\(modal, \[([^\]]+)\], path\)/u)?.[1] ?? "";
  for (const field of ["serverSequence", "sourceEventId", "triggerId", "stateVersion", "dedupeKey"]) {
    assert.match(modalKeys, new RegExp(`(?:^|\\W)${field}(?:\\W|$)`, "u"), `Web keyModal rejects API field ${field}`);
  }
  assert.doesNotMatch(web, /integer\(page\.unreadCount,[^\n]*,\s*0,\s*10\)/u, "Web caps global unreadCount at one page");
  assert.doesNotMatch(web, /page\.unreadCount\s*!==\s*page\.items\.filter/u, "Web equates global unreadCount with current-page unread");
});

test("existing game/action path transports one server MODAL_SHOWN mark from the real Web client", () => {
  const controller = readFileSync(resolve(
    process.cwd(),
    "apps/api/src/pressure-chapter/http/controller-methods.ts",
  ), "utf8");
  const facade = readFileSync(resolve(
    process.cwd(),
    "apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.ts",
  ), "utf8");
  const web = readFileSync(resolve(
    process.cwd(),
    "apps/web/public/pressure-chapter-game-v1.js",
  ), "utf8");
  for (const source of [controller, facade, web]) assert.match(source, /MODAL_SHOWN/u);
  assert.match(controller, /POST \/v4\/rooms\/:roomId\/game\/action/u);
  assert.match(web, /\/api\/v4\/rooms\/\$\{encodeURIComponent\(this\.runId\)\}\/game\/action/u);
  assert.doesNotMatch(controller + facade, /modal-shown|modal\/shown|game\/modal/iu, "MODAL_SHOWN added a forbidden API path");
});
