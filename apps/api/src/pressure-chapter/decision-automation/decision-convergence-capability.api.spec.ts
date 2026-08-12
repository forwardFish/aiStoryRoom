import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  DecisionConvergenceDependenciesV1,
  PressureDecisionConvergencePortV1,
} from "./contracts";
import type { PressureDecisionAutomationProductionInputV1 } from "./factory";

type ForbiddenCapabilityWord =
  | "provider"
  | "openai"
  | "openovel"
  | "narrative"
  | "modelclient"
  | "modelnetwork";

type ContainsForbiddenCapability<Key extends string> =
  Lowercase<Key> extends `${string}${ForbiddenCapabilityWord}${string}` ? Key : never;

type ForbiddenKeys<ObjectType> = {
  [Key in Extract<keyof ObjectType, string>]: ContainsForbiddenCapability<Key>;
}[Extract<keyof ObjectType, string>];

const convergenceHasNoModelCapability:
  [ForbiddenKeys<DecisionConvergenceDependenciesV1>] extends [never] ? true : false = true;
const productionInputHasNoModelCapability:
  [ForbiddenKeys<PressureDecisionAutomationProductionInputV1>] extends [never] ? true : false = true;
const publicPortHasNoModelCapability:
  [ForbiddenKeys<PressureDecisionConvergencePortV1>] extends [never] ? true : false = true;

test("decision convergence dependency and production-input types cannot carry a model Provider", () => {
  assert.equal(convergenceHasNoModelCapability, true);
  assert.equal(productionInputHasNoModelCapability, true);
  assert.equal(publicPortHasNoModelCapability, true);
});

test("decision convergence and prepared append sources import no model client and contain no network call site", () => {
  const paths = [
    "convergence.service.ts",
    "prisma-snapshot.ts",
    "../persistence/prepared-automation-action.prisma-adapter.ts",
  ];
  const forbiddenImports: string[] = [];
  const forbiddenCalls: string[] = [];
  for (const relative of paths) {
    const source = readFileSync(resolve(__dirname, relative), "utf8");
    for (const match of source.matchAll(/(?:import|export)\s+(?:type\s+)?[\s\S]*?\sfrom\s+["']([^"']+)["']/gu)) {
      const modulePath = match[1] ?? "";
      if (/(?:openai|openovel|narrative|model[-_.]?client|provider[-_.]?client|node:https?|undici|axios)/iu.test(modulePath)) {
        forbiddenImports.push(`${relative}:${modulePath}`);
      }
    }
    if (/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u.test(source)) forbiddenCalls.push(relative);
  }
  assert.deepEqual(forbiddenImports, []);
  assert.deepEqual(forbiddenCalls, []);
});

test("Phase 1 contains neither appendMany nor five concurrent old submitAction workflows", () => {
  const convergence = readFileSync(resolve(__dirname, "convergence.service.ts"), "utf8");
  const prepared = readFileSync(
    resolve(__dirname, "../persistence/prepared-automation-action.prisma-adapter.ts"),
    "utf8",
  );
  assert.doesNotMatch(convergence, /appendMany/u);
  assert.doesNotMatch(prepared, /appendMany/u);
  assert.doesNotMatch(convergence, /runtime\.submitAction/u);
  assert.doesNotMatch(convergence, /Promise\.all\s*\([^)]*submitAction/su);
});

test("ProductRoot shares one convergence service between HTTP and recovery", () => {
  const root = readFileSync(resolve(__dirname, "../product/product-root.ts"), "utf8");
  assert.match(root, /decision:\s*decisionAutomation\.workerLane/u);
  assert.match(root, /httpPorts\.clock,\s*decisionAutomation\.service,/su);
  assert.equal((root.match(/createPressureDecisionAutomationProductionV1\s*\(/gu) ?? []).length, 1);
});

test("HTTP waits only for authority convergence and final projection, not Narrative or A-Emotion", () => {
  const http = readFileSync(
    resolve(__dirname, "../http/pressure-chapter-http.facade.ts"),
    "utf8",
  );
  const submitIndex = http.indexOf("await this.actions.submitAction(compiled)");
  const convergeIndex = http.indexOf("await this.convergence.converge");
  const projectionIndex = http.indexOf("const projection = await this.game.read");
  assert.ok(submitIndex >= 0 && convergeIndex > submitIndex && projectionIndex > convergeIndex);
  assert.doesNotMatch(http.slice(submitIndex, projectionIndex), /narrative|aEmotion|provider/iu);
});

test("public submit-decision response remains schemaVersion/idempotencyKey/projection", () => {
  const http = readFileSync(
    resolve(__dirname, "../http/pressure-chapter-http.facade.ts"),
    "utf8",
  );
  const method = http.match(/submitDecision\([\s\S]*?return \{([\s\S]*?)\n\s*\};\n\s*\}\);/u);
  assert.ok(method);
  const responseBody = method![1]!;
  assert.match(responseBody, /schemaVersion:\s*"pressure_chapter_submit_decision_http_response_v1"/u);
  assert.match(responseBody, /idempotencyKey:\s*command\.idempotencyKey/u);
  assert.match(responseBody, /^\s*projection,\s*$/mu);
  assert.doesNotMatch(responseBody, /metrics|diagnostics|provider|narrative|aEmotion/iu);
});
