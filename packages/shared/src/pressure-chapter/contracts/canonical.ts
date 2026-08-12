import { createHash } from "node:crypto";
import {
  PRESSURE_CHAPTER_CONTRACT_ERROR_CODES as ERROR,
  failPressureContract,
} from "./errors";

export type CanonicalJsonPrimitive = string | number | boolean | null;
export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };
export type CanonicalJsonObject = { [key: string]: CanonicalJsonValue };

const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Strict JSON canonicalization for authoritative hashes.
 *
 * Object keys use Unicode code-unit order. Arrays retain their contract-defined
 * semantic order: callers must sort set-like arrays before this boundary. Values
 * that JSON.stringify would silently drop or coerce are rejected instead.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, "$", new WeakSet<object>());
}

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256Canonical(value: unknown): string {
  return sha256Utf8(canonicalJson(value));
}

/**
 * Locale-independent ordering for identifiers that participate in hashes.
 * `localeCompare` is deliberately forbidden at authority boundaries because
 * its collation may vary with the host ICU/locale configuration.
 */
export function compareCanonicalText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

export function withoutField<T extends Record<string, unknown>>(
  value: T,
  field: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== field),
  );
}

export function hashWithoutField<T extends Record<string, unknown>>(
  value: T,
  field: string,
): string {
  return sha256Canonical(withoutField(value, field));
}

function serialize(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      failPressureContract(ERROR.CANONICAL_JSON_UNSUPPORTED, path, "NON_FINITE_NUMBER");
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value !== "object") {
    failPressureContract(
      ERROR.CANONICAL_JSON_UNSUPPORTED,
      path,
      typeof value,
    );
  }

  const objectValue = value as object;
  if (ancestors.has(objectValue)) {
    failPressureContract(ERROR.CANONICAL_JSON_CYCLE, path);
  }
  ancestors.add(objectValue);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          failPressureContract(
            ERROR.CANONICAL_JSON_UNSUPPORTED,
            `${path}[${index}]`,
            "SPARSE_ARRAY",
          );
        }
      }
      const extraKey = Object.keys(value).find(
        (key) => !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length,
      );
      if (extraKey || Object.getOwnPropertySymbols(value).length > 0) {
        failPressureContract(
          ERROR.CANONICAL_JSON_UNSUPPORTED,
          path,
          "ARRAY_EXTRA_PROPERTY",
        );
      }
      return `[${value
        .map((item, index) => serialize(item, `${path}[${index}]`, ancestors))
        .join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      failPressureContract(
        ERROR.CANONICAL_JSON_UNSUPPORTED,
        path,
        "NON_PLAIN_OBJECT",
      );
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      failPressureContract(
        ERROR.CANONICAL_JSON_UNSUPPORTED,
        path,
        "SYMBOL_PROPERTY",
      );
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${serialize(record[key], `${path}.${key}`, ancestors)}`,
      )
      .join(",")}}`;
  } finally {
    ancestors.delete(objectValue);
  }
}
