import { createHash } from "node:crypto";
import { validatePrivateEvidenceCardV1, type PrivateEvidenceCardV1 } from "@ai-story/shared";

export type InvestigationOutcomeDefinitionV1 = {
  routeId: string;
  factKey: string;
  title: string;
  summary: string;
  supports: string;
  cannotProve: string;
  sourceKind: PrivateEvidenceCardV1["sourceKind"];
  provenanceKey: string;
};

export type EvidenceAssetRowV1 = {
  id: string;
  ownerRoleId: string | null;
  visibility: string;
  stateJson: unknown;
};

export function validateInvestigationOutcomeDefinitionsV1(value: unknown): InvestigationOutcomeDefinitionV1[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("MANEUVER_OUTCOMES_INVALID:outcomes");
  const seenRoutes = new Set<string>();
  return value.map((entry, index) => {
    const row = record(entry, `outcomes[${index}]`);
    const exact = ["routeId", "factKey", "title", "summary", "supports", "cannotProve", "sourceKind", "provenanceKey"];
    for (const key of Object.keys(row)) if (!exact.includes(key)) throw new Error(`MANEUVER_OUTCOMES_INVALID:outcomes[${index}].${key}`);
    const routeId = text(row.routeId, `outcomes[${index}].routeId`);
    if (seenRoutes.has(routeId)) throw new Error(`MANEUVER_OUTCOMES_INVALID:duplicateRoute:${routeId}`);
    seenRoutes.add(routeId);
    const sourceKind = String(row.sourceKind || "");
    if (!["DOCUMENT", "TESTIMONY", "OBSERVATION", "RECORD"].includes(sourceKind)) {
      throw new Error(`MANEUVER_OUTCOMES_INVALID:outcomes[${index}].sourceKind`);
    }
    return {
      routeId,
      factKey: text(row.factKey, `outcomes[${index}].factKey`),
      title: text(row.title, `outcomes[${index}].title`),
      summary: text(row.summary, `outcomes[${index}].summary`),
      supports: text(row.supports, `outcomes[${index}].supports`),
      cannotProve: text(row.cannotProve, `outcomes[${index}].cannotProve`),
      sourceKind: sourceKind as PrivateEvidenceCardV1["sourceKind"],
      provenanceKey: text(row.provenanceKey, `outcomes[${index}].provenanceKey`),
    };
  });
}

export function privateEvidenceAssetKeyV1(roleId: string, provenanceKey: string): string {
  const digest = createHash("sha256").update(`${roleId}\0${provenanceKey}`).digest("hex").slice(0, 32);
  return `evidence:v1:${digest}`;
}

export function createPrivateEvidenceCardV1(input: {
  actionId: string;
  roleId: string;
  outcome: InvestigationOutcomeDefinitionV1;
}): PrivateEvidenceCardV1 {
  return {
    evidenceId: privateEvidenceAssetKeyV1(input.roleId, input.outcome.provenanceKey),
    title: input.outcome.title,
    summary: input.outcome.summary,
    supports: input.outcome.supports,
    cannotProve: input.outcome.cannotProve,
    sourceKind: input.outcome.sourceKind,
    provenanceKey: input.outcome.provenanceKey,
    obtainedFromActionId: input.actionId,
    visibility: "PRIVATE",
  };
}

export function readPrivateEvidenceCardV1(value: unknown): PrivateEvidenceCardV1 {
  const result = validatePrivateEvidenceCardV1(value);
  if (!result.ok) throw new Error(`PRIVATE_EVIDENCE_INVALID:${result.errors.join("|")}`);
  return result.value;
}

export function projectPrivateEvidenceV1(viewerRoleId: string, rows: EvidenceAssetRowV1[]): PrivateEvidenceCardV1[] {
  return rows.flatMap((row) => {
    if (row.ownerRoleId !== viewerRoleId || row.visibility !== "PRIVATE") return [];
    return [readPrivateEvidenceCardV1(row.stateJson)];
  });
}

export function preserveSameProvenanceEvidenceV1(
  existing: PrivateEvidenceCardV1 | null,
  proposed: PrivateEvidenceCardV1,
): PrivateEvidenceCardV1 {
  if (!existing) return proposed;
  if (existing.provenanceKey !== proposed.provenanceKey) throw new Error("PRIVATE_EVIDENCE_PROVENANCE_MISMATCH");
  return existing;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`MANEUVER_OUTCOMES_INVALID:${path}`);
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 500) throw new Error(`MANEUVER_OUTCOMES_INVALID:${path}`);
  return value.trim();
}
