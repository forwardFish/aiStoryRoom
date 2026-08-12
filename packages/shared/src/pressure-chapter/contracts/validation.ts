import {
  hashWithoutField,
  isSha256,
  sha256Canonical,
  type CanonicalJsonObject,
} from "./canonical";
import {
  PRESSURE_CHAPTER_CONTRACT_ERROR_CODES as ERROR,
  failPressureContract,
  type PressureChapterContractErrorCode,
} from "./errors";

export type RawContract = Record<string, unknown>;

export function contractObject(value: unknown, path: string): RawContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failPressureContract(ERROR.CONTRACT_NOT_OBJECT, path);
  }
  return value as RawContract;
}

export function exactContractKeys(
  value: RawContract,
  keys: readonly string[],
  path: string,
): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) {
    failPressureContract(ERROR.CONTRACT_UNKNOWN_FIELD, `${path}.${unknown}`);
  }
  const missing = keys.find((key) => !(key in value));
  if (missing) {
    failPressureContract(ERROR.CONTRACT_MISSING_FIELD, `${path}.${missing}`);
  }
}

export function contractString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, path, "NON_EMPTY_STRING");
  }
  return value;
}

export function contractVersion(value: unknown, path: string): string {
  const result = contractString(value, path);
  if (/^(?:TBD|TODO|UNKNOWN)$/i.test(result)) {
    failPressureContract(ERROR.RUN_ROUTE_INCOMPLETE, path, result);
  }
  return result;
}

export function contractLiteral<T extends string | number | boolean>(
  value: unknown,
  expected: T,
  path: string,
  code: PressureChapterContractErrorCode = ERROR.CONTRACT_FIELD_INVALID,
): T {
  if (value !== expected) {
    failPressureContract(code, path, `EXPECTED_${String(expected)}`);
  }
  return expected;
}

export function contractEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  code: PressureChapterContractErrorCode = ERROR.CONTRACT_FIELD_INVALID,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    failPressureContract(code, path, `ALLOWED_${allowed.join("|")}`);
  }
  return value as T;
}

export function contractInteger(
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    failPressureContract(
      ERROR.CONTRACT_FIELD_INVALID,
      path,
      `INTEGER_${minimum}_${maximum}`,
    );
  }
  return Number(value);
}

export function contractNumber(
  value: unknown,
  path: string,
  minimum = Number.NEGATIVE_INFINITY,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, path, "FINITE_NUMBER");
  }
  return value;
}

export function contractBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, path, "BOOLEAN");
  }
  return value;
}

export function contractSha256(
  value: unknown,
  path: string,
  code: PressureChapterContractErrorCode = ERROR.CONTRACT_FIELD_INVALID,
): string {
  if (!isSha256(value)) failPressureContract(code, path, "SHA256_LOWER_HEX");
  return value;
}

export function contractArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, path, "ARRAY");
  }
  return value;
}

export function contractStringArray(
  value: unknown,
  path: string,
  options: { nonEmpty?: boolean; sorted?: boolean } = {},
): string[] {
  const result = contractArray(value, path).map((item, index) =>
    contractString(item, `${path}[${index}]`),
  );
  if (options.nonEmpty && result.length === 0) {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, path, "NON_EMPTY_ARRAY");
  }
  assertUnique(result, path);
  if (options.sorted) assertLexicographicallySorted(result, path);
  return result;
}

export function assertUnique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    failPressureContract(ERROR.CONTRACT_DUPLICATE_VALUE, path);
  }
}

export function assertLexicographicallySorted(
  values: readonly string[],
  path: string,
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! > values[index]!) {
      failPressureContract(ERROR.CONTRACT_ORDER_INVALID, path);
    }
  }
}

export function assertOrderedBy<T>(
  values: readonly T[],
  key: (value: T) => string,
  path: string,
  order?: readonly string[],
): void {
  const keys = values.map(key);
  assertUnique(keys, path);
  const rank = order ? new Map(order.map((item, index) => [item, index])) : null;
  for (let index = 1; index < keys.length; index += 1) {
    const previous = rank ? rank.get(keys[index - 1]!) : undefined;
    const current = rank ? rank.get(keys[index]!) : undefined;
    const invalid = rank
      ? previous === undefined || current === undefined || previous >= current
      : keys[index - 1]! > keys[index]!;
    if (invalid) failPressureContract(ERROR.CONTRACT_ORDER_INVALID, path);
  }
}

export function exactRecordKeys(
  value: unknown,
  keys: readonly string[],
  path: string,
): RawContract {
  const result = contractObject(value, path);
  exactContractKeys(result, keys, path);
  return result;
}

export function scalarFact(value: unknown, path: string): string | number | boolean | null {
  if (
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "boolean" &&
    (typeof value !== "number" || !Number.isFinite(value))
  ) {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, path, "SCALAR_FACT");
  }
  return value as string | number | boolean | null;
}

export function canonicalJsonObject(value: unknown, path: string): CanonicalJsonObject {
  const result = contractObject(value, path);
  sha256Canonical(result);
  return result as CanonicalJsonObject;
}

export function isoTimestamp(value: unknown, path: string): string {
  const result = contractString(value, path);
  const parsed = Date.parse(result);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== result) {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, path, "ISO_8601_UTC");
  }
  return result;
}

export function assertSelfHash(
  value: RawContract,
  field: string,
  path: string,
  code: PressureChapterContractErrorCode = ERROR.CONTRACT_HASH_MISMATCH,
): void {
  contractSha256(value[field], `${path}.${field}`, code);
  const expected = hashWithoutField(value, field);
  if (value[field] !== expected) {
    failPressureContract(code, `${path}.${field}`, `EXPECTED_${expected}`);
  }
}

export function assertHashEqual(
  actual: unknown,
  expected: string,
  path: string,
  code: PressureChapterContractErrorCode,
): void {
  contractSha256(actual, path, code);
  if (actual !== expected) failPressureContract(code, path, `EXPECTED_${expected}`);
}

export function sortUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
