import { createHash } from "node:crypto";
import {
  PRESSURE_NARRATIVE_ERROR_CODES as ERROR,
  failPressureNarrative,
} from "./errors.js";

export function canonicalNarrativeJson(value: unknown): string {
  return canonical(value, "$", new WeakSet<object>());
}

export function hashNarrativeValue(value: unknown): string {
  return createHash("sha256").update(canonicalNarrativeJson(value)).digest("hex");
}

function canonical(value: unknown, path: string, ancestors: WeakSet<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (!value || typeof value !== "object") {
    failPressureNarrative(ERROR.JOB_INVALID, path, "NON_JSON_VALUE");
  }
  if (ancestors.has(value)) failPressureNarrative(ERROR.JOB_INVALID, path, "CYCLIC_VALUE");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const unexpectedKey = Reflect.ownKeys(value).find((key) => {
        if (key === "length") return false;
        return typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key);
      });
      if (unexpectedKey !== undefined) {
        failPressureNarrative(ERROR.JOB_INVALID, path, "ARRAY_EXTRA_PROPERTY");
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) failPressureNarrative(ERROR.JOB_INVALID, `${path}[${index}]`, "SPARSE_ARRAY");
      }
      return `[${value.map((entry, index) => canonical(entry, `${path}[${index}]`, ancestors)).join(",")}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      failPressureNarrative(ERROR.JOB_INVALID, path, "NON_PLAIN_OBJECT");
    }
    const record = value as Record<string, unknown>;
    if (Reflect.ownKeys(record).some((key) => typeof key === "symbol")) {
      failPressureNarrative(ERROR.JOB_INVALID, path, "SYMBOL_PROPERTY");
    }
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key], `${path}.${key}`, ancestors)}`)
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}
