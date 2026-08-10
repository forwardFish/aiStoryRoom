import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENDGAME_PACKAGE_SCHEMA_ID,
  ENDGAME_RUN_PACKAGE_BINDING_SCHEMA_VERSION,
  EndgamePackageLoadError,
  EndgamePackageRegistryV1,
  assertFormalSchemaIdentityV1,
  freezeEndgamePackageForRunV1,
  loadEndgamePackageFileV1,
  loadEndgamePackageV1,
  parseEndgamePackageJsonV1,
  resolveFrozenEndgamePackageForRunV1,
  validateEndgamePackageAgainstSchemaV1
} from "../src/endgame/endgame-package-loader-v1.mjs";
import { canonicalizeJcs, computeEndgamePackageHash } from "../src/endgame/endgame-package-v1.contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const neutralPath = resolve(root, "packages/templates/config/endgame/fixtures/neutral-synthetic.endgame.fixture.json");
const schemaPath = resolve(root, "packages/shared/schemas/endgame/endgame-package-v1.schema.json");
const neutral = JSON.parse(await readFile(neutralPath, "utf8"));
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const clone = (value) => structuredClone(value);

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof EndgamePackageLoadError && error.code === code);
}

test("S1 formal schema identity is frozen", () => {
  assert.equal(assertFormalSchemaIdentityV1(schema), schema);
  assert.equal(schema.$id, ENDGAME_PACKAGE_SCHEMA_ID);
});

test("S1 rejects a different JSON Schema draft", () => {
  const changed = clone(schema);
  changed.$schema = "http://json-schema.org/draft-07/schema#";
  expectCode(() => assertFormalSchemaIdentityV1(changed), "ENDGAME_SCHEMA_DRAFT_UNSUPPORTED");
});

test("S1 validates neutral package through the closed schema contract", () => {
  assert.equal(validateEndgamePackageAgainstSchemaV1(neutral, schema), neutral);
});

test("S1 rejects malformed JSON", () => {
  expectCode(() => parseEndgamePackageJsonV1("{"), "ENDGAME_PACKAGE_JSON_INVALID");
});

test("S1 rejects unknown package fields", () => {
  const changed = clone(neutral);
  changed.runtimeOverride = true;
  expectCode(() => loadEndgamePackageV1(changed), "ENDGAME_PACKAGE_SCHEMA_INVALID");
});

test("S1 rejects unknown package schema versions", () => {
  const changed = clone(neutral);
  changed.schemaVersion = "endgame_package_v2";
  expectCode(() => loadEndgamePackageV1(changed), "ENDGAME_PACKAGE_SCHEMA_INVALID");
});

test("S1 rejects incomplete references", () => {
  const changed = clone(neutral);
  changed.presentation.metricOrder = ["not_registered"];
  expectCode(() => loadEndgamePackageV1(changed), "ENDGAME_PACKAGE_SCHEMA_INVALID");
});

test("S1 loader computes the frozen RFC 8785 packageHash", () => {
  const loaded = loadEndgamePackageV1(neutral, { schemaDocument: schema, sourceId: "neutral" });
  assert.equal(loaded.packageRef.packageHash, computeEndgamePackageHash(neutral));
  assert.equal(loaded.snapshot.canonicalPackage, canonicalizeJcs(neutral));
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(Object.isFrozen(loaded.snapshot.packageDocument.metrics), true);
});

test("S1 freezes policy id, version, hash and canonical snapshot into a run", () => {
  const snapshot = loadEndgamePackageV1(neutral).snapshot;
  const binding = freezeEndgamePackageForRunV1({ runId: "run-neutral-1", packageSnapshot: snapshot });
  assert.equal(binding.schemaVersion, ENDGAME_RUN_PACKAGE_BINDING_SCHEMA_VERSION);
  assert.deepEqual(binding.packageRef, {
    policyId: neutral.policyId,
    policyVersion: neutral.policyVersion,
    packageHash: computeEndgamePackageHash(neutral)
  });
  assert.equal(binding.canonicalPackage, snapshot.canonicalPackage);
  assert.equal(Object.isFrozen(binding), true);
});

test("S1 resolves the exact same hash for the same frozen run", () => {
  const snapshot = loadEndgamePackageV1(neutral).snapshot;
  const binding = freezeEndgamePackageForRunV1({ runId: "run-neutral-2", packageSnapshot: snapshot });
  const first = resolveFrozenEndgamePackageForRunV1(binding);
  const second = resolveFrozenEndgamePackageForRunV1(structuredClone(binding));
  assert.equal(first.packageHash, second.packageHash);
  assert.equal(first.canonicalPackage, second.canonicalPackage);
});

