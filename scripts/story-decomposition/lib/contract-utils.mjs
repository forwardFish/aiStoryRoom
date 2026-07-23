import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(here, "../../..");
export const schemaRoot = resolve(repoRoot, "scripts/story-decomposition/schemas");

export function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

export function sha256Json(value) {
  return sha256Bytes(Buffer.from(canonicalize(value), "utf8"));
}

export function withoutKeys(value, excludedKeys = ["immutableHash"]) {
  if (Array.isArray(value)) {
    return value.map((entry) => withoutKeys(entry, excludedKeys));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !excludedKeys.includes(key))
      .map(([key, entry]) => [key, withoutKeys(entry, excludedKeys)]),
  );
}

export function computeImmutableHash(value, excludedKeys = ["immutableHash"]) {
  return sha256Json(withoutKeys(value, excludedKeys));
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function resolveRepoPath(path) {
  return resolve(repoRoot, path);
}

export function loadAjv2020() {
  const packageRequire = createRequire(
    pathToFileURL(resolve(repoRoot, "packages/openovel-runtime/package.json")),
  );
  const Ajv2020 = packageRequire("ajv/dist/2020").default;
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    allowUnionTypes: false,
  });
  ajv.addFormat(
    "date-time",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/,
  );
  return ajv;
}

export async function validateWithSchema(schemaName, value) {
  const schemaPath = resolve(schemaRoot, `${schemaName}.schema.json`);
  const schema = await readJson(schemaPath);
  const ajv = loadAjv2020();
  const validate = ajv.compile(schema);
  const valid = validate(value);
  return {
    valid: Boolean(valid),
    errors: validate.errors ?? [],
    schemaPath,
  };
}

export function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
