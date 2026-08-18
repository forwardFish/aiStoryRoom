import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DecisionAutomationDependenciesV1 } from "./contracts";
import {
  createPressureDecisionAutomationProductionV1,
  type PressureDecisionAutomationProductionInputV1,
} from "./factory";

type ForbiddenCapabilityWord =
  | "provider"
  | "openai"
  | "openovel"
  | "narrative"
  | "modelclient";

type ContainsForbiddenCapability<Key extends string> =
  Lowercase<Key> extends `${string}${ForbiddenCapabilityWord}${string}`
    ? Key
    : never;

type ForbiddenKeys<ObjectType> = {
  [Key in Extract<keyof ObjectType, string>]: ContainsForbiddenCapability<Key>;
}[Extract<keyof ObjectType, string>];

const dependencyTypeHasNoForbiddenCapability:
  [ForbiddenKeys<DecisionAutomationDependenciesV1>] extends [never]
    ? true
    : false = true;

const productionInputTypeHasNoForbiddenCapability:
  [ForbiddenKeys<PressureDecisionAutomationProductionInputV1>] extends [never]
    ? true
    : false = true;

test("AI decision dependency and production-input types cannot carry a model Provider", () => {
  assert.equal(dependencyTypeHasNoForbiddenCapability, true);
  assert.equal(productionInputTypeHasNoForbiddenCapability, true);
});

test("production composition never reads an undeclared Provider/OpenAI/OpenNovel/Narrative capability", () => {
  const declaredInputKeys = new Set<PropertyKey>([
    "prisma",
    "routes",
    "orchestrators",
    "working",
    "seats",
    "content",
    "runtime",
    "deadlineDefaults",
    "clock",
    "config",
    "aiPolicyOptions",
    "submitPageSnapshots",
  ]);
  const undeclaredCapabilityReads: string[] = [];
  const input = new Proxy({
    prisma: {},
    routes: { readRoute: async () => null },
    orchestrators: { read: async () => null },
    working: { load: async () => { throw new Error("not invoked during composition"); } },
    seats: { readSnapshot: async () => null },
    content: { load: async () => { throw new Error("not invoked during composition"); } },
    runtime: {
      submitAction: async () => { throw new Error("not invoked during composition"); },
      resume: async () => { throw new Error("not invoked during composition"); },
      advanceDeadline: async () => { throw new Error("not invoked during composition"); },
    },
    deadlineDefaults: {
      advanceExpiredDecision: async () => { throw new Error("not invoked during composition"); },
      applyAiFailure: async () => { throw new Error("not invoked during composition"); },
    },
    clock: { nowMs: () => 1 },
  } as PressureDecisionAutomationProductionInputV1, {
    get: (target, property, receiver) => {
      if (!declaredInputKeys.has(property)) {
        const name = String(property);
        undeclaredCapabilityReads.push(name);
        throw new Error(`Production composition attempted undeclared capability: ${name}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });

  const bundle = createPressureDecisionAutomationProductionV1(input);

  assert.equal(bundle.policy.artifactSha256.length, 64);
  assert.deepEqual(
    undeclaredCapabilityReads,
    [],
    "Provider call count is necessarily zero because production composition cannot read that capability",
  );
});

test("production decision-automation sources import no model client and contain no network call site", () => {
  const sourceRoot = resolve(__dirname);
  const sourceFiles = readdirSync(sourceRoot)
    .filter((fileName) => fileName.endsWith(".ts"))
    .filter((fileName) => !fileName.endsWith(".spec.ts") && !fileName.endsWith(".test.ts"))
    .sort();
  const forbiddenImports: string[] = [];
  const forbiddenCallSites: string[] = [];

  for (const fileName of sourceFiles) {
    const source = readFileSync(resolve(sourceRoot, fileName), "utf8");
    const importPattern = /(?:import|export)\s+(?:type\s+)?[\s\S]*?\sfrom\s+["']([^"']+)["']/gu;
    for (const match of source.matchAll(importPattern)) {
      const modulePath = match[1] ?? "";
      if (/(?:openai|openovel|narrative|model[-_.]?client|provider[-_.]?client|node:https?|undici|axios)/iu.test(modulePath)) {
        forbiddenImports.push(`${fileName}:${modulePath}`);
      }
    }
    if (/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u.test(source)) {
      forbiddenCallSites.push(fileName);
    }
  }

  assert.deepEqual(forbiddenImports, []);
  assert.deepEqual(forbiddenCallSites, []);
  assert.ok(sourceFiles.includes("factory.ts"));
  assert.ok(sourceFiles.includes("service.ts"));
  assert.ok(sourceFiles.includes("content-policy.adapter.ts"));
});
