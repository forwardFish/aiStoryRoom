export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map((key) => `unexpected property: ${key}`);
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function nullableString(value: unknown): value is string | null {
  return value === null || nonEmptyString(value);
}

export function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

export function integerAtLeast(value: unknown, minimum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum;
}

export function fail<T>(errors: string[]): ValidationResult<T> {
  return { ok: false, errors };
}

export function pass<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}