test("S1 disk or registry hot changes cannot alter an existing run", () => {
  const registry = new EndgamePackageRegistryV1();
  registry.register(neutral);
  const binding = registry.bindRun({ runId: "run-hot-reload", policyId: neutral.policyId, policyVersion: "1.0.0" });

  const next = clone(neutral);
  next.policyVersion = "1.0.1";
  next.metrics[0].label = "Changed only for future runs";
  registry.register(next);

  const oldSnapshot = registry.resolveRun(binding);
  const newBinding = registry.bindRun({ runId: "run-hot-reload-next", policyId: next.policyId, policyVersion: "1.0.1" });
  const newSnapshot = registry.resolveRun(newBinding);
  assert.equal(oldSnapshot.packageDocument.metrics[0].label, neutral.metrics[0].label);
  assert.equal(oldSnapshot.packageHash, binding.packageRef.packageHash);
  assert.notEqual(oldSnapshot.packageHash, newSnapshot.packageHash);
});

test("S1 rejects a missing immutable snapshot", () => {
  const snapshot = loadEndgamePackageV1(neutral).snapshot;
  const binding = structuredClone(freezeEndgamePackageForRunV1({ runId: "run-missing", packageSnapshot: snapshot }));
  binding.canonicalPackage = "";
  expectCode(() => resolveFrozenEndgamePackageForRunV1(binding), "ENDGAME_RUN_PACKAGE_SNAPSHOT_MISSING");
});

test("S1 rejects a package hash mismatch", () => {
  const snapshot = loadEndgamePackageV1(neutral).snapshot;
  const binding = structuredClone(freezeEndgamePackageForRunV1({ runId: "run-hash", packageSnapshot: snapshot }));
  binding.packageRef.packageHash = "0".repeat(64);
  expectCode(() => resolveFrozenEndgamePackageForRunV1(binding), "ENDGAME_RUN_PACKAGE_HASH_MISMATCH");
});

test("S1 rejects non-canonical frozen JSON bytes", () => {
  const snapshot = loadEndgamePackageV1(neutral).snapshot;
  const binding = structuredClone(freezeEndgamePackageForRunV1({ runId: "run-canonical", packageSnapshot: snapshot }));
  binding.canonicalPackage = JSON.stringify(JSON.parse(binding.canonicalPackage), null, 2);
  expectCode(() => resolveFrozenEndgamePackageForRunV1(binding), "ENDGAME_RUN_PACKAGE_NOT_CANONICAL");
});

test("S1 rejects a frozen policy reference mismatch", () => {
  const snapshot = loadEndgamePackageV1(neutral).snapshot;
  const binding = structuredClone(freezeEndgamePackageForRunV1({ runId: "run-ref", packageSnapshot: snapshot }));
  binding.packageRef.policyId = "other_policy";
  expectCode(() => resolveFrozenEndgamePackageForRunV1(binding), "ENDGAME_RUN_PACKAGE_REF_MISMATCH");
});

test("S1 rejects unknown run binding versions", () => {
  const snapshot = loadEndgamePackageV1(neutral).snapshot;
  const binding = structuredClone(freezeEndgamePackageForRunV1({ runId: "run-version", packageSnapshot: snapshot }));
  binding.schemaVersion = "endgame_run_package_binding_v2";
  expectCode(() => resolveFrozenEndgamePackageForRunV1(binding), "ENDGAME_RUN_BINDING_VERSION_UNSUPPORTED");
});

test("S1 rejects unknown run binding fields", () => {
  const snapshot = loadEndgamePackageV1(neutral).snapshot;
  const binding = structuredClone(freezeEndgamePackageForRunV1({ runId: "run-closed", packageSnapshot: snapshot }));
  binding.livePackagePath = "/tmp/current.json";
  expectCode(() => resolveFrozenEndgamePackageForRunV1(binding), "ENDGAME_CLOSED_OBJECT_VIOLATION");
});

test("S1 rejects reuse of one policy version with different bytes", () => {
  const registry = new EndgamePackageRegistryV1();
  registry.register(neutral);
  const changed = clone(neutral);
  changed.metrics[0].label = "Conflicting bytes";
  expectCode(() => registry.register(changed), "ENDGAME_POLICY_VERSION_HASH_CONFLICT");
});

test("S1 package registration is idempotent for identical bytes", () => {
  const registry = new EndgamePackageRegistryV1();
  const first = registry.register(neutral);
  const second = registry.register(clone(neutral));
  assert.equal(first, second);
});

test("S1 file loader supports an injected durable reader", async () => {
  const calls = [];
  const loaded = await loadEndgamePackageFileV1("virtual/endgame.json", {
    schemaDocument: schema,
    readFile: async (path, encoding) => {
      calls.push([path, encoding]);
      return JSON.stringify(neutral);
    }
  });
  assert.deepEqual(calls, [["virtual/endgame.json", "utf8"]]);
  assert.equal(loaded.packageRef.packageHash, computeEndgamePackageHash(neutral));
});

test("S1 invalid run ids fail closed", () => {
  const snapshot = loadEndgamePackageV1(neutral).snapshot;
  expectCode(() => freezeEndgamePackageForRunV1({ runId: "", packageSnapshot: snapshot }), "ENDGAME_RUN_ID_INVALID");
});
