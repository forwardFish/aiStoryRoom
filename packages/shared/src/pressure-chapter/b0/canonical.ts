import { canonicalJson } from "../contracts/canonical";

export function compareB0Text(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Clone/freeze helper for the internal B0 model. Serialization is delegated to
 * the canonical cross-module contract; B0 deliberately owns no wire serializer.
 */
export function cloneAndFreezeB0<T>(value: T): Readonly<T> {
  return deepFreeze(JSON.parse(canonicalJson(value)) as T);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}
