import { isRecord, nonEmptyString } from "./schema-utils";

export function objectErrors(value: unknown, allowed: readonly string[], path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${path} contains unknown field: ${key}`);
}

export function requireStrings(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  errors: string[],
): void {
  for (const key of keys) {
    if (!nonEmptyString(value[key])) errors.push(`${path}.${key} is required`);
  }
}

export function exactTuple(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

export function validateObject(
  value: unknown,
  fields: readonly string[],
  path: string,
  errors: string[],
  extra?: (entry: Record<string, unknown>, path: string) => void,
): void {
  errors.push(...objectErrors(value, fields, path));
  if (isRecord(value)) extra?.(value, path);
}

export function validateArrayObjects(
  value: unknown,
  fields: readonly string[],
  path: string,
  errors: string[],
  extra: (entry: Record<string, unknown>, path: string) => void,
): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((entry, index) => validateObject(entry, fields, `${path}[${index}]`, errors, extra));
}

export function validateTypedRef(
  value: unknown,
  types: readonly string[],
  path: string,
  errors: string[],
): void {
  errors.push(...objectErrors(value, ["type", "id"], path));
  if (!isRecord(value)) return;
  if (!types.includes(String(value.type ?? "")) || !nonEmptyString(value.id)) {
    errors.push(`${path} is invalid`);
  }
}
