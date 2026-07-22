import { readFileSync } from "node:fs";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import type { EvidenceAuthoring, WorldBibleAuthoring } from "./types";

export function validateEvidenceAuthoringSchema(value: unknown, schemaPath: string): asserts value is EvidenceAuthoring {
  validateSchema(value, schemaPath, "AUTHORING_JSON_SCHEMA_INVALID");
}

export function validateWorldBibleAuthoringSchema(value: unknown, schemaPath: string): asserts value is WorldBibleAuthoring {
  validateSchema(value, schemaPath, "WORLD_BIBLE_AUTHORING_SCHEMA_INVALID");
}

function validateSchema(value: unknown, schemaPath: string, errorCode: string): void {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  if (validate(value)) return;

  const details = (validate.errors || []).map(formatError).join("; ");
  throw new Error(`${errorCode}: ${details || "unknown schema violation"}`);
}

function formatError(error: ErrorObject): string {
  const path = error.instancePath || "/";
  return `${path} ${error.message || error.keyword}`;
}
