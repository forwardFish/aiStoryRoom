import { fail, integerAtLeast, isRecord, nonEmptyString, pass, type ValidationResult } from "./schema-utils";

export type ObservableTraceV1 = {
  traceId: string;
  label: string;
  description: string;
  sourceKind: "DOCUMENT" | "PERSON" | "LOCATION" | "RESOURCE" | "EVENT";
  routeOptions: Array<{ routeId: string; label: string; method: string }>;
};

export type PrivateEvidenceCardV1 = {
  evidenceId: string;
  title: string;
  summary: string;
  supports: string;
  cannotProve: string;
  sourceKind: "DOCUMENT" | "TESTIMONY" | "OBSERVATION" | "RECORD";
  provenanceKey: string;
  obtainedFromActionId: string;
  visibility: "PRIVATE" | "PUBLIC";
};

export type ManeuverProjectionV1 = {
  schemaVersion: "maneuver_projection_v1";
  maxPerTurn: 2;
  remaining: number;
  windowState: "OPEN" | "CLOSED";
  stateRevision: number;
  turnRevision: number;
  contacts: Array<{ id: string; label: string }>;
  traces: ObservableTraceV1[];
  leverageAssets: Array<{ id: string; label: string; effectSummary: string }>;
  inProgress: Array<{ actionId: string; label: string; status: string }>;
  privateEvidence: PrivateEvidenceCardV1[];
};

export function validatePrivateEvidenceCardV1(value: unknown): ValidationResult<PrivateEvidenceCardV1> {
  if (!isRecord(value)) return fail(["private evidence card must be an object"]);
  const errors: string[] = [];
  exactFields(value, ["evidenceId", "title", "summary", "supports", "cannotProve", "sourceKind", "provenanceKey", "obtainedFromActionId", "visibility"], "private evidence", errors);
  for (const key of ["evidenceId", "title", "summary", "supports", "cannotProve", "provenanceKey", "obtainedFromActionId"] as const) {
    if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
  }
  if (!["DOCUMENT", "TESTIMONY", "OBSERVATION", "RECORD"].includes(String(value.sourceKind || ""))) errors.push("invalid sourceKind");
  if (!["PRIVATE", "PUBLIC"].includes(String(value.visibility || ""))) errors.push("invalid visibility");
  return errors.length ? fail(errors) : pass(value as PrivateEvidenceCardV1);
}

export function validateManeuverProjectionV1(value: unknown): ValidationResult<ManeuverProjectionV1> {
  if (!isRecord(value)) return fail(["maneuver projection must be an object"]);
  const errors: string[] = [];
  exactFields(value, ["schemaVersion", "maxPerTurn", "remaining", "windowState", "stateRevision", "turnRevision", "contacts", "traces", "leverageAssets", "inProgress", "privateEvidence"], "maneuver projection", errors);
  if (value.schemaVersion !== "maneuver_projection_v1") errors.push("invalid schemaVersion");
  if (value.maxPerTurn !== 2) errors.push("maxPerTurn must be 2");
  if (!integerAtLeast(value.remaining, 0) || Number(value.remaining) > 2) errors.push("remaining must be between 0 and 2");
  if (!["OPEN", "CLOSED"].includes(String(value.windowState || ""))) errors.push("invalid windowState");
  if (!integerAtLeast(value.stateRevision, 0)) errors.push("stateRevision must be >= 0");
  if (!integerAtLeast(value.turnRevision, 0)) errors.push("turnRevision must be >= 0");
  for (const key of ["contacts", "traces", "leverageAssets", "inProgress", "privateEvidence"] as const) {
    if (!Array.isArray(value[key])) errors.push(`${key} must be an array`);
  }

  if (Array.isArray(value.contacts)) value.contacts.forEach((entry, index) => {
    if (!isRecord(entry)) return errors.push(`contacts[${index}] must be an object`);
    exactFields(entry, ["id", "label"], `contacts[${index}]`, errors);
    if (!nonEmptyString(entry.id)) errors.push(`contacts[${index}].id is required`);
    if (!nonEmptyString(entry.label)) errors.push(`contacts[${index}].label is required`);
  });

  if (Array.isArray(value.traces)) value.traces.forEach((entry, index) => {
    if (!isRecord(entry)) return errors.push(`traces[${index}] must be an object`);
    exactFields(entry, ["traceId", "label", "description", "sourceKind", "routeOptions"], `traces[${index}]`, errors);
    if (!nonEmptyString(entry.traceId)) errors.push(`traces[${index}].traceId is required`);
    if (!nonEmptyString(entry.label)) errors.push(`traces[${index}].label is required`);
    if (!nonEmptyString(entry.description)) errors.push(`traces[${index}].description is required`);
    if (!["DOCUMENT", "PERSON", "LOCATION", "RESOURCE", "EVENT"].includes(String(entry.sourceKind || ""))) errors.push(`traces[${index}].sourceKind is invalid`);
    if (!Array.isArray(entry.routeOptions) || entry.routeOptions.length === 0) {
      errors.push(`traces[${index}].routeOptions must be a non-empty array`);
      return;
    }
    entry.routeOptions.forEach((route, routeIndex) => {
      if (!isRecord(route)) return errors.push(`traces[${index}].routeOptions[${routeIndex}] must be an object`);
      exactFields(route, ["routeId", "label", "method"], `traces[${index}].routeOptions[${routeIndex}]`, errors);
      if (!nonEmptyString(route.routeId)) errors.push(`traces[${index}].routeOptions[${routeIndex}].routeId is required`);
      if (!nonEmptyString(route.label)) errors.push(`traces[${index}].routeOptions[${routeIndex}].label is required`);
      if (!nonEmptyString(route.method)) errors.push(`traces[${index}].routeOptions[${routeIndex}].method is required`);
    });
  });

  if (Array.isArray(value.leverageAssets)) value.leverageAssets.forEach((entry, index) => {
    if (!isRecord(entry)) return errors.push(`leverageAssets[${index}] must be an object`);
    exactFields(entry, ["id", "label", "effectSummary"], `leverageAssets[${index}]`, errors);
    if (!nonEmptyString(entry.id)) errors.push(`leverageAssets[${index}].id is required`);
    if (!nonEmptyString(entry.label)) errors.push(`leverageAssets[${index}].label is required`);
    if (!nonEmptyString(entry.effectSummary)) errors.push(`leverageAssets[${index}].effectSummary is required`);
  });

  if (Array.isArray(value.inProgress)) value.inProgress.forEach((entry, index) => {
    if (!isRecord(entry)) return errors.push(`inProgress[${index}] must be an object`);
    exactFields(entry, ["actionId", "label", "status"], `inProgress[${index}]`, errors);
    if (!nonEmptyString(entry.actionId)) errors.push(`inProgress[${index}].actionId is required`);
    if (!nonEmptyString(entry.label)) errors.push(`inProgress[${index}].label is required`);
    if (!nonEmptyString(entry.status)) errors.push(`inProgress[${index}].status is required`);
  });

  if (Array.isArray(value.privateEvidence)) value.privateEvidence.forEach((card, index) => {
    const result = validatePrivateEvidenceCardV1(card);
    if (!result.ok) errors.push(...result.errors.map((error) => `privateEvidence[${index}]: ${error}`));
    if (isRecord(card) && card.visibility !== "PRIVATE") errors.push(`privateEvidence[${index}] must remain PRIVATE`);
  });

  return errors.length ? fail(errors) : pass(value as ManeuverProjectionV1);
}

function exactFields(value: Record<string, unknown>, allowed: string[], path: string, errors: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`unknown ${path} field: ${key}`);
}
