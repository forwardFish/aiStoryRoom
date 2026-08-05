import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createPrivateEvidenceCardV1,
  preserveSameProvenanceEvidenceV1,
  privateEvidenceAssetKeyV1,
  projectPrivateEvidenceV1,
  readPrivateEvidenceCardV1,
  validateInvestigationOutcomeDefinitionsV1,
} from "./maneuver-v1.evidence";

const outcome = {
  routeId: "route.compare_records",
  factKey: "fact.record_changed",
  title: "Signed record comparison",
  summary: "Two signed records contain different timestamps.",
  supports: "The record changed after the first signature.",
  cannotProve: "Who intended the change.",
  sourceKind: "RECORD" as const,
  provenanceKey: "source.record.primary",
};

test("an evidence card states both support and limitation", () => {
  const card = createPrivateEvidenceCardV1({ actionId: "action.1", roleId: "role.reviewer", outcome });
  assert.equal(card.supports, outcome.supports);
  assert.equal(card.cannotProve, outcome.cannotProve);
  assert.equal(card.visibility, "PRIVATE");
});

test("private evidence asset keys are stable per owner and provenance", () => {
  assert.equal(
    privateEvidenceAssetKeyV1("role.reviewer", "source.record.primary"),
    privateEvidenceAssetKeyV1("role.reviewer", "source.record.primary"),
  );
  assert.notEqual(
    privateEvidenceAssetKeyV1("role.reviewer", "source.record.primary"),
    privateEvidenceAssetKeyV1("role.observer", "source.record.primary"),
  );
});

test("projection returns full evidence only to its owner", () => {
  const card = createPrivateEvidenceCardV1({ actionId: "action.1", roleId: "role.reviewer", outcome });
  const rows = [{ id: "asset.1", ownerRoleId: "role.reviewer", visibility: "PRIVATE", stateJson: card }];
  assert.deepEqual(projectPrivateEvidenceV1("role.reviewer", rows), [card]);
  assert.deepEqual(projectPrivateEvidenceV1("role.observer", rows), []);
});

test("public or differently owned rows cannot leak through private projection", () => {
  const card = createPrivateEvidenceCardV1({ actionId: "action.1", roleId: "role.reviewer", outcome });
  const rows = [
    { id: "asset.1", ownerRoleId: "role.reviewer", visibility: "PUBLIC", stateJson: card },
    { id: "asset.2", ownerRoleId: "role.other", visibility: "PRIVATE", stateJson: card },
  ];
  assert.deepEqual(projectPrivateEvidenceV1("role.reviewer", rows), []);
});

test("same provenance is preserved instead of upgraded", () => {
  const existing = createPrivateEvidenceCardV1({ actionId: "action.first", roleId: "role.reviewer", outcome });
  const proposed = createPrivateEvidenceCardV1({
    actionId: "action.second",
    roleId: "role.reviewer",
    outcome: { ...outcome, title: "A stronger-looking duplicate", supports: "A broader claim." },
  });
  assert.deepEqual(preserveSameProvenanceEvidenceV1(existing, proposed), existing);
});

test("outcome definitions are fail-closed and route-unique", () => {
  assert.deepEqual(validateInvestigationOutcomeDefinitionsV1([outcome]), [outcome]);
  assert.throws(() => validateInvestigationOutcomeDefinitionsV1([{ ...outcome, hiddenTruth: "leak" }]), /MANEUVER_OUTCOMES_INVALID/);
  assert.throws(() => validateInvestigationOutcomeDefinitionsV1([outcome, outcome]), /duplicateRoute/);
});

test("evidence cards reject unknown or malformed fields", () => {
  const card = createPrivateEvidenceCardV1({ actionId: "action.1", roleId: "role.reviewer", outcome });
  assert.deepEqual(readPrivateEvidenceCardV1(card), card);
  assert.throws(() => readPrivateEvidenceCardV1({ ...card, internalFactKey: "fact.secret" }), /PRIVATE_EVIDENCE_INVALID/);
});

test("generic evidence source contains no first-world vocabulary", () => {
  const source = readFileSync(path.resolve(process.cwd(), "src/maneuver-v1/maneuver-v1.evidence.ts"), "utf8");
  for (const forbidden of ["巡抚", "田契", "粮册", "桑田", "凯撒", "元老院"]) {
    assert.equal(source.includes(forbidden), false, `generic source contains ${forbidden}`);
  }
});
