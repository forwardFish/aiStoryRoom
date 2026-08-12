import { createHash } from "node:crypto";

export function sha256Bytes(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

export function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = canonicalizeJson((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalizeJson(value), null, 2)}\n`;
}

export function contentTreeHash(records: Array<{ path: string; byteSize: number; sha256: string }>): string {
  return sha256Bytes([...records]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => `${entry.path}\0${entry.byteSize}\0${entry.sha256}`)
    .join("\n"));
}
