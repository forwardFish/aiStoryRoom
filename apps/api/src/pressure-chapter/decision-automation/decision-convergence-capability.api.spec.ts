import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript";
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
  const { sourceFile, response } = findSubmitDecisionResponseObject(http);
  const properties = new Map<string, ts.ObjectLiteralElementLike>();
  for (const property of response.properties) {
    const name = objectPropertyName(property);
    if (name) properties.set(name, property);
  }

  assert.deepEqual(
    [...properties.keys()].sort(),
    ["idempotencyKey", "projection", "schemaVersion"],
  );

  const schemaVersion = properties.get("schemaVersion");
  assert.ok(schemaVersion && ts.isPropertyAssignment(schemaVersion));
  assert.ok(ts.isStringLiteral(schemaVersion.initializer));
  assert.equal(
    schemaVersion.initializer.text,
    "pressure_chapter_submit_decision_http_response_v1",
  );

  const idempotencyKey = properties.get("idempotencyKey");
  assert.ok(idempotencyKey && ts.isPropertyAssignment(idempotencyKey));
  assert.equal(idempotencyKey.initializer.getText(sourceFile), "command.idempotencyKey");

  const projection = properties.get("projection");
  assert.ok(projection && ts.isShorthandPropertyAssignment(projection));
  assert.equal(projection.name.text, "projection");
});

function findSubmitDecisionResponseObject(source: string): {
  sourceFile: ts.SourceFile;
  response: ts.ObjectLiteralExpression;
} {
  const sourceFile = ts.createSourceFile(
    "pressure-chapter-http.facade.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const methods = sourceFile.statements
    .filter(ts.isClassDeclaration)
    .flatMap((declaration) => declaration.members)
    .filter((member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member))
    .filter((method) => ts.isIdentifier(method.name) && method.name.text === "submitDecision");
  assert.equal(methods.length, 1, "expected exactly one submitDecision method");
  const method = methods[0]!;
  assert.ok(method.body, "submitDecision method body was not found");

  const responses: ts.ObjectLiteralExpression[] = [];
  const collectResponses = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
      const names = node.expression.properties
        .map(objectPropertyName)
        .filter((name): name is string => name !== null);
      if (
        names.includes("schemaVersion")
        && names.includes("idempotencyKey")
        && names.includes("projection")
      ) responses.push(node.expression);
    }
    ts.forEachChild(node, collectResponses);
  };
  collectResponses(method.body);
  assert.equal(responses.length, 1, "expected exactly one submitDecision response object");
  return { sourceFile, response: responses[0]! };
}

function objectPropertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
  if (!ts.isPropertyAssignment(property)) return null;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
    return property.name.text;
  }
  return null;
}
